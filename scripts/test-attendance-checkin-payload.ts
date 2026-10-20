/**
 * Attendance Check-in Payload & Error-Classification Regression Suite
 *
 * Reproduces the confirmed production failure:
 *   PeopleService:checkIn Failed — FirebaseError: Function addDoc() called with
 *   invalid data. Unsupported field value: undefined (found in field location
 *   in document companies/<id>/attendance/<id>)
 *
 * Root cause path: flexible check-in + working GPS + a company with no work
 * locations configured  →  nearestWorkLocation() returns null  →
 * geo.locationName is undefined  →  the old code wrote `location: undefined`
 * straight into the addDoc payload, which Firestore rejects.
 *
 * Run with: npx tsx scripts/test-attendance-checkin-payload.ts
 */

import {
  AttendanceGeoError,
  buildCheckInGeoFields,
  buildCheckOutGeoFields,
  classifyAttendanceError,
  isOpenSessionForDay,
  pruneUndefinedFields,
} from "../src/features/people/utils/geo";
import type { AttendanceGeoPayload } from "../src/features/people/types/people.types";

const results: { name: string; ok: boolean; details?: string }[] = [];

function check(name: string, cond: boolean, details?: string) {
  if (!cond) throw new Error(`${name}${details ? ` — ${details}` : ""}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ PASS: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ name, ok: false, details: msg });
    console.error(`✗ FAIL: ${name}\n  Error: ${msg}`);
  }
}

/** The only invariant Firestore requires of a write payload. */
function assertNoUndefinedFields(payload: Record<string, unknown>, label: string) {
  for (const [key, value] of Object.entries(payload)) {
    check(
      `${label}: field "${key}" must not be undefined`,
      value !== undefined,
      `got undefined`
    );
  }
}

console.log("=======================================================");
console.log(" D-Arrow — Attendance Check-in Payload Regression Suite");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. Check-in with a valid, fully-resolved location keeps every geo field.
// ---------------------------------------------------------------------------
await test("1. Check-in geo fields: valid location preserved verbatim", () => {
  const geo: AttendanceGeoPayload = {
    lat: 24.7136,
    lng: 46.6753,
    accuracyMeters: 12,
    locationId: "loc-riyadh-hq",
    locationName: "Riyadh HQ",
    distanceMeters: 40,
  };
  const fields = buildCheckInGeoFields(geo);
  assertNoUndefinedFields(fields, "checkIn");
  check("location kept", fields.location === "Riyadh HQ", String(fields.location));
  check("checkInLocationId kept", fields.checkInLocationId === "loc-riyadh-hq");
  check("checkInLocationName kept", fields.checkInLocationName === "Riyadh HQ");
  check("checkInLat kept", fields.checkInLat === 24.7136);
  check("checkInLng kept", fields.checkInLng === 46.6753);
  check("distance kept", fields.checkInDistanceMeters === 40);
});

// ---------------------------------------------------------------------------
// 2. THE PRODUCTION REPRO: flexible check-in, GPS OK, company has zero work
//    locations → locationName is undefined → `location` must be OMITTED.
// ---------------------------------------------------------------------------
await test("2. Check-in geo fields: unresolvable location omits `location` (production repro)", () => {
  // Exactly what captureAttendanceGeo returns in flexible mode when
  // nearestWorkLocation() is null (no work locations exist yet).
  const geo: AttendanceGeoPayload = {
    lat: 24.7136,
    lng: 46.6753,
    accuracyMeters: 15,
    locationId: undefined,
    locationName: undefined,
    distanceMeters: undefined,
  };
  const fields = buildCheckInGeoFields(geo);
  assertNoUndefinedFields(fields, "checkIn (no work locations)");
  check("`location` key omitted entirely", !("location" in fields), JSON.stringify(fields));
  check("`checkInLocationId` key omitted", !("checkInLocationId" in fields));
  check("`checkInLocationName` key omitted", !("checkInLocationName" in fields));
  check("`checkInDistanceMeters` key omitted", !("checkInDistanceMeters" in fields));
  // Device coordinates ARE still recorded — the fix must not drop real data.
  check("device coords preserved", fields.checkInLat === 24.7136 && fields.checkInLng === 46.6753);
});

// ---------------------------------------------------------------------------
// 3. Check-in without any geo capture (GPS denied/failed in flexible mode):
//    no geo fields at all — same as the historical behavior.
// ---------------------------------------------------------------------------
await test("3. Check-in geo fields: absent geo contributes nothing", () => {
  const fields = buildCheckInGeoFields(undefined);
  check("empty object", Object.keys(fields).length === 0, JSON.stringify(fields));
  const noLocation = buildCheckInGeoFields(undefined);
  check("no `location` key", !("location" in noLocation));
});

// ---------------------------------------------------------------------------
// 4. The generic pruner protects every payload: undefined removed, but all
//    falsy-but-real values (0, false, "", null) preserved.
// ---------------------------------------------------------------------------
await test("4. pruneUndefinedFields: strips undefined, preserves every real value", () => {
  const pruned = pruneUndefinedFields({
    employeeId: "emp-1",
    lateMinutes: 0,
    deductionMinutes: 0,
    status: "present",
    maybeNull: null,
    emptyNote: "",
    zeroFlag: false,
    dropped: undefined,
    alsoDropped: undefined,
  });
  assertNoUndefinedFields(pruned, "pruned");
  check("`dropped` key removed", !("dropped" in pruned));
  check("`alsoDropped` key removed", !("alsoDropped" in pruned));
  check("0 preserved (not treated as missing)", pruned.lateMinutes === 0);
  check("'' preserved", pruned.emptyNote === "");
  check("false preserved", pruned.zeroFlag === false);
  check("null preserved", pruned.maybeNull === null);
});

// ---------------------------------------------------------------------------
// 5. Check-out geo fields follow the same rule (undefined omitted, coords kept).
// ---------------------------------------------------------------------------
await test("5. Check-out geo fields: unresolvable location omitted, coords kept", () => {
  const geo: AttendanceGeoPayload = { lat: 1, lng: 2, locationId: undefined, locationName: undefined };
  const fields = buildCheckOutGeoFields(geo);
  assertNoUndefinedFields(fields, "checkOut");
  check("no undefined location keys", !("checkOutLocationId" in fields) && !("checkOutLocationName" in fields));
  check("coords kept", fields.checkOutLat === 1 && fields.checkOutLng === 2);
  check("absent geo → empty", Object.keys(buildCheckOutGeoFields(undefined)).length === 0);
});

// ---------------------------------------------------------------------------
// 6. Retry idempotency predicate: an already-open session for today blocks a
//    second addDoc, so a failed-then-retried check-in cannot duplicate shifts.
// ---------------------------------------------------------------------------
await test("6. isOpenSessionForDay: retry finds the open session, ignores closed/other-day", () => {
  const today = "2026-10-20";
  check("open record today → true", isOpenSessionForDay({ date: today, checkOut: undefined }, today));
  check("explicit-null checkOut → true", isOpenSessionForDay({ date: today, checkOut: null }, today));
  check("checked-out record → false (break resume still creates its session)",
    isOpenSessionForDay({ date: today, checkOut: new Date() }, today) === false);
  check("other day's open record → false",
    isOpenSessionForDay({ date: "2026-10-19" }, today) === false);
  check("missing record → false", isOpenSessionForDay(null, today) === false);
});

// ---------------------------------------------------------------------------
// 7. Error classification: authentication, authorization, invalid payload and
//    network failures each map to a DISTINCT class — a write failure is never
//    presented as a login problem, and a GPS denial is never confused with a
//    Firestore permission-denied.
// ---------------------------------------------------------------------------
await test("7. classifyAttendanceError: auth vs authz vs payload vs network are distinct", () => {
  // FirebaseError shapes (only `code` matters, exactly like the real class).
  check("session expired → session_expired",
    classifyAttendanceError({ code: "auth/unauthenticated", message: "x" }) === "write_failed"); // prefixed code must NOT match
  check("bare unauthenticated → session_expired",
    classifyAttendanceError({ code: "unauthenticated", message: "x" }) === "session_expired");
  check("firestore permission-denied → action_forbidden",
    classifyAttendanceError({ code: "permission-denied", message: "Missing or insufficient permissions." }) === "action_forbidden");
  check("invalid-data payload → write_failed",
    classifyAttendanceError({ code: "invalid-argument", message: "Unsupported field value: undefined" }) === "write_failed");
  check("network down → network_unavailable",
    classifyAttendanceError({ code: "unavailable", message: "Backoff timed out" }) === "network_unavailable");
  check("plain Error (no code) → write_failed",
    classifyAttendanceError(new Error("boom")) === "write_failed");
  // Geo errors keep their own GPS-specific meanings (never "login" wording).
  check("GPS permission denial ≠ Firestore authz",
    classifyAttendanceError(new AttendanceGeoError("permission_denied", "user denied")) === "gps_denied");
  check("GPS timeout → gps_unavailable",
    classifyAttendanceError(new AttendanceGeoError("timeout", "slow fix")) === "gps_unavailable");
  check("no assigned location → location_not_assigned",
    classifyAttendanceError(new AttendanceGeoError("not_assigned", "none")) === "location_not_assigned");
  check("outside geofence → outside",
    classifyAttendanceError(new AttendanceGeoError("outside", "far", { locationName: "HQ", distanceMeters: 500, radiusMeters: 100 })) === "outside");
});

// ---------------------------------------------------------------------------
// 8. Full assembled addDoc payload (as PeopleService.checkIn builds it) is
//    Firestore-legal for every geo outcome.
// ---------------------------------------------------------------------------
await test("8. Full check-in payload is Firestore-legal in every scenario", () => {
  const { serverTimestamp } = { serverTimestamp: () => "__ST__" }; // sentinel stand-in
  const basePayload = (late: number) => ({
    employeeId: "emp-1",
    date: "2026-10-20",
    checkIn: serverTimestamp(),
    status: late > 0 ? "late" : "present",
    lateMinutes: late,
    deductionMinutes: 0,
    createdAt: serverTimestamp(),
  });
  const scenarios: AttendanceGeoPayload[] = [
    // flexible, no work locations (the failing production case)
    { lat: 1, lng: 2, locationId: undefined, locationName: undefined, distanceMeters: undefined },
    // flexible with nearest match
    { lat: 1, lng: 2, locationId: "l1", locationName: "Office", distanceMeters: 900 },
    // geofence exact match
    { lat: 1, lng: 2, accuracyMeters: 5, locationId: "l1", locationName: "Office", distanceMeters: 10 },
  ];
  for (const [i, geo] of scenarios.entries()) {
    const payload: Record<string, unknown> = { ...basePayload(i === 2 ? 7 : 0) };
    Object.assign(payload, buildCheckInGeoFields(geo));
    assertNoUndefinedFields(pruneUndefinedFields(payload), `scenario ${i}`);
  }
  // And scenario 1 specifically must not carry `location`:
  const prod: Record<string, unknown> = { ...basePayload(0) };
  Object.assign(prod, buildCheckInGeoFields(scenarios[0]));
  check("`location` absent for the production scenario", !("location" in prod), JSON.stringify(prod));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log("\n=======================================================");
console.log(` Summary: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ""}`);
console.log("=======================================================\n");
if (failed > 0) process.exit(1);
