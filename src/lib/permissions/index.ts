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
  /** Work schedules & attendance portal capabilities (fine-grained by design). */
  | "people.view_schedules"
  | "people.manage_schedules"
  | "people.view_all_attendance"
  /** Correct others' punches — never one's own (enforced in service + rules). */
  | "people.correct_attendance"
  | "people.view_lateness"
  /** Run the monthly lateness evaluation and file proposals/review items. */
  | "people.evaluate_lateness"
  | "people.manage_lateness_policies"
  /** Approve/reject deduction cases — the subject can never decide their own. */
  | "people.decide_deductions"
  | "people.post_deductions"
  | "people.reverse_deductions"
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
  | "marketing.delete"
  | "portals.real_estate"
  | "real_estate.view"
  | "real_estate.create"
  | "real_estate.approve"
  | "real_estate.collect"
  | "real_estate.deposits"
  | "real_estate.export"
  | "real_estate.delete"
  /** School Management — a SENSITIVE domain: the `sch_*` collections are
   * readable/writable only for admin- or manager-role users (firestore.rules
   * `hasSensitiveDomainPrivilege`), so no atom below is granted to employee or
   * viewer. The portal grant stops at the same line to keep UI and rules in
   * agreement (an under-privileged grant would pass nav and fail writes). */
  | "portals.school"
  | "school.view"
  | "school.manage"
  | "school.mark_attendance"
  | "school.delete"
  | "portals.custom_modules"
  /** Custom Business Modules Engine — record actions are additionally
   * narrowed per-module by the definition's roleGrants (module-engine.ts). */
  | "custom_modules.view"
  | "custom_modules.create"
  | "custom_modules.update"
  | "custom_modules.archive"
  /** Creating/editing module DEFINITIONS (the configuration UI) only. */
  | "custom_modules.manage_config";

export const ROLE_LABELS: Record<UserRole, { en: string; ar: string }> = {
  super_admin: { en: "Super Admin", ar: "مدير عام" },
  admin: { en: "Admin", ar: "مسؤول" },
  manager: { en: "Manager", ar: "مدير" },
  global_hr_manager: { en: "Global HR Manager", ar: "مدير الموارد البشرية العالمي" },
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
  "people.view_schedules",
  "people.manage_schedules",
  "people.view_all_attendance",
  "people.correct_attendance",
  "people.view_lateness",
  "people.evaluate_lateness",
  "people.manage_lateness_policies",
  "people.decide_deductions",
  "people.post_deductions",
  "people.reverse_deductions",
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
  "portals.real_estate",
  "real_estate.view",
  "real_estate.create",
  "real_estate.approve",
  "real_estate.collect",
  "real_estate.deposits",
  "real_estate.export",
  "real_estate.delete",
  "portals.school",
  "school.view",
  "school.manage",
  "school.mark_attendance",
  "school.delete",
  "portals.custom_modules",
  "custom_modules.view",
  "custom_modules.create",
  "custom_modules.update",
  "custom_modules.archive",
  "custom_modules.manage_config",
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
    "people.view_schedules",
    "people.manage_schedules",
    "people.view_all_attendance",
    "people.correct_attendance",
    "people.view_lateness",
    "people.evaluate_lateness",
    "people.decide_deductions",
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
    "portals.real_estate",
    "real_estate.view",
    "real_estate.create",
    "real_estate.approve",
    "real_estate.collect",
    "real_estate.deposits",
    "real_estate.export",
    "real_estate.delete",
    "portals.school",
    "school.view",
    "school.manage",
    "school.mark_attendance",
    "school.delete",
    "portals.custom_modules",
    "custom_modules.view",
    "custom_modules.create",
    "custom_modules.update",
    "custom_modules.archive",
  ],
  global_hr_manager: [
    "portals.people",
    "company.view",
    "people.view",
    "people.manage_employees",
    "people.approve_leave",
    "people.view_performance",
    "people.view_all_reports",
    "people.view_schedules",
    "people.manage_schedules",
    "people.view_all_attendance",
    "people.correct_attendance",
    "people.view_lateness",
    "people.evaluate_lateness",
    "people.manage_lateness_policies",
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
    "portals.real_estate",
    "real_estate.view",
    "real_estate.create",
    "portals.custom_modules",
    "custom_modules.view",
    "custom_modules.create",
    "custom_modules.update",
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
  return isAdminRole(role) || role === "manager" || role === "global_hr_manager";
}

export type AccessiblePortal =
  | "tasks"
  | "crm"
  | "people"
  | "billing"
  | "chat"
  | "projects"
  | "facilities"
  | "agency"
  | "real_estate"
  | "school"
  | "custom_modules";

export function canAccessPortal(
  role: UserRole | undefined,
  portal: AccessiblePortal
): boolean {
  return hasPermission(role, `portals.${portal}` as Permission);
}

export function getAccessiblePortals(
  role: UserRole | undefined
): AccessiblePortal[] {
  return (["tasks", "crm", "people", "billing", "chat", "projects", "facilities", "agency", "real_estate", "school", "custom_modules"] as const).filter((p) =>
    canAccessPortal(role, p)
  );
}
