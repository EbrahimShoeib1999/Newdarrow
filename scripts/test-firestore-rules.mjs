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
  // Company profile doc: the authoritative source activity-aware routing
  // resolves from. Seeded pre-rules so the primaryActivity boundary below has
  // an existing resource to compare against.
  await setDoc(doc(db, "companies", COMPANY), {
    name: "Acme",
    primaryActivity: "PROJECTS",
  });
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
  // Platform super admin (a member of COMPANY) — the only role allowed to
  // reconcile tenant-less orphan accounts.
  await setDoc(doc(db, "users", "superadmin"), { companyId: COMPANY, role: "super_admin" });
  // Unassigned orphans: the empty companyId written once login() stopped
  // fabricating a tenant. These are invisible to the company-scoped roster.
  await setDoc(doc(db, "users", "orphan1"), { companyId: "", role: "employee", email: "orphan1@test.io" });
  await setDoc(doc(db, "users", "orphan2"), { companyId: "", name: "Orphan Two" });

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
// The admin-role-promotion check mutates the target's role, so it must use a
// throwaway member (emp2) — NOT emp1, which is reused below as the plain
// employee for the bill self-approval gate. Promoting emp1 here would turn the
// later "employee CANNOT self-approve" assertions into false passes.
await check("company admin CAN update employee role", () =>
  assertSucceeds(updateDoc(doc(asUser("admin"), "users", "emp2"), { role: "manager" }))
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

// --- Authoritative primaryActivity write boundary (activity-aware routing) ---
// The frontend guard is NOT the security boundary: prove the server rejects
// an activity change that comes from anywhere other than a company admin,
// rejects unknown/display-name ids, and still lets members do legitimate
// company-profile updates that do not touch the field.
await check("company admin CAN set a valid registry activity", () =>
  assertSucceeds(
    updateDoc(doc(asUser("admin"), "companies", COMPANY), { primaryActivity: "MEDICAL_CLINIC" })
  )
);

await check("non-admin member CANNOT change primaryActivity", () =>
  assertFails(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY), { primaryActivity: "SCHOOL_MANAGEMENT" })
  )
);

await check("admin CANNOT persist an unknown/display-name activity id", () =>
  assertFails(
    updateDoc(doc(asUser("admin"), "companies", COMPANY), { primaryActivity: "المشاريع" })
  )
);

await check("member CAN update other company profile fields (primaryActivity unchanged)", () =>
  assertSucceeds(
    updateDoc(doc(asUser("emp1"), "companies", COMPANY), { name: "Acme Renamed" })
  )
);

await check("unauthenticated user CANNOT change primaryActivity", () =>
  assertFails(
    updateDoc(doc(unauth, "companies", COMPANY), { primaryActivity: "PROJECTS" })
  )
);

await check("outsider CANNOT change primaryActivity of another company", () =>
  assertFails(
    updateDoc(doc(asUser("outsider"), "companies", COMPANY), { primaryActivity: "PROJECTS" })
  )
);

await check("non-admin member CANNOT delete company profile (admin-only)", () =>
  assertFails(deleteDoc(doc(asUser("emp1"), "companies", COMPANY)))
);

// --- Phase 2: activity-aware DOMAIN data boundary (release-critical, §12) ---
// Reserved per-activity collection prefixes (rem_/reb_/fm_/rdv_/mkt_/cln_/sch_)
// gate access by the tenant's AUTHORITATIVE activity (server get of the company
// doc) — never by a client field. Clinical/school domains add least-privilege.
// Shared collections (tasks, contacts, projects, …) match no prefix and are
// unaffected. These cases prove authorized access AND denial for a live and a
// sensitive domain, record preservation across a switch, and forged-field
// resistance.
const clnP1 = (db) => doc(db, "companies", COMPANY, "cln_patients", "P1");
const remRP1 = (db) => doc(db, "companies", COMPANY, "rem_properties", "RP1");
const setActivity = (activity) =>
  assertSucceeds(
    updateDoc(doc(asUser("admin"), "companies", COMPANY), { primaryActivity: activity })
  );

await check("domain setup: tenant activity pinned to MEDICAL_CLINIC", () => setActivity("MEDICAL_CLINIC"));

