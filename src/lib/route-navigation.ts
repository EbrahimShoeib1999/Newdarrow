/**
 * Route navigation registry — the SINGLE central source for the in-app "Back"
 * fallback chain and breadcrumb labels of every page (addendum §4B/§4C:
 * generated from a route registry, never hand-rolled per page).
 *
 * Pure module (no React): the BackBar component, the smart-back hook and the
 * unit tests all resolve navigation through the same functions, exactly like
 * activity-routes.ts does for authorization. The two contracts are layered:
 * a back/breadcrumb target is only ever emitted when activity-routes allows
 * the page AND the user holds the nav item's permission (when it has one).
 *
 * Bar modes:
 * - "full"    → Back button + breadcrumbs (pages without their own controls).
 * - "crumbs"  → breadcrumbs only (the page already owns a correct back link).
 * - "none"    → no central bar (dashboards, chat, pages that already render
 *               their own breadcrumbs — e.g. billing AccountingPageHeader).
 * Prefix rules match whole segments: "/crm/leads/abc" matches "/crm/leads"
 * but "/crm-help" never matches "/crm".
 */

import { resolveRouteAccess, type ActivityConfigState } from "./activity-routes";
import { getPortalFromPath, type PortalId } from "./portal-permissions";

export interface RouteNavRule {
  /** Portal that owns the page (activity authorization is layered on top). */
  portal: PortalId;
  /** Exact static path this rule owns (wins over any prefix rule). */
  path?: string;
  /** Path subtree this rule owns, e.g. "/crm/leads" covers "/crm/leads/:id". */
  prefix?: string;
  /** Where "Back" falls to when there is no valid in-app previous page. */
  parentPath: string;
  /** i18n key ("ns:key" or common-relative "key") labeling the path this rule owns. */
  labelKey?: string;
  /** Permission required to land here; the target is skipped when missing. */
  permission?: string;
  bar: "full" | "crumbs" | "none";
}

/** Portal landing pages — the root of every breadcrumb chain. */
const PORTAL_ROOT_PATHS: Record<PortalId, string> = {
  tasks: "/tasks",
  crm: "/crm",
  people: "/people",
  billing: "/billing",
  chat: "/chat",
  projects: "/projects",
  facilities: "/facilities",
  agency: "/agency",
  real_estate: "/real-estate",
  custom_modules: "/modules",
  school: "/school",
};

export function getPortalRootPath(portal: PortalId): string {
  return PORTAL_ROOT_PATHS[portal];
}

/**
 * Registry label for a portal landing page (its own rule's labelKey when it
 * has one). The BackBar component prepends the landing step itself and uses
 * this for the crumb text; the chain builder stops at the portal boundary.
 */
export function getPortalRootNavLabelKey(portal: PortalId): string | undefined {
  const rule = RULES.find(
    (r) => r.portal === portal && !r.prefix && (r.path === PORTAL_ROOT_PATHS[portal] || (!r.path && r.bar !== "none")),
  );
  return rule?.labelKey;
}

const L = (portal: PortalId, path: string, labelKey: string, permission?: string): RouteNavRule => ({
  portal,
  path,
  parentPath: getPortalRootPath(portal),
  labelKey,
  permission,
  bar: "full",
});

/* Portal-wide fallback is implicit: paths no specific rule owns (portal roots,
 dashboards, unregistered pages) resolve to null, which every consumer treats
 as "no central bar" — identical to a bar:"none" rule, so no generic table is
 declared (kept off RULES to avoid shadowing real rules on re-resolution). */

/**
 * Registry table. Non-generic rules (path/prefix declared) win over the
 * portal-generic fallback; among prefix rules the longest path wins.
 */
