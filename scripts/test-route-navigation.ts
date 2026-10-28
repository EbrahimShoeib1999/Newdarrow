/**
 * D-Arrow Business — Phase 6b Route Navigation Registry Suite
 *
 * Pure deterministic tests over the central navigation registry (no Firebase,
 * no DOM): the same functions the BackBar component and the smart-back hook
 * will call are exercised for rule matching, portal ownership, back-chain
 * resolution and breadcrumb authorization filtering, so displayable targets
 * and navigable targets are proven to agree (mirrors test-activity-routing.ts).
 * Run: npx tsx scripts/test-route-navigation.ts
 */

import { readFileSync } from "node:fs";
import {
  resolveRouteNavRule,
  resolveSmartBackTarget,
  buildBreadcrumbChain,
  isSafeNavTarget,
  isRecordableNavOrigin,
  getPortalRootPath,
  getPortalRootNavLabelKey,
  __getRouteNavRulesForTests,
  recordInAppOrigin,
  getLastInAppOrigin,
  __resetNavOriginForTests,
  type BackAccess,
  type NavOrigin,
} from "../src/lib/route-navigation";
import type { ActivityConfigState } from "../src/lib/activity-routes";
import { ROLE_PERMISSIONS } from "../src/lib/permissions";

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — Route Navigation Registry Tests");
console.log("=======================================================\n");

const ready = (activity: string): ActivityConfigState =>
  ({ status: "ready", activity } as ActivityConfigState);
const LOADING: ActivityConfigState = { status: "loading" };
const ERRORED: ActivityConfigState = { status: "error" };

/** Full-permission HR user on the projects tenant unless a case narrows it. */
const allowAll = (_permission: string) => true;
const mkAccess = (
  opts: { can?: (permission: string) => boolean; config?: ActivityConfigState } = {},
): BackAccess => ({
  can: opts.can ?? allowAll,
  config: opts.config ?? ready("PROJECTS"),
});

const origin = (pathname: string, search = ""): NavOrigin => ({ pathname, search });

/* -------------------------------------------------------------------------- */
/* 1. Rule resolution: exact vs prefix, specificity, whole segments           */
/* -------------------------------------------------------------------------- */

console.log("\n--- 1. Rule resolution ---");

await test("exact rule wins over the longer-looking prefix rule for the list path", () => {
  const rule = resolveRouteNavRule("/crm/leads");
  assert(rule !== null && rule.bar === "full", "list page resolves to its full-bar exact rule");
  assert(rule?.path === "/crm/leads", "exact path owned");
});

await test("prefix rule owns the nested detail route", () => {
  const rule = resolveRouteNavRule("/crm/leads/abc123");
  assert(rule?.prefix === "/crm/leads", "detail resolves to the leads prefix rule");
  assert(rule?.bar === "none", "lead records own their header trail → no central bar");
});

await test("deeper nesting still resolves to the nearest registered prefix", () => {
  const rule = resolveRouteNavRule("/facilities/work-orders/abc/attachments");
  assert(rule?.prefix === "/facilities/work-orders", "multi-segment detail owned by the list prefix");
  assert(rule?.parentPath === "/facilities/work-orders", "parent is the list page");
});

await test("hyphen siblings never match a prefix (/crm-help is not /crm)", () => {
  assert(resolveRouteNavRule("/crm-help") === null, "/crm-help has no owning rule");
  assert(resolveRouteNavRule("/people-other") === null, "/people-other has no owning rule");
  assert(resolveRouteNavRule("/real-estate-x") === null, "/real-estate-x has no owning rule");
});

await test("partial segment never matches (/peop does not match /people)", () => {
  assert(resolveRouteNavRule("/peop/settings") === null, "segment prefix must not match");
});

await test("trailing slash normalizes to the same owner (exact list rule wins)", () => {
  const rule = resolveRouteNavRule("/crm/leads/");
  assert(rule?.path === "/crm/leads", `expected the exact list rule, got ${rule?.prefix ?? rule?.path}`);
});

await test("unknown paths outside every subtree resolve to no rule", () => {
  assert(resolveRouteNavRule("/bogus") === null, "unknown root");
  assert(resolveRouteNavRule("/") === null, "picker root has no bar");
  assert(resolveRouteNavRule("") === null, "empty pathname");
});

