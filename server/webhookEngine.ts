import crypto from 'crypto';
import { db } from './db';
import { Order, WebhookLog } from '../src/types';

export interface HmacValidationResult {
  valid: boolean;
  provider?: string;
  webhookId: string;
  webhookTimestamp: string;
  signatureHeader: string;
  signatureDetected: boolean;
  signatureMasked: string;
  computedHmacPreview: string;
  algorithm: 'HMAC-SHA256';
  timingSafeEqualUsed: true;
  reason: string;
  errorCode?:
    | 'SECRET_NOT_CONFIGURED'
    | 'MISSING_SIGNATURE_HEADER'
    | 'INVALID_SIGNATURE_FORMAT'
    | 'TIMESTAMP_EXPIRED'
    | 'INVALID_TIMESTAMP'
    | 'SIGNATURE_MISMATCH';
}

/**
 * Robust, constant-time HMAC-SHA256 validation engine for all incoming webhooks
 * (RechargeGames Standard Webhooks, GoXtop, Stripe, MonCash/NatCash, Reseller callbacks).
 * Uses `crypto.timingSafeEqual` on fixed-length digest buffers without early termination
 * to prevent timing side-channel attacks.
 */
export class WebhookHmacValidator {
  public static readonly DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes anti-replay window
  private static readonly DUMMY_32_BYTE_BUFFER = Buffer.alloc(32, 0);
  private static readonly ZERO_HMAC_KEY = Buffer.alloc(32, 0x5a);

  /**
   * Performs a constant-time comparison of two binary buffers using `crypto.timingSafeEqual`.
   * Even when buffer lengths differ, executes a dummy `crypto.timingSafeEqual` of identical byte size
   * so execution duration never leaks length information.
   */
  public static timingSafeCompareBuffers(candidate: Buffer, expected: Buffer): boolean {
    if (!Buffer.isBuffer(candidate) || !Buffer.isBuffer(expected) || expected.length === 0) {
      crypto.timingSafeEqual(this.DUMMY_32_BYTE_BUFFER, this.DUMMY_32_BYTE_BUFFER);
      return false;
    }

    if (candidate.length !== expected.length) {
      // Constant-time dummy comparison of expected buffer against itself to avoid length-timing leak
      crypto.timingSafeEqual(expected, Buffer.alloc(expected.length, 0));
      return false;
    }

    return crypto.timingSafeEqual(candidate, expected);
  }

  /**
   * Performs a constant-time comparison of two UTF-8 strings by comparing both their
   * fixed-size 32-byte HMAC-SHA256 digests and their byte buffers via `crypto.timingSafeEqual`.
   */
  public static timingSafeCompareStrings(candidate: string, expected: string): boolean {
    const bufA = Buffer.from(String(candidate || ''), 'utf8');
    const bufB = Buffer.from(String(expected || ''), 'utf8');

    const digestA = crypto.createHmac('sha256', this.ZERO_HMAC_KEY).update(bufA).digest();
    const digestB = crypto.createHmac('sha256', this.ZERO_HMAC_KEY).update(bufB).digest();

    const digestsMatch = crypto.timingSafeEqual(digestA, digestB);
    const buffersMatch = this.timingSafeCompareBuffers(bufA, bufB);

    return digestsMatch && buffersMatch;
  }

