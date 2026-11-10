/**
 * Verification Script: Firebase Environment & Connection Mode
 * ============================================================
 * Verifies that:
 * 1. Default / local config connects directly to Production (d-arrow-buisiness).
 * 2. Emulators are strictly NOT triggered when VITE_USE_FIREBASE_EMULATORS=false.
 * 3. All production configuration keys are loaded without placeholders.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  const env = {};
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
  } catch {
    // ignore
  }
  return env;
}

const root = process.cwd();
const envBase = loadEnvFile(resolve(root, ".env"));
const envLocal = loadEnvFile(resolve(root, ".env.local"));

// Simulate Vite env cascade: .env.local overrides .env
const mergedEnv = { ...envBase, ...envLocal };

console.log("\n============================================================");
console.log(" FIREBASE CONFIGURATION & EMULATOR TOGGLE VERIFICATION");
console.log("============================================================\n");

// 1. Check Emulator Toggle
const explicitToggle = mergedEnv.VITE_USE_FIREBASE_EMULATORS;
const legacyToggle = mergedEnv.VITE_USE_FIREBASE_EMULATOR;

console.log(`[Config Check] VITE_USE_FIREBASE_EMULATORS: "${explicitToggle}"`);
console.log(`[Config Check] VITE_USE_FIREBASE_EMULATOR:  "${legacyToggle}"`);

const isEmulator =
  explicitToggle === "true" ||
  (legacyToggle === "true" && explicitToggle !== "false");

console.log(`[Resolution]   isEmulator evaluated to:    ${isEmulator}`);

if (isEmulator) {
  console.error("❌ FAILED: Emulator is still enabled in local configuration!");
  process.exit(1);
} else {
  console.log("✓ PASS: Emulator is strictly DISABLED for local frontend execution.");
}

// 2. Check Project ID and Endpoints
const projectId = mergedEnv.VITE_FIREBASE_PROJECT_ID;
const authDomain = mergedEnv.VITE_FIREBASE_AUTH_DOMAIN;
const storageBucket = mergedEnv.VITE_FIREBASE_STORAGE_BUCKET;

console.log(`\n[Target Project] ID:          ${projectId}`);
console.log(`[Target Auth]    Domain:      ${authDomain}`);
console.log(`[Target Storage] Bucket:      ${storageBucket}`);

if (projectId !== "d-arrow-buisiness") {
  console.error(`❌ FAILED: Expected project ID 'd-arrow-buisiness', found '${projectId}'`);
  process.exit(1);
} else {
  console.log("✓ PASS: Correct Firebase Production Project ID (d-arrow-buisiness).");
}

if (!authDomain.includes("d-arrow-buisiness")) {
  console.error("❌ FAILED: Auth domain does not point to d-arrow-buisiness production");
  process.exit(1);
} else {
  console.log("✓ PASS: Auth domain points to official Firebase Production domain.");
}

// 3. Check API Key presence (safe check, no secret printed)
const apiKey = mergedEnv.VITE_FIREBASE_API_KEY;
if (!apiKey || apiKey === "mock-api-key" || apiKey === "demo-api-key") {
  console.error("❌ FAILED: Real Firebase API Key is missing or using placeholder!");
  process.exit(1);
} else {
  console.log(`✓ PASS: Real Firebase API Key is configured (length: ${apiKey.length} chars).`);
}

console.log("\n============================================================");
console.log(" ALL ENVIRONMENT CHECKS PASSED — READY FOR PRODUCTION CONNECT");
console.log("============================================================\n");