await test("portal roots and dashboards resolve to no central bar", () => {
  // Unowned-by-specific-rule paths behave exactly like the old bar:"none"
  // generics: consumers must treat null as "no bar".
  assert(resolveRouteNavRule("/crm") === null || resolveRouteNavRule("/crm")?.bar === "none", "crm dashboard: no bar");
  assert(resolveRouteNavRule("/billing/invoices") === null || resolveRouteNavRule("/billing/invoices")?.bar === "none", "billing: no bar (page header owns crumbs)");
  assert(resolveRouteNavRule("/tasks/work") === null || resolveRouteNavRule("/tasks/work")?.bar === "none", "tasks: no bar (TasksPageHeader owns crumbs)");
});

/* -------------------------------------------------------------------------- */
/* 2. Portal ownership (incl. the /settings/* correction)                     */
/* -------------------------------------------------------------------------- */

console.log("\n--- 2. Portal ownership ---");

await test("/settings/* belongs to the people portal, not to a phantom portal", () => {
  assert(resolveRouteNavRule("/settings/team")?.portal === "people", "/settings/team");
  assert(resolveRouteNavRule("/settings/roles")?.portal === "people", "/settings/roles");
  assert(resolveRouteNavRule("/settings/pricing")?.portal === "people", "/settings/pricing");
  assert(resolveRouteNavRule("/settings/company")?.portal === "people", "/settings hub fallback");
});

await test("settings section pages keep in-section back targets", () => {
  assert(resolveRouteNavRule("/settings/team")?.parentPath === "/settings/company", "team → company hub");
  assert(resolveRouteNavRule("/people/attendance-settings")?.parentPath === "/people/settings", "attendance settings → HR hub");
});

await test("every portal keeps its own root path", () => {
  assert(getPortalRootPath("people") === "/people", "people root");
  assert(getPortalRootPath("real_estate") === "/real-estate", "real estate root (hyphen)");
  assert(getPortalRootPath("crm") === "/crm", "crm root");
});

await test("REM pages are owned by the real_estate portal", () => {
  assert(resolveRouteNavRule("/real-estate/properties")?.portal === "real_estate", "list");
  assert(resolveRouteNavRule("/real-estate/units/u1")?.portal === "real_estate", "detail");
});

/* -------------------------------------------------------------------------- */
/* 3. isSafeNavTarget — layered activity + permission contract                */
/* -------------------------------------------------------------------------- */

console.log("\n--- 3. Safe-target gating ---");

await test("the picker is always a safe target for signed-in users", () => {
  assert(isSafeNavTarget("/", mkAccess({ config: LOADING })) === true, "loading config still allows /");
});

await test("activity-denied paths are never safe targets", () => {
  const facUser = mkAccess({ config: ready("FACILITIES_MANAGEMENT") });
  assert(isSafeNavTarget("/agency/campaigns", facUser) === false, "inactive activity denied");
  assert(isSafeNavTarget("/crm/leads", facUser) === true, "shared portal unaffected");
  // Projects is a core module: reachable for a facilities tenant too.
  assert(isSafeNavTarget("/projects/mine", facUser) === true, "core projects always safe");
});

await test("permission-gated rules deny the target when the atom is missing", () => {
  const noContracts = mkAccess({ can: (p) => p !== "crm.manage_contracts" });
  assert(isSafeNavTarget("/crm/contracts", noContracts) === false, "missing atom");
  assert(isSafeNavTarget("/crm/contracts", mkAccess()) === true, "atom held");
});

await test("unresolvable config fails closed for every protected target", () => {
  const errored = mkAccess({ config: ERRORED });
  assert(isSafeNavTarget("/crm/leads", errored) === false, "error config denies");
  assert(isSafeNavTarget("/people/schedules", mkAccess({ config: LOADING })) === false, "loading denies");
});

/* -------------------------------------------------------------------------- */
/* 4. Origin tracking seam                                                    */
/* -------------------------------------------------------------------------- */

console.log("\n--- 4. Origin tracking ---");

