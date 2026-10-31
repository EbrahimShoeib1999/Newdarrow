/**
 * Firestore Emulator integration for BUG 2 — attendance check-in write path
 * across employee configurations (mission 2.x).
 * Run with: npm run test:attendance-config-parity
 *
 * The CLIENT geofence decision (captureAttendanceGeo) is proven separately by
 * scripts/test-attendance-config-parity.ts (tsx unit). That is NOT enough on
 * its own: this suite runs the ACTUAL server write path against the emulator
 * with rules ENFORCED for each of the three configurations that the check-in
 * screen produces, and shows what Firestore really accepts:
 *
 *   • Office employee  — geofence mode + an ASSIGNED work location, in range →
 *     punches the full geofence payload (lat/lng/locationId/distance/location).
 *   • Remote/flexible  — flexible mode, working GPS but NO configured location
 *     → payload carries coords only; the optional location keys are pruned.
 *   • Geofence w/o an ASSIGNED location — the client gate is what blocks this
 *     employee (mission 2 fix); here we prove the SERVER is NOT the blocker:
 *     the same punch, if it reaches Firestore, is authorized and written.
 *
 * Every config also mirrors PeopleService.checkIn's real sequence:
 *   employees query (syncWithDb) → settings/attendance GET → attendance
 *   where-date GET → addDoc(attendance, payload) → update own employee status.
 * And the ownership boundary is checked negatively: a member may open a
 * session ONLY for their OWN employee record.
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

const COMPANY = "acme-co";
const results = [];

process.on("unhandledRejection", (err) => {
  const msg = err?.message ?? String(err);
  if (err?.code === "permission-denied") {
    console.log(`NOTE: suppressed duplicate async rejection: ${msg.replace(/\s+/g, " ").slice(0, 120)}`);
    return;
  }
  console.error("UNEXPECTED unhandled rejection:", msg);
  process.exit(1);
});

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
    console.log(`FAIL: ${name} — ${err?.message ?? String(err)}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "attendance-parity-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

// SETUP only (rules bypassed). The company, a work location (the geofence
// anchor the office config resolves against), and three employees each bound to
// a real account. The only field that varies is the attendance configuration —
// the tenant membership (users.companyId) is identical, because ownership is
// what the write path keys on, not the geofence mode.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "companies", COMPANY), { id: COMPANY, name: "Acme Solutions", defaultCurrency: "SAR" });
  // The office HQ the geofence resolves against (work_locations is a generic
  // member-readable subcollection — see the fallback rule).
  await setDoc(doc(db, "companies", COMPANY, "work_locations", "hq"), {
    name: "Riyadh HQ", latitude: 24.7136, longitude: 46.6753, radiusMeters: 150,
  });

  const mk = (uid, empId, extra) => {
    return (async () => {
      await setDoc(doc(db, "users", uid), {
        id: uid, email: `${uid}@acme.test`, name: uid, role: "employee", companyId: COMPANY,
      });
      await setDoc(doc(db, "companies", COMPANY, "employees", empId), {
        firstName: "Emp", lastName: empId, email: `${uid}@acme.test`, userId: uid,
        shiftStatus: "off-duty", ...extra,
      });
    })();
  };

  // Office: geofence mode with an ASSIGNED location.
  await mk("office-uid", "emp-office", {
    attendanceCheckMode: "geofence",
    attendanceLocationIds: ["hq"],
  });
  // Remote/flexible: flexible mode, remote timer allowed, NO location.
  await mk("remote-uid", "emp-remote", {
    workType: "remote",
    attendanceCheckMode: "flexible",
    allowRemoteTimer: true,
  });
  // Geofence mode but WITHOUT an assigned location — the mission-2 client gate.
  await mk("unassigned-uid", "emp-unassigned", {
    attendanceCheckMode: "geofence",
    attendanceLocationIds: [],
  });
});

const today = new Date().toISOString().split("T")[0];

// buildCheckInGeoFields shapes for each config (the optional location keys are
// pruned when undefined, exactly as the service does before the write).
const officeGeoPayload = {
  checkInLat: 24.714, checkInLng: 46.676,
  checkInLocationId: "hq", checkInDistanceMeters: 42, location: "Riyadh HQ",
};
const remoteGeoPayload = { checkInLat: 24.7, checkInLng: 46.68, location: "Home" };
const unassignedGeoPayload = { checkInLat: 24.7, checkInLng: 46.68, location: "Field" };

/**
 * Runs the EXACT sequence PeopleService.checkIn performs, for `uid`'s own
 * employee record, writing `geoFields`. Asserts every step is authorized.
 */
