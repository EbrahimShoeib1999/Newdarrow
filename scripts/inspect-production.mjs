/**
 * D-Arrow — Production Inspector (100% Read-Only)
 * ============================================================
 * Inspects production Firebase state (Auth Users, Companies, Employees, Profiles)
 * WITHOUT modifying, writing, or deleting anything.
 *
 * If credentials are not configured, clearly reports:
 * "Production access unavailable. Local validation can continue."
 *
 * Usage:
 *   # With Admin SDK credentials:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/inspect-production.mjs
 *
 *   # Or via npm:
 *   npm run inspect:production
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const env = {};
  try {
    const content = readFileSync(join(root, ".env"), "utf-8");
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

const env = loadEnv();
const projectId = env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "d-arrow-buisiness";
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log("\n" + "=".repeat(75));
console.log("  D-ARROW PRODUCTION INSPECTOR (READ-ONLY)");
console.log(`  Target Project: ${projectId}`);
console.log("=".repeat(75));

async function runWithAdminSdk(credentialFile) {
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");

  const serviceAccount = JSON.parse(readFileSync(credentialFile, "utf-8"));
  const app = getApps().length === 0 ? initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id || projectId,
  }) : getApps()[0];

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log("\n[1] AUTH USERS");
  console.log("-".repeat(75));
  let nextPageToken;
  let userCount = 0;
  do {
    const listResult = await auth.listUsers(100, nextPageToken);
    for (const u of listResult.users) {
      userCount++;
      console.log(`• UID:          ${u.uid}`);
      console.log(`  Email:        ${u.email || "(no email)"}`);
      console.log(`  DisplayName:  ${u.displayName || "(none)"}`);
      console.log(`  Claims:       ${JSON.stringify(u.customClaims || {})}`);
      console.log(`  Disabled:     ${u.disabled}`);
      console.log("");
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);
  console.log(`Total Auth Users: ${userCount}\n`);

  console.log("[2] COMPANIES");
  console.log("-".repeat(75));
  const companiesSnap = await db.collection("companies").get();
  const companyList = [];
  if (companiesSnap.empty) {
    console.log("  (No companies found in /companies)");
  } else {
    for (const c of companiesSnap.docs) {
      const data = c.data();
      const name = data.name || data.companyName || "(unnamed)";
      const isDefault = name.toLowerCase().includes("darrow") || c.id.toLowerCase().includes("darrow");
      companyList.push({ id: c.id, name });
      console.log(`• ID:           ${c.id}${isDefault ? " [★ Canonical DArrow Candidate]" : ""}`);
      console.log(`  Name:         ${name}`);
      console.log(`  Currency:     ${data.defaultCurrency || "SAR"}`);
      console.log(`  Created:      ${data.createdAt || "(unknown)"}`);
      console.log("");
    }
  }

  console.log("[3] EMPLOYEES (per company)");
  console.log("-".repeat(75));
  let totalEmployees = 0;
  for (const c of companyList) {
    const empSnap = await db.collection("companies").doc(c.id).collection("employees").get();
    if (!empSnap.empty) {
      console.log(`Company: ${c.name} (${c.id})`);
      for (const e of empSnap.docs) {
        totalEmployees++;
        const ed = e.data();
        console.log(`  • ID:           ${e.id}`);
        console.log(`    Email:        ${ed.email || "(no email)"}`);
        console.log(`    Company ID:   ${c.id}`);
        console.log(`    Company Name: ${c.name}`);
        console.log(`    Role:         ${ed.role || "employee"}`);
        console.log(`    Status:       ${ed.status || "active"}`);
        console.log("");
      }
    }
  }
  if (totalEmployees === 0) {
    console.log("  (No employees found across company subcollections)");
  }

  console.log("=".repeat(75));
  console.log("INSPECTION COMPLETE — Zero modifications made.");
  console.log("=".repeat(75) + "\n");
}

async function main() {
  if (credentialPath && existsSync(credentialPath)) {
    await runWithAdminSdk(credentialPath);
  } else {
    console.log("\n⚠️  Production access unavailable (No valid GOOGLE_APPLICATION_CREDENTIALS provided).");
    console.log("   Local validation can continue.\n");
    console.log("To inspect production when credentials are ready:");
    console.log('   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\service-account.json"');
    console.log("   node scripts/inspect-production.mjs\n");
    console.log("=".repeat(75) + "\n");
  }
}

main().catch((err) => {
  console.error("Inspector error:", err.message || err);
  process.exit(1);
});