await test("origin record/read/reset behaves as the layout tracker needs", () => {
  __resetNavOriginForTests();
  assert(getLastInAppOrigin() === null, "fresh session has no origin");
  recordInAppOrigin(origin("/crm/leads", "?q=follow-up"));
  assert(getLastInAppOrigin()?.pathname === "/crm/leads", "pathname recorded");
  assert(getLastInAppOrigin()?.search === "?q=follow-up", "search recorded");
  recordInAppOrigin(null);
  assert(getLastInAppOrigin() === null, "external entry clears the origin");
});

/* -------------------------------------------------------------------------- */
/* 5. Smart-back resolution                                                   */
/* -------------------------------------------------------------------------- */

console.log("\n--- 5. Smart-back ---");

__resetNavOriginForTests();

await test("same-portal origin wins and keeps its query string", () => {
  const back = resolveSmartBackTarget(
    "/crm/leads/abc",
    origin("/crm/leads", "?q=follow-up"),
    mkAccess(),
  );
  assert(back === "/crm/leads?q=follow-up", `expected list+query, got ${back}`);
});

await test("bare '?' search is normalized away", () => {
  const back = resolveSmartBackTarget("/crm/leads/abc", origin("/crm/leads", "?"), mkAccess());
  assert(back === "/crm/leads", `expected clean list, got ${back}`);
});

await test("cross-portal origin is ignored in favor of the registry parent", () => {
  const back = resolveSmartBackTarget("/crm/leads/abc", origin("/people/team"), mkAccess());
  assert(back === "/crm/leads", `expected crm list, got ${back}`);
});

await test("origin to an unauthorized page is skipped down the parent chain", () => {
  const noContracts = mkAccess({ can: (p) => p !== "crm.manage_contracts" });
  const back = resolveSmartBackTarget("/crm/leads/abc", origin("/crm/contracts"), noContracts);
  assert(back === "/crm/leads", `expected leads list, got ${back}`);
});

await test("no-origin detail page falls back to its registry list", () => {
  __resetNavOriginForTests();
  const back = resolveSmartBackTarget("/real-estate/units/u-1", null, mkAccess({ config: ready("REAL_ESTATE_MANAGEMENT") }));
  assert(back === "/real-estate/units", `expected units list, got ${back}`);
});

await test("pages whose parent is unauthorized climb to the portal landing", () => {
  // /people/team requires users.manage_roles; without it the chain must land
  // on the portal root, never on the denied page.
  const plain = mkAccess({ can: (p) => p !== "users.manage_roles" });
  const back = resolveSmartBackTarget("/people/team", null, plain);
  assert(back === "/people", `expected people landing, got ${back}`);
});

await test("portal landing pages fall back to the picker, never to themselves", () => {
  __resetNavOriginForTests();
  const back = resolveSmartBackTarget("/people", null, mkAccess());
  assert(back === "/", `expected picker, got ${back}`);
});

await test("inactive-activity pages send Back to the picker, not into the denied module", () => {
  __resetNavOriginForTests();
  const crmTenant = mkAccess({ config: ready("MARKETING_AGENCY") });
  const back = resolveSmartBackTarget("/real-estate/properties/p-1", null, crmTenant);
  assert(back === "/", `expected picker, got ${back}`);
});

await test("trailing-slash current page never returns its own path (loop-safe)", () => {
  __resetNavOriginForTests();
  const back = resolveSmartBackTarget("/crm/leads/", null, mkAccess());
  assert(back !== "/crm/leads/", `must not navigate to the same URL, got ${back}`);
  // The list page with a stray slash is treated as the list itself → its
  // registry parent (the portal landing), never back onto the same screen.
  assert(back === "/crm", `expected the portal landing, got ${back}`);
});

await test("settings pages walk up to the in-section hub", () => {
  __resetNavOriginForTests();
  const back = resolveSmartBackTarget("/settings/team", null, mkAccess());
  assert(back === "/settings/company", `expected company hub, got ${back}`);
});

/* -------------------------------------------------------------------------- */
/* 6. Breadcrumb chains                                                       */
/* -------------------------------------------------------------------------- */

console.log("\n--- 6. Breadcrumbs ---");