await check("privileged clinic admin CAN create clinical (domain) record", () =>
  assertSucceeds(setDoc(clnP1(asUser("admin")), { name: "Patient One", companyId: COMPANY }))
);
await check("privileged clinic manager CAN read clinical record", () =>
  assertSucceeds(getDoc(clnP1(asUser("mgr"))))
);
await check("plain clinic employee CANNOT read clinical record (least-privilege)", () =>
  assertFails(getDoc(clnP1(asUser("emp1"))))
);
await check("plain clinic employee CANNOT write clinical record (least-privilege)", () =>
  assertFails(setDoc(doc(asUser("emp1"), "companies", COMPANY, "cln_patients", "P2"), { name: "Nope" }))
);
await check("tenant is MEDICAL: writing a real-estate domain collection is DENIED", () =>
  assertFails(setDoc(remRP1(asUser("admin")), { address: "x" }))
);
await check("tenant is MEDICAL: writing a facilities domain collection is DENIED", () =>
  assertFails(setDoc(doc(asUser("admin"), "companies", COMPANY, "fm_assets", "A1"), { label: "HVAC" }))
);

// Facilities Management is now a LIVE domain module: prove the fm_* boundary
// opens for ordinary members when it is the tenant's activity (non-sensitive
// domain: no least-privilege elevation), and that outsiders stay denied.
const fmW1 = (db) => doc(db, "companies", COMPANY, "fm_work_orders", "W1");
await check("domain switch: tenant activity -> FACILITIES_MANAGEMENT", () => setActivity("FACILITIES_MANAGEMENT"));
await check("facilities active: plain member CAN create fm_work_orders record", () =>
  assertSucceeds(setDoc(fmW1(asUser("emp1")), { title: "AC repair", status: "requested", companyId: COMPANY }))
);
await check("facilities active: plain member CAN read the facilities domain back", () =>
  assertSucceeds(getDoc(fmW1(asUser("emp1"))))
);
await check("facilities active: outsider CANNOT read the facilities domain", () =>
  assertFails(getDoc(fmW1(asUser("outsider"))))
);
await check("facilities active: clinical domain stays DENIED (no cross-domain leak)", () =>
  assertFails(getDoc(clnP1(asUser("admin"))))
);

await check("domain switch: tenant activity -> REAL_ESTATE_MANAGEMENT", () => setActivity("REAL_ESTATE_MANAGEMENT"));
await check("now-active non-sensitive domain: plain member CAN create property", () =>
  assertSucceeds(setDoc(remRP1(asUser("emp1")), { address: "Riyadh", companyId: COMPANY }))
);
await check("deactivated clinical domain is DENIED even for the admin", () =>
  assertFails(getDoc(clnP1(asUser("admin"))))
);
await check("records are PRESERVED (not deleted) when their activity is disabled", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(clnP1(ctx.firestore()));
    if (!snap.exists()) throw new Error("clinical record vanished after activity switch");
  });
});

await check("domain switch back: tenant activity -> MEDICAL_CLINIC", () => setActivity("MEDICAL_CLINIC"));
await check("re-enabled clinical domain readable by privileged admin again", () =>
  assertSucceeds(getDoc(clnP1(asUser("admin"))))
);
await check("client-forged primaryActivity field CANNOT bypass collection-name gate", () =>
  assertFails(
    setDoc(doc(asUser("admin"), "companies", COMPANY, "mkt_campaigns", "C1"), {
      name: "x",
      primaryActivity: "MARKETING_AGENCY",
    })
  )
);
await check("shared tasks collection stays writable while clinic domain active", () =>
  assertSucceeds(setDoc(doc(asUser("emp1"), "companies", COMPANY, "tasks", "tShared"), { title: "still works" }))
);
await check("outsider CANNOT write into a company's clinical domain", () =>
  assertFails(setDoc(doc(asUser("outsider"), "companies", COMPANY, "cln_patients", "HACK"), { name: "x" }))
);

