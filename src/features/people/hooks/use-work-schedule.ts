/**
 * React Query layer over WorkScheduleService — schedules, assignments,
 * lateness policies, deduction cases and the monthly report.
 *
 * The service never throws on a domain failure: it returns
 * `{ data: null, message }` (see api.types ApiResponse). Every hook below
 * converts that into a rejection so loading/error states and toasts work
 * exactly like the rest of the app — no silent null-data in the UI.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/constants";
import { useCompany } from "@/features/companies/context/company-context";
import { toast } from "sonner";
import i18n from "@/lib/i18n";
import { WorkScheduleService } from "../api/work-schedule.service";
import type {
  CreateLatenessPolicyDTO,
  CreateScheduleTemplateDTO,
  DeductionCase,
  LatenessPolicy,
  ScheduleValues,
} from "../types/work-schedule.types";
import type { ApiResponse } from "@/types/api.types";

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: "people", ...(options ?? {}) });

/**
 * Service failures come back as i18n keys ("policy.validation…") or as plain
 * English with a detail suffix ("schedules.assignmentConflict: overlaps …").
 * Translate a key when it exists (also the prefix before ":"), otherwise show
 * the raw text — never a silent generic error.
 */
const tMsg = (raw: string) => {
  if (i18n.exists(raw, { ns: "people" })) return t(raw);
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const prefix = raw.slice(0, colon);
    if (i18n.exists(prefix, { ns: "people" })) return `${t(prefix)}: ${raw.slice(colon + 1).trim()}`;
  }
  return raw;
};

/** Unwrap ApiResponse or throw the service message (drives toast + error UI). */
async function unwrap<T>(res: Promise<ApiResponse<T>>): Promise<T> {
  const r = await res;
  if (r.data === null || r.data === undefined) {
    throw new Error(r.message && r.message !== "Success" ? tMsg(r.message) : t("unexpected_failure"));
  }
  return r.data;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export function useScheduleTemplatesQuery() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.people.scheduleTemplates(companyId!),
    queryFn: () => unwrap(WorkScheduleService.listTemplates(companyId!)),
    enabled: !!companyId,
  });
}

export function useEnsureDefaultTemplatesMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(WorkScheduleService.ensureDefaultTemplates(companyId!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleTemplates(companyId!) });
      toast.success(t("schedules.toast.defaults_seeded"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateTemplateMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateScheduleTemplateDTO) =>
      unwrap(WorkScheduleService.createTemplate(companyId!, dto)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleTemplates(companyId!) });
      toast.success(t("schedules.toast.template_saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTemplateMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      templateId,
      patch,
      reason,
    }: {
      templateId: string;
      patch: Partial<ScheduleValues> & { name?: string; description?: string | null; isActive?: boolean };
      reason: string;
    }) => unwrap(WorkScheduleService.updateTemplate(companyId!, templateId, patch, reason)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleTemplates(companyId!) });
      toast.success(t("schedules.toast.template_updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetTemplateActiveMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, isActive, reason }: { templateId: string; isActive: boolean; reason: string }) =>
      unwrap(WorkScheduleService.setTemplateActive(companyId!, templateId, isActive, reason)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleTemplates(companyId!) });
      toast.success(t("common.toast_saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

export function useScheduleAssignmentsQuery() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.people.scheduleAssignments(companyId!),
    queryFn: () => unwrap(WorkScheduleService.listAssignments(companyId!)),
    enabled: !!companyId,
  });
}