await test("entity detail yields exactly its list step", () => {
  const steps = buildBreadcrumbChain("/real-estate/leases/l-9", mkAccess({ config: ready("REAL_ESTATE_MANAGEMENT") }));
  assert(steps.length === 1, `expected 1 step, got ${steps.length}`);
  assert(steps[0].path === "/real-estate/leases" && steps[0].labelKey === "real_estate:nav.leases", "lease list step");
});

await test("settings team page shows the company hub crumb and stops at the portal boundary", () => {
  const steps = buildBreadcrumbChain("/settings/team", mkAccess());
  assert(steps.length === 1, `expected 1 step, got ${JSON.stringify(steps)}`);
  assert(steps[0].path === "/settings/company" && steps[0].labelKey === "nav.company_settings", `hub crumb from its own rule, got ${JSON.stringify(steps[0])}`);
});

await test("unauthorized hub crumb is dropped from the trail", () => {
  const noCompany = mkAccess({ can: (p) => p !== "company.manage" });
  const steps = buildBreadcrumbChain("/settings/team", noCompany);
  assert(steps.length === 0, `hidden module never trailed, got ${JSON.stringify(steps)}`);
});

await test("attendance settings chains through the HR hub and stops at the portal boundary", () => {
  const steps = buildBreadcrumbChain("/people/attendance-settings", mkAccess());
  assert(steps.length === 1, `expected hub step only, got ${JSON.stringify(steps)}`);
  assert(steps[0].path === "/people/settings" && steps[0].labelKey === "nav.hr_settings", "hub crumb labeled by its own rule");
});

await test("project detail gets a portal-root crumb even though its rule carries no label", () => {
  const steps = buildBreadcrumbChain("/projects/p-1", mkAccess({ config: ready("PROJECTS") }));
  assert(steps.length === 0, `chain stops at the portal boundary, got ${JSON.stringify(steps)}`);
  assert(getPortalRootNavLabelKey("projects") === "nav.projects", "the component can label the landing step");
});

await test("permission-gated pages drop their crumb when the atom is missing", () => {
  const noSchedules = mkAccess({ can: (p) => p !== "people.view_schedules" });
  const steps = buildBreadcrumbChain("/people/schedules", noSchedules);
  assert(steps.length === 0, "no trail toward a hidden module");
});

await test("activity-gated chains drop inactive-activity steps", () => {
  const crmTenant = mkAccess({ config: ready("SALES_CONTRACTS") });
  const steps = buildBreadcrumbChain("/projects/p-1", crmTenant);
  assert(steps.length === 0, "denied module never appears in the trail");
});

await test("list pages yield no chain (nothing above them in the registry)", () => {
  const steps = buildBreadcrumbChain("/crm/leads", mkAccess());
  assert(steps.length === 0, `expected empty trail, got ${JSON.stringify(steps)}`);
});

await test("unowned paths yield an empty trail instead of throwing", () => {
  assert(buildBreadcrumbChain("/bogus/deep/path", mkAccess()).length === 0, "unknown path");
  assert(buildBreadcrumbChain("/", mkAccess()).length === 0, "picker");
});

await test("a page the user may not occupy is unsafe, so the bar renders nothing on it", () => {
  // The component gates its own mount on this exact predicate: a disabled
  // activity or a permission-gated page must not be decorated with navigation.
  const employeeLike = mkAccess({ can: (p) => p !== "users.manage_roles" });
  assert(isSafeNavTarget("/settings/team", employeeLike) === false, "permission-gated page");
  const facTenant = mkAccess({ config: ready("FACILITIES_MANAGEMENT") });
  assert(isSafeNavTarget("/agency/campaigns", facTenant) === false, "inactive-activity page");
});

await test("the visible trail ends on the current page and keeps ancestors clickable", () => {
  // Mirrors the BackBar composition (landing + registry chain + current page):
  // the chain alone must never be the whole trail, or an ancestor would be
  // rendered as the current page (the bug the browser suite caught).
  const trailFor = (path: string, access: BackAccess = mkAccess()): string[] => {
    const rule = resolveRouteNavRule(path);
    assert(rule !== null, `rule for ${path}`);
    const landing = getPortalRootPath(rule!.portal);
    const chain = buildBreadcrumbChain(path, access).map((s) => s.path);
    return path === landing ? [landing] : [landing, ...chain, path];
  };
  assert(trailFor("/people/leave").join(" > ") === "/people > /people/leave", "second-level page");
  assert(
    trailFor("/settings/team").join(" > ") === "/people > /settings/company > /settings/team",
    "nested settings page",
  );
  const detail = trailFor("/real-estate/leases/l-9", mkAccess({ config: ready("REAL_ESTATE_MANAGEMENT") }));
  assert(
    detail.join(" > ") === "/real-estate > /real-estate/leases > /real-estate/leases/l-9",
    `entity detail keeps its list clickable, got ${detail.join(" > ")}`,
  );
});

