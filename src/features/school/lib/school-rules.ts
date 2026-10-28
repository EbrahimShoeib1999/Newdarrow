/**
 * School Management — pure domain validation.
 *
 * These rules are enforced by the service at write time (not just the forms),
 * mirroring the facilities `work-order-rules` contract. Each validator returns
 * a list of `{ field, messageKey }`; the messageKey resolves in the `school`
 * i18n namespace so AR/EN stay in one place.
 */

import type {
  AcademicYear,
  Grade,
  Guardian,
  Section,
  Student,
  Subject,
  Term,
} from "../types/school.types";

export interface FieldError {
  field: string;
  messageKey: string;
}

const req = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;
const isDate = (v: unknown): boolean => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** start <= end when both present. */
function dateRange(start: string, end: string, prefix: string): FieldError[] {
  const errs: FieldError[] = [];
  if (!isDate(start)) errs.push({ field: `${prefix}Start`, messageKey: "validation.dateRequired" });
  if (!isDate(end)) errs.push({ field: `${prefix}End`, messageKey: "validation.dateRequired" });
  if (isDate(start) && isDate(end) && start > end) {
    errs.push({ field: `${prefix}End`, messageKey: "validation.dateOrder" });
  }
  return errs;
}

export function validateAcademicYear(draft: Pick<AcademicYear, "name" | "startDate" | "endDate">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  errs.push(...dateRange(draft.startDate, draft.endDate, ""));
  return errs;
}

export function validateTerm(draft: Pick<Term, "name" | "startDate" | "endDate" | "academicYearId">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  if (!req(draft.academicYearId)) errs.push({ field: "academicYearId", messageKey: "validation.yearRequired" });
  errs.push(...dateRange(draft.startDate, draft.endDate, ""));
  return errs;
}

export function validateGrade(draft: Pick<Grade, "name" | "level">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  if (!Number.isFinite(draft.level) || draft.level < 1) {
    errs.push({ field: "level", messageKey: "validation.levelRange" });
  }
  return errs;
}

export function validateSection(draft: Pick<Section, "name" | "gradeId">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  if (!req(draft.gradeId)) errs.push({ field: "gradeId", messageKey: "validation.gradeRequired" });
  return errs;
}

export function validateSubject(draft: Pick<Subject, "name">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  return errs;
}

export function validateGuardian(draft: Pick<Guardian, "name" | "phone">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  if (!req(draft.phone)) {
    errs.push({ field: "phone", messageKey: "validation.phoneRequired" });
  } else if (!/^[+()\d\s-]{6,20}$/.test(draft.phone.trim())) {
    errs.push({ field: "phone", messageKey: "validation.phoneFormat" });
  }
  return errs;
}

/**
 * A student needs a name + guardian; once status is "enrolled" the enrollment
 * target (grade + section) is mandatory. This is the relationship-integrity
 * gate: an enrolled student can never be orphaned from a class.
 */
export function validateStudent(draft: Pick<Student, "name" | "guardianId" | "status" | "gradeId" | "sectionId">): FieldError[] {
  const errs: FieldError[] = [];
  if (!req(draft.name)) errs.push({ field: "name", messageKey: "validation.nameRequired" });
  if (!req(draft.guardianId)) errs.push({ field: "guardianId", messageKey: "validation.guardianRequired" });
  if (draft.status === "enrolled") {
    if (!req(draft.gradeId)) errs.push({ field: "gradeId", messageKey: "validation.gradeRequired" });
    if (!req(draft.sectionId)) errs.push({ field: "sectionId", messageKey: "validation.sectionRequired" });
  }
  return errs;
}

/** Cross-field check used by the service before persisting a section student. */
export function sectionBelongsToGrade(
  section: Pick<Section, "id" | "gradeId"> | undefined,
  gradeId: string,
): boolean {
  return !!section && section.gradeId === gradeId;
}