async function runCheckInPath(uid, empId, geoFields) {
  const firestore = testEnv.authenticatedContext(uid).firestore();
  const attendanceCol = collection(firestore, "companies", COMPANY, "attendance");
  let step = "start";
  try {
  // syncWithDb: the employee's own record via the exact where userId==uid query
  // PeopleService/AttendanceStore run on session start (generic member read).
  step = "employees-list";
  await assertSucceeds(getDocs(query(collection(firestore, "companies", COMPANY, "employees"), where("userId", "==", uid))));
  // getWorkLocations: the geofence anchor list (generic member read) — proves
  // the server exposes locations to every member; an empty assignment is a
  // CLIENT decision, not a read restriction.
  step = "work-locations-list";
  await assertSucceeds(getDocs(collection(firestore, "companies", COMPANY, "work_locations")));
  // getAttendanceLatePolicy: settings/attendance GET (member read).
  step = "settings-get";
  await assertSucceeds(getDoc(doc(firestore, "companies", COMPANY, "settings", "attendance")));
  // Idempotency probe: today's attendance LIST (member read).
  step = "attendance-date-list";
  await assertSucceeds(getDocs(query(attendanceCol, where("date", "==", today))));
  // addDoc: the punch itself, stamped with the author's uid (ownership key).
  step = "attendance-addDoc";
  await assertSucceeds(
    addDoc(attendanceCol, {
      employeeId: empId,
      date: today,
      checkIn: serverTimestamp(),
      status: "present",
      lateMinutes: 0,
      deductionMinutes: 0,
      createdAt: serverTimestamp(),
      userId: uid,
      ...geoFields,
    })
  );
  // Global status update on the employee's OWN record (generic member update).
  step = "employee-status-update";
  await assertSucceeds(
    updateDoc(doc(firestore, "companies", COMPANY, "employees", empId), {
      shiftStatus: "working",
      updatedAt: serverTimestamp(),
    })
  );
  } catch (e) {
    throw new Error(`step=${step} uid=${uid}: ${e?.message ?? String(e)}`);
  }
}

const label = { office: "office", remote: "remote", unassigned: "unassigned" };

// ---------- 1. Office employee: geofence payload written through the server.
await check(`[${label.office}] office check-in writes full geofence payload on the server`, () =>
  runCheckInPath("office-uid", "emp-office", officeGeoPayload)
);

// ---------- 2. Remote/flexible: coords-only payload written through the server.
await check(`[${label.remote}] remote/flexible check-in writes coords-only payload on the server`, () =>
  runCheckInPath("remote-uid", "emp-remote", remoteGeoPayload)
);

// ---------- 3. Geofence WITHOUT assigned location: the server is NOT the gate.
// The mission-2 fix makes this employee's CLIENT gate the thing that decides
// whether a geofence punch is allowed. This proves that if/when the client
// produces a punch, Firestore authorizes it exactly like any other member's —
// i.e. the previous "cannot check in" was never a permissions problem.
await check(`[${label.unassigned}] geofence-without-location punch is authorized by the SERVER (blocker is client-side)`, () =>
  runCheckInPath("unassigned-uid", "emp-unassigned", unassignedGeoPayload)
);

// ---------- 4. The punch is persisted and readable back (real round-trip).
await check("office punch is queryable back with its geofence fields intact", async () => {
  const firestore = testEnv.authenticatedContext("office-uid").firestore();
  const snap = await assertSucceeds(
    getDocs(query(collection(firestore, "companies", COMPANY, "attendance"), where("employeeId", "==", "emp-office")))
  );
  const mine = snap.docs.map((d) => d.data());
  const punched = mine.find((r) => r.checkInLocationId === "hq");
  if (!punched) throw new Error("office geofence punch not found after write");
  if (punched.userId !== "office-uid") throw new Error("punch did not persist the author uid");
});

// ---------- 5. Ownership boundary (negative): a member cannot forge a punch
// attributed to ANOTHER account. isMyAttendance keys on the punch's author
// `userId` (or the subject employee's linked uid), so stamping someone else's
// uid is denied — this is the security line the fix must not cross.
await check("SEC: a member CANNOT create an attendance punch attributed to another account", async () => {
  const firestore = testEnv.authenticatedContext("office-uid").firestore();
  await assertFails(
    addDoc(collection(firestore, "companies", COMPANY, "attendance"), {
      employeeId: "emp-remote",
      date: today,
      checkIn: serverTimestamp(),
      status: "present",
      lateMinutes: 0,
      deductionMinutes: 0,
      createdAt: serverTimestamp(),
      userId: "remote-uid", // forged author — neither self nor the caller's link
    })
  );
});

// ---------- 6. A punch with NO author stamp is denied (fails closed).
await check("SEC: a punch with no author stamp AND a non-linked employee is denied", async () => {
  const firestore = testEnv.authenticatedContext("office-uid").firestore();
  await assertFails(
    addDoc(collection(firestore, "companies", COMPANY, "attendance"), {
      employeeId: "emp-unassigned", // not linked to office-uid
      date: today,
      checkIn: serverTimestamp(),
      status: "present",
      createdAt: serverTimestamp(),
      // userId omitted → neither isMyAttendance branch holds
    })
  );
});

console.log("\n========== attendance config parity (firestore write) results ==========");
for (const r of results) console.log(`${r.ok ? "✓ PASS" : "✗ FAIL"}: ${r.name}${r.err ? ` — ${r.err}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} checks passed`);
await testEnv.cleanup().catch(() => {});
process.exit(failed ? 1 : 0);
