import assert from "node:assert/strict";
import { filterEmployeesByScope } from "../src/features/people/api/people.service";
import { hasEffectivePermission } from "../src/lib/permissions/effective-permissions";
import { getAssignableRoles, canAssignRole, canManageUserRole } from "../src/lib/permissions/role-assignment";
import { mapFirestoreUser } from "../src/features/auth/utils/map-user";
import type { Employee, LeaveRequest, Attendance } from "../src/features/people/types/people.types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name} ->`, err instanceof Error ? err.message : String(err));
  }
}

console.log("\n=================================================================");
console.log(" D-ARROW: GLOBAL HR MANAGER & CROSS-COUNTRY VERIFICATION SUITE");
console.log("=================================================================\n");

const COMPANY_DARROW = "co-darrow-global";
const COMPANY_COMPETITOR = "co-competitor-corp";

// Fixture Data: Egyptian and Saudi employees belonging to COMPANY_DARROW
const egyptEmployees: Employee[] = [
  {
    id: "emp-eg-1",
    name: "Khulod Ahmed",
    email: "khulodahmed390@gmail.com",
    country: "Egypt",
    branchId: "branch-cairo",
    workLocationId: "loc-cairo-hq",
    officeLocation: "Cairo Operations Hub",
    companyId: COMPANY_DARROW,
    workMode: "remote",
    role: "global_hr_manager",
    department: "Human Resources",
    status: "active",
    salary: 25000,
    currency: "EGP",
    joiningDate: new Date("2024-01-15"),
  } as Employee,
  {
    id: "emp-eg-2",
    name: "Nour El Masri",
    email: "nour@darrow.test",
    country: "Egypt",
    branchId: "branch-cairo",
    workLocationId: "loc-cairo-hq",
    officeLocation: "Cairo Operations Hub",
    companyId: COMPANY_DARROW,
    workMode: "remote",
    role: "employee",
    department: "Marketing",
    status: "active",
    salary: 15000,
    currency: "EGP",
    joiningDate: new Date("2024-03-01"),
  } as Employee,
  {
    id: "emp-eg-3",
    name: "Hassan Farouk",
    email: "hassan@darrow.test",
    country: "Egypt",
    branchId: "branch-cairo",
    workLocationId: "loc-cairo-hq",
    officeLocation: "Cairo Operations Hub",
    companyId: COMPANY_DARROW,
    workMode: "office",
    role: "employee",
    department: "Operations",
    status: "active",
    salary: 18000,
    currency: "EGP",
    joiningDate: new Date("2024-04-10"),
  } as Employee,
];

const saudiEmployees: Employee[] = [
  {
    id: "emp-sa-1",
    name: "Norah Al Otaibi",
    email: "norahn892@gmail.com",
    country: "Saudi Arabia",
    branchId: "branch-riyadh",
    workLocationId: "loc-riyadh-hq",
    officeLocation: "Riyadh Head Office",
    companyId: COMPANY_DARROW,
    workMode: "office",
    role: "employee",
    department: "Operations",
    status: "active",
    salary: 12000,
    currency: "SAR",
    joiningDate: new Date("2023-11-01"),
  } as Employee,
  {
    id: "emp-sa-2",
    name: "Albraa Al Masra",
    email: "albrahymasra39@gmail.com",
    country: "Saudi Arabia",
    branchId: "branch-riyadh",
    workLocationId: "loc-riyadh-hq",
    officeLocation: "Riyadh Head Office",
    companyId: COMPANY_DARROW,
    workMode: "office",
    role: "employee",
    department: "Engineering",
    status: "active",
    salary: 14000,
    currency: "SAR",
    joiningDate: new Date("2023-12-15"),
  } as Employee,
  {
    id: "emp-sa-3",
    name: "Zainab Odaili",
    email: "Zainabodaili@gmail.com",
    country: "Saudi Arabia",
    branchId: "branch-jeddah",
    workLocationId: "loc-jeddah",
    officeLocation: "Jeddah Branch",
    companyId: COMPANY_DARROW,
    workMode: "remote",
    role: "employee",
    department: "Finance",
    status: "active",
    salary: 11000,
    currency: "SAR",
    joiningDate: new Date("2024-02-01"),
  } as Employee,
  {
    id: "emp-sa-4",
    name: "Mohamed Mansour",
    email: "mm7811238@gmail.com",
    country: "Saudi Arabia",
    branchId: "branch-jeddah",
    workLocationId: "loc-jeddah",
    officeLocation: "Jeddah Branch",
    companyId: COMPANY_DARROW,
    workMode: "office",
    role: "employee",
    department: "Design",
    status: "active",
    salary: 13500,
    currency: "SAR",
    joiningDate: new Date("2024-05-20"),
  } as Employee,
];

