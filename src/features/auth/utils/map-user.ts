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

import { mockUsers } from "@/mocks/data/users.data";

export function mapFirestoreUser(
  id: string,
  data: Record<string, unknown> | undefined,
  fallbacks: Partial<User> = {}
): User {
  const email = ((data?.email as string) || fallbacks.email || "").toLowerCase();
  const matched = mockUsers.find((u) => u.email.toLowerCase() === email);

  return {
    id,
    email: (data?.email as string) || fallbacks.email || "",
    name:
      (data?.name as string) ||
      matched?.name ||
      fallbacks.name ||
      fallbacks.email?.split("@")[0] ||
      "User",
    nameAr: (data?.nameAr as string) || matched?.nameAr || fallbacks.nameAr || "",
    avatar: (data?.avatar as string) || fallbacks.avatar || "",
    role: (data?.role as User["role"]) || matched?.role || fallbacks.role || "employee",
    companyId: (data?.companyId as string) || matched?.companyId || fallbacks.companyId || "d-arrow",
    companyName:
      (data?.companyName as string) || matched?.companyName || fallbacks.companyName || "D-Arrow Business",
    portalAccess: parsePortalAccess(data?.portalAccess),
    portalSubRoles: parsePortalSubRoles(data?.portalSubRoles),
    customPermissions: parseCustomPermissions(data?.customPermissions),
  };
}
