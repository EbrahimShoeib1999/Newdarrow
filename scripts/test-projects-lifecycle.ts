/**
 * D-Arrow Business — Projects Lifecycle, Terminology & Financial-Derivation Unit Suite
 *
 * Pure unit tests (no Firebase): validated transition state machine, reason
 * requirements, activity presets, tenant terminology schema, and the
 * computeProjectFinancials derivation over authoritative-record fixtures.
 * Run: npx tsx scripts/test-projects-lifecycle.ts
 */

import {
  PROJECT_STATUSES,
  PROJECT_STATUS_TRANSITIONS,
  canTransitionProject,
  requiredReasonField,
} from "../src/features/projects/constants/project-lifecycle";
import {
  ACTIVITY_PRESETS,
  getActivityPreset,
} from "../src/features/projects/constants/activity-presets";
import {
  projectTerminologySchema,
  DEFAULT_TERMINOLOGY,
} from "../src/features/projects/schemas/project-settings.schema";
import {
  computeProjectFinancials,
  contractValueOf,
  invoiceAttachedToProject,
} from "../src/features/projects/utils/project-financials";
import type { Project, ProjectStatus } from "../src/features/projects/types/projects.types";
import type { Invoice } from "../src/features/billing/schemas/invoice";
import type { Bill } from "../src/features/billing/schemas/bill";
import type { CreditNote } from "../src/features/billing/schemas/credit-note";
import type { SavedContract } from "../src/features/crm/types/contract.types";

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — Projects Lifecycle & Financials Unit Tests");
console.log("=======================================================\n");

/* -------------------------------------------------------------------------- */
/* 1. Lifecycle state machine                                                 */
/* -------------------------------------------------------------------------- */
console.log("1. Lifecycle transition state machine:");

await test("every declared status has a transition entry", () => {
  for (const s of PROJECT_STATUSES) {
    assert(Array.isArray(PROJECT_STATUS_TRANSITIONS[s]), `${s} must have a transitions array`);
  }
});

await test("legal forward/back edges are accepted", () => {
  assert(canTransitionProject("planning", "active"), "planning->active");
  assert(canTransitionProject("active", "on_hold"), "active->on_hold");
  assert(canTransitionProject("on_hold", "active"), "on_hold->active (resume)");
  assert(canTransitionProject("on_hold", "completed"), "on_hold->completed");
  assert(canTransitionProject("completed", "active"), "completed->active (reopen)");
  assert(canTransitionProject("completed", "archived"), "completed->archived");
  assert(canTransitionProject("archived", "active"), "archived->active (restore)");
});

await test("illegal edges are rejected", () => {
  assert(!canTransitionProject("planning", "completed"), "planning->completed must be illegal");
  assert(!canTransitionProject("planning", "on_hold"), "planning->on_hold illegal (pause applies only to started work)");
  assert(!canTransitionProject("archived", "completed"), "archived->completed must be illegal");
  assert(!canTransitionProject("archived", "cancelled"), "archived->cancelled must be illegal");
  assert(!canTransitionProject("cancelled", "completed"), "cancelled->completed must be illegal");
});

await test("reason requirements: pause and cancel only", () => {
  assert(requiredReasonField("active", "on_hold") === "pauseReason", "active->on_hold requires pauseReason");
  assert(requiredReasonField("planning", "on_hold") === null, "no reason for an edge the machine does not allow");
  assert(requiredReasonField("planning", "cancelled") === "cancellationReason", "cancel requires cancellationReason");
  assert(requiredReasonField("active", "cancelled") === "cancellationReason", "cancel requires cancellationReason");
  assert(requiredReasonField("on_hold", "cancelled") === "cancellationReason", "cancel requires cancellationReason");
  assert(requiredReasonField("on_hold", "active") === null, "resume requires no reason");
  assert(requiredReasonField("active", "completed") === null, "complete requires no reason");
  assert(requiredReasonField("archived", "active") === null, "restore requires no reason");
});

