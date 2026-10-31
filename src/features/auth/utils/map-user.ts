import type { User } from "../types/auth.types";
import type { PortalId } from "@/lib/portal-permissions";
import { parsePortalSubRoles } from "@/lib/permissions/sub-roles";

export function parsePortalAccess(raw: unknown): PortalId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter(
    (p): p is PortalId =>
      p === "tasks" ||
      p === "crm" ||
      p === "people" ||
      p === "billing" ||
      p === "chat"
  );
  return valid.length ? valid : undefined;
}

export function parseCustomPermissions(raw: unknown): import("@/lib/permissions").Permission[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw as import("@/lib/permissions").Permission[];
}

export function mapFirestoreUser(
  id: string,
  data: Record<string, unknown> | undefined,
  fallbacks: Partial<User> = {}
): User {
  return {
    id,
    email: (data?.email as string) || fallbacks.email || "",
    name:
      (data?.name as string) ||
      fallbacks.name ||
      fallbacks.email?.split("@")[0] ||
      "User",
    nameAr: (data?.nameAr as string) || fallbacks.nameAr || "",
    avatar: (data?.avatar as string) || fallbacks.avatar || "",
    role: (data?.role as User["role"]) || fallbacks.role || "employee",
    // No fabricated tenant: when the profile document is missing (or predates
    // `companyId`) the user maps to an EMPTY company with `profileMissing`.
    // Demo mock-user matching used to silently graft a real login onto the
    // seeded "d-arrow" workspace, which made orphan accounts invisible in the
    // Users page instead of surfacing them for reconciliation.
    companyId: (data?.companyId as string) || fallbacks.companyId || "",
    companyName:
      (data?.companyName as string) || fallbacks.companyName || "",
    profileMissing: data === undefined,
    portalAccess: parsePortalAccess(data?.portalAccess),
    portalSubRoles: parsePortalSubRoles(data?.portalSubRoles),
    customPermissions: parseCustomPermissions(data?.customPermissions),
  };
}
