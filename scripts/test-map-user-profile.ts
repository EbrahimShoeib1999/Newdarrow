/**
 * mapFirestoreUser — "No Fabricated Tenant" Regression Suite
 *
 * Guards the in-progress auth repair and the Bug-1 fix. A previous version
 * matched demo `mockUsers` and silently grafted a real login onto the seeded
 * "d-arrow" workspace; login() then stamped a hardcoded "default-company"
 * tenant. Both made orphan accounts invisible in the company-scoped Users query
 * instead of surfacing them for reconciliation.
 *
 * Run with: npx tsx scripts/test-map-user-profile.ts
 */

import { mapFirestoreUser } from "../src/features/auth/utils/map-user";

const results: { name: string; ok: boolean; details?: string }[] = [];

function check(name: string, cond: boolean, details?: string) {
  if (!cond) throw new Error(`${name}${details ? ` — ${details}` : ""}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ name, ok: false, details: msg });
    console.error(`FAIL: ${name}\n  Error: ${msg}`);
  }
}

console.log("=======================================================");
console.log(" D-Arrow — mapFirestoreUser Tenant/Profile Regression");
console.log("=======================================================\n");

// ---------------------------------------------------------------------------
// 1. Missing profile document => profileMissing, NO fabricated tenant.
// ---------------------------------------------------------------------------
await test("1. Undefined profile doc => profileMissing, empty tenant", () => {
  const u = mapFirestoreUser("uid-1", undefined);
  check("profileMissing is TRUE", u.profileMissing === true);
  check("companyId is empty (not a magic tenant)", u.companyId === "", `got "${u.companyId}"`);
  check("companyName is empty", u.companyName === "", `got "${u.companyName}"`);
  check("never 'default-company'", u.companyId !== "default-company");
  check("never 'd-arrow'", u.companyId !== "d-arrow");
  check("role defaults to employee", u.role === "employee");
});

// ---------------------------------------------------------------------------
// 2. Present-but-empty profile => NOT profileMissing, still no tenant invented.
// ---------------------------------------------------------------------------
await test("2. Present empty profile => not missing, empty tenant preserved", () => {
  const u = mapFirestoreUser("uid-2", {});
  check("profileMissing is FALSE", u.profileMissing === false);
  check("companyId empty (findable by reconciliation query)", u.companyId === "");
});

// ---------------------------------------------------------------------------
// 3. Real tenant is carried verbatim — no override, no demo match.
// ---------------------------------------------------------------------------
await test("3. Stored companyId is honored verbatim", () => {
  const u = mapFirestoreUser("uid-3", {
    companyId: "acme-123",
    companyName: "Acme",
    role: "manager",
    email: "boss@acme.test",
    name: "The Boss",
  });
  check("companyId preserved", u.companyId === "acme-123");
  check("companyName preserved", u.companyName === "Acme");
  check("role preserved", u.role === "manager");
  check("name from data", u.name === "The Boss");
  check("profileMissing false", u.profileMissing === false);
});

// ---------------------------------------------------------------------------
// 4. No mock-user grafting: a demo-looking email must NOT inherit a mock name,
//    role, or company. (This is exactly what silently orphaned logins before.)
// ---------------------------------------------------------------------------
await test("4. Never grafts demo mock-user identity", () => {
  const u = mapFirestoreUser("uid-4", { email: "admin@d-arrow.test" });
  check("no mock name grafted", u.name !== "D-Arrow Admin");
  check("empty company stays empty (mock companyId not applied)", u.companyId === "", `got "${u.companyId}"`);
  check("companyName not grafted", u.companyName === "", `got "${u.companyName}"`);
});

// ---------------------------------------------------------------------------
// 5. Name fallback chain: data.name -> fallbacks.name -> fallbacks.email local
//    part -> "User". Never a mock.
// ---------------------------------------------------------------------------
await test("5. Name fallback chain resolves without mocks", () => {
  check("fallbacks.name used", mapFirestoreUser("x", {}, { name: "FB Name" }).name === "FB Name");
  check(
    "fallbacks.email local-part used",
    mapFirestoreUser("x", {}, { email: "jane@example.com" }).name === "jane"
  );
  check("last resort is generic 'User'", mapFirestoreUser("x", {}).name === "User");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log("\n=======================================================");
console.log(` Summary: ${passed}/${results.length} passed${failed ? `, ${failed} FAILED` : ""}`);
console.log("=======================================================\n");
if (failed > 0) process.exit(1);
