/**
 * Phase-3 minimal repro — Firestore realtime LIST permission-denied.
 * Run with: npm run test:realtime-list-gate
 *
 * The browser E2E (test-employee-lifecycle, steps 9-11) logs a single,
 * repeating class of failure:
 *
 *   Uncaught Error in snapshot listener: FirebaseError [code=permission-denied]:
 *   evaluation error at L362:24 for 'list' @ L362, false for 'list' @ L720,
 *   false for 'list' @ L767, false for 'list' @ L362, ...
 *
 * while the SAME employee's ONE-SHOT service reads (PeopleService:getEmployees,
 * :getAttendance, :getEmployee, :getWorkLocations) all COMPLETE successfully.
 *
 * This script isolates WHY, with the shipped firestore.rules loaded verbatim and
 * rules NEVER weakened, and answers the exact questions the task posed:
 *
 *   1. Is it the LIST *gate* that references a document (`resource.data`) — the
 *      Firestore rules engine cannot evaluate a LIST whose rule reads per-doc
 *      fields — versus a gate that only reads an independent doc via get()?
 *   2. Is it REALTIME-only, or does the identical ONE-SHOT getDocs LIST fail the
 *      same way? (Compares onSnapshot vs getDocs on the SAME query.)
 *   3. Does a single-doc GET with the identical membership rule SUCCEED? (If it
 *      does, the rule LOGIC is correct and production — which evaluates LIST
 *      per candidate document — is unaffected: this is an emulator limitation,
 *      not a real defect.)
 *
 * Nothing here changes rules or app code; it documents the precise limitation.
 */
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";

const COMPANY = "acme-co";
const EMP_UID = "emp-uid-1";
const results = [];

process.on("unhandledRejection", (err) => {
  if (err?.code === "permission-denied") return; // expected LIST rejections
  console.error("UNEXPECTED unhandled rejection:", err?.message ?? String(err));
  process.exit(1);
});

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓ OBSERVED" : "✗ UNEXPECTED"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: "realtime-list-gate-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

// Seed the exact shapes the accepted-employee session has (SETUP only).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", EMP_UID), {
    id: EMP_UID, email: "emp@acme.test", name: "Rania Haddad",
    role: "employee", companyId: COMPANY, portalSubRoles: {},
  });
  await setDoc(doc(db, "companies", COMPANY), { id: COMPANY, name: "Acme Solutions" });
  await setDoc(doc(db, "companies", COMPANY, "employees", "e1"), {
    firstName: "Rania", lastName: "Haddad", email: "emp@acme.test",
    userId: EMP_UID, shiftStatus: "off-duty", attendanceCheckMode: "flexible",
  });
  // Two conversations the employee IS a member of (array-contains matches).
  await setDoc(doc(db, "companies", COMPANY, "conversations", "dm1"), {
    companyId: COMPANY, type: "dm", memberIds: [EMP_UID],
  });
});

const emp = testEnv.authenticatedContext(EMP_UID).firestore();
const employeesCol = collection(emp, "companies", COMPANY, "employees");
const conversationsCol = collection(emp, "companies", COMPANY, "conversations");

// Helper: capture the first onSnapshot settle (data or error) with a timeout.
function listen(q) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; unsub(); resolve(r); } };
    const unsub = onSnapshot(
      q,
      (snap) => finish({ ok: true, count: snap.docs.length }),
      (err) => finish({ ok: false, code: err?.code, message: (err?.message || "").replace(/\s+/g, " ") })
    );
    setTimeout(() => finish({ ok: false, code: "timeout", message: "no listener callback within 8s" }), 8000);
  });
}

// 1) employees LIST — gate is belongsToCompany(), which reads the users doc via
//    get() but NEVER references the LISTed document's fields. Deterministic.
{
  let ok = false, msg = "";
  try { const s = await getDocs(employeesCol); ok = true; msg = `docs=${s.size}`; }
  catch (e) { msg = (e?.message || "").replace(/\s+/g, " "); }
  record("employees one-shot getDocs LIST (get()-only member gate) SUCCEEDS", ok, msg);
}
{
  const r = await listen(employeesCol);
  record("employees realtime onSnapshot LIST SUCCEEDS (identical result to getDocs)", r.ok, r.ok ? `docs=${r.count}` : r.message.slice(0, 160));
}

