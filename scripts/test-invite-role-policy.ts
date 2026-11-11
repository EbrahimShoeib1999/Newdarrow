import assert from "node:assert/strict";
import {
  INVITABLE_ROLES,
  canInviteRole,
  canManageInviteRole,
  getAssignableInviteRoles,
} from "../src/lib/permissions/role-assignment";

const expectedInvitableRoles = [
  "employee",
  "viewer",
  "manager",
  "global_hr_manager",
] as const;

assert.deepEqual(INVITABLE_ROLES, expectedInvitableRoles);
assert.deepEqual(getAssignableInviteRoles("platform_admin"), expectedInvitableRoles);
assert.deepEqual(getAssignableInviteRoles("super_admin"), expectedInvitableRoles);
assert.deepEqual(getAssignableInviteRoles("admin"), expectedInvitableRoles);
assert.deepEqual(getAssignableInviteRoles("global_hr_manager"), [
  "employee",
  "viewer",
]);
assert.deepEqual(getAssignableInviteRoles("employee"), []);

assert.equal(canInviteRole("admin", "manager"), true);
assert.equal(canInviteRole("platform_admin", "employee"), true);
assert.equal(canInviteRole("platform_admin", "admin"), false);
assert.equal(canInviteRole("platform_admin", "super_admin"), false);
assert.equal(canInviteRole("global_hr_manager", "employee"), true);
assert.equal(canInviteRole("global_hr_manager", "manager"), false);
assert.equal(canInviteRole("employee", "employee"), false);
assert.equal(canInviteRole("admin", "not-a-role"), false);

assert.equal(canManageInviteRole("platform_admin", "manager"), true);
assert.equal(canManageInviteRole("admin", "global_hr_manager"), true);
assert.equal(canManageInviteRole("global_hr_manager", "employee"), true);
assert.equal(canManageInviteRole("global_hr_manager", "manager"), false);
assert.equal(canManageInviteRole("employee", "employee"), false);

console.log("PASS invite role policy: UI, service, and built-in permission policy agree");