export function useCreateAssignmentMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      scope: "employee" | "group";
      employeeId?: string | null;
      department?: string | null;
      templateId: string;
      overrides?: Partial<ScheduleValues> | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      reason?: string | null;
    }) => unwrap(WorkScheduleService.createAssignment(companyId!, input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleAssignments(companyId!) });
      toast.success(t("schedules.toast.assignment_created"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateAssignmentMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      patch,
    }: {
      assignmentId: string;
      patch: { overrides?: Partial<ScheduleValues> | null; effectiveTo?: string | null; reason: string };
    }) => unwrap(WorkScheduleService.updateAssignment(companyId!, assignmentId, patch)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleAssignments(companyId!) });
      toast.success(t("schedules.toast.assignment_updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeactivateAssignmentMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, reason }: { assignmentId: string; reason: string }) =>
      unwrap(WorkScheduleService.deactivateAssignment(companyId!, assignmentId, reason)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.scheduleAssignments(companyId!) });
      toast.success(t("schedules.toast.assignment_deactivated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* -------------------------------------------------------------------------- */
/* Lateness policies                                                           */
/* -------------------------------------------------------------------------- */

export function useLatenessPoliciesQuery() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.people.latenessPolicies(companyId!),
    queryFn: () => unwrap(WorkScheduleService.listPolicies(companyId!)),
    enabled: !!companyId,
  });
}

export function useCreatePolicyMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLatenessPolicyDTO) => unwrap(WorkScheduleService.createPolicy(companyId!, dto)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.latenessPolicies(companyId!) });
      toast.success(t("policy.toast_created"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdatePolicyMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      patch,
    }: {
      policyId: string;
      patch: Partial<Omit<LatenessPolicy, "id" | "createdAt">>;
    }) => unwrap(WorkScheduleService.updatePolicy(companyId!, policyId, patch)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.latenessPolicies(companyId!) });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(t("policy.toast_updated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSetPolicyActiveMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, isActive }: { policyId: string; isActive: boolean }) =>
      unwrap(WorkScheduleService.setPolicyActive(companyId!, policyId, isActive)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.latenessPolicies(companyId!) });
      toast.success(t("common.toast_saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeletePolicyMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policyId: string) => unwrap(WorkScheduleService.deletePolicy(companyId!, policyId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.latenessPolicies(companyId!) });
      toast.success(t("policy.toast_deleted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* -------------------------------------------------------------------------- */
/* Deduction cases (evaluation + review workflow)                              */
/* -------------------------------------------------------------------------- */

export function useDeductionCasesQuery(enabled = true) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.people.deductionCases(companyId!),
    queryFn: () => unwrap(WorkScheduleService.listCases(companyId!)),
    enabled: !!companyId && enabled,
  });
}

export function useMyDeductionCasesQuery(employeeId: string | null | undefined) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEYS.people.deductionCases(companyId!), "mine", employeeId ?? ""] as const,
    queryFn: () => unwrap(WorkScheduleService.listCasesForEmployee(companyId!, employeeId!)),
    enabled: !!companyId && !!employeeId,
  });
}

export function useEvaluateMonthMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, periodKey }: { employeeId: string; periodKey: string }) =>
      unwrap(WorkScheduleService.evaluateMonth(companyId!, employeeId, periodKey)),
    onSuccess: (res: { createdCases: DeductionCase[] }) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.deductionCases(companyId!) });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(
        res.createdCases.length > 0
          ? t("policy.toast_evaluated", { count: res.createdCases.length })
          : t("policy.toast_no_new_cases")
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDecideCaseMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, decision, note }: { caseId: string; decision: "approved" | "rejected"; note: string }) =>
      unwrap(WorkScheduleService.decideCase(companyId!, caseId, decision, note)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.deductionCases(companyId!) });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(vars.decision === "approved" ? t("policy.toast_approved") : t("policy.toast_rejected"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePostCaseMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => unwrap(WorkScheduleService.postCaseToPayroll(companyId!, caseId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.deductionCases(companyId!) });
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(t("policy.toast_posted"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useReverseCaseMutation() {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, note }: { caseId: string; note: string }) =>
      unwrap(WorkScheduleService.reverseCase(companyId!, caseId, note)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.people.deductionCases(companyId!) });
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(t("policy.toast_reversed"));
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* -------------------------------------------------------------------------- */
/* Monthly lateness report                                                     */
/* -------------------------------------------------------------------------- */

export function useLatenessReportQuery(periodKey: string) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.people.latenessReport(companyId!, periodKey),
    queryFn: () => unwrap(WorkScheduleService.monthlyLatenessReport(companyId!, periodKey)),
    enabled: !!companyId && !!periodKey,
  });
}
