import type { UserRole } from "@/features/auth/types/auth.types";

const ALL_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "manager",
  "global_hr_manager",
  "employee",
  "viewer",
];

export const INVITABLE_ROLES = [
  "employee",
  "viewer",
  "manager",
  "global_hr_manager",
] as const satisfies readonly UserRole[];

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: unknown): role is InvitableRole {
  return (
    typeof role === "string" &&
    (INVITABLE_ROLES as readonly string[]).includes(role)
  );
}

/** Roles the actor may assign to another user. */
export function getAssignableRoles(actorRole: UserRole | undefined): UserRole[] {
  if (actorRole === "platform_admin" || actorRole === "super_admin") return ALL_ROLES;
  if (actorRole === "admin") {
    return ALL_ROLES.filter((r) => r !== "super_admin");
  }
  if (actorRole === "global_hr_manager") {
    return ["employee", "viewer"];
  }
  return [];
}

/** Roles the actor may invite, limited to roles accepted by Firestore rules. */
export function getAssignableInviteRoles(
  actorRole: UserRole | undefined
): InvitableRole[] {
  const assignable = new Set(getAssignableRoles(actorRole));
  return INVITABLE_ROLES.filter((role) => assignable.has(role));
}

export function canInviteRole(
  actorRole: UserRole | undefined,
  role: unknown
): role is InvitableRole {
  return isInvitableRole(role) && canAssignRole(actorRole, role);
}

/** Mirrors the invite delete branch in firestore.rules. */
export function canManageInviteRole(
  actorRole: UserRole | undefined,
  inviteRole: unknown
): boolean {
  if (
    actorRole === "platform_admin" ||
    actorRole === "super_admin" ||
    actorRole === "admin"
  ) {
    return true;
  }
  return (
    actorRole === "global_hr_manager" &&
    (inviteRole === "employee" || inviteRole === "viewer")
  );
}

export function canAssignRole(
  actorRole: UserRole | undefined,
  newRole: UserRole
): boolean {
  return getAssignableRoles(actorRole).includes(newRole);
}

export function canManageUserRole(
  actorRole: UserRole | undefined,
  actorId: string,
  targetUserId: string
): boolean {
  if (!getAssignableRoles(actorRole).length) return false;
  // Platform admin and super admin can change anyone; others cannot change their own role here
  if (actorRole === "platform_admin" || actorRole === "super_admin") return true;
  return actorId !== targetUserId;
}
