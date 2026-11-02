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

/** Clock boundary (minutes since local midnight) separating a morning-shift
 *  end from an afternoon one; a shift ending at/after this is treated as a
 *  same-day window, never as an overnight tail (see punctualityForCheckIn). */
const MIDDAY_MINUTES = 12 * 60;

export interface PunctualityResult {
  scheduledStart: string;
  timezone: string;
  graceMinutes: number;
  rawLateMinutes: number;
  /** The check-in's zoned day did not match the punch's attendance date. */
  crossDayCheckIn: boolean;
}

/**
 * Lateness of a check-in against the EFFECTIVE schedule for the date, measured
 * from the scheduled START INSTANT rather than a bare minutes-of-day compare.
 * The anchor is the end of the flexible window when configured, plus grace; a
 * check-in BEFORE the anchor is simply on time (never negative, never rounded
 * up). Overnight shifts (end at/before start on the clock) run past midnight:
 * a punch whose wall-clock minutes fall in that early-morning tail is measured
 * against the shift that STARTED THE PREVIOUS EVENING, so a 00:15 arrival on a
 * 22:00 shift is genuinely late rather than silently zeroed. Early arrival
 * before a night shift, and any punch that cannot be attributed to a start, is
 * NOT marked late — after-midnight punches are never assumed guilty. A punch
 * on a non-overnight schedule whose zoned day differs from the row's `date`
 * stays flagged `crossDayCheckIn` and contributes 0 (the ambiguous-midnight
 * data-invention guard is preserved exactly).
 */
export function punctualityForCheckIn(
  values: ScheduleValues,
  checkIn: Date,
  punchDayKey: string
): PunctualityResult {
  const startMin = parseHHmm(values.startTime) ?? 0;
  const endMin = parseHHmm(values.endTime) ?? startMin;
  const zone = effectivePunchTimezone(values.timezone);
  const grace = Math.max(0, values.graceMinutes || 0);
  const anchor =
    values.flexibleStartWindow != null
      ? Math.max(startMin, parseHHmm(values.flexibleStartWindow[1]) ?? startMin)
      : startMin;
  const inZone = zonedMoment(checkIn.getTime(), zone);
  const crossDay = inZone.dayKey !== punchDayKey;
  // A shift is genuinely OVERNIGHT only when it runs past midnight and so ENDS
  // in the early hours (before midday). Requiring `endMin < startMin` alone
  // would misread a same-day window whose (later) start merely follows an
  // afternoon end — e.g. a 17:08 start on a 17:00 end — as overnight and
  // wrongly attribute an EARLY arrival before the scheduled start to the
  // previous evening's tail, inventing lateness. Midday is the boundary.
  const overnight = endMin < startMin && endMin < MIDDAY_MINUTES;
  // Early-morning tail of an overnight shift belongs to the previous evening's
  // start; shift the anchor back a full day so the compare is date-aware.
  const inTail = overnight && inZone.minutes <= endMin;
  const effAnchor = inTail ? anchor - 1440 : anchor;
  const diff = inZone.minutes - effAnchor;
  let raw: number;
  if (inTail) {
    raw = diff > grace ? Math.round(diff - grace) : 0;
  } else if (crossDay) {
    raw = 0; // preserved ambiguous-midnight guard for non-overnight schedules
  } else {
    raw = diff > grace ? Math.round(diff - grace) : 0;
  }
  return {
    scheduledStart: values.startTime,
    timezone: zone,
    graceMinutes: grace,
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
/* Canonical lateness policy (single source of truth)                          */
/* -------------------------------------------------------------------------- */

/**
 * The last-resort fallback timezone for HR calendar math. A punch is judged
 * in its assigned schedule's zone when one resolves, otherwise in the
 * tenant-configured company zone, and only when NEITHER is set does this
 * documented fallback apply (with an explicit diagnostic at the call site).
 * The browser's local zone is never an input to any lateness decision.
 */
export const FALLBACK_TIMEZONE = "UTC";

/**
 * The IANA zones offered in the settings UIs. Schedules and the company-level
 * zone share one list so the two settings can never drift into incompatible
 * vocabularies. A stored value outside this list is still accepted as long as
 * it is a valid IANA id (see {@link normalizeTimezone}).
 */
export const TIMEZONE_OPTIONS: readonly string[] = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Karachi",
  "Europe/London",
  "UTC",
];

/**
 * A valid, trimmed IANA zone id, or null when empty/unsupported. This is the
 * single validation primitive — the settings schema, the service write path
 * and the runtime resolver all consult it, so an invalid id never throws and
 * is never quietly treated as a real zone.
 */
export function normalizeTimezone(tz: string | null | undefined): string | null {
  const id = (tz || "").trim();
  if (!id) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id }).format(0);
    return id;
  } catch {
    return null;
  }
}

