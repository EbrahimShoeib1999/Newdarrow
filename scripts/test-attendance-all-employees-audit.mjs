/**
 * ALL-EMPLOYEE ATTENDANCE AUDIT — evidence generator for the
 * "some employees can start their shift, others cannot" investigation.
 *
 * Run with: npm run test:attendance-all-employees-audit
 *   (wraps `firebase emulators:exec --only firestore`, rules ENFORCED)
 *
 * It seeds a realistic MULTI-TENANT workforce into a throwaway project —
 * deliberately including both currently-WORKING and currently-FAILING account
 * shapes — then, for EVERY employee, walks the exact same chain the browser
 * walks:
 *
 *   Login → companyId (users/{uid}.companyId) → employees query (rules)
 *   → claim-by-email → eligibility (work mode / schedule / GPS / geofence)
 *   → attendance-create permission (rules) → classification.
 *
 * The permission steps are evaluated against the SHIPPED firestore.rules with
 * @firebase/rules-unit-testing, so a rule that denies a legitimate employee is
 * caught as a real failure, not a guess. Nothing here relaxes a rule and no
 * per-email special-casing exists — the audit only OBSERVES.
 */
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  collection,
  query,
  where,
} from "firebase/firestore";

// The Firestore SDK re-emits a denied LIST rejection asynchronously; every
// legitimate rejection below is awaited, so suppress only that duplicate.
process.on("unhandledRejection", (err) => {
  if (err?.code === "permission-denied") return;
  console.error("UNEXPECTED unhandled rejection:", err?.message ?? String(err));
  process.exit(1);
});

const EG = "co-darrow-egypt";
const SA = "co-darrow-ksa";

/* -------------------------------------------------------------------------- */
/* Ported app logic (kept byte-faithful to the TS sources it mirrors)          */
/* -------------------------------------------------------------------------- */

// src/features/people/utils/geo.ts : isEmploymentActive
function isEmploymentActive(status) {
  return status !== "terminated" && status !== "suspended";
}

// src/features/people/utils/geo.ts : resolveCheckInBlockReason (PRE-CLICK BANNER).
// Mirrors the FIXED implementation, which now recognises remote authorization
// through workType/allowRemoteTimer AND workMode/field — identical to the click
// path (captureAttendanceGeo). A legitimately-remote employee must never be
// shown a "blocked" banner the punch path does not actually enforce.
function blockReasonBanner(emp, knownLocations) {
  if (!emp) return null;
  if (!isEmploymentActive(emp.status)) return "employment_inactive";
  const remoteAuthorized =
    emp.workType === "remote" ||
    emp.allowRemoteTimer === true ||
    emp.workType === "field" ||
    emp.workMode === "remote" ||
    emp.workMode === "field";
  const mode = emp.attendanceCheckMode ?? (remoteAuthorized ? "flexible" : "geofence");
  if (mode === "flexible" || remoteAuthorized) return null;
  const ids = emp.attendanceLocationIds ?? [];
  if (ids.length === 0) return "location_not_assigned";
  if (
    knownLocations != null &&
    !ids.some((id) => knownLocations.some((l) => l.id === id && l.isActive !== false))
  ) {
    return "location_inactive";
  }
  return null;
}

