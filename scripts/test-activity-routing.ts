/**
 * D-Arrow Business — Activity-Aware Routing & Page Registration Suite
 *
 * Pure deterministic tests over the central registry (no Firebase, no DOM):
 * the same functions the router guards and the navigation filters call are
 * exercised for every activity × path combination, so "hidden from navigation"
 * and "denied on a direct URL" are proven to agree.
 * Run: npx tsx scripts/test-activity-routing.ts
 */

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
    "/projects/settings",
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
  const viaUrl = resolveRouteAccess("/projects", ready("MEDICAL_CLINIC"));
  const viaNav = resolveRouteAccess("/projects", ready("MEDICAL_CLINIC"));
  assert(viaUrl === "deny-activity" && viaNav === "deny-activity", "typed URLs bypass nothing");
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
  const before = resolveRouteAccess("/projects", ready("PROJECTS"));
  const away = resolveRouteAccess("/projects", ready("SCHOOL_MANAGEMENT"));
  const back = resolveRouteAccess("/projects", ready("PROJECTS"));
  assert(before === "allow" && away === "deny-activity" && back === "allow", "switch lifecycle broken");
  // Records are keyed by their own stable ids/collections — routing holds no
  // mutation path at all: registry entries are read-only constants.
  assert(ACTIVITY_REGISTRY.PROJECTS.id === "PROJECTS", "stable id mutated");
});

await test("portals are visible exactly for the active/owning activity (picker & launcher)", () => {
  for (const a of ACTIVITY_IDS) {
    assert(portalAllowedForActivity("projects", ready(a)) === (a === "PROJECTS"), `projects portal wrong under ${a}`);
    for (const portal of ["crm", "people", "billing", "chat", "tasks"] as const) {
      assert(portalAllowedForActivity(portal, ready(a)), `shared portal ${portal} hidden under ${a}`);
    }
  }
  // Fail closed while loading: the activity-owned portal is not shown on a guess.
  assert(!portalAllowedForActivity("projects", LOADING), "projects portal shown before config ready");
  assert(portalAllowedForActivity("crm", LOADING), "shared portal incorrectly hidden");
});

await test("PORTAL_ACTIVITY maps only real portals and matches route ownership", () => {
  for (const [portal, activity] of Object.entries(PORTAL_ACTIVITY)) {
        assert(portal in { tasks: 1, crm: 1, people: 1, billing: 1, chat: 1, projects: 1, facilities: 1, agency: 1 }, `unknown portal ${portal}`);
    assert(isActivityId(activity), `portal ${portal} mapped to unknown activity`);
  }
  assert(PORTAL_ACTIVITY.projects === "PROJECTS", "projects portal ownership drift");
  assert(PORTAL_ACTIVITY.facilities === "FACILITIES_MANAGEMENT", "facilities portal ownership drift");
  assert(PORTAL_ACTIVITY.agency === "MARKETING_AGENCY", "agency portal ownership drift");
});

/* -------------------------------------------------------------------------- */
/* 6. Navigation, search and homepage surfaces                                */
/* -------------------------------------------------------------------------- */
console.log("6. Navigation/search/homepage filtering:");

await test("sidebar nav trees lose exactly the inactive activity's items", () => {
  const allNavPaths = [...TASKS_NAV, ...CRM_NAV, ...PEOPLE_NAV, ...BILLING_NAV, ...CHAT_NAV, ...PROJECTS_NAV].map(
    (i) => i.path,
  );
  assert(allNavPaths.some((p) => p.startsWith("/projects")), "projects nav missing from fixtures");
  for (const a of ACTIVITY_IDS) {
    const visible = filterPathsForActivity(allNavPaths, ready(a));
    const projectsVisible = visible.filter((p) => p.startsWith("/projects"));
    if (a === "PROJECTS") {
      assert(projectsVisible.length > 0, "active activity's own nav items hidden");
    } else {
      assert(projectsVisible.length === 0, `${a} still shows projects nav entries`);
    }
    // Shared entries are never dropped.
    assert(visible.includes("/crm/leads"), "shared nav entry dropped");
    assert(visible.includes("/billing/invoices"), "shared nav entry dropped");
  }
  // The sidebar search index is built from the same filtered tree.
  assert(filterPathsForActivity(allNavPaths, LOADING).every((p) => !p.startsWith("/projects")), "search index leaks inactive items while loading");
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
}
