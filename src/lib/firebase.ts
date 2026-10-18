import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

const env: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : typeof globalThis !== "undefined" && (globalThis as any).process?.env
    ? (globalThis as any).process.env
    : {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "mock-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "mock-project.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "d-arrow-buisiness",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "mock-project.appspot.com",
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
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;

import { connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { connectStorageEmulator } from "firebase/storage";

// Opt-in local emulator connection (strictly disabled by default in production)
if (env.VITE_USE_FIREBASE_EMULATOR === "true") {
  const host = env.VITE_FIREBASE_EMULATOR_HOST || "127.0.0.1";
  const authPort = Number(env.VITE_FIREBASE_AUTH_EMULATOR_PORT || 9099);
  const firestorePort = Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080);
  const storagePort = Number(env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || 9199);

  try {
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, firestorePort);
    connectStorageEmulator(storage, host, storagePort);
    console.info(`[Firebase] Connected to local test emulators at ${host}`);
  } catch (err) {
    console.warn("[Firebase] Emulator connection warning:", err);
  }
}

export default app;