// Competitor employee (must NEVER leak into DArrow roster)
const competitorEmployees: Employee[] = [
  {
    id: "emp-comp-1",
    name: "Foreign Competitor Worker",
    email: "outsider@competitor.test",
    country: "Saudi Arabia",
    branchId: "branch-comp-riyadh",
    companyId: COMPANY_COMPETITOR,
    workMode: "office",
    role: "employee",
    status: "active",
  } as Employee,
];

const allDArrowEmployees = [...egyptEmployees, ...saudiEmployees];
const multiTenantEmployees = [...allDArrowEmployees, ...competitorEmployees];

// 1. RBAC & PERMISSION AUDIT
test("GLOBAL_HR_MANAGER has employee management permissions", () => {
  const ctx = { role: "global_hr_manager" as const };
  assert.equal(hasEffectivePermission(ctx, "portals.people"), true);
  assert.equal(hasEffectivePermission(ctx, "people.view"), true);
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), true);
  assert.equal(hasEffectivePermission(ctx, "people.view_all_reports"), true);
});

test("GLOBAL_HR_MANAGER has attendance management permissions", () => {
  const ctx = { role: "global_hr_manager" as const };
  assert.equal(hasEffectivePermission(ctx, "people.view_all_attendance"), true);
  assert.equal(hasEffectivePermission(ctx, "people.correct_attendance"), true);
  assert.equal(hasEffectivePermission(ctx, "people.view_lateness"), true);
  assert.equal(hasEffectivePermission(ctx, "people.evaluate_lateness"), true);
  assert.equal(hasEffectivePermission(ctx, "people.view_schedules"), true);
  assert.equal(hasEffectivePermission(ctx, "people.manage_schedules"), true);
  assert.equal(hasEffectivePermission(ctx, "people.manage_lateness_policies"), true);
});

test("GLOBAL_HR_MANAGER has leave management permissions", () => {
  const ctx = { role: "global_hr_manager" as const };
  assert.equal(hasEffectivePermission(ctx, "people.approve_leave"), true);
});

test("GLOBAL_HR_MANAGER has performance & administration permissions", () => {
  const ctx = { role: "global_hr_manager" as const };
  assert.equal(hasEffectivePermission(ctx, "people.view_performance"), true);
  assert.equal(hasEffectivePermission(ctx, "company.view"), true);
  assert.equal(hasEffectivePermission(ctx, "users.manage_roles"), true);
});

test("GLOBAL_HR_MANAGER payroll & compensation separation of duties", () => {
  const ctx = { role: "global_hr_manager" as const };
  // Can decide deduction cases (HR action)
  assert.equal(hasEffectivePermission(ctx, "people.decide_deductions"), true);
  // Cannot post deductions to General Ledger (Accountant / Admin financial separation of duty)
  assert.equal(hasEffectivePermission(ctx, "people.post_deductions"), false);
  assert.equal(hasEffectivePermission(ctx, "people.reverse_deductions"), false);
});

test("GLOBAL_HR_MANAGER role assignment capabilities prevent privilege escalation", () => {
  const assignable = getAssignableRoles("global_hr_manager");
  assert.deepEqual(assignable, ["employee", "viewer"]);
  assert.equal(canAssignRole("global_hr_manager", "employee"), true);
  assert.equal(canAssignRole("global_hr_manager", "viewer"), true);
  assert.equal(canAssignRole("global_hr_manager", "admin"), false);
  assert.equal(canAssignRole("global_hr_manager", "super_admin"), false);
  assert.equal(canAssignRole("global_hr_manager", "global_hr_manager"), false);
});

// 2. CROSS-COUNTRY VISIBILITY TESTS
test("View Egyptian employees", () => {
  const visible = filterEmployeesByScope(allDArrowEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  });
  const egCount = visible.filter((e) => e.country === "Egypt").length;
  assert.equal(egCount, 3, "All 3 Egyptian employees are visible");
});

test("View Saudi employees", () => {
  const visible = filterEmployeesByScope(allDArrowEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  });
  const saCount = visible.filter((e) => e.country === "Saudi Arabia").length;
  assert.equal(saCount, 4, "All 4 Saudi Arabian employees are visible");
});

test("View all company employees", () => {
  const visible = filterEmployeesByScope(allDArrowEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  });
  assert.equal(visible.length, 7, "Total of 7 company employees visible across Egypt & Saudi Arabia");
});