/* -------------------------------------------------------------------------- */
/* 7. Origin recording rules (the layout tracker's validity gate)             */
/* -------------------------------------------------------------------------- */

console.log("\n--- 7. Origin recording ---");

await test("entry and exit doors are never recorded as back origins", () => {
  const cfg = ready("PROJECTS");
  assert(isRecordableNavOrigin("/", cfg) === false, "picker");
  assert(isRecordableNavOrigin("/profile", cfg) === false, "profile is outside the portal workspace");
  assert(isRecordableNavOrigin("/notifications", cfg) === false, "notifications");
  assert(isRecordableNavOrigin("/seed", cfg) === false, "seed");
  assert(isRecordableNavOrigin("/bogus", cfg) === false, "unknown path");
  assert(isRecordableNavOrigin("/crm-help", cfg) === false, "hyphen sibling is not a portal page");
});

await test("real portal pages are recordable, including the settings section", () => {
  const cfg = ready("PROJECTS");
  assert(isRecordableNavOrigin("/crm/leads", cfg) === true, "crm list");
  assert(isRecordableNavOrigin("/people/schedules", cfg) === true, "hr page");
  assert(isRecordableNavOrigin("/settings/team", cfg) === true, "platform settings section");
});

await test("an inactive-activity page is not a recordable origin", () => {
  const facTenant = ready("FACILITIES_MANAGEMENT");
  assert(isRecordableNavOrigin("/agency/campaigns", facTenant) === false, "denied module never recorded");
  assert(isRecordableNavOrigin("/facilities/assets", facTenant) === true, "active module recorded");
  // Core Projects is recordable under any activity.
  assert(isRecordableNavOrigin("/projects/mine", facTenant) === true, "core projects must be recordable");
});

await test("nothing is recordable while the tenant/activity state is unresolved", () => {
  assert(isRecordableNavOrigin("/crm/leads", LOADING) === false, "loading");
  assert(isRecordableNavOrigin("/crm/leads", ERRORED) === false, "error fails closed");
});

/* -------------------------------------------------------------------------- */
/* 8. Anti-duplication exceptions (pages that already own their controls)     */
/* -------------------------------------------------------------------------- */

console.log("\n--- 8. No duplicate back controls ---");

await test("lead and deal records keep their own header trail (bar off)", () => {
  assert(resolveRouteNavRule("/crm/leads/abc")?.bar === "none", "lead detail");
  assert(resolveRouteNavRule("/crm/deals/abc")?.bar === "none", "deal detail");
});

await test("record pages that own only a back link get the trail from the bar", () => {
  assert(resolveRouteNavRule("/crm/contacts/abc")?.bar === "crumbs", "contact detail");
  assert(resolveRouteNavRule("/facilities/assets/a-1")?.bar === "crumbs", "asset detail");
  assert(resolveRouteNavRule("/real-estate/units/u-1")?.bar === "crumbs", "unit detail");
  assert(resolveRouteNavRule("/projects/p-1")?.bar === "crumbs", "project detail");
});

await test("portal landing pages render no central bar at all", () => {
  for (const path of ["/crm", "/people", "/billing", "/billing/invoices", "/tasks", "/tasks/work", "/chat", "/real-estate", "/agency"]) {
    const rule = resolveRouteNavRule(path);
    assert(rule === null || rule.bar === "none", `${path} would duplicate its own header (bar=${rule?.bar})`);
  }
});

/* -------------------------------------------------------------------------- */
/* 9. Registry integrity: labels localized in BOTH languages, real atoms      */
/* -------------------------------------------------------------------------- */

console.log("\n--- 9. Registry integrity ---");

