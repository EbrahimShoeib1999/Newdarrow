import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

interface GlobalWithProcessEnv {
  process?: {
    env?: Record<string, string | undefined>;
  };
}

const env: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && (import.meta as unknown as ImportMetaWithEnv).env
    ? (import.meta as unknown as ImportMetaWithEnv).env || {}
    : typeof globalThis !== "undefined" && (globalThis as unknown as GlobalWithProcessEnv).process?.env
    ? (globalThis as unknown as GlobalWithProcessEnv).process?.env || {}
    : {};

// Explicit opt-in variable for emulator: VITE_USE_FIREBASE_EMULATORS=true
// Must be strictly "true". Any other value ("false", undefined, empty) disables emulators completely.
// Also supports legacy VITE_USE_FIREBASE_EMULATOR=true for backwards compatibility with test harnesses,
// provided VITE_USE_FIREBASE_EMULATORS is not explicitly set to "false".
const isEmulator =
  env.VITE_USE_FIREBASE_EMULATORS === "true" ||
  (env.VITE_USE_FIREBASE_EMULATOR === "true" && env.VITE_USE_FIREBASE_EMULATORS !== "false");

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || (isEmulator ? "demo-api-key" : ""),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (isEmulator ? "127.0.0.1" : "d-arrow-buisiness.firebaseapp.com"),
  projectId: env.VITE_FIREBASE_PROJECT_ID || (isEmulator ? "demo-darrow-local" : "d-arrow-buisiness"),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || (isEmulator ? "demo-darrow-local.appspot.com" : "d-arrow-buisiness.firebasestorage.app"),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "533873596396",
  appId: env.VITE_FIREBASE_APP_ID || "1:533873596396:web:0e5f17b153928e70e652c9",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const analytics =
  typeof window !== "undefined" && !isEmulator
    ? getAnalytics(app)
    : null;

import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { connectStorageEmulator } from "firebase/storage";

// Opt-in local emulator connection (strictly disabled by default in production)
if (isEmulator) {
  const host = env.VITE_FIREBASE_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099);
  const firestorePort = Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  const storagePort = Number(env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199);

  try {
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, firestorePort);
    connectStorageEmulator(storage, host, storagePort);
    if (typeof window !== "undefined") {
      (window as unknown as { __darrowAuth?: typeof auth }).__darrowAuth = auth;
    }
    console.info(`[Firebase] Connected to local test emulators at ${host}`);
  } catch (err) {
    console.warn("[Firebase] Emulator connection warning:", err);
  }
} else {
  if (typeof window !== "undefined" && import.meta.env?.DEV) {
    console.info(`[Firebase] Connected to Production Project: ${firebaseConfig.projectId}`);
  }
}

export default app;