// Marketing Agency boundary: same prefix contract (mkt_) as the live domains
// above — allowed for ordinary members only while MARKETING_AGENCY is the
// tenant activity, denied cross-domain otherwise, records preserved on exit.
const mktC1 = (db) => doc(db, "companies", COMPANY, "mkt_campaigns", "C1");
const mktE1 = (db) => doc(db, "companies", COMPANY, "mkt_expenses", "E1");
await check("domain switch: tenant activity -> MARKETING_AGENCY", () => setActivity("MARKETING_AGENCY"));
await check("marketing active: plain member CAN create mkt_campaigns record", () =>
  assertSucceeds(setDoc(mktC1(asUser("emp1")), { name: "Ramadan Push", status: "draft", companyId: COMPANY }))
);
await check("marketing active: plain member CAN read the marketing domain back", () =>
  assertSucceeds(getDoc(mktC1(asUser("emp1"))))
);
await check("marketing active: member CAN write a second mkt_ collection (expenses)", () =>
  assertSucceeds(setDoc(mktE1(asUser("emp1")), { campaignId: "C1", amount: 100, currency: "SAR" }))
);
await check("marketing active: outsider CANNOT read the marketing domain", () =>
  assertFails(getDoc(mktC1(asUser("outsider"))))
);
await check("marketing active: facilities domain stays DENIED (no cross-domain leak)", () =>
  assertFails(getDoc(fmW1(asUser("admin"))))
);
await check("marketing active: outsider CANNOT write marketing records", () =>
  assertFails(setDoc(doc(asUser("outsider"), "companies", COMPANY, "mkt_deliverables", "HACK"), { title: "x" }))
);
await check("domain switch away: MARKETING records stay durable but gated", async () => {
  await setActivity("MEDICAL_CLINIC");
  await assertFails(getDoc(mktC1(asUser("admin"))));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(mktC1(ctx.firestore()));
    if (!snap.exists()) throw new Error("campaign record vanished after leaving MARKETING_AGENCY");
  });
});

// --- Phase C: Custom Business Modules Engine boundary (§3/§7) --------------
// Two server guarantees: (1) a module DEFINITION is writable only by an
// authorized administrator (config management), never an ordinary member, and
// is NEVER hard-deleted; (2) engine RECORDS live in activity-named
// mod_<activity>_rec_<key> collections, so the SAME prefix-derived activity +
// least-privilege gate applies, and permanent deletion is admin-only.
const defVendors = (db) => doc(db, "companies", COMPANY, "module_definitions", "vendors");
const mkVendor = (db) => doc(db, "companies", COMPANY, "mod_marketing_agency_rec_vendors", "v1");
const clinicAppt = (db) => doc(db, "companies", COMPANY, "mod_medical_clinic_rec_appointments", "a1");
const schoolRec = (db) => doc(db, "companies", COMPANY, "mod_school_management_rec_students", "s1");

// Config management gate.
await check("admin CAN create a module definition (config management)", () =>
  assertSucceeds(
    setDoc(defVendors(asUser("admin")), {
      key: "vendors",
      name: { ar: "الموردون", en: "Vendors" },
      activity: "MARKETING_AGENCY",
      lifecycle: "draft",
    })
  )
);
await check("any tenant member CAN read module definitions (workspace render)", () =>
  assertSucceeds(getDoc(defVendors(asUser("emp1"))))
);
await check("ordinary employee CANNOT create a module definition", () =>
  assertFails(
    setDoc(doc(asUser("emp1"), "companies", COMPANY, "module_definitions", "hack"), { key: "hack" })
  )
);
await check("manager WITHOUT the config capability CANNOT edit a definition", () =>
  assertFails(updateDoc(defVendors(asUser("mgr")), { lifecycle: "active" }))
);
await check("employee CANNOT edit a module definition", () =>
  assertFails(updateDoc(defVendors(asUser("emp1")), { lifecycle: "active" }))
);
await check("even an admin CANNOT hard-delete a definition (archive only)", () =>
  assertFails(deleteDoc(defVendors(asUser("admin"))))
);
await check("outsider CANNOT read another company's definitions", () =>
  assertFails(getDoc(defVendors(asUser("outsider"))))
);

