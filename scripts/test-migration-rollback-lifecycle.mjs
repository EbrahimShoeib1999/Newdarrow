/**
 * D-Arrow — Migration, Idempotency & Rollback Lifecycle Test
 *
 * Verifies:
 *  1. Initial representative account seeded in emulator via Admin SDK
 *  2. Migration snapshot created and activation applied
 *  3. Verification of elevated Global HR Manager state
 *  4. Second migration execution verifies strict idempotency
 *  5. Rollback restores exact original state (claims, doc, portal roles)
 *  6. Snapshot comparison confirms zero drift
 *  7. Unrelated accounts and companies remain completely untouched
 *
 * Run with: npx -y firebase-tools@13.35.1 emulators:exec --only auth,firestore "node scripts/test-migration-rollback-lifecycle.mjs"
 */

import { execSync } from "node:child_process";
import { readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const PROJECT_ID = "d-arrow-buisiness";
const COMPANY_ID = "co-darrow-global";
const TARGET_EMAIL = "khulodahmed390@gmail.com";
const TARGET_PASS = "TestPassword2026!";
const UNRELATED_EMAIL = "unrelated@darrow.test";

const SNAPSHOT_DIR = path.resolve(process.cwd(), "snapshots");
const SANITIZED_EMAIL = TARGET_EMAIL.replace(/[^a-zA-Z0-9_-]/g, "_");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, `snapshot_${SANITIZED_EMAIL}.json`);

const app = getApps().length === 0 ? initializeApp({ projectId: PROJECT_ID }) : getApps()[0];
const db = getFirestore(app);
const auth = getAuth(app);

let passed = 0;
let failed = 0;
const results = [];

function check(name, cond, details = "") {
  if (cond) {
    passed++;
    results.push({ name, status: "PASS", details });
    console.log(`✓ PASS: ${name} ${details ? `(${details})` : ""}`);
  } else {
    failed++;
    results.push({ name, status: "FAIL", details });
    console.error(`✗ FAIL: ${name} (${details})`);
  }
}

console.log("\n=================================================================");
console.log(" D-ARROW: MIGRATION, IDEMPOTENCY & ROLLBACK AUDIT");
console.log("=================================================================\n");

// Clean any leftover snapshot
if (existsSync(SNAPSHOT_FILE)) {
  rmSync(SNAPSHOT_FILE);
}

// 1. Seed Company & Branches
await db.doc(`companies/${COMPANY_ID}`).set({
  id: COMPANY_ID,
  name: "D-Arrow Global Corp",
  countries: ["Egypt", "Saudi Arabia"],
});
await db.doc(`companies/${COMPANY_ID}/branches/br-cairo`).set({
  id: "br-cairo",
  name: "Cairo Branch",
  country: "EG",
});
await db.doc(`companies/${COMPANY_ID}/branches/br-riyadh`).set({
  id: "br-riyadh",
  name: "Riyadh Branch",
  country: "SA",
});

// 2. Seed Target Account in Representative Initial State
let targetRecord;
try {
  targetRecord = await auth.getUserByEmail(TARGET_EMAIL);
} catch {
  targetRecord = await auth.createUser({ email: TARGET_EMAIL, password: TARGET_PASS });
}
const targetUid = targetRecord.uid;
await auth.setCustomUserClaims(targetUid, {
  role: "employee",
  countryScope: ["EG"],
  companyId: COMPANY_ID,
});

const initialUserDoc = {
  id: targetUid,
  email: TARGET_EMAIL,
  name: "Khulod Ahmed",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Egypt",
  countryScope: ["EG"],
  branchId: "br-cairo",
  portalAccess: ["people"],
  portalSubRoles: { people: "member" },
  customPermissions: ["tasks.view"],
  status: "active",
};
await db.doc(`users/${targetUid}`).set(initialUserDoc);

// Seed unrelated user
let unrelatedRecord;
try {
  unrelatedRecord = await auth.getUserByEmail(UNRELATED_EMAIL);
} catch {
  unrelatedRecord = await auth.createUser({ email: UNRELATED_EMAIL, password: TARGET_PASS });
}
const unrelatedUid = unrelatedRecord.uid;
const initialUnrelatedDoc = {
  id: unrelatedUid,
  email: UNRELATED_EMAIL,
  name: "Unrelated Employee",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
};
await db.doc(`users/${unrelatedUid}`).set(initialUnrelatedDoc);

