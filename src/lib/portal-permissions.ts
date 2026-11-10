import type { UserRole } from "@/features/auth/types/auth.types";
import {
  canUserAccessPortal,
  resolveUserPortals,
} from "@/lib/permissions/portal-access";

export type PortalId = "tasks" | "crm" | "people" | "billing" | "chat" | "projects" | "facilities" | "agency" | "real_estate" | "school" | "custom_modules";

export const PORTAL_PATHS: Record<PortalId, string> = {
  tasks: "/tasks",
  crm: "/crm",
  people: "/people",
  billing: "/billing",
  chat: "/chat",
  projects: "/projects",
  facilities: "/facilities",
  agency: "/agency",
  real_estate: "/real-estate",
  // Student records are a sensitive domain (sch_* collections): the Firestore
  // rules only admit admin/manager, so the portal grant stops at manager too —
  // an employee granted here would pass the nav and fail every write.
  school: "/school",
  custom_modules: "/modules",
};

/** @deprecated Use ROLE_PERMISSIONS from @/lib/permissions */
export const PORTAL_ACCESS: Record<PortalId, readonly UserRole[]> = {
  tasks: ["platform_admin", "super_admin", "admin", "manager", "employee"],
  crm: ["platform_admin", "super_admin", "admin", "manager", "employee", "viewer"],
  people: ["platform_admin", "super_admin", "admin", "manager", "global_hr_manager", "employee"],
  billing: ["platform_admin", "super_admin", "admin", "manager"],
  chat: ["platform_admin", "super_admin", "admin", "manager", "employee", "viewer"],
  projects: ["platform_admin", "super_admin", "admin", "manager", "employee"],
  facilities: ["platform_admin", "super_admin", "admin", "manager", "employee"],
  agency: ["platform_admin", "super_admin", "admin", "manager", "employee"],
  real_estate: ["platform_admin", "super_admin", "admin", "manager", "employee"],
  school: ["platform_admin", "super_admin", "admin", "manager"],
  custom_modules: ["platform_admin", "super_admin", "admin", "manager", "employee"],
};

export function canAccessPortal(
  role: UserRole | undefined,
  portal: PortalId,
  portalAccess?: PortalId[] | null
): boolean {
  return canUserAccessPortal(role, portal, portalAccess);
}

export function getAccessiblePortals(
  role: UserRole | undefined,
  portalAccess?: PortalId[] | null
): PortalId[] {
  return resolveUserPortals(role, portalAccess);
}

export function getPortalFromPath(pathname: string): PortalId | "picker" | "settings" | null {
  if (pathname === "/" || pathname === "" || pathname === "/apps") return "picker";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/billing")) return "billing";
  if (pathname.startsWith("/chat")) return "chat";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/facilities")) return "facilities";
  if (pathname.startsWith("/agency")) return "agency";
  if (pathname.startsWith("/real-estate")) return "real_estate";
  if (pathname.startsWith("/school")) return "school";
  if (pathname.startsWith("/modules")) return "custom_modules";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname === "/profile" || pathname === "/notifications" || pathname === "/seed") return null;
  return null;
}

export function getDefaultPortalPath(
  role: UserRole | undefined,
  portalAccess?: PortalId[] | null
): string {
  const portals = getAccessiblePortals(role, portalAccess);
  if (portals.length === 1) return PORTAL_PATHS[portals[0]];
  return "/";
}
