/**
 * D-Arrow Business — Marketing Agency Workflow & Rule Unit Suite
 *
 * Pure unit tests (no Firebase): campaign state machine legality, budget
 * revision audit rules (the ONLY path to changing an approved budget),
 * spend/revenue derivation (budget-vs-actual), deliverable review machine
 * with the client-sign-off publication gate, content publication machine with
 * scheduled-date preconditions, every form/service-shared validator, and the
 * domain-boundary contract (mkt_ prefix collections + registry route) the
 * Firestore rules rely on.
 * Run: npx tsx scripts/test-marketing-workflow.ts
 */

import {
  normalizeMoney,
  canTransitionCampaign,
  allowedNextCampaignStatuses,
  isTerminalCampaignStatus,
  canActivateCampaign,
  canProposeRevision,
  hasPendingRevision,
  applyRevisionApproval,
  rejectRevision,
  validateCampaignDraft,
  validateRevisionDraft,
  validateExpenseDraft,
  totalSpent,
  computeBudgetVsActual,
  computeDeliverySummary,
  isDeliverableOverdue,
} from "../src/features/agency/lib/campaign-rules";
import {
  canTransitionDeliverable,
  allowedNextDeliverableStatuses,
  isTerminalDeliverableStatus,
  canPublishDeliverable,
  canSetClientApproval,
  canTransitionContent,
  allowedNextContentStatuses,
  isTerminalContentStatus,
  canScheduleContent,
  validateDeliverableDraft,
  validateContentDraft,
  validateBriefDraft,
  overdueDeliverables,
} from "../src/features/agency/lib/deliverable-rules";
import { domainCollection } from "../src/features/activities/types/activity-domain";
import { ACTIVITY_REGISTRY } from "../src/features/activities/types/activity.types";
import type {
  BudgetRevision,
  CampaignExpense,
  CampaignStatus,
  ContentItem,
  ContentStatus,
  Deliverable,
  DeliverableStatus,
  InvoiceRevenueLike,
} from "../src/features/agency/types/marketing.types";

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

function group(title: string) {
  console.log(`\n${title}`);
}

/* -------------------------------------------------------------------------- */
group("Campaign status machine");

const CAMPAIGN_STATUSES: CampaignStatus[] = [
  "draft",
  "approved",
  "active",
  "paused",
  "completed",
  "cancelled",
];

await test("every declared campaign status has an edge list", () => {
  for (const s of CAMPAIGN_STATUSES) {
    assert(Array.isArray(allowedNextCampaignStatuses(s)), `${s} must have an edges array`);
  }
});

await test("happy path is walkable: draft → approved → active → completed", () => {
  assert(canTransitionCampaign("draft", "approved"), "draft→approved");
  assert(canTransitionCampaign("approved", "active"), "approved→active");
  assert(canTransitionCampaign("active", "completed"), "active→completed");
});

await test("no skip edges: draft cannot activate or complete", () => {
  assert(!canTransitionCampaign("draft", "active"), "draft→active must be illegal");
  assert(!canTransitionCampaign("draft", "completed"), "draft→completed must be illegal");
  assert(!canTransitionCampaign("approved", "completed"), "approved→completed must be illegal");
});

await test("pause/resume round-trip is legal both ways", () => {
  assert(canTransitionCampaign("active", "paused"), "active→paused");
  assert(canTransitionCampaign("paused", "active"), "paused→active");
  assert(canTransitionCampaign("paused", "completed"), "paused→completed");
});

await test("terminals expose no edges", () => {
  assert(isTerminalCampaignStatus("completed"), "completed is terminal");
  assert(isTerminalCampaignStatus("cancelled"), "cancelled is terminal");
  for (const s of CAMPAIGN_STATUSES) {
    assert(!canTransitionCampaign("completed", s), `completed→${s} illegal`);
    assert(!canTransitionCampaign("cancelled", s), `cancelled→${s} illegal`);
  }
  assert(!isTerminalCampaignStatus("active"), "active is not terminal");
});

await test("activating requires an approved budget > 0", () => {
  assert(!canActivateCampaign({ budgetAmount: 0 }), "zero budget cannot activate");
  assert(canActivateCampaign({ budgetAmount: 5000 }), "positive budget activates");
});