  /**
   * Decodes a candidate hex or base64 signature string into a 32-byte binary SHA-256 digest buffer.
   * Returns null if the candidate is not a valid 32-byte SHA-256 digest in the requested encoding.
   */
  public static decodeCandidateDigest(candidate: string, encoding: 'hex' | 'base64'): Buffer | null {
    const clean = String(candidate || '').trim();
    if (!clean) return null;

    if (encoding === 'hex') {
      if (clean.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(clean)) {
        return null;
      }
      const buf = Buffer.from(clean, 'hex');
      return buf.length === 32 ? buf : null;
    }

    // Base64 (Standard Webhooks v1,<base64>)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
      return null;
    }
    const buf = Buffer.from(clean, 'base64');
    return buf.length === 32 ? buf : null;
  }

  /**
   * Masks a raw signature value for safe logging and UI telemetry.
   */
  public static maskSignature(rawSignature: string): string {
    const clean = String(rawSignature || '').trim();
    if (!clean) return 'Manquante';
    if (clean.length > 14) {
      return `${clean.slice(0, 8)}••••••••${clean.slice(-6)}`;
    }
    return '••••••••';
  }

  /**
   * Normalizes Express request headers to lowercase keys with single string values.
   */
  public static normalizeHeaders(headers: Record<string, any> = {}): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
      if (typeof v === 'string') {
        normalized[k.toLowerCase()] = v.trim();
      } else if (Array.isArray(v) && v.length > 0) {
        normalized[k.toLowerCase()] = String(v[0]).trim();
      }
    }
    return normalized;
  }

  /**
   * Validates timestamp freshness against replay attacks.
   */
  public static verifyTimestampFreshness(
    timestampRaw: string,
    toleranceSeconds: number = this.DEFAULT_TOLERANCE_SECONDS
  ): { valid: boolean; reason?: string; errorCode?: 'INVALID_TIMESTAMP' | 'TIMESTAMP_EXPIRED' } {
    if (!timestampRaw) {
      return { valid: true };
    }
    const tsNum = Number(timestampRaw);
    if (Number.isNaN(tsNum) || tsNum <= 0) {
      return {
        valid: false,
        errorCode: 'INVALID_TIMESTAMP',
        reason: `Horodatage webhook-timestamp ("${timestampRaw}") malformé.`
      };
    }
    const tsSeconds = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - tsSeconds) > toleranceSeconds) {
      return {
        valid: false,
        errorCode: 'TIMESTAMP_EXPIRED',
        reason: `Horodatage webhook-timestamp (${timestampRaw}) hors de la fenêtre de tolérance de ${Math.floor(toleranceSeconds / 60)} minutes.`
      };
    }
    return { valid: true };
  }

  /**
   * Derives candidate HMAC secret keys (supports both Standard Webhooks `whsec_<base64>` and raw UTF-8 secrets).
   */
  public static deriveSecretKeys(secret: string): Buffer[] {
    const cleanSecret = String(secret || '').trim();
    if (!cleanSecret) return [];

    const keys: Buffer[] = [];
    if (cleanSecret.startsWith('whsec_')) {
      try {
        const decoded = Buffer.from(cleanSecret.slice(6), 'base64');
        if (decoded.length > 0) {
          keys.push(decoded);
        }
      } catch {
        // Fallback to raw UTF-8 buffer
      }
    }
    keys.push(Buffer.from(cleanSecret, 'utf8'));
    return keys;
  }

  /**
   * Validates Standard Webhooks / RechargeGames incoming webhooks (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
   * Uses `crypto.timingSafeEqual` across all candidate signatures without early loop exit.
   */
  public static verifyStandardWebhook(params: {
    rawBody: string | Buffer;
    headers: Record<string, any>;
    secret: string;
    toleranceSeconds?: number;
    providerName?: string;
  }): HmacValidationResult {
    const normalizedHeaders = this.normalizeHeaders(params.headers);
    const rawBodyStr = Buffer.isBuffer(params.rawBody)
      ? params.rawBody.toString('utf8')
      : String(params.rawBody ?? '');

    const webhookId =
      normalizedHeaders['webhook-id'] ||
      normalizedHeaders['x-webhook-id'] ||
      normalizedHeaders['svix-id'] ||
      '';
    const webhookTimestamp =
      normalizedHeaders['webhook-timestamp'] ||
      normalizedHeaders['x-webhook-timestamp'] ||
      normalizedHeaders['svix-timestamp'] ||
      '';
    const signatureRaw =
      normalizedHeaders['webhook-signature'] ||
      normalizedHeaders['x-webhook-signature'] ||
      normalizedHeaders['x-rechargegames-signature'] ||
      normalizedHeaders['svix-signature'] ||
      '';

    const maskedSig = this.maskSignature(signatureRaw);
    const cleanSecret = String(params.secret || '').trim();

    if (!cleanSecret) {
      return {
        valid: false,
        provider: params.providerName || 'RechargeGames',
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureDetected: Boolean(signatureRaw),
        signatureMasked: maskedSig,
        computedHmacPreview: 'Secret non configuré',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: 'SECRET_NOT_CONFIGURED',
        reason: 'RECHARGEGAMES_WEBHOOK_SECRET non configuré côté serveur.'
      };
    }

    if (!signatureRaw) {
      return {
        valid: false,
        provider: params.providerName || 'RechargeGames',
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureDetected: false,
        signatureMasked: 'Manquante',
        computedHmacPreview: 'N/A',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: 'MISSING_SIGNATURE_HEADER',
        reason: 'En-tête webhook-signature manquant dans la requête entrante.'
      };
    }

    const tsCheck = this.verifyTimestampFreshness(
      webhookTimestamp,
      params.toleranceSeconds ?? this.DEFAULT_TOLERANCE_SECONDS
    );
    if (!tsCheck.valid) {
      return {
        valid: false,
        provider: params.providerName || 'RechargeGames',
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureDetected: true,
        signatureMasked: maskedSig,
        computedHmacPreview: 'Timestamp expiré',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: tsCheck.errorCode,
        reason: tsCheck.reason || 'Horodatage webhook invalide ou expiré.'
      };
    }

    // Extract candidate signature tokens (supports space-separated or comma-separated `v1,<b64>`, `v1=<hex>`, `sha256=<hex>`)
    const candidateSigs = signatureRaw
      .split(/\s+/)
      .map(part => part.replace(/^(v1,|v1=|sha256=|hmac-sha256=)/i, '').trim())
      .filter(Boolean);

    const signingPayloads: string[] = [];
    if (webhookId && webhookTimestamp) {
      signingPayloads.push(`${webhookId}.${webhookTimestamp}.${rawBodyStr}`);
    }
    if (webhookTimestamp) {
      signingPayloads.push(`${webhookTimestamp}.${rawBodyStr}`);
    }
    signingPayloads.push(rawBodyStr);

    const hmacKeys = this.deriveSecretKeys(cleanSecret);
    const primaryDigest = crypto
      .createHmac('sha256', hmacKeys[0])
      .update(signingPayloads[0], 'utf8')
      .digest();
    const primaryBase64 = primaryDigest.toString('base64');
    const computedPreview = `v1,${primaryBase64.slice(0, 8)}••••${primaryBase64.slice(-6)}`;

    let matchedAny = false;
    let matchedFormat: 'base64' | 'hex' = 'base64';

    for (const payloadToSign of signingPayloads) {
      for (const keyToUse of hmacKeys) {
        const expectedDigestBuf = crypto
          .createHmac('sha256', keyToUse)
          .update(payloadToSign, 'utf8')
          .digest(); // 32-byte raw SHA-256 buffer

        for (const candidate of candidateSigs) {
          const candHexBuf = this.decodeCandidateDigest(candidate, 'hex');
          const isHexMatch = this.timingSafeCompareBuffers(
            candHexBuf || this.DUMMY_32_BYTE_BUFFER,
            expectedDigestBuf
          ) && candHexBuf !== null;

          const candB64Buf = this.decodeCandidateDigest(candidate, 'base64');
          const isB64Match = this.timingSafeCompareBuffers(
            candB64Buf || this.DUMMY_32_BYTE_BUFFER,
            expectedDigestBuf
          ) && candB64Buf !== null;

          if (isHexMatch) {
            matchedAny = true;
            matchedFormat = 'hex';
          }
          if (isB64Match) {
            matchedAny = true;
            matchedFormat = 'base64';
          }
        }
      }
    }

    if (matchedAny) {
      return {
        valid: true,
        provider: params.providerName || 'RechargeGames',
        webhookId,
        webhookTimestamp,
        signatureHeader: 'webhook-signature',
        signatureDetected: true,
        signatureMasked: maskedSig,
        computedHmacPreview: computedPreview,
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        reason:
          matchedFormat === 'base64'
            ? 'Signature Standard Webhooks HMAC-SHA256 (Base64) authentifiée en temps constant (crypto.timingSafeEqual).'
            : 'Signature HMAC-SHA256 (Hex) authentifiée en temps constant (crypto.timingSafeEqual).'
      };
    }

    return {
      valid: false,
      provider: params.providerName || 'RechargeGames',
      webhookId,
      webhookTimestamp,
      signatureHeader: 'webhook-signature',
      signatureDetected: true,
      signatureMasked: maskedSig,
      computedHmacPreview: computedPreview,
      algorithm: 'HMAC-SHA256',
      timingSafeEqualUsed: true,
      errorCode: 'SIGNATURE_MISMATCH',
      reason:
        'Signature HMAC-SHA256 invalide : la signature reçue ne correspond pas au digest calculé avec RECHARGEGAMES_WEBHOOK_SECRET.'
    };
  }

  /**
   * Validates Stripe incoming webhooks (`stripe-signature`: `t=<timestamp>,v1=<hex>`) using `crypto.timingSafeEqual`.
   */
  public static verifyStripeWebhook(params: {
    rawBody: string | Buffer;
    signatureHeader: string;
    secret: string;
    toleranceSeconds?: number;
  }): HmacValidationResult {
    const rawBodyStr = Buffer.isBuffer(params.rawBody)
      ? params.rawBody.toString('utf8')
      : String(params.rawBody ?? '');
    const sigHeader = String(params.signatureHeader || '').trim();
    const cleanSecret = String(params.secret || '').trim();
    const maskedSig = this.maskSignature(sigHeader);

    if (!cleanSecret) {
      return {
        valid: false,
        provider: 'Stripe',
        webhookId: '',
        webhookTimestamp: '',
        signatureHeader: 'stripe-signature',
        signatureDetected: Boolean(sigHeader),
        signatureMasked: maskedSig,
        computedHmacPreview: 'Secret non configuré',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: 'SECRET_NOT_CONFIGURED',
        reason: 'STRIPE_WEBHOOK_SECRET non configuré côté serveur.'
      };
    }

    if (!sigHeader) {
      return {
        valid: false,
        provider: 'Stripe',
        webhookId: '',
        webhookTimestamp: '',
        signatureHeader: 'stripe-signature',
        signatureDetected: false,
        signatureMasked: 'Manquante',
        computedHmacPreview: 'N/A',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: 'MISSING_SIGNATURE_HEADER',
        reason: 'En-tête stripe-signature manquant.'
      };
    }

    const parts = sigHeader.split(',').map(p => p.trim());
    const tPart = parts.find(p => p.startsWith('t='));
    const v1Parts = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3).trim()).filter(Boolean);
    const timestamp = tPart ? tPart.slice(2).trim() : '';

    if (!timestamp || v1Parts.length === 0) {
      return {
        valid: false,
        provider: 'Stripe',
        webhookId: '',
        webhookTimestamp: timestamp,
        signatureHeader: 'stripe-signature',
        signatureDetected: true,
        signatureMasked: maskedSig,
        computedHmacPreview: 'Format invalide',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: 'INVALID_SIGNATURE_FORMAT',
        reason: 'Format stripe-signature invalide (t=... et v1=... requis).'
      };
    }

    const tsCheck = this.verifyTimestampFreshness(
      timestamp,
      params.toleranceSeconds ?? this.DEFAULT_TOLERANCE_SECONDS
    );
    if (!tsCheck.valid) {
      return {
        valid: false,
        provider: 'Stripe',
        webhookId: '',
        webhookTimestamp: timestamp,
        signatureHeader: 'stripe-signature',
        signatureDetected: true,
        signatureMasked: maskedSig,
        computedHmacPreview: 'Timestamp expiré',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        errorCode: tsCheck.errorCode,
        reason: 'Horodatage Stripe expiré (protection anti-replay).'
      };
    }

    const signedPayload = `${timestamp}.${rawBodyStr}`;
    const expectedDigestBuf = crypto
      .createHmac('sha256', cleanSecret)
      .update(signedPayload, 'utf8')
      .digest();
    const expectedHex = expectedDigestBuf.toString('hex');
    const computedPreview = `v1=${expectedHex.slice(0, 10)}••••${expectedHex.slice(-8)}`;

    let matched = false;
    for (const candidateHex of v1Parts) {
      const candBuf = this.decodeCandidateDigest(candidateHex, 'hex');
      const isMatch =
        this.timingSafeCompareBuffers(candBuf || this.DUMMY_32_BYTE_BUFFER, expectedDigestBuf) &&
        candBuf !== null;
      if (isMatch) {
        matched = true;
      }
    }

    return {
      valid: matched,
      provider: 'Stripe',
      webhookId: '',
      webhookTimestamp: timestamp,
      signatureHeader: 'stripe-signature',
      signatureDetected: true,
      signatureMasked: maskedSig,
      computedHmacPreview: computedPreview,
      algorithm: 'HMAC-SHA256',
      timingSafeEqualUsed: true,
      errorCode: matched ? undefined : 'SIGNATURE_MISMATCH',
      reason: matched
        ? 'Signature Stripe HMAC-SHA256 authentifiée en temps constant (crypto.timingSafeEqual).'
        : 'Signature Stripe HMAC-SHA256 invalide.'
    };
  }

  /**
   * Validates GoXtop, Payment Gateway (MonCash/NatCash), or generic Provider webhooks
   * using `crypto.timingSafeEqual`.
   */
  public static verifyProviderWebhook(params: {
    rawBody: string | Buffer;
    headers: Record<string, any>;
    secret?: string;
    configuredHeaderName?: string;
    providerName?: string;
    allowUnsignedWhenSecretEmpty?: boolean;
    toleranceSeconds?: number;
  }): HmacValidationResult & {
    hmacValidationLabel: 'Validée' | 'Échec' | 'Non applicable';
  } {
    const rawBodyStr = Buffer.isBuffer(params.rawBody)
      ? params.rawBody.toString('utf8')
      : String(params.rawBody ?? '');
    const secret = String(params.secret || '').trim();
    const normalized = this.normalizeHeaders(params.headers);

    const timestampValue =
      normalized['x-webhook-timestamp'] ||
      normalized['webhook-timestamp'] ||
      normalized['x-timestamp'] ||
      '';
    const webhookId =
      normalized['x-webhook-id'] ||
      normalized['webhook-id'] ||
      normalized['x-playup-delivery'] ||
      '';

    let detectedHeaderName = '';
    let signatureValue = '';

    const configuredHeader = params.configuredHeaderName?.trim().toLowerCase();
    if (configuredHeader && normalized[configuredHeader]) {
      detectedHeaderName = configuredHeader;
      signatureValue = normalized[configuredHeader];
    } else {
      for (const [k, v] of Object.entries(params.headers || {})) {
        const lowerKey = k.toLowerCase();
        if (
          lowerKey === 'x-webhook-signature' ||
          lowerKey === 'webhook-signature' ||
          lowerKey === 'x-playup-signature' ||
          lowerKey.includes('signature') ||
          lowerKey.includes('hmac')
        ) {
          detectedHeaderName = k;
          signatureValue = Array.isArray(v) ? String(v[0]) : String(v);
          break;
        }
      }
    }

    const signatureDetected = Boolean(signatureValue && signatureValue.trim().length > 0);
    const cleanSig = signatureValue
      ? signatureValue.replace(/^(sha256=|hmac-sha256=|v1,|v1=)/i, '').trim()
      : '';
    const signatureMasked = cleanSig
      ? cleanSig.length > 16
        ? `sha256=${cleanSig.slice(0, 10)}••••${cleanSig.slice(-8)}`
        : `sha256=${cleanSig}`
      : 'Manquante';

    if (!secret) {
      const allowUnsigned = params.allowUnsignedWhenSecretEmpty !== false;
      return {
        valid: allowUnsigned,
        provider: params.providerName || 'Provider',
        webhookId,
        webhookTimestamp: timestampValue,
        signatureHeader: detectedHeaderName || 'x-webhook-signature',
        signatureDetected,
        signatureMasked,
        computedHmacPreview: 'Non applicable',
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        hmacValidationLabel: allowUnsigned ? 'Non applicable' : 'Échec',
        errorCode: allowUnsigned ? undefined : 'SECRET_NOT_CONFIGURED',
        reason: `Secret fournisseur : non configuré / non fourni par ${params.providerName || 'le fournisseur'}`
      };
    }

    if (timestampValue && params.toleranceSeconds) {
      const tsCheck = this.verifyTimestampFreshness(timestampValue, params.toleranceSeconds);
      if (!tsCheck.valid) {
        return {
          valid: false,
          provider: params.providerName || 'Provider',
          webhookId,
          webhookTimestamp: timestampValue,
          signatureHeader: detectedHeaderName || 'x-webhook-signature',
          signatureDetected,
          signatureMasked,
          computedHmacPreview: 'Timestamp expiré',
          algorithm: 'HMAC-SHA256',
          timingSafeEqualUsed: true,
          hmacValidationLabel: 'Échec',
          errorCode: tsCheck.errorCode,
          reason: tsCheck.reason || 'Horodatage du webhook expiré.'
        };
      }
    }

    const signingInputWithTs = timestampValue ? `${timestampValue}.${rawBodyStr}` : rawBodyStr;
    const expectedTsDigest = crypto
      .createHmac('sha256', secret)
      .update(signingInputWithTs, 'utf8')
      .digest();
    const expectedRawDigest = crypto
      .createHmac('sha256', secret)
      .update(rawBodyStr, 'utf8')
      .digest();

    const expectedHexWithTs = expectedTsDigest.toString('hex');
    const expectedHexRaw = expectedRawDigest.toString('hex');
    const computedHmacPreview = `sha256=${expectedHexWithTs.slice(0, 10)}••••${expectedHexWithTs.slice(-8)}`;

    if (!signatureDetected || !cleanSig) {
      return {
        valid: false,
        provider: params.providerName || 'Provider',
        webhookId,
        webhookTimestamp: timestampValue,
        signatureHeader: detectedHeaderName || 'x-webhook-signature',
        signatureDetected: false,
        signatureMasked: 'Manquante',
        computedHmacPreview,
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        hmacValidationLabel: 'Échec',
        errorCode: 'MISSING_SIGNATURE_HEADER',
        reason: 'Secret Webhook configuré mais aucune signature HMAC-SHA256 détectée dans les en-têtes HTTP reçus.'
      };
    }

    const candHexBuf = this.decodeCandidateDigest(cleanSig, 'hex');
    const candB64Buf = this.decodeCandidateDigest(cleanSig, 'base64');

    const matchHexTs =
      this.timingSafeCompareBuffers(candHexBuf || this.DUMMY_32_BYTE_BUFFER, expectedTsDigest) &&
      candHexBuf !== null;
    const matchHexRaw =
      this.timingSafeCompareBuffers(candHexBuf || this.DUMMY_32_BYTE_BUFFER, expectedRawDigest) &&
      candHexBuf !== null;
    const matchB64Ts =
      this.timingSafeCompareBuffers(candB64Buf || this.DUMMY_32_BYTE_BUFFER, expectedTsDigest) &&
      candB64Buf !== null;
    const matchB64Raw =
      this.timingSafeCompareBuffers(candB64Buf || this.DUMMY_32_BYTE_BUFFER, expectedRawDigest) &&
      candB64Buf !== null;

    if (matchHexTs || matchHexRaw || matchB64Ts || matchB64Raw) {
      return {
        valid: true,
        provider: params.providerName || 'Provider',
        webhookId,
        webhookTimestamp: timestampValue,
        signatureHeader: detectedHeaderName || 'x-webhook-signature',
        signatureDetected: true,
        signatureMasked,
        computedHmacPreview: matchHexRaw
          ? `sha256=${expectedHexRaw.slice(0, 10)}••••${expectedHexRaw.slice(-8)}`
          : computedHmacPreview,
        algorithm: 'HMAC-SHA256',
        timingSafeEqualUsed: true,
        hmacValidationLabel: 'Validée',
        reason: 'Signature HMAC-SHA256 validée en temps constant (crypto.timingSafeEqual).'
      };
    }

    return {
      valid: false,
      provider: params.providerName || 'Provider',
      webhookId,
      webhookTimestamp: timestampValue,
      signatureHeader: detectedHeaderName || 'x-webhook-signature',
      signatureDetected: true,
      signatureMasked,
      computedHmacPreview,
      algorithm: 'HMAC-SHA256',
      timingSafeEqualUsed: true,
      hmacValidationLabel: 'Échec',
      errorCode: !candHexBuf && !candB64Buf ? 'INVALID_SIGNATURE_FORMAT' : 'SIGNATURE_MISMATCH',
      reason:
        !candHexBuf && !candB64Buf
          ? 'Format de signature HMAC-SHA256 malformé'
          : `Signature HMAC-SHA256 invalide (en-tête détecté : ${detectedHeaderName})`
    };
  }

  /**
   * Generates a valid Standard Webhooks HMAC-SHA256 signature (`v1,<base64>`)
   */
  public static signStandardWebhook(
    rawBody: string,
    webhookId: string,
    webhookTimestamp: string,
    secret: string
  ): string {
    const canonical = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const keys = this.deriveSecretKeys(secret);
    const keyToUse = keys[0] || Buffer.from(secret, 'utf8');
    const b64 = crypto.createHmac('sha256', keyToUse).update(canonical, 'utf8').digest('base64');
    return `v1,${b64}`;
  }

  /**
   * Generates a valid Stripe webhook signature header (`t=<timestamp>,v1=<hex>`)
   */
  public static signStripeWebhook(rawBody: string, timestamp: string | number, secret: string): string {
    const ts = String(timestamp);
    const hex = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex');
    return `t=${ts},v1=${hex}`;
  }
}

