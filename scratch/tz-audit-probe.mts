// READ-ONLY audit probe: exercises the SHIPPED canonical helpers with injected
// instants/zones. Writes nothing, mutates nothing — pure functions only.
import {
  FALLBACK_TIMEZONE,
  effectivePunchTimezone,
  zonedDayKeyOf,
  zonedMonthKeyOf,
  cutoffLateMinutes,
  canonicalLateness,
  punctualityForCheckIn,
  countableLateMinutes,
} from "../src/features/people/lib/work-schedule-rules.ts";

const values = (over: Record<string, unknown> = {}) => ({
  startTime: "09:00", endTime: "17:00", workingDays: [0, 1, 2, 3, 4, 5, 6],
  breakMinutes: 0, breakCountsAsWork: true, graceMinutes: 0,
  requiredDailyMinutes: null, flexibleStartWindow: null,
  timezone: "Asia/Riyadh", overtime: null, ...over,
});

const show = (label: string, v: unknown) => console.log(`${label.padEnd(58)} => ${JSON.stringify(v)}`);

console.log("--- A. 00:30 Asia/Riyadh on the FIRST day of a month (Oct -> Nov 2026) ---");
// 00:30 Riyadh on 2026-11-01 == 2026-10-31T21:30Z
const riyadhEarly = Date.UTC(2026, 9, 31, 21, 30);
show("UTC day key (what the OLD code used)", new Date(riyadhEarly).toISOString().slice(0, 10));
show("zoned day key in Asia/Riyadh", zonedDayKeyOf(riyadhEarly, "Asia/Riyadh"));
show("zoned month key in Asia/Riyadh", zonedMonthKeyOf(riyadhEarly, "Asia/Riyadh"));
const sched00 = values({ startTime: "00:00", timezone: "Asia/Riyadh" });
const p00 = punctualityForCheckIn(sched00, new Date(riyadhEarly), zonedDayKeyOf(riyadhEarly, "Asia/Riyadh"));
show("punctuality (00:00 shift, no grace): crossDay/rawLate", { crossDay: p00.crossDayCheckIn, raw: p00.rawLateMinutes, tz: p00.timezone });
const c00 = canonicalLateness({
  nowMs: riyadhEarly,
  schedule: { countableLateMinutes: countableLateMinutes(p00.rawLateMinutes, false), timezone: p00.timezone },
  cutoffTime: "11:30", priorLateOccurrences: 0, lateThreshold: 3,
});
show("canonical for that punch", c00);

console.log("\n--- B. UNSCHEDULED punch at the same instant (documented fallback) ---");
const cUnsched = canonicalLateness({
  nowMs: riyadhEarly, schedule: null, cutoffTime: "00:00", priorLateOccurrences: 0, lateThreshold: 3,
});
show("unscheduled canonical (basis/zone/date/month)", {
  basis: cUnsched.basis, tz: cUnsched.timezone, date: cUnsched.punchDate, month: cUnsched.monthKey, late: cUnsched.lateMinutes,
});
show("UTC-month vs Riyadh-month for the same instant", {
  utcMonth: zonedMonthKeyOf(riyadhEarly, "UTC"),
  riyadhMonth: zonedMonthKeyOf(riyadhEarly, "Asia/Riyadh"),
});

console.log("\n--- C. Cross-day (night) shift 22:00 -> 06:00 Asia/Riyadh ---");
const nightPunch = Date.UTC(2026, 9, 31, 21, 15); // 00:15 Riyadh next day
const nightValues = values({ startTime: "22:00", endTime: "06:00", timezone: "Asia/Riyadh" });
const pn = punctualityForCheckIn(nightValues, new Date(nightPunch), zonedDayKeyOf(nightPunch, "Asia/Riyadh"));
show("night shift punctuality", { crossDay: pn.crossDayCheckIn, raw: pn.rawLateMinutes, dayKeyUsed: zonedDayKeyOf(nightPunch, "Asia/Riyadh") });
const pnProbe = zonedDayKeyOf(nightPunch, FALLBACK_TIMEZONE);
show("two-pass probe: UTC day vs schedule day differ?", { probe: pnProbe, real: zonedDayKeyOf(nightPunch, "Asia/Riyadh"), differs: pnProbe !== zonedDayKeyOf(nightPunch, "Asia/Riyadh") });

