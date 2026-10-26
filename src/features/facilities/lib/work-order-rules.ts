/**
 * Facilities Management — pure domain rules (no Firebase, no React).
 *
 * These functions are the ONLY definition of work-order lifecycle legality,
 * cost derivation and preventive-schedule due math. Both the Firestore
 * service (write-time enforcement) and the UI (button enablement) call them,
 * so a transition can never be legal in one layer and illegal in the other.
 * Unit-tested by scripts/test-facilities-workflow.ts.
 */

import type {
  WorkOrderPriority,
  WorkOrderStatus,
} from "../types/facilities.types";

/* -------------------------------------------------------------------------- */
/* Work-order status machine                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Allowed edges. Terminals: completed (money/history frozen) and cancelled.
 * "requested → completed" is intentionally NOT an edge: work must be triaged
 * (assigned) and executed (in_progress) before it can be closed — a record of
 * work that never happened cannot be manufactured by skipping edges.
 */
const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  requested: ["assigned", "cancelled"],
  assigned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionWorkOrder(
  from: WorkOrderStatus,
  to: WorkOrderStatus
): boolean {
  return WORK_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStatuses(from: WorkOrderStatus): readonly WorkOrderStatus[] {
  return WORK_ORDER_TRANSITIONS[from] ?? [];
}

/**
 * The completion edge requires a note describing what was done — audited
 * closures only. Enforced at the service boundary, mirrored in the UI.
 */
export function requiresCompletionNote(to: WorkOrderStatus): boolean {
  return to === "completed";
}

/** Cancellation and completion are financially significant: confirm in UI. */
export function isTerminalStatus(status: WorkOrderStatus): boolean {
  return WORK_ORDER_TRANSITIONS[status]?.length === 0;
}

/* -------------------------------------------------------------------------- */
/* Costs — distinct buckets, derived total, never negative                    */
/* -------------------------------------------------------------------------- */

/** Money is stored in minor-unit-safe decimals rounded to 2 dp (shared convention). */
export function normalizeMoney(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Total is always DERIVED — a stored total could disagree with its buckets. */
export function workOrderTotalCost(partsCost: number, laborCost: number): number {
  return normalizeMoney(normalizeMoney(partsCost) + normalizeMoney(laborCost));
}

/* -------------------------------------------------------------------------- */
/* Dates & overdue                                                            */
/* -------------------------------------------------------------------------- */

/** Local-time YYYY-MM-DD (business day, not UTC — leases/PMs follow local calendars). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isValidIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * A work order is overdue when its due date has strictly passed and it is not
 * terminal. on_hold counts as overdue too — pausing does not buy time.
 */
export function isWorkOrderOverdue(
  dueDate: string | null | undefined,
  status: WorkOrderStatus,
  today: string = todayIso()
): boolean {
  if (!dueDate || !isValidIso(dueDate)) return false;
  if (isTerminalStatus(status)) return false;
  return dueDate < today;
}

/** Shift an ISO date by N days (negative = into the past). Invalid inputs start from today. */
export function addDaysIso(fromIso: string, days: number): string {
  const base = isValidIso(fromIso) ? fromIso : todayIso();
  const d = new Date(`${base}T00:00:00`);
  const offset = Number.isFinite(days) ? Math.round(days) : 0;
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* -------------------------------------------------------------------------- */
/* Preventive-maintenance schedule due state                                 */
/* -------------------------------------------------------------------------- */

export type ScheduleDueState = "overdue" | "due_today" | "due_soon" | "ok";

/**
 * nextDue is derived from the last performed service (falling back to the
 * stored baseline) plus the interval — completing work rolls the schedule.
 */
export function computeNextDue(lastDoneIso: string | null | undefined, intervalDays: number, baselineIso: string): string {
  const from = lastDoneIso && isValidIso(lastDoneIso) ? lastDoneIso : baselineIso;
  return addDaysIso(from, intervalDays);
}

const DUE_SOON_WINDOW_DAYS = 7;

export function scheduleDueState(nextDueDate: string, today: string = todayIso()): ScheduleDueState {
  if (!isValidIso(nextDueDate)) return "ok";
  if (nextDueDate < today) return "overdue";
  if (nextDueDate === today) return "due_today";
  const diffDays = Math.round((Date.parse(`${nextDueDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000);
  return diffDays <= DUE_SOON_WINDOW_DAYS ? "due_soon" : "ok";
}

/** Does an ACTIVE schedule currently warrant raising a work order? */
export function scheduleNeedsWorkOrder(
  schedule: { nextDueDate: string; active: boolean },
  today: string = todayIso()
): boolean {
  if (!schedule.active) return false;
  const state = scheduleDueState(schedule.nextDueDate, today);
  return state === "overdue" || state === "due_today";
}

/* -------------------------------------------------------------------------- */
/* Validation (shared by service writes and forms)                            */
/* -------------------------------------------------------------------------- */

export interface FieldError {
  field: string;
  messageKey: string;
}

const PRIORITIES: readonly WorkOrderPriority[] = ["low", "medium", "high", "urgent"];

export function validateWorkOrderDraft(draft: {
  title: string;
  priority: WorkOrderPriority;
  dueDate?: string | null;
  partsCost?: number | null;
  laborCost?: number | null;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.title || draft.title.trim().length < 3) errors.push({ field: "title", messageKey: "validation.titleMin" });
  if (!PRIORITIES.includes(draft.priority)) errors.push({ field: "priority", messageKey: "validation.priority" });
  if (draft.dueDate && !isValidIso(draft.dueDate)) errors.push({ field: "dueDate", messageKey: "validation.dateIso" });
  if (draft.partsCost != null && normalizeMoney(draft.partsCost) !== draft.partsCost)
    errors.push({ field: "partsCost", messageKey: "validation.money" });
  if (draft.laborCost != null && normalizeMoney(draft.laborCost) !== draft.laborCost)
    errors.push({ field: "laborCost", messageKey: "validation.money" });
  return errors;
}

export function validateFacilityDraft(draft: { name: string; area?: number | null }): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.name || draft.name.trim().length < 2) errors.push({ field: "name", messageKey: "validation.nameMin" });
  if (draft.area != null && (!Number.isFinite(draft.area) || draft.area < 0))
    errors.push({ field: "area", messageKey: "validation.area" });
  return errors;
}

export function validateAssetDraft(draft: { tag: string; name: string }): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.tag || draft.tag.trim().length < 1) errors.push({ field: "tag", messageKey: "validation.tagRequired" });
  if (!draft.name || draft.name.trim().length < 2) errors.push({ field: "name", messageKey: "validation.nameMin" });
  return errors;
}

export function validateScheduleDraft(draft: { title: string; intervalDays: number }): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.title || draft.title.trim().length < 2) errors.push({ field: "title", messageKey: "validation.nameMin" });
  if (!Number.isInteger(draft.intervalDays) || draft.intervalDays < 1 || draft.intervalDays > 3650)
    errors.push({ field: "intervalDays", messageKey: "validation.intervalRange" });
  return errors;
}

export function validateVendorDraft(draft: { name: string; email?: string | null }): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.name || draft.name.trim().length < 2) errors.push({ field: "name", messageKey: "validation.nameMin" });
  if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email))
    errors.push({ field: "email", messageKey: "validation.email" });
  return errors;
}