export class WebhookEngine {
  /**
   * Generates HMAC-SHA256 signature for payload verification
   */
  public static signPayload(payloadString: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
  }

  /**
   * Verifies an incoming or reseller webhook signature in constant time using `WebhookHmacValidator`
   */
  public static verifySignature(
    rawBody: string,
    signatureOrHeaders: string | Record<string, any>,
    secret: string
  ): boolean {
    if (typeof signatureOrHeaders === 'string') {
      const expectedHex = this.signPayload(rawBody, secret);
      return WebhookHmacValidator.timingSafeCompareStrings(
        signatureOrHeaders.replace(/^(sha256=|hmac-sha256=|v1=)/i, '').trim().toLowerCase(),
        expectedHex.toLowerCase()
      );
    }
    return WebhookHmacValidator.verifyProviderWebhook({
      rawBody,
      headers: signatureOrHeaders,
      secret,
      allowUnsignedWhenSecretEmpty: false
    }).valid;
  }

  /**
   * Dispatches an event to the reseller's webhook endpoint
   */
  public static async dispatchOrderEvent(order: Order, eventName: 'order.created' | 'order.processing' | 'order.completed' | 'order.failed') {
    if (!order.resellerId) return;

    const resellers = db.getResellers();
    const reseller = resellers.find(r => r.id === order.resellerId);
    if (!reseller || !reseller.webhookUrl) return;

    const payload = {
      event: eventName,
      eventId: 'evt_' + crypto.randomUUID().slice(0, 12),
      timestamp: new Date().toISOString(),
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        gameId: order.gameId,
        gameName: order.gameName,
        serviceId: order.serviceId,
        serviceName: order.serviceName,
        packageId: order.packageId,
        packageName: order.packageName,
        gameProfileData: order.gameProfileData,
        chargedAmount: order.chargedAmount,
        currency: order.currency,
        providerReference: order.providerReference,
        errorMessage: order.errorMessage,
        updatedAt: order.updatedAt
      }
    };