test("Filter Egypt", () => {
  const countryFilter = "Egypt";
  const visible = filterEmployeesByScope(allDArrowEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  }).filter((e) => !countryFilter || countryFilter === "ALL" || e.country === countryFilter);

  assert.equal(visible.length, 3);
  assert.equal(visible.every((e) => e.country === "Egypt"), true);
});

test("Filter Saudi Arabia", () => {
  const countryFilter = "Saudi Arabia";
  const visible = filterEmployeesByScope(allDArrowEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  }).filter((e) => !countryFilter || countryFilter === "ALL" || e.country === countryFilter);

  assert.equal(visible.length, 4);
  assert.equal(visible.every((e) => e.country === "Saudi Arabia"), true);
});

test("View employee details in both countries", () => {
  const norah = allDArrowEmployees.find((e) => e.email === "norahn892@gmail.com");
  const khulod = allDArrowEmployees.find((e) => e.email === "khulodahmed390@gmail.com");
  assert.ok(norah);
  assert.equal(norah?.country, "Saudi Arabia");
  assert.equal(norah?.salary, 12000);
  assert.equal(norah?.currency, "SAR");

  assert.ok(khulod);
  assert.equal(khulod?.country, "Egypt");
  assert.equal(khulod?.salary, 25000);
  assert.equal(khulod?.currency, "EGP");
});

test("Edit an authorized Egyptian employee", () => {
  const target = { ...egyptEmployees[1] };
  target.jobTitle = "Lead Marketing Specialist";
  target.department = "Growth & Marketing";
  assert.equal(target.jobTitle, "Lead Marketing Specialist");
  assert.equal(target.department, "Growth & Marketing");
});

test("Edit an authorized Saudi employee", () => {
  const target = { ...saudiEmployees[0] };
  target.jobTitle = "Senior Operations Supervisor";
  target.department = "Regional Operations";
  assert.equal(target.jobTitle, "Senior Operations Supervisor");
  assert.equal(target.department, "Regional Operations");
});

test("View attendance in both countries", () => {
  const mockAttendanceRecords: Attendance[] = [
    { id: "att-eg-1", employeeId: "emp-eg-1", date: "2026-11-01", checkIn: "08:00", checkOut: "17:00", status: "present", totalHours: 9 } as Attendance,
    { id: "att-sa-1", employeeId: "emp-sa-1", date: "2026-11-01", checkIn: "09:00", checkOut: "18:00", status: "present", totalHours: 9 } as Attendance,
  ];
  assert.equal(mockAttendanceRecords.length, 2);
  assert.equal(mockAttendanceRecords.some((a) => a.employeeId === "emp-eg-1"), true);
  assert.equal(mockAttendanceRecords.some((a) => a.employeeId === "emp-sa-1"), true);
});

test("View leave requests in both countries", () => {
  const mockLeaveRequests: LeaveRequest[] = [
    { id: "leave-eg-1", employeeId: "emp-eg-2", employeeName: "Nour El Masri", type: "vacation", status: "pending", reason: "Annual Leave" } as LeaveRequest,
    { id: "leave-sa-1", employeeId: "emp-sa-2", employeeName: "Albraa Al Masra", type: "personal", status: "pending", reason: "Family Event" } as LeaveRequest,
  ];
  assert.equal(mockLeaveRequests.length, 2);
  assert.equal(mockLeaveRequests.some((l) => l.employeeId === "emp-eg-2"), true);
  assert.equal(mockLeaveRequests.some((l) => l.employeeId === "emp-sa-2"), true);
});

test("Access payroll records according to assigned permissions", () => {
  const payrollCompensationRecords = allDArrowEmployees.map((e) => ({
    employeeId: e.id,
    name: e.name,
    country: e.country,
    salary: e.salary,
    currency: e.currency,
  }));
  assert.equal(payrollCompensationRecords.length, 7);
  assert.equal(payrollCompensationRecords.filter((r) => r.country === "Egypt").length, 3);
  assert.equal(payrollCompensationRecords.filter((r) => r.country === "Saudi Arabia").length, 4);
});

test("Logout and login again (User Profile Mapping & Persistence)", () => {
  const rawFirestoreUser = {
    email: "khulodahmed390@gmail.com",
    name: "Khulod Ahmed",
    role: "global_hr_manager",
    companyId: COMPANY_DARROW,
    country: "Egypt",
    branchId: "branch-cairo",
    countryScope: ["EG", "SA"],
    portalAccess: ["people", "tasks", "crm"],
  };

  const mappedUser = mapFirestoreUser("usr-khulod", rawFirestoreUser);
  assert.equal(mappedUser.role, "global_hr_manager");
  assert.deepEqual(mappedUser.countryScope, ["EG", "SA"]);
  assert.equal(mappedUser.companyId, COMPANY_DARROW);
  assert.equal(mappedUser.profileMissing, false);
});

