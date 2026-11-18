import type { UserRole } from "@/features/auth/types/auth.types";
import type { Permission } from "./index";
import { hasPermission, ROLE_PERMISSIONS } from "./index";
import {
  getSubRolePermissions,
  permissionPortal,
  resolvePortalSubRole,
  type PortalSubRoles,
} from "./sub-roles";

export interface PermissionContext {
  role: UserRole | string | undefined;
  portalSubRoles?: PortalSubRoles | null;
  customPermissions?: Permission[] | null;
}

export function hasEffectivePermission(
  ctx: PermissionContext,
  permission: Permission
): boolean {
  const { role, portalSubRoles, customPermissions } = ctx;
  if (!role) return false;
  const normalizedRole = role.toLowerCase() as UserRole;

  if (normalizedRole === "platform_admin" || normalizedRole === "super_admin") {
    return (ROLE_PERMISSIONS[normalizedRole] ?? []).includes(permission);
  }

  // Explicit custom permission override granted to individual user
  if (customPermissions && customPermissions.includes(permission)) {
    return true;
  }

  const portal = permissionPortal(permission);
  if (portal) {
    const subRole = resolvePortalSubRole(portal, normalizedRole, portalSubRoles);
    if (subRole) {
      const subAllowed = getSubRolePermissions(portal, subRole).includes(permission);
      if (!subAllowed) return false;
    }
  }

  return hasPermission(normalizedRole, permission);
}

export function hasAnyEffectivePermission(
  ctx: PermissionContext,
  permissions: readonly Permission[]
): boolean {
  return permissions.some((p) => hasEffectivePermission(ctx, p));
}