/* -------------------------------------------------------------------------- */
group("Budget revisions (approved-budget audit)");

const mkRevision = (over: Partial<BudgetRevision> = {}): BudgetRevision => ({
  id: "rev-1",
  previousAmount: 5000,
  newAmount: 8000,
  reason: "Added video channel",
  state: "pending",
  proposedBy: "u1",
  proposedAt: "2026-10-01T10:00:00.000Z",
  ...over,
});

await test("draft campaigns edit budget directly; later changes need a revision", () => {
  assert(!canProposeRevision("draft"), "draft must not need a revision");
  assert(canProposeRevision("approved"), "approved allows revision");
  assert(canProposeRevision("active"), "active allows revision");
  assert(canProposeRevision("paused"), "paused allows revision");
  assert(!canProposeRevision("completed"), "completed blocks revision");
  assert(!canProposeRevision("cancelled"), "cancelled blocks revision");
});

await test("only one open revision at a time", () => {
  assert(hasPendingRevision([mkRevision()]), "pending blocks a second proposal");
  assert(!hasPendingRevision([mkRevision({ state: "approved" })]), "decided list allows new");
});

await test("approval raises the budget and can never be replayed", () => {
  const campaign = { budgetAmount: 5000, budgetRevisions: [mkRevision()] };
  const res = applyRevisionApproval(campaign, "rev-1");
  assert(res !== null, "first approval succeeds");
  assert(res!.budgetAmount === 8000, `budget becomes 8000, got ${res!.budgetAmount}`);
  assert(res!.revisions[0].state === "approved", "revision marked approved");
  const replay = applyRevisionApproval(
    { budgetAmount: res!.budgetAmount, budgetRevisions: res!.revisions },
    "rev-1"
  );
  assert(replay === null, "second approval of same revision must be refused");
});

await test("rejection leaves the approved budget untouched", () => {
  const campaign = { budgetAmount: 5000, budgetRevisions: [mkRevision()] };
  const revisions = rejectRevision(campaign, "rev-1");
  assert(revisions !== null, "rejection succeeds");
  assert(revisions![0].state === "rejected", "revision marked rejected");
  assert(
    rejectRevision({ budgetRevisions: revisions! }, "rev-1") === null,
    "cannot decide a decided revision twice"
  );
});

await test("revision validator requires reason and positive amount", () => {
  assert(Object.keys(validateRevisionDraft({ newAmount: 0, reason: "x".repeat(4) })).length === 1, "amount error");
  assert(Object.keys(validateRevisionDraft({ newAmount: 100, reason: "" })).length === 1, "reason error");
  assert(Object.keys(validateRevisionDraft({ newAmount: 100, reason: "good reason" })).length === 0, "valid");
});

/* -------------------------------------------------------------------------- */
group("Campaign + expense validators");

await test("campaign draft catches every required field", () => {
  const e = validateCampaignDraft({});
  assert(Boolean(e.name && e.clientId && e.channels && e.budgetAmount && e.currency), "all required flags");
  const ok = validateCampaignDraft({
    name: "Ramadan Push",
    clientId: "ct1",
    channels: ["social"],
    budgetAmount: 10000,
    currency: "SAR",
  });
  assert(Object.keys(ok).length === 0, "valid draft has no errors");
});

await test("end date before start date is rejected", () => {
  const e = validateCampaignDraft({
    name: "Ramadan Push",
    clientId: "ct1",
    channels: ["social"],
    budgetAmount: 10000,
    currency: "SAR",
    startDate: "2026-10-01",
    endDate: "2026-09-01",
  });
  assert(e.endDate === "campaign.endDateBeforeStart", "endDate flag");
});

await test("expense draft requires campaign, title, positive amount, date, currency", () => {
  const e = validateExpenseDraft({});
  assert(Boolean(e.campaignId && e.title && e.amount && e.spentAt && e.currency), "all required flags");
  const zero = validateExpenseDraft({ campaignId: "c1", title: "Ads", amount: 0, spentAt: "2026-10-02", currency: "SAR" });
  assert(Boolean(zero.amount), "zero amount rejected");
  const ok = validateExpenseDraft({ campaignId: "c1", title: "Ads", amount: 120.5, spentAt: "2026-10-02", currency: "SAR" });
  assert(Object.keys(ok).length === 0, "valid expense");
});

