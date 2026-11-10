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
  fallbacks: Partial<User> = {},
  customClaims?: Record<string, unknown>
): User {
  let role: User["role"] = (data?.role as User["role"]) || fallbacks.role || "employee";

  // Reconcile role with Auth custom claims:
  // Trusted Auth custom claims are the single source of truth for platform privileges.
  // A Firestore document cannot unilaterally grant platform_admin without a matching Auth custom claim.
  if (customClaims) {
    const claimRole = customClaims.role as User["role"] | undefined;
    if (claimRole === "platform_admin") {
      role = "platform_admin";
    } else if (role === "platform_admin") {
      console.warn(
        `[Security Warning] Firestore profile for user ${id} claims role "platform_admin", but Auth custom claims do not corroborate it. Downgrading to "${claimRole || "employee"}".`
      );
      role = claimRole || "employee";
    } else if (claimRole) {
      role = claimRole;
    }
  }

  let companyId = (data?.companyId as string) || fallbacks.companyId || "";
  if (!companyId && customClaims?.companyId && typeof customClaims.companyId === "string") {
    companyId = customClaims.companyId;
  }

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
    role,
    // No fabricated tenant: when the profile document is missing (or predates
    // `companyId`) the user maps to an EMPTY company with `profileMissing`.
    // Demo mock-user matching used to silently graft a real login onto the
    // seeded "d-arrow" workspace, which made orphan accounts invisible in the
    // Users page instead of surfacing them for reconciliation.
    companyId,
    companyName:
      (data?.companyName as string) || fallbacks.companyName || "",
    profileMissing: data === undefined,
    onboardingStatus:
      data?.onboardingStatus === "pending" || data?.onboardingStatus === "active"
        ? data.onboardingStatus
        : undefined,
    portalAccess: parsePortalAccess(data?.portalAccess),
    portalSubRoles: parsePortalSubRoles(data?.portalSubRoles),
    customPermissions: parseCustomPermissions(data?.customPermissions ?? data?.permissions),
    country: (data?.country as string) || fallbacks.country || undefined,
    countryScope: Array.isArray(data?.countryScope)
      ? (data.countryScope as string[]).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : Array.isArray(fallbacks.countryScope)
        ? fallbacks.countryScope
        : undefined,
    branchId: (data?.branchId as string) || fallbacks.branchId || undefined,
    workLocationId: (data?.workLocationId as string) || fallbacks.workLocationId || undefined,
  };
}
