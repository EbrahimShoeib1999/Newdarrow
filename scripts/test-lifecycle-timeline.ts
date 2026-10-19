/**
 * Regression tests for the unified customer lifecycle timeline.
 * Run: npx tsx scripts/test-lifecycle-timeline.ts
 *
 * The timeline builder/scoper is a pure module (type-only imports), so this runs
 * without Firebase/emulators. It exercises: relationship resolution by canonical
 * IDs, chronological ordering, duplicate prevention on retries, handling of
 * missing/deleted related records, and the no-fabrication guarantees.
 */

import {
  scopeCustomerRecords,
  buildCustomerTimeline,
  toIso,
  type CustomerRecordSet,
} from "../src/features/crm/utils/lifecycle-timeline";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

const CONTACT = "cust_1";
const OTHER = "cust_other";

// ---- fixtures (fictional) ----
const set: CustomerRecordSet = {
  contacts: [
    { id: CONTACT, createdAt: "2026-01-01T00:00:00.000Z", createdBy: "u1", firstName: "A" } as never,
    { id: OTHER, createdAt: "2026-01-01T00:00:00.000Z", firstName: "B" } as never,
  ],
  deals: [
    { id: "deal_1", contactId: CONTACT, title: "Alpha Deal", createdAt: "2026-01-05T00:00:00.000Z", stage: "won", createdBy: "u1" } as never,
    // current stage but NO retained transition -> must NOT fabricate a stage event
    { id: "deal_2", contactId: CONTACT, title: "Beta Deal", createdAt: "2026-01-06T00:00:00.000Z", stage: "negotiation" } as never,
    { id: "deal_x", contactId: OTHER, title: "Unrelated", createdAt: "2026-01-06T00:00:00.000Z", stage: "won" } as never,
  ],
  contracts: [
    { id: "con_1", contactId: CONTACT, title: "Alpha Contract", createdAt: "2026-01-10T00:00:00.000Z", createdBy: "u1", approvalStatus: "approved", approvedAt: "2026-01-12T00:00:00.000Z", approvedBy: "u2" } as never,
    // approved status but NO approvedAt -> must NOT emit approval event
    { id: "con_2", contactId: CONTACT, title: "Draft Contract", createdAt: "2026-01-11T00:00:00.000Z", approvalStatus: "pending", approvedAt: null } as never,
  ],
  tasks: [
    { id: "task_1", title: "T1", contactId: CONTACT, createdAt: "2026-01-15T00:00:00.000Z", claimedAt: "2026-01-16T00:00:00.000Z", claimedBy: "u3", completedAt: "2026-01-20T00:00:00.000Z", history: [
      { id: "h1", action: "updated", field: "status", oldValue: "todo", newValue: "in_progress", userId: "u3", timestamp: "2026-01-16T01:00:00.000Z" },
      // duplicate listener run -> same ts/field/value, must dedup
      { id: "h2", action: "updated", field: "status", oldValue: "todo", newValue: "in_progress", userId: "u3", timestamp: "2026-01-16T01:00:00.000Z" },
    ] } as never,
    // task linked only through the contract -> still belongs to the customer
    { id: "task_2", title: "T2", contractId: "con_1", createdAt: "2026-01-17T00:00:00.000Z" } as never,
    { id: "task_other", title: "TX", contractId: "con_nope", dealId: "deal_x", createdAt: "2026-01-17T00:00:00.000Z" } as never,
  ],
  invoices: [
    { id: "inv_1", customerId: CONTACT, invoiceNumber: "INV-1", grandTotal: 1000, issueDate: new Date("2026-02-01T00:00:00.000Z"), postedAt: new Date("2026-02-02T00:00:00.000Z"), approvalStatus: "approved", approvedAt: new Date("2026-02-03T00:00:00.000Z"), approvedBy: "u2" } as never,
    { id: "inv_other", customerId: OTHER, invoiceNumber: "INV-X", grandTotal: 5, issueDate: new Date("2026-02-01T00:00:00.000Z") } as never,
  ],
  payments: [
    { id: "pay_1", invoiceId: "inv_1", amount: 400, date: new Date("2026-02-10T00:00:00.000Z") } as never,
    { id: "pay_2", invoiceId: "inv_1", amount: 300, date: new Date("2026-02-15T00:00:00.000Z") } as never,
    // orphan payment: parent invoice missing/deleted -> dropped
    { id: "pay_orphan", invoiceId: "inv_deleted", amount: 999, date: new Date("2026-02-20T00:00:00.000Z") } as never,
  ],
  activities: [
    { id: "act_1", entityType: "deal", entityId: "deal_1", subject: "Deal stage changed", description: "negotiation → won", occurredAt: "2026-01-08T00:00:00.000Z", userId: "u1", type: "note" } as never,
    // exact duplicate (retry) -> collapse
    { id: "act_1b", entityType: "deal", entityId: "deal_1", subject: "Deal stage changed", description: "negotiation → won", occurredAt: "2026-01-08T00:00:00.000Z", userId: "u1", type: "note" } as never,
    { id: "act_note", entityType: "contact", entityId: CONTACT, subject: "Contact created", occurredAt: "2026-01-01T00:00:01.000Z", userId: "u1", type: "note" } as never,
    { id: "act_other", entityType: "contact", entityId: OTHER, subject: "Unrelated note", occurredAt: "2026-01-01T00:00:01.000Z", userId: "u1", type: "note" } as never,
  ],
};

