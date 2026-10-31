/**
 * D-Arrow Business — canonical attendance lateness policy unit suite
 *
 * Pure deterministic tests (NO Firebase, NO DOM, NO real clock): every punch
 * instant is an injected epoch and every timezone an explicit IANA id, so the
 * results NEVER depend on the machine running the suite. Covers the twelve
 * scenarios from the lateness-unification audit that can be proven at the
 * lib level:
 *
 *   1. on-time scheduled punch                    7. Asia/Riyadh month boundary
 *   2. scheduled punch beyond grace               8. cross-day schedule punch
 *   3. cutoff earlier than shift (no override)    9. threshold/deduction consistency
 *   4. cutoff later than shift (schedule wins)   10. report == persisted row == alert
 *   5. unscheduled cutoff fallback               11. legacy rows keep their basis
 *   6. missing/invalid schedule & cutoff         12. posted cases stay immutable
 *
 * Run: npx tsx scripts/test-attendance-lateness-unit.ts
 */

import {
  punctualityForCheckIn,
  countableLateMinutes,
  punchCountableMinutes,
  accumulateMonth,
  reachedThresholds,
  canTransitionDeductionCase,
  // Canonical policy (the contract under test):
  FALLBACK_TIMEZONE,
  effectivePunchTimezone,
  zonedDayKeyOf,
  zonedMonthKeyOf,
  cutoffLateMinutes,
  canonicalLateness,
} from "../src/features/people/lib/work-schedule-rules";
import type { ScheduleValues } from "../src/features/people/types/work-schedule.types";

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

/** Schedule values builder — timezone-explicit, nothing browser-derived. */
const values = (over: Partial<ScheduleValues> = {}): ScheduleValues => ({
  startTime: "09:00",
  endTime: "17:00",
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakMinutes: 0,
  breakCountsAsWork: true,
  graceMinutes: 0,
  requiredDailyMinutes: null,
  flexibleStartWindow: null,
  timezone: "Asia/Riyadh", // UTC+3, no DST — deterministic
  overtime: null,
  ...over,
});

const RIYADH_OFFSET_MIN = 180;

/* -------------------------------------------------------------------------- */
/* Timezone resolution — schedule zone, else the documented project fallback   */
/* -------------------------------------------------------------------------- */

eq(FALLBACK_TIMEZONE, "UTC", "the documented project fallback timezone is UTC (no company tz field exists)");
eq(effectivePunchTimezone("Asia/Riyadh"), "Asia/Riyadh", "valid schedule timezone is honored verbatim");
eq(effectivePunchTimezone("Europe/London"), "Europe/London", "another valid IANA zone honored");
eq(effectivePunchTimezone("Not/AZone"), FALLBACK_TIMEZONE, "INVALID schedule timezone falls back to the documented fallback, never browser-local");
eq(effectivePunchTimezone(""), FALLBACK_TIMEZONE, "empty timezone → documented fallback");
eq(effectivePunchTimezone(null), FALLBACK_TIMEZONE, "no schedule timezone (unscheduled punch) → documented fallback");

/* -------------------------------------------------------------------------- */
/* Zoned day/month keys — the ONE convention for punch date & boundaries       */
/* -------------------------------------------------------------------------- */

{
  // 2026-11-01T00:30+03:00 === 2026-10-31T21:30Z.
  const epoch = Date.UTC(2026, 9, 31, 21, 30);
  eq(zonedDayKeyOf(epoch, "Asia/Riyadh"), "2026-11-01", "Riyadh punch at 00:30 local gets the RIYADH calendar day, not the UTC one");
  eq(zonedMonthKeyOf(epoch, "Asia/Riyadh"), "2026-11", "month boundary follows the schedule timezone (scenario 7)");
  eq(zonedDayKeyOf(epoch, "UTC"), "2026-10-31", "the same instant in UTC is still October 31 (browser-independent)");
  eq(zonedMonthKeyOf(epoch, "UTC"), "2026-10", "UTC month key unchanged for the same instant");
  eq(zonedDayKeyOf(epoch, "Not/AZone"), "2026-10-31", "invalid zone degrades to the UTC fallback key, never a guessed local day");
}

/* -------------------------------------------------------------------------- */
/* Company-cutoff lateness — evaluated in a zone, never browser-local          */
/* -------------------------------------------------------------------------- */

