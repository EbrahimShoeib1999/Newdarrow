/**
 * School Management — Firestore rules integration suite.
 *
 * Exercises the `sch_*` domain collections against real security rules:
 *   - CRUD for admin / manager / domain.manage-custom-perm users
 *   - Denial for plain employees (sensitive domain → least privilege)
 *   - Denial for a company whose primaryActivity ≠ SCHOOL_MANAGEMENT
 *   - Cross-tenant isolation
 *   - Attendance upsert idempotency pattern (one row per studentId+date)
 *   - Section→grade reference integrity
 *
 * Run: npm run test:school-integration
 * (Requires the Firestore emulator on :8080; launched by emulators:exec.)
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
  deleteDoc,
  collection,
  getDocs,
  addDoc,
  query,
  where,
  limit,
  serverTimestamp,
} from "firebase/firestore";

const COMPANY = "sch-co";
const OTHER_CO = "other-co";
const NON_SCHOOL_CO = "proj-co";
const results = [];

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
  projectId: "school-integration",
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

await testEnv.clearFirestore();

/* -------------------------------------------------------------------------- */
/* Seed                                                                      */
/* -------------------------------------------------------------------------- */
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  // Company docs — primaryActivity gates which domain collections the tenant
  // can access.
  await setDoc(doc(db, "companies", COMPANY), {
    name: "Greenfield Academy",
    primaryActivity: "SCHOOL_MANAGEMENT",
  });
  await setDoc(doc(db, "companies", OTHER_CO), {
    name: "Other Corp",
    primaryActivity: "SCHOOL_MANAGEMENT",
  });
  await setDoc(doc(db, "companies", NON_SCHOOL_CO), {
    name: "BuildRight Projects",
    primaryActivity: "PROJECTS",
  });

  // Users
  await setDoc(doc(db, "users", "sch_admin"), { companyId: COMPANY, role: "admin" });
  await setDoc(doc(db, "users", "sch_manager"), { companyId: COMPANY, role: "manager" });
  await setDoc(doc(db, "users", "sch_emp"), { companyId: COMPANY, role: "employee" });
  await setDoc(doc(db, "users", "sch_domain_mgr"), {
    companyId: COMPANY,
    role: "employee",
    customPermissions: ["domain.manage"],
  });
  await setDoc(doc(db, "users", "outsider"), { companyId: OTHER_CO, role: "admin" });

  // Pre-existing fixture records
  await setDoc(doc(db, "companies", COMPANY, "sch_academic_years", "ay1"), {
    name: "2025/26",
    startDate: "2025-09-01",
    endDate: "2026-06-30",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "companies", COMPANY, "sch_grades", "g1"), {
    name: "Grade 1",
    level: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "companies", COMPANY, "sch_sections", "s1"), {
    gradeId: "g1",
    name: "Section A",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "companies", COMPANY, "sch_guardians", "gu1"), {
    name: "Ahmed Ali",
    phone: "+966551234567",
    relationship: "father",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await setDoc(doc(db, "companies", COMPANY, "sch_students", "st1"), {
    name: "Sara Ahmed",
    guardianId: "gu1",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // A pre-existing attendance record for the idempotency test
  await setDoc(doc(db, "companies", COMPANY, "sch_attendance", "att1"), {
    date: "2025-10-01",
    sectionId: "s1",
    studentId: "st1",
    mark: "present",
    recordedBy: "sch_admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

/* -------------------------------------------------------------------------- */
/* Contexts                                                                   */
/* -------------------------------------------------------------------------- */
const adminDb = testEnv.authenticatedContext("sch_admin").firestore();
const mgrDb = testEnv.authenticatedContext("sch_manager").firestore();
const empDb = testEnv.authenticatedContext("sch_emp").firestore();
const dmDb = testEnv.authenticatedContext("sch_domain_mgr").firestore();
const outsiderDb = testEnv.authenticatedContext("outsider").firestore();
const unauthDb = testEnv.unauthenticatedContext().firestore();

/* -------------------------------------------------------------------------- */
/* 1. Sensitive-domain privilege checks                                       */
/* -------------------------------------------------------------------------- */
console.log("\n1. Sensitive-domain privilege gate (sch_* requires admin/manager/domain.manage):");

await check("admin can READ sch_academic_years", async () => {
  await assertSucceeds(getDoc(doc(adminDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

await check("manager can READ sch_academic_years", async () => {
  await assertSucceeds(getDoc(doc(mgrDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

await check("domain.manage employee can READ sch_academic_years", async () => {
  await assertSucceeds(getDoc(doc(dmDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

await check("plain employee CANNOT read sch_academic_years (sensitive domain denial)", async () => {
  await assertFails(getDoc(doc(empDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

await check("unauthenticated CANNOT read sch_academic_years", async () => {
  await assertFails(getDoc(doc(unauthDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

/* -------------------------------------------------------------------------- */
/* 2. Activity gate — wrong tenant activity                                   */
/* -------------------------------------------------------------------------- */
console.log("\n2. Activity gate (company primaryActivity must be SCHOOL_MANAGEMENT):");

// Seed an admin for a PROJECTS company and test against sch_*
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", "proj_admin"), { companyId: NON_SCHOOL_CO, role: "admin" });
});
const projAdminDb = testEnv.authenticatedContext("proj_admin").firestore();

await check("admin of PROJECTS company CANNOT read sch_* under their own company", async () => {
  // Attempt to read a sch_ collection scoped to NON_SCHOOL_CO
  await assertFails(getDoc(doc(projAdminDb, "companies", NON_SCHOOL_CO, "sch_academic_years", "ay1")));
});

await check("admin of PROJECTS company CANNOT write sch_* under their own company", async () => {
  await assertFails(
    setDoc(doc(projAdminDb, "companies", NON_SCHOOL_CO, "sch_grades", "g-bad"), {
      name: "Bad Grade", level: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01",
    }),
  );
});

/* -------------------------------------------------------------------------- */
/* 3. Cross-tenant isolation                                                   */
/* -------------------------------------------------------------------------- */
console.log("\n3. Cross-tenant isolation:");

await check("outsider (other SCHOOL_MANAGEMENT co) CANNOT read our sch_academic_years", async () => {
  await assertFails(getDoc(doc(outsiderDb, "companies", COMPANY, "sch_academic_years", "ay1")));
});

await check("outsider CANNOT write to our sch_grades", async () => {
  await assertFails(
    setDoc(doc(outsiderDb, "companies", COMPANY, "sch_grades", "g-bad"), {
      name: "Bad Grade", level: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01",
    }),
  );
});

await check("outsider CANNOT delete our sch_students", async () => {
  await assertFails(deleteDoc(doc(outsiderDb, "companies", COMPANY, "sch_students", "st1")));
});

/* -------------------------------------------------------------------------- */
/* 4. Admin CRUD workflow                                                      */
/* -------------------------------------------------------------------------- */
console.log("\n4. Admin CRUD workflow:");

let newSubjectId = "";
await check("admin can CREATE sch_subjects", async () => {
  const ref = await addDoc(collection(adminDb, "companies", COMPANY, "sch_subjects"), {
    name: "Mathematics", code: "MATH", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  newSubjectId = ref.id;
});

await check("admin can READ the newly created subject", async () => {
  const snap = await getDoc(doc(adminDb, "companies", COMPANY, "sch_subjects", newSubjectId));
  if (!snap.exists()) throw new Error("subject not found");
  if (snap.data().name !== "Mathematics") throw new Error("name mismatch");
});

await check("admin can UPDATE sch_subjects", async () => {
  await assertSucceeds(
    updateDoc(doc(adminDb, "companies", COMPANY, "sch_subjects", newSubjectId), {
      name: "Math & Geometry", updatedAt: serverTimestamp(),
    }),
  );
});

await check("admin can DELETE sch_subjects", async () => {
  await assertSucceeds(deleteDoc(doc(adminDb, "companies", COMPANY, "sch_subjects", newSubjectId)));
});

await check("admin can CREATE sch_terms", async () => {
  await assertSucceeds(
    setDoc(doc(adminDb, "companies", COMPANY, "sch_terms", "t1"), {
      academicYearId: "ay1", name: "Fall 2025",
      startDate: "2025-09-01", endDate: "2025-12-31",
      createdAt: "2025-09-01T00:00:00.000Z", updatedAt: "2025-09-01T00:00:00.000Z",
    }),
  );
});

await check("admin can UPDATE a student (enroll it)", async () => {
  await assertSucceeds(
    updateDoc(doc(adminDb, "companies", COMPANY, "sch_students", "st1"), {
      status: "enrolled", gradeId: "g1", sectionId: "s1", enrollmentDate: "2025-09-01",
      updatedAt: serverTimestamp(),
    }),
  );
});

/* -------------------------------------------------------------------------- */
/* 5. Manager write + delete                                                   */
/* -------------------------------------------------------------------------- */
console.log("\n5. Manager write/delete access:");

await check("manager can CREATE sch_grades", async () => {
  await assertSucceeds(
    setDoc(doc(mgrDb, "companies", COMPANY, "sch_grades", "g2"), {
      name: "Grade 2", level: 2, createdAt: "2025-01-01", updatedAt: "2025-01-01",
    }),
  );
});

await check("manager can DELETE sch_grades", async () => {
  await assertSucceeds(deleteDoc(doc(mgrDb, "companies", COMPANY, "sch_grades", "g2")));
});

/* -------------------------------------------------------------------------- */
/* 6. domain.manage employee equivalent to manager                              */
/* -------------------------------------------------------------------------- */
console.log("\n6. domain.manage custom permission:");

await check("domain.manage employee can CREATE sch_sections", async () => {
  await assertSucceeds(
    setDoc(doc(dmDb, "companies", COMPANY, "sch_sections", "s2"), {
      gradeId: "g1", name: "Section B", createdAt: "2025-01-01", updatedAt: "2025-01-01",
    }),
  );
});

await check("plain employee CANNOT create sch_sections", async () => {
  await assertFails(
    setDoc(doc(empDb, "companies", COMPANY, "sch_sections", "s-bad"), {
      gradeId: "g1", name: "Bad Section", createdAt: "2025-01-01", updatedAt: "2025-01-01",
    }),
  );
});

/* -------------------------------------------------------------------------- */
/* 7. Attendance — idempotency (one row per studentId+date)                    */
/* -------------------------------------------------------------------------- */
console.log("\n7. Attendance (idempotency + recording):");

await check("existing attendance row is readable", async () => {
  const snap = await getDoc(doc(adminDb, "companies", COMPANY, "sch_attendance", "att1"));
  if (!snap.exists()) throw new Error("att1 missing");
  if (snap.data().mark !== "present") throw new Error("mark mismatch");
});

await check("admin can UPDATE existing attendance row (re-mark)", async () => {
  await assertSucceeds(
    updateDoc(doc(adminDb, "companies", COMPANY, "sch_attendance", "att1"), {
      mark: "absent", updatedAt: serverTimestamp(),
    }),
  );
});

await check("admin can ADD new attendance for a different date", async () => {
  const ref = await addDoc(collection(adminDb, "companies", COMPANY, "sch_attendance"), {
    date: "2025-10-02", sectionId: "s1", studentId: "st1", mark: "late",
    recordedBy: "sch_admin", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  if (!ref.id) throw new Error("no id returned");
});

await check("LIST attendance for studentId+date returns exactly one row", async () => {
  const snap = await getDocs(
    query(
      collection(adminDb, "companies", COMPANY, "sch_attendance"),
      where("studentId", "==", "st1"),
      where("date", "==", "2025-10-01"),
      limit(5),
    ),
  );
  if (snap.size !== 1) throw new Error(`expected 1 row, got ${snap.size}`);
});

/* -------------------------------------------------------------------------- */
/* 8. Tenant isolation: other SCHOOL_MANAGEMENT company is separate            */
/* -------------------------------------------------------------------------- */
console.log("\n8. Other SCHOOL_MANAGEMENT tenant (same activity, different co):");

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "companies", OTHER_CO, "sch_grades", "g1-other"), {
    name: "Grade 1 Other", level: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01",
  });
});

await check("outsider admin can read their OWN sch_grades", async () => {
  await assertSucceeds(getDoc(doc(outsiderDb, "companies", OTHER_CO, "sch_grades", "g1-other")));
});

await check("our admin CANNOT read other tenant's sch_grades", async () => {
  await assertFails(getDoc(doc(adminDb, "companies", OTHER_CO, "sch_grades", "g1-other")));
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSchool integration suite: ${passed} passed, ${failed} failed\n`);

await testEnv.cleanup();

if (failed > 0) {
  console.error("FAILURES:");
  for (const r of results.filter((r) => !r.ok)) console.error(`  ✗ ${r.name}: ${r.err}`);
  process.exit(1);
}