const RULES: RouteNavRule[] = [
  // ---- People & HR -------------------------------------------------------
  L("people", "/people/leave", "nav.leave"),
  L("people", "/people/approvals", "nav.approvals"),
  L("people", "/people/performance", "nav.performance"),
  L("people", "/people/timesheets", "nav.timesheets"),
  L("people", "/people/daily-reports", "nav.daily_reports"),
  L("people", "/people/schedules", "nav.work_schedules", "people.view_schedules"),
  L("people", "/people/lateness-policies", "nav.lateness_policies", "people.view_lateness"),
  // Unpermissioned on purpose: every user may open their OWN cases (mirrors
  // the sidebar item — hidden when denied, reachable as self-view).
  L("people", "/people/deduction-cases", "nav.deduction_cases"),
  L("people", "/people/lateness-report", "nav.lateness_report", "people.view_lateness"),
  // Attendance settings lives under the HR settings hub → hub is its list.
  { portal: "people", path: "/people/attendance-settings", parentPath: "/people/settings", labelKey: "nav.attendance_settings", permission: "people.manage_employees", bar: "full" },
  L("people", "/people/settings", "nav.hr_settings"),
  L("people", "/people/team", "nav.team_members", "users.manage_roles"),
  L("people", "/people/roles", "nav.roles_permissions", "users.manage_roles"),
  L("people", "/people/company-settings", "nav.company_settings", "company.manage"),
  // Employee profile keeps its own contextual controls (generic none fallback).

  // ---- CRM ---------------------------------------------------------------
  L("crm", "/crm/leads", "crm:nav.leads"),
  // Lead/deal records render their own CrmRecordHeader breadcrumb trail and
  // back affordance → the central bar stays off them entirely (no duplicates).
  { portal: "crm", prefix: "/crm/leads", parentPath: "/crm/leads", labelKey: "crm:nav.leads", bar: "none" },
  L("crm", "/crm/contacts", "crm:nav.contacts"),
  // Contact records own only a back link → the bar supplies the trail.
  { portal: "crm", prefix: "/crm/contacts", parentPath: "/crm/contacts", labelKey: "crm:nav.contacts", bar: "crumbs" },
  L("crm", "/crm/deals", "crm:nav.deals"),
  { portal: "crm", prefix: "/crm/deals", parentPath: "/crm/deals", labelKey: "crm:nav.deals", bar: "none" },
  L("crm", "/crm/tasks", "crm:nav.crmTasks"),
  L("crm", "/crm/quotations", "crm:nav.quotations"),
  L("crm", "/crm/contracts", "crm:nav.contracts", "crm.manage_contracts"),
  L("crm", "/crm/client-reports", "crm:nav.client_reports"),
  L("crm", "/crm/reports", "crm:nav.reports"),
  L("crm", "/crm/operations", "crm:nav.operations"),

  // ---- Billing / Accounting ---------------------------------------------
  // Every billing page renders AccountingPageHeader breadcrumbs or its own
  // back affordance; the generic fallback below keeps the central bar off.

  // ---- Tasks / Chat ------------------------------------------------------
  // Pages use TasksPageHeader with its own breadcrumb link; chat is
  // full-bleed master/detail. → no central bar.

  // ---- Settings hub (platform settings; back target stays in-section) ---
  { portal: "people", path: "/settings/company", parentPath: "/people", labelKey: "nav.company_settings", permission: "company.manage", bar: "crumbs" },
  { portal: "people", path: "/settings/team", parentPath: "/settings/company", labelKey: "nav.team_members", permission: "users.manage_roles", bar: "full" },
  { portal: "people", path: "/settings/roles", parentPath: "/settings/company", labelKey: "nav.roles_permissions", permission: "users.manage_roles", bar: "full" },
  { portal: "people", path: "/settings/pricing", parentPath: "/settings/company", labelKey: "settings:nav.pricing", bar: "full" },
  { portal: "people", prefix: "/settings", parentPath: "/people", bar: "none" },

  // ---- Projects (activity-owned) ----------------------------------------
  L("projects", "/projects/mine", "projects:nav.my_projects", "projects.view"),
  L("projects", "/projects/completed", "projects:nav.completed_projects", "projects.view"),
  L("projects", "/projects/settings", "projects:nav.project_settings", "projects.manage"),
  // Project detail owns its Back-to-list link → crumbs only. The landing crumb
  // uses the plain module name: the tenant's custom project terminology is a
  // page-header concern, not something the bar can interpolate generically.
  { portal: "projects", parentPath: "/projects", labelKey: "nav.projects", bar: "crumbs" },

  // ---- Facilities (activity-owned) --------------------------------------
  L("facilities", "/facilities/reports", "facilities:nav.reports", "facilities.view"),
  L("facilities", "/facilities/schedules", "facilities:nav.schedules", "facilities.view"),
  L("facilities", "/facilities/vendors", "facilities:nav.vendors", "facilities.view"),
  L("facilities", "/facilities/work-orders", "facilities:nav.work_orders", "facilities.view"),
  { portal: "facilities", prefix: "/facilities/work-orders", parentPath: "/facilities/work-orders", labelKey: "facilities:nav.work_orders", bar: "crumbs" },
  L("facilities", "/facilities/facilities", "facilities:nav.facilities", "facilities.view"),
  { portal: "facilities", prefix: "/facilities/facilities", parentPath: "/facilities/facilities", labelKey: "facilities:nav.facilities", bar: "crumbs" },
  L("facilities", "/facilities/assets", "facilities:nav.assets", "facilities.view"),
  { portal: "facilities", prefix: "/facilities/assets", parentPath: "/facilities/assets", labelKey: "facilities:nav.assets", bar: "crumbs" },

  // ---- Marketing Agency (activity-owned) --------------------------------
  L("agency", "/agency/reports", "marketing:nav.reports"),
  L("agency", "/agency/deliverables", "marketing:nav.deliverables"),
  L("agency", "/agency/content", "marketing:nav.content"),
  L("agency", "/agency/briefs", "marketing:nav.briefs"),
  L("agency", "/agency/campaigns", "marketing:nav.campaigns"),
  { portal: "agency", prefix: "/agency/campaigns", parentPath: "/agency/campaigns", labelKey: "marketing:nav.campaigns", bar: "crumbs" },

  // ---- Real Estate (activity-owned) -------------------------------------
  L("real_estate", "/real-estate/reports", "real_estate:nav.reports"),
  L("real_estate", "/real-estate/collections", "real_estate:nav.collections"),
  L("real_estate", "/real-estate/deposits", "real_estate:nav.deposits"),
  L("real_estate", "/real-estate/expenses", "real_estate:nav.expenses"),
  L("real_estate", "/real-estate/inspections", "real_estate:nav.inspections"),
  L("real_estate", "/real-estate/properties", "real_estate:nav.properties"),
  { portal: "real_estate", prefix: "/real-estate/properties", parentPath: "/real-estate/properties", labelKey: "real_estate:nav.properties", bar: "crumbs" },
  L("real_estate", "/real-estate/units", "real_estate:nav.units"),
  { portal: "real_estate", prefix: "/real-estate/units", parentPath: "/real-estate/units", labelKey: "real_estate:nav.units", bar: "crumbs" },
  L("real_estate", "/real-estate/leases", "real_estate:nav.leases"),
  { portal: "real_estate", prefix: "/real-estate/leases", parentPath: "/real-estate/leases", labelKey: "real_estate:nav.leases", bar: "crumbs" },

  // ---- Custom Business Modules (shared across activities) ----------------
  L("custom_modules", "/modules/manage", "custom_modules:nav.manage", "custom_modules.manage_config"),
  // Module record lists own their back link; detail/new pages climb back to
  // the module list through this generic prefix rule.
  { portal: "custom_modules", prefix: "/modules", parentPath: "/modules", labelKey: "custom_modules:nav.space", permission: "custom_modules.view", bar: "crumbs" },

  // ---- School Management (activity-owned) ---------------------------------
  L("school", "/school/academic-years", "school:nav.academic_years", "school.view"),
  L("school", "/school/terms",            "school:nav.terms",            "school.view"),
  L("school", "/school/grades",           "school:nav.grades",           "school.view"),
  L("school", "/school/sections",         "school:nav.sections",         "school.view"),
  L("school", "/school/subjects",         "school:nav.subjects",         "school.view"),
  L("school", "/school/guardians",        "school:nav.guardians",        "school.view"),
  L("school", "/school/students",         "school:nav.students",         "school.view"),
  { portal: "school", prefix: "/school/students", parentPath: "/school/students", labelKey: "school:nav.students", bar: "crumbs" },
  L("school", "/school/attendance",       "school:nav.attendance",       "school.view"),
];

function toPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

/** Canonical form for registry lookups: "/crm/leads/" ≡ "/crm/leads". */
function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

/** Whole-segment prefix match ("/crm-help" never matches "/crm"). */
function isPrefixOf(rulePath: string, pathname: string): boolean {
  const ruleSegments = toPathSegments(rulePath);
  const segments = toPathSegments(pathname);
  if (ruleSegments.length > segments.length) return false;
  return ruleSegments.every((s, i) => s === segments[i]);
}

/** Specificity: exact path > longer prefix > shorter prefix > portal generic. */
function ruleSpecificity(rule: RouteNavRule): { level: number; depth: number } {
  const owned = rule.path ?? rule.prefix ?? PORTAL_ROOT_PATHS[rule.portal];
  const depth = toPathSegments(owned).length;
  const level = rule.path ? 3 : rule.prefix ? 2 : 1;
  return { level, depth };
}

/**
 * Most-specific registry rule owning a pathname. Unknown paths inside a
 * portal subtree fall back to that portal's generic rule; paths outside every
 * subtree resolve to null (no bar).
 */
export function resolveRouteNavRule(pathname: string): RouteNavRule | null {
  const segments = toPathSegments(pathname);
  if (segments.length === 0) return null;
  const normalized = normalizePathname(pathname);

  let best: RouteNavRule | null = null;
  let bestSpec: { level: number; depth: number } | null = null;
  for (const rule of RULES) {
    const owned = rule.path ?? rule.prefix ?? PORTAL_ROOT_PATHS[rule.portal];
    const matches = rule.path ? owned === normalized : isPrefixOf(owned, normalized);
    if (!matches) continue;
    const spec = ruleSpecificity(rule);
    if (
      !bestSpec ||
      spec.level > bestSpec.level ||
      (spec.level === bestSpec.level && spec.depth > bestSpec.depth)
    ) {
      best = rule;
      bestSpec = spec;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// In-app navigation origin tracking (smart-back input).
// ---------------------------------------------------------------------------

export interface NavOrigin {
  pathname: string;
  search: string;
}

let lastOrigin: NavOrigin | null = null;

/** Called by the AppLayout tracker on every PUSH navigation. */
export function recordInAppOrigin(origin: NavOrigin | null): void {
  lastOrigin = origin;
}

export function getLastInAppOrigin(): NavOrigin | null {
  return lastOrigin;
}

/** Test seam — reset session state between scenarios. */
export function __resetNavOriginForTests(): void {
  lastOrigin = null;
}

/** Test seam — the registry table for integrity checks (labels, permissions). */
export function __getRouteNavRulesForTests(): readonly RouteNavRule[] {
  return RULES;
}

// ---------------------------------------------------------------------------
// Authorization-aware resolution helpers.
// ---------------------------------------------------------------------------

export interface BackAccess {
  /** Permission gate checker (client effective permissions). */
  can: (permission: string) => boolean;
  config: ActivityConfigState;
}

/** A registry path is a safe navigation target only when BOTH contracts pass. */
export function isSafeNavTarget(path: string, access: BackAccess): boolean {
  if (path === "/") return true; // the picker is always reachable when signed in
  const decision = resolveRouteAccess(path, access.config);
  if (decision !== "allow") return false;
  const rule = resolveRouteNavRule(path);
  if (rule?.permission && !access.can(rule.permission)) return false;
  return true;
}

/**
 * Smart-back target (addendum §4B):
 * 1. valid in-app previous page in the SAME portal (keeps its query →
 *    search/filters/pagination survive the round trip);
 * 2. else the entity list / parent from the registry;
 * 3. else the portal landing page;
 * 4. else the portal picker.
 * Loop-safe: never returns the current path. Unauthorized / inactive-activity
 * targets are skipped by walking up the parent chain.
 */
export function resolveSmartBackTarget(
  currentPathname: string,
  origin: NavOrigin | null,
  access: BackAccess,
): string {
  const current = normalizePathname(currentPathname);
  const rule = resolveRouteNavRule(current);
  const portal = rule?.portal ?? null;

  // 1. In-app previous page — same portal, allowed, not the page itself.
  if (origin && portal) {
    const originRule = resolveRouteNavRule(origin.pathname);
    const sameScope = originRule?.portal === portal;
    if (sameScope && normalizePathname(origin.pathname) !== current && isSafeNavTarget(origin.pathname, access)) {
      const search = origin.search && origin.search !== "?" ? origin.search : "";
      return `${origin.pathname}${search}`;
    }
  }

  // 2/3. Parent chain climb — first ancestor the user may actually see.
  const fallbackRoot = portal ? PORTAL_ROOT_PATHS[portal] : "/";
  let cursor = rule?.parentPath;
  const seen = new Set<string>([current]);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (isSafeNavTarget(cursor, access)) return cursor;
    const parentRule = cursor === fallbackRoot ? null : resolveRouteNavRule(cursor);
    cursor = parentRule?.parentPath ?? fallbackRoot;
  }
  if (portal && isSafeNavTarget(PORTAL_ROOT_PATHS[portal], access)) {
    return PORTAL_ROOT_PATHS[portal];
  }

  // 4. Last resort: the portal picker (always reachable for signed-in users).
  return "/";
}

export interface BreadcrumbStep {
  path: string;
  labelKey: string;
}

/**
 * Whether a just-left page may be remembered as a back origin: it must be an
 * in-app portal page the activity allows. Entry/exit doors (the picker, the
 * marketing home, profile/notifications, unknown paths) are never recorded, so
 * Back can never target a page outside the current portal workspace.
 */
export function isRecordableNavOrigin(pathname: string, config: ActivityConfigState): boolean {
  const portal = getPortalFromPath(pathname);
  if (portal === null || portal === "picker") return false;
  return resolveRouteAccess(pathname, config) === "allow";
}

/**
 * Breadcrumb chain for a page, outermost first (the home + portal landing
 * steps are prepended by the component — the chain always stops at the
 * portal boundary). Each crumb carries the label of the path it points at,
 * resolved from that path's own rule (falling back to the climbing rule).
 * Disabled-activity and unauthorized steps are dropped so the trail never
 * reveals hidden modules (addendum §4C).
 */
export function buildBreadcrumbChain(pathname: string, access: BackAccess): BreadcrumbStep[] {
  const steps: BreadcrumbStep[] = [];
  const start = normalizePathname(pathname);
  let rule = resolveRouteNavRule(start);
  const seen = new Set<string>([start]);

  while (rule && rule.bar !== "none") {
    const target = normalizePathname(rule.parentPath);
    if (seen.has(target)) break;
    seen.add(target);
    // The portal landing step is the component's; the chain never duplicates it.
    if (target === PORTAL_ROOT_PATHS[rule.portal]) break;
    if (rule.permission && !access.can(rule.permission)) break;
    if (!isSafeNavTarget(target, access)) break;
    const targetRule = resolveRouteNavRule(target);
    const labelKey = targetRule?.labelKey ?? rule.labelKey;
    if (labelKey) steps.unshift({ path: target, labelKey });
    // A self-parenting target (entity list) ends the climb at that list.
    if (!targetRule || targetRule.bar === "none") break;
    rule = targetRule;
  }
  return steps;
}
