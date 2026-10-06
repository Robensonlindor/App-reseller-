import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  Auth
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  getDoc,
  serverTimestamp,
  Firestore
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

function ensureFirebaseInitialized() {
  if (!appInstance) {
    try {
      appInstance = initializeApp(firebaseConfig);
    } catch (e) {
      console.warn('[PlayUp Firebase] App initialization fallback:', e);
    }
  }

  if (appInstance && !dbInstance) {
    try {
      dbInstance = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId);
    } catch (e) {
      console.warn('[PlayUp Firebase] Firestore initialization fallback:', e);
    }
  }

  if (appInstance && !authInstance) {
    try {
      // Try standard browser persistence first, fall back to inMemoryPersistence if iframe blocks localStorage/IndexedDB
      authInstance = initializeAuth(appInstance, {
        persistence: [browserLocalPersistence, inMemoryPersistence]
      });
    } catch {
      try {
        authInstance = getAuth(appInstance);
      } catch (e) {
        console.warn('[PlayUp Firebase] Auth initialization fallback:', e);
      }
    }
  }

  if (!googleProviderInstance) {
    try {
      googleProviderInstance = new GoogleAuthProvider();
    } catch {
      // Ignore
    }
  }

  return {
    app: appInstance,
    db: dbInstance,
    auth: authInstance,
    googleProvider: googleProviderInstance
  };
}

// Initialize safely without ever throwing at module load time
const initialized = ensureFirebaseInitialized();
export const db = initialized.db;
export const auth = initialized.auth;
export const googleProvider = initialized.googleProvider;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const { auth: currentAuth } = ensureFirebaseInitialized();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentAuth?.currentUser?.uid,
      email: currentAuth?.currentUser?.email,
      emailVerified: currentAuth?.currentUser?.emailVerified,
      isAnonymous: currentAuth?.currentUser?.isAnonymous,
      tenantId: currentAuth?.currentUser?.tenantId,
      providerInfo:
        currentAuth?.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection() {
  const { db: currentDb } = ensureFirebaseInitialized();
  if (!currentDb) return;
  try {
    await getDocFromServer(doc(currentDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export async function syncFirebaseUserToFirestore(
  uid: string,
  displayName: string,
  email: string,
  phone?: string,
  preferredCurrency: 'USD' | 'HTG' | 'EUR' = 'USD'
) {
  const { db: currentDb } = ensureFirebaseInitialized();
  if (!currentDb) return;

  const sanitizedDisplayName = (displayName || 'PlayUp Gamer').slice(0, 80);
  const sanitizedEmail = (email || '').slice(0, 160);
  const publicPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;

  try {
    const existingSnap = await getDoc(doc(currentDb, 'users', uid));
    if (!existingSnap.exists()) {
      await setDoc(doc(currentDb, 'users', uid), {
        uid,
        displayName: sanitizedDisplayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, publicPath);
  }

  try {
    const existingPrivSnap = await getDoc(doc(currentDb, 'users', uid, 'private', 'info'));
    if (!existingPrivSnap.exists()) {
      await setDoc(doc(currentDb, 'users', uid, 'private', 'info'), {
        uid,
        email: sanitizedEmail,
        ...(phone ? { phone: phone.slice(0, 32) } : {}),
        preferredCurrency,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }
}

export async function signInWithGooglePopup() {
  const { auth: currentAuth, googleProvider: provider } = ensureFirebaseInitialized();
  if (!currentAuth || !provider) {
    throw new Error('Service Google Auth non disponible dans cet environnement.');
  }
  const credential = await signInWithPopup(currentAuth, provider);
  const fbUser = credential.user;
  const idToken = await fbUser.getIdToken();

  if (fbUser.emailVerified) {
    await syncFirebaseUserToFirestore(
      fbUser.uid,
      fbUser.displayName || fbUser.email?.split('@')[0] || 'PlayUp User',
      fbUser.email || ''
    ).catch(err => console.warn('[PlayUp Firebase] Firestore profile sync warning:', err));
  }

  return {
    uid: fbUser.uid,
    email: fbUser.email || '',
    name: fbUser.displayName || fbUser.email?.split('@')[0] || 'PlayUp User',
    avatarUrl: fbUser.photoURL || undefined,
    emailVerified: fbUser.emailVerified,
    idToken,
  };
}

export async function signOutFirebase() {
  const { auth: currentAuth } = ensureFirebaseInitialized();
  if (currentAuth) {
    await signOut(currentAuth);
  }
}

export async function syncWebhookEventIdempotencyToFirestore(record: {
  eventId: string;
  eventType: 'webhook.test' | 'order.delivered' | 'order.refunded' | 'order.failed';
  providerOrderId?: string;
  playupOrderId?: string;
  buyerRef?: string;
  signatureHash: string;
}) {
  const { db: currentDb, auth: currentAuth } = ensureFirebaseInitialized();
  if (!currentDb || !currentAuth?.currentUser || !currentAuth.currentUser.emailVerified) {
    return;
  }

  const sanitizedEventId = String(record.eventId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 128);
  if (!sanitizedEventId) return;

  const docPath = `webhook_events/${sanitizedEventId}`;

  let existsAlready = false;
  try {
    const snap = await getDoc(doc(currentDb, 'webhook_events', sanitizedEventId));
    existsAlready = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  if (existsAlready) return;

  const payload: Record<string, any> = {
    eventId: sanitizedEventId,
    provider: 'rechargegames',
    eventType: record.eventType,
    status: 'processed',
    signatureHash: String(record.signatureHash || 'verified_hmac_sha256')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 128),
    processedAt: serverTimestamp()
  };

  if (record.providerOrderId) {
    payload.providerOrderId = String(record.providerOrderId)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 64);
  }
  if (record.playupOrderId) {
    payload.playupOrderId = String(record.playupOrderId)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 64);
  }
  if (record.buyerRef) {
    payload.buyerRef = String(record.buyerRef)
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 64);
  }

  try {
    await setDoc(doc(currentDb, 'webhook_events', sanitizedEventId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