/* -------------------------------------------------------------------------- */
/* 2. Activity presets                                                        */
/* -------------------------------------------------------------------------- */
console.log("\n2. Activity presets (industry defaults, not the domain model):");

await test("five presets cover the required industries with paired bilingual milestones", () => {
  const keys = ACTIVITY_PRESETS.map((p) => p.key);
  for (const k of ["software", "marketing", "consulting", "construction", "general"]) {
    assert(keys.includes(k as any), `preset ${k} must exist`);
  }
  for (const p of ACTIVITY_PRESETS) {
    assert(
      p.milestones.en.length === p.milestones.ar.length && p.milestones.en.length >= 3,
      `${p.key}: bilingual milestone lists must be paired and >= 3 entries`
    );
    assert(Boolean(p.labels.en && p.labels.ar), `${p.key}: bilingual labels required`);
  }
});

await test("getActivityPreset: unknown / null keys degrade gracefully", () => {
  assert(getActivityPreset("software")?.key === "software", "software preset resolved");
  assert(getActivityPreset("mining") === undefined, "unknown key -> undefined (generic project)");
  assert(getActivityPreset(null) === undefined, "null -> undefined");
  assert(getActivityPreset(undefined) === undefined, "undefined -> undefined");
});

/* -------------------------------------------------------------------------- */
/* 3. Tenant terminology schema                                               */
/* -------------------------------------------------------------------------- */
console.log("\n3. Configurable terminology schema:");

await test("valid terminology passes and trims values", () => {
  const res = projectTerminologySchema.safeParse({
    singular: { en: " Order ", ar: "أمر" },
    plural: { en: "Orders", ar: "الأوامر" },
  });
  assert(res.success, "valid terminology must parse");
  assert(res.data!.singular.en === "Order", "value must be trimmed");
});

await test("empty, oversized, and markup-like names are rejected", () => {
  const mk = (en: string, ar = "مشروع") => ({
    singular: { en, ar },
    plural: { en: "Projects", ar: "المشاريع" },
  });
  assert(!projectTerminologySchema.safeParse(mk("")).success, "empty singular rejected");
  assert(!projectTerminologySchema.safeParse(mk("x".repeat(41))).success, "41 chars rejected");
  assert(!projectTerminologySchema.safeParse(mk("<Project/>")).success, "markup chars rejected");
});

await test("Arabic and mixed-script names are accepted", () => {
  const res = projectTerminologySchema.safeParse({
    singular: { en: "Work Item", ar: "بند عمل" },
    plural: { en: "Work Items", ar: "بنود العمل" },
  });
  assert(res.success, "Arabic + spaced names must parse");
});

await test("built-in defaults exist for both languages", () => {
  assert(!!DEFAULT_TERMINOLOGY.singular.en && !!DEFAULT_TERMINOLOGY.singular.ar, "defaults bilingual");
  assert(!!DEFAULT_TERMINOLOGY.plural.en && !!DEFAULT_TERMINOLOGY.plural.ar, "defaults bilingual plural");
});

/* -------------------------------------------------------------------------- */
/* 4. Financial derivation from authoritative records                         */
/* -------------------------------------------------------------------------- */
console.log("\n4. Project financials derivation:");

const project = {
  id: "p1",
  name: "Test Project",
  description: "",
  status: "active" as ProjectStatus,
  members: [],
  createdBy: "u1",
  startDate: null,
  endDate: null,
  contractId: "c1",
  budget: 30000,
  currency: "SAR",
} as unknown as Project;

const contract = {
  id: "c1",
  title: "Services Agreement",
  status: "final",
  approvalStatus: "approved",
  contactId: "ct1",
  dealId: "d1",
  createdAt: "",
  updatedAt: "",
  form: {
    title: "Services Agreement",
    contractNumber: "CNT-001",
    contractDateIso: "2026-01-01",
    preamble: "",
    provider: { name: "D-Arrow" },
    client: { name: "Client" },
    fields: [
      { id: "f1", key: "amountExclVat", label: "", value: "100000" },
      { id: "f2", key: "vatRate", label: "", value: "15" },
    ],
    clauses: [],
    pageCount: "1",
    signatureDateIso: "2026-01-01",
    contactId: "ct1",
    dealId: "d1",
  },
} as unknown as SavedContract;

