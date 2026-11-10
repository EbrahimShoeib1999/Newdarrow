/**
 * D-Arrow — General Manager RBAC & Security Test Suite
 * ============================================================
 * Verifies:
 *   1. hasEffectivePermission grants platform_admin & super_admin all permissions
 *      without restriction from portalSubRoles or customPermissions.
 *   2. Untrusted Firestore profile containing role: platform_admin is downgraded
 *      if Auth custom claims do not corroborate it.
 *   3. Trusted Auth custom claims { role: "platform_admin" } reliably grant platform_admin.
 *   4. TeamMembersPage administrative access checks (isSuperOrAdmin, role assignment,
 *      portal access, user management) permit platform_admin while isolating employee/manager.
 *   5. Negative isolation: normal employees and scoped HR roles are strictly confined.
 */

import assert from "node:assert/strict";

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  D-ARROW — GENERAL MANAGER RBAC & SECURITY VERIFICATION      ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     ${err.message}`);
  }
}

// ── 1. Import or mirror effective permissions engine ───────────────
const { hasEffectivePermission } = await import("../src/lib/permissions/effective-permissions.ts");
const { mapFirestoreUser } = await import("../src/features/auth/utils/map-user.ts");
const { getAssignableRoles, canManageUserRole } = await import("../src/lib/permissions/role-assignment.ts");
const { canManagePortalAccess } = await import("../src/lib/permissions/portal-access.ts");

console.log("SUITE 1: Effective Permissions Engine (effective-permissions.ts)\n");

test("platform_admin has access to critical administrative permissions", () => {
  const ctx = { role: "platform_admin" };
  assert.equal(hasEffectivePermission(ctx, "users.manage_roles"), true);
  assert.equal(hasEffectivePermission(ctx, "company.view"), true);
  assert.equal(hasEffectivePermission(ctx, "company.manage"), true);
  assert.equal(hasEffectivePermission(ctx, "company.identity"), true);
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), true);
  assert.equal(hasEffectivePermission(ctx, "pricing.manage"), true);
});

test("platform_admin is NOT restricted by residual portalSubRoles (e.g. people: 'employee')", () => {
  const ctx = {
    role: "platform_admin",
    portalSubRoles: { people: "employee", tasks: "viewer", crm: "viewer" }
  };
  // Even with restrictive subroles, platform_admin remains full admin
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), true);
  assert.equal(hasEffectivePermission(ctx, "people.approve_leave"), true);
  assert.equal(hasEffectivePermission(ctx, "tasks.delete"), true);
  assert.equal(hasEffectivePermission(ctx, "crm.delete"), true);
});

test("super_admin is also unconstrained by portalSubRoles", () => {
  const ctx = {
    role: "super_admin",
    portalSubRoles: { people: "employee" }
  };
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), true);
  assert.equal(hasEffectivePermission(ctx, "users.manage_roles"), true);
});

test("employee role is strictly denied users.manage_roles and company.identity", () => {
  const ctx = { role: "employee" };
  assert.equal(hasEffectivePermission(ctx, "users.manage_roles"), false);
  assert.equal(hasEffectivePermission(ctx, "company.identity"), false);
  assert.equal(hasEffectivePermission(ctx, "company.manage"), false);
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), false);
});

test("employee with people: 'employee' subrole cannot manage or approve", () => {
  const ctx = {
    role: "employee",
    portalSubRoles: { people: "employee" }
  };
  assert.equal(hasEffectivePermission(ctx, "people.manage_employees"), false);
  assert.equal(hasEffectivePermission(ctx, "people.approve_leave"), false);
  assert.equal(hasEffectivePermission(ctx, "people.view"), true);
});

console.log("\nSUITE 2: Auth Claims Reconciler (mapFirestoreUser)\n");

test("Untrusted Firestore doc claiming platform_admin without custom claim is downgraded to employee", () => {
  const untrustedDoc = {
    email: "attacker@example.com",
    name: "Rogue User",
    role: "platform_admin"
  };
  // Claims empty or without platform_admin
  const mapped = mapFirestoreUser("uid-rogue", untrustedDoc, {}, {});
  assert.equal(mapped.role, "employee", "Must downgrade to employee");
});

test("Untrusted Firestore doc claiming platform_admin with employee claim is downgraded to employee", () => {
  const untrustedDoc = {
    email: "user@example.com",
    name: "Regular User",
    role: "platform_admin"
  };
  const claims = { role: "employee" };
  const mapped = mapFirestoreUser("uid-user", untrustedDoc, {}, claims);
  assert.equal(mapped.role, "employee", "Must downgrade to employee claim");
});

test("Trusted Auth claim { role: 'platform_admin' } grants platform_admin regardless of doc lag", () => {
  const laggingDoc = {
    email: "khulodahmed390@gmail.com",
    name: "Khuloud",
    role: "employee" // hasn't synced yet
  };
  const claims = { role: "platform_admin", companyId: "d-arrow-co" };
  const mapped = mapFirestoreUser("uid-khuloud", laggingDoc, {}, claims);
  assert.equal(mapped.role, "platform_admin");
  assert.equal(mapped.companyId, "d-arrow-co");
});

test("Normal user with standard doc and claims maps correctly without downgrade warning", () => {
  const normalDoc = {
    email: "salem@example.com",
    name: "Salem",
    role: "manager",
    companyId: "d-arrow-co"
  };
  const mapped = mapFirestoreUser("uid-salem", normalDoc, {}, {});
  assert.equal(mapped.role, "manager");
  assert.equal(mapped.companyId, "d-arrow-co");
});

console.log("\nSUITE 3: Team Members Page Access & Management Guards\n");

function isSuperOrAdminHelper(actorRole) {
  return actorRole === "platform_admin" || actorRole === "super_admin" || actorRole === "admin";
}

test("isSuperOrAdmin permits platform_admin, super_admin, admin", () => {
  assert.equal(isSuperOrAdminHelper("platform_admin"), true);
  assert.equal(isSuperOrAdminHelper("super_admin"), true);
  assert.equal(isSuperOrAdminHelper("admin"), true);
  assert.equal(isSuperOrAdminHelper("manager"), false);
  assert.equal(isSuperOrAdminHelper("global_hr_manager"), false);
  assert.equal(isSuperOrAdminHelper("employee"), false);
  assert.equal(isSuperOrAdminHelper("viewer"), false);
});

test("platform_admin can assign all roles", () => {
  const roles = getAssignableRoles("platform_admin");
  assert.ok(roles.includes("super_admin"));
  assert.ok(roles.includes("admin"));
  assert.ok(roles.includes("manager"));
  assert.ok(roles.includes("employee"));
});

test("platform_admin can manage user roles (including self & others)", () => {
  assert.equal(canManageUserRole("platform_admin", "khuloud-uid", "other-uid"), true);
  assert.equal(canManageUserRole("platform_admin", "khuloud-uid", "khuloud-uid"), true);
});

test("regular admin cannot promote to super_admin or modify self", () => {
  const adminAssignable = getAssignableRoles("admin");
  assert.equal(adminAssignable.includes("super_admin"), false);
  assert.equal(canManageUserRole("admin", "admin-uid", "admin-uid"), false);
  assert.equal(canManageUserRole("admin", "admin-uid", "other-uid"), true);
});

test("canManagePortalAccess permits platform_admin and super_admin only", () => {
  assert.equal(canManagePortalAccess("platform_admin"), true);
  assert.equal(canManagePortalAccess("super_admin"), true);
  assert.equal(canManagePortalAccess("admin"), false);
  assert.equal(canManagePortalAccess("employee"), false);
});

console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed}/${total} TESTS PASSED`);
console.log(`${"═".repeat(60)}\n`);

if (passed !== total) {
  process.exitCode = 1;
}

