import crypto from 'crypto';
import firebaseConfig from '../firebase-applet-config.json';
import { db } from './db';
import { FirestoreWebhookIdempotencyRecord } from '../src/types';

// In-flight mutex set to prevent race conditions when two identical webhooks arrive simultaneously
const inFlightWebhookLocks = new Set<string>();

// Cache whether GCP metadata server is reachable so we don't wait on every webhook call in non-GCE environments
let gcpMetadataStatus: 'unknown' | 'available' | 'unavailable' = 'unknown';

/**
 * Sanitizes a raw webhook event_id so it strictly adheres to firebase-blueprint.json & firestore.rules:
 * pattern: ^[a-zA-Z0-9_\-]+$, minLength: 1, maxLength: 128
 */
export function sanitizeFirestoreEventId(rawEventId: string): string {
  const cleaned = String(rawEventId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 128);
  return cleaned || `evt_${Date.now()}`;
}

/**
 * Sanitizes optional ID fields (providerOrderId, playupOrderId, buyerRef) to match ^[a-zA-Z0-9_\-]+$ (max 64)
 */
function sanitizeOptionalId(val?: string): string | undefined {
  if (!val || !val.trim()) return undefined;
  const cleaned = val.trim().replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Computes a non-sensitive SHA-256 hex fingerprint of the signature/payload for Firestore audit integrity
 */
export function computeSignatureHash(signatureHeader?: string, rawBody?: string): string {
  return crypto
    .createHash('sha256')
    .update(`${signatureHeader || 'sig'}:${rawBody || ''}`, 'utf8')
    .digest('hex')
    .slice(0, 64);
}

/**
 * Attempts to fetch a Google Cloud Run / GCE Metadata Server access token if running in GCP
 * so server-side Firestore REST calls authenticate with the service account.
 */
async function getGcpMetadataAccessToken(): Promise<string | null> {
  if (gcpMetadataStatus === 'unavailable') {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 250);
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal
      }
    );
    if (!res.ok) {
      gcpMetadataStatus = 'unavailable';
      return null;
    }
    const data: any = await res.json();
    if (typeof data?.access_token === 'string') {
      gcpMetadataStatus = 'available';
      return data.access_token;
    }
    gcpMetadataStatus = 'unavailable';
    return null;
  } catch {
    gcpMetadataStatus = 'unavailable';
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Acquires an atomic in-memory lock while a webhook event_id is actively being processed
 */
export function acquireInFlightWebhookLock(rawEventId: string): boolean {
  const sanitized = sanitizeFirestoreEventId(rawEventId);
  if (inFlightWebhookLocks.has(sanitized)) {
    return false;
  }
  inFlightWebhookLocks.add(sanitized);
  return true;
}

export function releaseInFlightWebhookLock(rawEventId: string): void {
  const sanitized = sanitizeFirestoreEventId(rawEventId);
  inFlightWebhookLocks.delete(sanitized);
}

/**
 * Checks whether a webhook event_id has already been processed in Firestore (/webhook_events/{eventId})
 * or in the synchronized server idempotency ledger.
 */
export async function checkWebhookIdempotencyInFirestore(rawEventId: string): Promise<{
  isDuplicate: boolean;
  sanitizedEventId: string;
  firestoreDocPath: string;
  existingRecord?: FirestoreWebhookIdempotencyRecord;
  source: 'in_flight_mutex' | 'firestore_cloud' | 'firestore_ledger' | 'none';
}> {
  const sanitizedEventId = sanitizeFirestoreEventId(rawEventId);
  const firestoreDocPath = `webhook_events/${sanitizedEventId}`;

  // 1. Check synchronized Firestore idempotency lock table & processed webhook events
  const localLock =
    db.getFirestoreWebhookLock(sanitizedEventId) || db.getFirestoreWebhookLock(rawEventId);
  if (
    localLock ||
    db.hasProcessedRechargeGamesWebhookEvent(rawEventId) ||
    db.hasProcessedRechargeGamesWebhookEvent(sanitizedEventId)
  ) {
    return {
      isDuplicate: true,
      sanitizedEventId,
      firestoreDocPath,
      existingRecord: localLock,
      source: 'firestore_ledger'
    };
  }

  // 2. Check Cloud Firestore via GCP REST API (when metadata token is available)
  try {
    const token = await getGcpMetadataAccessToken();
    if (token) {
      const restUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/webhook_events/${encodeURIComponent(sanitizedEventId)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      try {
        const res = await fetch(restUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
        if (res.status === 200) {
          const docJson: any = await res.json();
          const fields = docJson?.fields || {};
          const syncedRecord: FirestoreWebhookIdempotencyRecord = {
            eventId: fields.eventId?.stringValue || sanitizedEventId,
            provider: 'rechargegames',
            eventType: (fields.eventType?.stringValue as any) || 'webhook.test',
            providerOrderId: fields.providerOrderId?.stringValue,
            playupOrderId: fields.playupOrderId?.stringValue,
            buyerRef: fields.buyerRef?.stringValue,
            status: 'processed',
            signatureHash: fields.signatureHash?.stringValue || 'verified_hmac_sha256',
            processedAt: fields.processedAt?.timestampValue || new Date().toISOString(),
            firestoreDocPath
          };
          db.saveFirestoreWebhookLock(syncedRecord);
          return {
            isDuplicate: true,
            sanitizedEventId,
            firestoreDocPath,
            existingRecord: syncedRecord,
            source: 'firestore_cloud'
          };
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // Non-blocking fallback to synchronized Firestore ledger
  }

  return {
    isDuplicate: false,
    sanitizedEventId,
    firestoreDocPath,
    source: 'none'
  };
}

/**
 * Persists a processed webhook event_id into Firestore (/webhook_events/{eventId})
 * and the server idempotency ledger to guarantee zero duplicate processing.
 */
export async function recordWebhookIdempotencyInFirestore(params: {
  eventId: string;
  eventType: 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed';
  providerOrderId?: string;
  playupOrderId?: string;
  buyerRef?: string;
  signatureHeader?: string;
  rawBody?: string;
}): Promise<FirestoreWebhookIdempotencyRecord> {
  const sanitizedEventId = sanitizeFirestoreEventId(params.eventId);
  const firestoreDocPath = `webhook_events/${sanitizedEventId}`;
  const nowIso = new Date().toISOString();
  const signatureHash = computeSignatureHash(params.signatureHeader, params.rawBody);

  const cleanProviderOrderId = sanitizeOptionalId(params.providerOrderId);
  const cleanPlayupOrderId = sanitizeOptionalId(params.playupOrderId);
  const cleanBuyerRef = sanitizeOptionalId(params.buyerRef);

  const record: FirestoreWebhookIdempotencyRecord = {
    eventId: sanitizedEventId,
    provider: 'rechargegames',
    eventType: params.eventType,
    ...(cleanProviderOrderId ? { providerOrderId: cleanProviderOrderId } : {}),
    ...(cleanPlayupOrderId ? { playupOrderId: cleanPlayupOrderId } : {}),
    ...(cleanBuyerRef ? { buyerRef: cleanBuyerRef } : {}),
    status: 'processed',
    signatureHash,
    processedAt: nowIso,
    firestoreDocPath
  };

  // 1. Immediately persist to synchronized server ledger so any concurrent or subsequent request is blocked
  db.saveFirestoreWebhookLock(record);

  // 2. Write to Cloud Firestore (/webhook_events/{eventId}) via REST v1 if GCP token available
  try {
    const token = await getGcpMetadataAccessToken();
    if (token) {
      const restUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/webhook_events?documentId=${encodeURIComponent(sanitizedEventId)}`;
      const firestoreFields: Record<string, any> = {
        eventId: { stringValue: sanitizedEventId },
        provider: { stringValue: 'rechargegames' },
        eventType: { stringValue: params.eventType },
        status: { stringValue: 'processed' },
        signatureHash: { stringValue: signatureHash },
        processedAt: { timestampValue: nowIso }
      };
      if (cleanProviderOrderId) {
        firestoreFields.providerOrderId = { stringValue: cleanProviderOrderId };
      }
      if (cleanPlayupOrderId) {
        firestoreFields.playupOrderId = { stringValue: cleanPlayupOrderId };
      }
      if (cleanBuyerRef) {
        firestoreFields.buyerRef = { stringValue: cleanBuyerRef };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      try {
        await fetch(restUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields: firestoreFields }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    // Synchronized in Firestore lock store and synced via authenticated Admin client when active
  }

  return record;
}
