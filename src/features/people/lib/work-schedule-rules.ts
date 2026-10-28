/**
 * Work-schedule & lateness domain rules — PURE (no Firebase, no React).
 *
 * Everything that decides "was this check-in late, how much counts, which
 * threshold fired, what may be deducted" lives HERE so the service, the UI
 * and the tests can never disagree. Money follows the repo convention:
 * 2-dp rounding, currency preserved per record, no cross-currency math.
 *
 * Deliberate non-goals (spec-driven):
 * - missing attendance is NEVER counted as lateness;
 * - daily delays are NEVER rounded up to hours;
 * - "three days" has no meaning until the policy states the wage basis.
 */

import type {
  DeductionCaseStatus,
  LatenessPolicy,
  LatenessThreshold,
  ScheduleAssignment,
  ScheduleValues,
} from "../types/work-schedule.types";
import { DEDUCTION_CASE_TRANSITIONS } from "../types/work-schedule.types";

/* -------------------------------------------------------------------------- */
/* Time primitives                                                             */
/* -------------------------------------------------------------------------- */

export function parseHHmm(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export function formatDurationHM(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface ZonedMoment {
  /** "YYYY-MM-DD" in the schedule's zone. */
  dayKey: string;
  /** Minutes since local midnight in the schedule's zone. */
  minutes: number;
  /** JS getDay() convention in the schedule's zone. */
  weekday: number;
}

/**
 * Calendar facts of an instant AS SEEN IN a zone (browser-independent).
 * Falls back to the runtime zone when the IANA id is invalid/unsupported.
 */
export function zonedMoment(epochMs: number, timezone: string): ZonedMoment {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
      })
        .formatToParts(new Date(epochMs))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );
  } catch {
    const d = new Date(epochMs);
    parts = {
      year: String(d.getFullYear()),
      month: String(d.getMonth() + 1).padStart(2, "0"),
      day: String(d.getDate()).padStart(2, "0"),
      hour: String(d.getHours()).padStart(2, "0"),
      minute: String(d.getMinutes()).padStart(2, "0"),
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()],
    };
  }
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Schedule values                                                             */
/* -------------------------------------------------------------------------- */

export function scheduleDurationMinutes(v: ScheduleValues): number {
  const start = parseHHmm(v.startTime);
  const end = parseHHmm(v.endTime);
  if (start == null || end == null) return 0;
  return Math.max(0, end - start);
}

/** Productive scheduled minutes: duration minus an unpaid break. */
export function scheduledWorkMinutes(v: ScheduleValues): number {
  const dur = scheduleDurationMinutes(v);
  const brk = Math.max(0, Math.round(v.breakMinutes || 0));
  return Math.max(0, v.breakCountsAsWork ? dur : dur - brk);
}

export function requiredDailyMinutes(v: ScheduleValues): number {
  return v.requiredDailyMinutes != null && v.requiredDailyMinutes > 0
    ? v.requiredDailyMinutes
    : scheduledWorkMinutes(v);
}

export function isWorkingDay(v: ScheduleValues, weekday: number): boolean {
  return (v.workingDays ?? []).includes(weekday);
}

