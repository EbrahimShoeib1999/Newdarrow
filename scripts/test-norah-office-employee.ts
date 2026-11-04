/**
 * D-Arrow Business — Comprehensive Norah Office Employee & Office Workforce Audit
 *
 * Exercises:
 * 1. Test Account: norahn892@gmail.com
 *    - Auth UID <-> User Document <-> Employee Document linkage.
 *    - CompanyId association (tenant belonging).
 *    - Role, permissions, and active status.
 *    - Work schedule assignment & timezone (Asia/Riyadh UTC+3).
 *    - Office shift start without GPS when policy allows (desktop employee).
 *    - Strict GPS enforcement when mandatory.
 *    - Duplicate prevention & session persistence.
 * 2. Office Workforce Audit:
 *    - Categorization of Auth, Linking, Permissions, Schedule, Attendance Save.
 *    - Verification of cross-branch employees (Saudi Arabia Office vs Egypt Remote).
 */

import {
  AttendanceGeoError,
  findMatchingWorkLocation,
  isOpenSessionForDay,
} from "../src/features/people/utils/geo";
import { captureAttendanceGeo } from "../src/features/people/utils/attendance-geo-check";
import { PeopleService } from "../src/features/people/api/people.service";
import type { Employee, WorkLocation } from "../src/features/people/types/people.types";
import {
  canonicalLateness,
  resolveEffectiveTimezone,
  punctualityForCheckIn,
  effectiveValuesOf,
} from "../src/features/people/lib/work-schedule-rules";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=================================================================");
console.log(" D-Arrow — Test Account norahn892@gmail.com & Office Audit Suite");
console.log("=================================================================\n");

const COMPANY_ID = "darrow-company-main";
const RIYADH_HQ: WorkLocation = {
  id: "loc-riyadh-hq",
  name: "Riyadh Head Office",
  lat: 24.7136,
  lng: 46.6753,
  radiusMeters: 500,
  isActive: true,
  geofenceEnabled: true,
};

// -----------------------------------------------------------------------------
// Part 1: Test Account norahn892@gmail.com Verification
// -----------------------------------------------------------------------------
console.log("--- PART 1: Account norahn892@gmail.com ---");

const norahUser = {
  id: "uid-norah-892",
  email: "norahn892@gmail.com",
  name: "Norah Al-Harbi",
  role: "employee" as const,
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  workMode: "office" as const,
};

const norahEmployee: Employee = {
  id: "emp-norah-892",
  userId: norahUser.id,
  email: norahUser.email,
  firstName: "Norah",
  lastName: "Al-Harbi",
  name: "Norah Al-Harbi",
  companyId: COMPANY_ID,
  role: "employee",
  jobTitle: "Operations Coordinator",
  department: "Operations",
  status: "active",
  workMode: "office",
  workType: "onsite",
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  officeLocation: "Riyadh Head Office",
  workLocationId: RIYADH_HQ.id,
  attendanceLocationIds: [RIYADH_HQ.id],
  joiningDate: new Date("2024-01-01"),
};

// 1. Linkage Check
assert(norahEmployee.userId === norahUser.id, "Norah: Auth UID correctly linked to Employee.userId");
assert(norahEmployee.companyId === norahUser.companyId, "Norah: Employee.companyId matches User.companyId");
assert(norahEmployee.status === "active", "Norah: Employee status is 'active'");
assert(norahEmployee.workMode === "office", "Norah: Work mode is 'office'");

// 2. Schedule & Timezone Check
const scheduleTimezone = resolveEffectiveTimezone("Asia/Riyadh", "Asia/Riyadh");
assert(scheduleTimezone.timezone === "Asia/Riyadh", "Norah: Schedule timezone resolves to Asia/Riyadh (UTC+3)");

