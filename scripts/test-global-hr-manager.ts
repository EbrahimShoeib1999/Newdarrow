import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { filterEmployeesByScope } from "../src/features/people/api/people.service";
import { hasEffectivePermission } from "../src/lib/permissions/effective-permissions";
import type { Employee } from "../src/features/people/types/people.types";

const egyptEmployees: Employee[] = [
  {
    id: "emp-eg-1",
    name: "Nour El Masri",
    country: "Egypt",
    branchId: "branch-cairo",
    managerId: "mgr-cairo",
    email: "nour@darrow.test",
    companyId: "co-darrow",
    workMode: "office",
    role: "employee",
    department: "Operations",
    status: "active",
  } as Employee,
  {
    id: "emp-eg-2",
    name: "Hassan Farouk",
    country: "Egypt",
    branchId: "branch-cairo",
    managerId: "mgr-cairo",
    email: "hassan@darrow.test",
    companyId: "co-darrow",
    workMode: "remote",
    role: "employee",
    department: "HR",
    status: "active",
  } as Employee,
];

const saudiEmployees: Employee[] = [
  {
    id: "emp-sa-1",
    name: "Norah Al Otaibi",
    country: "Saudi Arabia",
    branchId: "branch-riyadh",
    managerId: "mgr-riyadh",
    email: "norah@darrow.test",
    companyId: "co-darrow",
    workMode: "office",
    role: "employee",
    department: "Operations",
    status: "active",
  } as Employee,
  {
    id: "emp-sa-2",
    name: "Aisha Al Harthi",
    country: "Saudi Arabia",
    branchId: "branch-jeddah",
    managerId: "mgr-jeddah",
    email: "aisha@darrow.test",
    companyId: "co-darrow",
    workMode: "remote",
    role: "employee",
    department: "Finance",
    status: "active",
  } as Employee,
];

const allEmployees = [...egyptEmployees, ...saudiEmployees];

assert.equal(
  hasEffectivePermission({ role: "global_hr_manager" }, "people.view_all_reports"),
  true,
  "Global HR manager inherits people.view_all_reports"
);
assert.equal(
  hasEffectivePermission({ role: "global_hr_manager" }, "people.manage_employees"),
  true,
  "Global HR manager can manage employees"
);
assert.equal(
  hasEffectivePermission({ role: "global_hr_manager" }, "people.view_all_attendance"),
  true,
  "Global HR manager can view all attendance"
);
assert.equal(
  hasEffectivePermission({ role: "global_hr_manager" }, "people.approve_leave"),
  true,
  "Global HR manager can approve leave"
);

const globalScopeVisible = filterEmployeesByScope(allEmployees, {
  role: "global_hr_manager",
  countryScope: ["EG", "SA"],
  hasCompanyWideAccess: false,
});
assert.equal(
  globalScopeVisible.length,
  allEmployees.length,
  "Global HR manager sees employees in Egypt and Saudi Arabia"
);

const egyptOnlyVisible = filterEmployeesByScope(allEmployees, {
  role: "global_hr_manager",
  countryScope: ["EG"],
  hasCompanyWideAccess: false,
});
assert.equal(
  egyptOnlyVisible.every((employee) => employee.country === "Egypt"),
  true,
  "Explicit country scope enforces Egypt-only visibility"
);
assert.equal(
  egyptOnlyVisible.some((employee) => employee.country === "Saudi Arabia"),
  false,
  "Egypt-only scope excludes Saudi Arabia"
);

const unauthorizedCountryVisible = filterEmployeesByScope(allEmployees, {
  role: "global_hr_manager",
  countryScope: ["AE"],
  hasCompanyWideAccess: false,
});
assert.equal(
  unauthorizedCountryVisible.length,
  0,
  "Unauthorized country scope denies visibility"
);

assert.equal(
  filterEmployeesByScope(allEmployees, {
    role: "global_hr_manager",
    countryScope: [],
    hasCompanyWideAccess: false,
  }).length,
  0,
  "Missing countryScope is rejected instead of granting global visibility"
);

const branchRestricted = filterEmployeesByScope(allEmployees, {
  role: "employee",
  branchId: "branch-cairo",
  hasCompanyWideAccess: false,
});
assert.equal(
  branchRestricted.every((employee) => employee.branchId === "branch-cairo"),
  true,
  "Branch-scoped employees remain limited to their branch"
);
assert.equal(
  filterEmployeesByScope(allEmployees, {
    role: "global_hr_manager",
    countryScope: ["EG", "SA"],
    hasCompanyWideAccess: true,
  }).length,
  allEmployees.length,
  "Company-wide permissions keep global HR access enabled"
);

assert.equal(
  hasEffectivePermission({ role: "super_admin" }, "people.view_all_reports"),
  true,
  "Super admins retain their existing access"
);
assert.equal(
  hasEffectivePermission({ role: "admin" }, "people.view_all_reports"),
  true,
  "Admins retain their existing access"
);
assert.equal(
  hasEffectivePermission({ role: "employee" }, "people.view_all_reports"),
  false,
  "Employees cannot view all reports without permission"
);

console.log("PASS: global HR manager authorization checks passed");
process.exit(0);

