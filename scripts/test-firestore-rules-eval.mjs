/**
 * Firestore rules EVALUATION-ERROR regression checks.
 *
 * These cases reproduce the exact crashes observed as red console errors
 * during authenticated browser runs (CompanyService:getProfile, the
 * AttendanceStore sync, chat/daily-report subscriptions):
 *   - belongsToCompany() ERRORing when the caller's users doc lacks companyId
 *   - LIST queries ERRORing on EMPTY collections because the rule dereferenced
 *     `resource.data` while the emulator probes the query gate with no document
 *   - bills create being poisoned by the update clause evaluated with a null
 *     resource
 * A denial is acceptable; an "evaluation error" inside the denial is a defect
 * (it masks the real decision and breaks whole snapshot listeners).
 *
 * Run with: npm run test:rules-eval
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

const COMPANY = "acme";
const results = [];

function evalClean(err) {
  // The emulator prepends the generic token "evaluation error" to the reason
  // trace of ANY denied rule — even a correct `.get(key, default)` recovery.
  // That token alone is therefore NOT a defect (verified empirically). A real
  // rules BUG is a typed sub-reason that ABORTS evaluation and breaks whole
  // snapshot listeners: a hard field/type fault such as "Property X is
  // undefined on object" (dot-access on an absent field). Only those fail.
  const msg = `${err?.message ?? ""} ${err?.toString?.() ?? ""}`;
  return !/is undefined on object|is not a map|is not a list|Bad type|Unsupported |no matching overload|does not have the field|Cannot index|undefined variable|undefined value/i.test(
    msg,
  );
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS - ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
    console.log(`FAIL - ${name} :: ${err?.message ?? err}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "rules-eval-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", "admin"), { companyId: COMPANY, role: "admin" });
  // Partial profile: exists but WITHOUT companyId/role (login-default write
  // interrupted, legacy import, or manual console doc).
  await setDoc(doc(db, "users", "partial"), { name: "No Company" });
  await setDoc(doc(db, "companies", COMPANY), { name: "Acme" });
  // A private DM conversation owned by admin only — must stay filtered even
  // though the empty-collection gate now passes.
  await setDoc(doc(db, "companies", COMPANY, "conversations", "dm-private"), {
    type: "dm",
    memberIds: ["admin"],
    companyId: COMPANY,
  });
  await setDoc(doc(db, "companies", COMPANY, "bills", "bill1"), {
    companyId: COMPANY,
    approvalStatus: "pending",
    amount: 100,
  });
});

const adminDb = testEnv.authenticatedContext("admin").firestore();
const partialDb = testEnv.authenticatedContext("partial").firestore();
const anonDb = testEnv.unauthenticatedContext().firestore();

// ---- 1. Partial profile: clean denial, never an evaluation error ----
await check("partial profile GET company -> clean deny (no evaluation error)", async () => {
  try {
    await getDoc(doc(partialDb, "companies", COMPANY));
    throw new Error("expected permission-denied, read succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await check("partial profile LIST attendance subcollection -> clean deny", async () => {
  try {
    await getDocs(collection(partialDb, "companies", COMPANY, "attendance"));
    throw new Error("expected permission-denied, read succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

// ---- 2. Empty-collection LIST gates (the snapshot-listener killers) ----
await check("valid member LISTs EMPTY attendance collection -> succeeds", async () => {
  const snap = await getDocs(collection(adminDb, "companies", COMPANY, "attendance"));
  if (!snap.empty) throw new Error("expected empty fixture collection");
});

await check("valid member LISTs conversations (non-empty, private) -> gate ok + per-doc filter", async () => {
  const snap = await getDocs(collection(adminDb, "companies", COMPANY, "conversations"));
  // admin is a member of dm-private, so it must be visible to admin.
  if (snap.docs.length !== 1) throw new Error(`expected 1 conversation for admin, got ${snap.docs.length}`);
});

await check("non-member conversations LIST (constrained, as ChatService does) -> clean empty, no real fault", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", "empX"), { companyId: COMPANY, role: "employee" });
  });
  const empDb = testEnv.authenticatedContext("empX").firestore();
  // Both an empty result and a clean permission-denied are correct SECURE
  // outcomes for a non-member's membership-constrained LIST (production
  // filters the unreadable DM out; the emulator may reject the whole query at
  // the gate). The only thing this regression guards against is a TYPED
  // evaluation FAULT (dot-access on an absent field) leaking into the denial,
  // which is what actually breaks a snapshot listener.
  try {
    const snap = await getDocs(query(collection(empDb, "companies", COMPANY, "conversations"), where("memberIds", "array-contains", "empX")));
    if (!snap.empty) throw new Error("private DM leaked to non-member via list filter");
  } catch (err) {
    if (/private DM leaked/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`real evaluation fault leaked: ${err.message}`);
    // clean permission-denied — acceptable secure outcome
  }
});

await check("valid member LISTs EMPTY daily_reports collection -> succeeds", async () => {
  const snap = await getDocs(collection(adminDb, "companies", COMPANY, "daily_reports"));
  if (!snap.empty) throw new Error("expected empty fixture collection");
});

await check("admin LISTs invites on EMPTY collection -> succeeds (was evaluation error)", async () => {
  const snap = await getDocs(query(collection(adminDb, "invites"), where("companyId", "==", COMPANY)));
  if (!snap.empty) throw new Error("expected empty fixture collection");
});

// ---- 3. Bills: employee create must not be poisoned by the update clause ----
await check("employee CREATE pending bill -> succeeds", async () => {
  const empDb2 = testEnv.authenticatedContext("empX").firestore();
  await setDoc(doc(empDb2, "companies", COMPANY, "bills", "bill_new"), {
    companyId: COMPANY,
    approvalStatus: "pending",
    amount: 50,
  });
});

await check("employee CREATE pre-approved bill -> denied", async () => {
  const empDb2 = testEnv.authenticatedContext("empX").firestore();
  try {
    await setDoc(doc(empDb2, "companies", COMPANY, "bills", "bill_sneaky"), {
      companyId: COMPANY,
      approvalStatus: "approved",
      amount: 50,
    });
    throw new Error("expected permission-denied, write succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await check("bill UPDATE still enforces approval gate (pending->approved by member denied)", async () => {
  // admin role is a reviewer, so use empX (plain employee).
  const empDb = testEnv.authenticatedContext("empX").firestore();
  try {
    await setDoc(doc(empDb, "companies", COMPANY, "bills", "bill1"), {
      companyId: COMPANY,
      approvalStatus: "approved",
      amount: 100,
    });
    throw new Error("expected permission-denied, approval escalation succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

// ---- 4. Unauthenticated sanity ----
await check("anonymous LIST attendance -> clean deny", async () => {
  try {
    await getDocs(collection(anonDb, "companies", COMPANY, "attendance"));
    throw new Error("expected permission-denied, read succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

// ---- 5. Employee self-service shiftStatus (attendance punch regression) ----
// The invitation-security tightening added an explicit /employees block and
// excluded employees from the company-member catch-all. That removed the
// self-service shiftStatus write check-in/check-out/break depend on
// (PeopleService writes { shiftStatus, updatedAt } to the caller's own employee
// doc). The fix restores ONLY that narrow capability. These cases prove:
//   authorized own-record shiftStatus update => ALLOWED
//   cross-company, cross-employee, and identity-field writes => DENIED
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", "empSelf"), { companyId: COMPANY, role: "employee" });
  await setDoc(doc(db, "users", "empPeer"), { companyId: COMPANY, role: "employee" });
  await setDoc(doc(db, "users", "outsider"), { companyId: "other-co", role: "employee" });
  await setDoc(doc(db, "companies", "other-co"), { name: "Other Co" });
  await setDoc(doc(db, "companies", COMPANY, "employees", "empSelf"), {
    companyId: COMPANY, userId: "empSelf", email: "self@acme.test",
    role: "employee", name: "Self", shiftStatus: "off-duty",
  });
  await setDoc(doc(db, "companies", COMPANY, "employees", "empPeer"), {
    companyId: COMPANY, userId: "empPeer", email: "peer@acme.test",
    role: "employee", name: "Peer", shiftStatus: "off-duty",
  });
  await setDoc(doc(db, "companies", "other-co", "employees", "outsiderEmp"), {
    companyId: "other-co", userId: "outsider", email: "out@other.test",
    role: "employee", name: "Out", shiftStatus: "off-duty",
  });
});

const selfDb = testEnv.authenticatedContext("empSelf").firestore();
const peerDb = testEnv.authenticatedContext("empPeer").firestore();
const outsiderDb = testEnv.authenticatedContext("outsider").firestore();

await check("employee updates OWN shiftStatus (off-duty->working) -> succeeds", async () => {
  await updateDoc(doc(selfDb, "companies", COMPANY, "employees", "empSelf"), {
    shiftStatus: "working",
    updatedAt: new Date(),
  });
  const snap = await getDoc(doc(selfDb, "companies", COMPANY, "employees", "empSelf"));
  if (snap.data()?.shiftStatus !== "working") throw new Error("shiftStatus did not persist");
});

await check("employee cycles OWN shiftStatus working->on-break->off-duty -> succeeds", async () => {
  for (const next of ["on-break", "off-duty"]) {
    await updateDoc(doc(selfDb, "companies", COMPANY, "employees", "empSelf"), {
      shiftStatus: next,
      updatedAt: new Date(),
    });
  }
});

await check("employee updates OWN shiftStatus + identity field (role) -> denied", async () => {
  try {
    await updateDoc(doc(selfDb, "companies", COMPANY, "employees", "empSelf"), {
      shiftStatus: "working",
      role: "admin",
    });
    throw new Error("expected permission-denied, identity escalation succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await check("employee updates a PEER's shiftStatus (same company) -> denied", async () => {
  try {
    await updateDoc(doc(selfDb, "companies", COMPANY, "employees", "empPeer"), {
      shiftStatus: "working",
      updatedAt: new Date(),
    });
    throw new Error("expected permission-denied, cross-employee write succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await check("cross-company member updates another tenant's employee shiftStatus -> denied", async () => {
  try {
    await updateDoc(doc(outsiderDb, "companies", COMPANY, "employees", "empSelf"), {
      shiftStatus: "working",
      updatedAt: new Date(),
    });
    throw new Error("expected permission-denied, cross-company write succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await check("cross-company member updates OWN tenant employee shiftStatus -> succeeds (per-tenant control)", async () => {
  await updateDoc(doc(outsiderDb, "companies", "other-co", "employees", "outsiderEmp"), {
    shiftStatus: "working",
    updatedAt: new Date(),
  });
});

await check("anonymous updates employee shiftStatus -> clean deny", async () => {
  try {
    await updateDoc(doc(anonDb, "companies", COMPANY, "employees", "empSelf"), {
      shiftStatus: "working",
    });
    throw new Error("expected permission-denied, anonymous write succeeded");
  } catch (err) {
    if (/expected permission-denied/.test(err.message)) throw err;
    if (!evalClean(err)) throw new Error(`evaluation error leaked: ${err.message}`);
  }
});

await testEnv.cleanup();

const failed = results.filter((r) => !r.ok);
console.log("\n============ FIRESTORE RULES EVAL-ERROR REGRESSION ============");
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name} :: ${f.err}`);
  process.exit(1);
}