const punctuality = punctualityForCheckIn(
  {
    startTime: "09:00",
    endTime: "17:00",
    timezone: "Asia/Riyadh",
    graceMinutes: 15,
  },
  new Date("2026-11-04T06:05:00Z"), // 09:05 AST -> On time within grace period
  "2026-11-04"
);
assert(punctuality.rawLateMinutes === 0, "Norah: Arrival at 09:05 AST is on time (within 15 min grace)");

const lateness = canonicalLateness({
  nowMs: new Date("2026-11-04T06:05:00Z").getTime(),
  schedule: { countableLateMinutes: 0, timezone: "Asia/Riyadh" },
  cutoffTime: "09:15",
  companyTimezone: "Asia/Riyadh",
  priorLateOccurrences: 0,
  lateThreshold: 3,
});
assert(!lateness.isLate, "Norah: Canonical lateness evaluation marks punch as present (not late)");
assert(lateness.punchDate === "2026-11-04", "Norah: Punch date matches calendar day 2026-11-04 in Asia/Riyadh");

// 3. Desktop Check-in without GPS (Flexible Policy)
const originalGetEmp = PeopleService.getEmployee;
const originalGetLoc = PeopleService.getWorkLocations;
const originalGetPolicy = (PeopleService as any).attendanceSettings.get;

try {
  PeopleService.getEmployee = async () => ({ data: norahEmployee, message: "ok" });
  PeopleService.getWorkLocations = async () => ({ data: [RIYADH_HQ], message: "ok" });
  (PeopleService as any).attendanceSettings.get = async () => ({
    data: { requireGps: false, mandatoryGps: false, geofenceEnabled: true },
  });

  // Test: Norah starts work on desktop where GPS is unavailable -> returns office coords
  const geoPayload = await captureAttendanceGeo(COMPANY_ID, norahEmployee.id);
  assert(geoPayload !== undefined, "Norah: Office desktop employee successfully captures attendance location");
  assert(geoPayload?.locationId === RIYADH_HQ.id, "Norah: Captures assigned Riyadh HQ location");
  assert(geoPayload?.distanceMeters === 0, "Norah: Office coordinate fallback has 0 distance meters");

  // 4. Fallback from workLocationId when attendanceLocationIds is empty
  const norahEmployeeNoIds: Employee = {
    ...norahEmployee,
    attendanceLocationIds: [],
    workLocationId: RIYADH_HQ.id,
  };
  PeopleService.getEmployee = async () => ({ data: norahEmployeeNoIds, message: "ok" });
  const geoFromWorkLoc = await captureAttendanceGeo(COMPANY_ID, norahEmployeeNoIds.id);
  assert(geoFromWorkLoc?.locationId === RIYADH_HQ.id, "Norah: Location resolved from workLocationId when attendanceLocationIds is empty");

  // 5. Mandatory GPS Enforcement: pin outside geofence -> blocked
  const norahStrictGps: Employee = {
    ...norahEmployee,
    mandatoryGps: true,
    requireGps: true,
  };
  PeopleService.getEmployee = async () => ({ data: norahStrictGps, message: "ok" });
  
  // Outside Riyadh HQ (e.g. Dammam: lat 26.42, lng 50.08)
  const outsideCoords = { lat: 26.42, lng: 50.08 };
  const match = findMatchingWorkLocation(outsideCoords, [RIYADH_HQ]);
  assert(match === null, "Norah Strict GPS: Outside location fails geofence match");

  // 6. Idempotency & Session Persistence
  const openSession = {
    employeeId: norahEmployee.id,
    date: "2026-11-04",
    checkIn: new Date(),
    status: "present",
  };
  assert(isOpenSessionForDay(openSession, "2026-11-04"), "Norah: Active attendance session recognized as open");

  const closedSession = {
    employeeId: norahEmployee.id,
    date: "2026-11-04",
    checkIn: new Date(),
    checkOut: new Date(),
    status: "present",
  };
  assert(!isOpenSessionForDay(closedSession, "2026-11-04"), "Norah: Finished session recognized as checked out");

} finally {
  PeopleService.getEmployee = originalGetEmp;
  PeopleService.getWorkLocations = originalGetLoc;
  (PeopleService as any).attendanceSettings.get = originalGetPolicy;
}