/* -------------------------------------------------------------------------- */
group("Budget-vs-actual derivation (persisted data only)");

const mkExpense = (over: Partial<CampaignExpense> = {}): CampaignExpense => ({
  id: "e1",
  campaignId: "cp1",
  title: "Meta ads",
  category: "media_buy",
  amount: 100,
  spentAt: "2026-10-01",
  currency: "SAR",
  createdAt: "",
  updatedAt: "",
  ...over,
});

await test("money normalizes to 2 decimals and clamps negatives", () => {
  assert(normalizeMoney(10.004) === 10, `10.004 -> 10, got ${normalizeMoney(10.004)}`);
  assert(normalizeMoney(10.006) === 10.01, `10.006 -> 10.01, got ${normalizeMoney(10.006)}`);
  assert(normalizeMoney(2.345) === 2.35 || normalizeMoney(2.345) === 2.34, "banker rounding tolerated");
  assert(normalizeMoney(-5) === 0, "negatives clamp to 0");
  assert(normalizeMoney("abc") === 0, "garbage clamps to 0");
});

await test("spend totals only the campaign's own expenses", () => {
  const spent = totalSpent(
    [mkExpense({ amount: 100.1 }), mkExpense({ id: "e2", amount: 200.2 }), mkExpense({ campaignId: "other", amount: 999 })],
    "cp1"
  );
  assert(spent === 300.3, `expected 300.3 got ${spent}`);
});

await test("budget-vs-actual separates spend from revenue and flags overrun", () => {
  const invoices: InvoiceRevenueLike[] = [
    { id: "i1", campaignId: "cp1", status: "paid", grandTotal: 5000, amountPaid: 5000, currency: "SAR" },
    { id: "i2", campaignId: "cp1", status: "sent", grandTotal: 2000, amountPaid: 500, currency: "SAR" },
    { id: "i3", campaignId: "cp1", status: "cancelled", grandTotal: 9999, amountPaid: 9999, currency: "SAR" },
    { id: "i4", campaignId: "other", status: "paid", grandTotal: 1234, amountPaid: 1234, currency: "SAR" },
  ];
  const r = computeBudgetVsActual(
    { id: "cp1", code: "CMP-0001", name: "Ramadan Push", budgetAmount: 1000, currency: "SAR" },
    [mkExpense({ amount: 700 }), mkExpense({ id: "e2", amount: 400 })],
    invoices
  );
  assert(r.budget === 1000, "budget");
  assert(r.spent === 1100, `spent sums only cp1: got ${r.spent}`);
  assert(r.remaining === -100, `remaining negative: got ${r.remaining}`);
  assert(r.overBudget === true, "overBudget flagged");
  assert(r.utilization === 1.1, `utilization 1.1: got ${r.utilization}`);
  // Cancelled + other-campaign invoices excluded entirely.
  assert(r.invoiced === 7000, `invoiced 7000 (5000+2000): got ${r.invoiced}`);
  assert(r.collected === 5500, `collected 5500 (5000+500): got ${r.collected}`);
});

await test("zero budget yields zero utilization (no divide-by-zero)", () => {
  const r = computeBudgetVsActual({ id: "cp1", code: "C", name: "N", budgetAmount: 0, currency: "SAR" }, [], []);
  assert(r.utilization === 0, "utilization 0");
});

/* -------------------------------------------------------------------------- */
group("Deliverable review machine + client sign-off gate");

const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "not_started",
  "in_progress",
  "in_review",
  "revision_requested",
  "approved",
  "published",
  "cancelled",
];

await test("review loop is walkable including the revision hop back", () => {
  assert(canTransitionDeliverable("not_started", "in_progress"), "start");
  assert(canTransitionDeliverable("in_progress", "in_review"), "review");
  assert(canTransitionDeliverable("in_review", "revision_requested"), "revision requested");
  assert(canTransitionDeliverable("revision_requested", "in_progress"), "back to production");
  assert(canTransitionDeliverable("in_review", "approved"), "approved");
  assert(canTransitionDeliverable("approved", "published"), "published");
});