/** True only for a non-empty, runtime-supported IANA zone id. */
export function isValidTimezone(tz: string | null | undefined): boolean {
  return normalizeTimezone(tz) != null;
}

/** Where an effective timezone came from — drives the UTC-fallback diagnostic. */
export type TimezoneSource = "schedule" | "company" | "fallback";

export interface EffectiveTimezone {
  timezone: string;
  source: TimezoneSource;
}

/**
 * The precedence chain every consumer uses: a valid assigned schedule zone
 * wins; otherwise a valid company zone; otherwise UTC. Never the browser. An
 * invalid id at any level is skipped (not guessed), so the caller learns the
 * true source and can emit the fallback diagnostic.
 */
export function resolveEffectiveTimezone(
  scheduleTimezone?: string | null,
  companyTimezone?: string | null
): EffectiveTimezone {
  const fromSchedule = normalizeTimezone(scheduleTimezone);
  if (fromSchedule) return { timezone: fromSchedule, source: "schedule" };
  const fromCompany = normalizeTimezone(companyTimezone);
  if (fromCompany) return { timezone: fromCompany, source: "company" };
  return { timezone: FALLBACK_TIMEZONE, source: "fallback" };
}

/**
 * The effective zone a punch is judged in from a single zone input (the
 * schedule's own zone, or the company zone when there is no schedule).
 * An invalid/unsupported id degrades to the documented fallback instead of
 * throwing or guessing. For the full schedule → company → UTC chain use
 * {@link resolveEffectiveTimezone}.
 */
export function effectivePunchTimezone(scheduleTimezone: string | null | undefined): string {
  return normalizeTimezone(scheduleTimezone) ?? FALLBACK_TIMEZONE;
}

/** Calendar day key ("YYYY-MM-DD") of an instant in the effective zone. */
export function zonedDayKeyOf(epochMs: number, timezone: string): string {
  return zonedMoment(epochMs, effectivePunchTimezone(timezone)).dayKey;
}

/** Month key ("YYYY-MM") of an instant in the effective zone. */
export function zonedMonthKeyOf(epochMs: number, timezone: string): string {
  return zonedDayKeyOf(epochMs, timezone).slice(0, 7);
}

/**
 * Period month key ("YYYY-MM") for a report that spans many schedules: judged
 * in the company zone (else UTC), never browser-local. This is the documented
 * company-level period timezone the timesheets and lateness reports align to.
 */
export function periodKeyOf(epochMs: number, companyTimezone?: string | null): string {
  return zonedMonthKeyOf(epochMs, resolveEffectiveTimezone(null, companyTimezone).timezone);
}

/** Today's day key ("YYYY-MM-DD") in the company period zone (else UTC). */
export function periodDayKeyOf(epochMs: number, companyTimezone?: string | null): string {
  return zonedDayKeyOf(epochMs, resolveEffectiveTimezone(null, companyTimezone).timezone);
}

/**
 * Minutes the punch falls past the company's "HH:mm" late cutoff, measured in
 * the effective zone (never the browser's). An unparseable cutoff is 0 late —
 * a broken setting never fabricates lateness.
 */
