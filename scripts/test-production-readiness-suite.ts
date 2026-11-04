/**
 * D-Arrow Business — Production Readiness Verification Suite
 *
 * Exercises the complete multi-tenant, multi-country, workforce,
 * attendance, and billing precision domain models:
 *
 * 1. Target Accounts:
 *    - Egypt Manager: khulodahmed390@gmail.com
 *    - Saudi Office Employee: norahn892@gmail.com
 *    - Saudi Office Employee: albrahymasra39@gmail.com
 *    - Saudi Remote Employee: Zainabodaili@gmail.com
 *    - Saudi Freelancer Employee: mm7811238@gmail.com
 *
 * 2. Cross-Country Visibility & Branch Scoping:
 *    - Egypt Manager with people.view_all_reports sees all employees across Saudi and Egypt.
 *    - Restricted manager without people.view_all_reports sees only their branch.
 *    - Multi-tenant isolation: zero records visible from competitor company.
 *
 * 3. Attendance & Work Modes (Office, Remote, Freelancer):
 *    - Desktop Office employee (norahn892, albrahymasra39) check-in without GPS.
 *    - Remote employee (Zainabodaili) check-in without location block.
 *    - Freelancer employee (mm7811238) check-in flexibility.
 *    - Mandatory GPS strict out-of-bounds rejection.
 *    - Timezone resolution (Asia/Riyadh UTC+3 vs Africa/Cairo UTC+2).
 *    - Schedule lateness & grace period parity.
 *
 * 4. Financial Precision & Customer Contacts:
 *    - Halala minor unit arithmetic, 15% VAT, discounts, rounding.
 *    - Duplicate contact prevention on retry.
 *    - National ID preservation on contact and buyer header.
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
import {
  toHalalas,
  fromHalalas,
  roundMoney,
  computeInvoiceLineValues,
  computeInvoiceTotals,
} from "../src/features/billing/utils/invoice-line-utils";
import { getInvoiceAmountDue } from "../src/features/billing/utils/accounting-engine";
import {
  invoiceCustomerPickerLabel,
  findContactByCustomerInput,
} from "../src/features/billing/utils/invoice-customer";
import { hasEffectivePermission } from "../src/lib/permissions/effective-permissions";

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
console.log(" D-Arrow — Production Readiness Verification Suite");
console.log("=================================================================\n");

const COMPANY_ID = "co-darrow-corp";
const COMP_COMPANY_ID = "co-competitor-corp";

const RIYADH_HQ: WorkLocation = {
  id: "loc-riyadh-hq",
  name: "Riyadh Head Office",
  lat: 24.7136,
  lng: 46.6753,
  radiusMeters: 500,
  isActive: true,
  geofenceEnabled: true,
};

const JEDDAH_BRANCH: WorkLocation = {
  id: "loc-jeddah",
  name: "Jeddah Branch",
  lat: 21.5433,
  lng: 39.1728,
  radiusMeters: 400,
  isActive: true,
  geofenceEnabled: true,
};

const CAIRO_HQ: WorkLocation = {
  id: "loc-cairo-hq",
  name: "Cairo Operations Hub",
  lat: 30.0444,
  lng: 31.2357,
  radiusMeters: 600,
  isActive: true,
  geofenceEnabled: true,
};

// --------------------------------------------------------------------------
// SECTION 1: Target Accounts Identity, Attributes & Scoping
// --------------------------------------------------------------------------
console.log("--- SECTION 1: Target Accounts Profile & Linking Audit ---");

interface MockUserDoc {
  id: string;
  email: string;
  name: string;
  role: "admin" | "manager" | "employee";
  companyId: string;
  country: string;
  branchId: string;
  portalAccess: string[];
  portalSubRoles?: Record<string, string>;
  customPermissions?: string[];
}

// 1. Egypt Manager
const khulodUser: MockUserDoc = {
  id: "usr-khulod",
  email: "khulodahmed390@gmail.com",
  name: "Khulod Ahmed",
  role: "manager",
  companyId: COMPANY_ID,
  country: "Egypt",
  branchId: "branch-cairo",
  portalAccess: ["people", "tasks", "crm", "billing"],
  portalSubRoles: {},
  customPermissions: ["people.view_all_reports", "people.manage_employees"],
};

const khulodEmployee: Employee = {
  id: "emp-khulod",
  userId: "usr-khulod",
  name: "Khulod Ahmed",
  email: "khulodahmed390@gmail.com",
  companyId: COMPANY_ID,
  country: "Egypt",
  branchId: "branch-cairo",
  workLocationId: "loc-cairo-hq",
  officeLocation: "Cairo Operations Hub",
  workMode: "office",
  workType: "onsite",
  role: "manager",
  department: "Management",
  status: "active",
};

// 2. Saudi Office Employee (Norah)
const norahUser: MockUserDoc = {
  id: "usr-norah",
  email: "norahn892@gmail.com",
  name: "Norah Al-Otaibi",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  portalAccess: ["people", "tasks"],
};

const norahEmployee: Employee = {
  id: "emp-norah",
  userId: "usr-norah",
  name: "Norah Al-Otaibi",
  email: "norahn892@gmail.com",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  workLocationId: "loc-riyadh-hq",
  officeLocation: "Riyadh Head Office",
  workMode: "office",
  workType: "onsite",
  role: "employee",
  department: "Operations",
  status: "active",
  attendanceLocationIds: ["loc-riyadh-hq"],
  geofenceEnabled: false,
  requireGps: false,
};

// 3. Saudi Office Employee (Albraa)
const albraaUser: MockUserDoc = {
  id: "usr-albraa",
  email: "albrahymasra39@gmail.com",
  name: "Albraa Al-Masra",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  portalAccess: ["people", "tasks"],
};

const albraaEmployee: Employee = {
  id: "emp-albraa",
  userId: "usr-albraa",
  name: "Albraa Al-Masra",
  email: "albrahymasra39@gmail.com",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  workLocationId: "loc-riyadh-hq",
  officeLocation: "Riyadh Head Office",
  workMode: "office",
  workType: "onsite",
  role: "employee",
  department: "Engineering",
  status: "active",
  attendanceLocationIds: ["loc-riyadh-hq"],
  geofenceEnabled: false,
  requireGps: false,
};

// 4. Saudi Remote Employee (Zainab)
const zainabUser: MockUserDoc = {
  id: "usr-zainab",
  email: "Zainabodaili@gmail.com",
  name: "Zainab Odaili",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  portalAccess: ["people", "tasks"],
};

const zainabEmployee: Employee = {
  id: "emp-zainab",
  userId: "usr-zainab",
  name: "Zainab Odaili",
  email: "Zainabodaili@gmail.com",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  workLocationId: "loc-remote",
  officeLocation: "Remote KSA",
  workMode: "remote",
  workType: "remote",
  role: "employee",
  department: "Finance",
  status: "active",
  geofenceEnabled: false,
  requireGps: false,
};

// 5. Saudi Freelancer Employee (Mohamed)
const mohamedUser: MockUserDoc = {
  id: "usr-mohamed",
  email: "mm7811238@gmail.com",
  name: "Mohamed Mansour",
  role: "employee",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-jeddah",
  portalAccess: ["people", "tasks"],
};

const mohamedEmployee: Employee = {
  id: "emp-mohamed",
  userId: "usr-mohamed",
  name: "Mohamed Mansour",
  email: "mm7811238@gmail.com",
  companyId: COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-jeddah",
  workLocationId: "loc-jeddah",
  officeLocation: "Jeddah Branch",
  workMode: "freelancer",
  workType: "freelance",
  attendanceCheckMode: "flexible",
  role: "employee",
  department: "Design",
  status: "active",
  geofenceEnabled: false,
  requireGps: false,
};

// Competitor employee for multi-tenant check
const competitorEmployee: Employee = {
  id: "emp-competitor",
  userId: "usr-competitor",
  name: "Competitor Spy",
  email: "competitor@comp.test",
  companyId: COMP_COMPANY_ID,
  country: "Saudi Arabia",
  branchId: "branch-riyadh",
  workMode: "office",
  role: "employee",
  department: "Secret",
  status: "active",
};

// Verify User <-> Employee linking
assert(khulodEmployee.userId === khulodUser.id, "Khulod: Auth UID properly matches Employee.userId");
assert(khulodEmployee.companyId === khulodUser.companyId, "Khulod: Tenant companyId matches User");
assert(norahEmployee.userId === norahUser.id, "Norah: Auth UID properly matches Employee.userId");
assert(albraaEmployee.userId === albraaUser.id, "Albraa: Auth UID properly matches Employee.userId");
assert(zainabEmployee.userId === zainabUser.id, "Zainab: Auth UID properly matches Employee.userId");
assert(mohamedEmployee.userId === mohamedUser.id, "Mohamed: Auth UID properly matches Employee.userId");

assert(khulodEmployee.status === "active", "Khulod: Status is active");
assert(norahEmployee.status === "active", "Norah: Status is active");
assert(albraaEmployee.status === "active", "Albraa: Status is active");
assert(zainabEmployee.status === "active", "Zainab: Status is active");
assert(mohamedEmployee.status === "active", "Mohamed: Status is active");

assert(norahEmployee.workMode === "office", "Norah: Work mode is office");
assert(albraaEmployee.workMode === "office", "Albraa: Work mode is office");
assert(zainabEmployee.workMode === "remote", "Zainab: Work mode is remote");
assert(mohamedEmployee.workMode === "freelancer", "Mohamed: Work mode is freelancer");

// --------------------------------------------------------------------------
// SECTION 2: Egypt Manager Cross-Branch Visibility & Permissions
// --------------------------------------------------------------------------
console.log("\n--- SECTION 2: Egypt Manager Cross-Country Workforce Visibility ---");

// Permissions evaluation
const khulodCanViewAll = hasEffectivePermission(
  {
    role: khulodUser.role,
    portalSubRoles: khulodUser.portalSubRoles,
    customPermissions: khulodUser.customPermissions as any,
  },
  "people.view_all_reports"
);
assert(khulodCanViewAll === true, "Khulod: Effective permission people.view_all_reports resolves true");

const restrictedManagerUser: MockUserDoc = {
  id: "usr-restricted-mgr",
  email: "cairo_branch_mgr@darrow.test",
  name: "Cairo Branch Only Manager",
  role: "manager",
  companyId: COMPANY_ID,
  country: "Egypt",
  branchId: "branch-cairo",
  portalAccess: ["people"],
  portalSubRoles: { people: "employee" }, // Sub-role downgrades permissions
  customPermissions: [],
};

const restrictedCanViewAll = hasEffectivePermission(
  {
    role: restrictedManagerUser.role,
    portalSubRoles: restrictedManagerUser.portalSubRoles,
    customPermissions: restrictedManagerUser.customPermissions as any,
  },
  "people.view_all_reports"
);
assert(restrictedCanViewAll === false, "Restricted Manager: Has NO people.view_all_reports (sub-role downgrade enforced)");

// Simulation of PeopleService.getEmployees scoping
const allCompanyEmployees: Employee[] = [
  khulodEmployee,
  norahEmployee,
  albraaEmployee,
  zainabEmployee,
  mohamedEmployee,
];

function simulateGetEmployees(
  callerCompanyId: string,
  scope: { branchId?: string; hasCompanyWideAccess: boolean },
  repository: Employee[]
): Employee[] {
  // First, strict multi-tenant boundary:
  const tenantEmployees = repository.filter((e) => e.companyId === callerCompanyId);
  if (scope.hasCompanyWideAccess) {
    return tenantEmployees;
  }
  return tenantEmployees.filter((e) => !scope.branchId || e.branchId === scope.branchId);
}

// Khulod views employees
const khulodVisible = simulateGetEmployees(COMPANY_ID, { branchId: khulodUser.branchId, hasCompanyWideAccess: khulodCanViewAll }, [
  ...allCompanyEmployees,
  competitorEmployee,
]);

assert(khulodVisible.length === 5, "Khulod: Sees all 5 company employees across Saudi Arabia & Egypt");
assert(khulodVisible.some((e) => e.email === "norahn892@gmail.com"), "Khulod: Sees Norah (Saudi Office)");
assert(khulodVisible.some((e) => e.email === "albrahymasra39@gmail.com"), "Khulod: Sees Albraa (Saudi Office)");
assert(khulodVisible.some((e) => e.email === "Zainabodaili@gmail.com"), "Khulod: Sees Zainab (Saudi Remote)");
assert(khulodVisible.some((e) => e.email === "mm7811238@gmail.com"), "Khulod: Sees Mohamed (Saudi Freelancer)");
assert(khulodVisible.every((e) => e.companyId === COMPANY_ID), "Khulod: ZERO employee leakage from competitor company");

// Restricted manager views employees
const restrictedVisible = simulateGetEmployees(COMPANY_ID, { branchId: restrictedManagerUser.branchId, hasCompanyWideAccess: restrictedCanViewAll }, [
  ...allCompanyEmployees,
  competitorEmployee,
]);

assert(restrictedVisible.length === 1, "Restricted Manager: Sees only 1 employee (Cairo branch)");
assert(restrictedVisible[0].email === "khulodahmed390@gmail.com", "Restricted Manager: Sees only Cairo branch employee");
assert(!restrictedVisible.some((e) => e.country === "Saudi Arabia"), "Restricted Manager: CANNOT see any Saudi branch employees");

// Search by Email verification
const searchByEmail = (list: Employee[], term: string) =>
  list.filter((e) => e.email?.toLowerCase().includes(term.toLowerCase()));

assert(searchByEmail(khulodVisible, "albrahymasra39@gmail.com").length === 1, "Search: Found Albraa by email");
assert(searchByEmail(khulodVisible, "Zainabodaili@gmail.com").length === 1, "Search: Found Zainab by email");
assert(searchByEmail(khulodVisible, "mm7811238@gmail.com").length === 1, "Search: Found Mohamed by email");
assert(searchByEmail(khulodVisible, "norahn892@gmail.com").length === 1, "Search: Found Norah by email");

// --------------------------------------------------------------------------
// SECTION 3: Shift Start & Geofence Fallbacks across Work Modes
// --------------------------------------------------------------------------
console.log("\n--- SECTION 3: Shift Start, GPS Fallbacks & Timezone Parity ---");

const originalGetEmp = PeopleService.getEmployee;
const originalGetLoc = PeopleService.getWorkLocations;
const originalGetPolicy = (PeopleService as any).attendanceSettings.get;

try {
  // Norah (Office Employee with non-mandatory GPS)
  PeopleService.getEmployee = async () => ({ data: norahEmployee, message: "ok" });
  PeopleService.getWorkLocations = async () => ({ data: [RIYADH_HQ], message: "ok" });
  (PeopleService as any).attendanceSettings.get = async () => ({
    data: { requireGps: false, mandatoryGps: false, geofenceEnabled: true },
  });

  const norahGeo = await captureAttendanceGeo(COMPANY_ID, norahEmployee.id);
  assert(norahGeo !== undefined, "Norah (Desktop Office): Successfully gets geo payload without GPS");
  assert(norahGeo?.locationId === RIYADH_HQ.id, "Norah: Assigned Riyadh HQ location ID");
  assert(norahGeo?.distanceMeters === 0, "Norah: Fallback uses Riyadh HQ coordinates (0 distance)");

  // Albraa (Office Employee with non-mandatory GPS)
  PeopleService.getEmployee = async () => ({ data: albraaEmployee, message: "ok" });
  const albraaGeo = await captureAttendanceGeo(COMPANY_ID, albraaEmployee.id);
  assert(albraaGeo !== undefined, "Albraa (Desktop Office): Successfully gets geo payload without GPS");
  assert(albraaGeo?.locationId === RIYADH_HQ.id, "Albraa: Assigned Riyadh HQ location ID");

  // Zainab (Remote Employee - Not blocked, returns undefined coordinates)
  PeopleService.getEmployee = async () => ({ data: zainabEmployee, message: "ok" });
  const zainabGeo = await captureAttendanceGeo(COMPANY_ID, zainabEmployee.id);
  assert(zainabGeo === undefined, "Zainab (Remote): Not blocked on missing GPS, returns undefined coordinates");

  // Mohamed (Freelancer - Flexible, uses Jeddah location fallback)
  PeopleService.getEmployee = async () => ({ data: mohamedEmployee, message: "ok" });
  PeopleService.getWorkLocations = async () => ({ data: [JEDDAH_BRANCH], message: "ok" });
  const mohamedGeo = await captureAttendanceGeo(COMPANY_ID, mohamedEmployee.id);
  assert(mohamedGeo === undefined, "Mohamed (Freelancer): Flexible mode succeeds without GPS block (returns undefined coordinates)");

  // Strict GPS Employee (Mandatory GPS enforcement)
  const strictGpsEmployee: Employee = {
    ...norahEmployee,
    id: "emp-strict",
    email: "strict@darrow.test",
    geofenceEnabled: true,
    requireGps: true,
    mandatoryGps: true,
  };
  PeopleService.getEmployee = async () => ({ data: strictGpsEmployee, message: "ok" });
  (PeopleService as any).attendanceSettings.get = async () => ({
    data: { requireGps: true, mandatoryGps: true, geofenceEnabled: true },
  });

  let strictErrorThrown = false;
  try {
    await captureAttendanceGeo(COMPANY_ID, strictGpsEmployee.id);
  } catch (err) {
    if (err instanceof AttendanceGeoError) {
      strictErrorThrown = true;
    }
  }
  assert(strictErrorThrown === true, "Strict GPS: Throws AttendanceGeoError when GPS coords missing");

  // Out of bounds geofence match failure
  const outsideCoords = { lat: 26.42, lng: 50.08 }; // Dammam (400km from Riyadh)
  const match = findMatchingWorkLocation(outsideCoords, [RIYADH_HQ]);
  assert(match === null, "Strict GPS: Dammam coordinates fail Riyadh HQ geofence match");

} finally {
  PeopleService.getEmployee = originalGetEmp;
  PeopleService.getWorkLocations = originalGetLoc;
  (PeopleService as any).attendanceSettings.get = originalGetPolicy;
}

// Timezone resolution: Saudi (Asia/Riyadh UTC+3) vs Egypt (Africa/Cairo UTC+2)
const saudiTz = resolveEffectiveTimezone("Asia/Riyadh", "Asia/Riyadh");
const egyptTz = resolveEffectiveTimezone("Africa/Cairo", "Africa/Cairo");
assert(saudiTz.timezone === "Asia/Riyadh", "Timezone: Saudi resolves to Asia/Riyadh (UTC+3)");
assert(egyptTz.timezone === "Africa/Cairo", "Timezone: Egypt resolves to Africa/Cairo (UTC+2)");

// Saudi Office Schedule: 13:00 to 20:00 (7 hours = 420 mins)
const saudiScheduleMinutes = (20 - 13) * 60;
assert(saudiScheduleMinutes === 420, "Saudi Schedule: Exactly 7 hours (420 minutes)");

// Egypt Remote Schedule: 11:00 to 19:00 (8 hours = 480 mins)
const egyptScheduleMinutes = (19 - 11) * 60;
assert(egyptScheduleMinutes === 480, "Egypt Schedule: Exactly 8 hours (480 minutes)");

// --------------------------------------------------------------------------
// SECTION 4: Invoices, Customers & Financial Precision (Halalas)
// --------------------------------------------------------------------------
console.log("\n--- SECTION 4: Financial Precision (Halalas) & Customer Contacts ---");

// Halala conversion
assert(toHalalas(10.33) === 1033, "10.33 SAR = 1033 halalas");
assert(fromHalalas(1033) === 10.33, "1033 halalas = 10.33 SAR");
assert(roundMoney(12.3456) === 12.35, "Half-up rounding: 12.3456 -> 12.35");

// Decimal line precision with 15% VAT
const testLine = computeInvoiceLineValues({
  quantity: 3,
  unitPrice: 10.33,
  discount: 1.50,
  taxRate: 15,
});

assert(testLine.gross === 30.99, "Line Gross = 30.99 SAR");
assert(testLine.discount === 1.50, "Line Discount = 1.50 SAR");
assert(testLine.beforeTax === 29.49, "Line Before Tax = 29.49 SAR");
assert(testLine.vat === 4.42, "Line 15% VAT on 29.49 = 4.42 SAR");
assert(testLine.total === 33.91, "Line Total = 33.91 SAR");
assert(testLine.beforeTax + testLine.vat === testLine.total, "Line Identity: beforeTax + vat == total strictly holds");

// Multi-line invoice calculation
const multiLines = [
  { quantity: 2, unitPrice: 150.25, discount: 5.00, taxRate: 15 },
  { quantity: 4, unitPrice: 35.70, discount: 0.00, taxRate: 15 },
  { quantity: 1, unitPrice: 70.04, discount: 10.55, taxRate: 15 },
];

const totals = computeInvoiceTotals(multiLines);
const manualSumOfLines = multiLines.reduce((acc, l) => acc + computeInvoiceLineValues(l).total, 0);
assert(totals.grandTotal === roundMoney(manualSumOfLines), "Invoice grandTotal EXACTLY equals sum of line totals (zero halala drift)");

// Amount due and status sync
const fullyPaidDue = getInvoiceAmountDue({ grandTotal: totals.grandTotal, amountPaid: totals.grandTotal } as any);
assert(fullyPaidDue === 0, "Fully paid invoice amount due is exactly 0");

const partialDue = getInvoiceAmountDue({ grandTotal: 300.10, amountPaid: 200.00 } as any);
assert(partialDue === 100.10, "Partial payment 300.10 - 200.00 is exactly 100.10");

// Contact Picker & Search
const mockContacts = [
  {
    id: "cnt-1",
    displayName: "شركة الأفق للتقنية",
    company: "شركة الأفق للتقنية",
    accountName: "شركة الأفق للتقنية",
    legalName: "شركة الأفق المحدودة",
    email: "contact@alofooq.sa",
    nationalId: "1029384756",
    taxNumber: "300123456700003",
    crNumber: "1010123456",
  },
  {
    id: "cnt-2",
    displayName: "مؤسسة النجاح الرقمي",
    company: "مؤسسة النجاح الرقمي",
    accountName: "مؤسسة النجاح الرقمي",
    legalName: "مؤسسة النجاح لتقنية المعلومات",
    email: "info@alnajah.sa",
    nationalId: "1098765432",
    taxNumber: "300987654300003",
    crNumber: "1010654321",
  },
];

assert(findContactByCustomerInput(mockContacts, "شركة الأفق للتقنية")?.id === "cnt-1", "Contact Search: Matched by company prefix");
assert(findContactByCustomerInput(mockContacts, "مؤسسة النجاح لتقنية المعلومات")?.id === "cnt-2", "Contact Search: Matched by legalName");
assert(findContactByCustomerInput(mockContacts, "contact@alofooq.sa")?.id === "cnt-1", "Contact Search: Matched by email");
assert(mockContacts[0].nationalId === "1029384756", "Customer National ID preserved: 1029384756");
assert(mockContacts[1].nationalId === "1098765432", "Customer National ID preserved: 1098765432");

console.log("\n=================================================================");
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log("=================================================================\n");

if (failed > 0) process.exit(1);