/** Merge an assignment's frozen snapshot with its per-employee overrides. */
export function effectiveValuesOf(assignment: ScheduleAssignment): ScheduleValues {
  return { ...assignment.snapshot, ...(assignment.overrides ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Overtime (only when the schedule enables it)                                */
/* -------------------------------------------------------------------------- */

/** Worked minutes past the required daily minutes; 0 unless overtime is on. */
export function overtimeMinutes(v: ScheduleValues, workedMinutes: number): number {
  if (!v.overtime?.enabled) return 0;
  const after = Math.max(0, v.overtime.afterWorkMinutes || requiredDailyMinutes(v));
  return workedMinutes > after ? Math.round(workedMinutes - after) : 0;
}

/* -------------------------------------------------------------------------- */
/* Lateness (punctuality)                                                      */
/* -------------------------------------------------------------------------- */

export interface PunctualityResult {
  scheduledStart: string;
  timezone: string;
  graceMinutes: number;
  rawLateMinutes: number;
  /** The check-in's zoned day did not match the punch's attendance date. */
  crossDayCheckIn: boolean;
}

/**
 * Lateness of a check-in against the EFFECTIVE schedule for the date:
 * arrival minutes (in the schedule's zone) past the start anchor, where the
 * anchor is the end of the flexible window when configured, plus grace.
 * A check-in BEFORE the anchor is simply on time (never negative, never
 * rounded up). A check-in whose zoned day differs from the punch day is
 * flagged and contributes 0 — the punch date is the attendance row's own
 * `date`, and inventing a lateness for an ambiguous midnight case would be
 * fabricating data.
 */
export function punctualityForCheckIn(
  values: ScheduleValues,
  checkIn: Date,
  punchDayKey: string
): PunctualityResult {
  const startMin = parseHHmm(values.startTime) ?? 0;
  const zone = values.timezone || "UTC";
  const anchor =
    values.flexibleStartWindow != null
      ? Math.max(startMin, parseHHmm(values.flexibleStartWindow[1]) ?? startMin)
      : startMin;
  const inZone = zonedMoment(checkIn.getTime(), zone);
  const crossDay = inZone.dayKey !== punchDayKey;
  const raw =
    crossDay || inZone.minutes <= anchor + Math.max(0, values.graceMinutes || 0)
      ? 0
      : Math.round(inZone.minutes - anchor - Math.max(0, values.graceMinutes || 0));
  return {
    scheduledStart: values.startTime,
    timezone: zone,
    graceMinutes: Math.max(0, values.graceMinutes || 0),
    rawLateMinutes: Math.max(0, raw),
    crossDayCheckIn: crossDay,
  };
}

/**
 * Countable lateness of a punch after the excusing rules:
 * approved leave/permission covering the date excuses the whole day's delay.
 */
export function countableLateMinutes(
  rawLateMinutes: number,
  excused: boolean
): number {
  return excused ? 0 : Math.max(0, Math.round(rawLateMinutes));
}

/* -------------------------------------------------------------------------- */
/* Assignment resolution & conflicts                                           */
/* -------------------------------------------------------------------------- */

function inEffectiveRange(a: ScheduleAssignment, dateIso: string): boolean {
  if (a.effectiveFrom && dateIso < a.effectiveFrom) return false;
  if (a.effectiveTo && dateIso > a.effectiveTo) return false;
  return true;
}

/**
 * Deterministic precedence: a valid EMPLOYEE assignment always beats a group
 * assignment; within one scope the latest effectiveFrom that covers the date
 * wins (ties broken by creation date, then id — never random).
 */
export function resolveAssignmentFor(
  assignments: ScheduleAssignment[],
  employeeId: string,
  department: string | undefined,
  dateIso: string
): ScheduleAssignment | null {
  const covering = assignments.filter(
    (a) => a.status === "active" && inEffectiveRange(a, dateIso)
  );
  const own = covering
    .filter((a) => a.scope === "employee" && a.employeeId === employeeId)
    .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom) || y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id));
  if (own.length > 0) return own[0];
  const group = covering
    .filter((a) => a.scope === "group" && !!department && a.department === department)
    .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom) || y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id));
  return group[0] ?? null;
}

/**
 * A NEW employee-scoped assignment may not overlap an existing ACTIVE
 * employee-scoped assignment (one calendar per person). Group assignments
 * may coexist — employee scope simply wins.
 */
