import { STORAGE_KEYS } from "@/lib/constants";
import type { PortalId } from "@/lib/portal-permissions";
import { useAuthStore } from "@/stores/auth.store";
import type { UserRole } from "@/features/auth/types/auth.types";
import {
  canAccessPortal,
  getAccessiblePortals,
  PORTAL_PATHS,
} from "@/lib/portal-permissions";
import { portalAllowedForActivity, type ActivityConfigState } from "@/lib/activity-routes";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";

export function getLastPortal(): PortalId | null {
  const v = localStorage.getItem(STORAGE_KEYS.LAST_PORTAL);
  if (
    v === "tasks" ||
    v === "crm" ||
    v === "people" ||
    v === "billing" ||
    v === "chat" ||
    v === "projects" ||
    v === "facilities" ||
    v === "agency"
  ) {
    return v;
  }
  return null;
}

export function setLastPortal(portal: PortalId): void {
  localStorage.setItem(STORAGE_KEYS.LAST_PORTAL, portal);
}

/**
 * Role/permission portals INTERSECTED with the tenant's active activity:
 * an app owned by an inactive activity is absent from this list entirely —
 * it powers the picker, the launcher, the sidebar and every PortalGuard, so
 * hiding and access control resolve from the same decision function. While
 * the configuration is unresolved only shared apps are listed (fail closed).
 */
export function useAccessiblePortals() {
  const user = useAuthStore((s) => s.user);
  const config = useActivityConfig();
  return getAccessiblePortals(user?.role, user?.portalAccess).filter((portal) =>
    portalAllowedForActivity(portal, config),
  );
}

export function useCanAccessPortal(portal: PortalId) {
  const user = useAuthStore((s) => s.user);
  const config = useActivityConfig();
  return (
    canAccessPortal(user?.role, portal, user?.portalAccess) &&
    portalAllowedForActivity(portal, config)
  );
}

export function getLastPortalPath(
  role: UserRole | undefined,
  portalAccess: PortalId[] | null | undefined,
  config: ActivityConfigState
): string | null {
  const last = getLastPortal();
  // A remembered portal is only restored when it is BOTH permitted for the
  // user and owned by the active activity — after an activity switch the
  // stale memory is ignored instead of routing somewhere now denied.
  if (
    last &&
    canAccessPortal(role, last, portalAccess) &&
    portalAllowedForActivity(last, config)
  ) {
    return PORTAL_PATHS[last];
  }
  return null;
}

export function useLastPortalPath(): string | null {
  const user = useAuthStore((s) => s.user);
  const config = useActivityConfig();
  if (!user) return null;
  return getLastPortalPath(user.role, user.portalAccess, config);
}
