/**
 * D-Arrow Business — School Management (SCHOOL_MANAGEMENT) domain unit suite
 *
 * Pure deterministic tests over the domain validators in school-rules.ts
 * (no Firebase, no DOM): required-field enforcement, date-range ordering,
 * grade-level bounds, guardian phone format, enrolled-student relationship
 * integrity, and section→grade cross-check.
 *
 * Run: npx tsx scripts/test-school-unit.ts
 */

import {
  validateAcademicYear,
  validateTerm,
  validateGrade,
  validateSection,
  validateSubject,
  validateGuardian,
  validateStudent,
  sectionBelongsToGrade,
} from "../src/features/school/lib/school-rules";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void) {
  try {
    fn();
    passedCount++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failedCount++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* validateAcademicYear                                                       */
/* -------------------------------------------------------------------------- */
console.log("\n1. validateAcademicYear:");

await test("rejects empty name", () => {
  const errs = validateAcademicYear({ name: "", startDate: "2025-09-01", endDate: "2026-06-30" });
  assert(errs.some((e) => e.field === "name" && e.messageKey === "validation.nameRequired"), "name required");
});

await test("rejects non-ISO start date", () => {
  const errs = validateAcademicYear({ name: "2025/26", startDate: "01/09/2025", endDate: "2026-06-30" });
  assert(errs.some((e) => e.field === "Start"), "start date format invalid");
});

await test("rejects end < start", () => {
  const errs = validateAcademicYear({ name: "2025/26", startDate: "2026-06-30", endDate: "2025-09-01" });
  assert(errs.some((e) => e.field === "End" && e.messageKey === "validation.dateOrder"), "date order violated");
});

await test("accepts valid draft", () => {
  const errs = validateAcademicYear({ name: "2025/26", startDate: "2025-09-01", endDate: "2026-06-30" });
  assert(errs.length === 0, `expected no errors, got: ${JSON.stringify(errs)}`);
});

/* -------------------------------------------------------------------------- */
/* validateTerm                                                               */
/* -------------------------------------------------------------------------- */
console.log("\n2. validateTerm:");

await test("requires academicYearId", () => {
  const errs = validateTerm({ name: "Fall", startDate: "2025-09-01", endDate: "2025-12-31", academicYearId: "" });
  assert(errs.some((e) => e.field === "academicYearId" && e.messageKey === "validation.yearRequired"), "year required");
});

await test("rejects end < start", () => {
  const errs = validateTerm({ name: "Fall", startDate: "2025-12-31", endDate: "2025-09-01", academicYearId: "y1" });
  assert(errs.some((e) => e.field === "End" && e.messageKey === "validation.dateOrder"), "date order");
});

await test("accepts valid draft", () => {
  const errs = validateTerm({ name: "Fall", startDate: "2025-09-01", endDate: "2025-12-31", academicYearId: "y1" });
  assert(errs.length === 0, "no errors expected");
});

/* -------------------------------------------------------------------------- */
/* validateGrade                                                              */
/* -------------------------------------------------------------------------- */
console.log("\n3. validateGrade:");

await test("rejects level < 1", () => {
  const errs = validateGrade({ name: "Grade 0", level: 0 });
  assert(errs.some((e) => e.field === "level" && e.messageKey === "validation.levelRange"), "level must be >= 1");
});

await test("rejects NaN level", () => {
  const errs = validateGrade({ name: "Grade X", level: NaN });
  assert(errs.some((e) => e.field === "level"), "level must be finite");
});

await test("accepts level >= 1", () => {
  const errs = validateGrade({ name: "Grade 1", level: 1 });
  assert(errs.length === 0, "no errors expected");
});

/* -------------------------------------------------------------------------- */
/* validateSection                                                            */
/* -------------------------------------------------------------------------- */
console.log("\n4. validateSection:");

await test("requires gradeId", () => {
  const errs = validateSection({ name: "Section A", gradeId: "" });
  assert(errs.some((e) => e.field === "gradeId" && e.messageKey === "validation.gradeRequired"), "grade required");
});

await test("accepts valid draft", () => {
  const errs = validateSection({ name: "Section A", gradeId: "g1" });
  assert(errs.length === 0, "no errors expected");
});

/* -------------------------------------------------------------------------- */
/* validateSubject                                                            */
/* -------------------------------------------------------------------------- */
console.log("\n5. validateSubject:");

await test("rejects blank name", () => {
  const errs = validateSubject({ name: "   " });
  assert(errs.some((e) => e.field === "name"), "name required");
});

await test("accepts non-blank name", () => {
  const errs = validateSubject({ name: "Mathematics" });
  assert(errs.length === 0, "no errors expected");
});

/* -------------------------------------------------------------------------- */
/* validateGuardian                                                           */
/* -------------------------------------------------------------------------- */
console.log("\n6. validateGuardian:");

await test("rejects empty phone", () => {
  const errs = validateGuardian({ name: "Ahmed", phone: "" });
  assert(errs.some((e) => e.field === "phone" && e.messageKey === "validation.phoneRequired"), "phone required");
});

await test("rejects phone with invalid chars", () => {
  const errs = validateGuardian({ name: "Ahmed", phone: "abc-def-ghi" });
  assert(errs.some((e) => e.field === "phone" && e.messageKey === "validation.phoneFormat"), "phone format");
});

await test("accepts valid phone formats", () => {
  assert(validateGuardian({ name: "Ahmed", phone: "+966 55 123 4567" }).length === 0, "international format");
  assert(validateGuardian({ name: "Ahmed", phone: "0551234567" }).length === 0, "local 10-digit");
  assert(validateGuardian({ name: "Ahmed", phone: "(055) 123-4567" }).length === 0, "paren format");
});

/* -------------------------------------------------------------------------- */
/* validateStudent                                                            */
/* -------------------------------------------------------------------------- */
console.log("\n7. validateStudent:");

await test("requires guardianId even for pending", () => {
  const errs = validateStudent({ name: "Ali", guardianId: "", status: "pending", gradeId: null, sectionId: null });
  assert(errs.some((e) => e.field === "guardianId" && e.messageKey === "validation.guardianRequired"), "guardian required");
});

await test("pending without grade/section is valid", () => {
  const errs = validateStudent({ name: "Ali", guardianId: "gu1", status: "pending", gradeId: null, sectionId: null });
  assert(errs.length === 0, "no errors expected");
});

await test("enrolled without gradeId is rejected", () => {
  const errs = validateStudent({ name: "Ali", guardianId: "gu1", status: "enrolled", gradeId: null, sectionId: "s1" });
  assert(errs.some((e) => e.field === "gradeId" && e.messageKey === "validation.gradeRequired"), "grade required when enrolled");
});

await test("enrolled without sectionId is rejected", () => {
  const errs = validateStudent({ name: "Ali", guardianId: "gu1", status: "enrolled", gradeId: "g1", sectionId: null });
  assert(errs.some((e) => e.field === "sectionId" && e.messageKey === "validation.sectionRequired"), "section required when enrolled");
});

await test("enrolled with both grade and section is valid", () => {
  const errs = validateStudent({ name: "Ali", guardianId: "gu1", status: "enrolled", gradeId: "g1", sectionId: "s1" });
  assert(errs.length === 0, "no errors expected");
});

/* -------------------------------------------------------------------------- */
/* sectionBelongsToGrade                                                      */
/* -------------------------------------------------------------------------- */
console.log("\n8. sectionBelongsToGrade:");

await test("returns false for undefined section", () => {
  assert(!sectionBelongsToGrade(undefined, "g1"), "undefined → false");
});

await test("returns false for mismatched gradeId", () => {
  assert(!sectionBelongsToGrade({ id: "s1", gradeId: "g2" }, "g1"), "mismatch → false");
});

await test("returns true for matching gradeId", () => {
  assert(sectionBelongsToGrade({ id: "s1", gradeId: "g1" }, "g1"), "match → true");
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
console.log(`\nSchool unit suite: ${passedCount} passed, ${failedCount} failed\n`);
if (failedCount > 0) process.exit(1);