export function cutoffLateMinutes(
  checkInAtMs: number,
  cutoffHHmm: string,
  timezone: string
): number {
  const cutoffMin = parseHHmm(cutoffHHmm);
  if (cutoffMin == null) return 0;
  const inZone = zonedMoment(checkInAtMs, effectivePunchTimezone(timezone));
  return Math.max(0, inZone.minutes - cutoffMin);
}

export interface CanonicalLatenessInput {
  /** Instant of the punch, epoch milliseconds. */
  nowMs: number;
  /**
   * The frozen schedule snapshot's lateness for this punch, or null when no
   * valid schedule resolved (then the company cutoff is the documented
   * fallback basis). `countableLateMinutes` already carries the leave-excuse
   * rule; the raw/excused numbers stay on the snapshot for the audit trail.
   */
  schedule: { countableLateMinutes: number; timezone: string } | null;
  /** Company-wide late cutoff "HH:mm" — fallback basis only. */
  cutoffTime: string;
  /**
   * The tenant's configured company zone (settings/attendance.timezone). Used
   * ONLY when no schedule resolves, to place the cutoff fallback in the right
   * wall-clock day. Null/invalid ⇒ the documented UTC fallback with the
   * `usedUtcFallback` diagnostic set. Never the browser's zone.
   */
  companyTimezone?: string | null;
  /** Late punch days already persisted in the punch's own month. */
  priorLateOccurrences: number;
  /** Late days allowed per month before deductions start. */
  lateThreshold: number;
}

export interface CanonicalLateness {
  /** Zone every field below was derived in. */
  timezone: string;
  /** Whether the zone came from the schedule, the company setting, or UTC. */
  timezoneSource: TimezoneSource;
  /** True only when NEITHER a schedule nor a company zone was available. */
  usedUtcFallback: boolean;
  /** Punch date as persisted on the attendance row. */
  punchDate: string;
  /** Month window used for occurrence counting and report alignment. */
  monthKey: string;
  /** Which basis produced the numbers — never both. */
  basis: "schedule" | "cutoff";
  /** The canonical lateness minutes: persisted, alerted, reported, deducted. */
  lateMinutes: number;
  isLate: boolean;
  /** Minutes deducted for this day once the monthly threshold is reached. */
  deductionMinutes: number;
}

/**
 * THE lateness decision. One punch, one effective timezone, one basis:
 *  - assigned valid schedule → the schedule's own countable lateness rules
 *    (company cutoff cannot add or remove lateness from a scheduled punch);
 *  - no valid schedule → the company cutoff in the documented fallback zone.
 * `lateMinutes`, `status` and the alert therefore agree with what the lateness
 * report and `evaluateMonth` (payroll) derive from the same row. Grace,
 * occurrence and deduction semantics are unchanged — only their clock is.
 */