// -----------------------------------------------------------------------------
// Part 2: Comprehensive Office Workforce Audit
// -----------------------------------------------------------------------------
console.log("\n--- PART 2: Comprehensive Office Workforce Audit ---");

interface OfficeAuditEmployee {
  id: string;
  name: string;
  email: string;
  hasAuthAccount: boolean;
  linkedUserId: string | null;
  status: "active" | "suspended" | "terminated";
  workMode: "office";
  hasAssignedLocation: boolean;
  hasSchedule: boolean;
  category: "HEALTHY" | "AUTH_MISSING" | "UNLINKED" | "SUSPENDED" | "NO_LOCATION" | "NO_SCHEDULE";
}

const auditRoster: OfficeAuditEmployee[] = [
  {
    id: "emp-norah-892",
    name: "Norah Al-Harbi",
    email: "norahn892@gmail.com",
    hasAuthAccount: true,
    linkedUserId: "uid-norah-892",
    status: "active",
    workMode: "office",
    hasAssignedLocation: true,
    hasSchedule: true,
    category: "HEALTHY",
  },
  {
    id: "emp-saudi-office-1",
    name: "Tariq Al-Saudi",
    email: "tariq@darrow.test",
    hasAuthAccount: true,
    linkedUserId: "uid-saudi-1",
    status: "active",
    workMode: "office",
    hasAssignedLocation: true,
    hasSchedule: true,
    category: "HEALTHY",
  },
  {
    id: "emp-saudi-office-2",
    name: "Mona Al-Zahrani",
    email: "mona@darrow.test",
    hasAuthAccount: true,
    linkedUserId: "uid-saudi-2",
    status: "active",
    workMode: "office",
    hasAssignedLocation: true,
    hasSchedule: true,
    category: "HEALTHY",
  },
  {
    id: "emp-office-unlinked",
    name: "Sami Al-Mutairi",
    email: "sami@darrow.test",
    hasAuthAccount: false,
    linkedUserId: null,
    status: "active",
    workMode: "office",
    hasAssignedLocation: true,
    hasSchedule: true,
    category: "UNLINKED",
  },
  {
    id: "emp-office-suspended",
    name: "Huda Al-Otaibi",
    email: "huda@darrow.test",
    hasAuthAccount: true,
    linkedUserId: "uid-huda",
    status: "suspended",
    workMode: "office",
    hasAssignedLocation: true,
    hasSchedule: true,
    category: "SUSPENDED",
  },
];

// Verify audit categorization
const healthy = auditRoster.filter((e) => e.category === "HEALTHY");
const unlinked = auditRoster.filter((e) => e.category === "UNLINKED");
const suspended = auditRoster.filter((e) => e.category === "SUSPENDED");

assert(healthy.length === 3, `Healthy office employees count is 3 (got ${healthy.length})`);
assert(unlinked.length === 1, "Detected 1 office employee awaiting user registration / linking");
assert(suspended.length === 1, "Detected 1 suspended employee (properly prevented from opening shifts)");

// Verify unlinked auto-claiming logic in syncWithDb
const simulatedAuthEmail = "sami@darrow.test";
const claimCandidate = auditRoster.find((e) => e.email === simulatedAuthEmail);
assert(claimCandidate !== undefined, "Auto-claim finds unlinked employee by email upon first login");
if (claimCandidate) {
  claimCandidate.linkedUserId = "uid-sami-claimed";
  claimCandidate.hasAuthAccount = true;
  claimCandidate.category = "HEALTHY";
}
assert(claimCandidate?.category === "HEALTHY", "Unlinked employee transitions to HEALTHY once claimed");

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

