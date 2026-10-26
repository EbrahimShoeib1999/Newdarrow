/**
 * D-Arrow Business — Facilities Management Workflow & Rule Unit Suite
 *
 * Pure unit tests (no Firebase): work-order state machine legality,
 * completion-note enforcement, cost normalization/derivation, overdue and
 * schedule due-date math (including roll-over and idempotency inputs), and
 * every form/service-shared validator. Also pins the domain-boundary contract
 * (fm_ prefix collections + live registry flag) the Firestore rules rely on.
 * Run: npx tsx scripts/test-facilities-workflow.ts
 */

import {
  canTransitionWorkOrder,
  allowedNextStatuses,
  requiresCompletionNote,
  isTerminalStatus,
  normalizeMoney,
  workOrderTotalCost,
  isWorkOrderOverdue,
  addDaysIso,
  computeNextDue,
  scheduleDueState,
  scheduleNeedsWorkOrder,
  validateWorkOrderDraft,
  validateFacilityDraft,
  validateAssetDraft,
  validateScheduleDraft,
  validateVendorDraft,
} from "../src/features/facilities/lib/work-order-rules";
import { domainCollection } from "../src/features/activities/types/activity-domain";
import { ACTIVITY_REGISTRY } from "../src/features/activities/types/activity.types";
import type { WorkOrderStatus } from "../src/features/facilities/types/facilities.types";

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
group("Work-order status machine");

const ALL_STATUSES: WorkOrderStatus[] = [
  "requested",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];

await test("every declared status has an edge list", () => {
  for (const s of ALL_STATUSES) {
    assert(Array.isArray(allowedNextStatuses(s)), `${s} must have an edges array`);
  }
});

await test("happy path is walkable: requested → assigned → in_progress → completed", () => {
  assert(canTransitionWorkOrder("requested", "assigned"), "requested→assigned");
  assert(canTransitionWorkOrder("assigned", "in_progress"), "assigned→in_progress");
  assert(canTransitionWorkOrder("in_progress", "completed"), "in_progress→completed");
});

await test("no edge skips triage or execution (requested→completed illegal)", () => {
  assert(!canTransitionWorkOrder("requested", "completed"), "requested must not jump to completed");
  assert(!canTransitionWorkOrder("requested", "in_progress"), "requested must not jump to in_progress");
});

await test("hold is reversible, completion and cancellation are terminal", () => {
  assert(canTransitionWorkOrder("in_progress", "on_hold") && canTransitionWorkOrder("on_hold", "in_progress"), "on_hold round-trip");
  assert(allowedNextStatuses("completed").length === 0, "completed is terminal");
  assert(allowedNextStatuses("cancelled").length === 0, "cancelled is terminal");
  assert(isTerminalStatus("completed") && isTerminalStatus("cancelled"), "terminal detection");
  assert(!isTerminalStatus("on_hold"), "on_hold is not terminal");
});

await test("only completion demands a note", () => {
  assert(requiresCompletionNote("completed"), "completed requires note");
  for (const s of ALL_STATUSES.filter((x) => x !== "completed")) {
    assert(!requiresCompletionNote(s), `${s} must not require a note`);
  }
});

/* -------------------------------------------------------------------------- */
group("Costs — buckets, derivation, safety");

await test("normalizeMoney clamps junk to 0 and rounds to 2dp", () => {
  assert(normalizeMoney(-5) === 0, "negative clamps to 0");
  assert(normalizeMoney("abc") === 0, "non-numeric becomes 0");
  assert(normalizeMoney(null) === 0, "null becomes 0");
  assert(normalizeMoney(10.005) === 10.01 || normalizeMoney(10.005) === 10, "rounding is 2dp-safe");
  assert(normalizeMoney(12.34) === 12.34, "clean value passes through");
});

await test("total is always derived from the two buckets", () => {
  assert(workOrderTotalCost(10.5, 4.25) === 14.75, "10.50 + 4.25 = 14.75");
  assert(workOrderTotalCost(-1, 5) === 5, "negative bucket normalized before summing");
});

/* -------------------------------------------------------------------------- */
group("Dates, overdue and schedule due math");

await test("overdue only for non-terminal orders with a passed due date", () => {
  assert(isWorkOrderOverdue("2026-01-01", "in_progress", "2026-06-01"), "past due in flight is overdue");
  assert(!isWorkOrderOverdue("2026-01-01", "completed", "2026-06-01"), "completed is never overdue");
  assert(!isWorkOrderOverdue("2026-01-01", "cancelled", "2026-06-01"), "cancelled is never overdue");
  assert(!isWorkOrderOverdue(null, "assigned", "2026-06-01"), "no due date is not overdue");
  assert(!isWorkOrderOverdue("garbage", "assigned", "2026-06-01"), "invalid date is not overdue");
  assert(!isWorkOrderOverdue("2026-06-01", "assigned", "2026-06-01"), "due-today is not overdue");
});

