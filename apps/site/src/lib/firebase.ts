'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-susu';
const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '1:000000000000:web:0000000000000000';

/** Must match FUNCTIONS_REGION in functions/src/runtime.ts. */
const FUNCTIONS_REGION = process.env.NEXT_PUBLIC_FUNCTIONS_REGION ?? 'europe-west1';

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** The Functions emulator decodes App Check tokens without verifying them; never used against a real project. */
const emulatorAppCheckProvider = new CustomProvider({
  getToken: async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = [
      base64Url({ alg: 'none', typ: 'JWT' }),
      base64Url({ sub: appId, aud: [`projects/${projectId}`], iat: now, exp: now + 3600 }),
      'emulator',
    ].join('.');
    return { token, expireTimeMillis: (now + 3600) * 1000 };
  },
});

let functions: Functions | undefined;

/** The site's only backend: callable functions (submitEnquiry). Browser-only, created on first use. */
export function siteFunctions(): Functions {
  if (functions) return functions;
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
        appId,
      });

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (useEmulators) initializeAppCheck(app, { provider: emulatorAppCheckProvider, isTokenAutoRefreshEnabled: true });
  else if (siteKey) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });

  functions = getFunctions(app, FUNCTIONS_REGION);
  if (useEmulators) connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  return functions;
}
