import type { UserRole } from "@/features/auth/types/auth.types";

export type Permission =
  | "portals.tasks"
  | "portals.crm"
  | "portals.people"
  | "portals.billing"
  | "portals.chat"
  | "portals.projects"
  | "company.view"
  | "company.manage"
  | "company.identity"
  | "pricing.view"
  | "pricing.manage"
  | "users.manage_roles"
  | "people.view"
  | "people.manage_employees"
  | "people.approve_leave"
  | "people.view_performance"
  /** See daily reports of every member; everyone can always see their own. */
  | "people.view_all_reports"
  | "crm.view"
  | "crm.manage_leads"
  | "crm.manage_contacts"
  | "crm.manage_deals"
  | "crm.manage_tasks"
  | "crm.manage_contracts"
  | "crm.delete"
  | "admin.seed"
  | "tasks.view"
  | "tasks.create"
  | "tasks.edit"
  | "tasks.delete"
  | "tasks.approve"
  | "projects.view"
  | "projects.manage"
  | "projects.delete"
  | "portals.facilities"
  | "facilities.view"
  | "facilities.manage"
  | "facilities.delete"
  | "portals.agency"
  | "marketing.view"
  | "marketing.manage"
  | "marketing.delete";

export const ROLE_LABELS: Record<UserRole, { en: string; ar: string }> = {
  super_admin: { en: "Super Admin", ar: "مدير عام" },
  admin: { en: "Admin", ar: "مسؤول" },
  manager: { en: "Manager", ar: "مدير" },
  employee: { en: "Employee", ar: "موظف" },
  viewer: { en: "Viewer", ar: "مشاهد" },
};

const ALL_PERMISSIONS: Permission[] = [
  "portals.tasks",
  "portals.crm",
  "portals.people",
  "portals.billing",
  "portals.chat",
  "portals.projects",
  "company.view",
  "company.manage",
  "company.identity",
  "pricing.view",
  "pricing.manage",
  "users.manage_roles",
  "people.view",
  "people.manage_employees",
  "people.approve_leave",
  "people.view_performance",
  "people.view_all_reports",
  "crm.view",
  "crm.manage_leads",
  "crm.manage_contacts",
  "crm.manage_deals",
  "crm.manage_tasks",
  "crm.manage_contracts",
  "crm.delete",
  "admin.seed",
  "tasks.view",
  "tasks.create",
  "tasks.edit",
  "tasks.delete",
  "tasks.approve",
  "projects.view",
  "projects.manage",
  "projects.delete",
  "portals.facilities",
  "facilities.view",
  "facilities.manage",
  "facilities.delete",
  "portals.agency",
  "marketing.view",
  "marketing.manage",
  "marketing.delete",
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(
    (p) => p !== "company.identity"
  ),
  manager: [
    "portals.tasks",
    "portals.crm",
    "portals.people",
    "portals.billing",
    "portals.chat",
    "portals.projects",
    "company.view",
    "pricing.view",
    "pricing.manage",
    "people.view",
    "people.manage_employees",
    "people.approve_leave",
    "people.view_performance",
    "people.view_all_reports",
    "crm.view",
    "crm.manage_leads",
    "crm.manage_contacts",
    "crm.manage_deals",
    "crm.manage_tasks",
    "crm.manage_contracts",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.approve",
    "projects.view",
    "projects.manage",
    "projects.delete",
    "portals.facilities",
    "facilities.view",
    "facilities.manage",
    "facilities.delete",
    "portals.agency",
    "marketing.view",
    "marketing.manage",
    "marketing.delete",
  ],
  employee: [
    "portals.tasks",
    "portals.crm",
    "portals.people",
    "portals.billing",
    "portals.chat",
    "portals.projects",
    "company.view",
    "pricing.view",
    "people.view",
    "crm.view",
    "crm.manage_tasks",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "projects.view",
    "projects.manage",
    "portals.facilities",
    "facilities.view",
    "facilities.manage",
    "portals.agency",
    "marketing.view",
    "marketing.manage",
  ],
  viewer: [
    "portals.crm",
    "portals.chat",
    "company.view",
    "pricing.view",
    "crm.view",
  ],
};

export function hasPermission(
  role: UserRole | undefined,
  permission: Permission
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasAnyPermission(
  role: UserRole | undefined,
  permissions: readonly Permission[]
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

export function isManagerRole(role: UserRole | undefined): boolean {
  return isAdminRole(role) || role === "manager";
}

export function canAccessPortal(
  role: UserRole | undefined,
  portal: "tasks" | "crm" | "people" | "billing" | "chat" | "projects" | "facilities" | "agency"
): boolean {
  return hasPermission(role, `portals.${portal}` as Permission);
}

export function getAccessiblePortals(
  role: UserRole | undefined
): Array<"tasks" | "crm" | "people" | "billing" | "chat" | "projects" | "facilities" | "agency"> {
  return (["tasks", "crm", "people", "billing", "chat", "projects", "facilities", "agency"] as const).filter((p) =>
    canAccessPortal(role, p)
  );
}