export function canonicalLateness(input: CanonicalLatenessInput): CanonicalLateness {
  const scheduled = input.schedule != null;
  // Precedence: schedule zone → company zone → UTC. A scheduled punch is
  // always judged in its own schedule zone (company zone only steps in if that
  // id is invalid); an unscheduled punch is judged in the company zone, or UTC
  // when the tenant has configured none.
  const zone = scheduled
    ? resolveEffectiveTimezone(input.schedule!.timezone, input.companyTimezone)
    : resolveEffectiveTimezone(null, input.companyTimezone);
  const timezone = zone.timezone;
  const punchDate = zonedDayKeyOf(input.nowMs, timezone);
  const lateMinutes = scheduled
    ? Math.max(0, Math.round(Number(input.schedule!.countableLateMinutes) || 0))
    : cutoffLateMinutes(input.nowMs, input.cutoffTime, timezone);
  const isLate = lateMinutes > 0;
  const occurrence = input.priorLateOccurrences + 1;
  return {
    timezone,
    timezoneSource: zone.source,
    usedUtcFallback: zone.source === "fallback",
    punchDate,
    monthKey: punchDate.slice(0, 7),
    basis: scheduled ? "schedule" : "cutoff",
    lateMinutes,
    isLate,
    deductionMinutes: isLate && occurrence >= input.lateThreshold ? lateMinutes : 0,
  };
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
/* Monthly lateness → deduction-day conversion (approved 8h = 1 day rule)      */
/* -------------------------------------------------------------------------- */

/**
 * The approved company conversion: 8 ACCUMULATED LATE HOURS equal one
 * deduction day (24h → 3 days). The value is a policy EDITABLE (`hoursPerDeductionDay`)
 * so a tenant can state a different approved ratio; this constant is only the
 * documented default — policies without an explicit conversion keep their
 * legacy fixed `deductionDays` behavior and are never silently re-based.
 */
export const LATE_HOURS_PER_DEDUCTION_DAY = 8;

export interface LateDeductionConversion {
  /** Minutes of accumulated lateness that make one full day. */
  minutesPerDay: number;
  totalMinutes: number;
  /** Accumulated lateness in hours (2-dp, never rounded up to whole hours). */
  totalHours: number;
  /**
   * Exact fractional days for payroll: totalMinutes / minutesPerDay, 2-dp.
   * The payroll model multiplies a daily rate, so fractions are preserved —
   * the conversion NEVER rounds up to a full day.
   */
  deductionDays: number;
  /** Whole days for the transparent breakdown (floor, no rounding up). */
  fullDays: number;
  /** Minutes beyond the last whole day — the carry shown to HR/payroll. */
  remainingMinutes: number;
}

/**
 * Pure conversion of the CANONICAL accumulated minutes (from
 * {@link accumulateMonth} — never a separately calculated UI value) into
 * deduction days using the hours-per-day rule, preserving the remainder.
 */
export function lateDeductionConversion(
  totalMinutes: number,
  hoursPerDay: number = LATE_HOURS_PER_DEDUCTION_DAY
): LateDeductionConversion {
  const perDay = Math.max(1, Math.round((Number(hoursPerDay) || LATE_HOURS_PER_DEDUCTION_DAY) * 60));
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const fullDays = Math.floor(mins / perDay);
  return {
    minutesPerDay: perDay,
    totalMinutes: mins,
    totalHours: round2(mins / 60),
    deductionDays: round2(mins / perDay),
    fullDays,
    remainingMinutes: mins - fullDays * perDay,
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
  /**
   * The canonical monthly accumulation for the employee+period. Present ONLY
   * together with `hoursPerDeductionDay` below, and ONLY then does the
   * approved conversion replace the threshold's fixed days.
   */
  accumulatedMinutes?: number;
  /** Policy-stated conversion (8 = the approved 8h → 1 day rule). Null/0 ⇒ legacy fixed days. */
  hoursPerDeductionDay?: number | null;
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
    // Approved conversion wins when the POLICY explicitly states it: days are
    // derived from the canonical accumulation (fractional, never rounded up).
    // Without it the threshold's fixed days keep the historical behavior.
    const converted =
      (input.hoursPerDeductionDay ?? 0) > 0 &&
      Number.isFinite(input.accumulatedMinutes)
        ? lateDeductionConversion(input.accumulatedMinutes!, input.hoursPerDeductionDay!).deductionDays
        : null;
    days = converted != null ? converted : Math.max(0, action.deductionDays ?? 0);
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
          // When the policy states the accumulation→day conversion, days are
          // derived from the canonical month — the threshold may leave them
          // blank instead of pinning a contradicting fixed value.
          const conversionStated = (p.hoursPerDeductionDay ?? 0) > 0;
          if (!conversionStated && !(t.action.deductionDays != null && t.action.deductionDays > 0)) {
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
  // The accumulation→day conversion is opt-in: when stated it must be sane
  // (0 < hours ≤ 24). Absent/null keeps the legacy fixed-days behavior.
  if (p.hoursPerDeductionDay != null) {
    const h = Number(p.hoursPerDeductionDay);
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      errors.push({ field: "hoursPerDeductionDay", messageKey: "policy.validation.hoursPerDeductionDay" });
    }
  }
  return errors;
}
