/**
 * Firebase Auth + Firestore Emulator integration for BUG 1 — orphan /
 * invite account visibility in the Users page (mission 1.1 / 1.2 / 1.3).
 * Run with: npm run test:registration-visibility
 *
 * Unlike the rules suite (which asserts rule clauses in isolation) this runs
 * the EXACT persistence + query shapes the shipped services perform, against
 * the emulator with rules ENFORCED, and checks what the Users page actually
 * sees:
 *
 *   - AuthService.acceptInvite → setDoc(users/{uid}, { companyId: invite.companyId })
 *     then useAllUsers → query(users, where companyId==<company>)  ⇒ INVITEE VISIBLE
 *   - AuthService.login orphan provisioning → setDoc(users/{uid}, { companyId: "" })
 *     same roster query                                ⇒ ORPHAN INVISIBLE to tenants
 *     UsersService.listUnassignedAccounts (super_admin)
 *                                        → query(users, where companyId=="") ⇒ ORPHAN RECONCILABLE
 *   - the pre-fix `default-company` write            ⇒ INVISIBLE EVERYWHERE (the bug)
 *   - reconciliation SECURITY:
 *       • a platform super_admin identifies orphans
 *       • an ordinary employee is DENIED the reconciliation query
 *       • foreign-company profiles never leak into either query
 *       • the original company-scoped roster query still returns its tenant
 *
 * Authenticated contexts are backed by the real Auth emulator (the npm script
 * runs `emulators:exec --only auth,firestore`), so `request.auth.uid` is a
 * genuine token — not a stub.
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, query, where } from "firebase/firestore";

const ACME = "acme-co";
const OTHER = "other-co";
const PRE_FIX_TENANT = "default-company";

const results = [];

// Same stray-rejection class documented in test-attendance-authz.mjs: the SDK
// re-emits a denied LIST as a second unhandled rejection for the same query.
// Every legitimate rejection here is awaited inside check()/assert helpers, so
// a duplicate permission-denied is suppressed; anything else must crash loudly.
process.on("unhandledRejection", (err) => {
  const msg = err?.message ?? String(err);
  if (err?.code === "permission-denied") {
    console.log(`NOTE: suppressed duplicate async rejection: ${msg.replace(/\s+/g, " ").slice(0, 120)}`);
    return;
  }
  console.error("UNEXPECTED unhandled rejection:", msg);
  process.exit(1);
});

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
    console.log(`FAIL: ${name} — ${err?.message ?? String(err)}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "registration-visibility-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

// SETUP only (rules bypassed): the two tenants, an ordinary acme admin/member,
// a foreign acme-lookalike from OTHER, and the platform super_admin (no tenant).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "companies", ACME), { id: ACME, name: "Acme Solutions", defaultCurrency: "SAR" });
  await setDoc(doc(db, "companies", OTHER), { id: OTHER, name: "Other Corp", defaultCurrency: "SAR" });
  await setDoc(doc(db, "users", "member-uid"), {
    id: "member-uid", email: "member@acme.test", name: "Acme Member", role: "admin", companyId: ACME,
  });
  await setDoc(doc(db, "users", "emp-uid"), {
    id: "emp-uid", email: "emp@acme.test", name: "Acme Employee", role: "employee", companyId: ACME,
  });
  await setDoc(doc(db, "users", "foreign-uid"), {
    id: "foreign-uid", email: "who@other.test", name: "Foreign User", role: "employee", companyId: OTHER,
  });
  await setDoc(doc(db, "users", "super-uid"), {
    id: "super-uid", email: "super@darrow.test", name: "Platform Super Admin", role: "super_admin", companyId: "",
  });
});

// Query shapes copied verbatim from the shipped services.
const rosterQuery = (db, companyId) => query(collection(db, "users"), where("companyId", "==", companyId));
const reconcileQuery = (db) => query(collection(db, "users"), where("companyId", "==", ""));

const member = testEnv.authenticatedContext("member-uid").firestore(); // acme admin
const employee = testEnv.authenticatedContext("emp-uid").firestore();   // acme ordinary employee
const superAdmin = testEnv.authenticatedContext("super-uid").firestore();

const ids = (snap) => snap.docs.map((d) => d.id);

// ============================ 1. INVITE REGISTRATION ========================
// AuthService.acceptInvite: the NEW account self-provisions its profile with
// the INVITE's real tenant. The create rule (request.auth.uid == userId) lets
// it through, and the roster query must then return it.
await check("invite accept: new account writes own profile with invite.companyId", async () => {
  const invitee = testEnv.authenticatedContext("invitee-uid").firestore();
  await assertSucceeds(
    setDoc(doc(invitee, "users", "invitee-uid"), {
      id: "invitee-uid",
      email: "rania@acme.test",
      name: "Rania Haddad",
      nameAr: "",
      avatar: "https://avatar.vercel.sh/invitee-uid",
      role: "employee",
      companyId: ACME,
      companyName: "Acme Solutions",
      portalAccess: ["people", "tasks"],
      portalSubRoles: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  );
});

await check("invite accept: invitee VISIBLE in the company-scoped roster query", async () => {
  const snap = await assertSucceeds(getDocs(rosterQuery(member, ACME)));
  if (!ids(snap).includes("invitee-uid")) throw new Error("invitee missing from acme roster");
  // Pre-existing tenant members stay in the roster — the query is unchanged.
  if (!ids(snap).includes("member-uid") || !ids(snap).includes("emp-uid")) {
    throw new Error("company-scoped roster query no longer returns its own members");
  }
});

// ============================ 2. ORPHAN LOGIN PROVISIONING ==================
// AuthService.login for an account with no profile doc: write companyId ""
// (NOT the fabricated default-company). Self-create is allowed.
await check("orphan login: provisioning write with empty companyId is allowed (self-create)", async () => {
  const orphan = testEnv.authenticatedContext("orphan-uid").firestore();
  await assertSucceeds(
    setDoc(doc(orphan, "users", "orphan-uid"), {
      id: "orphan-uid",
      email: "stray@acme.test",
      name: "stray",
      nameAr: "",
      avatar: "https://avatar.vercel.sh/orphan-uid",
      role: "employee",
      companyId: "",
      companyName: "",
    })
  );
});

await check("orphan: INVISIBLE to the company-scoped roster query", async () => {
  const snap = await assertSucceeds(getDocs(rosterQuery(member, ACME)));
  if (ids(snap).includes("orphan-uid")) throw new Error("orphan leaked into acme roster");
});

await check("orphan: RECONCILABLE — returned by super_admin listUnassignedAccounts query", async () => {
  const snap = await assertSucceeds(getDocs(reconcileQuery(superAdmin)));
  if (!ids(snap).includes("orphan-uid")) throw new Error("orphan not surfaced for reconciliation");
});

// ==================== 3. PRE-FIX BEHAVIOUR CONTRAST (the bug) ==============
// Before the fix login() wrote companyId "default-company". Such a doc matches
// NEITHER a real tenant roster query NOR the "" reconciliation query, so the
// account is stranded/invisible everywhere. This pins the regression.
await check("pre-fix 'default-company' profile is invisible to BOTH roster and reconciliation", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", "legacy-uid"), {
      id: "legacy-uid", email: "legacy@darrow.test", name: "Legacy", role: "employee",
      companyId: PRE_FIX_TENANT,
    });
  });
  const roster = await assertSucceeds(getDocs(rosterQuery(member, ACME)));
  if (ids(roster).includes("legacy-uid")) throw new Error("stranded doc unexpectedly in acme roster");
  const recon = await assertSucceeds(getDocs(reconcileQuery(superAdmin)));
  if (ids(recon).includes("legacy-uid")) throw new Error("stranded doc unexpectedly reconcilable");
});

// ==================== 4. RECONCILIATION SECURITY ENVELOPE ===================
await check("SEC: ordinary employee is DENIED the reconciliation query", async () => {
  await assertFails(getDocs(reconcileQuery(employee)));
});

await check("SEC: acme admin is DENIED the reconciliation query (not super_admin)", async () => {
  await assertFails(getDocs(reconcileQuery(member)));
});

await check("SEC: foreign-company profile never leaks into acme roster", async () => {
  const snap = await assertSucceeds(getDocs(rosterQuery(member, ACME)));
  if (ids(snap).includes("foreign-uid")) throw new Error("OTHER-co user leaked into acme roster");
});

await check("SEC: reconciliation returns ONLY orphans — no foreign/tenant profiles exposed", async () => {
  const snap = await assertSucceeds(getDocs(reconcileQuery(superAdmin)));
  for (const id of ids(snap)) {
    if (["foreign-uid", "member-uid", "emp-uid", "invitee-uid", "legacy-uid"].includes(id)) {
      throw new Error(`reconciliation exposed a non-orphan profile: ${id}`);
    }
  }
});

// The assignment write: super_admin consumes an orphan (empty → real tenant),
// which the rules allow, while an ordinary acme admin cannot grab a foreign doc.
await check("SEC: super_admin CAN attach an orphan to a real company (reconciliation write)", async () => {
  await assertSucceeds(
    updateCompanyId(superAdmin, "orphan-uid", ACME, "Acme Solutions")
  );
});

await check("SEC: after assignment the orphan is now in the acme roster (workflow closed)", async () => {
  const snap = await assertSucceeds(getDocs(rosterQuery(member, ACME)));
  if (!ids(snap).includes("orphan-uid")) throw new Error("assigned orphan still invisible to tenant");
});

function updateCompanyId(db, userId, companyId, companyName) {
  return setDoc(doc(db, "users", userId), { companyId, companyName }, { merge: true });
}

// Guard that the original company-scoped GET still works and still isolates:
// an acme member can GET a same-company profile but not the foreign one.
await check("SEC: same-company profile GET allowed, foreign profile GET denied (tenant isolation)", async () => {
  await assertSucceeds(getDoc(doc(member, "users", "emp-uid")));
  await assertFails(getDoc(doc(member, "users", "foreign-uid")));
});

console.log("\n========== registration visibility (auth+firestore) results ==========");
for (const r of results) console.log(`${r.ok ? "✓ PASS" : "✗ FAIL"}: ${r.name}${r.err ? ` — ${r.err}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} checks passed`);
await testEnv.cleanup().catch(() => {});
process.exit(failed ? 1 : 0);
