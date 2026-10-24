/**
 * Business Automation — types & constants (Phase 9).
 *
 * Minimal, purpose-specific automation (NOT a generic workflow engine). Every
 * rule is a one-shot notification or side-effect triggered by a known domain
 * event. Idempotency is enforced by a composite doc key: `${rule}:${entityId}`
 * within a time window (the scanner re-fires only once per period).
 */

/** Identifier for each implemented automation rule. */
export type AutomationRuleId =
  | "overdue_task_notify_pm"
  | "budget_threshold"
  | "bill_review_needed"
  | "bill_status_changed"
  | "invoice_due_soon"
  | "invoice_overdue"
  | "unit_status_changed"
  | "task_assigned_notify";

/** Result of a fired (or skipped) automation execution. */
export interface AutomationEvent {
  /** Composite idempotency key: `${ruleId}:${entityId}:${period}` */
  id: string;
  ruleId: AutomationRuleId;
  entityId: string;
  /** ISO timestamp when the automation successfully fired. */
  firedAt: string;
  /** Outcome category. */
  outcome: "notified" | "skipped_duplicate" | "skipped_no_recipients" | "error";
  /** Number of notifications created (0 if skipped). */
  notifiedCount: number;
  /** Error message when outcome === "error". */
  errorMessage?: string;
}

/** Period granularity for dedup. Time-based scanners use "day" or "hour". */
export type DedupPeriod = "day" | "hour" | "once";

/** Compute the dedup period token from the current time and period selector. */
export function periodToken(period: DedupPeriod, now = new Date()): string {
  switch (period) {
    case "day":
      return now.toISOString().slice(0, 10); // YYYY-MM-DD
    case "hour":
      return now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
    case "once":
      return "always";
  }
}

/** Build the deterministic Firestore doc id that enforces idempotency. */
export function automationEventId(
  ruleId: AutomationRuleId,
  entityId: string,
  period: DedupPeriod,
  now = new Date()
): string {
  return `${ruleId}:${entityId}:${periodToken(period, now)}`;
}
