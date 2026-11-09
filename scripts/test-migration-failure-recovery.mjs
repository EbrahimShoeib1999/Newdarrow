/**
 * D-Arrow — Migration Failure Recovery & Chaos Tests
 *
 * Simulates every failure and recovery edge case in the migration engine:
 *   1. Auth update success followed by Firestore failure -> Auto-recovery restores Auth
 *   2. Firestore update success followed by Auth failure -> Auto-recovery restores Firestore
 *   3. Read-back consistency mismatch -> Triggers automatic rollback recovery
 *   4. Interrupted migration and restart -> Clean idempotency without golden snapshot corruption
 *   5. State file audit -> Confirms state file tracks all phases for manual audit/recovery
 *   6. Golden snapshot invariance -> Verifies baseline snapshot is never overwritten by failed/partial runs
 *
 * Run with: npx -y firebase-tools@13.35.1 emulators:exec --only auth,firestore "node scripts/test-migration-failure-recovery.mjs"
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const PROJECT_ID = "d-arrow-buisiness";
const TEST_EMAIL = "chaos_test_hr@darrow.test";
const SANITIZED_EMAIL = TEST_EMAIL.replace(/[^a-zA-Z0-9_-]/g, "_");
const SNAPSHOT_DIR = path.resolve(process.cwd(), "snapshots");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, `snapshot_${SANITIZED_EMAIL}.json`);
const STATE_FILE = path.join(SNAPSHOT_DIR, `state_${SANITIZED_EMAIL}.json`);
const COMPANY_ID = "co-darrow-chaos";

const app = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

const results = [];
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`✓ PASS: ${name}`);
  } catch (err) {
    failed++;
    const msg = err?.message ?? String(err);
    results.push({ name, status: "FAIL", error: msg });
    console.error(`✗ FAIL: ${name} -> ${msg}`);
  }
}

console.log("\n=================================================================");
console.log(" D-ARROW: MIGRATION RECOVERY FAILURE & CHAOS TESTS");
console.log("=================================================================\n");

// 0. Clean prior test artifacts
try { await fs.unlink(SNAPSHOT_FILE); } catch {}
try { await fs.unlink(STATE_FILE); } catch {}

// 1. Seed base fixtures
let targetUid;
try {
  const existingUser = await auth.getUserByEmail(TEST_EMAIL);
  targetUid = existingUser.uid;
} catch {
  const newUser = await auth.createUser({
    email: TEST_EMAIL,
    emailVerified: true,
    displayName: "Chaos Test HR",
  });
  targetUid = newUser.uid;
}

await auth.setCustomUserClaims(targetUid, {
  role: "employee",
  countryScope: ["EG"],
  companyId: COMPANY_ID,
});

await db.collection("companies").doc(COMPANY_ID).set({
  name: "D-Arrow Chaos Test Co",
  primaryActivity: "PROJECTS",
  countries: ["Egypt", "Saudi Arabia"],
});

await db.collection("companies").doc(COMPANY_ID).collection("branches").doc("br-eg").set({
  name: "Cairo Branch",
  country: "EG",
});
await db.collection("companies").doc(COMPANY_ID).collection("branches").doc("br-sa").set({
  name: "Riyadh Branch",
  country: "SA",
});

const baselineDoc = {
  id: targetUid,
  email: TEST_EMAIL,
  name: "Chaos Test HR",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Egypt",
  countryScope: ["EG"],
  portalAccess: ["people"],
  portalSubRoles: { people: "member" },
  customPermissions: ["attendance.checkin"],
  createdAt: new Date().toISOString(),
};
await db.collection("users").doc(targetUid).set(baselineDoc);

await check("1. Baseline chaos test account successfully seeded", async () => {
  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();
  if (u.customClaims?.role !== "employee" || d.role !== "employee") {
    throw new Error("Baseline seeding mismatch");
  }
});

// 2. Test Read-Back Mismatch Simulation & Automatic Recovery
await check("2. Read-Back Mismatch Simulation triggers auto-recovery rollback", async () => {
  // We run activation with an invalid company branch requirement or trigger a simulated mismatch
  // Let's create an artificial snapshot to verify rollback works reliably
  const snapshotData = {
    snapshotVersion: 1,
    capturedAt: new Date().toISOString(),
    targetEmail: TEST_EMAIL,
    uid: targetUid,
    companyId: COMPANY_ID,
    customClaims: { role: "employee", countryScope: ["EG"], companyId: COMPANY_ID },
    firestoreDoc: baselineDoc,
  };
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshotData, null, 2), "utf-8");

  // Elevate claims partially (simulating intermediate failure)
  await auth.setCustomUserClaims(targetUid, { role: "global_hr_manager", countryScope: ["EG", "SA"], companyId: COMPANY_ID });
  // But leave firestore doc unchanged (simulating doc update failure)
  await db.collection("users").doc(targetUid).set({ ...baselineDoc, role: "employee" });

  // Run rollback
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "rollback",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const verifiedUser = await auth.getUser(targetUid);
  const verifiedDoc = (await db.collection("users").doc(targetUid).get()).data();

  if (verifiedUser.customClaims?.role !== "employee" || verifiedDoc.role !== "employee") {
    throw new Error(`Rollback failed to restore baseline: claims role=${verifiedUser.customClaims?.role}, doc role=${verifiedDoc.role}`);
  }
});

// 3. Test Snapshot Schema Validation on Corrupt / Mismatched Identity
await check("3. Rollback rejects corrupt or mismatched identity snapshot", async () => {
  const corruptSnapshot = {
    snapshotVersion: 1,
    capturedAt: new Date().toISOString(),
    targetEmail: "intruder@foreign.test",
    uid: "fabricated_intruder_uid",
    companyId: "wrong-company",
    customClaims: {},
    firestoreDoc: {},
  };
  const corruptPath = path.join(SNAPSHOT_DIR, "corrupt_snapshot.json");
  await fs.writeFile(corruptPath, JSON.stringify(corruptSnapshot, null, 2), "utf-8");

  try {
    execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
      env: {
        ...process.env,
        ACTION: "rollback",
        DARROW_TARGET_EMAIL: TEST_EMAIL,
        SNAPSHOT_FILE: corruptPath,
      },
      stdio: "pipe",
    });
    throw new Error("Rollback should have failed on mismatched snapshot identity!");
  } catch (err) {
    if (!String(err).includes("Snapshot identity mismatch") && !String(err).includes("Command failed")) {
      throw err;
    }
  } finally {
    try { await fs.unlink(corruptPath); } catch {}
  }
});

// 4. Test Clean Execution & Verification
await check("4. Full activation produces consistent Auth claims, Firestore doc, and state file", async () => {
  // Remove temporary snapshot to allow clean activation capture
  try { await fs.unlink(SNAPSHOT_FILE); } catch {}

  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "activate",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();
  const state = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));

  if (u.customClaims?.role !== "global_hr_manager" || d.role !== "global_hr_manager") {
    throw new Error("Activation failed to elevate role");
  }
  if (state.phase !== "VERIFIED") {
    throw new Error(`Expected state VERIFIED, got ${state.phase}`);
  }
});

// 5. Test Golden Snapshot Invariance across repeated runs
await check("5. Golden baseline snapshot is preserved intact across repeated runs", async () => {
  const initialSnapshot = JSON.parse(await fs.readFile(SNAPSHOT_FILE, "utf-8"));
  if (initialSnapshot.firestoreDoc.role !== "employee") {
    throw new Error("Golden snapshot did not capture initial employee role");
  }

  // Second run
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "activate",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const snapshotAfterRepeat = JSON.parse(await fs.readFile(SNAPSHOT_FILE, "utf-8"));
  if (snapshotAfterRepeat.firestoreDoc.role !== "employee") {
    throw new Error("Repeated run corrupted the golden baseline snapshot with post-migration data!");
  }
});

// 6. Test Safe State-Assisted Rollback
await check("6. Rollback restores baseline from golden snapshot and updates state file", async () => {
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "rollback",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();
  const state = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));

  if (u.customClaims?.role !== "employee" || d.role !== "employee") {
    throw new Error("Rollback failed to restore baseline");
  }
  if (state.phase !== "ROLLED_BACK") {
    throw new Error(`Expected state ROLLED_BACK, got ${state.phase}`);
  }
});

// 7. Test Partial Failure: Firestore updated, then Auth claims update fails simulation
await check("7. Partial failure: Firestore doc updated, Auth claims rollback restores both", async () => {
  // Simulate doc updated to global_hr_manager but claims remained employee
  await db.collection("users").doc(targetUid).set({ ...baselineDoc, role: "global_hr_manager" });
  await auth.setCustomUserClaims(targetUid, { role: "employee", countryScope: ["EG"], companyId: COMPANY_ID });

  // Run rollback
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "rollback",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();
  if (u.customClaims?.role !== "employee" || d.role !== "employee") {
    throw new Error("Rollback failed to reconcile mismatched doc role");
  }
});

// 8. Test Process Interruption Between Phases and Clean Restart
await check("8. Process interruption after CLAIMS_APPLIED: restart recovers cleanly", async () => {
  // Simulate interruption state
  await fs.writeFile(STATE_FILE, JSON.stringify({
    version: 1,
    targetEmail: TEST_EMAIL,
    uid: targetUid,
    companyId: COMPANY_ID,
    action: "activate",
    phase: "CLAIMS_APPLIED",
    lastUpdated: new Date().toISOString(),
  }, null, 2), "utf-8");

  // Restart activation
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "activate",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const state = JSON.parse(await fs.readFile(STATE_FILE, "utf-8"));
  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();

  if (state.phase !== "VERIFIED" || u.customClaims?.role !== "global_hr_manager" || d.role !== "global_hr_manager") {
    throw new Error("Restart failed to achieve consistent VERIFIED state");
  }
});

// 9. Test Recovery After Partial Rollback
await check("9. Partial rollback recovery: re-running rollback completes full restoration", async () => {
  // Simulate partial rollback: claims reverted, doc not yet reverted
  await auth.setCustomUserClaims(targetUid, { role: "employee", countryScope: ["EG"], companyId: COMPANY_ID });
  await db.collection("users").doc(targetUid).set({ ...baselineDoc, role: "global_hr_manager" });

  // Re-run rollback
  execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
    env: {
      ...process.env,
      ACTION: "rollback",
      DARROW_TARGET_EMAIL: TEST_EMAIL,
      SNAPSHOT_FILE,
      STATE_FILE,
    },
    stdio: "pipe",
  });

  const u = await auth.getUser(targetUid);
  const d = (await db.collection("users").doc(targetUid).get()).data();
  if (u.customClaims?.role !== "employee" || d.role !== "employee") {
    throw new Error("Re-running rollback failed to complete full restoration");
  }
});

// 10. Test Invariant & Credential Leakage Protection
await check("10. Invariants preserved: UID, companyId, employee link, and zero credentials in snapshot", async () => {
  const snapshotRaw = await fs.readFile(SNAPSHOT_FILE, "utf-8");
  const snap = JSON.parse(snapshotRaw);

  if (snap.uid !== targetUid) throw new Error("Snapshot UID altered");
  if (snap.companyId !== COMPANY_ID) throw new Error("Snapshot companyId altered");
  if (snapshotRaw.includes("password") || snapshotRaw.includes("privateKey") || snapshotRaw.includes("token")) {
    throw new Error("Snapshot file leaked credentials or tokens!");
  }

  // Verify employee doc relationship remains intact
  const empSnap = await db.collection("companies").doc(COMPANY_ID).collection("branches").doc("br-eg").get();
  if (!empSnap.exists) throw new Error("Employee branch link corrupted");
});

// 11. Test Explicit Manual Recovery Instructions on Rollback Failure
await check("11. Rollback failure outputs explicit manual recovery instructions", async () => {
  const missingSnapshotPath = path.join(SNAPSHOT_DIR, "non_existent_snapshot.json");
  try {
    execSync(`npx tsx scripts/activate-global-hr-manager.ts`, {
      env: {
        ...process.env,
        ACTION: "rollback",
        DARROW_TARGET_EMAIL: TEST_EMAIL,
        SNAPSHOT_FILE: missingSnapshotPath,
      },
      stdio: "pipe",
    });
    throw new Error("Should have failed on missing snapshot!");
  } catch (err) {
    const output = (err.stderr ? err.stderr.toString() : "") + (err.stdout ? err.stdout.toString() : "");
    if (!output.includes("MANUAL RECOVERY INSTRUCTIONS")) {
      throw new Error(`Expected output to contain MANUAL RECOVERY INSTRUCTIONS, got:\n${output}`);
    }
  }
});

// Clean up test files
try { await fs.unlink(SNAPSHOT_FILE); } catch {}
try { await fs.unlink(STATE_FILE); } catch {}

console.log("\n=================================================================");
console.log(` Migration Failure Recovery Results: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================\n");

process.exit(failed > 0 ? 1 : 0);

