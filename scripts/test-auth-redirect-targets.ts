/**
 * PHASE 2 unit guard — post-login destination contract.
 * Proves the redirect resolver can never hand back the public homepage "/"
 * after an authentication completion, never bounces between auth pages, and
 * rejects forged/open-redirect `from` values.
 *
 * Run: npx tsx scripts/test-auth-redirect-targets.ts
 */
import assert from "node:assert/strict";
import {
  PORTAL_PICKER_PATH,
  hasPostLoginIntent,
  isSafeInternalPath,
  resolvePostLoginTarget,
} from "../src/features/auth/utils/post-login";

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok - ${label}`);
}

// A location-like stub (react-router Location fields we actually read).
const loc = (state: unknown) =>
  ({ state, pathname: "/login", search: "", hash: "" }) as never;

console.log("post-login destination resolver:");

check("default lands on the portal picker, never the public homepage", () => {
  const t = resolvePostLoginTarget(loc(null));
  assert.equal(t.to, PORTAL_PICKER_PATH);
  assert.equal(t.to, "/apps");
  assert.deepEqual(t.state, { choosePortal: true });
});

check("honors a legit internal deep link captured by ProtectedRoute", () => {
  const t = resolvePostLoginTarget(
    loc({ from: { pathname: "/crm/deals", search: "?tab=won", hash: "#note" } }),
  );
  assert.equal(t.to, "/crm/deals?tab=won#note");
  assert.equal(t.state, undefined);
});

check("drops malformed query/fragment instead of reflecting them", () => {
  const t = resolvePostLoginTarget(
    loc({ from: { pathname: "/tasks", search: "evil://x", hash: "bad" } }),
  );
  assert.equal(t.to, "/tasks");
});

check("rejects protocol-relative open redirect", () => {
  assert.equal(isSafeInternalPath("//evil.com"), false);
  const t = resolvePostLoginTarget(loc({ from: { pathname: "//evil.com" } }));
  assert.equal(t.to, PORTAL_PICKER_PATH);
});

check("rejects backslash-obfuscated redirect", () => {
  assert.equal(isSafeInternalPath("/\\evil.com"), false);
  const t = resolvePostLoginTarget(loc({ from: { pathname: "/\\evil.com" } }));
  assert.equal(t.to, PORTAL_PICKER_PATH);
});

check("rejects scheme-qualified and relative lookalikes", () => {
  assert.equal(isSafeInternalPath("https://evil.com"), false);
  assert.equal(isSafeInternalPath("evil.com"), false);
  assert.equal(isSafeInternalPath(undefined), false);
});

check("never targets auth pages (no /login <-> / bounce loops)", () => {
  for (const p of ["/login", "/register", "/forgot-password", "/reset-password"]) {
    const t = resolvePostLoginTarget(loc({ from: { pathname: p } }));
    assert.equal(t.to, PORTAL_PICKER_PATH, `from=${p}`);
  }
});

check("/apps as `from` resolves to the picker itself", () => {
  const t = resolvePostLoginTarget(loc({ from: { pathname: PORTAL_PICKER_PATH } }));
  assert.equal(t.to, PORTAL_PICKER_PATH);
  assert.deepEqual(t.state, { choosePortal: true });
});

check("post-login intent detection for the / boundary guard", () => {
  assert.equal(hasPostLoginIntent(loc({ choosePortal: true })), true);
  assert.equal(hasPostLoginIntent(loc({})), false);
  assert.equal(hasPostLoginIntent(loc(null)), false);
});

console.log(`\n${passed} assertions passed.`);