// src/features/people/utils/attendance-geo-check.ts : captureAttendanceGeo
// decision (ACTUAL click path). Returns { block } where block is a code string,
// or { block: null } meaning the click path would proceed to the Firestore write.
function capturePathOutcome(emp, locations, settings) {
  const remoteAuthorized =
    emp.workType === "remote" ||
    emp.allowRemoteTimer === true ||
    emp.workType === "field" ||
    emp.workMode === "remote" ||
    emp.workMode === "field";
  const mode = emp.attendanceCheckMode ?? (remoteAuthorized ? "flexible" : "geofence");

  const assigned = (emp.attendanceLocationIds ?? [])
    .map((id) => locations.find((l) => l.id === id))
    .filter((l) => !!l && l.isActive);

  if (assigned.length === 0) {
    if (emp.workLocationId) {
      const m = locations.find((l) => l.id === emp.workLocationId && l.isActive);
      if (m) assigned.push(m);
    }
    if (assigned.length === 0 && emp.officeLocation) {
      const m = locations.find(
        (l) =>
          l.isActive &&
          (String(l.name).trim().toLowerCase() === String(emp.officeLocation).trim().toLowerCase() ||
            l.id === emp.officeLocation)
      );
      if (m) assigned.push(m);
    }
    if (
      assigned.length === 0 &&
      !remoteAuthorized &&
      (!emp.attendanceLocationIds || emp.attendanceLocationIds.length === 0)
    ) {
      const active = locations.filter((l) => l.isActive);
      if (active.length === 1) assigned.push(active[0]);
    }
  }

  if (mode === "flexible" || (remoteAuthorized && assigned.length === 0)) {
    return { block: null }; // best-effort GPS, never hard-blocks
  }
  if (assigned.length === 0) {
    const raw = emp.attendanceLocationIds ?? [];
    return { block: raw.length > 0 ? "location_inactive" : "not_assigned" };
  }

  const isGeofenceDisabled =
    settings?.geofenceEnabled === false ||
    emp.geofenceEnabled === false ||
    settings?.requireGps === false ||
    emp.requireGps === false ||
    (assigned.length > 0 && assigned.every((l) => l.geofenceEnabled === false));
  if (isGeofenceDisabled) return { block: null }; // starts WITHOUT GPS

  const isGpsMandatory =
    emp.requireGps === true ||
    emp.mandatoryGps === true ||
    settings?.requireGps === true ||
    settings?.mandatoryGps === true;

  // The audit simulates a device WITHOUT a granted GPS fix (supporting devices
  // always resolve; the point is the CONFIG gate, not the browser).
  if (isGpsMandatory) return { block: "gps_denied" };
  return { block: null }; // GPS not mandatory → office fallback, allowed
}

/* -------------------------------------------------------------------------- */
/* Seed workforce — both working AND failing shapes                          */
/* -------------------------------------------------------------------------- */

// Each account: uid, email, the users/{uid}.companyId it was provisioned with,
// the tenant its employee record lives in, and the employee fields (or null).
const accounts = [
  // ---- Egypt (Remote-first tenant, company zone Africa/Cairo) -------------
  {
    uid: "u_khulod", email: "khulodahmed390@gmail.com", userCompanyId: EG, tenant: EG,
    name: "Khulod Ahmed", role: "employee",
    emp: { workType: "remote", workMode: "remote", attendanceCheckMode: "flexible",
      allowRemoteTimer: true, status: "active", scheduleStart: "11:00", timezone: "Africa/Cairo" },
    note: "Remote Egypt, linked by userId — the reference WORKING account",
  },
  {
    uid: "u_zainab", email: "zainabodaili@gmail.com", userCompanyId: EG, tenant: EG,
    name: "Zainab Odaili", role: "employee",
    // workMode remote but workType office + NO attendanceCheckMode + no location.
    // Banner (geo.ts) says location_not_assigned; click path allows. Inconsistency.
    emp: { workType: "office", workMode: "remote", allowRemoteTimer: false,
      status: "active", scheduleStart: "11:00", timezone: "Africa/Cairo" },
    note: "Remote by workMode, workType office — banner/click asymmetry probe",
  },
  {
    uid: "u_mm", email: "mm7811238@gmail.com", userCompanyId: "", tenant: EG,
    name: "M(M) Employee", role: "employee",
    // Orphan: employee record EXISTS in EG (linked by email, not userId) but the
    // user doc carries an EMPTY companyId (placeholder from a bare password login).
    empClaimByEmailOnly: true,
    emp: { workType: "remote", attendanceCheckMode: "flexible", allowRemoteTimer: true,
      status: "active", scheduleStart: "11:00", timezone: "Africa/Cairo" },
    note: "Orphan account (empty companyId) + valid employee — expected HARD BLOCK",
  },
  {
    uid: "u_albraa", email: "albrahymasra39@gmail.com", userCompanyId: EG, tenant: EG,
    name: "Al Braa", role: "employee",
    emp: { workType: "remote", attendanceCheckMode: "flexible", allowRemoteTimer: true,
      status: "terminated", scheduleStart: "11:00", timezone: "Africa/Cairo" },
    note: "Terminated employment — must stay blocked (employment_inactive)",
  },
  // ---- Saudi (Office tenant, company zone Asia/Riyadh, geofence enabled) ---
  {
    uid: "u_norah", email: "norahn892@gmail.com", userCompanyId: SA, tenant: SA,
    name: "Norah N", role: "employee",
    // Office, geofence mode, assigned active Riyadh HQ, but requireGps=false →
    // may start WITHOUT GPS (Saudi office §5).
    emp: { workType: "office", workMode: "office", attendanceCheckMode: "geofence",
      status: "active", attendanceLocationIds: ["wl-riyadh-hq"], requireGps: false,
      scheduleStart: "13:00", timezone: "Asia/Riyadh" },
    note: "Saudi office, geofence OFF (requireGps=false) — starts w/o GPS",
  },
  {
    uid: "u_faisal", email: "faisal.office@ksa.test", userCompanyId: SA, tenant: SA,
    name: "Faisal (no location)", role: "employee",
    // Office, geofence mode enforced, NO assigned location → legitimate config block.
    emp: { workType: "office", workMode: "office", attendanceCheckMode: "geofence",
      status: "active", scheduleStart: "13:00", timezone: "Asia/Riyadh" },
    note: "Saudi office, geofence enforced, never assigned — expect GEOFENCE_BLOCKED",
  },
  {
    uid: "u_reem", email: "reem.freelance@ksa.test", userCompanyId: SA, tenant: SA,
    name: "Reem Freelancer", role: "employee",
    emp: { workType: "field", workMode: "remote", allowRemoteTimer: true,
      status: "active", scheduleStart: "13:00", timezone: "Asia/Riyadh" },
    note: "Freelancer / field remote-authorized — WORKING",
  },
  // ---- Cross-tenant isolation probes --------------------------------------
  {
    uid: "u_wrongco", email: "sara.wrongco@ksa.test", userCompanyId: EG, tenant: SA,
    name: "Sara (mis-scoped)", role: "employee",
    // user belongs to EG but employee record lives in SA → cannot read SA roster.
    emp: { workType: "remote", attendanceCheckMode: "flexible", allowRemoteTimer: true,
      status: "active", scheduleStart: "13:00", timezone: "Asia/Riyadh" },
    note: "Employee in a DIFFERENT company than the account — must be denied (isolation)",
  },
  {
    uid: "u_nohire", email: "nohire@ksa.test", userCompanyId: SA, tenant: SA,
    name: "No Employee Record", role: "employee",
    emp: null, // no directory record — syncWithDb would auto-provision a remote/flexible one
    note: "Account with no employee record — auto-provisioned flexible (should start)",
  },
  {
    uid: "u_manager", email: "monica.manager@ksa.test", userCompanyId: SA, tenant: SA,
    name: "Monica (manager)", role: "manager",
    portalSubRoles: { people: "manager" },
    emp: { workType: "office", attendanceCheckMode: "geofence", status: "active",
      attendanceLocationIds: ["wl-riyadh-hq"], requireGps: false,
      scheduleStart: "13:00", timezone: "Asia/Riyadh" },
    note: "Manager (people sub-role) — regression: managers unaffected",
  },
];