eq(cutoffLateMinutes(Date.UTC(2026, 9, 31, 12, 0), "11:30", "UTC"), 30, "cutoff 11:30 UTC, punch 12:00 UTC → 30 late (scenario 5)");
eq(cutoffLateMinutes(Date.UTC(2026, 9, 31, 11, 0), "11:30", "UTC"), 0, "punch before the cutoff is on time");
eq(cutoffLateMinutes(Date.UTC(2026, 9, 31, 12, 0), "11:30", "Asia/Riyadh"), 210, "12:00Z = 15:00 Riyadh vs an 11:30 cutoff → 210 late, proving the zone drives the result (scenario 5 counterpart)");
eq(cutoffLateMinutes(Date.UTC(2026, 9, 31, 12, 0), "11:30", "UTC"), 30, "the same instant in UTC is only 30 late — browser/UTC vs schedule zone differ");
eq(cutoffLateMinutes(Date.UTC(2026, 9, 31, 23, 59), "25:99", "UTC"), 0, "invalid cutoff NEVER fabricates lateness (scenario 6)");
eq(cutoffLateMinutes(Date.UTC(2026, 9, 30, 21, 30), "00:00", "Asia/Riyadh"), 30, "00:30 Riyadh (= 21:30Z) past a 00:00 cutoff counts 30, not the 1290 UTC minutes");

/* -------------------------------------------------------------------------- */
/* Canonical lateness contract — one basis per punch, one persisted number     */
/* -------------------------------------------------------------------------- */

// 1. On-time scheduled punch: 08:50 Riyadh (start 09:00, grace 0).
{
  const nowMs = Date.UTC(2026, 9, 31, 5, 50); // 08:50+03
  const punct = punctualityForCheckIn(values(), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false), timezone: punct.timezone },
    cutoffTime: "11:30",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(punct.rawLateMinutes, 0, "S1 · schedule punctual (08:50 vs 09:00 start)");
  eq([c.basis, c.lateMinutes, c.isLate, c.deductionMinutes, c.punchDate], ["schedule", 0, false, 0, "2026-10-31"], "S1 · canonical on-time scheduled punch: present, zero late, zero deducted");
}

// 2. Scheduled punch beyond the grace period: 09:20 Riyadh, grace 15 → 5 late.
{
  const nowMs = Date.UTC(2026, 9, 31, 6, 20);
  const punct = punctualityForCheckIn(values({ graceMinutes: 15 }), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false), timezone: punct.timezone },
    cutoffTime: "11:30",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(punct.rawLateMinutes, 5, "S2 · 5 minutes past start+grace");
  eq([c.basis, c.lateMinutes, c.isLate], ["schedule", 5, true], "S2 · canonical late minutes come from the schedule (5m past the grace)");
}

// 3. Cutoff EARLIER than the shift must not override the schedule:
//    cutoff 08:00 (legacy would say late), shift 13:00 Riyadh, punch 12:50.
{
  const nowMs = Date.UTC(2026, 9, 31, 9, 50); // 12:50+03
  const punct = punctualityForCheckIn(values({ startTime: "13:00" }), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const cutoffBasis = cutoffLateMinutes(nowMs, "08:00", "Asia/Riyadh");
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false), timezone: punct.timezone },
    cutoffTime: "08:00",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  ok(cutoffBasis > 0, "S3 · the company cutoff alone WOULD have called this punch late");
  eq([c.basis, c.lateMinutes, c.isLate], ["schedule", 0, false], "S3 · assigned shift wins: the company cutoff cannot override a punctual scheduled punch");
  eq(c.punchDate, "2026-10-31", "S3 · punch date follows the schedule timezone");
}

// 4. Cutoff LATER than the shift: schedule is late although the cutoff is silent.
{
  const nowMs = Date.UTC(2026, 9, 31, 6, 30); // 09:30+03, shift 09:00, grace 0
  const punct = punctualityForCheckIn(values(), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false), timezone: punct.timezone },
    cutoffTime: "23:59",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(cutoffLateMinutes(nowMs, "23:59", "Asia/Riyadh"), 0, "S4 · the company cutoff alone says on-time");
  eq([c.basis, c.lateMinutes, c.isLate], ["schedule", 30, true], "S4 · the alert/deduction basis is the schedule even when the company cutoff is silent");
}