const inv = (o: Partial<Invoice> & Pick<Invoice, "id" | "grandTotal" | "subTotal">): Invoice =>
  ({
    invoiceNumber: `INV-${o.id}`,
    status: "sent",
    currency: "SAR",
    amountPaid: 0,
    dueDate: new Date("2026-09-01"),
    projectId: "p1",
    reversedAt: null,
    ...o,
  }) as Invoice;

const invoices: Invoice[] = [
  inv({ id: "i1", subTotal: 10000, grandTotal: 11500, amountPaid: 5000, dueDate: new Date("2026-01-31") }),
  inv({ id: "i2", subTotal: 20000, grandTotal: 23000, amountPaid: 23000 }),
  inv({ id: "i-draft", subTotal: 1, grandTotal: 1, status: "draft" }),
  inv({ id: "i-cancel", subTotal: 2, grandTotal: 2, status: "cancelled" }),
  inv({ id: "i-rev", subTotal: 3, grandTotal: 3, reversedAt: new Date("2026-02-01") as any }),
  inv({ id: "i-usd", subTotal: 100, grandTotal: 100, currency: "USD" }),
  // Attached via the contract reference rather than projectId
  inv({ id: "i3", subTotal: 0, grandTotal: 0, projectId: undefined as any, contractId: "c1" }),
  inv({ id: "i-other", subTotal: 999, grandTotal: 999, projectId: "other-project" }),
];

const bills: Bill[] = [
  {
    id: "b1", billNumber: "BILL-1", status: "open", projectId: "p1", currency: "SAR",
    subTotal: 6000, totalTax: 900, grandTotal: 6900, amountPaid: 2300,
  },
  {
    id: "b2", billNumber: "BILL-2", status: "draft", projectId: "p1", currency: "SAR",
    subTotal: 500, totalTax: 75, grandTotal: 575, amountPaid: 0,
  },
  {
    id: "b3", billNumber: "BILL-3", status: "open", projectId: "p1", currency: "USD",
    subTotal: 400, totalTax: 0, grandTotal: 400, amountPaid: 100,
  },
  // Accountant REJECTED a recorded cost — must vanish from every total yet
  // stay visible in billRows for the closure review.
  {
    id: "b4", billNumber: "BILL-4", status: "open", projectId: "p1", currency: "SAR",
    subTotal: 800, totalTax: 120, grandTotal: 920, amountPaid: 920,
    approvalStatus: "rejected", approvedBy: "u-acct", reviewNote: "duplicate invoice",
  },
  // Approved actual cost — the accounting-policy basis for the headline margin.
  {
    id: "b5", billNumber: "BILL-5", status: "paid", projectId: "p1", currency: "SAR",
    subTotal: 4000, totalTax: 600, grandTotal: 4600, amountPaid: 4600,
    approvalStatus: "approved", approvedBy: "u-acct",
  },
  {
    id: "b-other", billNumber: "BILL-X", status: "open", projectId: "other", currency: "SAR",
    subTotal: 1000, totalTax: 150, grandTotal: 1150, amountPaid: 0,
  },
] as unknown as Bill[];

const creditNotes: CreditNote[] = [
  { id: "cn1", type: "credit_note", status: "posted", invoiceId: "i1", currency: "SAR", grandTotal: 1150, subTotal: 1000 },
  { id: "cn2", type: "credit_note", status: "draft", invoiceId: "i2", currency: "SAR", grandTotal: 9999, subTotal: 8695 },
  { id: "cn3", type: "debit_note", status: "posted", invoiceId: "i1", currency: "SAR", grandTotal: 777, subTotal: 675 },
  { id: "cn4", type: "credit_note", status: "posted", invoiceId: "i-other", currency: "SAR", grandTotal: 888, subTotal: 772 },
] as unknown as CreditNote[];

