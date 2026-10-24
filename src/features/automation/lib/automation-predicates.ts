/**
 * Pure automation predicates (Phase 9B).
 *
 * Each function takes domain entities and returns an array of notification
 * payloads. No Firebase or side-effects — fully unit-testable. The scanner
 * hook calls these and pipes the result into the idempotent fireOnce service.
 */

import type { Task } from "@/features/tasks/types/task.types";
import type { Bill } from "@/features/billing/schemas/bill";
import type { Invoice } from "@/features/billing/schemas/invoice";
import type { ProjectUnit } from "@/features/projects/types/unit.types";
import type { UserRole } from "@/features/auth/types/auth.types";

/* ---------- shared lightweight descriptor for a notification payload ---------- */

export interface NotifPayload {
  userId: string;
  title: string;
  message: string;
  link?: string;
}

/* -------------------------------------------------------------------------- */
/* 1. Overdue tasks (B2)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns notifications for project-managers (role manager|admin) when a task's
 * dueDate is past and status is NOT done. Dedup handled by the scanner.
 */
export function overdueTaskAlerts(
  tasks: Task[],
  managers: Array<{ id: string; role: UserRole | string }>,
  now = new Date()
): Array<{ entityId: string; notifications: NotifPayload[] }> {
  if (managers.length === 0) return [];
  const results: Array<{ entityId: string; notifications: NotifPayload[] }> = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (!t.dueDate) continue;
    const due = new Date(t.dueDate);
    if (isNaN(due.getTime())) continue; // unparseable date → skip
    if (due >= now) continue; // still in the future
    results.push({
      entityId: t.id,
      notifications: managers.map((m) => ({
        userId: m.id,
        title: "Overdue task",
        message: `"${t.title}" was due on ${due.toLocaleDateString()} and is still open.`,
        link: `/tasks/${t.id}`,
      })),
    });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* 2. Budget threshold (B3)                                                   */
/* -------------------------------------------------------------------------- */

export interface BudgetInput {
  projectId: string;
  /** Total approved cost so far (from computeProjectFinancials). */
  totalApproved: number;
  /** Contract value (the budget ceiling). 0 or null means no budget set. */
  contractValue: number | null;
  currency: string;
}

/**
 * Returns an alert if approved costs exceed 80% (warning) or 100% (breach) of
 * the contract value. Skipped when no budget is set.
 */
export function budgetThresholdAlert(
  input: BudgetInput,
  authorizedUsers: Array<{ id: string }>
): { entityId: string; notifications: NotifPayload[] } | null {
  if (!input.contractValue || input.contractValue <= 0) return null;
  const ratio = input.totalApproved / input.contractValue;
  if (ratio < 0.8) return null;
  const level = ratio >= 1 ? "BUDGET EXCEEDED" : "Budget warning (>80%)";
  const pct = Math.round(ratio * 100);
  return {
    entityId: input.projectId,
    notifications: authorizedUsers.map((u) => ({
      userId: u.id,
      title: level,
      message: `Project has consumed ${pct}% of its budget (${input.currency}).`,
      link: `/projects/${input.projectId}`,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Bill review needed (B4)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * When a bill is created with approvalStatus=pending, notify accountants.
 * This is a synchronous event (on creation) so only checks that it's pending.
 */
export function billReviewNeededAlert(
  bill: Bill,
  accountants: Array<{ id: string }>
): { entityId: string; notifications: NotifPayload[] } | null {
  if (bill.approvalStatus !== "pending" && bill.approvalStatus !== undefined) {
    // undefined is also treated as pending (legacy), but explicit non-pending skips
    if (bill.approvalStatus !== undefined) return null;
  }
  if (accountants.length === 0) return null;
  return {
    entityId: bill.id ?? bill.billNumber,
    notifications: accountants.map((a) => ({
      userId: a.id,
      title: "Bill needs review",
      message: `Bill "${bill.vendorName ?? bill.billNumber}" (${bill.currency} ${bill.grandTotal}) awaits your approval.`,
      link: "/billing",
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Bill status changed (B5)                                                */
/* -------------------------------------------------------------------------- */

/**
 * When approvalStatus transitions to approved/rejected, notify the bill creator
 * (approximated by the project owner / assigned users).
 * For paid: notify project owner.
 */
export function billStatusChangedAlert(
  bill: Bill,
  previousApproval: string | undefined,
  recipients: Array<{ id: string }>
): { entityId: string; notifications: NotifPayload[] } | null {
  const current = bill.approvalStatus ?? "pending";
  if (current === previousApproval) return null;
  if (current === "pending") return null; // creation event handled separately
  if (recipients.length === 0) return null;
  const label = current === "approved" ? "approved" : current === "rejected" ? "rejected" : "changed";
  return {
    entityId: bill.id ?? bill.billNumber,
    notifications: recipients.map((r) => ({
      userId: r.id,
      title: `Bill ${label}`,
      message: `Bill "${bill.vendorName ?? bill.billNumber}" was ${label}.`,
      link: "/billing",
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* 5. Invoice approaching due / overdue (B6/B7)                               */
/* -------------------------------------------------------------------------- */

export function invoiceDueAlerts(
  invoices: Invoice[],
  recipients: Array<{ id: string }>,
  options?: {
    /** Days before due date to warn. Default 3. */
    warnWindow?: number;
    now?: Date;
  }
): Array<{ entityId: string; ruleId: "invoice_due_soon" | "invoice_overdue"; notifications: NotifPayload[] }> {
  const now = options?.now ?? new Date();
  const warnDays = options?.warnWindow ?? 3;
  if (recipients.length === 0) return [];

  const alerts: Array<{ entityId: string; ruleId: "invoice_due_soon" | "invoice_overdue"; notifications: NotifPayload[] }> = [];
  for (const inv of invoices) {
    // Only active invoices count
    if (inv.status !== "pending" && inv.status !== "sent" && inv.status !== "overdue") continue;
    if (!inv.dueDate) continue;
    const due = inv.dueDate instanceof Date ? inv.dueDate : new Date(inv.dueDate);
    if (isNaN(due.getTime())) continue;

    const diffMs = due.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 0) {
      // OVERDUE
      alerts.push({
        entityId: inv.id ?? inv.invoiceNumber,
        ruleId: "invoice_overdue",
        notifications: recipients.map((r) => ({
          userId: r.id,
          title: "Invoice overdue",
          message: `Invoice ${inv.invoiceNumber} is overdue since ${due.toLocaleDateString()}.`,
          link: "/billing",
        })),
      });
    } else if (diffDays <= warnDays) {
      // APPROACHING DUE
      alerts.push({
        entityId: inv.id ?? inv.invoiceNumber,
        ruleId: "invoice_due_soon",
        notifications: recipients.map((r) => ({
          userId: r.id,
          title: "Invoice due soon",
          message: `Invoice ${inv.invoiceNumber} is due in ${Math.ceil(diffDays)} day(s).`,
          link: "/billing",
        })),
      });
    }
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/* 6. Unit status changed notification (B12)                                   */
/* -------------------------------------------------------------------------- */

export function unitStatusChangedAlert(
  unit: ProjectUnit,
  from: string,
  to: string,
  recipients: Array<{ id: string }>
): { entityId: string; notifications: NotifPayload[] } | null {
  if (recipients.length === 0) return null;
  if (from === to) return null;
  return {
    entityId: unit.id,
    notifications: recipients.map((r) => ({
      userId: r.id,
      title: `Unit ${unit.code} → ${to}`,
      message: `Unit "${unit.code}" (${unit.unitType}) changed from ${from} to ${to}.`,
      link: `/projects/${unit.projectId}`,
    })),
  };
}