// 5. Unscheduled punch → company cutoff fallback, evaluated in the documented zone.
{
  const nowMs = Date.UTC(2026, 10, 1, 12, 0);
  const c = canonicalLateness({ nowMs, schedule: null, cutoffTime: "11:30", priorLateOccurrences: 0, lateThreshold: 3 });
  eq([c.basis, c.timezone, c.lateMinutes, c.isLate, c.punchDate], ["cutoff", FALLBACK_TIMEZONE, 30, true, "2026-11-01"], "S5 · no schedule → documented cutoff fallback in the documented fallback zone");
}

// 6. Missing/invalid schedule resolution must NEVER silently classify as late.
{
  const nowMs = Date.UTC(2026, 10, 1, 3, 0); // 06:00 UTC — before any sane cutoff
  const c = canonicalLateness({ nowMs, schedule: null, cutoffTime: "11:30", priorLateOccurrences: 0, lateThreshold: 3 });
  eq([c.lateMinutes, c.isLate], [0, false], "S6a · resolution failed (treated as unscheduled) + punch before cutoff → never late");
  const badZone = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: 7, timezone: "Not/AZone" },
    cutoffTime: "11:30",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq([badZone.timezone, badZone.basis, badZone.lateMinutes], [FALLBACK_TIMEZONE, "schedule", 7], "S6b · invalid schedule timezone degrades to the documented fallback; the countable basis is not thrown away");
}

// 7. Asia/Riyadh month boundary: occurrence counting window follows the zone.
{
  const nowMs = Date.UTC(2026, 9, 31, 21, 30); // 2026-11-01 00:30+03
  const punct = punctualityForCheckIn(values({ startTime: "00:00", graceMinutes: 0 }), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false), timezone: punct.timezone },
    cutoffTime: "00:00",
    priorLateOccurrences: 2,
    lateThreshold: 3,
  });
  eq(punct.crossDayCheckIn, false, "S7 · a 00:30 Riyadh punch is NOT cross-day against its own Riyadh punch date (the UTC day-key mismatch is gone)");
  eq([c.punchDate, c.monthKey], ["2026-11-01", "2026-11"], "S7 · month boundary computed in the schedule timezone, not UTC");
  eq(c.lateMinutes, 30, "S7 · 00:30 vs a 00:00 start = 30 schedule-late minutes");
  eq(c.deductionMinutes, 30, "S7 · third occurrence of November (threshold 3) deducts — in November's window");
}

// 8. Cross-day punch: zoned day genuinely differs from the punch row's day → 0, never fabricated.
{
  const nowMs = Date.UTC(2026, 9, 31, 21, 30); // 2026-11-01 in Riyadh
  const punct = punctualityForCheckIn(values(), new Date(nowMs), "2026-10-31");
  eq([punct.crossDayCheckIn, punct.rawLateMinutes], [true, 0], "S8 · ambiguous midnight-region punch flagged cross-day and contributes 0 lateness — data never invented");
}

// 9. Threshold & deduction semantics preserved and DISTINCT from raw/countable.
{
  const nowMs = Date.UTC(2026, 9, 31, 6, 20); // S2's punch: raw 5
  const punct = punctualityForCheckIn(values({ graceMinutes: 15 }), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const countable = countableLateMinutes(punct.rawLateMinutes, false);
  const base = { nowMs, schedule: { countableLateMinutes: countable, timezone: punct.timezone }, cutoffTime: "11:30", lateThreshold: 3 };
  const first = canonicalLateness({ ...base, priorLateOccurrences: 0 });
  const second = canonicalLateness({ ...base, priorLateOccurrences: 1 });
  const third = canonicalLateness({ ...base, priorLateOccurrences: 2 });
  const fourth = canonicalLateness({ ...base, priorLateOccurrences: 3 });
  eq([first.deductionMinutes, second.deductionMinutes], [0, 0], "S9 · the first threshold-1 late occurrences of the month are grace — deducted 0");
  eq([third.deductionMinutes, fourth.deductionMinutes], [5, 5], "S9 · from the threshold-th occurrence each late day deducts its OWN late minutes");
  const excused = canonicalLateness({
    ...base,
    schedule: { countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, true), timezone: punct.timezone },
    priorLateOccurrences: 5,
  });
  eq([excused.lateMinutes, excused.isLate, excused.deductionMinutes], [0, false, 0], "S9 · approved leave excuses the day: raw stays on the snapshot, countable/late/deduction all 0 (fields not collapsed)");
}