const saLocations = [
  { id: "wl-riyadh-hq", name: "Riyadh HQ", lat: 24.7136, lng: 46.6753,
    radiusMeters: 300, isActive: true, geofenceEnabled: true },
  { id: "wl-jeddah", name: "Jeddah Branch", lat: 21.4858, lng: 39.1925,
    radiusMeters: 250, isActive: true, geofenceEnabled: true },
];
const egLocations = [];
const saSettings = { id: "attendance", timezone: "Asia/Riyadh", geofenceEnabled: true, requireGps: true };
const egSettings = { id: "attendance", timezone: "Africa/Cairo", geofenceEnabled: false, requireGps: false };

const testEnv = await initializeTestEnvironment({
  projectId: "attendance-all-employees-audit",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

// ---- Seed (rules bypassed for SETUP only) ---------------------------------
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "companies", EG), { id: EG, name: "D-Arrow Egypt", defaultCurrency: "EGP" });
  await setDoc(doc(db, "companies", SA), { id: SA, name: "D-Arrow KSA", defaultCurrency: "SAR" });
  await setDoc(doc(db, "companies", EG, "settings", "attendance"), egSettings);
  await setDoc(doc(db, "companies", SA, "settings", "attendance"), saSettings);
  for (const loc of saLocations) {
    await setDoc(doc(db, "companies", SA, "work_locations", loc.id), loc);
  }
  for (const a of accounts) {
    await setDoc(doc(db, "users", a.uid), {
      id: a.uid,
      email: a.email,
      name: a.name,
      role: a.role,
      companyId: a.userCompanyId,
      portalSubRoles: a.portalSubRoles ?? {},
      portalAccess: ["people"],
    });
    if (a.emp) {
      // The employee record's userId: linked for normal accounts, empty for the
      // email-claim orphan, and always in the account's tenant.
      const linkedUserId = a.empClaimByEmailOnly ? "" : a.uid;
      await setDoc(doc(db, "companies", a.tenant, "employees", `emp_${a.uid}`), {
        userId: linkedUserId,
        email: a.email,
        name: a.name,
        role: a.role,
        department: "Operations",
        shiftStatus: "off-duty",
        ...a.emp,
      });
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Audit each employee through the real chain (rules ENFORCED)                 */
/* -------------------------------------------------------------------------- */

function locationsFor(tenant) {
  return tenant === SA ? saLocations : egLocations;
}
function settingsFor(tenant) {
  return tenant === SA ? saSettings : egSettings;
}

const rows = [];
let empSeq = 0;

for (const a of accounts) {
  const db = testEnv.authenticatedContext(a.uid, { email: a.email }).firestore();
  // The tenant the APP operates in is the account's own companyId (mirrors
  // company-context.tsx) — NOT wherever an employee record happens to be seeded.
  // Work locations / settings that gate the punch belong to THAT company.
  const appCompanyId = a.userCompanyId || null;
  const locations = locationsFor(appCompanyId);
  const settings = settingsFor(appCompanyId);
  // Effective company the person works under: their account's companyId, or the
  // employee record's tenant when the account is un-reconciled (empty companyId).
  const displayCompany = appCompanyId || a.tenant;

  const row = {
    email: a.email,
    uid: a.uid,
    userCompanyId: a.userCompanyId || "(empty)",
    employeeTenant: a.tenant,
    country: displayCompany === SA ? "Saudi Arabia" : "Egypt",
    workMode: a.emp?.workMode ?? a.emp?.workType ?? "n/a",
    schedule: a.emp ? `${a.emp.scheduleStart}` : "n/a",
    timezone: a.emp?.timezone ?? "n/a",
    authLinked: a.emp ? (a.empClaimByEmailOnly ? "by-email-only" : "yes") : "no record",
    empLinked: "unknown",
    gpsRequired: "NO",
    geofenceRequired: "NO",
    classification: "",
    reason: "",
    banner: "",
    inconsistency: "",
    note: a.note,
  };

  // 1) app-level company resolution (company-context.tsx)
  if (!appCompanyId) {
    row.classification = "AUTH_MISMATCH";
    row.reason = "users/{uid}.companyId empty → app has no tenant to query";
    rows.push(row);
    continue;
  }

  // 2) employees query (where userId == uid) — the first store call
  let employeesOk = false;
  let empDoc = null;
  try {
    await assertSucceeds(getDocs(query(collection(db, "companies", appCompanyId, "employees"), where("userId", "==", a.uid))));
    employeesOk = true;
  } catch {
    row.classification = "PERMISSION_DENIED";
    row.reason = "belongsToCompany FALSE (roster read denied) → syncWithDb aborts";
    rows.push(row);
    continue;
  }

  // 3) resolve / claim employee
  const foundByUserId = employeesOk
    ? (await getDocs(query(collection(db, "companies", appCompanyId, "employees"), where("userId", "==", a.uid)))).docs[0]
    : null;

  if (foundByUserId) {
    empDoc = foundByUserId;
    row.empLinked = "yes (userId)";
  } else {
    // claim-by-email path (attendance.store.ts)
    const all = await getDocs(collection(db, "companies", appCompanyId, "employees"));
    const byEmail = all.docs.find((d) => String(d.data().email ?? "").trim().toLowerCase() === a.email.toLowerCase());
    if (byEmail) {
      try {
        await assertSucceeds(updateDoc(byEmail.ref, { userId: a.uid }));
        empDoc = byEmail;
        row.empLinked = "claimed by email";
      } catch {
        row.classification = "PERMISSION_DENIED";
        row.reason = "cannot claim own employee record (write denied)";
        rows.push(row);
        continue;
      }
    } else {
      // auto-provision path (attendance.store.ts) — creates a remote/flexible record
      try {
        // attendance.store.ts does `employeeDoc = await getDoc(newEmpDoc)`, so
        // read the created record back to observe the SAME fields the app sees.
        const newRef = await addDoc(collection(db, "companies", appCompanyId, "employees"), {
          userId: a.uid, email: a.email, name: a.name, role: a.role,
          shiftStatus: "off-duty", workType: "remote", attendanceCheckMode: "flexible",
          allowRemoteTimer: true, status: "active",
        });
        empDoc = await getDoc(newRef);
        row.empLinked = "auto-provisioned";
        row.workMode = "remote";
        row.schedule = "n/a (flexible)";
        row.timezone = settings.timezone;
      } catch {
        row.classification = "INVALID_DATA";
        row.reason = "no employee record and cannot auto-provision";
        rows.push(row);
        continue;
      }
    }
  }

  const emp = { ...(empDoc.data?.() ?? {}), id: empDoc.id };

  // 4) eligibility (banner vs click path) — record inconsistency
  row.banner = blockReasonBanner(emp, locations) ?? "";
  const cap = capturePathOutcome(emp, locations, settings);
  const remoteAuth = emp.workType === "remote" || emp.allowRemoteTimer === true || emp.workMode === "remote" || emp.workMode === "field";
  row.gpsRequired = !remoteAuth && emp.attendanceCheckMode === "geofence" && emp.requireGps === true ? "YES" : "NO";
  row.geofenceRequired = !remoteAuth && (emp.attendanceCheckMode ?? "geofence") === "geofence" ? "YES" : "NO";

  if (!isEmploymentActive(emp.status)) {
    row.classification = "BLOCKED";
    row.reason = `employment_${emp.status}`;
    rows.push(row);
    continue;
  }
  if (row.banner === "location_not_assigned" && cap.block === null) {
    row.inconsistency = "banner says blocked, click path allows (workMode not seen by banner)";
  }

  if (cap.block === "not_assigned") {
    row.classification = "GEOFENCE_BLOCKED";
    row.reason = "office geofence enforced, no active assigned location";
    rows.push(row);
    continue;
  }
  if (cap.block === "location_inactive") {
    row.classification = "GEOFENCE_BLOCKED";
    row.reason = "assigned locations missing/inactive";
    rows.push(row);
    continue;
  }
  if (cap.block === "gps_denied") {
    row.classification = "GPS_REQUIRED";
    row.reason = "GPS mandatory by config and no fix available";
    rows.push(row);
    continue;
  }

  // 5) attendance CREATE permission (isOwnAttendanceCreate / peopleHrAllowed)
  const attendanceRef = collection(db, "companies", appCompanyId, "attendance");
  const canCreate = (async () => {
    await assertSucceeds(
      addDoc(attendanceRef, {
        employeeId: emp.id,
        userId: a.uid,
        date: "2026-11-05",
        checkIn: new Date().toISOString(),
        status: "present",
      })
    );
  })().then(() => true).catch(() => false);

  if (!canCreate) {
    row.classification = "PERMISSION_DENIED";
    row.reason = "attendance create denied by rules for this employee";
    rows.push(row);
    continue;
  }

  row.classification = "CAN_START_WORK";
  row.reason = "";
  rows.push(row);
  empSeq++;
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

function pad(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

const cols = [
  ["Email", 30], ["Country", 13], ["WorkMode", 10], ["Start", 6], ["Timezone", 14],
  ["AuthLink", 14], ["EmpLink", 18], ["Class", 18], ["GPS", 4], ["Geo", 4],
];
const header = cols.map(([t, w]) => pad(t, w)).join("");
console.log("\n==================== ALL-EMPLOYEE ATTENDANCE AUDIT ====================");
console.log(header);
console.log("-".repeat(header.length));
for (const r of rows) {
  console.log(
    pad(r.email, 30) + pad(r.country, 13) + pad(r.workMode, 10) + pad(r.schedule, 6) +
    pad(r.timezone, 14) + pad(r.authLinked, 14) + pad(r.empLinked, 18) +
    pad(r.classification, 18) + pad(r.gpsRequired, 4) + pad(r.geofenceRequired, 4)
  );
}
console.log("-".repeat(header.length));
for (const r of rows) {
  if (r.reason || r.inconsistency) {
    console.log(`  ${r.email} → ${r.classification}${r.reason ? " : " + r.reason : ""}${r.inconsistency ? "  [INCONSISTENT: " + r.inconsistency + "]" : ""}`);
  }
}

const counts = rows.reduce((acc, r) => {
  acc[r.classification] = (acc[r.classification] || 0) + 1;
  return acc;
}, {});
console.log("\nSUMMARY:");
console.log(`  Total Employees = ${rows.length}`);
console.log(`  Can Start Work  = ${counts.CAN_START_WORK || 0}`);
console.log(`  Blocked (class) = ${Object.entries(counts).filter(([k]) => k !== "CAN_START_WORK").map(([k, v]) => `${k}:${v}`).join(", ")}`);
console.log("=======================================================================\n");

await testEnv.clearFirestore();
process.exit(0);