const RULES_TABLE = __getRouteNavRulesForTests();
const localeCache = new Map<string, Record<string, unknown>>();
function loadNs(lang: string, ns: string): Record<string, unknown> {
  const key = `${lang}/${ns}`;
  if (!localeCache.has(key)) {
    const raw = readFileSync(new URL(`../public/locales/${lang}/${ns}.json`, import.meta.url), "utf8");
    localeCache.set(key, JSON.parse(raw) as Record<string, unknown>);
  }
  return localeCache.get(key)!;
}
function hasKey(fullKey: string, lang: string): boolean {
  const [nsPart, keyPart] = fullKey.includes(":") ? fullKey.split(":") : ["common", fullKey];
  let node: unknown = loadNs(lang, nsPart);
  for (const segment of keyPart.split(".")) {
    if (node && typeof node === "object" && segment in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return false;
    }
  }
  return typeof node === "string" && node.trim().length > 0;
}

await test("every registry breadcrumb label exists in the English locale", () => {
  const missing = RULES_TABLE
    .filter((r) => r.labelKey && !hasKey(r.labelKey, "en"))
    .map((r) => `${r.path ?? r.prefix ?? r.portal} → ${r.labelKey}`);
  assert(missing.length === 0, `missing en keys: ${missing.join(", ")}`);
});

await test("every registry breadcrumb label exists in the Arabic locale (parity)", () => {
  const missing = RULES_TABLE
    .filter((r) => r.labelKey && !hasKey(r.labelKey, "ar"))
    .map((r) => `${r.path ?? r.prefix ?? r.portal} → ${r.labelKey}`);
  assert(missing.length === 0, `missing ar keys: ${missing.join(", ")}`);
});

await test("every registry permission is a real permission atom", () => {
  const all = ROLE_PERMISSIONS.super_admin as readonly string[];
  const unknown = RULES_TABLE.filter((r) => r.permission && !all.includes(r.permission)).map((r) => r.permission!);
  assert(unknown.length === 0, `unknown atoms: ${[...new Set(unknown)].join(", ")}`);
});

await test("crumb-reachable labels render without terminology interpolation", () => {
  // A crumb is always the parentPath of some other rule, so only those labels
  // ever reach the bar. Placeholders ({{plural}}) would render literally.
  const ownedOf = (r: (typeof RULES_TABLE)[number]) => r.path ?? r.prefix ?? getPortalRootPath(r.portal);
  const crumbTargets = new Set(RULES_TABLE.map((r) => r.parentPath));
  const offenders = RULES_TABLE
    .filter((r) => r.labelKey && crumbTargets.has(ownedOf(r)))
    .filter((r) => /\{\{/.test(resolveLabel(r.labelKey!)))
    .map((r) => `${ownedOf(r)} → ${r.labelKey}`);
  assert(offenders.length === 0, `placeholder labels reachable as crumbs: ${offenders.join(", ")}`);
});

function resolveLabel(key: string): string {
  const [nsPart, keyPart] = key.includes(":") ? key.split(":") : ["common", key];
  let node: unknown = loadNs("en", nsPart);
  for (const segment of keyPart.split(".")) {
    if (!node || typeof node !== "object" || !(segment in node)) return "";
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : "";
}

await test("every rule points its parent at a path inside its own portal subtree", () => {
  const offenders = RULES_TABLE
    .filter((r) => r.parentPath !== "/" && r.parentPath !== getPortalRootPath(r.portal))
    .filter((r) => !r.parentPath.startsWith(getPortalRootPath(r.portal) + "/")
      // the platform-settings section belongs to the people portal by design
      && !(r.portal === "people" && r.parentPath.startsWith("/settings")))
    .map((r) => `${r.path ?? r.prefix ?? r.portal} → ${r.parentPath}`);
  assert(offenders.length === 0, `cross-portal parents: ${offenders.join(", ")}`);
});

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

console.log("\n=======================================================");
console.log(` Results: ${passedCount} passed, ${failedCount} failed`);
console.log("=======================================================\n");

if (failedCount > 0) {
  console.log(" Failed tests:");
  for (const r of testResults.filter((t) => !t.passed)) {
    console.log(`   - ${r.name}: ${r.error}`);
  }
  process.exit(1);
}
process.exit(0);