const scoped = scopeCustomerRecords(CONTACT, set);
const events = buildCustomerTimeline(scoped);

console.log("\n[1] Relationship resolution (canonical IDs)");
check("contact scoped", scoped.contact?.id === CONTACT);
check("only customer's 2 deals", scoped.deals.length === 2 && !scoped.deals.some((d) => d.id === "deal_x"));
check("only customer's 2 contracts", scoped.contracts.length === 2);
check("task via contract included, unrelated excluded", scoped.tasks.some((t) => t.id === "task_2") && !scoped.tasks.some((t) => t.id === "task_other"));
check("only customer's invoice", scoped.invoices.length === 1 && scoped.invoices[0].id === "inv_1");
check("orphan payment dropped", scoped.payments.length === 2 && !scoped.payments.some((p) => p.id === "pay_orphan"));
check("unrelated activity dropped", !scoped.activities.some((a) => a.id === "act_other"));

console.log("\n[2] Event emission");
const kinds = events.map((e) => `${e.category}:${e.kind}`);
check("customer_created emitted", kinds.includes("customer:created"));
check("both deals created", events.filter((e) => e.category === "deal" && e.kind === "created").length === 2);
check("contract_approved emitted only for approvedAt-backed contract", events.filter((e) => e.category === "contract" && e.kind === "approved").length === 1);
check("no fabricated stage event for deal_2 (no activity)", !events.some((e) => e.entityId === "deal_2" && e.kind === "stage_changed"));
check("real deal stage change from activity", events.some((e) => e.entityId === "deal_1" && e.kind === "stage_changed"));
check("task completed + claimed emitted", events.some((e) => e.entityId === "task_1" && e.kind === "completed") && events.some((e) => e.entityId === "task_1" && e.kind === "claimed"));
check("invoice issued used postedAt (2026-02-02)", events.some((e) => e.entityId === "inv_1" && e.kind === "issued" && e.timestamp === "2026-02-02T00:00:00.000Z"));
check("2 payments recorded", events.filter((e) => e.category === "payment").length === 2);

console.log("\n[3] Duplicate prevention");
check("duplicate deal-stage activity collapsed", events.filter((e) => e.entityId === "deal_1" && e.kind === "stage_changed").length === 1);
check("duplicate task status history collapsed", events.filter((e) => e.entityId === "task_1" && e.kind === "status_changed").length === 1);
check("all event ids unique", new Set(events.map((e) => e.id)).size === events.length);

console.log("\n[4] Chronological ordering (newest first)");
let ordered = true;
for (let i = 1; i < events.length; i++) {
  if (new Date(events[i - 1].timestamp).getTime() < new Date(events[i].timestamp).getTime()) ordered = false;
}
check("strictly non-increasing timestamps", ordered);

console.log("\n[5] Timestamp normalization + invalid handling");
check("Date -> ISO", toIso(new Date("2026-02-02T00:00:00.000Z")) === "2026-02-02T00:00:00.000Z");
check("invalid string -> null", toIso("not-a-date") === null);
check("null -> null", toIso(null) === null);
check("no event has empty timestamp", events.every((e) => !!e.timestamp));

console.log("\n[6] Navigation routes present");
check("payment routes to invoice", events.filter((e) => e.category === "payment").every((e) => e.route === "/billing/invoices/inv_1"));
check("invoice routes to its detail page", events.filter((e) => e.category === "invoice").every((e) => e.route === "/billing/invoices/inv_1"));
check("contract events deep-link to the specific contract", events.filter((e) => e.category === "contract").every((e) => e.route === "/crm/contracts?contractId=con_1" || e.route === "/crm/contracts?contractId=con_2"));
check("task events route to task detail", events.filter((e) => e.entityType === "task").every((e) => e.route === `/tasks/${e.entityId}`));
check("deal events route to deal detail", events.filter((e) => e.entityType === "deal" && e.kind === "created").every((e) => e.route === `/crm/deals/${e.entityId}`));

console.log(`\n Timeline regression: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
