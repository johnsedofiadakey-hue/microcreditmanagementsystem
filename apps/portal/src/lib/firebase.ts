'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-susu';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
  projectId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:000000000000:web:0000000000000000',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
};

/** Must match FUNCTIONS_REGION in functions/src/runtime.ts. */
export const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? 'europe-west1';

interface Clients {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
}

let clients: Clients | undefined;

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Callables enforce App Check (API.md §2). The Functions emulator decodes App Check tokens without
 * verifying them, so in emulator mode we hand it an unsigned token naming this app. Never used
 * against a real project: production uses reCAPTCHA Enterprise below.
 */
const emulatorAppCheckProvider = new CustomProvider({
  getToken: async () => {
    const now = Math.floor(Date.now() / 1000);
    const expireTimeMillis = (now + 3600) * 1000;
    const token = [
      base64Url({ alg: 'none', typ: 'JWT' }),
      base64Url({ sub: config.appId, aud: [`projects/${projectId}`], iat: now, exp: now + 3600 }),
      'emulator',
    ].join('.');
    return { token, expireTimeMillis };
  },
});

/** Lazily initialise Firebase in the browser only; the emulators are wired up exactly once. */
export function firebase(): Clients {
  if (clients) return clients;
  if (typeof window === 'undefined') {
    throw new Error('Firebase clients are browser-only in the portal');
  }

  const app = getApps().length ? getApp() : initializeApp(config);

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (useEmulators) {
    initializeAppCheck(app, { provider: emulatorAppCheckProvider, isTokenAutoRefreshEnabled: true });
  } else if (siteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
  }

  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const storage = getStorage(app);

  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
  }

  clients = { app, auth, db, functions, storage };
  return clients;
}

export const usingEmulators = useEmulators;
