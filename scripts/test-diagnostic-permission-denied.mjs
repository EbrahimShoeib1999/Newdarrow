/**
 * Diagnostic Verification Script
 * ============================================================
 * Simulates and proves the exact code path causing:
 * "الوصول مرفوض — ليس لديك صلاحية للوصول إلى هذه الصفحة"
 */

import assert from "node:assert/strict";

// Mirror of ROLE_PERMISSIONS
const ALL_PERMISSIONS = [
  "company.view", "company.manage", "company.identity",
  "users.manage_roles", "pricing.view", "pricing.manage",
  "portals.tasks", "portals.crm", "portals.people", "portals.billing"
];

const ROLE_PERMISSIONS = {
  platform_admin: ALL_PERMISSIONS,
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(p => p !== "company.identity"),
  employee: ["portals.tasks", "portals.crm", "portals.people", "tasks.view", "people.view"]
};

function hasPermission(role, permission) {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// Current implementation of hasEffectivePermission in src/lib/permissions/effective-permissions.ts
function currentHasEffectivePermission(ctx, permission) {
  const { role, portalSubRoles } = ctx;
  if (!role) return false;

  // BUG: Only super_admin is checked, platform_admin is missing!
  if (role === "super_admin") {
    return ROLE_PERMISSIONS.super_admin.includes(permission);
  }

  // If subroles exist for a portal (e.g. people: "member")
  if (portalSubRoles && permission.startsWith("people.")) {
    const subRole = portalSubRoles.people;
    if (subRole === "member") {
      const memberPerms = ["people.view"];
      if (!memberPerms.includes(permission)) return false;
    }
  }

  return hasPermission(role, permission);
}

// Fixed implementation
function fixedHasEffectivePermission(ctx, permission) {
  const { role, portalSubRoles } = ctx;
  if (!role) return false;

  // FIX: Include platform_admin alongside super_admin
  if (role === "platform_admin" || role === "super_admin") {
    return true;
  }

  if (portalSubRoles && permission.startsWith("people.")) {
    const subRole = portalSubRoles.people;
    if (subRole === "member") {
      const memberPerms = ["people.view"];
      if (!memberPerms.includes(permission)) return false;
    }
  }

  return hasPermission(role, permission);
}

console.log("\n============================================================");
console.log(" DIAGNOSTIC EXECUTION: PERMISSION GUARD EVALUATION");
console.log("============================================================\n");

// Scenario 1: Khuloud's current state on Production (role: employee)
const khuloudCurrentState = {
  role: "employee",
  portalSubRoles: { people: "member" }
};

const canManageRolesCurrent = currentHasEffectivePermission(khuloudCurrentState, "users.manage_roles");
console.log(`1. Khuloud as 'employee' requesting 'users.manage_roles':`);
console.log(`   Result: ${canManageRolesCurrent ? "ALLOWED" : "DENIED (Triggers 'الوصول مرفوض')"}`);
assert.equal(canManageRolesCurrent, false);

const canManageCompanyCurrent = currentHasEffectivePermission(khuloudCurrentState, "company.manage");
console.log(`2. Khuloud as 'employee' requesting 'company.manage':`);
console.log(`   Result: ${canManageCompanyCurrent ? "ALLOWED" : "DENIED (Triggers 'الوصول مرفوض')"}`);
assert.equal(canManageCompanyCurrent, false);

// Scenario 2: What happens if role is changed to platform_admin but effective-permissions.ts is NOT fixed?
const khuloudPlatformAdminWithSubrole = {
  role: "platform_admin",
  portalSubRoles: { people: "member" } // residual subrole from employee profile
};

const bugResult = currentHasEffectivePermission(khuloudPlatformAdminWithSubrole, "people.manage_employees");
console.log(`\n3. Khuloud as 'platform_admin' with residual subrole (CURRENT CODE):`);
console.log(`   Requesting 'people.manage_employees': ${bugResult ? "ALLOWED" : "BUG: DENIED because platform_admin wasn't in line 24!"}`);
assert.equal(bugResult, false, "Proves the bug in effective-permissions.ts");

// Scenario 3: With the fix applied
const fixResult = fixedHasEffectivePermission(khuloudPlatformAdminWithSubrole, "people.manage_employees");
console.log(`\n4. Khuloud as 'platform_admin' with residual subrole (WITH PROPOSED FIX):`);
console.log(`   Requesting 'people.manage_employees': ${fixResult ? "ALLOWED (Clean Global Access)" : "DENIED"}`);
assert.equal(fixResult, true);

console.log("\n============================================================");
console.log(" DIAGNOSTIC PROOF COMPLETED SUCCESSFULLY");
console.log("============================================================\n");

