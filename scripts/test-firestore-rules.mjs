/**
 * Firestore rules checks for daily reports.
 * Run with: npm run test:rules
 *
 * The script pins firebase-tools 13.x because newer CLI releases require JDK 21+
 * and this machine runs JDK 17. Drop the pin once the JDK is upgraded.
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

const COMPANY = "acme";
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "rules-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed user profiles and two reports without going through the rules.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", "emp1"), { companyId: COMPANY, role: "employee" });
  await setDoc(doc(db, "users", "emp2"), { companyId: COMPANY, role: "employee" });
  await setDoc(doc(db, "users", "mgr"), { companyId: COMPANY, role: "manager" });
  // Reproduces the field shape that previously broke the helper.
  await setDoc(doc(db, "users", "mgrNull"), {
    companyId: COMPANY,
    role: "manager",
    portalSubRoles: null,
    customPermissions: null,
  });
  await setDoc(doc(db, "users", "mgrDemoted"), {
    companyId: COMPANY,
    role: "manager",
    portalSubRoles: { people: "employee" },
  });
  await setDoc(doc(db, "users", "empCustom"), {
    companyId: COMPANY,
    role: "employee",
    customPermissions: ["people.view_all_reports"],
  });
  // Accounting-specific reviewer: global employee, but Billing sub-role accountant.
  await setDoc(doc(db, "users", "acct"), {
    companyId: COMPANY,
    role: "employee",
    portalSubRoles: { billing: "accountant" },
  });
  await setDoc(doc(db, "users", "outsider"), { companyId: "other-co", role: "manager" });
  await setDoc(doc(db, "users", "admin"), { companyId: COMPANY, role: "admin" });

  await setDoc(doc(db, "companies", COMPANY, "conversations", "pub1"), {
    type: "public",
    name: "General",
    companyId: COMPANY,
  });
  await setDoc(doc(db, "companies", COMPANY, "conversations", "priv1"), {
    type: "private",
    name: "Executive",
    memberIds: ["emp1", "admin"],
    companyId: COMPANY,
  });
  await setDoc(doc(db, "companies", COMPANY, "conversations", "priv1", "messages", "m1"), {
    body: "Secret message",
    companyId: COMPANY,
  });

  await setDoc(doc(db, "companies", COMPANY, "daily_reports", "r1"), {
    employeeId: "emp1",
    date: "2026-09-17",
    summary: "emp1 report",
  });
  await setDoc(doc(db, "companies", COMPANY, "daily_reports", "r2"), {
    employeeId: "emp2",
    date: "2026-09-17",
    summary: "emp2 report",
  });
  await setDoc(doc(db, "companies", COMPANY, "tasks", "t1"), { title: "unrelated" });
  await setDoc(doc(db, "companies", COMPANY, "contact_classifications", "class1"), {
    name: "VIP Partner",
    color: "gold",
    isActive: true,
  });
  await setDoc(doc(db, "companies", COMPANY, "contacts", "contact1"), {
    name: "John Doe",
    classification: "class1",
    source: "website",
  });
  await setDoc(doc(db, "companies", COMPANY, "projects", "proj1"), {
    name: "Alpha Project",
    slug: "alpha-project",
    priority: "high",
  });
  // A recorded-but-unreviewed vendor bill for the review-gate assertions.
  await setDoc(doc(db, "companies", COMPANY, "bills", "bill1"), {
    billNumber: "B-1",
    vendorName: "Acme",
    status: "open",
    approvalStatus: "pending",
    grandTotal: 100,
  });
});

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const unauth = testEnv.unauthenticatedContext().firestore();
const reportsOf = (db) => collection(db, "companies", COMPANY, "daily_reports");

// --- The requirement: every employee can read their own reports ---
await check("employee reads own report doc", () =>
  assertSucceeds(getDoc(doc(asUser("emp1"), "companies", COMPANY, "daily_reports", "r1")))
);

await check("employee lists own reports (filtered query)", async () => {
  const snap = await assertSucceeds(
    getDocs(query(reportsOf(asUser("emp1")), where("employeeId", "==", "emp1")))
  );
  if (snap.size !== 1) throw new Error(`expected 1 own report, got ${snap.size}`);
});

await check("employee updates own report", () =>
  assertSucceeds(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY, "daily_reports", "r1"), {
      summary: "edited",
    })
  )
);

await check("employee creates own report", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "daily_reports", "new1"), {
      employeeId: "emp1",
      date: "2026-09-18",
    })
  )
);

// --- Employees must not reach anyone else's reports ---
await check("employee cannot read another member's report", () =>
  assertFails(getDoc(doc(asUser("emp1"), "companies", COMPANY, "daily_reports", "r2")))
);

await check("employee cannot list all reports", () =>
  assertFails(getDocs(reportsOf(asUser("emp1"))))
);

await check("employee cannot list another member's reports", () =>
  assertFails(getDocs(query(reportsOf(asUser("emp1")), where("employeeId", "==", "emp2"))))
);

await check("employee cannot forge a report for someone else", () =>
  assertFails(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "daily_reports", "forged"), {
      employeeId: "emp2",
      date: "2026-09-18",
    })
  )
);

// --- Managers and admins see everything ---
await check("manager lists all reports", async () => {
  const snap = await assertSucceeds(getDocs(reportsOf(asUser("mgr"))));
  if (snap.size < 2) throw new Error(`expected all reports, got ${snap.size}`);
});

await check("manager with null portalSubRoles still lists all reports", () =>
  assertSucceeds(getDocs(reportsOf(asUser("mgrNull"))))
);

await check("manager demoted via People sub-role cannot list all reports", () =>
  assertFails(getDocs(reportsOf(asUser("mgrDemoted"))))
);

await check("employee with custom permission lists all reports", () =>
  assertSucceeds(getDocs(reportsOf(asUser("empCustom"))))
);

// --- Company isolation and untouched collections ---
await check("outsider cannot read reports", () =>
  assertFails(getDoc(doc(asUser("outsider"), "companies", COMPANY, "daily_reports", "r1")))
);

await check("other company subcollections stay readable by members", () =>
  assertSucceeds(getDocs(collection(asUser("emp1"), "companies", COMPANY, "tasks")))
);

await check("other company subcollections stay writable by members", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "tasks", "t2"), { title: "new" })
  )
);

await check("nested subcollections stay accessible", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "tasks", "t1", "comments", "c1"), {
      body: "hi",
    })
  )
);

// --- Cross-company isolation & unauthenticated protection ---
await check("unauthenticated user cannot read contact_classifications", () =>
  assertFails(getDocs(collection(unauth, "companies", COMPANY, "contact_classifications")))
);

await check("unauthenticated user cannot read contacts", () =>
  assertFails(getDocs(collection(unauth, "companies", COMPANY, "contacts")))
);

await check("unauthenticated user cannot write to contact_classifications", () =>
  assertFails(
    setDoc(doc(unauth, "companies", COMPANY, "contact_classifications", "hack"), { name: "Hack" })
  )
);

await check("unauthenticated user cannot write to contacts", () =>
  assertFails(
    setDoc(doc(unauth, "companies", COMPANY, "contacts", "hack"), { name: "Hack" })
  )
);

await check("unauthenticated user cannot write to projects", () =>
  assertFails(
    setDoc(doc(unauth, "companies", COMPANY, "projects", "hack"), { name: "Hack" })
  )
);

await check("outsider cannot read contact_classifications of another company", () =>
  assertFails(
    getDocs(collection(asUser("outsider"), "companies", COMPANY, "contact_classifications"))
  )
);

await check("outsider cannot write contact_classifications to another company", () =>
  assertFails(
    setDoc(
      doc(asUser("outsider"), "companies", COMPANY, "contact_classifications", "hack"),
      { name: "Hack" }
    )
  )
);

await check("outsider cannot read contacts of another company", () =>
  assertFails(getDocs(collection(asUser("outsider"), "companies", COMPANY, "contacts")))
);

await check("outsider cannot write contacts to another company", () =>
  assertFails(
    setDoc(doc(asUser("outsider"), "companies", COMPANY, "contacts", "hack"), {
      name: "Hack",
    })
  )
);

await check("outsider cannot read projects of another company", () =>
  assertFails(getDocs(collection(asUser("outsider"), "companies", COMPANY, "projects")))
);

await check("outsider cannot write projects to another company", () =>
  assertFails(
    setDoc(doc(asUser("outsider"), "companies", COMPANY, "projects", "hack"), {
      name: "Hack",
    })
  )
);

// --- Permitted company-scoped operations for member ---
await check("company member can read contact_classifications", () =>
  assertSucceeds(
    getDocs(collection(asUser("emp1"), "companies", COMPANY, "contact_classifications"))
  )
);

await check("company member can create custom contact_classifications", () =>
  assertSucceeds(
    setDoc(
      doc(asUser("emp1"), "companies", COMPANY, "contact_classifications", "class2"),
      { name: "Strategic Lead", color: "blue", isActive: true }
    )
  )
);

await check("company member can read contacts", () =>
  assertSucceeds(getDocs(collection(asUser("emp1"), "companies", COMPANY, "contacts")))
);

await check("company member can create contact with custom classification", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "contacts", "contact2"), {
      name: "Jane Smith",
      classification: "class2",
      source: "referral",
    })
  )
);

await check("company member can create project with custom fields and priority", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "projects", "proj2"), {
      name: "Beta Project",
      slug: "beta-project",
      priority: "medium",
      customFields: [{ key: "Budget", value: "50000" }],
    })
  )
);

// --- Additional Security & Tenant Boundary Checks ---
await check("unauthenticated user cannot read otpResets", () =>
  assertFails(getDoc(doc(unauth, "otpResets", "some_id")))
);
await check("authenticated user cannot read otpResets directly", () =>
  assertFails(getDoc(doc(asUser("emp1"), "otpResets", "some_id")))
);
await check("company member can read public channel", () =>
  assertSucceeds(getDoc(doc(asUser("emp1"), "companies", COMPANY, "conversations", "pub1")))
);
await check("member in private channel memberIds can read private channel", () =>
  assertSucceeds(getDoc(doc(asUser("emp1"), "companies", COMPANY, "conversations", "priv1")))
);
await check("member in private channel memberIds can read private messages", () =>
  assertSucceeds(getDocs(collection(asUser("emp1"), "companies", COMPANY, "conversations", "priv1", "messages")))
);
await check("employee NOT in private channel memberIds CANNOT read private channel", () =>
  assertFails(getDoc(doc(asUser("emp2"), "companies", COMPANY, "conversations", "priv1")))
);
await check("employee NOT in private channel memberIds CANNOT read private messages", () =>
  assertFails(getDocs(collection(asUser("emp2"), "companies", COMPANY, "conversations", "priv1", "messages")))
);
await check("company admin CAN read private channel and messages", () =>
  assertSucceeds(getDoc(doc(asUser("admin"), "companies", COMPANY, "conversations", "priv1")))
);
await check("outsider CANNOT read company chat conversations or messages", () =>
  assertFails(getDoc(doc(asUser("outsider"), "companies", COMPANY, "conversations", "priv1")))
);
await check("employee CANNOT promote self to admin", () =>
  assertFails(updateDoc(doc(asUser("emp1"), "users", "emp1"), { role: "admin" }))
);
await check("employee CANNOT change own companyId to another company", () =>
  assertFails(updateDoc(doc(asUser("emp1"), "users", "emp1"), { companyId: "other-co" }))
);
await check("employee CAN update own safe profile fields (e.g. name)", () =>
  assertSucceeds(updateDoc(doc(asUser("emp1"), "users", "emp1"), { name: "Updated Name" }))
);
await check("company admin CAN update employee role", () =>
  assertSucceeds(updateDoc(doc(asUser("admin"), "users", "emp1"), { role: "manager" }))
);
await check("outsider CANNOT update user in another company", () =>
  assertFails(updateDoc(doc(asUser("outsider"), "users", "emp1"), { name: "Hacked" }))
);

// --- Public Invoice Shares Tests ---
const SHARE_TOKEN = "share_tok_test_01";
await check("company admin CAN create public invoice share for own company", () =>
  assertSucceeds(
    setDoc(doc(asUser("admin"), "publicInvoiceShares", SHARE_TOKEN), {
      token: SHARE_TOKEN,
      companyId: COMPANY,
      invoiceId: "inv_123",
      snapshot: { amountDue: 1000, customerName: "Acme Client" },
    })
  )
);

await check("unauthenticated user CAN get public invoice share by token", () =>
  assertSucceeds(getDoc(doc(unauth, "publicInvoiceShares", SHARE_TOKEN)))
);

await check("unauthenticated user CANNOT list publicInvoiceShares collection", () =>
  assertFails(getDocs(collection(unauth, "publicInvoiceShares")))
);

await check("unauthenticated user CANNOT write public invoice share", () =>
  assertFails(
    setDoc(doc(unauth, "publicInvoiceShares", "hack_token"), {
      token: "hack_token",
      companyId: COMPANY,
      invoiceId: "inv_fake",
      snapshot: { amountDue: 0 },
    })
  )
);

await check("company member CAN update own public invoice share", () =>
  assertSucceeds(
    updateDoc(doc(asUser("emp1"), "publicInvoiceShares", SHARE_TOKEN), {
      pdfUrl: "https://example.com/inv.pdf",
    })
  )
);

await check("outsider CANNOT update company public invoice share", () =>
  assertFails(
    updateDoc(doc(asUser("outsider"), "publicInvoiceShares", SHARE_TOKEN), {
      pdfUrl: "https://hacked.com/inv.pdf",
    })
  )
);

await check("outsider CANNOT delete company public invoice share", () =>
  assertFails(deleteDoc(doc(asUser("outsider"), "publicInvoiceShares", SHARE_TOKEN)))
);

await check("company member CAN delete own public invoice share", () =>
  assertSucceeds(deleteDoc(doc(asUser("emp1"), "publicInvoiceShares", SHARE_TOKEN)))
);

// --- Financial Ledger & Payment Security ---
const JRN_ID = "jrn_test_01";
await check("company member CAN create balanced journal entry", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "journals", JRN_ID), {
      entryNumber: "JE-2026-001",
      date: "2026-10-18",
      totalDebit: 500,
      totalCredit: 500,
      description: "Balanced test journal",
    })
  )
);

await check("company member CANNOT create UNBALANCED journal entry", () =>
  assertFails(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "journals", "jrn_unbalanced"), {
      entryNumber: "JE-2026-002",
      date: "2026-10-18",
      totalDebit: 500,
      totalCredit: 400,
      description: "Unbalanced journal should fail",
    })
  )
);

await check("company member CANNOT update posted journal entry", () =>
  assertFails(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY, "journals", JRN_ID), {
      totalDebit: 600,
      totalCredit: 600,
    })
  )
);

await check("company member CANNOT delete posted journal entry", () =>
  assertFails(deleteDoc(doc(asUser("emp1"), "companies", COMPANY, "journals", JRN_ID)))
);

const PAY_ID = "pay_test_01";
await check("company member CAN create payment with amount > 0", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "payments", PAY_ID), {
      amount: 150,
      currency: "SAR",
      invoiceId: "inv_123",
      paymentDate: "2026-10-18",
    })
  )
);

await check("company member CANNOT create payment with amount <= 0", () =>
  assertFails(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "payments", "pay_zero"), {
      amount: 0,
      currency: "SAR",
      invoiceId: "inv_123",
    })
  )
);

await check("company member CANNOT delete payment document", () =>
  assertFails(deleteDoc(doc(asUser("emp1"), "companies", COMPANY, "payments", PAY_ID)))
);

await check("outsider CANNOT read or write payments in another company", () =>
  assertFails(
    setDoc(doc(asUser("outsider"), "companies", COMPANY, "payments", "pay_hack"), {
      amount: 999,
      currency: "SAR",
    })
  )
);

// --- Bill accountant-review enforcement (server mirror of canApproveDocuments) ---
await check("employee CAN record a pending bill (recorded cost)", () =>
  assertSucceeds(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "bills", "bill_emp"), {
      billNumber: "B-EMP",
      vendorName: "Vendor",
      status: "open",
      approvalStatus: "pending",
      grandTotal: 50,
    })
  )
);

await check("employee CANNOT self-approve a bill on create", () =>
  assertFails(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "bills", "bill_selfapp"), {
      billNumber: "B-SELF",
      vendorName: "Vendor",
      status: "open",
      approvalStatus: "approved",
      grandTotal: 50,
    })
  )
);

await check("employee CANNOT change an existing bill's review outcome to approved", () =>
  assertFails(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY, "bills", "bill1"), {
      approvalStatus: "approved",
      approvedBy: "emp1",
    })
  )
);

await check("employee CAN edit a bill's non-review fields (approvalStatus unchanged)", () =>
  assertSucceeds(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY, "bills", "bill1"), {
      notes: "corrected vendor address",
    })
  )
);

await check("manager CAN approve a bill", () =>
  assertSucceeds(
    updateDoc(doc(asUser("mgr"), "companies", COMPANY, "bills", "bill1"), {
      approvalStatus: "approved",
      approvedBy: "mgr",
    })
  )
);

await check("billing accountant sub-role (employee) CAN reject a bill", () =>
  assertSucceeds(
    updateDoc(doc(asUser("acct"), "companies", COMPANY, "bills", "bill1"), {
      approvalStatus: "rejected",
      reviewNote: "not project-related",
    })
  )
);

await check("outsider CANNOT read company bills", () =>
  assertFails(getDoc(doc(asUser("outsider"), "companies", COMPANY, "bills", "bill1")))
);

await testEnv.cleanup();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.err}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
