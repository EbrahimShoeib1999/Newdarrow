/**
 * D-ARROW — Targeted Adversarial Security Audit Suite (V2)
 *
 * Verifies and proves:
 * 1. `isPlatformAdmin()` Firestore profile fallback behavior and potential unauthorized privilege grant.
 * 2. Wildcard additive permission vulnerabilities on unlisted collections (`employees`, `invoices`).
 * 3. Financial authorization vulnerabilities on `payroll_payments` and `vouchers`.
 * 4. Self-identity deletion and super_admin deletion/mutation risks by `platform_admin`.
 * 5. Audit log authenticity and client forgery vulnerability (`actorUid` spoofing).
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

const testEnv = await initializeTestEnvironment({
  projectId: "adversarial-audit-v2",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed baseline fixtures without rules
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // Company A
  await setDoc(doc(db, "companies", "comp_a"), {
    name: "Company A",
    primaryActivity: "PROJECTS",
  });
  // Company B
  await setDoc(doc(db, "companies", "comp_b"), {
    name: "Company B",
    primaryActivity: "REAL_ESTATE_MANAGEMENT",
  });

  // User 1: Real Platform Admin (both Auth claims and Firestore profile)
  await setDoc(doc(db, "users", "uid_real_pa"), {
    email: "khulodahmed390@gmail.com",
    role: "platform_admin",
    companyId: "comp_a",
  });

  // User 2: Super Admin
  await setDoc(doc(db, "users", "uid_super_admin"), {
    email: "superadmin@darrow.com",
    role: "super_admin",
    companyId: "comp_a",
  });

  // User 3: Compromised / Fallback Profile (Role = platform_admin in Firestore, but NO custom claims!)
  await setDoc(doc(db, "users", "uid_fallback_pa"), {
    email: "attacker@darrow.com",
    role: "platform_admin",
    companyId: "comp_a",
  });

  // User 4: Regular Employee in Company A
  await setDoc(doc(db, "users", "uid_emp_a"), {
    email: "employee@darrow.com",
    role: "employee",
    companyId: "comp_a",
  });

  // User 5: Target Employee Record in Company A
  await setDoc(doc(db, "companies", "comp_a", "employees", "emp_victim"), {
    name: "Victim Employee",
    salary: 10000,
    jobTitle: "Senior Engineer",
  });

  // Seed sample invoice
  await setDoc(doc(db, "companies", "comp_a", "invoices", "inv_001"), {
    invoiceNumber: "INV-2026-001",
    amount: 50000,
  });

  // Seed sample project in Company B
  await setDoc(doc(db, "companies", "comp_b", "projects", "proj_b1"), {
    title: "Company B Confidential Project",
  });
});

const realPaCtx = testEnv.authenticatedContext("uid_real_pa", {
  role: "platform_admin",
  email: "khulodahmed390@gmail.com",
});

// Notice: fallbackPaCtx has NO custom claims! It has default claims {}.
const fallbackPaCtx = testEnv.authenticatedContext("uid_fallback_pa", {});

// Regular employee context
const empCtx = testEnv.authenticatedContext("uid_emp_a", {
  role: "employee",
  companyId: "comp_a",
});

const realPaDb = realPaCtx.firestore();
const fallbackDb = fallbackPaCtx.firestore();
const empDb = empCtx.firestore();

console.log("\n=================================================================");
console.log(" D-ARROW: TARGETED ADVERSARIAL SECURITY AUDIT (V2)");
console.log("=================================================================\n");

// -----------------------------------------------------------------------------
// AUDIT ITEM 1: isPlatformAdmin() Firestore Profile Fallback Proof
// -----------------------------------------------------------------------------
console.log("--- 1. Testing isPlatformAdmin() Firestore Profile Fallback ---");

let fallbackReadSucceeded = false;
try {
  await getDoc(doc(fallbackDb, "companies", "comp_b", "projects", "proj_b1"));
  fallbackReadSucceeded = true;
  console.log("FINDING: Fallback user (NO custom claims, only Firestore profile) CAN read other company docs!");
} catch (e) {
  console.log("Fallback user read blocked:", e.message);
}

let fallbackGlWriteSucceeded = false;
try {
  await setDoc(doc(fallbackDb, "companies", "comp_b", "journals", "jrnl_fallback_01"), {
    date: "2026-11-09",
    totalDebit: 1000,
    totalCredit: 1000,
  });
  fallbackGlWriteSucceeded = true;
  console.log("FINDING: Fallback user (NO custom claims, only Firestore profile) CAN post GL journals in another company!");
} catch (e) {
  console.log("Fallback user GL post blocked:", e.message);
}

// -----------------------------------------------------------------------------
// AUDIT ITEM 2: Wildcard Additive Permission Vulnerability on `employees` & `invoices`
// -----------------------------------------------------------------------------
console.log("\n--- 2. Testing Wildcard Additive Permissions on unlisted collections ---");

let empCanDeleteEmployee = false;
try {
  await deleteDoc(doc(empDb, "companies", "comp_a", "employees", "emp_victim"));
  empCanDeleteEmployee = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN delete another employee document in `companies/{companyId}/employees/{empId}`!");
} catch (e) {
  console.log("Ordinary employee delete of employee blocked:", e.message);
}

let empCanDeleteInvoice = false;
try {
  await deleteDoc(doc(empDb, "companies", "comp_a", "invoices", "inv_001"));
  empCanDeleteInvoice = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN delete invoices in `companies/{companyId}/invoices/{invId}`!");
} catch (e) {
  console.log("Ordinary employee delete of invoice blocked:", e.message);
}

// -----------------------------------------------------------------------------
// AUDIT ITEM 3: Financial Workflows - Vouchers and Payroll Payments
// -----------------------------------------------------------------------------
console.log("\n--- 3. Testing Financial Workflows (Vouchers & Payroll Payments) ---");

let empCanCreatePayrollPayment = false;
try {
  await setDoc(doc(empDb, "companies", "comp_a", "payroll_payments", "pay_unauthorized"), {
    amount: -50000,
    recipient: "uid_emp_a",
  });
  empCanCreatePayrollPayment = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN create payroll_payments with negative amounts!");
} catch (e) {
  console.log("Ordinary employee payroll payment create blocked:", e.message);
}

let empCanCreateVoucher = false;
try {
  await setDoc(doc(empDb, "companies", "comp_a", "vouchers", "vchr_unauthorized"), {
    amount: 100000,
    payee: "employee personal account",
  });
  empCanCreateVoucher = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN create vouchers in `companies/{companyId}/vouchers`!");
} catch (e) {
  console.log("Ordinary employee voucher create blocked:", e.message);
}

// -----------------------------------------------------------------------------
// AUDIT ITEM 4: Platform Admin Self-Identity & super_admin Deletion Risks
// -----------------------------------------------------------------------------
console.log("\n--- 4. Testing Platform Admin Identity Deletion Restrictions ---");

let paCanDeleteSelf = false;
try {
  await deleteDoc(doc(realPaDb, "users", "uid_real_pa"));
  paCanDeleteSelf = true;
  console.log("CRITICAL FINDING: Platform Admin CAN delete own user document (`uid_real_pa`)!");
} catch (e) {
  console.log("Platform Admin self-delete blocked:", e.message);
}

let paCanDeleteSuperAdmin = false;
try {
  await deleteDoc(doc(realPaDb, "users", "uid_super_admin"));
  paCanDeleteSuperAdmin = true;
  console.log("CRITICAL FINDING: Platform Admin CAN delete super_admin user document (`uid_super_admin`)!");
} catch (e) {
  console.log("Platform Admin delete of super_admin blocked:", e.message);
}

// -----------------------------------------------------------------------------
// AUDIT ITEM 5: Audit Log Authenticity & Client Forgery
// -----------------------------------------------------------------------------
console.log("\n--- 5. Testing Audit Log Authenticity & Client Forgery ---");

let empCanForgeAuditLog = false;
try {
  await setDoc(doc(empDb, "audit_logs", "forged_log_001"), {
    actorUid: "uid_real_pa",
    actorEmail: "khulodahmed390@gmail.com",
    action: "DISBURSE_ALL_FUNDS",
    targetEntity: "company_treasury",
    result: "SUCCESS",
    timestamp: "2026-11-09T18:00:00Z",
  });
  empCanForgeAuditLog = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN forge audit logs impersonating Platform Admin in root `/audit_logs`!");
} catch (e) {
  console.log("Ordinary employee audit log forgery blocked:", e.message);
}

let empCanForgeTenantAuditLog = false;
try {
  await setDoc(doc(empDb, "companies", "comp_a", "audit_logs", "forged_tenant_log_001"), {
    actorUid: "uid_super_admin",
    action: "AUTHORIZED_EXECUTIVE_BONUS",
    result: "SUCCESS",
  });
  empCanForgeTenantAuditLog = true;
  console.log("CRITICAL FINDING: Ordinary employee CAN forge tenant audit logs impersonating Super Admin in `companies/{companyId}/audit_logs`!");
} catch (e) {
  console.log("Ordinary employee tenant audit log forgery blocked:", e.message);
}

console.log("\n=================================================================");
console.log(" ADVERSARIAL AUDIT SUMMARY");
console.log(` 1. Fallback Profile Grants Platform Admin: ${fallbackReadSucceeded && fallbackGlWriteSucceeded ? "CONFIRMED VULNERABILITY" : "PROTECTED"}`);
console.log(` 2. Wildcard Deletion of Employees/Invoices: ${empCanDeleteEmployee || empCanDeleteInvoice ? "CONFIRMED VULNERABILITY" : "PROTECTED"}`);
console.log(` 3. Unauthorized Payroll/Voucher Creation:  ${empCanCreatePayrollPayment || empCanCreateVoucher ? "CONFIRMED VULNERABILITY" : "PROTECTED"}`);
console.log(` 4. Platform Admin Self/SuperAdmin Delete:  ${paCanDeleteSelf || paCanDeleteSuperAdmin ? "CONFIRMED RISK" : "PROTECTED"}`);
console.log(` 5. Audit Log Impersonation & Forgery:     ${empCanForgeAuditLog || empCanForgeTenantAuditLog ? "CONFIRMED VULNERABILITY" : "PROTECTED"}`);
console.log("=================================================================\n");

await testEnv.cleanup();

