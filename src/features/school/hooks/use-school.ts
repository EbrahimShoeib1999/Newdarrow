/**
 * School Management — TanStack Query hooks.
 *
 * Company-scoped keys, mutations invalidate on success, and the attendance
 * acting-user id is taken from the auth store (never from a form) so the audit
 * field stays trustworthy — the same contract as the facilities hooks.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AcademicYearService,
  AttendanceService,
  GradeService,
  GuardianService,
  SectionService,
  StudentService,
  SubjectService,
  TermService,
} from "../api/school.service";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
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

const KEY = ["school"] as const;

/** Builds list + create/update/delete hooks for one entity, DRY across the domain. */
function makeEntityHooks<E, C, U>(
  segment: string,
  api: {
    list: (companyId: string) => Promise<{ data: E[] | null }>;
    create: (companyId: string, data: C) => Promise<unknown>;
    update: (companyId: string, id: string, data: U) => Promise<unknown>;
    remove: (companyId: string, id: string) => Promise<unknown>;
  },
) {
  const listKey = [...KEY, `${segment}-list`] as const;
  return {
    useList() {
      const { companyId } = useCompany();
      return useQuery({
        queryKey: [...listKey, companyId],
        queryFn: async () => (await api.list(companyId!)).data ?? [],
        enabled: !!companyId,
      });
    },
    useCreate() {
      const qc = useQueryClient();
      const { companyId } = useCompany();
      return useMutation({
        mutationFn: (data: C) => api.create(companyId!, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY] }),
      });
    },
    useUpdate() {
      const qc = useQueryClient();
      const { companyId } = useCompany();
      return useMutation({
        mutationFn: ({ id, data }: { id: string; data: U }) => api.update(companyId!, id, data),
        onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY] }),
      });
    },
    useRemove() {
      const qc = useQueryClient();
      const { companyId } = useCompany();
      return useMutation({
        mutationFn: (id: string) => api.remove(companyId!, id),
        onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY] }),
      });
    },
  };
}

export const useAcademicYearsEntity = makeEntityHooks<AcademicYear, CreateAcademicYearDTO, UpdateAcademicYearDTO>("academicYears", AcademicYearService);
export const useTermsEntity = makeEntityHooks<Term, CreateTermDTO, UpdateTermDTO>("terms", TermService);
export const useGradesEntity = makeEntityHooks<Grade, CreateGradeDTO, UpdateGradeDTO>("grades", GradeService);
export const useSectionsEntity = makeEntityHooks<Section, CreateSectionDTO, UpdateSectionDTO>("sections", SectionService);
export const useSubjectsEntity = makeEntityHooks<Subject, CreateSubjectDTO, UpdateSubjectDTO>("subjects", SubjectService);
export const useGuardiansEntity = makeEntityHooks<Guardian, CreateGuardianDTO, UpdateGuardianDTO>("guardians", GuardianService);
export const useStudentsEntity = makeEntityHooks<Student, CreateStudentDTO, UpdateStudentDTO>("students", StudentService);

// Convenience named exports (mirrors facilities naming used by pages).
export const useAcademicYears = useAcademicYearsEntity.useList;
export const useTerms = useTermsEntity.useList;
export const useGrades = useGradesEntity.useList;
export const useSections = useSectionsEntity.useList;
export const useSubjects = useSubjectsEntity.useList;
export const useGuardians = useGuardiansEntity.useList;
export const useStudents = useStudentsEntity.useList;

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export function useAttendanceForSection(sectionId: string | null, date: string) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...KEY, "attendance", companyId, sectionId, date],
    queryFn: async () => (await AttendanceService.listBySectionDate(companyId!, sectionId!, date)).data ?? [],
    enabled: !!companyId && !!sectionId,
  });
}

export function useMarkAttendance() {
  const qc = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof AttendanceService.mark>[1], "recordedBy">) =>
      AttendanceService.mark(companyId!, { ...input, recordedBy: userId ?? "" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "attendance"] }),
  });
}

export type { Attendance };