const F = computeProjectFinancials({
  project,
  contracts: [contract],
  invoices,
  bills,
  creditNotes,
  now: "2026-03-01T00:00:00Z",
});

const near = (a: number, b: number, what: string) =>
  assert(Math.abs(a - b) < 0.005, `${what}: expected ${b}, got ${a}`);

await test("contract value is tax-exclusive commercial commitment, never revenue", () => {
  const cv = contractValueOf(contract);
  near(cv.base, 100000, "contract base");
  near(cv.vat, 15000, "contract VAT");
  near(cv.grand, 115000, "contract grand total");
  near(F.contractedValue, 100000, "contractedValue stays tax-exclusive");
});

await test("invoiced / collected exclude draft, cancelled, reversed, foreign, and other-project records", () => {
  near(F.invoicedAmount, 34500, "invoicedAmount");
  near(F.invoicedNetOfTax, 30000, "invoicedNetOfTax");
  near(F.collectedAmount, 28000, "collectedAmount from invoice.amountPaid only");
  assert(F.invoiceCount === 3, `invoiceCount should be 3 (incl. zero-value contract-linked), got ${F.invoiceCount}`);
  assert(F.foreignCurrencyExcluded === 2, `foreign excluded count 2 (i-usd + b3), got ${F.foreignCurrencyExcluded}`);
});

await test("credits reduce receivables; only posted credit_notes against project invoices count", () => {
  near(F.creditNotesAmount, 1150, "creditNotesAmount (cn1 only)");
  near(F.outstandingReceivables, 34500 - 28000 - 1150, "outstanding = invoiced - collected - credits");
});

await test("overdue detection uses injected now, unpaid open amount only", () => {
  assert(F.overdueInvoiceCount === 1, `one overdue invoice, got ${F.overdueInvoiceCount}`);
  near(F.overdueReceivables, 6500, "overdue open amount of i1");
  assert(F.schedule.length === 3, "schedule lists all issued invoices");
  assert(F.schedule[0].invoiceId === "i1" && F.schedule[0].overdue, "earliest due date first and flagged");
  assert(!F.schedule.some((s) => s.invoiceId.startsWith("i-")), "excluded invoices never reach the schedule");
});

await test("expenses vs obligations keep paid/unpaid separate", () => {
  // RECORDED costs = b1 (unreviewed) + b5 (approved). b4 rejected is excluded;
  // b2 draft and b3 foreign never count.
  near(F.expensesActual, 11500, "expensesActual (recorded: b1 + b5)");
  near(F.expensesNetOfTax, 10000, "expensesNetOfTax");
  near(F.paidExpenses, 6900, "paidExpenses (b1 2300 + b5 4600; rejected b4 never counts)");
  near(F.unpaidObligations, 4600, "unpaidObligations (b1 remainder only)");
  assert(F.billCount === 2, `billCount 2 (non-rejected, project currency), got ${F.billCount}`);
});

await test("three cost tiers stay distinct: recorded / approved actual / paid", () => {
  near(F.costsApproved, 4600, "costsApproved counts ONLY accountant-approved bills");
  near(F.costsPendingReview, 6900, "costsPendingReview = recorded minus approved (b1 unset stays unreviewed)");
  assert(F.pendingReviewCount === 1, `pendingReviewCount 1, got ${F.pendingReviewCount}`);
  near(F.costsRejected, 920, "costsRejected slice (visible, excluded)");
  assert(F.rejectedBillCount === 1, `rejectedBillCount 1, got ${F.rejectedBillCount}`);
  near(F.paidCosts, 6900, "paidCosts = settled cash over counted bills");
  // Recording is not approval: the three numbers must never collapse.
  assert(F.expensesActual !== F.costsApproved, "recorded != approved while any bill is unreviewed");
  near(F.expensesActual, F.costsApproved + F.costsPendingReview, "recorded = approved + pending (rejected excluded)");
  near(F.approvedActualMargin, 34500 - 1150 - 4600, "approved-actual margin uses costsApproved only");
  const rejectedRow = F.billRows.find((r) => r.billId === "b4");
  assert(!!rejectedRow && rejectedRow.approvalStatus === "rejected", "rejected bill stays visible in billRows");
  assert(rejectedRow?.reviewNote === "duplicate invoice", "rejection reason rides along for the review");
  assert(F.billRows.some((r) => r.billId === "b1" && r.approvalStatus === undefined), "unreviewed bill surfaces as undefined review state");
});

