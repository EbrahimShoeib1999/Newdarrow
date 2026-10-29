/**
 * School Management — Firestore service.
 *
 * Every collection name comes from the shared activity-domain naming contract
 * (prefix `sch_`), so these writes land exactly in the collections the Firestore
 * rules gate by the tenant's authoritative SCHOOL_MANAGEMENT activity — and
 * that already enforce the sensitive-domain least-privilege (admin/manager/
 * `domain.manage`). The service re-checks the pure domain rules at write time
 * and validates cross-entity references so the UI is never the only gate.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { domainCollection } from "@/features/activities/types/activity-domain";
import {
  validateAcademicYear,
  validateTerm,
  validateGrade,
  validateSection,
  validateSubject,
  validateGuardian,
  validateStudent,
} from "../lib/school-rules";
import type {
  AcademicYear,
  Attendance,
  CreateAcademicYearDTO,
  CreateGradeDTO,
  CreateGuardianDTO,
  CreateSectionDTO,
  CreateStudentDTO,
  CreateSubjectDTO,
  CreateTermDTO,
  Grade,
  Guardian,
  MarkAttendanceInput,
  Section,
  Student,
  Subject,
  Term,
  UpdateAcademicYearDTO,
  UpdateGradeDTO,
  UpdateGuardianDTO,
  UpdateSectionDTO,
  UpdateStudentDTO,
  UpdateSubjectDTO,
  UpdateTermDTO,
} from "../types/school.types";

const SERVICE_NAME = "SchoolService";

function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

/** Contract-derived, rules-gated collection names. Never hand-typed. */
export const SCH_COLLECTIONS = {
  academicYears: domainCollection("SCHOOL_MANAGEMENT", "academic_years"),
  terms: domainCollection("SCHOOL_MANAGEMENT", "terms"),
  grades: domainCollection("SCHOOL_MANAGEMENT", "grades"),
  sections: domainCollection("SCHOOL_MANAGEMENT", "sections"),
  subjects: domainCollection("SCHOOL_MANAGEMENT", "subjects"),
  guardians: domainCollection("SCHOOL_MANAGEMENT", "guardians"),
  students: domainCollection("SCHOOL_MANAGEMENT", "students"),
  attendance: domainCollection("SCHOOL_MANAGEMENT", "attendance"),
} as const;

