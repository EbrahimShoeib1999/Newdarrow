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

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err: err?.message ?? String(err) });
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
await check("employee: conversations LIST where memberIds array-contains (empty)", async () => {
  // Hardened rule: the missing-collection LIST gate (resource == null) must be
  // ALLOWED for a company member (returns empty) instead of erroring.
  await assertSucceeds(
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

await check("employee: conversations LIST with type-less doc (member) succeeds", async () => {
  // The requester IS in memberIds, so the doc is legitimately readable;
  // the LIST must no longer error because of the missing `type` field.
  await assertSucceeds(
    getDocs(query(conversationsCol, where("memberIds", "array-contains", EMP_UID)))
  );
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

// ---- PROBE MATRIX (temporary) ----
const legacyDb = emp;
async function probe(name, p) {
  try { await p(); console.log("OK   " + name); }
  catch (e) { console.log("ERR  " + name + " => " + (e?.message || e)); }
}
await probe("A equality type==public (0 candidates)", () =>
  getDocs(query(conversationsCol, where("type", "==", "public"))));
await probe("B array-contains memberIds (1 candidate)", () =>
  getDocs(query(conversationsCol, where("memberIds", "array-contains", EMP_UID))));
await probe("C equality name==legacy (1 candidate)", () =>
  getDocs(query(conversationsCol, where("name", "==", "Legacy (no type field)"))));
await probe("D unfiltered collection LIST", () => getDocs(conversationsCol));
const adminCtx = testEnv.authenticatedContext("admin-uid-9").firestore();
await probe("E array-contains as non-member same company", () =>
  getDocs(query(collection(adminCtx, "companies", COMPANY, "conversations"), where("memberIds", "array-contains", "emp-uid-2"))));
process.exit(0);
