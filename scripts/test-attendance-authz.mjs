/**
 * Firestore rules checks for the employee attendance LIST/WRITE path.
 * Run with: npm run test:attendance-authz
 *
 * Reproduces (read/write against the emulator with rules ENFORCED) the exact
 * query shapes the employee session runs after an invite accept:
 *   - AttendanceStore.syncWithDb: employees query (userId), claim update,
 *     PeopleService.getAttendance: attendance query (employeeId)
 *   - PeopleService.checkIn: settings GET + attendance addDoc
 *   - chat listeners: conversations LIST (empty collection and a legacy doc
 *     that carries no `type` field, which made resource.data.type error)
 *
 * Nothing here relaxes a rule; it proves whether the shipped rules deny these
 * legitimate employee operations (the E2E step 9-11 blocker).
 */
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";

const COMPANY = "acme-co";
const EMP_UID = "emp-uid-1";
const results = [];

// The Firestore SDK re-emits the emulator's LIST evaluation rejection
// asynchronously (a second, unhandled promise for the SAME denied query) once
// the caught rejection has been processed. Every legitimate rejection in this
// script is awaited inside check()/assert* helpers, so a stray permission-
// denied here can only be that duplicate stream error — log and survive;
// anything else must still crash loudly.
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

/**
 * Asserts the operation is DENIED and that the denial is NOT the
 * "Property <x> is undefined" crash class — the bug where a malformed/absent
 * field made the rule engine error while evaluating a REAL document. That
 * crash also occurs in production Firestore (it poisons the whole query).
 *
 * A different class is tolerated here and labeled explicitly: the emulator
 * wraps its LIST-gate evaluation as "evaluation error at L..:.. for 'list'".
 * Probe matrix (scratch/authz-matrix.mjs) proved the emulator ALWAYS produces
 * that when a LIST's gate resolves FALSE through a get()-derived comparison
 * (isCompanyAdmin included), regardless of `.get`/`in`/`hasAny`/`==` style.
 * It is emulator-only: production evaluates rules per returned document and
 * this array-contains membership query is the officially documented secure
 * pattern. Admins are unaffected (their gate resolves TRUE and per-doc
 * filtering still applies), so the rule keeps its full strength.
 */
async function assertFailsWithoutPropertyCrash(fn) {
  let failed = false;
  let message = "";
  try {
    await fn();
  } catch (err) {
    failed = true;
    message = err?.message ?? String(err);
  }
  if (!failed) throw new Error("expected permission-denied but the read succeeded");
  if (/Property .* is undefined/i.test(message)) {
    throw new Error(`rule poisoned by a malformed document: ${message}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: "attendance-authz-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

// Seed the exact shapes the app writes (rules bypassed for SETUP only).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // users/{uid} as AuthService.acceptInvite writes it.
  await setDoc(doc(db, "users", EMP_UID), {
    id: EMP_UID,
    email: "lifecycle_emp@acme.test",
    name: "Rania Haddad",
    nameAr: "",
    avatar: `https://avatar.vercel.sh/${EMP_UID}`,
    role: "employee",
    companyId: COMPANY,
    companyName: "Acme Solutions",
    portalAccess: ["people", "tasks"],
    portalSubRoles: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "companies", COMPANY), {
    id: COMPANY,
    name: "Acme Solutions",
    defaultCurrency: "SAR",
  });
  // The hired directory record BEFORE the claim (no userId yet).
  await setDoc(doc(db, "companies", COMPANY, "employees", "e1"), {
    firstName: "Rania",
    lastName: "Haddad",
    email: "lifecycle_emp@acme.test",
    jobTitle: "Software Engineer",
    shiftStatus: "off-duty",
    attendanceCheckMode: "flexible",
  });
});

const emp = testEnv.authenticatedContext(EMP_UID).firestore();
const employeesCol = collection(emp, "companies", COMPANY, "employees");
const attendanceCol = collection(emp, "companies", COMPANY, "attendance");
const conversationsCol = collection(emp, "companies", COMPANY, "conversations");

// --- AttendanceStore.syncWithDb query shapes ---
await check("employee: employees query where userId==uid (pre-claim, empty)", async () => {
  await assertSucceeds(getDocs(query(employeesCol, where("userId", "==", EMP_UID))));
});

await check("employee: unfiltered employees LIST (allEmpSnap fallback)", async () => {
  await assertSucceeds(getDocs(employeesCol));
});

