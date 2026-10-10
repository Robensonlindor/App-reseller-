import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  browserPopupRedirectResolver,
  signOut as fbSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const firebaseFirestore = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

export interface GoogleSignInResult {
  uid: string;
  email: string;
  name: string;
  avatarUrl?: string;
  idToken?: string;
  accessToken?: string;
}

declare global {
  interface Window {
    google?: any;
  }
}

function loadGoogleIdentityServicesScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Environnement navigateur requis.'));
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existingScript = document.getElementById('google-gsi-client-script') as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Impossible de charger Google Identity Services.')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-client-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Impossible de charger le script Google OAuth.'));
    document.head.appendChild(script);
  });
}

async function signInWithGoogleIdentityServicesFallback(): Promise<GoogleSignInResult> {
  const clientId = (firebaseConfig as any).oAuthClientId;
  if (!clientId) {
    throw new Error('Aucun oAuthClientId configuré dans firebase-applet-config.json.');
  }
  await loadGoogleIdentityServicesScript();
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services indisponible dans ce navigateur.');
  }

  return new Promise<GoogleSignInResult>((resolve, reject) => {
    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        prompt: 'select_account',
        callback: async (tokenResponse: any) => {
          if (tokenResponse?.error) {
            reject(new Error(tokenResponse.error_description || tokenResponse.error || 'Connexion Google annulée.'));
            return;
          }
          const accessToken = tokenResponse?.access_token;
          if (!accessToken) {
            reject(new Error('Jeton d’accès Google manquant.'));
            return;
          }
          try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (!resp.ok) {
              throw new Error('Impossible de récupérer le profil Google vérifié.');
            }
            const profile = await resp.json();
            if (!profile?.email) {
              throw new Error('Aucune adresse email renvoyée par Google.');
            }
            resolve({
              uid: String(profile.sub || profile.email),
              email: String(profile.email).trim().toLowerCase(),
              name: String(profile.name || profile.given_name || profile.email.split('@')[0]),
              avatarUrl: profile.picture || undefined,
              accessToken
            });
          } catch (fetchErr: any) {
            reject(fetchErr);
          }
        },
        error_callback: (err: any) => {
          if (err?.type === 'popup_closed') {
            reject(new Error('La fenêtre de connexion Google a été fermée avant la validation.'));
          } else if (err?.type === 'popup_failed_to_open') {
            reject(new Error('Le navigateur a bloqué la fenêtre popup Google. Autorisez les popups pour ce site.'));
          } else {
            reject(new Error(err?.message || 'Erreur lors de l’ouverture de Google OAuth.'));
          }
        }
      });

      tokenClient.requestAccessToken();
    } catch (e: any) {
      reject(e);
    }
  });
}

export async function consumeGoogleRedirectResult(): Promise<GoogleSignInResult | null> {
  try {
    const result = await getRedirectResult(firebaseAuth);
    if (!result || !result.user || !result.user.email) {
      return null;
    }
    const user = result.user;
    const idToken = await user.getIdToken();
    return {
      uid: user.uid,
      email: user.email!.trim().toLowerCase(),
      name: user.displayName || user.email!.split('@')[0],
      avatarUrl: user.photoURL || undefined,
      idToken
    };
  } catch {
    return null;
  }
}

export async function signInWithGooglePopup(): Promise<GoogleSignInResult> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase Auth non configuré.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver);
    const user = result.user;
    if (!user.email) {
      throw new Error('Aucune adresse email associée à ce compte Google.');
    }
    const idToken = await user.getIdToken();

    return {
      uid: user.uid,
      email: user.email.trim().toLowerCase(),
      name: user.displayName || user.email.split('@')[0],
      avatarUrl: user.photoURL || undefined,
      idToken
    };
  } catch (err: any) {
    const code = String(err?.code || '');
    const currentDomain = typeof window !== 'undefined' ? window.location.hostname : '';

    // User explicitly closed the popup
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Connexion Google annulée : la fenêtre a été fermée.');
    }

    // If Firebase Auth domain isn't yet authorized or popup resolver failed, try Google Identity Services OAuth2 client
    if (
      code === 'auth/unauthorized-domain' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/popup-blocked' ||
      code === 'auth/CancelledPopupRequest' ||
      code === 'auth/cancelled-popup-request' ||
      code === 'auth/internal-error'
    ) {
      try {
        return await signInWithGoogleIdentityServicesFallback();
      } catch (gisErr: any) {
        if (code === 'auth/unauthorized-domain') {
          throw new Error(
            `Domaine non autorisé dans Firebase Auth (${currentDomain}). Ajoutez "${currentDomain}" dans Firebase Console > Authentication > Settings > Authorized domains (projet ${firebaseConfig.projectId}).`
          );
        }
        if (code === 'auth/popup-blocked') {
          await signInWithRedirect(firebaseAuth, provider);
          throw new Error('Redirection vers Google OAuth en cours...');
        }
        throw new Error(gisErr?.message || err?.message || 'Erreur lors de la connexion Google.');
      }
    }

    throw new Error(err?.message || 'Impossible de se connecter avec Google.');
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await fbSignOut(firebaseAuth);
  } catch {
    // Ignore if not signed into firebase
  }
}

export function subscribeToFirebaseAuth(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(firebaseAuth, callback);
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig &&
      firebaseConfig.apiKey &&
      firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
      !firebaseConfig.apiKey.includes('placeholder') &&
      firebaseConfig.projectId
  );
}

export async function syncWebhookEventIdempotencyToFirestore(record: {
  eventId: string;
  eventType?: string;
  status?: string;
  processedAt?: string;
  payloadHash?: string;
  providerOrderId?: string;
  playupOrderId?: string;
  buyerRef?: string;
}): Promise<boolean> {
  if (!record?.eventId || !isFirebaseConfigured()) return false;
  try {
    const safeId = String(record.eventId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const ref = doc(firebaseFirestore, 'webhook_events', safeId);
    await setDoc(
      ref,
      {
        eventId: String(record.eventId),
        eventType: String(record.eventType || 'order.updated'),
        status: String(record.status || 'processed'),
        processedAt: String(record.processedAt || new Date().toISOString()),
        payloadHash: String(record.payloadHash || ''),
        ...(record.providerOrderId ? { providerOrderId: String(record.providerOrderId) } : {}),
        ...(record.playupOrderId ? { playupOrderId: String(record.playupOrderId) } : {}),
        ...(record.buyerRef ? { buyerRef: String(record.buyerRef) } : {})
      },
      { merge: true }
    );
    return true;
  } catch {
    return false;
  }
}

