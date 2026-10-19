/**
 * Regression tests for Workstream #4 — Authorization & document-approval boundary.
 * Run: npx tsx scripts/test-document-approval-authz.ts
 *
 * The contract/invoice approval gate is enforced in the app layer:
 *   useApproveContractMutation → if (!canApproveDocuments(role) || !userId) throw "Not allowed".
 * Firestore rules additionally restrict WRITES to company members (belongsToCompany) — the
 * cross-tenant enforcement is covered by the rules suite; this file pins the ROLE authz matrix
 * and the approval-state helpers the UI uses to unlock/lock actions. Pure module → no Firebase.
 */

import {
  canApproveDocuments,
  isDocumentApproved,
  isInvoiceActionsUnlocked,
  approvedFields,
  pendingApprovalFields,
} from "../src/lib/permissions/document-approval";

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

// ============================================================================
console.log("\n[1] canApproveDocuments role matrix (unauthorized approval must be denied)");
{
  check("super_admin may approve", canApproveDocuments("super_admin") === true);
  check("admin may approve", canApproveDocuments("admin") === true);
  check("manager may approve", canApproveDocuments("manager") === true);
  // Everything below is a NON-approver; the mutation throws "Not allowed" for these.
  check("member may NOT approve", canApproveDocuments("member" as never) === false);
  check("employee may NOT approve", canApproveDocuments("employee" as never) === false);
  check("viewer may NOT approve", canApproveDocuments("viewer" as never) === false);
  check("undefined role may NOT approve", canApproveDocuments(undefined) === false);
}

// ============================================================================
console.log("\n[2] Approval state transitions (pending → approved); no reject/cancel state exists");
{
  const pending = pendingApprovalFields();
  check("pending() shape: status=pending, no actor", pending.approvalStatus === "pending" && pending.approvedAt === null && pending.approvedBy === null);

  const approved = approvedFields("user_42");
  check("approved() records real actor id", approved.approvedBy === "user_42" && approved.approvalStatus === "approved");
  check("approved() records a real timestamp", typeof approved.approvedAt === "string" && !Number.isNaN(Date.parse(approved.approvedAt)));
  check("the model is binary — there is no 'rejected' approvalStatus", !("rejected" in approved) && !("rejected" in pending));
}

// ============================================================================
console.log("\n[3] isDocumentApproved — legacy docs (missing field) stay usable, pending locks");
{
  check("null doc → not approved", isDocumentApproved(null) === false);
  check("legacy doc (no approvalStatus) → treated approved", isDocumentApproved({}) === true);
  check("pending → not approved", isDocumentApproved({ approvalStatus: "pending" }) === false);
  check("approved → approved", isDocumentApproved({ approvalStatus: "approved" }) === true);
}

// ============================================================================
console.log("\n[4] isInvoiceActionsUnlocked — drafts & unapproved invoices cannot be sent/printed");
{
  check("draft invoice locked", isInvoiceActionsUnlocked({ status: "draft" }) === false);
  check("pending-approval invoice locked", isInvoiceActionsUnlocked({ status: "pending" }) === false);
  check("issued-but-unapproved invoice locked", isInvoiceActionsUnlocked({ status: "sent", approvalStatus: "pending" }) === false);
  check("issued & approved invoice unlocked", isInvoiceActionsUnlocked({ status: "sent", approvalStatus: "approved" }) === true);
  check("legacy issued invoice (no approvalStatus) unlocked", isInvoiceActionsUnlocked({ status: "sent" }) === true);
  check("null invoice locked", isInvoiceActionsUnlocked(null) === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
