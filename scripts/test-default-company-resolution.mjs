/**
 * D-Arrow — Emulator Test Suite: General Manager & Tenant Isolation
 * ============================================================
 * Verifies:
 *   1. platform_admin (General Manager) has global read/write access across all companies
 *   2. platform_admin can read all user documents across the platform
 *   3. Normal employee CANNOT access another company's data (cross-tenant isolated)
 *   4. Normal employee CANNOT read other users' documents
 *   5. Spoofed profile (role="platform_admin" in Firestore without JWT claim) is DENIED
 */

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err?.message ?? String(err) });
    console.error(`[FAIL] ${name}: ${err?.message ?? err}`);
  }
}

const PROJECT_ID = "d-arrow-company-resolution";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

// Seed data as admin
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  
  // Companies
  await setDoc(doc(db, "companies", "comp_darrow"), {
    name: "DArrow",
    defaultCurrency: "EGP",
  });
  await setDoc(doc(db, "companies", "comp_branch_sa"), {
    name: "D-Arrow KSA",
    defaultCurrency: "SAR",
  });

  // Seed employees
  await setDoc(doc(db, "companies", "comp_darrow", "employees", "emp_darrow"), {
    name: "DArrow Employee",
    email: "emp.darrow@example.com",
    companyId: "comp_darrow",
    role: "employee",
  });
  await setDoc(doc(db, "companies", "comp_branch_sa", "employees", "emp_sa"), {
    name: "Saudi Employee",
    email: "emp.sa@example.com",
    companyId: "comp_branch_sa",
    role: "employee",
  });

  // User profiles
  await setDoc(doc(db, "users", "uid_general_manager"), {
    email: "gm@d-arrow.com",
    role: "platform_admin",
    companyId: "comp_darrow",
  });
  await setDoc(doc(db, "users", "uid_emp_darrow"), {
    email: "emp.darrow@example.com",
    role: "employee",
    companyId: "comp_darrow",
  });
  await setDoc(doc(db, "users", "uid_spoofed_admin"), {
    email: "attacker@example.com",
    role: "platform_admin", // Attempted profile spoof without JWT claim
    companyId: "comp_branch_sa",
  });
});

// Test contexts
const gmContext = testEnv.authenticatedContext("uid_general_manager", {
  role: "platform_admin",
  admin: true,
  globalAccess: true,
  companyId: "comp_darrow",
});
const gmDb = gmContext.firestore();

const empContext = testEnv.authenticatedContext("uid_emp_darrow", {
  role: "employee",
  companyId: "comp_darrow",
});
const empDb = empContext.firestore();

const spoofedContext = testEnv.authenticatedContext("uid_spoofed_admin", {
  role: "employee", // Token says employee!
  companyId: "comp_branch_sa",
});
const spoofedDb = spoofedContext.firestore();

// 1. General Manager Global Access
await test("1. General Manager CAN read employee in own company (DArrow)", async () => {
  await assertSucceeds(getDoc(doc(gmDb, "companies", "comp_darrow", "employees", "emp_darrow")));
});

await test("2. General Manager CAN read employee in another company (comp_branch_sa)", async () => {
  await assertSucceeds(getDoc(doc(gmDb, "companies", "comp_branch_sa", "employees", "emp_sa")));
});

await test("3. General Manager CAN read any user document", async () => {
  await assertSucceeds(getDoc(doc(gmDb, "users", "uid_emp_darrow")));
  await assertSucceeds(getDoc(doc(gmDb, "users", "uid_spoofed_admin")));
});

// 2. Normal Employee Boundary Isolation
await test("4. Normal employee CAN read employee record in own company", async () => {
  await assertSucceeds(getDoc(doc(empDb, "companies", "comp_darrow", "employees", "emp_darrow")));
});

await test("5. Normal employee CANNOT read employee in separate company (cross-tenant denied)", async () => {
  await assertFails(getDoc(doc(empDb, "companies", "comp_branch_sa", "employees", "emp_sa")));
});

await test("6. Normal employee CANNOT read other user profile in separate company", async () => {
  await assertFails(getDoc(doc(empDb, "users", "uid_spoofed_admin")));
});

// 3. Spoofed Identity Protection (JWT Claim Enforcement)
await test("7. Spoofed user with Firestore profile role=platform_admin but token role=employee is DENIED global access", async () => {
  await assertFails(getDoc(doc(spoofedDb, "companies", "comp_darrow", "employees", "emp_darrow")));
});

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n========================================`);
console.log(`EMULATOR TEST RESULTS: ${results.length - failed.length}/${results.length} PASSED`);
console.log(`========================================\n`);

if (failed.length > 0) {
  process.exit(1);
}

