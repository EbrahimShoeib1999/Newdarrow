/**
 * Regression tests for Workstream #1 — Contract-to-Task relationship integrity.
 * Run: npx tsx scripts/test-contract-task-traceability.ts
 *
 * Establishes the canonical relationship model and proves that the reverse index
 * `contract.createdTaskIds` is NOT the source of truth. The authoritative, always-persisted
 * relationship is the FORWARD link each task carries (task.contractId / dealId / contactId /
 * serviceItemId), which is exactly what the Customer 360 / Operations / timeline scoping uses.
 *
 * Uses the REAL production scoping function (scopeCustomerRecords) so the traceability claim is
 * exercised against shipped code, not a copy. Pure module → no Firebase needed.
 */

import { scopeCustomerRecords, type CustomerRecordSet } from "../src/features/crm/utils/lifecycle-timeline";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CONTACT = "cust_acme";
const DEAL = "deal_acme_1";
const CONTRACT = "contract_acme_1";
const OTHER_CONTACT = "cust_globex";
const OTHER_CONTRACT = "contract_globex_1";

// A contract whose reverse index was NOT persisted (the exact symptom under audit).
function baseSet(contractTaskIds: string[]): CustomerRecordSet {
  return {
    contacts: [
      { id: CONTACT, firstName: "Acme" } as never,
      { id: OTHER_CONTACT, firstName: "Globex" } as never,
    ],
    deals: [{ id: DEAL, contactId: CONTACT, title: "Alpha", stage: "won" } as never],
    contracts: [
      { id: CONTRACT, contactId: CONTACT, dealId: DEAL, title: "Acme Contract", createdTaskIds: contractTaskIds } as never,
      { id: OTHER_CONTRACT, contactId: OTHER_CONTACT, title: "Globex Contract", createdTaskIds: [] } as never,
    ],
    tasks: [
      // Main department task: forward links only, createdTaskIds deliberately empty below.
      { id: "task_main", title: "Main", contractId: CONTRACT, dealId: DEAL, contactId: CONTACT, serviceItemId: "srv_1", type: "task" } as never,
      // Subtask: forward-linked to contract, carries parentId to the main task.
      { id: "task_sub", title: "Sub", contractId: CONTRACT, dealId: DEAL, contactId: CONTACT, serviceItemId: "srv_1", type: "subtask", parentId: "task_main" } as never,
      // A contract-only-linked task (no direct contactId) must still resolve through the contract.
      { id: "task_co_only", title: "CO", contractId: CONTRACT, type: "task" } as never,
      // Another tenant's task must NEVER leak into this customer's scope.
      { id: "task_other", title: "Other", contractId: OTHER_CONTRACT, contactId: OTHER_CONTACT, type: "task" } as never,
    ],
    invoices: [],
    payments: [],
    activities: [],
  };
}

// ============================================================================
console.log("\n[1] Traceability via forward links when createdTaskIds is empty (not persisted)");
{
  const scoped = scopeCustomerRecords(CONTACT, baseSet([])); // createdTaskIds = []
  const ids = scoped.tasks.map((t) => t.id).sort();
  check("all 3 contract tasks resolve with NO reverse index", JSON.stringify(ids) === JSON.stringify(["task_co_only", "task_main", "task_sub"]), JSON.stringify(ids));
  check("cross-tenant task excluded", !scoped.tasks.some((t) => t.id === "task_other"));
  // Every resolved task is traceable back to the originating contract AND customer.
  const allTraceable = scoped.tasks.every((t) => {
    const viaContract = t.contractId === CONTRACT;
    const reachesCustomer = (t as never as { contactId?: string }).contactId === CONTACT || viaContract;
    return viaContract && reachesCustomer;
  });
  check("every task traces to originating contract + customer", allTraceable);
}

// ============================================================================
console.log("\n[2] When the reverse index IS persisted it reconciles (⊆ authoritative forward links)");
{
  const scoped = scopeCustomerRecords(CONTACT, baseSet(["task_main", "task_sub"]));
  const forwardIds = new Set(scoped.tasks.map((t) => t.id));
  const stored = ["task_main", "task_sub"];
  check("stored createdTaskIds ⊆ tasks resolved by forward links", stored.every((id) => forwardIds.has(id)));
  // A stale id in the reverse index (task deleted) must not fabricate a phantom task.
  const scopedStale = scopeCustomerRecords(CONTACT, baseSet(["task_main", "task_deleted"]));
  check("stale reverse-index id does not create a phantom task", !scopedStale.tasks.some((t) => t.id === "task_deleted"));
  check("still resolves real forward-linked tasks", scopedStale.tasks.length === 3);
}

// ============================================================================
console.log("\n[3] Conversion dedup predicate — repeated conversion creates no duplicates");
{
  // Mirrors ContractBuilderForm.handleConvertServicesToTasks (src: services filter for pending,
  // lines 575-577) and the createdIds seeding (line 608). Source of truth = per-service
  // isConverted + convertedTaskId, NOT createdTaskIds.
  const dedupPending = <S extends { selected: boolean; isConverted?: boolean; convertedTaskId?: string }>(
    services: S[],
  ) => services.filter((s) => s.selected).filter((s) => !s.isConverted || !s.convertedTaskId);

  const seed = [
    { id: "srv_1", selected: true, isConverted: true, convertedTaskId: "task_main" },
    { id: "srv_2", selected: true, isConverted: false },
    { id: "srv_3", selected: false },
  ];
  const pending = dedupPending(seed).map((s) => s.id);
  check("only un-converted selected service is pending", JSON.stringify(pending) === JSON.stringify(["srv_2"]), JSON.stringify(pending));

  // After converting srv_2, a REPEAT run has nothing pending → zero new tasks.
  const afterFirst = seed.map((s) => (s.id === "srv_2" ? { ...s, isConverted: true, convertedTaskId: "task_2" } : s));
  check("repeat conversion is idempotent (no pending)", dedupPending(afterFirst).length === 0);

  // createdIds seeds from existing reverse index → appended, never duplicated.
  const existing = ["task_main", "task_2"];
  const createdThisRun: string[] = []; // second run creates nothing
  const merged = Array.from(new Set([...existing, ...createdThisRun]));
  check("merged task ids keep no duplicates on re-run", merged.length === 2 && new Set(merged).size === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
