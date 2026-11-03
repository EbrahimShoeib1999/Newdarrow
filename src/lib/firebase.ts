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

const isEmulator = env.VITE_USE_FIREBASE_EMULATOR === "true";

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || (isEmulator ? "demo-api-key" : "mock-api-key"),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || (isEmulator ? "127.0.0.1" : "mock-project.firebaseapp.com"),
  projectId: env.VITE_FIREBASE_PROJECT_ID || (isEmulator ? "demo-darrow-local" : "d-arrow-buisiness"),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || (isEmulator ? "demo-darrow-local.appspot.com" : "mock-project.appspot.com"),
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: env.VITE_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
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
}

export default app;
