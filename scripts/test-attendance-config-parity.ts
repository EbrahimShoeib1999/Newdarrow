/**
 * captureAttendanceGeo — Office/Remote Check-in Parity Suite
 *
 * Reproduces the confirmed "some employees can check in, others cannot" bug and
 * proves the Bug-2 fix. Root cause: `attendanceCheckMode` defaulted to
 * `geofence`, and a geofence worker with no assigned active work location was
 * HARD-BLOCKED (not_assigned). That silently trapped remote-authorized staff
 * (workType "remote" / allowRemoteTimer) who have no office fence.
 *
 * The fix: a remote-authorized worker is never trapped by the office geofence —
 * they default to flexible capture and, even when left in geofence mode with no
 * assigned location, fall through to best-effort capture instead of throwing.
 *
 * This exercises the real branching in captureAttendanceGeo by monkey-patching
 * PeopleService (a mutable object literal) and stubbing navigator.geolocation —
 * no Firestore needed, because the geofence precondition is evaluated before
 * any GPS call.
 *
 * Run with: npx tsx scripts/test-attendance-config-parity.ts
 */

import { captureAttendanceGeo } from "../src/features/people/utils/attendance-geo-check";
import { PeopleService } from "../src/features/people/api/people.service";
import { AttendanceGeoError } from "../src/features/people/utils/geo";

const results: { name: string; ok: boolean; details?: string }[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ name, ok: false, details: msg });
    console.error(`FAIL: ${name}\n  Error: ${msg}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Service mock ---------------------------------------------------------
const HQ = {
  id: "loc-hq",
  name: "Riyadh HQ",
  lat: 24.7136,
  lng: 46.6753,
  radiusMeters: 150,
  isActive: true,
};

function mockService(employee: Record<string, unknown>, locations: any[] = []) {
  (PeopleService as any).getEmployee = async () => ({ data: employee, message: "ok" });
  (PeopleService as any).getWorkLocations = async () => ({ data: locations, message: "ok" });
}

// --- navigator.geolocation stub -------------------------------------------
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}
function gpsAt(lat: number, lng: number, accuracy = 10) {
  setNavigator({
    geolocation: {
      getCurrentPosition: (success: any) =>
        setTimeout(() => success({ coords: { latitude: lat, longitude: lng, accuracy } }), 0),
    },
  });
}
function gpsFails() {
  // No geolocation -> getCurrentCoordinates rejects "unavailable".
  setNavigator({});
}

async function expectThrowsNotAssigned(label: string) {
  try {
    await captureAttendanceGeo("co-1", "emp-1");
    throw new Error(`${label}: expected a not_assigned throw, but check-in was allowed`);
  } catch (err: any) {
    assert(err instanceof AttendanceGeoError, `${label}: expected AttendanceGeoError, got ${err?.message}`);
    assert(err.code === "not_assigned", `${label}: expected code not_assigned, got ${err.code}`);
  }
}

console.log("=======================================================");
console.log(" D-Arrow — Attendance Config Parity Suite");
console.log("=======================================================\n");

// A. THE FIX PROOF: remote-authorized, no explicit mode, no location.
//    Must NOT be trapped by geofence (best-effort capture, GPS failure ok).
await test("A. Remote-authorized, no mode, no location => NOT blocked (fix)", async () => {
  mockService({ workType: "remote" }, []);
  gpsFails();
  const geo = await captureAttendanceGeo("co-1", "emp-1");
  assert(geo === undefined, "expected flexible best-effort (undefined), not a hard block");
});

// A2. Same but authorized via allowRemoteTimer.
await test("A2. allowRemoteTimer worker, no location, GPS fail => NOT blocked", async () => {
  mockService({ allowRemoteTimer: true }, []);
  gpsFails();
  const geo = await captureAttendanceGeo("co-1", "emp-1");
  assert(geo === undefined, "expected undefined, not a not_assigned throw");
});

// B. Genuine office geofence employee (NOT remote-authorized) with no assigned
//    location MUST still be blocked — correct config enforcement, preserved.
await test("B. Office geofence, no location, not remote => not_assigned (blocked)", async () => {
  mockService({ attendanceCheckMode: "geofence" }, []);
  gpsAt(24.7136, 46.6753);
  await expectThrowsNotAssigned("office-unassigned");
});

// B2. Remote-authorized even when EXPLICITLY geofence but no fence exists:
//     not trapped; falls through to best-effort.
await test("B2. Remote-authorized + explicit geofence + no location => NOT blocked", async () => {
  mockService({ attendanceCheckMode: "geofence", workType: "remote" }, []);
  gpsFails();
  const geo = await captureAttendanceGeo("co-1", "emp-1");
  assert(geo === undefined, "expected best-effort undefined, not a hard block");
});

// C. Office geofence with an assigned active location, inside radius => allowed.
await test("C. Office geofence, assigned location, inside radius => payload", async () => {
  mockService({ attendanceCheckMode: "geofence", attendanceLocationIds: [HQ.id] }, [HQ]);
  gpsAt(24.7136, 46.6753); // at HQ
  const geo = await captureAttendanceGeo("co-1", "emp-1");
  assert(geo !== undefined, "expected a geo payload for an in-range check-in");
  assert(geo!.locationId === HQ.id, `expected matched ${HQ.id}, got ${geo!.locationId}`);
});

// D. Office geofence, assigned location, OUTSIDE radius => blocked (correct).
await test("D. Office geofence, assigned location, outside radius => outside (blocked)", async () => {
  mockService({ attendanceCheckMode: "geofence", attendanceLocationIds: [HQ.id] }, [HQ]);
  gpsAt(25.5, 46.0); // ~far away
  try {
    await captureAttendanceGeo("co-1", "emp-1");
    throw new Error("expected an outside throw");
  } catch (err: any) {
    assert(err instanceof AttendanceGeoError, `expected AttendanceGeoError, got ${err?.message}`);
    assert(err.code === "outside", `expected code outside, got ${err.code}`);
  }
});

// E. Explicit flexible worker with GPS failure => allowed (undefined), never blocked.
await test("E. Explicit flexible, GPS fail => payload undefined (not blocked)", async () => {
  mockService({ attendanceCheckMode: "flexible" }, []);
  gpsFails();
  const geo = await captureAttendanceGeo("co-1", "emp-1");
  assert(geo === undefined, "flexible + GPS fail must yield undefined, not a throw");
});

// Summary
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log("\n=======================================================");
console.log(` Summary: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ""}`);
console.log("=======================================================\n");
if (failed > 0) process.exit(1);