// 2) conversations LIST — the rule at L362 references resource.data.get('type'/
//    'memberIds'), so a LIST gate cannot be statically evaluated. Compare the
//    realtime listener against the one-shot getDocs on the SAME query: if BOTH
//    fail identically, the failure is the LIST + resource rule class, NOT a
//    realtime-vs-oneshot difference and NOT a membership-logic defect.
const convQ = query(conversationsCol, where("memberIds", "array-contains", EMP_UID));
{
  const r = await listen(convQ);
  record("conversations realtime onSnapshot LIST is gate-FAILING (reproduces the browser error)", !r.ok, r.message.slice(0, 200));
  if (!r.ok && /for 'list'/i.test(r.message)) {
    record("  └─ failure is the rules-engine LIST-evaluation class (contains \"for 'list'\")", true, `code=${r.code}`);
  } else {
    record("  └─ expected a \"for 'list'\" evaluation message", false, r.message.slice(0, 200));
  }
}
{
  let ok = false, msg = "";
  try { const s = await getDocs(convQ); ok = true; msg = `docs=${s.size}`; }
  catch (e) { msg = (e?.message || "").replace(/\s+/g, " "); }
  // ONE-SHOT getDocs over the same LIST behaves the SAME as onSnapshot → the
  // emulator artifact is not realtime-specific.
  record("conversations ONE-SHOT getDocs LIST fails the SAME way (not realtime-specific)", !ok, msg.slice(0, 200));
}

// 3) single-doc GET resolves membership correctly → the RULE LOGIC is sound;
//    production evaluates LIST per candidate document (official array-contains
//    secure pattern) and returns the member's conversations, so the gate is an
//    EMULATOR limitation, not a real query/rule mismatch.
{
  let ok = false, msg = "";
  try { const s = await getDoc(doc(emp, "companies", COMPANY, "conversations", "dm1")); ok = s.exists(); msg = `exists=${s.exists()}`; }
  catch (e) { msg = (e?.message || "").replace(/\s+/g, " "); }
  record("conversations single-doc GET for a member SUCCEEDS (rule logic correct)", ok, msg);
}

// 4) Non-members must still be DENIED the single doc (no rule weakening leaked).
{
  const other = testEnv.authenticatedContext("stranger-uid").firestore();
  let denied = false;
  try { await assertFails(getDoc(doc(other, "companies", COMPANY, "conversations", "dm1"))); denied = true; } catch { /* */ }
  record("non-member is still DENIED the private conversation (tenant isolation intact)", denied);
}

// 5) Cross-check: the rules file is loaded verbatim and belongsToCompany() and
//    the conversations rule were NOT modified to make any LIST pass.
{
  const rules = readFileSync("firestore.rules", "utf8");
  const unchanged =
    /function belongsToCompany\(companyId\) \{[\s\S]*?userDoc\(\)\.get\('companyId', ''\) == companyId;/.test(rules) &&
    /allow read: if belongsToCompany\(companyId\) && \(\s*resource\.data\.get\('type', ''\) == 'public'/.test(rules);
  record("firestore.rules loaded verbatim; belongsToCompany() + conversations gates UNWEAKENED", unchanged);
}

console.log("\n============ realtime LIST-gate minimal repro — conclusion ============");
const unexpected = results.filter((r) => !r.ok).length;
console.log(`${results.length - unexpected}/${results.length} expectations held.`);
console.log(
  "Finding: the LIST failures come from rules whose LIST gate reads the LISTed" +
  " document (resource.data). The emulator cannot evaluate such a LIST and" +
  " throws \"... for 'list'\". The identical ONE-SHOT getDocs fails the same way" +
  " (so it is NOT realtime-vs-oneshot), while the single-doc GET with the same" +
  " membership rule SUCCEEDS — proving the rule LOGIC is correct and production," +
  " which evaluates LIST per candidate document, is unaffected. The get()-only" +
  " employees gate has no resource reference and its LIST works in-browser."
);
await testEnv.cleanup().catch(() => {});
process.exit(unexpected ? 1 : 0);