    const payloadString = JSON.stringify(payload);
    const signature = this.signPayload(payloadString, reseller.webhookSecret || 'playup_secret_default');

    let httpStatus = 200;
    let responseText = '{"status":"ok","acknowledged":true}';
    let attempts = 1;

    // Simulate network delivery
    try {
      if (reseller.webhookUrl.startsWith('http')) {
        // Try actual fetch with timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);

        try {
          const res = await fetch(reseller.webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-PlayUp-Signature': signature,
              'X-PlayUp-Event': eventName,
              'X-PlayUp-Delivery': payload.eventId,
              'User-Agent': 'PlayUp-Webhook-Agent/2.4'
            },
            body: payloadString,
            signal: controller.signal
          });
          clearTimeout(timeout);
          httpStatus = res.status;
          responseText = await res.text().catch(() => '');
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          // If remote webhook endpoint is offline or not reachable in sandbox, record clean simulated 200 for demo webhook.site or log failure
          if (reseller.webhookUrl.includes('webhook.site') || reseller.webhookUrl.includes('example.com')) {
            httpStatus = 200;
            responseText = JSON.stringify({ delivered: true, simulated: true, note: 'Mock receiver OK' });
          } else {
            httpStatus = 504;
            responseText = `Connection timed out or refused (${fetchErr.message || 'Network error'})`;
          }
        }
      }
    } catch (err: any) {
      httpStatus = 500;
      responseText = err.message;
    }

    const logEntry: WebhookLog = {
      id: 'wh_' + Date.now(),
      resellerId: reseller.id,
      orderId: order.id,
      event: eventName,
      url: reseller.webhookUrl,
      httpStatus,
      attempts,
      payload,
      response: responseText.slice(0, 300),
      createdAt: new Date().toISOString()
    };

    db.addWebhookLog(logEntry);
    db.addSystemLog(
      httpStatus >= 200 && httpStatus < 300 ? 'info' : 'warn',
      'webhook',
      `Webhook [${eventName}] dispatched to ${reseller.company || reseller.name} (${httpStatus})`,
      { orderNumber: order.orderNumber, httpStatus, url: reseller.webhookUrl }
    );
  }
}
