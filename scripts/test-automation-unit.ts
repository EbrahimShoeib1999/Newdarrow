/**
 * D-Arrow Business — Automation Unit Suite (Phase 9)
 *
 * Pure unit tests (no Firebase): idempotency key generation, period bucketing,
 * overdue detection, budget thresholds, bill-review alerts, invoice due alerts,
 * unit status change alerts. All predicates are exercised with synthetic fixtures.
 * Run: npx tsx scripts/test-automation-unit.ts
 */

import {
  periodToken,
  automationEventId,
} from "../src/features/automation/types/automation.types";
import {
  overdueTaskAlerts,
  budgetThresholdAlert,
  billReviewNeededAlert,
  billStatusChangedAlert,
  invoiceDueAlerts,
  unitStatusChangedAlert,
} from "../src/features/automation/lib/automation-predicates";

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
console.log(" D-Arrow Business — Automation Unit Tests");
console.log("=======================================================\n");

/* -------------------------------------------------------------------------- */
/* 1. Dedup token generation                                                  */
/* -------------------------------------------------------------------------- */
console.log("1. Idempotency tokens and period bucketing:");

await test("periodToken produces stable date/hour buckets", () => {
  const d = new Date("2026-10-24T14:30:00Z");
  assert(periodToken("day", d) === "2026-10-24", "day = YYYY-MM-DD");
  assert(periodToken("hour", d) === "2026-10-24T14", "hour = YYYY-MM-DDTHH");
  assert(periodToken("once", d) === "always", "once = static");
});

await test("automationEventId is deterministic", () => {
  const d = new Date("2026-10-24T10:00:00Z");
  const id1 = automationEventId("overdue_task_notify_pm", "task123", "day", d);
  const id2 = automationEventId("overdue_task_notify_pm", "task123", "day", d);
  assert(id1 === id2, "same inputs = same id");
  assert(id1.includes("overdue_task_notify_pm"), "rule prefix");
  assert(id1.includes("task123"), "entity id embedded");
  assert(id1.includes("2026-10-24"), "period suffix");
});

/* -------------------------------------------------------------------------- */
/* 2. Overdue task alerts (B2)                                                */
/* -------------------------------------------------------------------------- */
console.log("2. Overdue task alerts (B2):");

await test("overdue tasks fire per-manager alert, done tasks skip", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const tasks = [
    { id: "t1", title: "Write report", status: "todo", dueDate: "2026-10-20T10:00:00Z" },
    { id: "t2", title: "Done thing", status: "done", dueDate: "2026-10-19T10:00:00Z" },
    { id: "t3", title: "Future task", status: "in_progress", dueDate: "2026-10-30T10:00:00Z" },
    { id: "t4", title: "No date task", status: "in_review", dueDate: null },
    { id: "t5", title: "Bad date", status: "todo", dueDate: "not-a-date" },
  ];
  const managers = [
    { id: "m1", role: "admin" },
    { id: "m2", role: "manager" },
  ];
  const alerts = overdueTaskAlerts(tasks as any, managers as any, now);
  assert(alerts.length === 1, "only t1 is overdue");
  assert(alerts[0].entityId === "t1", "correct entity");
  assert(alerts[0].notifications.length === 2, "both managers notified");
});

await test("zero managers -> zero alerts even with overdue items", () => {
  const tasks = [{ id: "x", title: "X", status: "todo", dueDate: "2020-01-01" }];
  assert(overdueTaskAlerts(tasks as any, []).length === 0, "no managers, no alerts");
});

/* -------------------------------------------------------------------------- */
/* 3. Budget threshold (B3)                                                   */
/* -------------------------------------------------------------------------- */
console.log("3. Budget threshold alerts (B3):");

await test("under 80% produces no alert", () => {
  const r = budgetThresholdAlert(
    { projectId: "p1", totalApproved: 700, contractValue: 1000, currency: "SAR" },
    [{ id: "a1" }]
  );
  assert(r === null, "below threshold, no alert");
});

await test("80-100% produces a warning", () => {
  const r = budgetThresholdAlert(
    { projectId: "p1", totalApproved: 850, contractValue: 1000, currency: "SAR" },
    [{ id: "a1" }]
  );
  assert(r !== null, "warning fires");
  assert(r!.notifications[0].title.includes("warning"), "warning label");
});

await test(">100% produces an exceeded alert", () => {
  const r = budgetThresholdAlert(
    { projectId: "p1", totalApproved: 1100, contractValue: 1000, currency: "SAR" },
    [{ id: "a1" }]
  );
  assert(r !== null, "exceeded fires");
  assert(r!.notifications[0].title.includes("EXCEEDED"), "exceeded label");
});

await test("zero/null contractValue is skipped", () => {
  assert(
    budgetThresholdAlert({ projectId: "p1", totalApproved: 100, contractValue: 0, currency: "SAR" }, [{ id: "a" }]) === null,
    "zero budget -> null"
  );
  assert(
    budgetThresholdAlert({ projectId: "p1", totalApproved: 100, contractValue: null, currency: "SAR" }, [{ id: "a" }]) === null,
    "null budget -> null"
  );
});