console.log("\n--- D. Invalid / missing IANA timezone ---");
show("effectivePunchTimezone('Mars/Olympus)", effectivePunchTimezone("Mars/Olympus"));
show("effectivePunchTimezone('   ') whitespace", effectivePunchTimezone("   "));
show("effectivePunchTimezone('UTC')", effectivePunchTimezone("UTC"));
const badZone = values({ startTime: "09:00", timezone: "Mars/Olympus" });
const pb = punctualityForCheckIn(badZone, new Date(Date.UTC(2026, 9, 31, 7, 0)), zonedDayKeyOf(Date.UTC(2026, 9, 31, 7, 0), "Mars/Olympus"));
show("punch 07:00Z vs 09:00 shift with INVALID zone", { tz: pb.timezone, raw: pb.rawLateMinutes, dayKey: zonedDayKeyOf(Date.UTC(2026, 9, 31, 7, 0), "Mars/Olympus") });
const cb = canonicalLateness({
  nowMs: Date.UTC(2026, 9, 31, 12, 0),
  schedule: { countableLateMinutes: 7, timezone: "Mars/Olympus" },
  cutoffTime: "00:00", priorLateOccurrences: 0, lateThreshold: 3,
});
show("canonical with invalid schedule zone", cb);

console.log("\n--- E. No browser-local leak: same instant, different simulated offsets ---");
// zonedMoment uses Intl with an explicit zone; prove the result is offset-independent
// by computing under two different process TZs.
const instant = Date.UTC(2026, 9, 31, 21, 30);
show(`cutoffLateMinutes in process TZ=${process.env.TZ || "system"}`, {
  utcBasis: cutoffLateMinutes(instant, "00:00", "UTC"),
  riyadhBasis: cutoffLateMinutes(instant, "00:00", "Asia/Riyadh"),
  dayKeyUtc: zonedDayKeyOf(instant, "UTC"),
  dayKeyRiyadh: zonedDayKeyOf(instant, "Asia/Riyadh"),
});

console.log("\n--- F. Deduction/threshold semantics on the canonical path ---");
for (const prior of [0, 1, 2, 3]) {
  const c = canonicalLateness({
    nowMs: Date.UTC(2026, 9, 31, 12, 0), schedule: { countableLateMinutes: 45, timezone: "Asia/Riyadh" },
    cutoffTime: "11:30", priorLateOccurrences: prior, lateThreshold: 3,
  });
  show(`schedule-late 45m with ${prior} prior occurrence(s)`, { late: c.lateMinutes, deducted: c.deductionMinutes, basis: c.basis });
}
const excused = canonicalLateness({
  nowMs: Date.UTC(2026, 9, 31, 12, 0), schedule: { countableLateMinutes: 0, timezone: "Asia/Riyadh" },
  cutoffTime: "00:00", priorLateOccurrences: 5, lateThreshold: 1,
});
show("leave-excused scheduled punch (raw 45 on snapshot, countable 0)", excused);

console.log("\n--- G. Night shift: punch AFTER midnight relative to a 22:00 start ---");
// (a) pre-change behaviour: punch day was the UTC date
const pUtcDay = punctualityForCheckIn(nightValues, new Date(nightPunch), zonedDayKeyOf(nightPunch, FALLBACK_TIMEZONE));
show("(a) OLD basis (UTC punch date 2026-10-31)", { crossDay: pUtcDay.crossDayCheckIn, raw: pUtcDay.rawLateMinutes });
// (b) post-change behaviour: punch day is the schedule-zone date
const pZoneDay = punctualityForCheckIn(nightValues, new Date(nightPunch), zonedDayKeyOf(nightPunch, "Asia/Riyadh"));
show("(b) NEW basis (zoned punch date 2026-11-01)", { crossDay: pZoneDay.crossDayCheckIn, raw: pZoneDay.rawLateMinutes });
// (c) same shape entirely inside UTC (no zone involved) — proves this is not a
// timezone artifact but the anchor comparison of a post-midnight punch.
const nightUtc = values({ startTime: "22:00", endTime: "06:00", timezone: "UTC" });
const pUtcOnly = punctualityForCheckIn(nightUtc, new Date(Date.UTC(2026, 9, 31, 0, 15)), "2026-10-31");
show("(c) UTC night shift, punch 00:15 vs 22:00 start", { crossDay: pUtcOnly.crossDayCheckIn, raw: pUtcOnly.rawLateMinutes });
const cbNight = canonicalLateness({
  nowMs: nightPunch,
  schedule: { countableLateMinutes: countableLateMinutes(pZoneDay.rawLateMinutes, false), timezone: pZoneDay.timezone },
  cutoffTime: "23:59", priorLateOccurrences: 0, lateThreshold: 3,
});
show("canonical row numbers for (b)", cbNight);