/** Firestore rejects `undefined` — strip before every write (repo convention). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

const conv = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

function normalize<T extends { id: string }>(id: string, data: Record<string, unknown> | undefined): T {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ...d,
    id,
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
  } as unknown as T;
}

function assertValid(errs: { field: string; messageKey: string }[]) {
  if (errs.length) throw new Error(`Validation failed: ${errs.map((e) => e.messageKey).join(", ")}`);
}

/** A generic tenant-scoped CRUD factory over one `sch_*` collection. */
function crud<T extends { id: string }, C, U>(name: string, validateCreate: (d: C) => void, validateUpdate: (d: U) => void) {
  return {
    async list(companyId: string): Promise<ApiResponse<T[]>> {
      const ref = collection(db, "companies", companyId, name);
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(500)));
      return { data: snap.docs.map((d) => normalize<T>(d.id, d.data())), message: "Success" };
    },
    async get(companyId: string, id: string): Promise<ApiResponse<T | null>> {
      const snap = await getDoc(doc(db, "companies", companyId, name, id));
      return snap.exists()
        ? { data: normalize<T>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    },
    async create(companyId: string, data: C): Promise<ApiResponse<T>> {
      validateCreate(data);
      const ref = await addDoc(
        collection(db, "companies", companyId, name),
        stripUndefined({ ...(data as Record<string, unknown>), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      );
      const snap = await getDoc(ref);
      return { data: normalize<T>(snap.id, snap.data()), message: "Created" };
    },
    async update(companyId: string, id: string, data: U): Promise<ApiResponse<T>> {
      validateUpdate(data);
      await updateDoc(doc(db, "companies", companyId, name, id), stripUndefined({ ...(data as Record<string, unknown>), updatedAt: serverTimestamp() }));
      const snap = await getDoc(doc(db, "companies", companyId, name, id));
      return { data: normalize<T>(snap.id, snap.data()), message: "Updated" };
    },
    async remove(companyId: string, id: string) {
      await deleteDoc(doc(db, "companies", companyId, name, id));
      return { data: null, message: "Deleted" };
    },
  };
}

const noop = () => {};

export const AcademicYearService = crud<AcademicYear, CreateAcademicYearDTO, UpdateAcademicYearDTO>(
  SCH_COLLECTIONS.academicYears,
  (d) => assertValid(validateAcademicYear(d)),
  (d) => { if (d.name !== undefined || d.startDate !== undefined) assertValid(validateAcademicYear({ name: d.name ?? "", startDate: d.startDate ?? "", endDate: d.endDate ?? "" })); },
);

export const TermService = crud<Term, CreateTermDTO, UpdateTermDTO>(
  SCH_COLLECTIONS.terms,
  (d) => assertValid(validateTerm(d)),
  noop,
);

export const GradeService = crud<Grade, CreateGradeDTO, UpdateGradeDTO>(
  SCH_COLLECTIONS.grades,
  (d) => assertValid(validateGrade(d)),
  noop,
);

export const SectionService = crud<Section, CreateSectionDTO, UpdateSectionDTO>(
  SCH_COLLECTIONS.sections,
  (d) => assertValid(validateSection(d)),
  noop,
);

export const SubjectService = crud<Subject, CreateSubjectDTO, UpdateSubjectDTO>(
  SCH_COLLECTIONS.subjects,
  (d) => assertValid(validateSubject(d)),
  noop,
);

export const GuardianService = crud<Guardian, CreateGuardianDTO, UpdateGuardianDTO>(
  SCH_COLLECTIONS.guardians,
  (d) => assertValid(validateGuardian(d)),
  noop,
);

/* -------------------------------------------------------------------------- */
/* Students — validated CRUD with reference integrity                         */
/* -------------------------------------------------------------------------- */

async function assertSectionInGrade(companyId: string, sectionId: string, gradeId: string) {
  const snap = await getDoc(doc(db, "companies", companyId, SCH_COLLECTIONS.sections, sectionId));
  if (!snap.exists()) throw new Error("Validation failed: section not found");
  const section = snap.data() as Record<string, unknown>;
  if (section.gradeId !== gradeId) throw new Error("Validation failed: section does not belong to grade");
}

export const StudentService = {
  list: crud<Student, CreateStudentDTO, UpdateStudentDTO>(
    SCH_COLLECTIONS.students,
    (d) => assertValid(validateStudent(d)),
    noop,
  ).list,
  get: crud<Student, CreateStudentDTO, UpdateStudentDTO>(SCH_COLLECTIONS.students, noop, noop).get,
  remove: crud<Student, CreateStudentDTO, UpdateStudentDTO>(SCH_COLLECTIONS.students, noop, noop).remove,
  async create(companyId: string, data: CreateStudentDTO): Promise<ApiResponse<Student>> {
    return logged("createStudent", async () => {
      assertValid(validateStudent(data));
      if (data.status === "enrolled" && data.sectionId && data.gradeId) {
        await assertSectionInGrade(companyId, data.sectionId, data.gradeId);
      }
      const ref = await addDoc(
        collection(db, "companies", companyId, SCH_COLLECTIONS.students),
        stripUndefined({ ...(data as Record<string, unknown>), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      );
      const snap = await getDoc(ref);
      return { data: normalize<Student>(snap.id, snap.data()), message: "Student created" };
    });
  },
  async update(companyId: string, id: string, data: UpdateStudentDTO): Promise<ApiResponse<Student>> {
    return logged("updateStudent", async () => {
      if (data.status === "enrolled" && data.sectionId && data.gradeId) {
        await assertSectionInGrade(companyId, data.sectionId, data.gradeId);
      }
      await updateDoc(doc(db, "companies", companyId, SCH_COLLECTIONS.students, id), stripUndefined({ ...(data as Record<string, unknown>), updatedAt: serverTimestamp() }));
      const snap = await getDoc(doc(db, "companies", companyId, SCH_COLLECTIONS.students, id));
      return { data: normalize<Student>(snap.id, snap.data()), message: "Student updated" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Attendance — one row per (student, date); upsert prevents duplicates        */
/* -------------------------------------------------------------------------- */

export const AttendanceService = {
  async listBySectionDate(companyId: string, sectionId: string, date: string): Promise<ApiResponse<Attendance[]>> {
    const ref = collection(db, "companies", companyId, SCH_COLLECTIONS.attendance);
    const snap = await getDocs(query(ref, where("sectionId", "==", sectionId), where("date", "==", date)));
    return { data: snap.docs.map((d) => normalize<Attendance>(d.id, d.data())), message: "Success" };
  },
  /**
   * Records (or corrects) one student's mark for a date. Idempotent on the
   * (studentId, date) pair: an existing row is updated rather than duplicated,
   * so double-submits and re-marks are safe and auditable via `recordedBy`.
   */
  async mark(companyId: string, input: MarkAttendanceInput): Promise<ApiResponse<Attendance>> {
    return logged("markAttendance", async () => {
      const ref = collection(db, "companies", companyId, SCH_COLLECTIONS.attendance);
      const existing = await getDocs(query(ref, where("studentId", "==", input.studentId), where("date", "==", input.date), limit(1)));
      if (!existing.empty) {
        const id = existing.docs[0].id;
        await updateDoc(doc(db, "companies", companyId, SCH_COLLECTIONS.attendance, id), stripUndefined({ mark: input.mark, note: input.note ?? null, updatedAt: serverTimestamp() }));
        const snap = await getDoc(doc(db, "companies", companyId, SCH_COLLECTIONS.attendance, id));
        return { data: normalize<Attendance>(snap.id, snap.data()), message: "Attendance updated" };
      }
      const created = await addDoc(
        ref,
        stripUndefined({ date: input.date, sectionId: input.sectionId, studentId: input.studentId, mark: input.mark, note: input.note ?? null, recordedBy: input.recordedBy, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      );
      const snap = await getDoc(created);
      return { data: normalize<Attendance>(snap.id, snap.data()), message: "Attendance recorded" };
    });
  },
};