/* -------------------------------------------------------------------------- */
/* 4. Bill review / status-change (B4, B5)                                    */
/* -------------------------------------------------------------------------- */
console.log("4. Bill review and status-change alerts:");

await test("pending bill triggers review alert", () => {
  const bill = { id: "b1", billNumber: "BILL-001", vendorName: "Acme", grandTotal: 500, currency: "SAR", approvalStatus: "pending" as const };
  const r = billReviewNeededAlert(bill as any, [{ id: "acct1" }, { id: "acct2" }]);
  assert(r !== null, "fires");
  assert(r!.notifications.length === 2, "both accountants notified");
});

await test("approved bill does NOT trigger review alert", () => {
  const bill = { id: "b2", billNumber: "BILL-002", vendorName: "X", grandTotal: 100, currency: "SAR", approvalStatus: "approved" as const };
  assert(billReviewNeededAlert(bill as any, [{ id: "a" }]) === null, "already approved");
});

await test("no recipients yields null (guard)", () => {
  const bill = { id: "b3", billNumber: "BILL-003", vendorName: "Y", grandTotal: 200, currency: "SAR", approvalStatus: "pending" as const };
  assert(billReviewNeededAlert(bill as any, []) === null, "empty recipients");
});

await test("status change from pending to approved fires alert", () => {
  const bill = { id: "b4", billNumber: "BILL-004", vendorName: "Z", grandTotal: 300, currency: "SAR", approvalStatus: "approved" as const };
  const r = billStatusChangedAlert(bill as any, "pending", [{ id: "u1" }]);
  assert(r !== null, "transition detected");
  assert(r!.notifications[0].message.includes("approved"), "approved in message");
});

await test("same-status no-op produces null", () => {
  const bill = { id: "b5", billNumber: "BILL-005", vendorName: "W", grandTotal: 0, currency: "SAR", approvalStatus: "approved" as const };
  assert(billStatusChangedAlert(bill as any, "approved", [{ id: "u1" }]) === null, "no transition");
});

/* -------------------------------------------------------------------------- */
/* 5. Invoice due / overdue (B6, B7)                                          */
/* -------------------------------------------------------------------------- */
console.log("5. Invoice due and overdue alerts:");

await test("invoice overdue fires correct alert", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const invoices = [
    { id: "inv1", invoiceNumber: "INV-001", status: "sent", dueDate: new Date("2026-10-20T12:00:00Z") },
    { id: "inv2", invoiceNumber: "INV-002", status: "pending", dueDate: new Date("2026-10-26T12:00:00Z") },
    { id: "inv3", invoiceNumber: "INV-003", status: "paid", dueDate: new Date("2026-10-20T12:00:00Z") },
  ];
  const recipients = [{ id: "admin1" }];
  const alerts = invoiceDueAlerts(invoices as any, recipients, { warnWindow: 3, now });
  assert(alerts.length === 2, "one overdue + one due-soon (paid skipped)");
  assert(alerts.some((a) => a.ruleId === "invoice_overdue" && a.entityId === "inv1"), "overdue detected");
  assert(alerts.some((a) => a.ruleId === "invoice_due_soon" && a.entityId === "inv2"), "due-soon detected");
});

await test("no recipients -> empty", () => {
  const invoices = [{ id: "x", invoiceNumber: "X", status: "overdue", dueDate: new Date("2020-01-01") }];
  assert(invoiceDueAlerts(invoices as any, []).length === 0, "empty");
});

/* -------------------------------------------------------------------------- */
/* 6. Unit status change (B12)                                                */
/* -------------------------------------------------------------------------- */
console.log("6. Unit status change alerts:");

await test("unit transition fires alert for each recipient", () => {
  const unit = { id: "u1", projectId: "p1", code: "A-101", unitType: "apartment", price: 500000, currency: "SAR", status: "sold" as const, createdAt: "", updatedAt: "" };
  const r = unitStatusChangedAlert(unit as any, "available", "sold", [{ id: "m1" }, { id: "m2" }]);
  assert(r !== null, "fires");
  assert(r!.notifications.length === 2, "both managers notified");
  assert(r!.notifications[0].title.includes("A-101"), "unit code in title");
});

await test("same-status transition is a no-op", () => {
  const unit = { id: "u2", projectId: "p1", code: "B-202", unitType: "office", price: 0, currency: "SAR", status: "available" as const, createdAt: "", updatedAt: "" };
  assert(unitStatusChangedAlert(unit as any, "available", "available", [{ id: "m1" }]) === null, "no change");
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
console.log("\n=======================================================");
console.log(` Automation Unit Summary: ${passedCount}/${testResults.length} passed, ${failedCount} failed`);
console.log("=======================================================\n");
if (failedCount > 0) process.exit(1);
process.exit(0);