await test("budget variance, forecast, and margins follow documented formulas", () => {
  near(F.budgetVariance!, 30000 - 11500, "variance = budget - recorded expenses");
  near(F.forecastCost, 11500 + 4600, "forecast = incurred + unpaid");
  near(F.estimatedMargin!, 100000 - 16100, "estimated margin vs forecast cost (operational, not profit)");
  near(F.actualMargin, 34500 - 1150 - 11500, "actual margin = invoiced - credits - recorded expenses (operational)");
  near(F.cashIn, 28000, "cash inflow = collections");
  near(F.cashOut, 6900, "cash outflow = bill payments on counted (non-rejected) bills");
});

await test("project without budget nor contract yields null variance/margin, not fake zero", () => {
  const bare = computeProjectFinancials({
    project: { ...project, id: "p0", contractId: null, budget: null } as Project,
    contracts: [],
    invoices: [],
    bills: [],
    creditNotes: [],
    now: "2026-03-01T00:00:00Z",
  });
  assert(bare.budgetVariance === null, "no budget -> null variance");
  assert(bare.estimatedMargin === null, "no budget and no contract -> null estimated margin");
  near(bare.actualMargin, 0, "empty ledger -> zero actual margin");
  assert(bare.currency === "SAR", "default currency fallback SAR");
});

await test("base currency falls back to first invoice when project has none", () => {
  const noCur = computeProjectFinancials({
    project: { ...project, currency: undefined } as Project,
    contracts: [],
    invoices: [inv({ id: "iE", subTotal: 100, grandTotal: 100, currency: "EGP" })],
    bills: [],
    creditNotes: [],
    now: "2026-03-01T00:00:00Z",
  });
  assert(noCur.currency === "EGP", "project currency derived from first invoice record");
});

await test("attachment rule: projectId OR the project's contractId links a document", () => {
  assert(invoiceAttachedToProject(inv({ id: "x", subTotal: 1, grandTotal: 1 }), project), "projectId link");
  assert(
    invoiceAttachedToProject(inv({ id: "x", subTotal: 1, grandTotal: 1, projectId: undefined as any, contractId: "c1" }), project),
    "contractId link"
  );
  assert(
    !invoiceAttachedToProject(inv({ id: "x", subTotal: 1, grandTotal: 1, projectId: "zz", contractId: "c9" }), project),
    "unrelated doc not attached"
  );
});

await test("legacy bills without a review field are recorded but NEVER counted as approved", () => {
  const legacy = computeProjectFinancials({
    project,
    contracts: [contract],
    invoices: [],
    bills: [bills[0]], // b1: no approvalStatus at all
    creditNotes: [],
    now: "2026-03-01T00:00:00Z",
  });
  near(legacy.expensesActual, 6900, "legacy bill is a recorded cost");
  near(legacy.costsApproved, 0, "never reviewed => never approved (no silent inference)");
  near(legacy.costsPendingReview, 6900, "legacy bill surfaces in the pending-review slice");
  assert(legacy.pendingReviewCount === 1, "legacy bill counts toward the review queue");
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
console.log("\n=======================================================");
console.log(` Projects Unit Summary: ${passedCount}/${testResults.length} passed, ${failedCount} failed`);
console.log("=======================================================\n");
if (failedCount > 0) process.exit(1);
process.exit(0);
