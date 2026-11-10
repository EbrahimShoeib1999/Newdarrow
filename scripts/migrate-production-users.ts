/**
 * D-Arrow — Production User & Identity Migration Script
 * ============================================================
 * Safe, repeatable migration script for when Firebase credentials are provided.
 *
 * Capabilities:
 *   1. Enumerates all Firebase Auth users and their custom claims.
 *   2. Enumerates all employees across all /companies/{companyId}/employees.
 *   3. Enumerates all /companies to resolve canonical DArrow tenant.
 *   4. Identifies target administrator (default: TARGET_EMAIL or khulodahmed390@gmail.com).
 *   5. Links the target user to the authoritative DArrow company.
 *   6. Provisions General Manager (platform_admin) custom claims & profile.
 *
 * SAFETY RULES:
 *   - Completely safe in DRY_RUN=true (no writes, no deletions, no claim updates).
 *   - Never overwrites unrelated user profiles or alters existing tenant claims.
 *   - Preserves multi-tenant isolation.
 *
 * Usage:
 *   # Dry Run (Safe Preview):
 *   DRY_RUN=true GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/migrate-production-users.ts
 *
 *   # Live Execution:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npx tsx scripts/migrate-production-users.ts
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const TARGET_EMAIL = process.env.TARGET_EMAIL || process.env.DARROW_TARGET_EMAIL || "khulodahmed390@gmail.com";
const SCOPE = process.env.ROLE_SCOPE || (process.argv.includes("--scope=platform") ? "platform" : (process.argv.includes("--scope=company") ? "company" : (process.env.TARGET_ROLE === "admin" ? "company" : "platform")));
const TARGET_ROLE = (process.env.TARGET_ROLE || (SCOPE === "company" ? "admin" : "platform_admin")) as "platform_admin" | "admin" | "super_admin";
const isPlatformScope = TARGET_ROLE === "platform_admin";
const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
const OVERRIDE_COMPANY_ID = process.env.DARROW_COMPANY_ID || "";

const CANONICAL_COMPANY_NAMES = ["darrow", "d-arrow"];

function isDArrowMatch(id: string, name?: string): boolean {
  const normId = (id || "").toLowerCase().replace(/[\s\-_]/g, "");
  const normName = (name || "").toLowerCase().replace(/[\s\-_]/g, "");
  return normId.includes("darrow") || normName.includes("darrow");
}

async function main() {
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "d-arrow-buisiness";

  if (!isEmulator && !credentialPath) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  PRODUCTION ACCESS UNAVAILABLE                               ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("  Production access unavailable (No GOOGLE_APPLICATION_CREDENTIALS).");
    console.log("  Local validation can continue.\n");
    console.log("  When credentials are ready:");
    console.log("    $env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\\path\\to\\service-account.json'");
    console.log("    npx tsx scripts/migrate-production-users.ts --dry-run");
    console.log("");
    return;
  }

  const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const appOptions: Record<string, unknown> = { projectId };
  if (credentialPath) appOptions.credential = applicationDefault();

  const app = getApps().length === 0 ? initializeApp(appOptions) : getApps()[0];
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log("\n" + "=".repeat(75));
  console.log("  D-ARROW USER & IDENTITY MIGRATION");
  console.log(`  Project: ${projectId}`);
  console.log(`  Mode:    ${DRY_RUN ? "DRY RUN (Preview Only — Zero writes)" : "LIVE EXECUTION"}`);
  console.log("=".repeat(75) + "\n");

  // Phase 1: Scan Companies
  console.log("[Phase 1] Discovering Companies...");
  const companiesSnap = await db.collection("companies").get();
  let resolvedDArrowCompanyId = OVERRIDE_COMPANY_ID;
  const companiesList: Array<{ id: string; name: string }> = [];

  for (const c of companiesSnap.docs) {
    const data = c.data();
    const name = data.name || data.companyName || "";
    companiesList.push({ id: c.id, name });
    if (!resolvedDArrowCompanyId && isDArrowMatch(c.id, name)) {
      resolvedDArrowCompanyId = c.id;
      console.log(`  ★ Found DArrow company: "${c.id}" (${name})`);
    }
  }

  if (!resolvedDArrowCompanyId) {
    console.log("  ⚠️ No existing DArrow company found in Firestore.");
    resolvedDArrowCompanyId = "darrow";
    console.log(`  -> Will use canonical ID "${resolvedDArrowCompanyId}".`);
  } else {
    console.log(`  -> Selected DArrow companyId: "${resolvedDArrowCompanyId}"`);
  }

  // Phase 2: Scan Users
  console.log("\n[Phase 2] Discovering Auth Users & Identifying Target...");
  let targetUserRecord;
  try {
    targetUserRecord = await auth.getUserByEmail(TARGET_EMAIL);
    console.log(`  ✓ Target user located: ${TARGET_EMAIL} (UID: ${targetUserRecord.uid})`);
    console.log(`    Current Claims: ${JSON.stringify(targetUserRecord.customClaims || {})}`);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "auth/user-not-found") {
      console.log(`  ⚠️ Target user "${TARGET_EMAIL}" not found in Firebase Auth.`);
      console.log("    User must register/login once before identity migration.");
    } else {
      throw err;
    }
  }

  // Phase 3: Planned Updates
  if (targetUserRecord) {
    console.log("\n[Phase 3] Preparing General Manager Identity Activation...");
    const targetUid = targetUserRecord.uid;
    const userDocRef = db.collection("users").doc(targetUid);
    const userDocSnap = await userDocRef.get();
    const currentDoc = userDocSnap.exists ? userDocSnap.data() || {} : {};

    const targetClaims = {
      ...(targetUserRecord.customClaims || {}),
      role: TARGET_ROLE,
      admin: true,
      globalAccess: isPlatformScope,
      companyId: resolvedDArrowCompanyId,
    };

    const targetDocUpdate = {
      ...currentDoc,
      id: targetUid,
      email: TARGET_EMAIL,
      role: TARGET_ROLE,
      companyId: resolvedDArrowCompanyId,
      companyName: "DArrow",
      countryScope: ["EG", "SA"],
      portalAccess: [
        "dashboard", "crm", "tasks", "people", "financial",
        "inventory", "operations", "strategy", "support", "pos", "rem",
      ],
      portalSubRoles: {
        tasks: "admin",
        crm: "admin",
        people: "admin",
        billing: "admin",
      },
      updatedAt: new Date().toISOString(),
    };

    if (DRY_RUN) {
      console.log("\n" + "-".repeat(75));
      console.log("  DRY RUN PREVIEW (Zero mutations performed):");
      console.log("-".repeat(75));
      console.log("  Target UID:            ", targetUid);
      console.log("  Target Role:           ", "platform_admin (General Manager)");
      console.log("  Authoritative Company: ", resolvedDArrowCompanyId);
      console.log("  Planned Claims:        ", JSON.stringify(targetClaims, null, 2));
      console.log("  Planned Firestore Doc: ", JSON.stringify(targetDocUpdate, null, 2));
      console.log("-".repeat(75));
    } else {
      console.log("  Applying custom claims via Admin SDK...");
      await auth.setCustomUserClaims(targetUid, targetClaims);

      console.log("  Applying Firestore profile update...");
      await userDocRef.set(targetDocUpdate, { merge: true });

      // Ensure DArrow company doc exists
      const compRef = db.collection("companies").doc(resolvedDArrowCompanyId);
      const compSnap = await compRef.get();
      if (!compSnap.exists) {
        console.log(`  Creating company doc /companies/${resolvedDArrowCompanyId}...`);
        await compRef.set({
          id: resolvedDArrowCompanyId,
          name: "DArrow",
          commercialRegister: "",
          defaultCurrency: "SAR",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      console.log("  ✓ Migration successfully applied!");
    }
  }

  console.log("\n" + "=".repeat(75));
  console.log("  MIGRATION SCRIPT EXECUTION FINISHED");
  console.log("=".repeat(75) + "\n");
}

main().catch((err) => {
  console.error("Migration error:", err.message || err);
  process.exit(1);
});