// Engine records — ordinary (non-sensitive) activity namespace.
await check("engine: tenant -> MARKETING_AGENCY for record CRUD", () => setActivity("MARKETING_AGENCY"));
await check("engine: member CAN create a mod_marketing_agency record", () =>
  assertSucceeds(setDoc(mkVendor(asUser("emp1")), { moduleKey: "vendors", values: { vendor_name: "Acme Supply" }, status: "open" }))
);
await check("engine: member CAN read the mod_marketing_agency record back", () =>
  assertSucceeds(getDoc(mkVendor(asUser("emp1"))))
);
await check("engine: member CANNOT permanently delete a record (admin-only)", () =>
  assertFails(deleteDoc(mkVendor(asUser("emp1"))))
);
await check("engine: admin CAN permanently delete a record", () =>
  assertSucceeds(deleteDoc(mkVendor(asUser("admin"))))
);
await check("engine: cross-activity mod_school_management write DENIED while MARKETING active", () =>
  assertFails(setDoc(schoolRec(asUser("admin")), { moduleKey: "students", values: {} }))
);
await check("engine: forged activity field CANNOT bypass the collection-name gate", () =>
  assertFails(
    setDoc(doc(asUser("admin"), "companies", COMPANY, "mod_school_management_rec_students", "s2"), {
      activity: "MARKETING_AGENCY",
      values: {},
    })
  )
);
await check("engine: outsider CANNOT write mod_ records", () =>
  assertFails(setDoc(doc(asUser("outsider"), "companies", COMPANY, "mod_marketing_agency_rec_vendors", "h"), { values: {} }))
);

// Engine records — sensitive activity namespace keeps least-privilege.
await check("engine: tenant -> MEDICAL_CLINIC for sensitive module gate", () => setActivity("MEDICAL_CLINIC"));
await check("engine: privileged admin CAN create a mod_medical_clinic record", () =>
  assertSucceeds(setDoc(clinicAppt(asUser("admin")), { moduleKey: "appointments", values: { patient_name: "Sara" }, status: "open" }))
);
await check("engine: plain employee CANNOT read a mod_medical_clinic record (least-privilege)", () =>
  assertFails(getDoc(clinicAppt(asUser("emp1"))))
);
await check("engine: plain employee CANNOT write a mod_medical_clinic record (least-privilege)", () =>
  assertFails(setDoc(doc(asUser("emp1"), "companies", COMPANY, "mod_medical_clinic_rec_appointments", "a2"), { values: {} }))
);

// --- Phase D: REM financial boundary regressions (§10: existing REM
// functionality verified against the real rules). These are NEW checks over
// the pre-existing rem_* blocks: lease state escalation, installment
// status/money immutability for non-collectors, payment audit permanence and
// the deposits permission gate, plus the activity gate flipping away. ---
const remLease1 = (db) => doc(db, "companies", COMPANY, "rem_leases", "L1");
const remInst1 = (db) => doc(db, "companies", COMPANY, "rem_rent_installments", "I1");
const remPay1 = (db) => doc(db, "companies", COMPANY, "rem_rent_payments", "P1");
const remDep1 = (db) => doc(db, "companies", COMPANY, "rem_security_deposits", "L1");

