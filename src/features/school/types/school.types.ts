/**
 * School Management (SCHOOL_MANAGEMENT activity) — domain types.
 *
 * Records persist in activity-owned collections (sch_academic_years,
 * sch_terms, sch_grades, sch_sections, sch_subjects, sch_guardians,
 * sch_students, sch_attendance) whose names come from the shared naming
 * contract (@/features/activities/types/activity-domain). Firestore rules gate
 * every `sch_*` prefix by the tenant's authoritative activity AND treat it as
 * a sensitive (least-privilege) domain — admin/manager/`domain.manage` only —
 * so a tenant on another activity, or an under-privileged user, can neither
 * read nor write these collections. No rules change is required to add them.
 *
 * Every status value is a stable machine id; Arabic/English labels live only in
 * the `school` i18n namespace and never double as identifiers.
 */

/* -------------------------------------------------------------------------- */
/* Academic years & terms                                                     */
/* -------------------------------------------------------------------------- */

export type AcademicYearStatus = "planned" | "active" | "closed";

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string;
  status: AcademicYearStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateAcademicYearDTO = Omit<AcademicYear, "id" | "createdAt" | "updatedAt">;
export type UpdateAcademicYearDTO = Partial<Omit<AcademicYear, "id" | "createdAt" | "updatedAt">>;

export interface Term {
  id: string;
  academicYearId: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateTermDTO = Omit<Term, "id" | "createdAt" | "updatedAt">;
export type UpdateTermDTO = Partial<Omit<Term, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Grades (class levels) & sections                                           */
/* -------------------------------------------------------------------------- */

export interface Grade {
  id: string;
  /** Display label, e.g. "Grade 1" / "الصف الأول". */
  name: string;
  /** Short stable code, e.g. "G1". */
  code?: string | null;
  /** Ordering (lower = earlier grade). */
  level: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateGradeDTO = Omit<Grade, "id" | "createdAt" | "updatedAt">;
export type UpdateGradeDTO = Partial<Omit<Grade, "id" | "createdAt" | "updatedAt">>;

export interface Section {
  id: string;
  gradeId: string;
  name: string;
  /** Optional homeroom teacher: users/{uid} (HR staff). */
  teacherId?: string | null;
  capacity?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateSectionDTO = Omit<Section, "id" | "createdAt" | "updatedAt">;
export type UpdateSectionDTO = Partial<Omit<Section, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Subjects                                                                   */
/* -------------------------------------------------------------------------- */

export interface Subject {
  id: string;
  name: string;
  code?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateSubjectDTO = Omit<Subject, "id" | "createdAt" | "updatedAt">;
export type UpdateSubjectDTO = Partial<Omit<Subject, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Guardians & students                                                       */
/* -------------------------------------------------------------------------- */

export interface Guardian {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  /** Relationship to the student, e.g. "father" / "mother". */
  relationship: GuardianRelationship;
  /** Optional link to a shared CRM contact (explicit id, never a display name). */
  contactId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GuardianRelationship = "father" | "mother" | "guardian" | "other";

export type CreateGuardianDTO = Omit<Guardian, "id" | "createdAt" | "updatedAt">;
export type UpdateGuardianDTO = Partial<Omit<Guardian, "id" | "createdAt" | "updatedAt">>;

export type StudentStatus = "pending" | "enrolled" | "withdrawn";

export interface Student {
  id: string;
  name: string;
  /** Student number / identifier, unique per tenant by convention. */
  identifier?: string | null;
  guardianId: string;
  /** Enrollment target — both required once status is "enrolled". */
  gradeId?: string | null;
  sectionId?: string | null;
  status: StudentStatus;
  enrollmentDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateStudentDTO = Omit<Student, "id" | "createdAt" | "updatedAt">;
export type UpdateStudentDTO = Partial<Omit<Student, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Attendance                                                                 */
/* -------------------------------------------------------------------------- */

export type AttendanceMark = "present" | "absent" | "late" | "excused";

export interface Attendance {
  id: string;
  /** Taken from the section's grade so a report can group without a join. */
  date: string; // ISO yyyy-mm-dd
  sectionId: string;
  studentId: string;
  mark: AttendanceMark;
  note?: string | null;
  /** users/{uid} of the operator who recorded it (from the auth store). */
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateAttendanceDTO = Omit<Attendance, "id" | "createdAt" | "updatedAt">;

/** A (student, date) pair is unique — the service rejects a second row. */
export interface MarkAttendanceInput {
  date: string;
  sectionId: string;
  studentId: string;
  mark: AttendanceMark;
  note?: string | null;
  recordedBy: string;
}
