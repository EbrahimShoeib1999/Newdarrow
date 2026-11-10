/**
 * D-Arrow — General Manager Activation Script
 * ============================================================
 * Uses Firebase Admin SDK to:
 *   1. Find or create the "DArrow" company in Firestore.
 *   2. Set Khuloud's (khulodahmed390@gmail.com) Firestore profile to
 *      platform_admin with the DArrow companyId.
 *   3. Set her Firebase Auth custom claims: { role: "platform_admin", companyId }.
 *   4. Verify consistency before completing.
 *
 * SAFETY RULES:
 *   - Never deletes any users, employees, companies, or data.
 *   - Never modifies any user OTHER than the target email.
 *   - Creates a snapshot before any change.
 *   - Supports --dry-run to preview without writing.
 *
 * Usage:
 *   # Dry run (read-only preview):
 *   DRY_RUN=true GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/setup-general-manager.ts
 *
 *   # Live run:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/setup-general-manager.ts
 *
 *   # Override DArrow company ID if already known:
 *   DARROW_COMPANY_ID=your-company-id GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/setup-general-manager.ts
 *
 * Requirements:
 *   - Service account with Firestore read/write + Auth admin permissions.
 *   - Or run after: firebase login (uses application default credentials).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const TARGET_EMAIL = process.env.TARGET_EMAIL || process.env.DARROW_TARGET_EMAIL || "khulodahmed390@gmail.com";
// Support scoping: "company" (admin scoped strictly to DArrow) vs "platform" (platform_admin)
const SCOPE = process.env.ROLE_SCOPE || (process.argv.includes("--scope=platform") ? "platform" : (process.argv.includes("--scope=company") ? "company" : (process.env.TARGET_ROLE === "admin" ? "company" : "platform")));
const TARGET_ROLE = (process.env.TARGET_ROLE || (SCOPE === "company" ? "admin" : "platform_admin")) as "platform_admin" | "admin" | "super_admin";
const isPlatformScope = TARGET_ROLE === "platform_admin";
const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
// You can hardcode the DArrow companyId here once you know it from inspect-production.mjs
// or pass it via env: DARROW_COMPANY_ID=your-id
const FORCE_COMPANY_ID: string = process.env.DARROW_COMPANY_ID || "";

const DARROW_COMPANY_NAMES = ["DArrow", "D-Arrow", "d-arrow", "darrow"];
const DARROW_DISPLAY_NAME = "DArrow";

const ALL_PORTAL_IDS = [
  "dashboard", "crm", "tasks", "people", "financial",
  "inventory", "operations", "strategy", "support", "pos", "rem",
];

const SNAPSHOT_DIR = path.join(root, "snapshots");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, `snapshot_general_manager_activation.json`);

async function main() {
  const isEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "d-arrow-buisiness";

  if (!isEmulator && !credentialPath) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  PRODUCTION ACCESS UNAVAILABLE                               ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("  Production access unavailable (No GOOGLE_APPLICATION_CREDENTIALS).");
    console.log("  Local validation can continue.\n");
    console.log("  When ready to execute activation against production:");
    console.log("    $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\\path\\to\\service-account.json'");
    console.log("    npx tsx scripts/setup-general-manager.ts --dry-run");
    console.log("");
    return;
  }

  const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

  const appOptions: Record<string, unknown> = { projectId };
  if (credentialPath) appOptions.credential = applicationDefault();

  const app = getApps().length === 0 ? initializeApp(appOptions) : getApps()[0];
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  D-Arrow — General Manager Activation`);
  console.log(`  Project: ${projectId}`);
  console.log(`  Target:  ${TARGET_EMAIL}`);
  console.log(`  Mode:    ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`${"═".repeat(65)}\n`);

  // ── Step 1: Find target user ────────────────────────────────
  console.log("STEP 1 — Locating target user in Firebase Auth...");
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(TARGET_EMAIL);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      console.error(`❌ User not found in Firebase Auth: ${TARGET_EMAIL}`);
      console.error("   The user must sign up first before activation.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`   ✅ Found: uid = ${userRecord.uid}`);
  console.log(`   Current custom claims: ${JSON.stringify(userRecord.customClaims ?? {})}`);

  // ── Step 2: Read Firestore user profile ─────────────────────
  console.log("\nSTEP 2 — Reading Firestore user profile...");
  const userDocRef = db.collection("users").doc(userRecord.uid);
  const userSnap = await userDocRef.get();

  let currentUserData: Record<string, unknown> = {};
  if (userSnap.exists) {
    currentUserData = userSnap.data() ?? {};
    console.log(`   ✅ Profile found: role = ${currentUserData.role}, companyId = ${currentUserData.companyId || "(empty)"}`);
  } else {
    console.log(`   ⚠️  No Firestore profile exists yet for uid ${userRecord.uid}`);
    console.log(`   A new profile will be created.`);
  }

  // ── Step 3: Resolve DArrow company ID ───────────────────────
  console.log("\nSTEP 3 — Resolving DArrow company...");
  let darrowCompanyId = FORCE_COMPANY_ID || (currentUserData.companyId as string) || "";

  if (!darrowCompanyId) {
    // Search companies collection for a DArrow-matching company
    const companiesSnap = await db.collection("companies").get();
    for (const d of companiesSnap.docs) {
      const name = (d.data().name || d.data().companyName || "") as string;
      const idLower = d.id.toLowerCase().replace(/[\s-_]/g, "");
      const nameLower = name.toLowerCase().replace(/[\s-_]/g, "");
      if (idLower.includes("darrow") || nameLower.includes("darrow")) {
        darrowCompanyId = d.id;
        console.log(`   ✅ Found DArrow company: id = "${darrowCompanyId}", name = "${name}"`);
        break;
      }
    }
  } else {
    console.log(`   ✅ Using company ID: "${darrowCompanyId}"`);
  }

  if (!darrowCompanyId) {
    // No company found — create one
    darrowCompanyId = "darrow";
    console.log(`   ⚠️  No DArrow company found in Firestore.`);
    console.log(`   Will create company with id = "${darrowCompanyId}"`);

    if (!DRY_RUN) {
      const companyRef = db.collection("companies").doc(darrowCompanyId);
      const existing = await companyRef.get();
      if (!existing.exists) {
        await companyRef.set({
          id: darrowCompanyId,
          name: DARROW_DISPLAY_NAME,
          commercialRegister: "",
          defaultCurrency: "SAR",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        console.log(`   ✅ Created company: /companies/${darrowCompanyId}`);
      } else {
        console.log(`   ✅ Company /companies/${darrowCompanyId} already exists.`);
      }
    } else {
      console.log(`   [DRY RUN] Would create /companies/${darrowCompanyId}`);
    }
  }

  // ── Step 4: Prepare new state ───────────────────────────────
  console.log("\nSTEP 4 — Preparing activation payload...");

  const newClaims = {
    ...(userRecord.customClaims ?? {}),
    role: TARGET_ROLE,
    admin: true,
    globalAccess: isPlatformScope,
    companyId: darrowCompanyId,
  };

  const newFirestoreDoc: Record<string, unknown> = {
    ...currentUserData,
    id: userRecord.uid,
    email: TARGET_EMAIL,
    name: (currentUserData.name as string) || userRecord.displayName || "Khuloud",
    nameAr: (currentUserData.nameAr as string) || "خلود",
    role: TARGET_ROLE,
    companyId: darrowCompanyId,
    companyName: DARROW_DISPLAY_NAME,
    countryScope: Array.from(new Set([
      "EG", "SA",
      ...((Array.isArray(currentUserData.countryScope) ? currentUserData.countryScope : []) as string[]),
    ])),
    portalAccess: ALL_PORTAL_IDS,
    portalSubRoles: {
      tasks: "admin",
      crm: "admin",
      people: "admin",
      billing: "admin",
    },
    updatedAt: new Date().toISOString(),
  };

  if (!currentUserData.createdAt) {
    newFirestoreDoc.createdAt = new Date().toISOString();
  }

  if (DRY_RUN) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║  DRY RUN — No changes will be made                           ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("\n  Custom Claims to set:");
    console.log(JSON.stringify(newClaims, null, 4));
    console.log("\n  Firestore /users/" + userRecord.uid + " to set:");
    console.log(JSON.stringify(newFirestoreDoc, null, 4));
    console.log("\n  To execute for real, remove DRY_RUN=true from the command.");
    return;
  }

  // ── Step 5: Create snapshot ─────────────────────────────────
  console.log("\nSTEP 5 — Saving pre-activation snapshot...");
  const snapshot = {
    snapshotVersion: 1,
    capturedAt: new Date().toISOString(),
    targetEmail: TARGET_EMAIL,
    uid: userRecord.uid,
    originalCompanyId: currentUserData.companyId || "",
    originalClaims: userRecord.customClaims ?? {},
    originalFirestoreDoc: currentUserData,
  };
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), { encoding: "utf-8", mode: 0o600 });
  console.log(`   ✅ Snapshot saved: ${SNAPSHOT_FILE}`);

  // ── Step 6: Apply claims ────────────────────────────────────
  console.log("\nSTEP 6 — Setting custom claims...");
  await auth.setCustomUserClaims(userRecord.uid, newClaims);
  console.log(`   ✅ Claims set: ${JSON.stringify(newClaims)}`);

  // ── Step 7: Apply Firestore update ──────────────────────────
  console.log("\nSTEP 7 — Updating Firestore user profile...");
  await userDocRef.set(newFirestoreDoc, { merge: true });
  console.log(`   ✅ Firestore /users/${userRecord.uid} updated`);

  // ── Step 8: Verify ───────────────────────────────────────────
  console.log("\nSTEP 8 — Verifying...");
  const verifiedUser = await auth.getUser(userRecord.uid);
  const verifiedDoc = (await userDocRef.get()).data() ?? {};
  const claimsOk = (verifiedUser.customClaims as Record<string, unknown>)?.role === TARGET_ROLE;
  const docOk = verifiedDoc.role === TARGET_ROLE && verifiedDoc.companyId === darrowCompanyId;

  if (!claimsOk || !docOk) {
    throw new Error(`Verification failed: claimsOk=${claimsOk}, docOk=${docOk}`);
  }

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  ✅ ACTIVATION COMPLETE`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  UID:         ${userRecord.uid}`);
  console.log(`  Email:       ${TARGET_EMAIL}`);
  console.log(`  Role:        ${TARGET_ROLE} (General Manager)`);
  console.log(`  Company ID:  ${darrowCompanyId}`);
  console.log(`  Portals:     ${ALL_PORTAL_IDS.length} portals`);
  console.log(`  Snapshot:    ${SNAPSHOT_FILE}`);
  console.log(`\n  ⚠️  The user must SIGN OUT and SIGN IN again for custom claims`);
  console.log(`     to take effect in the browser JWT.`);
  console.log(`${"═".repeat(65)}\n`);
}

main().catch((err) => {
  console.error("\n❌ Script failed:", err?.message || err);
  process.exitCode = 1;
});