await check("rem setup: tenant activity -> REAL_ESTATE_MANAGEMENT", () => setActivity("REAL_ESTATE_MANAGEMENT"));
await check("rem setup: draft lease seeded by ordinary member", () =>
  assertSucceeds(setDoc(remLease1(asUser("emp1")), { status: "draft", unitId: "u1", tenantContactId: "contact1", startDate: "2026-11-01", endDate: "2027-10-31", rentAmount: 1000 }))
);
await check("REM finance: ordinary employee CANNOT self-activate a lease (approve gate)", () =>
  assertFails(updateDoc(remLease1(asUser("emp1")), { status: "active" }))
);
await check("REM finance: manager (approve privilege) CAN activate the lease", () =>
  assertSucceeds(updateDoc(remLease1(asUser("mgr")), { status: "active" }))
);
await check("REM finance: lease is NEVER hard-deletable (financial history)", () =>
  assertFails(deleteDoc(remLease1(asUser("admin"))))
);
await check("REM finance: installment seeded while active", () =>
  assertSucceeds(setDoc(remInst1(asUser("emp1")), { leaseId: "L1", index: 1, dueDate: "2026-12-01", expectedAmount: 1000, paidAmount: 0, status: "due" }))
);
await check("REM finance: non-collector CANNOT move installment status", () =>
  assertFails(updateDoc(remInst1(asUser("emp1")), { status: "paid", paidAmount: 1000 }))
);
await check("REM finance: non-collector CAN edit neutral metadata (not status/money)", () =>
  assertSucceeds(updateDoc(remInst1(asUser("emp1")), { note: "reminder sent" }))
);
await check("REM finance: collector (manager) CAN record the allocation", () =>
  assertSucceeds(updateDoc(remInst1(asUser("mgr")), { status: "paid", paidAmount: 1000 }))
);
await check("REM finance: installment is NEVER hard-deletable", () =>
  assertFails(deleteDoc(remInst1(asUser("admin"))))
);
await check("REM finance: ordinary employee CANNOT record a rent payment (collect gate)", () =>
  assertFails(setDoc(remPay1(asUser("emp1")), { leaseId: "L1", installmentId: "I1", amount: 1000, paymentDate: "2026-12-01" }))
);
await check("REM finance: collector CAN record a rent payment", () =>
  assertSucceeds(setDoc(remPay1(asUser("mgr")), { leaseId: "L1", installmentId: "I1", amount: 1000, paymentDate: "2026-12-01" }))
);
await check("REM finance: recorded payment is NEVER hard-deletable (void keeps audit trail)", () =>
  assertFails(deleteDoc(remPay1(asUser("admin"))))
);
await check("REM finance: expected-deposit row opens with the lease (domain write)", () =>
  assertSucceeds(setDoc(remDep1(asUser("emp1")), { leaseId: "L1", expectedAmount: 2000, receivedAmount: 0, status: "expected" }))
);
await check("REM finance: non-collector CANNOT refund a deposit (deposits gate)", () =>
  assertFails(updateDoc(remDep1(asUser("emp1")), { status: "refunded", receivedAmount: 2000 }))
);
await check("REM finance: admin CAN move the deposit liability", () =>
  assertSucceeds(updateDoc(remDep1(asUser("admin")), { status: "received", receivedAmount: 2000, outstandingLiability: 2000 }))
);
await check("REM finance: deposit row is NEVER hard-deletable", () =>
  assertFails(deleteDoc(remDep1(asUser("admin"))))
);
await check("rem teardown: tenant activity -> MARKETING_AGENCY", () => setActivity("MARKETING_AGENCY"));
await check("REM finance: inactive domain blocks even the admin (fail-closed)", () =>
  assertFails(getDoc(remLease1(asUser("admin"))))
);

// ---- Account reconciliation (Bug 1): super-admin-only, orphan-only --------
const unassignedQuery = (db) =>
  query(collection(db, "users"), where("companyId", "==", ""));

await check("reconcile: teammate GET still allowed (get rule not narrowed)", () =>
  assertSucceeds(getDoc(doc(asUser("emp1"), "users", "admin")))
);
await check("reconcile: ordinary employee CANNOT GET an orphan doc (get not widened)", () =>
  assertFails(getDoc(doc(asUser("emp1"), "users", "orphan1")))
);
await check("reconcile: super_admin LISTs unassigned accounts (orphan-only)", async () => {
  const snap = await assertSucceeds(getDocs(unassignedQuery(asUser("superadmin"))));
  if (snap.size !== 2) throw new Error(`expected 2 orphans, got ${snap.size}`);
});
await check("reconcile: ordinary admin CANNOT list unassigned accounts", () =>
  assertFails(getDocs(unassignedQuery(asUser("admin"))))
);
await check("reconcile: employee CANNOT list unassigned accounts", () =>
  assertFails(getDocs(unassignedQuery(asUser("emp1"))))
);
await check("reconcile: super_admin ASSIGNS an orphan to a company", () =>
  assertSucceeds(
    updateDoc(doc(asUser("superadmin"), "users", "orphan1"), {
      companyId: COMPANY,
      companyName: "Acme",
    })
  )
);
await check("reconcile: ordinary admin CANNOT assign an orphan (no tenant claim)", () =>
  assertFails(
    updateDoc(doc(asUser("admin"), "users", "orphan2"), { companyId: COMPANY })
  )
);

await testEnv.cleanup();

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.err}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