await test("no skip edges: unreviewed work cannot be approved or published", () => {
  assert(!canTransitionDeliverable("not_started", "approved"), "not_started→approved illegal");
  assert(!canTransitionDeliverable("in_progress", "approved"), "in_progress→approved illegal");
  assert(!canTransitionDeliverable("in_review", "published"), "in_review→published illegal (approval is its own step)");
  assert(!canTransitionDeliverable("not_started", "published"), "not_started→published illegal");
});

await test("published/cancelled are terminals", () => {
  for (const s of DELIVERABLE_STATUSES) {
    assert(!canTransitionDeliverable("published", s), `published→${s} illegal`);
    assert(!canTransitionDeliverable("cancelled", s), `cancelled→${s} illegal`);
  }
  assert(isTerminalDeliverableStatus("published") && isTerminalDeliverableStatus("cancelled"), "terminals");
  assert(DELIVERABLE_STATUSES.every((s) => Array.isArray(allowedNextDeliverableStatuses(s))), "edge lists exist");
});

await test("publication requires client sign-off when configured", () => {
  assert(
    canPublishDeliverable({ status: "approved", requiresClientApproval: false, clientApprovalState: "not_required" }),
    "no sign-off needed"
  );
  assert(
    !canPublishDeliverable({ status: "approved", requiresClientApproval: true, clientApprovalState: "pending" }),
    "pending sign-off blocks publish"
  );
  assert(
    !canPublishDeliverable({ status: "approved", requiresClientApproval: true, clientApprovalState: "rejected" }),
    "rejected sign-off blocks publish"
  );
  assert(
    canPublishDeliverable({ status: "approved", requiresClientApproval: true, clientApprovalState: "approved" }),
    "signed off publishes"
  );
  assert(
    !canPublishDeliverable({ status: "in_review", requiresClientApproval: false, clientApprovalState: "not_required" }),
    "internal status must be approved first"
  );
});

await test("client approval state machine", () => {
  assert(canSetClientApproval("in_review", "not_required", "pending"), "request sign-off");
  assert(canSetClientApproval("in_review", "pending", "approved"), "client approves");
  assert(canSetClientApproval("in_review", "pending", "rejected"), "client rejects");
  assert(canSetClientApproval("approved", "rejected", "pending"), "re-request after fix");
  assert(!canSetClientApproval("in_review", "pending", "not_required"), "cannot erase a pending ask");
  assert(!canSetClientApproval("not_started", "not_required", "pending"), "cannot ask before review");
});

await test("deliverable validator + overdue/summary derivation", () => {
  assert(Boolean(validateDeliverableDraft({}).campaignId), "campaign required");
  assert(Boolean(validateDeliverableDraft({ campaignId: "c", title: "ab" }).title), "title min length");
  assert(Boolean(validateDeliverableDraft({ campaignId: "c", title: "good", dueDate: "oct" }).dueDate), "bad date");
  const mkD = (over: Partial<Deliverable> = {}): Deliverable => ({
    id: "d1",
    campaignId: "cp1",
    title: "Reel",
    status: "in_progress",
    requiresClientApproval: false,
    clientApprovalState: "not_required",
    clientApprovalHistory: [],
    dueDate: "2026-10-20",
    statusHistory: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  });
  assert(isDeliverableOverdue(mkD({ dueDate: "2026-10-20" }), "2026-10-26"), "past due open = overdue");
  assert(!isDeliverableOverdue(mkD({ status: "approved" }), "2026-10-26"), "approved is not overdue");
  const summary = computeDeliverySummary([
    mkD(),
    mkD({ id: "d2", status: "approved", dueDate: "2026-10-20", statusHistory: [{ from: "in_review", to: "approved", at: "2026-10-19T00:00:00.000Z", by: "u" }] }),
    mkD({ id: "d3", status: "approved", dueDate: "2026-10-20", statusHistory: [{ from: "in_review", to: "approved", at: "2026-10-22T00:00:00.000Z", by: "u" }] }),
    mkD({ id: "d4", status: "cancelled" }),
  ]);
  assert(summary.total === 4 && summary.byStatus.approved === 2, "counts");
  assert(summary.overdue === 1, `one open overdue, got ${summary.overdue}`);
  assert(summary.completedOnTime === 1 && summary.completedLate === 1, "on-time vs late split");
  assert(overdueDeliverables([mkD(), mkD({ id: "d9", dueDate: null })], "2026-10-26").length === 1, "filter");
});