await test("addDaysIso moves forward AND backward", () => {
  assert(addDaysIso("2026-03-01", 10) === "2026-03-11", "+10 days");
  assert(addDaysIso("2026-03-01", -30) === "2026-01-30", "-30 days (dashboard window)");
  assert(addDaysIso("2026-01-31", 1) === "2026-02-01", "month roll-over");
});

await test("computeNextDue rolls from last done date, falls back to baseline", () => {
  assert(computeNextDue("2026-05-01", 90, "2026-01-01") === "2026-07-30", "rolls from last done");
  assert(computeNextDue(null, 30, "2026-05-01") === "2026-05-31", "falls back to baseline");
});

await test("schedule due states partition the timeline", () => {
  assert(scheduleDueState("2026-06-01", "2026-06-01") === "due_today", "exact day");
  assert(scheduleDueState("2026-05-31", "2026-06-01") === "overdue", "before today");
  assert(scheduleDueState("2026-06-05", "2026-06-01") === "due_soon", "within 7-day window");
  assert(scheduleDueState("2026-06-30", "2026-06-01") === "ok", "far future");
});

await test("only ACTIVE schedules due today or overdue warrant a work order", () => {
  assert(scheduleNeedsWorkOrder({ nextDueDate: "2026-06-01", active: true }, "2026-06-01"), "due today");
  assert(scheduleNeedsWorkOrder({ nextDueDate: "2026-05-01", active: true }, "2026-06-01"), "overdue");
  assert(!scheduleNeedsWorkOrder({ nextDueDate: "2026-06-01", active: false }, "2026-06-01"), "paused never fires");
  assert(!scheduleNeedsWorkOrder({ nextDueDate: "2026-06-10", active: true }, "2026-06-01"), "due-soon is not due");
});

/* -------------------------------------------------------------------------- */
group("Draft validators (shared by forms and service)");

await test("work-order draft needs a 3+ char title and valid enums", () => {
  assert(validateWorkOrderDraft({ title: "AB", priority: "low" }).some((e) => e.field === "title"), "short title rejected");
  assert(validateWorkOrderDraft({ title: "Compressor leak", priority: "low" }).length === 0, "clean draft passes");
  assert(validateWorkOrderDraft({ title: "Fix pump", priority: "whenever" as any }).some((e) => e.field === "priority"), "bad priority rejected");
  assert(validateWorkOrderDraft({ title: "Fix pump", priority: "high", dueDate: "not-a-date" }).some((e) => e.field === "dueDate"), "bad date rejected");
  assert(validateWorkOrderDraft({ title: "Fix pump", priority: "high", partsCost: 1.234 }).some((e) => e.field === "partsCost"), "3dp money rejected");
});

await test("facility, asset, schedule and vendor drafts enforce their minimums", () => {
  assert(validateFacilityDraft({ name: "A" }).some((e) => e.field === "name"), "1-char facility name rejected");
  assert(validateFacilityDraft({ name: "Tower", area: -1 }).some((e) => e.field === "area"), "negative area rejected");
  assert(validateAssetDraft({ tag: "", name: "Chiller" }).some((e) => e.field === "tag"), "asset tag mandatory");
  assert(validateScheduleDraft({ title: "PM", intervalDays: 0 }).some((e) => e.field === "intervalDays"), "0-day interval rejected");
  assert(validateScheduleDraft({ title: "PM", intervalDays: 3651 }).some((e) => e.field === "intervalDays"), ">3650 rejected");
  assert(validateScheduleDraft({ title: "Quarterly HVAC", intervalDays: 90 }).length === 0, "clean schedule passes");
  assert(validateVendorDraft({ name: "Co" }).length === 0, "clean vendor passes");
  assert(validateVendorDraft({ name: "Contractor", email: "not-email" }).some((e) => e.field === "email"), "bad email rejected");
});

/* -------------------------------------------------------------------------- */
group("Domain boundary contract (rules rely on these exact names)");

await test("all five facilities collections carry the fm_ prefix", () => {
  // Same contract the service composes — asserted here without loading Firebase.
  const entities = ["facilities", "assets", "work_orders", "pm_schedules", "vendors"];
  for (const entity of entities) {
    const name = domainCollection("FACILITIES_MANAGEMENT", entity);
    assert(name.startsWith("fm_"), `${entity} collection "${name}" must start with fm_`);
  }
  assert(domainCollection("FACILITIES_MANAGEMENT", "work_orders") === "fm_work_orders", "work-order collection name is stable");
});

await test("FACILITIES_MANAGEMENT is registered as a live module", () => {
  assert(ACTIVITY_REGISTRY.FACILITIES_MANAGEMENT.moduleLive === true, "moduleLive must be true once pages ship");
  assert(ACTIVITY_REGISTRY.FACILITIES_MANAGEMENT.routeBase === "/facilities", "route prefix matches PORTAL_PATHS");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passedCount}/${passedCount + failedCount} passed`);
process.exit(failedCount ? 1 : 0);
