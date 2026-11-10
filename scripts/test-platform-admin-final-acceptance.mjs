/**
 * D-ARROW — FINAL PLATFORM ADMIN ACCEPTANCE SUITE
 *
 * Comprehensive end-to-end acceptance test suite covering:
 * - 36 Negative Adversarial Security Attacks
 * - 17 Positive Legitimate Administrative, Financial, HR, and Operational Workflows
 * Total: 53 rigorously verified test cases across all platform authorization boundaries.
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
  collection,
  getDocs,
  runTransaction,
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

const PROJECT_ID = "d-arrow-final-acceptance";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// -----------------------------------------------------------------------------
// Seed isolated multi-tenant fixtures
// -----------------------------------------------------------------------------
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // 1. Multi-Tenant Companies
  await setDoc(doc(db, "companies", "comp_eg"), {
    name: "D-Arrow Egypt Ltd",
    primaryActivity: "PROJECTS",
    country: "EG",
    status: "active",
  });
  await setDoc(doc(db, "companies", "comp_sa"), {
    name: "D-Arrow Saudi Arabia LLC",
    primaryActivity: "REAL_ESTATE_MANAGEMENT",
    country: "SA",
    status: "active",
  });
  await setDoc(doc(db, "companies", "comp_ae"), {
    name: "D-Arrow UAE Branch",
    primaryActivity: "PROJECTS",
    country: "AE",
    status: "active",
  });

  // 2. Global User Profiles
  // Platform Admin (Trusted)
  await setDoc(doc(db, "users", "uid_pa"), {
    email: "khulodahmed390@gmail.com",
    role: "platform_admin",
    companyId: "comp_eg",
    status: "active",
  });

  // Attacker (Profile says platform_admin, but JWT has empty claims)
  await setDoc(doc(db, "users", "uid_attacker_pa_fake"), {
    email: "fake_pa@attack.com",
    role: "platform_admin",
    companyId: "comp_eg",
    status: "active",
  });

  // Super Admin of Egypt Company
  await setDoc(doc(db, "users", "uid_super_admin"), {
    email: "superadmin@comp-eg.com",
    role: "super_admin",
    companyId: "comp_eg",
    status: "active",
  });

  // Company Admin of Egypt Company
  await setDoc(doc(db, "users", "uid_admin_eg"), {
    email: "admin@comp-eg.com",
    role: "admin",
    companyId: "comp_eg",
    status: "active",
  });

  // Company Admin of Saudi Company
  await setDoc(doc(db, "users", "uid_admin_sa"), {
    email: "admin@comp-sa.com",
    role: "admin",
    companyId: "comp_sa",
    status: "active",
  });

  // Global HR Manager (Scoped to EG and SA)
  await setDoc(doc(db, "users", "uid_global_hr"), {
    email: "globalhr@darrow.com",
    role: "global_hr_manager",
    companyId: "comp_eg",
    countryScope: ["EG", "SA"],
    status: "active",
  });

  // Regular Employee in Egypt Company
  await setDoc(doc(db, "users", "uid_emp_eg"), {
    email: "emp@comp-eg.com",
    role: "employee",
    companyId: "comp_eg",
    status: "active",
  });

  // Dedicated employee account for Platform Admin deletion test
  await setDoc(doc(db, "users", "uid_emp_to_delete"), {
    email: "todelete@comp-eg.com",
    role: "employee",
    companyId: "comp_eg",
    status: "active",
  });

  // Unassigned Orphan User (for Super Admin reconciliation test)
  await setDoc(doc(db, "users", "uid_orphan"), {
    email: "orphan@darrow.com",
    role: "employee",
    companyId: "",
    status: "active",
  });

  // 3. Subcollection Fixtures
  // Employee in Egypt entity (Cairo HQ)
  await setDoc(doc(db, "companies", "comp_eg", "employees", "emp_victim_eg"), {
    name: "Tarek Fathy",
    salary: 22000,
    jobTitle: "Senior Architect",
    country: "EG",
    userId: "uid_emp_eg",
  });

  // Dedicated employee record for Company Admin deletion test
  await setDoc(doc(db, "companies", "comp_eg", "employees", "emp_delete_target"), {
    name: "Temporary Staff",
    salary: 8000,
    jobTitle: "Intern",
    country: "EG",
  });

  // Employee in Saudi branch of Egypt entity (cross-country)
  await setDoc(doc(db, "companies", "comp_eg", "employees", "emp_saudi_branch"), {
    name: "Fahad Al-Otaibi",
    salary: 28000,
    jobTitle: "Civil Engineer",
    country: "SA",
  });

  // Employee in distinct Saudi entity
  await setDoc(doc(db, "companies", "comp_sa", "employees", "emp_victim_sa"), {
    name: "Saud Al-Ghamdi",
    salary: 30000,
    jobTitle: "Regional Manager",
    country: "SA",
  });

  // Employee in UAE entity
  await setDoc(doc(db, "companies", "comp_ae", "employees", "emp_uae"), {
    name: "Zayed Al-Mansouri",
    salary: 35000,
    jobTitle: "Regional Director",
    country: "AE",
  });

  // Invoices
  await setDoc(doc(db, "companies", "comp_eg", "invoices", "inv_eg_001"), {
    invoiceNumber: "INV-EG-001",
    amount: 150000,
    status: "sent",
  });
  await setDoc(doc(db, "companies", "comp_sa", "invoices", "inv_sa_001"), {
    invoiceNumber: "INV-SA-001",
    amount: 250000,
    status: "sent",
  });

  // Projects
  await setDoc(doc(db, "companies", "comp_eg", "projects", "proj_eg_01"), {
    name: "New Cairo Commercial Plaza",
    budget: 12000000,
  });
  await setDoc(doc(db, "companies", "comp_sa", "projects", "proj_sa_01"), {
    name: "Riyadh Tower Expansion",
    budget: 45000000,
  });

  // Existing posted GL Journal (for immutability check)
  await setDoc(doc(db, "companies", "comp_eg", "journals", "jrnl_posted_01"), {
    journalNumber: "JE-2026-001",
    totalDebit: 50000,
    totalCredit: 50000,
    date: "2026-11-01",
    status: "posted",
  });

  // Existing Daily Report
  await setDoc(doc(db, "companies", "comp_eg", "daily_reports", "rep_emp_eg"), {
    employeeId: "uid_emp_eg",
    date: "2026-11-09",
    content: "Completed structural engineering analysis.",
  });
});

// Setup Authenticated Contexts
const realPaCtx = testEnv.authenticatedContext("uid_pa", {
  role: "platform_admin",
  email: "khulodahmed390@gmail.com",
});
const fakePaCtx = testEnv.authenticatedContext("uid_attacker_pa_fake", {}); // Empty token claims
const superAdminCtx = testEnv.authenticatedContext("uid_super_admin", {
  role: "super_admin",
  companyId: "comp_eg",
});
const adminEgCtx = testEnv.authenticatedContext("uid_admin_eg", {
  role: "admin",
  companyId: "comp_eg",
});
const adminSaCtx = testEnv.authenticatedContext("uid_admin_sa", {
  role: "admin",
  companyId: "comp_sa",
});
const globalHrCtx = testEnv.authenticatedContext("uid_global_hr", {
  role: "global_hr_manager",
  companyId: "comp_eg",
});
const empEgCtx = testEnv.authenticatedContext("uid_emp_eg", {
  role: "employee",
  companyId: "comp_eg",
});

const realPaDb = realPaCtx.firestore();
const fakePaDb = fakePaCtx.firestore();
const superAdminDb = superAdminCtx.firestore();
const adminEgDb = adminEgCtx.firestore();
const adminSaDb = adminSaCtx.firestore();
const globalHrDb = globalHrCtx.firestore();
const empEgDb = empEgCtx.firestore();

console.log("\n=================================================================");
console.log(" D-ARROW: FINAL PLATFORM ADMIN ACCEPTANCE AUDIT SUITE");
console.log("=================================================================\n");

// =============================================================================
// SECTION 1: PLATFORM ADMIN TRUST & PROFILE FALLBACK ELIMINATION
// =============================================================================
console.log("--- Section 1: Platform Admin Trust & Fallback Elimination ---");

await test("1.1 [NEGATIVE] Profile-only platform_admin CANNOT read documents across tenants", async () => {
  await assertFails(getDoc(doc(fakePaDb, "companies", "comp_sa", "projects", "proj_sa_01")));
});

await test("1.2 [NEGATIVE] Profile-only platform_admin CANNOT post cross-tenant GL journals", async () => {
  await assertFails(
    setDoc(doc(fakePaDb, "companies", "comp_sa", "journals", "jrnl_fake_post"), {
      totalDebit: 10000,
      totalCredit: 10000,
      date: "2026-11-09",
    })
  );
});

await test("1.3 [NEGATIVE] Regular employee cannot self-assign platform_admin in user profile", async () => {
  await assertFails(
    updateDoc(doc(empEgDb, "users", "uid_emp_eg"), {
      role: "platform_admin",
    })
  );
});

await test("1.4 [NEGATIVE] Regular employee cannot self-assign super_admin in user profile", async () => {
  await assertFails(
    updateDoc(doc(empEgDb, "users", "uid_emp_eg"), {
      role: "super_admin",
    })
  );
});

// =============================================================================
// SECTION 2: TENANT ISOLATION & CROSS-TENANT BOUNDARIES
// =============================================================================
console.log("\n--- Section 2: Tenant Isolation & Cross-Tenant Boundaries ---");

await test("2.1 [NEGATIVE] Employee of Egypt entity CANNOT read Saudi company projects", async () => {
  await assertFails(getDoc(doc(empEgDb, "companies", "comp_sa", "projects", "proj_sa_01")));
});

await test("2.2 [NEGATIVE] Employee of Egypt entity CANNOT write into Saudi company collection", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "companies", "comp_sa", "tasks", "task_hack"), {
      title: "Malicious Task",
    })
  );
});

await test("2.3 [NEGATIVE] Admin of Egypt entity CANNOT read Saudi company invoices", async () => {
  await assertFails(getDoc(doc(adminEgDb, "companies", "comp_sa", "invoices", "inv_sa_001")));
});

await test("2.4 [NEGATIVE] Admin of Egypt entity CANNOT modify Saudi company profile", async () => {
  await assertFails(
    updateDoc(doc(adminEgDb, "companies", "comp_sa"), {
      name: "Compromised Saudi Name",
    })
  );
});

// =============================================================================
// SECTION 3: WILDCARD LOCKDOWN & SENSITIVE DATA PROTECTION
// =============================================================================
console.log("\n--- Section 3: Wildcard Lockdown & Sensitive Data Protection ---");

await test("3.1 [NEGATIVE] Ordinary employee CANNOT delete employee record", async () => {
  await assertFails(deleteDoc(doc(empEgDb, "companies", "comp_eg", "employees", "emp_victim_eg")));
});

await test("3.2 [NEGATIVE] Global HR Manager CANNOT delete employee record (admin-only)", async () => {
  await assertFails(deleteDoc(doc(globalHrDb, "companies", "comp_eg", "employees", "emp_victim_eg")));
});

await test("3.3 [NEGATIVE] Ordinary employee CANNOT delete company invoice", async () => {
  await assertFails(deleteDoc(doc(empEgDb, "companies", "comp_eg", "invoices", "inv_eg_001")));
});

await test("3.4 [NEGATIVE] Ordinary employee CANNOT delete generic tasks or projects", async () => {
  await assertFails(deleteDoc(doc(empEgDb, "companies", "comp_eg", "projects", "proj_eg_01")));
});

await test("3.5 [NEGATIVE] Ordinary employee CANNOT write to unknown wildcard collection", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "companies", "comp_eg", "arbitrary_backdoor_collection", "doc_01"), {
      payload: "malicious",
    })
  );
});

// =============================================================================
// SECTION 4: FINANCIAL INTEGRITY & WORKFLOWS
// =============================================================================
console.log("\n--- Section 4: Financial Integrity & Workflows ---");

await test("4.1 [NEGATIVE] Ordinary employee CANNOT create payroll disbursement", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "companies", "comp_eg", "payroll_payments", "pay_emp_leak"), {
      amount: 15000,
      status: "disbursed",
    })
  );
});

await test("4.2 [NEGATIVE] Global HR Manager CANNOT create payroll disbursement (Segregation of Duties)", async () => {
  await assertFails(
    setDoc(doc(globalHrDb, "companies", "comp_eg", "payroll_payments", "pay_hr_leak"), {
      amount: 25000,
      status: "disbursed",
    })
  );
});

await test("4.3 [NEGATIVE] Company Admin CANNOT create payroll disbursement with negative amount", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "payroll_payments", "pay_neg"), {
      amount: -10000,
      status: "disbursed",
    })
  );
});

await test("4.4 [NEGATIVE] Company Admin CANNOT create payroll disbursement with zero amount", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "payroll_payments", "pay_zero"), {
      amount: 0,
      status: "disbursed",
    })
  );
});

await test("4.5 [NEGATIVE] Company Admin CANNOT create payroll disbursement with non-numeric amount", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "payroll_payments", "pay_nan"), {
      amount: "TWENTY_THOUSAND",
      status: "disbursed",
    })
  );
});

await test("4.6 [NEGATIVE] Ordinary employee CANNOT create payment voucher", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "companies", "comp_eg", "vouchers", "vchr_emp_hack"), {
      amount: 5000,
      payee: "employee",
    })
  );
});

await test("4.7 [NEGATIVE] Company Admin CANNOT create payment voucher with negative amount", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "vouchers", "vchr_neg"), {
      amount: -2500,
      payee: "vendor",
    })
  );
});

await test("4.8 [NEGATIVE] Executed vouchers and payroll disbursements CANNOT be deleted (immutable audit trail)", async () => {
  await assertFails(deleteDoc(doc(adminEgDb, "companies", "comp_eg", "vouchers", "vchr_any")));
  await assertFails(deleteDoc(doc(adminEgDb, "companies", "comp_eg", "payroll_payments", "pay_any")));
});

// =============================================================================
// SECTION 5: GENERAL LEDGER & JOURNAL INTEGRITY
// =============================================================================
console.log("\n--- Section 5: General Ledger & Journal Integrity ---");

await test("5.1 [NEGATIVE] Global HR Manager CANNOT post GL journal entry", async () => {
  await assertFails(
    setDoc(doc(globalHrDb, "companies", "comp_eg", "journals", "jrnl_hr_illegal"), {
      totalDebit: 15000,
      totalCredit: 15000,
      date: "2026-11-09",
    })
  );
});

await test("5.2 [NEGATIVE] Company member CANNOT post unbalanced GL journal entry (Debits != Credits)", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "journals", "jrnl_unbalanced"), {
      totalDebit: 10000,
      totalCredit: 9500,
      date: "2026-11-09",
    })
  );
});

await test("5.3 [NEGATIVE] Company member CANNOT post zero-value GL journal entry", async () => {
  await assertFails(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "journals", "jrnl_zero"), {
      totalDebit: 0,
      totalCredit: 0,
      date: "2026-11-09",
    })
  );
});

await test("5.4 [NEGATIVE] Posted GL journal entry CANNOT be updated / edited", async () => {
  await assertFails(
    updateDoc(doc(adminEgDb, "companies", "comp_eg", "journals", "jrnl_posted_01"), {
      totalDebit: 60000,
    })
  );
});

await test("5.5 [NEGATIVE] Posted GL journal entry CANNOT be deleted", async () => {
  await assertFails(deleteDoc(doc(adminEgDb, "companies", "comp_eg", "journals", "jrnl_posted_01")));
});

// =============================================================================
// SECTION 6: AUDIT LOG AUTHENTICITY & ANTI-SPOOFING
// =============================================================================
console.log("\n--- Section 6: Audit Log Authenticity & Anti-Spoofing ---");

await test("6.1 [NEGATIVE] Ordinary employee CANNOT create root audit log spoofing Platform Admin", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "audit_logs", "spoofed_root_pa"), {
      actorUid: "uid_pa", // Spoofed!
      actorEmail: "khulodahmed390@gmail.com",
      action: "PLATFORM_SHUTDOWN",
      timestamp: "2026-11-09T22:00:00Z",
    })
  );
});

await test("6.2 [NEGATIVE] Ordinary employee CANNOT create tenant audit log spoofing Super Admin", async () => {
  await assertFails(
    setDoc(doc(empEgDb, "companies", "comp_eg", "audit_logs", "spoofed_tenant_sa"), {
      actorUid: "uid_super_admin", // Spoofed!
      action: "ALTER_PAYROLL",
    })
  );
});

await test("6.3 [NEGATIVE] Existing audit log entries CANNOT be updated", async () => {
  await assertFails(
    updateDoc(doc(realPaDb, "audit_logs", "any_log"), {
      action: "TAMPERED_EVENT",
    })
  );
});

await test("6.4 [NEGATIVE] Existing audit log entries CANNOT be deleted", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "audit_logs", "any_log")));
});

// =============================================================================
// SECTION 7: PRIVILEGED IDENTITY PROTECTION & LOCKOUT PREVENTION
// =============================================================================
console.log("\n--- Section 7: Privileged Identity Protection ---");

await test("7.1 [NEGATIVE] Platform Admin CANNOT delete own user profile (lockout guard)", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "users", "uid_pa")));
});

await test("7.2 [NEGATIVE] Platform Admin CANNOT delete super_admin account", async () => {
  await assertFails(deleteDoc(doc(realPaDb, "users", "uid_super_admin")));
});

await test("7.3 [NEGATIVE] Company Admin CANNOT delete Platform Admin account", async () => {
  await assertFails(deleteDoc(doc(adminEgDb, "users", "uid_pa")));
});

await test("7.4 [NEGATIVE] Company Admin CANNOT delete super_admin account", async () => {
  await assertFails(deleteDoc(doc(adminEgDb, "users", "uid_super_admin")));
});

await test("7.5 [NEGATIVE] Company Admin CANNOT delete own account", async () => {
  await assertFails(deleteDoc(doc(adminEgDb, "users", "uid_admin_eg")));
});

await test("7.6 [NEGATIVE] Company Admin CANNOT mint super_admin role for teammate", async () => {
  await assertFails(
    updateDoc(doc(adminEgDb, "users", "uid_emp_eg"), {
      role: "super_admin",
    })
  );
});

await test("7.7 [NEGATIVE] Company Admin CANNOT mint platform_admin role for teammate", async () => {
  await assertFails(
    updateDoc(doc(adminEgDb, "users", "uid_emp_eg"), {
      role: "platform_admin",
    })
  );
});

// =============================================================================
// SECTION 8: COMPANY LIFECYCLE & DUPLICATE PREVENTION
// =============================================================================
console.log("\n--- Section 8: Company Lifecycle & Concurrency Guards ---");

await test("8.1 [NEGATIVE] Ordinary employee CANNOT delete company entity", async () => {
  await assertFails(deleteDoc(doc(empEgDb, "companies", "comp_eg")));
});

await test("8.2 [NEGATIVE] Ordinary employee CANNOT modify primaryActivity of company", async () => {
  await assertFails(
    updateDoc(doc(empEgDb, "companies", "comp_eg"), {
      primaryActivity: "MEDICAL_CLINIC",
    })
  );
});

// =============================================================================
// SECTION 9: AUTHORIZED PLATFORM ADMIN WORKFLOWS (POSITIVE)
// =============================================================================
console.log("\n--- Section 9: Authorized Platform Admin Workflows (Positive) ---");

await test("9.1 [POSITIVE] Platform Admin CAN read documents across multiple companies", async () => {
  await assertSucceeds(getDoc(doc(realPaDb, "companies", "comp_eg", "projects", "proj_eg_01")));
  await assertSucceeds(getDoc(doc(realPaDb, "companies", "comp_sa", "projects", "proj_sa_01")));
});

await test("9.2 [POSITIVE] Platform Admin CAN update company metadata", async () => {
  await assertSucceeds(
    updateDoc(doc(realPaDb, "companies", "comp_eg"), {
      phone: "+201000000000",
    })
  );
});

await test("9.3 [POSITIVE] Platform Admin CAN delete regular employee account in user registry", async () => {
  await assertSucceeds(deleteDoc(doc(realPaDb, "users", "uid_emp_to_delete")));
});

await test("9.4 [POSITIVE] Platform Admin CAN create authentic root audit log", async () => {
  await assertSucceeds(
    setDoc(doc(realPaDb, "audit_logs", "audit_pa_legit"), {
      actorUid: "uid_pa",
      actorEmail: "khulodahmed390@gmail.com",
      action: "PLATFORM_HEALTH_CHECK",
      timestamp: new Date().toISOString(),
    })
  );
});

// =============================================================================
// SECTION 10: AUTHORIZED SUPER ADMIN & COMPANY ADMIN WORKFLOWS (POSITIVE)
// =============================================================================
console.log("\n--- Section 10: Super Admin & Company Admin Workflows (Positive) ---");

await test("10.1 [POSITIVE] Super Admin CAN reconcile and assign unassigned orphan user", async () => {
  await assertSucceeds(
    updateDoc(doc(superAdminDb, "users", "uid_orphan"), {
      companyId: "comp_eg",
    })
  );
});

await test("10.2 [POSITIVE] Company Admin CAN delete employee record in own company", async () => {
  await assertSucceeds(deleteDoc(doc(adminEgDb, "companies", "comp_eg", "employees", "emp_delete_target")));
});

await test("10.3 [POSITIVE] Company Admin CAN create valid payroll payment with positive amount", async () => {
  await assertSucceeds(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "payroll_payments", "pay_valid_nov"), {
      amount: 45000,
      period: "2026-11",
      status: "disbursed",
    })
  );
});

await test("10.4 [POSITIVE] Company Admin CAN create valid payment voucher with positive amount", async () => {
  await assertSucceeds(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "vouchers", "vchr_valid_nov"), {
      amount: 18500,
      payee: "Cairo Supplies Co.",
      status: "approved",
    })
  );
});

await test("10.5 [POSITIVE] Company Admin CAN create authentic tenant audit log", async () => {
  await assertSucceeds(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "audit_logs", "audit_tenant_legit"), {
      actorUid: "uid_admin_eg",
      action: "MONTHLY_PAYROLL_APPROVED",
      timestamp: new Date().toISOString(),
    })
  );
});

// =============================================================================
// SECTION 11: NORMAL EMPLOYEE WORKFLOWS (POSITIVE)
// =============================================================================
console.log("\n--- Section 11: Normal Employee Workflows (Positive) ---");

await test("11.1 [POSITIVE] Normal employee CAN read own company project", async () => {
  await assertSucceeds(getDoc(doc(empEgDb, "companies", "comp_eg", "projects", "proj_eg_01")));
});

await test("11.2 [POSITIVE] Normal employee CAN read own daily report", async () => {
  await assertSucceeds(getDoc(doc(empEgDb, "companies", "comp_eg", "daily_reports", "rep_emp_eg")));
});

// =============================================================================
// SECTION 12: GLOBAL HR CROSS-COUNTRY & FINANCIAL WORKFLOWS (POSITIVE)
// =============================================================================
console.log("\n--- Section 12: Global HR Cross-Country & Financial Workflows ---");

await test("12.1 [POSITIVE] Global HR CAN read employee in Egypt branch (scoped country)", async () => {
  await assertSucceeds(getDoc(doc(globalHrDb, "companies", "comp_eg", "employees", "emp_victim_eg")));
});

await test("12.2 [POSITIVE] Global HR CAN read employee in Saudi branch (scoped country)", async () => {
  await assertSucceeds(getDoc(doc(globalHrDb, "companies", "comp_eg", "employees", "emp_saudi_branch")));
});

await test("12.3 [NEGATIVE] Global HR CANNOT read employee in separate Saudi company (cross-tenant blocked)", async () => {
  await assertFails(getDoc(doc(globalHrDb, "companies", "comp_sa", "employees", "emp_victim_sa")));
});

await test("12.4 [NEGATIVE] Global HR CANNOT read employee in separate UAE company (cross-tenant blocked)", async () => {
  await assertFails(getDoc(doc(globalHrDb, "companies", "comp_ae", "employees", "emp_uae")));
});

await test("12.5 [POSITIVE] Legitimate financial posting: balanced GL journal committed", async () => {
  await assertSucceeds(
    setDoc(doc(adminEgDb, "companies", "comp_eg", "journals", "jrnl_valid_posting"), {
      totalDebit: 32000,
      totalCredit: 32000,
      date: "2026-11-09",
      journalNumber: "JE-2026-11-01",
    })
  );
});

// =============================================================================
// SUMMARY OF FINAL ACCEPTANCE AUDIT
// =============================================================================
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;

console.log("\n=================================================================");
console.log(` FINAL ACCEPTANCE SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${results.length})`);
console.log("=================================================================\n");

await testEnv.cleanup();
if (failed > 0) {
  process.exit(1);
}

