/**
 * D-ARROW — V3 ADVERSARIAL RE-VERIFICATION & SECURITY AUDIT SUITE
 *
 * Verifies all 5 security remediations and tests both negative and positive assertions:
 * 1. Platform Admin Trust & Profile Fallback Elimination (Auth claims vs Firestore profile)
 * 2. Tenant Isolation & Cross-Tenant Boundary
 * 3. Wildcard Allowlist Policy & Employee/Invoice Deletion Protection
 * 4. Financial Integrity: Vouchers, Payroll Payments, GL Journals, Payments
 * 5. Privileged Identity Protection: Self-Deletion & Super Admin Deletion Guards
 * 6. Audit Log Authenticity & Anti-Spoofing (Root & Tenant Audit Logs)
 * 7. Authorized Administrative & HR Workflows (Positive Tests)
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
  updateDoc,
  deleteDoc,
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

const testEnv = await initializeTestEnvironment({
  projectId: "adversarial-audit-v3",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed test fixtures in isolated emulator
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // 1. Companies
  await setDoc(doc(db, "companies", "comp_a"), {
    name: "Company A (Egypt)",
    primaryActivity: "PROJECTS",
    country: "EG",
  });
  await setDoc(doc(db, "companies", "comp_b"), {
    name: "Company B (Saudi Arabia)",
    primaryActivity: "REAL_ESTATE_MANAGEMENT",
    country: "SA",
  });

  // 2. User Profiles
  // Platform Admin (Trusted: Auth claim + Profile)
  await setDoc(doc(db, "users", "uid_real_pa"), {
    email: "khulodahmed390@gmail.com",
    role: "platform_admin",
    companyId: "comp_a",
    status: "active",
  });

  // Super Admin of Company A
  await setDoc(doc(db, "users", "uid_super_admin"), {
    email: "superadmin@comp-a.com",
    role: "super_admin",
    companyId: "comp_a",
    status: "active",
  });

  // Company Admin of Company A
  await setDoc(doc(db, "users", "uid_comp_admin"), {
    email: "admin@comp-a.com",
    role: "admin",
    companyId: "comp_a",
    status: "active",
  });

  // Global HR Manager
  await setDoc(doc(db, "users", "uid_global_hr"), {
    email: "hr@darrow.com",
    role: "global_hr_manager",
    companyId: "comp_a",
    countryScope: ["EG", "SA"],
    status: "active",
  });

  // Regular Employee of Company A
  await setDoc(doc(db, "users", "uid_emp_a"), {
    email: "employee@comp-a.com",
    role: "employee",
    companyId: "comp_a",
    status: "active",
  });

  // Attacker Profile (has role: platform_admin in Firestore, but NO custom claims)
  await setDoc(doc(db, "users", "uid_attacker_profile_only"), {
    email: "attacker@comp-a.com",
    role: "platform_admin",
    companyId: "comp_a",
    status: "active",
  });

  // 3. Subcollection Fixtures
  // Employee profile in Company A
  await setDoc(doc(db, "companies", "comp_a", "employees", "emp_victim"), {
    name: "Victim Employee",
    salary: 15000,
    jobTitle: "Senior Architect",
    country: "EG",
  });

  // Invoice in Company A
  await setDoc(doc(db, "companies", "comp_a", "invoices", "inv_001"), {
    invoiceNumber: "INV-2026-001",
    amount: 50000,
    status: "issued",
  });

  // Confidential Project in Company B
  await setDoc(doc(db, "companies", "comp_b", "projects", "proj_b1"), {
    name: "Confidential Saudi Mega Project",
    budget: 5000000,
  });
});

// Setup Authenticated Contexts
const realPaCtx = testEnv.authenticatedContext("uid_real_pa", {
  role: "platform_admin",
  email: "khulodahmed390@gmail.com",
});
// Profile-only context: Authenticated, but EMPTY custom claims!
const profileOnlyPaCtx = testEnv.authenticatedContext("uid_attacker_profile_only", {});
const compAdminCtx = testEnv.authenticatedContext("uid_comp_admin", {
  role: "admin",
  companyId: "comp_a",
});
const globalHrCtx = testEnv.authenticatedContext("uid_global_hr", {
  role: "global_hr_manager",
  companyId: "comp_a",
});
const empCtx = testEnv.authenticatedContext("uid_emp_a", {
  role: "employee",
  companyId: "comp_a",
});

const realPaDb = realPaCtx.firestore();
const profileOnlyDb = profileOnlyPaCtx.firestore();
const compAdminDb = compAdminCtx.firestore();
const globalHrDb = globalHrCtx.firestore();
const empDb = empCtx.firestore();

console.log("\n=================================================================");
console.log(" D-ARROW: V3 ADVERSARIAL SECURITY RE-VERIFICATION");
console.log("=================================================================\n");

// -----------------------------------------------------------------------------
// 1. PLATFORM ADMIN TRUST & PROFILE FALLBACK ELIMINATION
// -----------------------------------------------------------------------------
console.log("--- Category 1: Platform Admin Trust & Fallback Elimination ---");

await test("1.1 [NEGATIVE] Profile-only user CANNOT read other tenant documents", async () => {
  await assertFails(getDoc(doc(profileOnlyDb, "companies", "comp_b", "projects", "proj_b1")));
});

await test("1.2 [NEGATIVE] Profile-only user CANNOT post cross-tenant GL journals", async () => {
  await assertFails(
    setDoc(doc(profileOnlyDb, "companies", "comp_b", "journals", "jrnl_attacker"), {
      totalDebit: 1000,
      totalCredit: 1000,
      date: "2026-11-09",
    })
  );
});

await test("1.3 [POSITIVE] Real Platform Admin (with Auth claim) CAN read across tenants", async () => {
  await assertSucceeds(getDoc(doc(realPaDb, "companies", "comp_b", "projects", "proj_b1")));
});

await test("1.4 [NEGATIVE] Regular employee cannot self-assign platform_admin role", async () => {
  await assertFails(
    updateDoc(doc(empDb, "users", "uid_emp_a"), {
      role: "platform_admin",
    })
  );
});

// -----------------------------------------------------------------------------
// 2. WILDCARD ALLOWLIST & DATA DELETION PROTECTION
// -----------------------------------------------------------------------------
console.log("\n--- Category 2: Wildcard Allowlist & Data Deletion Protection ---");

await test("2.1 [NEGATIVE] Ordinary employee CANNOT delete employee record", async () => {
  await assertFails(deleteDoc(doc(empDb, "companies", "comp_a", "employees", "emp_victim")));
});

await test("2.2 [NEGATIVE] Ordinary employee CANNOT delete company invoice", async () => {
  await assertFails(deleteDoc(doc(empDb, "companies", "comp_a", "invoices", "inv_001")));
});

await test("2.3 [NEGATIVE] Global HR Manager CANNOT delete employee record (admin-only)", async () => {
  await assertFails(deleteDoc(doc(globalHrDb, "companies", "comp_a", "employees", "emp_victim")));
});

await test("2.4 [NEGATIVE] Ordinary employee CANNOT write to unknown/unlisted wildcard collection", async () => {
  await assertFails(
    setDoc(doc(empDb, "companies", "comp_a", "unauthorized_arbitrary_collection", "doc_01"), {
      data: "malicious payload",
    })
  );
});

await test("2.5 [POSITIVE] Company Admin CAN delete employee record in own company", async () => {
  await assertSucceeds(deleteDoc(doc(compAdminDb, "companies", "comp_a", "employees", "emp_victim")));
});

// -----------------------------------------------------------------------------
// 3. FINANCIAL WORKFLOWS & INTEGRITY (VOUCHERS, PAYROLL, JOURNALS)
// -----------------------------------------------------------------------------
console.log("\n--- Category 3: Financial Integrity & Workflows ---");

await test("3.1 [NEGATIVE] Ordinary employee CANNOT create payroll disbursement", async () => {
  await assertFails(
    setDoc(doc(empDb, "companies", "comp_a", "payroll_payments", "pay_emp_hack"), {
      amount: 10000,
      status: "disbursed",
    })
  );
});

await test("3.2 [NEGATIVE] Company Admin CANNOT create payroll payment with negative amount", async () => {
  await assertFails(
    setDoc(doc(compAdminDb, "companies", "comp_a", "payroll_payments", "pay_negative"), {
      amount: -50000,
      status: "disbursed",
    })
  );
});

await test("3.3 [NEGATIVE] Company Admin CANNOT create payroll payment with zero amount", async () => {
  await assertFails(
    setDoc(doc(compAdminDb, "companies", "comp_a", "payroll_payments", "pay_zero"), {
      amount: 0,
      status: "disbursed",
    })
  );
});

await test("3.4 [NEGATIVE] Company Admin CANNOT create payroll payment with non-numeric amount", async () => {
  await assertFails(
    setDoc(doc(compAdminDb, "companies", "comp_a", "payroll_payments", "pay_nan"), {
      amount: "TEN_THOUSAND",
      status: "disbursed",
    })
  );
});

await test("3.5 [NEGATIVE] Ordinary employee CANNOT create payment voucher", async () => {
  await assertFails(
    setDoc(doc(empDb, "companies", "comp_a", "vouchers", "vchr_emp_hack"), {
      amount: 25000,
      payee: "personal account",
    })
  );
});

await test("3.6 [NEGATIVE] Company Admin CANNOT create voucher with zero or negative amount", async () => {
  await assertFails(
    setDoc(doc(compAdminDb, "companies", "comp_a", "vouchers", "vchr_zero"), {
      amount: 0,
      payee: "vendor",
    })
  );
});

await test("3.7 [NEGATIVE] Executed financial records CANNOT be deleted (immutable audit trail)", async () => {
  await assertFails(deleteDoc(doc(compAdminDb, "companies", "comp_a", "vouchers", "vchr_any")));
  await assertFails(deleteDoc(doc(compAdminDb, "companies", "comp_a", "payroll_payments", "pay_any")));
});

await test("3.8 [POSITIVE] Company Admin CAN create valid payroll payment with positive amount", async () => {
  await assertSucceeds(
    setDoc(doc(compAdminDb, "companies", "comp_a", "payroll_payments", "pay_valid_admin"), {
      amount: 45000,
      period: "2026-11",
      status: "disbursed",
    })
  );
});

await test("3.9 [POSITIVE] Company Admin CAN create valid payment voucher with positive amount", async () => {
  await assertSucceeds(
    setDoc(doc(compAdminDb, "companies", "comp_a", "vouchers", "vchr_valid_admin"), {
      amount: 12500,
      voucherType: "PAYMENT",
      status: "approved",
    })
  );
});

// -----------------------------------------------------------------------------
// 4. PRIVILEGED IDENTITY PROTECTION
// -----------------------------------------------------------------------------
console.log("\n--- Category 4: Privileged Identity Protection ---");

await test("4.1 [NEGATIVE] Platform Admin CANNOT delete own identity (self-deletion lockout guard)", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "users", "uid_real_pa")));
});

await test("4.2 [NEGATIVE] Platform Admin CANNOT delete super_admin identity", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "users", "uid_super_admin")));
});

await test("4.3 [NEGATIVE] Company Admin CANNOT delete Platform Admin identity", async () => {
  await assertFails(deleteDoc(doc(compAdminDb, "users", "uid_real_pa")));
});

await test("4.4 [NEGATIVE] Company Admin CANNOT delete super_admin identity", async () => {
  await assertFails(deleteDoc(doc(compAdminDb, "users", "uid_super_admin")));
});

await test("4.5 [NEGATIVE] Company Admin CANNOT delete own identity", async () => {
  await assertFails(deleteDoc(doc(compAdminDb, "users", "uid_comp_admin")));
});

await test("4.6 [POSITIVE] Platform Admin CAN delete regular employee account across tenants", async () => {
  await assertSucceeds(deleteDoc(doc(realPaDb, "users", "uid_emp_a")));
});

// -----------------------------------------------------------------------------
// 5. AUDIT LOG AUTHENTICITY & ANTI-SPOOFING
// -----------------------------------------------------------------------------
console.log("\n--- Category 5: Audit Log Authenticity & Anti-Spoofing ---");

await test("5.1 [NEGATIVE] Ordinary employee CANNOT forge root audit log impersonating Platform Admin", async () => {
  await assertFails(
    setDoc(doc(empDb, "audit_logs", "forged_root_pa"), {
      actorUid: "uid_real_pa", // Spoofed actorUid!
      actorEmail: "khulodahmed390@gmail.com",
      action: "DISBURSE_ALL_FUNDS",
      timestamp: "2026-11-09T18:00:00Z",
    })
  );
});

await test("5.2 [NEGATIVE] Ordinary employee CANNOT forge tenant audit log impersonating Super Admin", async () => {
  await assertFails(
    setDoc(doc(empDb, "companies", "comp_a", "audit_logs", "forged_tenant_sa"), {
      actorUid: "uid_super_admin", // Spoofed actorUid!
      action: "EXEC_FRAUD",
    })
  );
});

await test("5.3 [NEGATIVE] Audit log entry CANNOT be updated (immutability)", async () => {
  await assertFails(
    updateDoc(doc(realPaDb, "audit_logs", "audit_any"), {
      action: "ALTERED_ACTION",
    })
  );
});

await test("5.4 [NEGATIVE] Audit log entry CANNOT be deleted (immutability)", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "audit_logs", "audit_any")));
});

await test("5.5 [POSITIVE] Platform Admin CAN create authentic root audit log with matching actorUid", async () => {
  await assertSucceeds(
    setDoc(doc(realPaDb, "audit_logs", "legit_root_pa"), {
      actorUid: "uid_real_pa",
      actorEmail: "khulodahmed390@gmail.com",
      action: "PLATFORM_SYSTEM_CHECK",
      timestamp: new Date().toISOString(),
    })
  );
});

await test("5.6 [POSITIVE] Company Admin CAN create authentic tenant audit log with matching actorUid", async () => {
  await assertSucceeds(
    setDoc(doc(compAdminDb, "companies", "comp_a", "audit_logs", "legit_tenant_ca"), {
      actorUid: "uid_comp_admin",
      action: "TENANT_PERIOD_CLOSE",
    })
  );
});

// -----------------------------------------------------------------------------
// SUMMARY OF V3 ADVERSARIAL AUDIT
// -----------------------------------------------------------------------------
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;

console.log("\n=================================================================");
console.log(` V3 ADVERSARIAL AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${results.length})`);
console.log("=================================================================\n");

await testEnv.cleanup();
if (failed > 0) {
  process.exit(1);
}

