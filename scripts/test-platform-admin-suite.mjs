/**
 * D-ARROW — Platform Administrator Comprehensive Security & Authorization Test Suite
 *
 * Verifies:
 * 1. Cross-Company & Cross-Tenant Visibility & Operations (Company A & Company B)
 * 2. Financial Authority & Structural Accounting Integrity (GL Journals, Vouchers, Disbursements, Payroll)
 * 3. User Administration & Account Status Management (Active, Suspended, Disabled, Role Escalation Protection)
 * 4. Append-Only Immutable Audit Trail (update/delete strictly denied)
 * 5. Negative Security & Privilege Escalation Prevention
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
  collection,
  getDocs,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS - ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
    console.error(`FAIL - ${name}: ${err?.message ?? err}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "platform-admin-suite",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed test fixtures without going through rules
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // 1. Companies
  await setDoc(doc(db, "companies", "comp_egypt"), {
    name: "D-Arrow Egypt",
    primaryActivity: "PROJECTS",
    country: "EG",
  });

  await setDoc(doc(db, "companies", "comp_saudi"), {
    name: "D-Arrow Saudi Arabia",
    primaryActivity: "REAL_ESTATE_MANAGEMENT",
    country: "SA",
  });

  // 2. Users
  // Target Platform Admin: Khulod Ahmed
  await setDoc(doc(db, "users", "uid_platform_admin"), {
    email: "khulodahmed390@gmail.com",
    role: "platform_admin",
    companyId: "comp_egypt",
    status: "active",
    countryScope: ["EG", "SA"],
    portalAccess: ["dashboard", "crm", "tasks", "people", "financial", "inventory", "operations", "strategy", "support", "pos", "rem"],
    portalSubRoles: { tasks: "admin", crm: "admin", people: "admin", billing: "admin" },
  });

  // Egypt Tenant Admin
  await setDoc(doc(db, "users", "uid_eg_admin"), {
    email: "admin.eg@darrow.com",
    role: "admin",
    companyId: "comp_egypt",
    status: "active",
  });

  // Saudi Tenant Admin
  await setDoc(doc(db, "users", "uid_sa_admin"), {
    email: "admin.sa@darrow.com",
    role: "admin",
    companyId: "comp_saudi",
    status: "active",
  });

  // Regular Employee (Egypt)
  await setDoc(doc(db, "users", "uid_eg_employee"), {
    email: "employee.eg@darrow.com",
    role: "employee",
    companyId: "comp_egypt",
    status: "active",
  });

  // Regular Employee (Saudi)
  await setDoc(doc(db, "users", "uid_sa_employee"), {
    email: "employee.sa@darrow.com",
    role: "employee",
    companyId: "comp_saudi",
    status: "active",
  });

  // Seed sample company docs
  await setDoc(doc(db, "companies", "comp_egypt", "projects", "proj_eg_1"), {
    title: "Cairo Tower Renovations",
  });
  await setDoc(doc(db, "companies", "comp_saudi", "projects", "proj_sa_1"), {
    title: "Riyadh Boulevard Development",
  });
});

const platformAdminCtx = testEnv.authenticatedContext("uid_platform_admin", {
  role: "platform_admin",
  email: "khulodahmed390@gmail.com",
});
const egAdminCtx = testEnv.authenticatedContext("uid_eg_admin", {
  role: "admin",
  companyId: "comp_egypt",
});
const saAdminCtx = testEnv.authenticatedContext("uid_sa_admin", {
  role: "admin",
  companyId: "comp_saudi",
});
const egEmpCtx = testEnv.authenticatedContext("uid_eg_employee", {
  role: "employee",
  companyId: "comp_egypt",
});

const paDb = platformAdminCtx.firestore();
const egAdminDb = egAdminCtx.firestore();
const saAdminDb = saAdminCtx.firestore();
const egEmpDb = egEmpCtx.firestore();

// ============================================================================
// SECTION 1: CROSS-COMPANY & CROSS-TENANT VISIBILITY & OPERATIONS
// ============================================================================

await check("Platform Admin CAN read company profile across all companies (Egypt & Saudi)", async () => {
  const egSnap = await assertSucceeds(getDoc(doc(paDb, "companies", "comp_egypt")));
  const saSnap = await assertSucceeds(getDoc(doc(paDb, "companies", "comp_saudi")));
  if (!egSnap.exists() || !saSnap.exists()) throw new Error("Expected both company profiles to exist");
});

await check("Platform Admin CAN read projects across all companies (Egypt & Saudi)", async () => {
  await assertSucceeds(getDoc(doc(paDb, "companies", "comp_egypt", "projects", "proj_eg_1")));
  await assertSucceeds(getDoc(doc(paDb, "companies", "comp_saudi", "projects", "proj_sa_1")));
});

await check("Platform Admin CAN create resources in any company", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_saudi", "projects", "proj_sa_2"), {
    title: "Jeddah Corniche Center",
  }));
});

await check("Tenant Admin (Egypt) CANNOT read Saudi company documents (cross-tenant isolation)", async () => {
  await assertFails(getDoc(doc(egAdminDb, "companies", "comp_saudi", "projects", "proj_sa_1")));
});

await check("Tenant Admin (Egypt) CANNOT write to Saudi company (cross-tenant write denied)", async () => {
  await assertFails(setDoc(doc(egAdminDb, "companies", "comp_saudi", "projects", "proj_sa_attack"), {
    title: "Unauthorized Project",
  }));
});

// ============================================================================
// SECTION 2: FINANCIAL OPERATIONS AUTHORITY & ACCOUNTING INTEGRITY
// ============================================================================

await check("Platform Admin CAN post balanced General Ledger journal entry", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_egypt", "journals", "jrnl_001"), {
    date: "2026-11-09",
    description: "Annual Software License Allocation",
    totalDebit: 50000,
    totalCredit: 50000,
    status: "posted",
  }));
});

await check("Platform Admin CANNOT post unbalanced General Ledger journal entry (integrity enforced)", async () => {
  await assertFails(setDoc(doc(paDb, "companies", "comp_egypt", "journals", "jrnl_unbalanced"), {
    date: "2026-11-09",
    description: "Unbalanced Journal Attack",
    totalDebit: 50000,
    totalCredit: 25000,
    status: "posted",
  }));
});

await check("Platform Admin CANNOT modify posted General Ledger journal (GL immutability)", async () => {
  await assertFails(updateDoc(doc(paDb, "companies", "comp_egypt", "journals", "jrnl_001"), {
    totalDebit: 60000,
  }));
});

await check("Platform Admin CANNOT delete posted General Ledger journal (GL delete prohibited)", async () => {
  await assertFails(deleteDoc(doc(paDb, "companies", "comp_egypt", "journals", "jrnl_001")));
});

await check("Platform Admin CAN issue payment vouchers in any company", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_saudi", "vouchers", "vchr_001"), {
    voucherType: "PAYMENT",
    amount: 15000,
    payee: "Gulf Cloud Solutions",
    status: "approved",
  }));
});

await check("Platform Admin CAN execute payroll payments in any company", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_egypt", "payroll_payments", "pay_001"), {
    period: "2026-11",
    totalDisbursement: 125000,
    status: "disbursed",
  }));
});

await check("Platform Admin CAN create valid payment records", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_saudi", "payments", "pmt_001"), {
    amount: 8500,
    method: "bank_transfer",
  }));
});

await check("Platform Admin CANNOT create payment with zero or negative amount", async () => {
  await assertFails(setDoc(doc(paDb, "companies", "comp_saudi", "payments", "pmt_invalid"), {
    amount: 0,
    method: "bank_transfer",
  }));
});

// ============================================================================
// SECTION 3: USER LIFECYCLE & ACCOUNT STATUS CONTROLS
// ============================================================================

await check("Platform Admin CAN view all users across all tenants", async () => {
  await assertSucceeds(getDoc(doc(paDb, "users", "uid_eg_employee")));
  await assertSucceeds(getDoc(doc(paDb, "users", "uid_sa_employee")));
});

await check("Platform Admin CAN suspend an employee account", async () => {
  await assertSucceeds(updateDoc(doc(paDb, "users", "uid_eg_employee"), {
    status: "suspended",
  }));
});

await check("Platform Admin CAN disable an employee account", async () => {
  await assertSucceeds(updateDoc(doc(paDb, "users", "uid_eg_employee"), {
    status: "disabled",
  }));
});

await check("Platform Admin CAN reactivate a disabled account", async () => {
  await assertSucceeds(updateDoc(doc(paDb, "users", "uid_eg_employee"), {
    status: "active",
  }));
});

await check("Platform Admin CAN update roles and permissions across tenants", async () => {
  await assertSucceeds(updateDoc(doc(paDb, "users", "uid_sa_employee"), {
    role: "manager",
    customPermissions: ["reports.view_all"],
  }));
});

await check("Tenant Admin CANNOT modify Platform Admin document", async () => {
  await assertFails(updateDoc(doc(egAdminDb, "users", "uid_platform_admin"), {
    status: "disabled",
  }));
});

await check("Tenant Admin CANNOT delete Platform Admin document", async () => {
  await assertFails(deleteDoc(doc(egAdminDb, "users", "uid_platform_admin")));
});

await check("Tenant Admin CANNOT escalate a member to platform_admin role", async () => {
  await assertFails(updateDoc(doc(egAdminDb, "users", "uid_eg_employee"), {
    role: "platform_admin",
  }));
});

await check("Ordinary employee CANNOT modify own role or permissions", async () => {
  await assertFails(updateDoc(doc(egEmpDb, "users", "uid_eg_employee"), {
    role: "platform_admin",
  }));
});

// ============================================================================
// SECTION 4: APPEND-ONLY IMMUTABLE AUDIT TRAIL
// ============================================================================

await check("Platform Admin CAN write platform-wide audit log entry", async () => {
  await assertSucceeds(setDoc(doc(paDb, "audit_logs", "log_platform_001"), {
    actorUid: "uid_platform_admin",
    action: "STATUS_CHANGE",
    targetEntity: "user",
    targetId: "uid_eg_employee",
    result: "SUCCESS",
    timestamp: "2026-11-09T18:00:00Z",
  }));
});

await check("Platform-wide audit log entry CANNOT be updated (immutability)", async () => {
  await assertFails(updateDoc(doc(paDb, "audit_logs", "log_platform_001"), {
    action: "TAMPERED_ACTION",
  }));
});

await check("Platform-wide audit log entry CANNOT be deleted (tamper-proof)", async () => {
  await assertFails(deleteDoc(doc(paDb, "audit_logs", "log_platform_001")));
});

await check("Tenant-level audit log entry CANNOT be updated", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_egypt", "audit_logs", "log_eg_001"), {
    actorUid: "uid_platform_admin",
    action: "TENANT_SETTING_UPDATE",
    timestamp: "2026-11-09T18:00:00Z",
  }));
  await assertFails(updateDoc(doc(paDb, "companies", "comp_egypt", "audit_logs", "log_eg_001"), {
    action: "TAMPERED_TENANT_ACTION",
  }));
});

await check("Tenant-level audit log entry CANNOT be deleted", async () => {
  await assertFails(deleteDoc(doc(paDb, "companies", "comp_egypt", "audit_logs", "log_eg_001")));
});

// ============================================================================
// SECTION 5: REAL ESTATE MANAGEMENT & MULTI-ACTIVITY PERMISSIONS
// ============================================================================

await check("Platform Admin CAN record and manage REM lease in Saudi company", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_saudi", "rem_leases", "lease_001"), {
    status: "active",
    tenantName: "Arabian Retail Corp",
    propertyId: "prop_riyadh_01",
  }));
});

await check("Platform Admin CAN record REM rent payment", async () => {
  await assertSucceeds(setDoc(doc(paDb, "companies", "comp_saudi", "rem_rent_payments", "pay_rem_001"), {
    amount: 30000,
    createdBy: "uid_platform_admin",
    date: "2026-11-09",
    status: "completed",
  }));
});

// ============================================================================
// SUMMARY & CLEANUP
// ============================================================================

await testEnv.cleanup();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log("\n========================================================");
console.log(`PLATFORM ADMIN TEST RESULTS: ${passed}/${results.length} PASSED (${failed} FAILED)`);
console.log("========================================================");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

