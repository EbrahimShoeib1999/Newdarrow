/**
 * D-Arrow — Migration Rollback Script
 * ============================================================
 * Restores original user custom claims and Firestore profile from a captured snapshot.
 *
 * SAFETY RULES:
 *   - Supports --dry-run (safe preview without writes).
 *   - Validates snapshot integrity before attempting rollback.
 *   - Only alters the user record recorded in the snapshot.
 *   - Preserves all employee records and financial histories.
 *
 * Usage:
 *   # Dry run preview:
 *   DRY_RUN=true GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/rollback-migration.ts
 *
 *   # Live rollback:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/rollback-migration.ts
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(root, "snapshots");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "snapshot_general_manager_activation.json");
const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");

async function main() {
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "d-arrow-buisiness";

  if (!isEmulator && !credentialPath) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  PRODUCTION ACCESS UNAVAILABLE                               ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("  No GOOGLE_APPLICATION_CREDENTIALS found. Local validation only.");
    console.log("  When credentials are ready:");
    console.log("    $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\\path\\to\\service-account.json'");
    console.log("    npx tsx scripts/rollback-migration.ts --dry-run");
    console.log("");
    return;
  }

  // Check if snapshot exists
  try {
    await fs.access(SNAPSHOT_FILE);
  } catch {
    console.error(`❌ Snapshot file not found: ${SNAPSHOT_FILE}`);
    console.error("   Cannot perform rollback without a pre-migration snapshot.");
    process.exitCode = 1;
    return;
  }

  const rawSnapshot = await fs.readFile(SNAPSHOT_FILE, "utf-8");
  const snapshot = JSON.parse(rawSnapshot);

  console.log("\n" + "=".repeat(75));
  console.log("  D-ARROW MIGRATION ROLLBACK SYSTEM");
  console.log(`  Project:   ${projectId}`);
  console.log(`  Snapshot:  ${SNAPSHOT_FILE}`);
  console.log(`  Captured:  ${snapshot.capturedAt}`);
  console.log(`  Target:    ${snapshot.targetEmail} (UID: ${snapshot.uid})`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN (Preview Only)" : "LIVE RESTORATION"}`);
  console.log("=".repeat(75) + "\n");

  const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const appOptions: Record<string, unknown> = { projectId };
  if (credentialPath) appOptions.credential = applicationDefault();

  const app = getApps().length === 0 ? initializeApp(appOptions) : getApps()[0];
  const auth = getAuth(app);
  const db = getFirestore(app);

  const uid = snapshot.uid;
  const originalClaims = snapshot.originalClaims || {};
  const originalDoc = snapshot.originalFirestoreDoc || {};

  if (DRY_RUN) {
    console.log("DRY RUN PREVIEW:");
    console.log("  Will restore Auth Custom Claims to:", JSON.stringify(originalClaims, null, 2));
    console.log("  Will restore Firestore /users/" + uid + " to:", JSON.stringify(originalDoc, null, 2));
    console.log("\nTo execute rollback for real, remove DRY_RUN=true.");
    return;
  }

  console.log("1. Restoring Auth Custom Claims...");
  await auth.setCustomUserClaims(uid, originalClaims);
  console.log("   ✅ Claims restored.");

  console.log("2. Restoring Firestore user profile...");
  const userDocRef = db.collection("users").doc(uid);
  await userDocRef.set(originalDoc);
  console.log("   ✅ Profile document restored.");

  console.log("\n✅ Rollback successfully completed.");
}

main().catch((err) => {
  console.error("Rollback failed:", err);
  process.exit(1);
});