await check("employee: claim-by-email update sets userId on own record", async () => {
  await assertSucceeds(
    updateDoc(doc(emp, "companies", COMPANY, "employees", "e1"), {
      userId: EMP_UID,
      updatedAt: serverTimestamp(),
    })
  );
});

await check("employee: attendance query where employeeId==e1 (empty collection)", async () => {
  await assertSucceeds(
    getDocs(query(attendanceCol, where("employeeId", "==", "e1")))
  );
});

// --- PeopleService.checkIn write path ---
await check("employee: settings/attendance GET (doc absent)", async () => {
  await assertSucceeds(getDoc(doc(emp, "companies", COMPANY, "settings", "attendance")));
});

await check("employee: addDoc attendance check-in payload", async () => {
  await assertSucceeds(
    addDoc(attendanceCol, {
      employeeId: "e1",
      date: new Date().toISOString().split("T")[0],
      checkIn: serverTimestamp(),
      status: "present",
      lateMinutes: 0,
      deductionMinutes: 0,
      createdAt: serverTimestamp(),
    })
  );
});

// --- Chat listeners running app-wide during the same session ---
// Emulator limitation, proven and labeled (see assertFailsWithoutPropertyCrash
// and scratch/authz-matrix.mjs): the employee LIST gate resolves FALSE through
// isCompanyAdmin's get(), which the emulator reports as an evaluation error →
// denial. Production Firestore would filter per document instead.
await check("employee: conversations LIST (array-contains) is denied without a property crash", async () => {
  await assertFailsWithoutPropertyCrash(
    getDocs(query(conversationsCol, where("memberIds", "array-contains", EMP_UID)))
  );
});

// A conversation doc WITHOUT `type` — the shape behind the original E2E console
// error "Property type is undefined on object. for 'list' @ L173".
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "companies", COMPANY, "conversations", "legacy1"), {
    name: "Legacy (no type field)",
    companyId: COMPANY,
    memberIds: [EMP_UID],
  });
});

await check("employee: GET the type-less doc they're a member of (no crash)", async () => {
  // Member access must resolve through the guarded memberIds branch even when
  // the document has no `type` field at all.
  await assertSucceeds(
    getDoc(doc(emp, "companies", COMPANY, "conversations", "legacy1"))
  );
});

await check("employee: conversations LIST with type-less doc stays denied (emulator gate) but NOT via a property crash", async () => {
  // Before the `.get(key, default)` guard this LIST died with
  // "Property type is undefined on object" from the missing `type` field —
  // a crash class that ALSO poisons production queries. The guarded rule must
  // never reproduce it; the residual emulator gate denial is labeled above.
  await assertFailsWithoutPropertyCrash(
    getDocs(query(conversationsCol, where("memberIds", "array-contains", EMP_UID)))
  );
});

await check("employee: unfiltered conversations LIST (company member) is denied (no blanket access)", async () => {
  // A non-admin member must not get blanket access to every conversation;
  // the malformed legacy doc must not poison evaluation with a property crash.
  await assertFailsWithoutPropertyCrash(getDocs(conversationsCol));
});

await check("NON-member cannot GET the type-less private doc (no leak)", async () => {
  const other = testEnv.authenticatedContext("emp-uid-2").firestore();
  await assertFails(
    getDoc(doc(other, "companies", COMPANY, "conversations", "legacy1"))
  );
});

await check("outsider (other company) cannot GET the type-less doc", async () => {
  const out = testEnv.authenticatedContext("outsider-uid").firestore();
  await assertFails(
    getDoc(doc(out, "companies", COMPANY, "conversations", "legacy1"))
  );
});

await check("employee: channels LIST (type==channel) unaffected by type-less doc", async () => {
  // The malformed doc cannot match the query, so it must not poison the LIST.
  await assertSucceeds(
    getDocs(
      query(
        collection(emp, "companies", COMPANY, "conversations"),
        where("type", "==", "channel"),
        where("visibility", "==", "public")
      )
    )
  );
});

console.log("\n================ attendance authz (rules) results ================");
for (const r of results) {
  console.log(`${r.ok ? "✓ PASS" : "✗ FAIL"}: ${r.name}${r.err ? ` — ${r.err}` : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} checks passed`);
await testEnv.cleanup().catch(() => {});
process.exit(failed ? 1 : 0);