// 10. The alert number == the persisted row number == the report/payroll number.
{
  const nowMs = Date.UTC(2026, 9, 31, 6, 30); // S4's schedule-late punch: 30
  const punct = punctualityForCheckIn(values(), new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const snapshot = {
    scheduleAssignmentId: "a1",
    scheduledStart: punct.scheduledStart,
    scheduleTimezone: punct.timezone,
    graceMinutes: punct.graceMinutes,
    rawLateMinutes: punct.rawLateMinutes,
    excusedLateMinutes: 0,
    countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false),
    workMode: "office" as const,
  };
  const c = canonicalLateness({ nowMs, schedule: snapshot, cutoffTime: "23:59", priorLateOccurrences: 0, lateThreshold: 3 });
  // Exactly what checkIn persists and what the store feeds the modal:
  const rowLateMinutes = c.lateMinutes;
  const alertMinutes = c.lateMinutes; // store reads res.data.lateMinutes
  // Exactly what the report and evaluateMonth (payroll) derive:
  const reportRow = { id: "att1", date: c.punchDate, status: c.isLate ? "late" : "present", lateMinutes: rowLateMinutes, schedule: snapshot };
  const month = accumulateMonth([reportRow], "emp1", c.monthKey);
  eq(alertMinutes, rowLateMinutes, "S10 · alert minutes == persisted attendance lateness minutes");
  eq(punchCountableMinutes(reportRow), rowLateMinutes, "S10 · report basis (schedule countable) == persisted lateMinutes — no divergence for new rows");
  eq(month.totalMinutes, rowLateMinutes, "S10 · monthly accumulation sees the same 30 minutes");
}

// 11. Backward compatibility: legacy rows (no snapshot) keep their cutoff basis.
{
  const legacyRow = { id: "old1", date: "2026-09-15", status: "late", lateMinutes: 45, schedule: null };
  eq(punchCountableMinutes(legacyRow), 45, "S11 · historical rows without a snapshot still accumulate their stored legacy lateMinutes verbatim");
  const month = accumulateMonth([legacyRow], "emp1", "2026-09");
  eq([month.totalMinutes, month.legacyMinutes], [45, 45], "S11 · legacy minutes stay labeled legacy in the monthly accumulation");
}

// 12. Posted payroll cases are outside the policy's reach (immutability).
{
  ok(canTransitionDeductionCase("posted", "reversed"), "S12 · posted cases only ever transition to reversed (the official reversal path)");
  ok(!canTransitionDeductionCase("posted", "proposed"), "S12 · a recomputation can never reopen a posted case");
  ok(!canTransitionDeductionCase("posted", "approved"), "S12 · posted is not re-approvable");
  // canonicalLateness is pure: it derives numbers, it never touches cases.
  const c = canonicalLateness({ nowMs: Date.UTC(2026, 9, 31, 12, 0), schedule: null, cutoffTime: "11:30", priorLateOccurrences: 9, lateThreshold: 3 });
  eq([c.basis, c.lateMinutes, c.deductionMinutes], ["cutoff", 30, 30], "S12 · unscheduled cutoff punch past threshold deducts; case lifecycle remains the work-schedule service's concern (untouched by the policy fn)");
}

// Threshold evaluation surface reached by the policy stays snapshot-aware.
{
  const nowMs = Date.UTC(2026, 9, 31, 6, 30); // 30 schedule-late minutes (S4)
  const row = { id: "att2", date: "2026-10-31", status: "late", lateMinutes: 30, schedule: { rawLateMinutes: 30, excusedLateMinutes: 0, countableLateMinutes: 30 } };
  const hit = reachedThresholds(
    punchCountableMinutes(row),
    { thresholds: [{ id: "t1", afterMinutes: 30, automatic: true, action: { kind: "warning" as const } }], thresholdMode: "cumulative" as const }
  );
  eq(hit.map((t) => t.id), ["t1"], "policy thresholds trigger on the canonical (schedule countable) monthly total");
}

console.log(`\n${failed === 0 ? "✅" : "❌"} lateness-policy unit suite: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