/* -------------------------------------------------------------------------- */
group("Content publication machine");

const CONTENT_STATUSES: ContentStatus[] = ["draft", "approved", "scheduled", "published", "cancelled"];

await test("calendar path requires its own steps", () => {
  assert(canTransitionContent("draft", "approved"), "approve");
  assert(canTransitionContent("approved", "scheduled"), "schedule");
  assert(canTransitionContent("scheduled", "published"), "publish");
  assert(!canTransitionContent("draft", "published"), "no skip draft→published");
  assert(!canTransitionContent("approved", "published"), "no skip approved→published");
});

await test("scheduled date is a hard precondition for scheduling", () => {
  assert(!canScheduleContent({ status: "approved", scheduledDate: null } as ContentItem), "needs a date");
  assert(canScheduleContent({ status: "approved", scheduledDate: "2026-11-01" } as ContentItem), "with date");
  assert(!canScheduleContent({ status: "draft", scheduledDate: "2026-11-01" } as ContentItem), "must be approved first");
});

await test("published/cancelled terminals + edge lists", () => {
  for (const s of CONTENT_STATUSES) {
    assert(Array.isArray(allowedNextContentStatuses(s)), `${s} edges exist`);
    assert(!canTransitionContent("published", s) && !canTransitionContent("cancelled", s), `terminals frozen at ${s}`);
  }
  assert(isTerminalContentStatus("published") && isTerminalContentStatus("cancelled"), "terminal flags");
});

await test("content + brief validators catch missing links", () => {
  assert(Boolean(validateContentDraft({}).campaignId), "campaign required");
  assert(Boolean(validateContentDraft({ campaignId: "c", title: "ok title", channel: "" }).channel), "channel required");
  assert(Boolean(validateContentDraft({ campaignId: "c", title: "ok title", channel: "social", scheduledDate: "bad" }).scheduledDate), "date shape");
  assert(Boolean(validateBriefDraft({ campaignId: "c", title: "Brief", body: "short" }).body), "min body");
  const okBrief = validateBriefDraft({ campaignId: "c", title: "Ramadan brief", body: "x".repeat(20) });
  assert(Object.keys(okBrief).length === 0, "valid brief");
});

/* -------------------------------------------------------------------------- */
group("Domain boundary contract (rules parity)");

await test("marketing collections resolve to the mkt_ prefix the rules gate", () => {
  assert(domainCollection("MARKETING_AGENCY", "campaigns") === "mkt_campaigns", "mkt_campaigns");
  assert(domainCollection("MARKETING_AGENCY", "expenses") === "mkt_expenses", "mkt_expenses");
  assert(domainCollection("MARKETING_AGENCY", "deliverables") === "mkt_deliverables", "mkt_deliverables");
  assert(domainCollection("MARKETING_AGENCY", "briefs") === "mkt_briefs", "mkt_briefs");
  assert(domainCollection("MARKETING_AGENCY", "content_items") === "mkt_content_items", "mkt_content_items");
});

await test("registry route base is the /agency namespace the guard mounts", () => {
  assert(ACTIVITY_REGISTRY.MARKETING_AGENCY.routeBase === "/agency", "routeBase /agency");
});

/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passedCount} passed, ${failedCount} failed, ${testResults.length} total`);
if (failedCount > 0) {
  console.log("\nFailed tests:");
  for (const t of testResults.filter((x) => !x.passed)) console.log(`  ✗ ${t.name}: ${t.error}`);
  process.exit(1);
} else {
  console.log("\nAll Marketing workflow rule tests passed!");
  process.exit(0);
}
