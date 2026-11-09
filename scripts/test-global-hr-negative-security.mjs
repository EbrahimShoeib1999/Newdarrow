/**
 * D-Arrow — Global HR Negative Security Suite
 *
 * Verifies strict security hardening and negative boundaries under Firestore Rules:
 *   1. Global HR can view Egypt and Saudi employees in own company
 *   2. Global HR cannot view employees in foreign company
 *   3. Global HR cannot assign admin
 *   4. Global HR cannot assign super_admin
 *   5. Global HR cannot modify companyId
 *   6. Global HR cannot grant customPermissions
 *   7. Global HR cannot modify privileged accounts (admin user doc)
 *   8. Global HR cannot change financial permissions (portalSubRoles.billing)
 *   9. Global HR cannot post journal entries
 *  10. Global HR cannot issue payment vouchers / payments
 *  11. Regular employees cannot access Global HR capabilities
 *  12. Company admins retain existing legitimate permissions
 *
 * Run with: npx -y firebase-tools@13.35.1 emulators:exec --only firestore --project rules-negative-check "node scripts/test-global-hr-negative-security.mjs"
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
} from "firebase/firestore";

const COMPANY_DARROW = "co-darrow-global";
const COMPANY_FOREIGN = "co-foreign-corp";

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

const testEnv = await initializeTestEnvironment({
  projectId: "rules-negative-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed test fixtures without rules
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // 1. Companies
  await setDoc(doc(db, "companies", COMPANY_DARROW), {
    name: "D-Arrow Global Corp",
    primaryActivity: "PROJECTS",
    countries: ["Egypt", "Saudi Arabia"],
  });
  await setDoc(doc(db, "companies", COMPANY_FOREIGN), {
    name: "Foreign Corp Ltd",
    primaryActivity: "PROJECTS",
    countries: ["Saudi Arabia"],
  });

  // 2. Users in D-Arrow
  await setDoc(doc(db, "users", "admin-user"), {
    companyId: COMPANY_DARROW,
    role: "admin",
    email: "admin@darrow.test",
    status: "active",
  });
  await setDoc(doc(db, "users", "super-admin-user"), {
    companyId: COMPANY_DARROW,
    role: "super_admin",
    email: "super@darrow.test",
    status: "active",
  });
  await setDoc(doc(db, "users", "disabled-employee"), {
    companyId: COMPANY_DARROW,
    role: "employee",
    email: "disabled@darrow.test",
    status: "disabled",
    country: "Egypt",
    portalAccess: ["people"],
  });
  await setDoc(doc(db, "users", "global-hr-user"), {
    companyId: COMPANY_DARROW,
    role: "global_hr_manager",
    email: "khulodahmed390@gmail.com",
    country: "Egypt",
    countryScope: ["EG", "SA"],
    portalAccess: ["people", "tasks", "attendance"],
    portalSubRoles: { people: "admin", tasks: "member" },
    status: "active",
  });
  await setDoc(doc(db, "users", "employee-cairo"), {
    companyId: COMPANY_DARROW,
    role: "employee",
    email: "cairo@darrow.test",
    country: "Egypt",
    portalAccess: ["people"],
  });
  await setDoc(doc(db, "users", "employee-riyadh"), {
    companyId: COMPANY_DARROW,
    role: "employee",
    email: "riyadh@darrow.test",
    country: "Saudi Arabia",
    portalAccess: ["people"],
  });

  // 3. User in Foreign Company
  await setDoc(doc(db, "users", "foreign-user"), {
    companyId: COMPANY_FOREIGN,
    role: "employee",
    email: "foreign@other.test",
    country: "Saudi Arabia",
  });

  // 4. Employees in D-Arrow
  await setDoc(doc(db, `companies/${COMPANY_DARROW}/employees/emp-eg-1`), {
    id: "emp-eg-1",
    name: "Cairo Engineer",
    country: "Egypt",
    companyId: COMPANY_DARROW,
  });
  await setDoc(doc(db, `companies/${COMPANY_DARROW}/employees/emp-sa-1`), {
    id: "emp-sa-1",
    name: "Riyadh Specialist",
    country: "Saudi Arabia",
    companyId: COMPANY_DARROW,
  });

  // 5. Employee in Foreign Company
  await setDoc(doc(db, `companies/${COMPANY_FOREIGN}/employees/emp-foreign-1`), {
    id: "emp-foreign-1",
    name: "Foreign Employee",
    country: "Saudi Arabia",
    companyId: COMPANY_FOREIGN,
  });

  // 6. Test invite & bill fixtures
  await setDoc(doc(db, "invites", "tok-test-invite"), {
    token: "tok-test-invite",
    companyId: COMPANY_DARROW,
    email: "invited@darrow.test",
    role: "employee",
    status: "pending",
  });
  await setDoc(doc(db, `companies/${COMPANY_DARROW}/bills/bill-pending-1`), {
    amount: 1200,
    vendorName: "Supplier Co",
    approvalStatus: "pending",
    createdAt: "2026-11-09",
  });
});

console.log("\n=================================================================");
console.log(" D-ARROW: GLOBAL HR NEGATIVE SECURITY TEST SUITE");
console.log("=================================================================\n");

const hrCtx = testEnv.authenticatedContext("global-hr-user");
const hrDb = hrCtx.firestore();

const empCtx = testEnv.authenticatedContext("employee-cairo");
const empDb = empCtx.firestore();

const adminCtx = testEnv.authenticatedContext("admin-user");
const adminDb = adminCtx.firestore();

// Test 1: Global HR can view Egypt and Saudi employees in its own company
await check("1. Global HR can view Egypt and Saudi employees in own company", async () => {
  const egSnap = await getDoc(doc(hrDb, `companies/${COMPANY_DARROW}/employees/emp-eg-1`));
  const saSnap = await getDoc(doc(hrDb, `companies/${COMPANY_DARROW}/employees/emp-sa-1`));
  if (!egSnap.exists() || !saSnap.exists()) throw new Error("Could not read own company employees");
});

// Test 2: Global HR cannot view employees in foreign company
await check("2. Global HR cannot view employees in a foreign company", async () => {
  await assertFails(getDoc(doc(hrDb, `companies/${COMPANY_FOREIGN}/employees/emp-foreign-1`)));
});

// Test 3: Global HR cannot assign admin
await check("3. Global HR cannot assign admin role to a teammate", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    role: "admin",
  }));
});

// Test 4: Global HR cannot assign super_admin
await check("4. Global HR cannot assign super_admin role to a teammate", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    role: "super_admin",
  }));
});

// Test 5: Global HR cannot modify companyId
await check("5. Global HR cannot modify another user's companyId", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    companyId: COMPANY_FOREIGN,
  }));
});

// Test 6: Global HR cannot grant customPermissions
await check("6. Global HR cannot grant arbitrary customPermissions to a teammate", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    customPermissions: ["billing.post_journals", "admin.all"],
  }));
});

// Test 7: Global HR cannot modify privileged accounts (admin user doc)
await check("7. Global HR cannot modify or alter an admin user document", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "admin-user"), {
    name: "Tampered Admin Name",
    status: "inactive",
  }));
});

// Test 8: Global HR cannot change financial permissions (portalSubRoles.billing)
await check("8. Global HR cannot grant financial portal sub-roles (portalSubRoles.billing)", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    portalSubRoles: { billing: "admin" },
  }));
});

// Test 8b: Global HR cannot modify portalSubRoles.tasks
await check("8b. Global HR cannot modify portalSubRoles.tasks", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    portalSubRoles: { tasks: "manager" },
  }));
});

// Test 8c: Global HR cannot modify portalSubRoles.crm
await check("8c. Global HR cannot modify portalSubRoles.crm", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    portalSubRoles: { crm: "manager" },
  }));
});

// Test 8d: Global HR cannot modify portalSubRoles.people
await check("8d. Global HR cannot modify portalSubRoles.people", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    portalSubRoles: { people: "admin" },
  }));
});

// Test 8e: Global HR cannot modify countryScope on another user
await check("8e. Global HR cannot modify countryScope on another user", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    countryScope: ["EG", "SA", "AE"],
  }));
});

// Test 8f: Global HR cannot modify portalAccess on another user
await check("8f. Global HR cannot modify portalAccess on another user", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    portalAccess: ["people", "billing"],
  }));
});

// Test 8g: Global HR cannot delete any user document
await check("8g. Global HR cannot delete any user document", async () => {
  await assertFails(deleteDoc(doc(hrDb, "users", "employee-cairo")));
});

// Test 8h: Global HR CAN update neutral employee profile fields while preserving auth controls
await check("8h. Global HR CAN update neutral employee profile fields", async () => {
  await assertSucceeds(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    name: "Cairo Updated Engineer",
    department: "Engineering",
  }));
});

// --- SECTION 1: ACCOUNT STATUS PROTECTION ---

// Test 8i: Global HR cannot disable another employee user account
await check("8i. Global HR cannot disable another employee user account", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    status: "disabled",
  }));
});

// Test 8j: Global HR cannot suspend another employee user account
await check("8j. Global HR cannot suspend another employee user account", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    status: "suspended",
  }));
});

// Test 8k: Global HR cannot change employee status to unauthorized state
await check("8k. Global HR cannot change employee status to unauthorized state", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    status: "unauthorized_arbitrary_state",
  }));
});

// Test 8l: Global HR cannot modify admin or super_admin account status
await check("8l. Global HR cannot modify admin or super_admin account status", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "admin-user"), {
    status: "disabled",
  }));
});

// Test 8m: Global HR cannot reactivate a disabled privileged account
await check("8m. Global HR cannot reactivate a disabled privileged account", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "admin-user"), {
    status: "active",
  }));
});

// Test 8n: Company Admin CAN update user account status (allowed transition)
await check("8n. Company Admin CAN update user account status", async () => {
  await assertSucceeds(updateDoc(doc(adminDb, "users", "employee-cairo"), {
    status: "active",
  }));
});

// Test 8o: Global HR CAN manage employee employment lifecycle status in own company
await check("8o. Global HR CAN update employment lifecycle status on employee record", async () => {
  await assertSucceeds(updateDoc(doc(hrDb, `companies/${COMPANY_DARROW}/employees/emp-eg-1`), {
    status: "active",
    department: "Human Resources",
  }));
});

// Test 8p: Global HR cannot reactivate a disabled regular employee in users collection
await check("8p. Global HR cannot reactivate a disabled regular employee account", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "disabled-employee"), {
    status: "active",
  }));
});

// Test 8q: Global HR cannot set status to 'terminated' or 'archived' in users collection
await check("8q. Global HR cannot set status to terminated or archived in users collection", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    status: "terminated",
  }));
  await assertFails(updateDoc(doc(hrDb, "users", "employee-cairo"), {
    status: "archived",
  }));
});

// Test 8r: Global HR cannot modify super_admin user document or status
await check("8r. Global HR cannot modify super_admin user document or status", async () => {
  await assertFails(updateDoc(doc(hrDb, "users", "super-admin-user"), {
    status: "disabled",
  }));
  await assertFails(updateDoc(doc(hrDb, "users", "super-admin-user"), {
    name: "Tampered Super Admin",
  }));
});

// Test 8s: Global HR cannot alter invite status to disabled or suspended
await check("8s. Global HR cannot alter invite status to disabled or suspended", async () => {
  await assertFails(updateDoc(doc(hrDb, "invites", "tok-test-invite"), {
    status: "disabled",
  }));
  await assertFails(updateDoc(doc(hrDb, "invites", "tok-test-invite"), {
    status: "suspended",
  }));
});

// --- SECTION 2: FINANCIAL AUTHORIZATION TESTS ---

// Test 9: Global HR is denied when attempting a structurally and financially BALANCED General Ledger journal posting
await check("9. Global HR is denied when attempting a BALANCED General Ledger journal posting", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/journals/j-hr-bal-1`), {
    entryNumber: "JE-2026-HR",
    date: "2026-11-09",
    totalDebit: 1500,
    totalCredit: 1500, // Valid balanced debit/credit payload!
    description: "HR attempted balanced journal posting",
  }));
});

// Test 9b: Legitimate Admin CAN post a balanced journal entry
await check("9b. Legitimate Admin CAN post a balanced journal entry", async () => {
  await assertSucceeds(setDoc(doc(adminDb, `companies/${COMPANY_DARROW}/journals/j-admin-bal-1`), {
    entryNumber: "JE-2026-ADM",
    date: "2026-11-09",
    totalDebit: 1500,
    totalCredit: 1500,
    description: "Admin authorized balanced journal",
  }));
});

// Test 10: Global HR is denied when attempting a valid payment voucher
await check("10. Global HR is denied when attempting a valid payment voucher", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/vouchers/vouc-hr-1`), {
    voucherType: "disbursement",
    voucherNumber: "PAY-9999",
    amount: 2500, // Valid positive amount!
    date: "2026-11-09",
    currency: "SAR",
    status: "posted",
  }));
});

// Test 10b: Legitimate Admin CAN create a valid payment voucher
await check("10b. Legitimate Admin CAN create a valid payment voucher", async () => {
  await assertSucceeds(setDoc(doc(adminDb, `companies/${COMPANY_DARROW}/vouchers/vouc-admin-1`), {
    voucherType: "disbursement",
    voucherNumber: "PAY-1001",
    amount: 2500,
    date: "2026-11-09",
    currency: "SAR",
    status: "posted",
  }));
});

// Test 10c: Global HR is denied when attempting a valid disbursement operation
await check("10c. Global HR is denied when attempting a valid disbursement operation", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/payments/pay-hr-valid-1`), {
    amount: 1750, // Valid positive amount!
    currency: "SAR",
    paymentDate: "2026-11-09",
    invoiceId: "inv-legit-001",
  }));
});

// Test 10d: Legitimate Admin CAN issue a valid disbursement operation
await check("10d. Legitimate Admin CAN issue a valid disbursement operation", async () => {
  await assertSucceeds(setDoc(doc(adminDb, `companies/${COMPANY_DARROW}/payments/pay-admin-valid-1`), {
    amount: 1750,
    currency: "SAR",
    paymentDate: "2026-11-09",
    invoiceId: "inv-legit-001",
  }));
});

// Test 10e: Global HR is denied when attempting payroll payment execution
await check("10e. Global HR is denied when attempting payroll payment execution", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/payroll_payments/payroll-hr-1`), {
    amount: 45000,
    month: "2026-11",
    currency: "SAR",
    executedAt: "2026-11-09",
    status: "disbursed",
  }));
});

// Test 10f: Legitimate Admin CAN execute payroll payment record
await check("10f. Legitimate Admin CAN execute payroll payment record", async () => {
  await assertSucceeds(setDoc(doc(adminDb, `companies/${COMPANY_DARROW}/payroll_payments/payroll-admin-1`), {
    amount: 45000,
    month: "2026-11",
    currency: "SAR",
    executedAt: "2026-11-09",
    status: "disbursed",
  }));
});

// Test 10g: Global HR is denied when attempting financial closing operations
await check("10g. Global HR is denied when attempting financial closing operations", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/settings/fiscal_closing`), {
    year: 2026,
    isClosed: true,
    closedAt: "2026-11-09",
  }));
});

// Test 10h: Legitimate Admin CAN perform financial closing operations
await check("10h. Legitimate Admin CAN perform financial closing operations", async () => {
  await assertSucceeds(setDoc(doc(adminDb, `companies/${COMPANY_DARROW}/settings/fiscal_closing`), {
    year: 2026,
    isClosed: true,
    closedAt: "2026-11-09",
  }));
});

// Test 10i: Global HR is denied when attempting to approve a vendor bill (review/approval)
await check("10i. Global HR is denied when attempting to approve a vendor bill", async () => {
  await assertFails(updateDoc(doc(hrDb, `companies/${COMPANY_DARROW}/bills/bill-pending-1`), {
    approvalStatus: "approved",
  }));
});

// Test 10j: Legitimate Admin CAN approve a vendor bill
await check("10j. Legitimate Admin CAN approve a vendor bill", async () => {
  await assertSucceeds(updateDoc(doc(adminDb, `companies/${COMPANY_DARROW}/bills/bill-pending-1`), {
    approvalStatus: "approved",
  }));
});

// Test 10k: Global HR is denied when attempting to activate a lease
await check("10k. Global HR is denied when attempting to activate a real estate lease", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/rem_leases/lease-hr-1`), {
    status: "active",
    leaseNumber: "LSE-2026-HR",
  }));
});

// Test 10l: Global HR is denied when attempting to collect rent installments
await check("10l. Global HR is denied when attempting to collect rent installments", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/rem_rent_installments/inst-hr-1`), {
    paidAmount: 5000,
    status: "collected",
  }));
});

// Test 10m: Global HR is denied when attempting to record rent payments
await check("10m. Global HR is denied when attempting to record rent payments", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/rem_rent_payments/pay-rem-hr-1`), {
    amount: 5000,
    createdBy: "global-hr-user",
  }));
});

// Test 10n: Global HR is denied when attempting to refund security deposits
await check("10n. Global HR is denied when attempting to refund security deposits", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/rem_security_deposits/dep-hr-1`), {
    status: "refunded",
    amount: 3000,
  }));
});

// Test 10o: Global HR is denied when attempting to approve property expenses
await check("10o. Global HR is denied when attempting to approve property expenses", async () => {
  await assertFails(setDoc(doc(hrDb, `companies/${COMPANY_DARROW}/rem_property_expenses/exp-hr-1`), {
    amount: 1500,
    approvalStatus: "approved",
    createdBy: "global-hr-user",
  }));
});

// Test 11: Regular employees cannot access Global HR capabilities
await check("11. Regular employees cannot access Global HR capabilities or edit teammates", async () => {
  // Ordinary employee cannot update teammate doc
  await assertFails(updateDoc(doc(empDb, "users", "employee-riyadh"), {
    role: "global_hr_manager",
  }));
  // Ordinary employee cannot read all daily reports
  await assertFails(getDoc(doc(empDb, `companies/${COMPANY_DARROW}/daily_reports/dr-global-1`)));
});

// Test 12: Company admins retain their existing legitimate permissions
await check("12. Company admins retain existing legitimate permissions", async () => {
  await assertSucceeds(updateDoc(doc(adminDb, "users", "employee-cairo"), {
    role: "viewer",
  }));
  await assertSucceeds(getDoc(doc(adminDb, `companies/${COMPANY_DARROW}/employees/emp-eg-1`)));
});

// Test 13: Global HR cannot create invite with role 'admin'
await check("13. Global HR cannot create an invite granting admin role", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-admin-1"), {
    token: "tok-admin-1",
    companyId: COMPANY_DARROW,
    email: "newadmin@darrow.test",
    role: "admin",
    status: "pending",
  }));
});

// Test 14: Global HR cannot create invite with role 'super_admin'
await check("14. Global HR cannot create an invite granting super_admin role", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-super-1"), {
    token: "tok-super-1",
    companyId: COMPANY_DARROW,
    email: "newsuper@darrow.test",
    role: "super_admin",
    status: "pending",
  }));
});

// Test 15: Global HR cannot create invite with role 'manager'
await check("15. Global HR cannot create an invite granting manager role", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-mgr-1"), {
    token: "tok-mgr-1",
    companyId: COMPANY_DARROW,
    email: "newmgr@darrow.test",
    role: "manager",
    status: "pending",
  }));
});

// Test 16: Global HR cannot create invite with elevated portalSubRoles
await check("16. Global HR cannot create an invite with elevated portalSubRoles", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-subrole-1"), {
    token: "tok-subrole-1",
    companyId: COMPANY_DARROW,
    email: "newsub@darrow.test",
    role: "employee",
    status: "pending",
    portalSubRoles: { billing: "accountant" },
  }));
});

// Test 17: Global HR cannot create invite with customPermissions
await check("17. Global HR cannot create an invite with customPermissions", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-custperm-1"), {
    token: "tok-custperm-1",
    companyId: COMPANY_DARROW,
    email: "newperm@darrow.test",
    role: "employee",
    status: "pending",
    customPermissions: ["admin.all"],
  }));
});

// Test 18: Global HR cannot create invite for a foreign company
await check("18. Global HR cannot create an invite for a foreign company", async () => {
  await assertFails(setDoc(doc(hrDb, "invites", "tok-foreign-1"), {
    token: "tok-foreign-1",
    companyId: COMPANY_FOREIGN,
    email: "foreignhire@other.test",
    role: "employee",
    status: "pending",
  }));
});

// Test 19: Global HR CAN create legitimate employee invite in own company
await check("19. Global HR CAN create legitimate employee invite in own company", async () => {
  await assertSucceeds(setDoc(doc(hrDb, "invites", "tok-legit-emp-1"), {
    token: "tok-legit-emp-1",
    companyId: COMPANY_DARROW,
    email: "legithire@darrow.test",
    role: "employee",
    status: "pending",
  }));
});

// Test 20: Global HR cannot update pending invite to grant admin or elevated sub-roles
await check("20. Global HR cannot update pending invite to grant admin or elevated sub-roles", async () => {
  await assertFails(updateDoc(doc(hrDb, "invites", "tok-legit-emp-1"), {
    role: "admin",
  }));
  await assertFails(updateDoc(doc(hrDb, "invites", "tok-legit-emp-1"), {
    portalSubRoles: { people: "admin" },
  }));
});

console.log("\n=================================================================");
console.log(` Negative Security Results: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================\n");

process.exit(failed > 0 ? 1 : 0);

