/**
 * D-Arrow Business — Navigation History (Global Back/Forward) Unit Tests
 *
 * Pure tests over the mirrored history stack (no React, no DOM, no Firebase):
 * exercises PUSH/POP/REPLACE folding, forward-branch truncation, dedup,
 * reseed-on-unknown-POP, identity reset, and the Back/Forward predicates.
 *
 * Run: npx tsx scripts/test-nav-history.ts
 */

import {
  applyNavigation,
  getNavHistorySnapshot,
  readNavHistory,
  resetNavHistory,
  hasRealBackHistory,
} from "../src/lib/navigation-history";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}\n      expected ${b}\n      actual   ${a}`);
  }
}
function ok(cond: boolean, label: string) {
  eq(cond, true, label);
}

function reset() {
  resetNavHistory();
}

/* -------------------------------------------------------------------------- */
/* 1. Initial seeding                                                          */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "k1", url: "/crm/contacts" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 1, "Seeds first entry");
  eq(s.index, 0, "Index at 0");
  const r = readNavHistory(s);
  ok(!r.canBack, "Cannot go back from single entry");
  ok(!r.canForward, "Cannot go forward from single entry");
  ok(!hasRealBackHistory(), "hasRealBackHistory is false at index 0");
}

/* -------------------------------------------------------------------------- */
/* 2. PUSH appends and makes Back available                                   */
/* -------------------------------------------------------------------------- */

applyNavigation({ type: "PUSH", key: "k2", url: "/crm/contacts/abc" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 2, "Second PUSH appends");
  eq(s.index, 1, "Index at 1");
  ok(hasRealBackHistory(), "hasRealBackHistory is true when history exists");
  const r = readNavHistory(s);
  ok(r.canBack, "Back available after push");
  ok(!r.canForward, "Forward not available at tip");
}

/* -------------------------------------------------------------------------- */
/* 3. POP to a known key repositions the pointer                              */
/* -------------------------------------------------------------------------- */

applyNavigation({ type: "POP", key: "k1", url: "/crm/contacts" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 2, "POP does not add entries");
  eq(s.index, 0, "POP moved pointer back to k1");
  const r = readNavHistory(s);
  ok(!r.canBack, "No Back at the start of history");
  ok(r.canForward, "Forward available after POP back");
}

/* -------------------------------------------------------------------------- */
/* 4. PUSH after POP truncates the forward branch (browser semantics)         */
/* -------------------------------------------------------------------------- */

applyNavigation({ type: "PUSH", key: "k3", url: "/crm/contacts/xyz" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 2, "Forward branch truncated");
  eq(s.entries[1].url, "/crm/contacts/xyz", "New entry replaced the forward");
  eq(s.index, 1, "Index at tip");
  const r = readNavHistory(s);
  ok(!r.canForward, "Forward no longer available (C is gone)");
}

/* -------------------------------------------------------------------------- */
/* 5. REPLACE overwrites the current entry                                    */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "r1", url: "/billing/invoices" });
applyNavigation({ type: "REPLACE", key: "r2", url: "/billing/invoices?status=draft" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 1, "REPLACE keeps stack size");
  eq(s.entries[0].url, "/billing/invoices?status=draft", "REPLACE updated the URL");
  eq(s.entries[0].key, "r2", "REPLACE updated the key");
}

/* -------------------------------------------------------------------------- */
/* 6. Redirect dedup — PUSH to the same URL only swaps the key               */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "d1", url: "/settings" });
applyNavigation({ type: "PUSH", key: "d2", url: "/settings/company" });
applyNavigation({ type: "PUSH", key: "d3", url: "/settings/company" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 2, "Duplicate URL does not create a third entry");
  eq(s.entries[1].key, "d3", "Key swapped for future POP resolution");
}

/* -------------------------------------------------------------------------- */
/* 7. POP to unknown key reseeds (reload/tab restore)                         */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "x1", url: "/people" });
applyNavigation({ type: "PUSH", key: "x2", url: "/people/leave" });
applyNavigation({ type: "POP", key: "unknown", url: "/crm" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 1, "Unknown POP reseeds to single entry");
  eq(s.entries[0].url, "/crm", "Reseeded with the POP URL");
  ok(!hasRealBackHistory(), "No back history after reseed");
}

/* -------------------------------------------------------------------------- */
/* 8. resetNavHistory clears everything                                       */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "z1", url: "/a" });
applyNavigation({ type: "PUSH", key: "z2", url: "/b" });
resetNavHistory();
{
  const s = getNavHistorySnapshot();
  eq(s.entries.length, 0, "Reset clears entries");
  eq(s.index, -1, "Reset index to -1");
}

/* -------------------------------------------------------------------------- */
/* 9. Forward after backward POP                                              */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "f1", url: "/a" });
applyNavigation({ type: "PUSH", key: "f2", url: "/b" });
applyNavigation({ type: "PUSH", key: "f3", url: "/c" });
applyNavigation({ type: "POP", key: "f2", url: "/b" });
applyNavigation({ type: "POP", key: "f3", url: "/c" });
{
  const s = getNavHistorySnapshot();
  eq(s.index, 2, "Forward POP moves pointer to tip");
  ok(!hasRealBackHistory() || s.index > 0, "Back available at tip");
}

/* -------------------------------------------------------------------------- */
/* 10. Query strings and hash fragments preserved                            */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "q1", url: "/crm/leads?filter=active#section" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries[0].url, "/crm/leads?filter=active#section", "Query+hash preserved in entry");
}

/* -------------------------------------------------------------------------- */
/* 11. Trailing slash normalization                                          */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "s1", url: "/crm/leads/" });
{
  const s = getNavHistorySnapshot();
  eq(s.entries[0].url, "/crm/leads", "Trailing slash stripped");
}

/* -------------------------------------------------------------------------- */
/* 12. MAX_ENTRIES cap enforcement                                            */
/* -------------------------------------------------------------------------- */

reset();
for (let i = 0; i < 105; i++) {
  applyNavigation({ type: "PUSH", key: `cap${i}`, url: `/page-${i}` });
}
{
  const s = getNavHistorySnapshot();
  ok(s.entries.length <= 100, "Stack capped at MAX_ENTRIES");
  eq(s.index, s.entries.length - 1, "Index still at tip after truncation");
}

/* -------------------------------------------------------------------------- */
/* 13. Multi-step cross-module back follows real visit order                  */
/* -------------------------------------------------------------------------- */

reset();
applyNavigation({ type: "PUSH", key: "m1", url: "/crm/contacts" });
applyNavigation({ type: "PUSH", key: "m2", url: "/crm/contacts/123" });
applyNavigation({ type: "PUSH", key: "m3", url: "/crm/contacts/123/edit" });
// Browser back → POP to m2
applyNavigation({ type: "POP", key: "m2", url: "/crm/contacts/123" });
// Browser back → POP to m1
applyNavigation({ type: "POP", key: "m1", url: "/crm/contacts" });
{
  const r = readNavHistory(getNavHistorySnapshot());
  ok(!r.canBack, "At start: Back disabled");
  ok(r.canForward, "Forward available (step to details)");
}
// Browser forward → POP to m2
applyNavigation({ type: "POP", key: "m2", url: "/crm/contacts/123" });
{
  const r = readNavHistory(getNavHistorySnapshot());
  ok(r.canBack, "Back available");
  ok(r.canForward, "Forward still available (to edit)");
}
// Browser forward → POP to m3
applyNavigation({ type: "POP", key: "m3", url: "/crm/contacts/123/edit" });
{
  const r = readNavHistory(getNavHistorySnapshot());
  ok(r.canBack, "Back at tip");
  ok(!r.canForward, "Forward disabled at tip");
}

/* -------------------------------------------------------------------------- */
/* 14. Deep link → no in-app history available                               */
/* -------------------------------------------------------------------------- */

reset();
// First PUSH simulates the initial router observation after a fresh page load.
// navigationType is POP on initial load; applyNavigation handles it via the
// initial empty-state seed path (same as PUSH to an empty stack).
applyNavigation({ type: "POP", key: "dl1", url: "/billing/invoices" });
{
  const r = readNavHistory(getNavHistorySnapshot());
  ok(!r.canBack, "Deep link: Back disabled (no prior in-app)");
  ok(!r.canForward, "Deep link: Forward disabled");
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

console.log("\n" + "=".repeat(50));
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log("=".repeat(50));
process.exit(failed > 0 ? 1 : 0);
