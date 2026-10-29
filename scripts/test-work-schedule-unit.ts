/**
 * D-Arrow Business — work schedules / lateness / deduction-policy unit suite
 *
 * Pure deterministic tests over src/features/people/lib/work-schedule-rules
 * (no Firebase, no DOM): defaults, zoned punctuality, assignment resolution
 * precedence, monthly accumulation, threshold modes, the day-wage bases and
 * the "24 accumulated hours → three days" example AS CONFIGURED (never as a
 * hardcoded rule), the case state machine and deterministic case ids.
 * Run: npx tsx scripts/test-work-schedule-unit.ts
 */

import {
  parseHHmm,
  formatDurationHM,
  round2,
  zonedMoment,
  scheduleDurationMinutes,
  scheduledWorkMinutes,
  requiredDailyMinutes,
  isWorkingDay,
  effectiveValuesOf,
  overtimeMinutes,
  punctualityForCheckIn,
  countableLateMinutes,
  resolveAssignmentFor,
  findAssignmentConflict,
  punchCountableMinutes,
  accumulateMonth,
  canTransitionDeductionCase,
  reachedThresholds,
  dailyWageRate,
  computeDeductionAmount,
  deductionCaseId,
  validateScheduleValues,
  validatePolicyDraft,
} from "../src/features/people/lib/work-schedule-rules";
import {
  OFFICE_SCHEDULE_DEFAULTS,
  ONLINE_SCHEDULE_DEFAULTS,
  DEDUCTION_CASE_TRANSITIONS,
  type LatenessPolicy,
  type ScheduleAssignment,
  type ScheduleValues,
} from "../src/features/people/types/work-schedule.types";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}\n      expected ${b}\n      actual   ${a}`);
  }
}
function ok(cond: boolean, label: string) {
  eq(cond, true, label);
}

/* -------------------------------------------------------------------------- */
/* Time primitives                                                             */
/* -------------------------------------------------------------------------- */

eq(parseHHmm("13:00"), 780, "parseHHmm 13:00 = 780 minutes");
eq(parseHHmm("00:07"), 7, "parseHHmm 00:07 = 7");
eq(parseHHmm("24:00"), null, "parseHHmm rejects 24:00");
eq(parseHHmm("9:5"), null, "parseHHmm rejects malformed 9:5");
eq(parseHHmm(undefined), null, "parseHHmm rejects undefined");
eq(formatDurationHM(1470), "24h 30m", "1470 min renders as 24h 30m");
eq(formatDurationHM(45), "45m", "45 min renders as 45m (no 0h prefix)");
eq(formatDurationHM(-10), "0m", "negative never renders");
eq(round2(100.455), 100.46, "round2 uses the repo 2-dp money convention");

// zonedMoment must be zone-correct regardless of the machine running the test.
{
  const epoch = Date.UTC(2026, 9, 27, 10, 0, 0); // 10:00Z → 13:00 Riyadh (+3)
  const ryd = zonedMoment(epoch, "Asia/Riyadh");
  eq(ryd.dayKey, "2026-10-27", "zonedMoment dayKey in Riyadh");
  eq(ryd.minutes, 13 * 60, "zonedMoment minutes since local midnight (Riyadh)");
  eq(ryd.weekday, 2, "zonedMoment weekday 2026-10-27 = Tuesday");
  // 01:00Z is still 04:00 the SAME day in Riyadh, but the UTC date already
  // matches — use 22:00Z (01:00 next day Riyadh) to prove the day shifts.
  const late = zonedMoment(Date.UTC(2026, 9, 26, 22, 0, 0), "Asia/Riyadh");
  eq(late.dayKey, "2026-10-27", "zone crossing moves the day forward, not the UTC date");
}

/* -------------------------------------------------------------------------- */
/* Schedule values — the configurable product defaults                         */
/* -------------------------------------------------------------------------- */

eq(OFFICE_SCHEDULE_DEFAULTS.startTime, "13:00", "Office default starts 13:00");
eq(OFFICE_SCHEDULE_DEFAULTS.endTime, "20:00", "Office default ends 20:00");
eq(scheduleDurationMinutes(OFFICE_SCHEDULE_DEFAULTS), 7 * 60, "Office day = 7h scheduled");
eq(requiredDailyMinutes(OFFICE_SCHEDULE_DEFAULTS), 7 * 60, "Office required derives to 7h");
eq(ONLINE_SCHEDULE_DEFAULTS.startTime, "11:00", "Online/freelance default starts 11:00");
eq(ONLINE_SCHEDULE_DEFAULTS.endTime, "19:00", "Online/freelance default ends 19:00");
eq(requiredDailyMinutes(ONLINE_SCHEDULE_DEFAULTS), 8 * 60, "Online required derives to 8h");
ok(isWorkingDay(OFFICE_SCHEDULE_DEFAULTS, 0), "Office works Sunday (KSA weekend = Fri/Sat)");
ok(!isWorkingDay(OFFICE_SCHEDULE_DEFAULTS, 5), "Office does NOT work Friday");
ok(!isWorkingDay(OFFICE_SCHEDULE_DEFAULTS, 6), "Office does NOT work Saturday");

{
  const v: ScheduleValues = {
    ...OFFICE_SCHEDULE_DEFAULTS,
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
  };
  eq(scheduledWorkMinutes({ ...v, breakCountsAsWork: true }), 540, "paid break keeps 9h productive");
  eq(scheduledWorkMinutes({ ...v, breakCountsAsWork: false }), 480, "unpaid break reduces to 8h");
  eq(requiredDailyMinutes({ ...v, breakCountsAsWork: false, requiredDailyMinutes: 450 }), 450, "explicit required minutes overrides derivation");
  eq(overtimeMinutes({ ...v, overtime: null }, 700), 0, "overtime disabled → 0 even after a 700-min day");
  eq(overtimeMinutes({ ...v, overtime: { enabled: true, afterWorkMinutes: 540 } }, 700), 160, "overtime past 540 worked minutes");
}

{
  const a = {
    snapshot: { ...OFFICE_SCHEDULE_DEFAULTS, timezone: "UTC" },
    overrides: { graceMinutes: 15 },
  } as ScheduleAssignment;
  eq(effectiveValuesOf(a).graceMinutes, 15, "overrides layer over the frozen snapshot");
  eq(effectiveValuesOf(a).startTime, "13:00", "snapshot survives when not overridden");
}

/* -------------------------------------------------------------------------- */
/* Punctuality (per check-in)                                                  */
/* -------------------------------------------------------------------------- */

{
  const values: ScheduleValues = { ...OFFICE_SCHEDULE_DEFAULTS, graceMinutes: 10, timezone: "Asia/Riyadh" };
  // 13:20 Riyadh = 10:20Z on 2026-10-27
  const late = punctualityForCheckIn(values, new Date(Date.UTC(2026, 9, 27, 10, 20)), "2026-10-27");
  eq(late.rawLateMinutes, 10, "13:20 arrival vs 13:00 start with 10-min grace = 10 late (no round-up)");
  eq(late.crossDayCheckIn, false, "same zoned day is not a cross-day punch");
  // 13:05 Riyadh → inside the grace window
  const onTime = punctualityForCheckIn(values, new Date(Date.UTC(2026, 9, 27, 10, 5)), "2026-10-27");
  eq(onTime.rawLateMinutes, 0, "arrival inside grace is on time");
  // Flexible window 13:00–13:30 moves the anchor to its END
  const flex = punctualityForCheckIn(
    { ...values, flexibleStartWindow: ["13:00", "13:30"] },
    new Date(Date.UTC(2026, 9, 27, 10, 25)),
    "2026-10-27"
  );
  eq(flex.rawLateMinutes, 0, "arrival inside the flexible window is on time (anchor = window end)");
  // Midnight-ambiguous punch: zoned day ≠ punch day → 0, flagged, never invented
  const cross = punctualityForCheckIn(values, new Date(Date.UTC(2026, 9, 26, 22, 30)), "2026-10-26");
  eq(cross.crossDayCheckIn, true, "zoned-day mismatch is flagged, not silently attributed");
  eq(cross.rawLateMinutes, 0, "ambiguous cross-day punch contributes ZERO lateness");
  eq(countableLateMinutes(late.rawLateMinutes, false), 10, "unexcused raw minutes count fully");
  eq(countableLateMinutes(late.rawLateMinutes, true), 0, "approved leave excuses the whole day's delay");
}

/* -------------------------------------------------------------------------- */
/* Assignment resolution & conflicts                                           */
/* -------------------------------------------------------------------------- */

function assignment(p: Partial<ScheduleAssignment> & { id: string }): ScheduleAssignment {
  return {
    scope: "employee",
    employeeId: "e1",
    department: null,
    templateId: "t1",
    templateVersion: 1,
    snapshot: OFFICE_SCHEDULE_DEFAULTS,
    overrides: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    reason: null,
    status: "active",
    createdBy: "u",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    audit: [],
    ...p,
  } as ScheduleAssignment;
}

{
  const group = assignment({ id: "a-group", scope: "group", employeeId: null, department: "Engineering" });
  const own = assignment({ id: "a-own", scope: "employee", employeeId: "e1" });
  const ownNewer = assignment({ id: "a-own-new", scope: "employee", employeeId: "e1", effectiveFrom: "2026-06-01" });
  const rows = [group, own, ownNewer];
  eq(resolveAssignmentFor(rows, "e1", "Engineering", "2026-03-01")?.id, "a-own", "employee-specific beats group");
  eq(resolveAssignmentFor(rows, "e1", "Engineering", "2026-07-01")?.id, "a-own-new", "latest effectiveFrom wins within scope");
  eq(resolveAssignmentFor(rows, "e9", "Engineering", "2026-03-01")?.id, "a-group", "group assignment applies to non-individual employees");
  eq(resolveAssignmentFor(rows, "e9", "Sales", "2026-03-01"), null, "no assignment → null (legacy fallback path)");
  eq(
    resolveAssignmentFor([assignment({ id: "x", status: "deactivated" })], "e1", undefined, "2026-03-01"),
    null,
    "deactivated assignments never resolve"
  );
  eq(
    resolveAssignmentFor([assignment({ id: "x", effectiveFrom: "2026-08-01" })], "e1", undefined, "2026-03-01"),
    null,
    "assignment not yet effective does not resolve"
  );
}

{
  const existing = [assignment({ id: "c1", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" })];
  ok(
    findAssignmentConflict({ scope: "employee", employeeId: "e1", effectiveFrom: "2026-06-01", effectiveTo: null }, existing) != null,
    "overlapping employee assignment is detected"
  );
  eq(
    findAssignmentConflict({ scope: "employee", employeeId: "e1", effectiveFrom: "2026-07-01", effectiveTo: null }, existing),
    null,
    "back-to-back employee assignment (starts the day after) is allowed"
  );
  eq(
    findAssignmentConflict({ scope: "group", department: "Engineering", effectiveFrom: "2026-03-01", effectiveTo: null }, existing),
    null,
    "group assignments never conflict with employee scope"
  );
  eq(
    findAssignmentConflict({ scope: "employee", employeeId: "e2", effectiveFrom: "2026-03-01", effectiveTo: null }, existing),
    null,
    "different employees never conflict"
  );
}

/* -------------------------------------------------------------------------- */
/* Monthly accumulation                                                        */
/* -------------------------------------------------------------------------- */

{
  const rows = [
    { id: "r1", date: "2026-10-01", status: "late", lateMinutes: 20, schedule: { rawLateMinutes: 25, excusedLateMinutes: 5, countableLateMinutes: 20 } },
    { id: "r2", date: "2026-10-02", status: "present", lateMinutes: 0, schedule: { rawLateMinutes: 0, excusedLateMinutes: 0, countableLateMinutes: 0 } },
    // legacy row (no snapshot) — counted verbatim and labeled legacy
    { id: "r3", date: "2026-10-05", status: "late", lateMinutes: 15, schedule: null },
    // excused day: raw but zero countable
    { id: "r4", date: "2026-10-06", status: "late", lateMinutes: 0, schedule: { rawLateMinutes: 30, excusedLateMinutes: 30, countableLateMinutes: 0 } },
    // other month must never leak in
    { id: "r5", date: "2026-09-20", status: "late", lateMinutes: 999, schedule: null },
  ];
  const acc = accumulateMonth(rows, "e1", "2026-10");
  eq(acc.totalMinutes, 35, "month total = 20 (schedule) + 15 (legacy) countable minutes");
  eq(acc.legacyMinutes, 15, "legacy-basis minutes tracked separately for labeling");
  eq(acc.excusedMinutes, 35, "excused minutes (5 + 30) kept for the breakdown, never counted");
  eq(acc.contributingIds, ["r1", "r3"], "only days with countable minutes are traceable contributors");
  eq(acc.days.length, 4, "NO missing workday is invented as lateness — only existing rows appear");
  eq(punchCountableMinutes({ id: "z", date: "2026-10-01", status: "cancelled", lateMinutes: 50, schedule: null }), 0, "cancelled rows contribute nothing");
}

/* -------------------------------------------------------------------------- */
/* Threshold modes & the deduction amount                                      */
/* -------------------------------------------------------------------------- */

const policyBits = {
  thresholds: [
    { id: "t1", afterMinutes: 480, action: { kind: "warning" as const }, automatic: true },
    { id: "t2", afterMinutes: 1440, action: { kind: "propose_deduction" as const, deductionDays: 3, basis: "calendar_30" as const }, automatic: true },
    { id: "t3", afterMinutes: 2880, action: { kind: "propose_deduction" as const, deductionDays: 5, basis: "working_days" as const }, automatic: false },
  ],
};

{
  const cum = reachedThresholds(1500, { ...policyBits, thresholdMode: "cumulative" });
  eq(cum.map((t) => t.id), ["t1", "t2"], "cumulative mode reports every crossed threshold");
  const stepped = reachedThresholds(1500, { ...policyBits, thresholdMode: "stepped" });
  eq(stepped.map((t) => t.id), ["t2"], "stepped mode fires only the highest crossed threshold");
  const reset = reachedThresholds(1500, { ...policyBits, thresholdMode: "reset_after_action" }, [1440]);
  eq(reset.length, 0, "reset_after_action rebases: 1500 with t2 already fired adds up to only 60");
  const reset2 = reachedThresholds(3000, { ...policyBits, thresholdMode: "reset_after_action" }, [1440]);
  eq(reset2.map((t) => t.id), ["t1", "t2"], "reset mode: the 1560-min remainder after t2 re-crosses the warning AND the 1440 deduction (service dedupes via case-id existence)");
}

eq(dailyWageRate(3000, "calendar_30", 26), 100, "calendar_30 day rate = gross/30");
eq(dailyWageRate(2600, "working_days", 26), 100, "working_days day rate = gross/workingDaysPerMonth");

{
  // THE spec example: 24 accumulated hours → "equivalent of three days" —
  // it only exists because the POLICY says so (t2: 1440 min → 3 × calendar_30).
  const r = computeDeductionAmount({
    monthlyGross: 3000,
    action: { kind: "propose_deduction", deductionDays: 3, basis: "calendar_30" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
  });
  eq(r.amount, 300, "24h lateness → 3 days at gross 3000 (calendar_30) = 300 — policy-driven");
  eq(r.dailyRate, 100, "daily rate recorded for transparency");
  ok(!r.capped, "no cap configured → none applied (system invents nothing)");

  const capped = computeDeductionAmount({
    monthlyGross: 3000,
    action: { kind: "propose_deduction", deductionDays: 3, basis: "calendar_30" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 150,
    maxMonthlyDeductionAmount: 400,
    maxMonthlyDeductionGrossFraction: 0,
  });
  eq(capped.amount, 250, "monthly cap applied against already-committed money");
  eq(capped.capReason, "monthly_amount", "cap reason surfaced for the review UI");

  const noGross = computeDeductionAmount({
    monthlyGross: 0,
    action: { kind: "propose_deduction", deductionDays: 3, basis: "calendar_30" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
  });
  eq(noGross.amount, 0, "employee without salary on record → NOTHING is fabricated");
  eq(noGross.capReason, "no_gross_on_record", "…and it is labeled as a review item reason");

  const frac = computeDeductionAmount({
    monthlyGross: 5000,
    action: { kind: "propose_deduction", deductionDays: null, basis: "salary_fraction", fraction: 0.1 },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0.05,
  });
  eq(frac.amount, 250, "salary_fraction honored but the configured 5% gross cap wins");
  eq(frac.capReason, "gross_fraction", "fraction cap reason labeled");

  const warn = computeDeductionAmount({
    monthlyGross: 3000,
    action: { kind: "warning" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
  });
  eq(warn.amount, 0, "non-deduction actions never produce money");
}

/* -------------------------------------------------------------------------- */
/* Case state machine & deterministic ids                                      */
/* -------------------------------------------------------------------------- */

ok(canTransitionDeductionCase("pending_review", "approved"), "review item may be approved");
ok(canTransitionDeductionCase("proposed", "rejected"), "proposal may be rejected");
ok(canTransitionDeductionCase("approved", "posted"), "approved case may be posted");
ok(canTransitionDeductionCase("posted", "reversed"), "posted case may be reversed");
ok(!canTransitionDeductionCase("proposed", "posted"), "NO posting while approval pending");
ok(!canTransitionDeductionCase("rejected", "approved"), "rejected is terminal");
ok(!canTransitionDeductionCase("reversed", "posted"), "reversed is terminal");
ok(!canTransitionDeductionCase("posted", "approved"), "posted history never rewinds");
eq(DEDUCTION_CASE_TRANSITIONS.rejected.length, 0, "rejected has no exits");
eq(deductionCaseId("e1", "2026-10", "t2"), "e1_2026-10_t2", "case id is deterministic per employee+period+threshold");
eq(deductionCaseId("e1", "2026-10", "t2"), deductionCaseId("e1", "2026-10", "t2"), "same evaluation run cannot mint a second id");

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

{
  eq(validateScheduleValues(OFFICE_SCHEDULE_DEFAULTS).length, 0, "the shipped Office default is valid");
  eq(validateScheduleValues(ONLINE_SCHEDULE_DEFAULTS).length, 0, "the shipped Online default is valid");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, endTime: "12:00" }).some((e) => e.field === "endTime"), "end-before-start rejected");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, workingDays: [] }).some((e) => e.field === "workingDays"), "empty working-days rejected");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, workingDays: [7] }).some((e) => e.field === "workingDays"), "weekday 7 rejected");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, workingDays: [-1] }).some((e) => e.field === "workingDays"), "weekday -1 rejected");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, workingDays: [1.5] }).some((e) => e.field === "workingDays"), "non-integer weekday rejected");
  ok(validateScheduleValues({ ...OFFICE_SCHEDULE_DEFAULTS, graceMinutes: 300 }).some((e) => e.field === "graceMinutes"), "absurd grace window rejected");
}

{
  const base = {
    name: "Lateness 2026",
    appliesTo: {},
    period: "calendar_month" as const,
    thresholdMode: "cumulative" as const,
    workingDaysPerMonth: 26,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
    legalBasis: null,
    effectiveFrom: "2026-01-01",
    createdBy: "u",
  };
  eq(
    validatePolicyDraft({ ...base, thresholds: [{ id: "t1", afterMinutes: 1440, action: { kind: "propose_deduction", deductionDays: 3, basis: "calendar_30" }, automatic: true }] }).length,
    0,
    "the spec example (24h → 3 days, explicit basis) is a VALID policy draft"
  );
  ok(validatePolicyDraft({ ...base, thresholds: [] }).some((e) => e.field === "thresholds"), "policy without thresholds rejected");
  ok(
    validatePolicyDraft({ ...base, thresholds: [{ id: "t1", afterMinutes: 1440, action: { kind: "propose_deduction", deductionDays: 3 }, automatic: true }] }).some((e) => e.field.includes("basis")),
    "'three days' WITHOUT an explicit wage basis is rejected — no assumed meaning"
  );
  ok(
    validatePolicyDraft({ ...base, thresholds: [{ id: "t1", afterMinutes: 0, action: { kind: "warning" }, automatic: true }] }).some((e) => e.field.includes("afterMinutes")),
    "zero-minute threshold rejected"
  );
  ok(
    validatePolicyDraft({ ...base, thresholds: [
      { id: "t1", afterMinutes: 60, action: { kind: "warning" }, automatic: true },
      { id: "t1", afterMinutes: 120, action: { kind: "warning" }, automatic: true },
    ] }).some((e) => e.messageKey === "policy.validation.duplicateId"),
    "duplicate threshold ids rejected"
  );
  eq(validatePolicyDraft({ ...base, name: "  " }).length > 0, true, "blank policy name rejected");
  ok(validatePolicyDraft({ ...base, maxMonthlyDeductionGrossFraction: 1.5 }).length > 0, "fraction cap outside 0..1 rejected");
}

/* -------------------------------------------------------------------------- */

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