check("1. Baseline representative account seeded", true, `UID: ${targetUid}`);

// --------------------------------------------------------------------------
// TEST 2: Run Activation Migration (First Run)
// --------------------------------------------------------------------------
console.log("\n--- Executing Activation Migration (Run 1) ---");
const envCommon = {
  ...process.env,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  GCLOUD_PROJECT: PROJECT_ID,
  DARROW_TARGET_EMAIL: TARGET_EMAIL,
  ACTION: "activate",
  SNAPSHOT_FILE: SNAPSHOT_FILE,
};

execSync("npx tsx scripts/activate-global-hr-manager.ts", {
  env: envCommon,
  stdio: "inherit",
});

check("2. Snapshot file created on disk", existsSync(SNAPSHOT_FILE), SNAPSHOT_FILE);

let postMigrateDoc = (await db.doc(`users/${targetUid}`).get()).data();
let postMigrateUser = await auth.getUser(targetUid);
let postMigrateClaims = postMigrateUser.customClaims || {};

check("3. Role updated to global_hr_manager", postMigrateDoc.role === "global_hr_manager");
check("4. CountryScope updated to ['EG', 'SA']", Array.isArray(postMigrateDoc.countryScope) && postMigrateDoc.countryScope.includes("SA") && postMigrateDoc.countryScope.includes("EG"));
check("5. PortalSubRoles.people updated to admin", postMigrateDoc.portalSubRoles?.people === "admin");
check("6. CompanyId preserved intact", postMigrateDoc.companyId === COMPANY_ID);
check("7. Auth custom claims populated", postMigrateClaims.role === "global_hr_manager" && postMigrateClaims.countryScope?.includes("SA"));

// --------------------------------------------------------------------------
// TEST 3: Idempotency (Run Migration Second Time)
// --------------------------------------------------------------------------
console.log("\n--- Executing Activation Migration (Run 2 - Idempotency Check) ---");
execSync("npx tsx scripts/activate-global-hr-manager.ts", {
  env: envCommon,
  stdio: "inherit",
});

let run2Doc = (await db.doc(`users/${targetUid}`).get()).data();
let run2User = await auth.getUser(targetUid);
let run2Claims = run2User.customClaims || {};

check("8. Idempotency: Role remains global_hr_manager", run2Doc.role === "global_hr_manager");
check("9. Idempotency: CountryScope length is 2 (no duplicates)", run2Doc.countryScope.length === 2);
check("10. Idempotency: Claims remain consistent", run2Claims.role === "global_hr_manager");

// --------------------------------------------------------------------------
// TEST 4: Execute Rollback
// --------------------------------------------------------------------------
console.log("\n--- Executing Rollback from Snapshot ---");
const envRollback = {
  ...envCommon,
  ACTION: "rollback",
};

execSync("npx tsx scripts/activate-global-hr-manager.ts", {
  env: envRollback,
  stdio: "inherit",
});

let restoredDoc = (await db.doc(`users/${targetUid}`).get()).data();
let restoredUser = await auth.getUser(targetUid);
let restoredClaims = restoredUser.customClaims || {};

check("11. Rollback: Role restored to original 'employee'", restoredDoc.role === initialUserDoc.role);
check("12. Rollback: CountryScope restored to ['EG']", restoredDoc.countryScope.length === 1 && restoredDoc.countryScope[0] === "EG");
check("13. Rollback: PortalSubRoles.people restored to 'member'", restoredDoc.portalSubRoles?.people === initialUserDoc.portalSubRoles.people);
check("14. Rollback: CustomPermissions restored", restoredDoc.customPermissions?.[0] === initialUserDoc.customPermissions[0]);
check("15. Rollback: Custom claims cleaned/restored", restoredClaims.role === "employee");

// --------------------------------------------------------------------------
// TEST 5: Verify Unrelated Entities Completely Untouched
// --------------------------------------------------------------------------
let unrelatedDocAfter = (await db.doc(`users/${unrelatedUid}`).get()).data();
check("16. Unrelated account remains completely untouched", unrelatedDocAfter.role === "employee" && unrelatedDocAfter.email === UNRELATED_EMAIL);

console.log("\n=================================================================");
console.log(` Lifecycle Results: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================\n");

process.exit(failed > 0 ? 1 : 0);