export function findAssignmentConflict(
  candidate: { id?: string; scope: string; employeeId?: string | null; department?: string | null; effectiveFrom: string; effectiveTo?: string | null },
  existing: ScheduleAssignment[]
): ScheduleAssignment | null {
  if (candidate.scope !== "employee" || !candidate.employeeId) return null;
  const cEnd = candidate.effectiveTo ?? "9999-12-31";
  for (const a of existing) {
    if (a.id === candidate.id) continue;
    if (a.status !== "active" || a.scope !== "employee" || a.employeeId !== candidate.employeeId) continue;
    const aEnd = a.effectiveTo ?? "9999-12-31";
    if (candidate.effectiveFrom <= aEnd && a.effectiveFrom <= cEnd) return a;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Monthly lateness accumulation                                               */
/* -------------------------------------------------------------------------- */

interface AttendanceLike {
  id: string;
  date: string;
  status: string;
  lateMinutes?: number;
  schedule?: { rawLateMinutes: number; excusedLateMinutes: number; countableLateMinutes: number } | null;
}

/**
 * Countable minutes a punch contributes to its month. Schedule-resolved rows
 * carry their own frozen numbers; legacy rows (no snapshot) contribute their
 * stored `lateMinutes` verbatim — the OLD company-cutoff basis, flagged as
 * legacy below. Cancelled/absent rows contribute nothing, and MISSING days
 * are never invented.
 */
export function punchCountableMinutes(a: AttendanceLike): number {
  if (a.status === "cancelled") return 0;
  if (a.schedule) return Math.max(0, a.schedule.countableLateMinutes || 0);
  return Math.max(0, Math.round(a.lateMinutes || 0));
}

export interface MonthlyAccumulation {
  periodKey: string;
  employeeId: string;
  totalMinutes: number;
  /** Minutes contributed by legacy (company-cutoff) rows, for labeling. */
  legacyMinutes: number;
  /** Minutes excused via approvals, kept for the breakdown display. */
  excusedMinutes: number;
  /** Attendance doc ids sorted by date — the traceable contributing events. */
  contributingIds: string[];
  /** Per-day countable minutes for the breakdown table. */
  days: { date: string; minutes: number; legacy: boolean }[];
}

/**
 * The monthly total is DERIVED from eligible attendance rows every time —
 * there is no editable total anywhere in the system.
 */
export function accumulateMonth(
  attendance: AttendanceLike[],
  employeeId: string,
  periodKey: string // "YYYY-MM"
): MonthlyAccumulation {
  const rows = attendance
    .filter((a) => typeof a.date === "string" && a.date.startsWith(periodKey))
    .sort((x, y) => x.date.localeCompare(y.date));
  let total = 0;
  let legacy = 0;
  let excused = 0;
  const days: MonthlyAccumulation["days"] = [];
  const ids: string[] = [];
  for (const r of rows) {
    const mins = punchCountableMinutes(r);
    if (r.schedule) excused += Math.max(0, r.schedule.excusedLateMinutes || 0);
    if (mins > 0) {
      total += mins;
      if (!r.schedule) legacy += mins;
      ids.push(r.id);
    }
    days.push({ date: r.date, minutes: mins, legacy: !r.schedule });
  }
  return {
    periodKey,
    employeeId,
    totalMinutes: Math.round(total),
    legacyMinutes: Math.round(legacy),
    excusedMinutes: Math.round(excused),
    contributingIds: ids,
    days,
  };
}

/* -------------------------------------------------------------------------- */
/* Threshold evaluation                                                        */
/* -------------------------------------------------------------------------- */

export function canTransitionDeductionCase(
  from: DeductionCaseStatus,
  to: DeductionCaseStatus
): boolean {
  return DEDUCTION_CASE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Which thresholds the accumulated minutes reach, honoring the mode:
 *  - cumulative: every threshold at or below the total is reached;
 *  - stepped: only the highest reached one;
 *  - reset_after_action: the total is measured AFTER the most recent fired
 *    threshold (the caller subtracts nothing; we rebase here using the
 *    already-fired list).
 */
export function reachedThresholds(
  totalMinutes: number,
  policy: Pick<LatenessPolicy, "thresholds" | "thresholdMode">,
  firedThresholdMinutes: number[] = []
): LatenessThreshold[] {
  const sorted = [...policy.thresholds].sort((a, b) => a.afterMinutes - b.afterMinutes);
  let effectiveTotal = totalMinutes;
  if (policy.thresholdMode === "reset_after_action" && firedThresholdMinutes.length > 0) {
    const lastFired = Math.max(...firedThresholdMinutes);
    effectiveTotal = Math.max(0, totalMinutes - lastFired);
  }
  const reached = sorted.filter((t) => t.afterMinutes > 0 && effectiveTotal >= t.afterMinutes);
  if (policy.thresholdMode === "stepped") return reached.slice(-1);
  return reached;
}

/**
 * Day-wage translation — every basis must be EXPLICITLY configured; there is
 * no default reading of "three days".
 */
export function dailyWageRate(
  monthlyGross: number,
  basis: "calendar_30" | "working_days",
  workingDaysPerMonth: number
): number {
  const denom = basis === "calendar_30" ? 30 : Math.max(1, workingDaysPerMonth);
  return round2(monthlyGross / denom);
}

export interface DeductionAmountInput {
  monthlyGross: number;
  action: LatenessThreshold["action"];
  workingDaysPerMonth: number;
  /** Already approved/posted amounts this period (caps apply per employee). */
  alreadyCommitted: number;
  maxMonthlyDeductionAmount: number;
  maxMonthlyDeductionGrossFraction: number;
}

export interface DeductionAmountResult {
  days: number | null;
  dailyRate: number | null;
  amount: number;
  capped: boolean;
  /** Set when the configured limits reduced (or fully blocked) the amount. */
  capReason: "monthly_amount" | "gross_fraction" | "no_gross_on_record" | null;
}

/**
 * The proposal amount: policy-defined conversion + configured maximums. A
 * monthly cap that the policy does NOT define means NO cap is applied — the
 * system never invents a statutory limit, it only enforces what was set.
 * An employee without salary on record gets amount 0 + a reason: the review
 * item still exists, the money never gets fabricated.
 */
export function computeDeductionAmount(input: DeductionAmountInput): DeductionAmountResult {
  const { action } = input;
  if (action.kind !== "propose_deduction") {
    return { days: null, dailyRate: null, amount: 0, capped: false, capReason: null };
  }
  if (input.monthlyGross <= 0) {
    return { days: action.deductionDays ?? null, dailyRate: null, amount: 0, capped: false, capReason: "no_gross_on_record" };
  }
  let amount = 0;
  let days: number | null = null;
  let dailyRate: number | null = null;
  if (action.basis === "salary_fraction") {
    const frac = Math.min(1, Math.max(0, action.fraction ?? 0));
    days = null;
    dailyRate = null;
    amount = round2(input.monthlyGross * frac);
  } else {
    days = Math.max(0, action.deductionDays ?? 0);
    dailyRate = dailyWageRate(input.monthlyGross, action.basis ?? "calendar_30", input.workingDaysPerMonth);
    amount = round2(dailyRate * days);
  }
  let capped = false;
  let capReason: DeductionAmountResult["capReason"] = null;
  if (input.maxMonthlyDeductionAmount > 0) {
    const headroom = Math.max(0, round2(input.maxMonthlyDeductionAmount - input.alreadyCommitted));
    if (amount > headroom) {
      amount = headroom;
      capped = true;
      capReason = "monthly_amount";
    }
  }
  if (input.maxMonthlyDeductionGrossFraction > 0) {
    const byGross = round2(input.monthlyGross * Math.min(1, input.maxMonthlyDeductionGrossFraction));
    const headroom = Math.max(0, round2(byGross - input.alreadyCommitted));
    if (amount > headroom) {
      amount = headroom;
      capped = true;
      capReason = "gross_fraction";
    }
  }
  return { days, dailyRate, amount: Math.max(0, amount), capped, capReason };
}

/** Deterministic case id — the same employee+period+threshold can never exist twice. */
export function deductionCaseId(employeeId: string, periodKey: string, thresholdId: string): string {
  return `${employeeId}_${periodKey}_${thresholdId}`;
}

/* -------------------------------------------------------------------------- */
/* Validation (shared by service writes and forms)                             */
/* -------------------------------------------------------------------------- */

export interface FieldError {
  field: string;
  messageKey: string;
}

export function validateScheduleValues(v: Partial<ScheduleValues>): FieldError[] {
  const errors: FieldError[] = [];
  const start = parseHHmm(v.startTime);
  const end = parseHHmm(v.endTime);
  if (start == null) errors.push({ field: "startTime", messageKey: "schedules.validation.time" });
  if (end == null) errors.push({ field: "endTime", messageKey: "schedules.validation.time" });
  if (start != null && end != null && end <= start) {
    errors.push({ field: "endTime", messageKey: "schedules.validation.endAfterStart" });
  }
  if ((v.breakMinutes ?? 0) < 0 || (v.breakMinutes ?? 0) > 8 * 60) {
    errors.push({ field: "breakMinutes", messageKey: "schedules.validation.breakRange" });
  }
  if ((v.graceMinutes ?? 0) < 0 || (v.graceMinutes ?? 0) > 4 * 60) {
    errors.push({ field: "graceMinutes", messageKey: "schedules.validation.graceRange" });
  }
  if (v.flexibleStartWindow && (parseHHmm(v.flexibleStartWindow[0]) == null || parseHHmm(v.flexibleStartWindow[1]) == null)) {
    errors.push({ field: "flexibleStartWindow", messageKey: "schedules.validation.time" });
  }
  if (
    v.workingDays !== undefined &&
    (v.workingDays.length > 7 || v.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
  ) {
    errors.push({ field: "workingDays", messageKey: "schedules.validation.workingDays" });
  }
  if (v.workingDays !== undefined && v.workingDays.length === 0) {
    errors.push({ field: "workingDays", messageKey: "schedules.validation.workingDays" });
  }
  if (v.requiredDailyMinutes != null && (v.requiredDailyMinutes < 0 || v.requiredDailyMinutes > 24 * 60)) {
    errors.push({ field: "requiredDailyMinutes", messageKey: "schedules.validation.requiredDaily" });
  }
  return errors;
}

export function validatePolicyDraft(p: Partial<LatenessPolicy>): FieldError[] {
  const errors: FieldError[] = [];
  if (!p.name || p.name.trim().length < 2) errors.push({ field: "name", messageKey: "policy.validation.name" });
  if (!p.thresholds || p.thresholds.length === 0) {
    errors.push({ field: "thresholds", messageKey: "policy.validation.thresholds" });
  } else {
    p.thresholds.forEach((t, i) => {
      if (!(t.afterMinutes > 0)) errors.push({ field: `thresholds.${i}.afterMinutes`, messageKey: "policy.validation.thresholdMinutes" });
      if (t.action.kind === "propose_deduction") {
        if (t.action.basis === "salary_fraction") {
          const f = t.action.fraction ?? 0;
          if (f <= 0 || f > 1) errors.push({ field: `thresholds.${i}.action.fraction`, messageKey: "policy.validation.fraction" });
        } else {
          if (!(t.action.deductionDays != null && t.action.deductionDays > 0)) {
            errors.push({ field: `thresholds.${i}.action.deductionDays`, messageKey: "policy.validation.days" });
          }
          if (!t.action.basis) errors.push({ field: `thresholds.${i}.action.basis`, messageKey: "policy.validation.basis" });
        }
      }
    });
    const ids = p.thresholds.map((t) => t.id);
    if (new Set(ids).size !== ids.length) errors.push({ field: "thresholds", messageKey: "policy.validation.duplicateId" });
  }
  if ((p.maxMonthlyDeductionGrossFraction ?? 0) < 0 || (p.maxMonthlyDeductionGrossFraction ?? 0) > 1) {
    errors.push({ field: "maxMonthlyDeductionGrossFraction", messageKey: "policy.validation.fraction" });
  }
  if ((p.workingDaysPerMonth ?? 26) < 1 || (p.workingDaysPerMonth ?? 26) > 31) {
    errors.push({ field: "workingDaysPerMonth", messageKey: "policy.validation.workingDays" });
  }
  return errors;
}