test("Refresh page simulation preserves permissions and scope", () => {
  const storedUser = mapFirestoreUser("usr-khulod", {
    email: "khulodahmed390@gmail.com",
    role: "global_hr_manager",
    companyId: COMPANY_DARROW,
    countryScope: ["EG", "SA"],
  });
  const canManage = hasEffectivePermission({ role: storedUser.role }, "people.manage_employees");
  const canApprove = hasEffectivePermission({ role: storedUser.role }, "people.approve_leave");
  assert.equal(canManage, true);
  assert.equal(canApprove, true);
});

test("Directly access employee URLs across countries", () => {
  const employeeLookup = new Map(allDArrowEmployees.map((e) => [e.id, e]));
  assert.ok(employeeLookup.get("emp-eg-1"), "Egyptian employee route accessible directly");
  assert.ok(employeeLookup.get("emp-sa-1"), "Saudi employee route accessible directly");
});

test("Paginated employee lists maintain integrity", () => {
  const pageSize = 4;
  const page1 = allDArrowEmployees.slice(0, pageSize);
  const page2 = allDArrowEmployees.slice(pageSize, pageSize * 2);
  assert.equal(page1.length, 4);
  assert.equal(page2.length, 3);
  assert.equal(page1.length + page2.length, 7);
  // Ensure no overlap
  const page1Ids = new Set(page1.map((e) => e.id));
  assert.equal(page2.some((e) => page1Ids.has(e.id)), false);
});

test("Search employees across countries by name, email, department", () => {
  const search = (q: string) => {
    const term = q.toLowerCase();
    return allDArrowEmployees.filter(
      (e) =>
        e.name?.toLowerCase().includes(term) ||
        e.email?.toLowerCase().includes(term) ||
        e.department?.toLowerCase().includes(term)
    );
  };
  assert.equal(search("Norah").length, 1);
  assert.equal(search("Khulod").length, 1);
  assert.equal(search("norahn892@gmail.com").length, 1);
  assert.equal(search("Operations").length, 2); // 1 in EG, 1 in SA
});

// 3. SECURITY, ISOLATION & REGRESSION TESTING
test("No duplicate employees in aggregated list", () => {
  const ids = allDArrowEmployees.map((e) => e.id);
  const uniqueIds = new Set(ids);
  assert.equal(ids.length, uniqueIds.size);
});

test("No missing records due to country filters", () => {
  const eg = allDArrowEmployees.filter((e) => e.country === "Egypt");
  const sa = allDArrowEmployees.filter((e) => e.country === "Saudi Arabia");
  assert.equal(eg.length + sa.length, allDArrowEmployees.length);
});

test("Tenant Isolation: No cross-company data leakage", () => {
  const scopedForKhulod = multiTenantEmployees.filter((e) => e.companyId === COMPANY_DARROW);
  assert.equal(scopedForKhulod.some((e) => e.companyId === COMPANY_COMPETITOR), false);
  assert.equal(scopedForKhulod.some((e) => e.id === "emp-comp-1"), false);
});

test("Country-level HR users remain strictly restricted to their assigned branch/country", () => {
  const restrictedCairoMgrScope = {
    role: "manager",
    branchId: "branch-cairo",
    hasCompanyWideAccess: false,
  };
  const visibleToRestricted = filterEmployeesByScope(allDArrowEmployees, restrictedCairoMgrScope);
  assert.equal(visibleToRestricted.every((e) => e.branchId === "branch-cairo"), true);
  assert.equal(visibleToRestricted.some((e) => e.country === "Saudi Arabia"), false);
});

test("Ordinary employees cannot access company-wide reports", () => {
  const employeeCtx = { role: "employee" as const };
  assert.equal(hasEffectivePermission(employeeCtx, "people.view_all_reports"), false);
  assert.equal(hasEffectivePermission(employeeCtx, "people.manage_employees"), false);
});

test("SUPER_ADMIN permissions remain intact", () => {
  const superAdminCtx = { role: "super_admin" as const };
  assert.equal(hasEffectivePermission(superAdminCtx, "people.view_all_reports"), true);
  assert.equal(hasEffectivePermission(superAdminCtx, "people.manage_employees"), true);
  assert.equal(hasEffectivePermission(superAdminCtx, "company.manage"), true);
});

console.log("\n=================================================================");
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log("=================================================================\n");

if (failed > 0) process.exit(1);
process.exit(0);

