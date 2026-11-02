/**
 * Work schedules, lateness policies and deduction cases — Firestore access.
 *
 * Collections (company-scoped):
 *   hr_schedule_templates    — editable Office/Online/Custom defaults.
 *   hr_schedule_assignments  — employee/group assignments (snapshot at assign).
 *   hr_lateness_policies     — versioned threshold policies.
 *   hr_deduction_cases       — per employee+period+threshold workflow records.
 *
 * Invariants enforced HERE (the security rules enforce the same boundary):
 * - a template edit bumps `version` and appends a changeLog entry but NEVER
 *   rewrites assignment snapshots or attendance snapshots;
 * - an employee-scoped assignment may not overlap an existing active one;
 * - deduction cases are created only where the derived monthly accumulation
 *   actually reached a threshold, and the deterministic doc id makes a
 *   repeated evaluation a no-op;
 * - the subject of a case can never approve/reject their own case;
 * - posting to payroll reuses BillingService.postJournalWithBalances with
 *   sourceType "payroll" + the case id, so a double post is transactionally
 *   impossible; an approved case WITHOUT a legal basis is never posted.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  type DocumentReference,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { BillingService } from "@/features/billing/api/billing.service";
import type { JournalEntry } from "@/features/billing/schemas/journal";
import type { Employee } from "../types/people.types";
import type {
  CasePolicySnapshot,
  CreateLatenessPolicyDTO,
  CreateScheduleTemplateDTO,
  DeductionCase,
  LatenessPolicy,
  LatenessThreshold,
  ScheduleAssignment,
  ScheduleTemplate,
  ScheduleValues,
} from "../types/work-schedule.types";
import { SCHEDULE_PRESETS } from "../types/work-schedule.types";
import {
  accumulateMonth,
  canTransitionDeductionCase,
  computeDeductionAmount,
  deductionCaseId,
  findAssignmentConflict,
  reachedThresholds,
  resolveAssignmentFor,
  round2,
  validatePolicyDraft,
  validateScheduleValues,
  type DeductionAmountResult,
  type FieldError,
} from "../lib/work-schedule-rules";

const SERVICE_NAME = "WorkScheduleService";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const TEMPLATES = (companyId: string) =>
  collection(db, "companies", companyId, "hr_schedule_templates");
const ASSIGNMENTS = (companyId: string) =>
  collection(db, "companies", companyId, "hr_schedule_assignments");
const POLICIES = (companyId: string) =>
  collection(db, "companies", companyId, "hr_lateness_policies");
const CASES = (companyId: string) =>
  collection(db, "companies", companyId, "hr_deduction_cases");

function toIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function currentUid(): string {
  return auth.currentUser?.uid ?? "";
}

function valuesOf(data: Record<string, unknown>): ScheduleValues {
  return {
    startTime: String(data.startTime ?? "09:00"),
    endTime: String(data.endTime ?? "17:00"),
    workingDays: Array.isArray(data.workingDays)
      ? (data.workingDays as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [0, 1, 2, 3, 4],
    breakMinutes: Number(data.breakMinutes ?? 0) || 0,
    breakCountsAsWork: data.breakCountsAsWork !== false,
    graceMinutes: Number(data.graceMinutes ?? 0) || 0,
    requiredDailyMinutes:
      data.requiredDailyMinutes == null ? null : Number(data.requiredDailyMinutes),
    flexibleStartWindow: Array.isArray(data.flexibleStartWindow)
      ? [String(data.flexibleStartWindow[0]), String(data.flexibleStartWindow[1])]
      : null,
    timezone: String(data.timezone ?? "Asia/Riyadh"),
    overtime:
      data.overtime && typeof data.overtime === "object"
        ? {
            enabled: Boolean((data.overtime as Record<string, unknown>).enabled),
            afterWorkMinutes:
              Number((data.overtime as Record<string, unknown>).afterWorkMinutes ?? 0) || 0,
          }
        : null,
  };
}

function mapTemplate(id: string, data: Record<string, unknown>): ScheduleTemplate {
  return {
    ...valuesOf(data),
    id,
    name: String(data.name ?? ""),
    description: (data.description as string | null) ?? null,
    mode: (data.mode as ScheduleTemplate["mode"]) ?? "custom",
    effectiveFrom: (data.effectiveFrom as string | null) ?? null,
    effectiveTo: (data.effectiveTo as string | null) ?? null,
    isActive: data.isActive !== false,
    version: Number(data.version ?? 1),
    createdBy: String(data.createdBy ?? ""),
    updatedBy: (data.updatedBy as string) ?? undefined,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    changeLog: Array.isArray(data.changeLog)
      ? (data.changeLog as ScheduleTemplate["changeLog"])
      : [],
  };
}

function mapAssignment(id: string, data: Record<string, unknown>): ScheduleAssignment {
  return {
    id,
    scope: (data.scope as ScheduleAssignment["scope"]) ?? "employee",
    employeeId: (data.employeeId as string | null) ?? null,
    department: (data.department as string | null) ?? null,
    templateId: String(data.templateId ?? ""),
    templateVersion: Number(data.templateVersion ?? 1),
    templateMode: (data.templateMode as ScheduleAssignment["templateMode"]) ?? null,
    snapshot: valuesOf((data.snapshot as Record<string, unknown>) ?? {}),
    overrides:
      data.overrides && typeof data.overrides === "object"
        ? (valuesOf(data.overrides as Record<string, unknown>) as Partial<ScheduleValues>)
        : null,
    effectiveFrom: String(data.effectiveFrom ?? ""),
    effectiveTo: (data.effectiveTo as string | null) ?? null,
    reason: (data.reason as string | null) ?? null,
    status: (data.status as ScheduleAssignment["status"]) ?? "active",
    createdBy: String(data.createdBy ?? ""),
    updatedBy: (data.updatedBy as string) ?? undefined,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    audit: Array.isArray(data.audit) ? (data.audit as ScheduleAssignment["audit"]) : [],
  };
}

function mapPolicy(id: string, data: Record<string, unknown>): LatenessPolicy {
  return {
    id,
    name: String(data.name ?? ""),
    description: (data.description as string | null) ?? null,
    appliesTo:
      data.appliesTo && typeof data.appliesTo === "object"
        ? {
            workModes:
              (data.appliesTo as Record<string, unknown>).workModes != null
                ? ((data.appliesTo as Record<string, unknown>).workModes as LatenessPolicy["appliesTo"]["workModes"])
                : null,
            departments:
              (data.appliesTo as Record<string, unknown>).departments != null
                ? ((data.appliesTo as Record<string, unknown>).departments as string[])
                : null,
          }
        : {},
    period: "calendar_month",
    thresholds: Array.isArray(data.thresholds)
      ? (data.thresholds as LatenessThreshold[])
      : [],
    thresholdMode: (data.thresholdMode as LatenessPolicy["thresholdMode"]) ?? "cumulative",
    workingDaysPerMonth: Number(data.workingDaysPerMonth ?? 26),
    hoursPerDeductionDay:
      data.hoursPerDeductionDay == null ? null : Number(data.hoursPerDeductionDay) || null,
    maxMonthlyDeductionAmount: Number(data.maxMonthlyDeductionAmount ?? 0),
    maxMonthlyDeductionGrossFraction: Number(data.maxMonthlyDeductionGrossFraction ?? 0),
    legalBasis:
      typeof data.legalBasis === "string" && data.legalBasis.trim()
        ? data.legalBasis
        : null,
    isActive: data.isActive !== false,
    version: Number(data.version ?? 1),
    effectiveFrom: String(data.effectiveFrom ?? ""),
    createdBy: String(data.createdBy ?? ""),
    updatedBy: (data.updatedBy as string) ?? undefined,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapCase(id: string, data: Record<string, unknown>): DeductionCase {
  return {
    id,
    employeeId: String(data.employeeId ?? ""),
    subjectUserId: String(data.subjectUserId ?? ""),
    periodKey: String(data.periodKey ?? ""),
    accumulatedMinutes: Number(data.accumulatedMinutes ?? 0),
    contributingAttendanceIds: Array.isArray(data.contributingAttendanceIds)
      ? (data.contributingAttendanceIds as string[])
      : [],
    thresholdId: String(data.thresholdId ?? ""),
    policyId: String(data.policyId ?? ""),
    policySnapshot: data.policySnapshot as CasePolicySnapshot,
    kind: (data.kind as DeductionCase["kind"]) ?? "review",
    status: (data.status as DeductionCase["status"]) ?? "pending_review",
    deductionDays: data.deductionDays == null ? null : Number(data.deductionDays),
    dailyRate: data.dailyRate == null ? null : Number(data.dailyRate),
    amount: data.amount == null ? null : Number(data.amount),
    currency: (data.currency as string | null) ?? null,
    proposedBy: String(data.proposedBy ?? "system"),
    decidedBy: (data.decidedBy as string | null) ?? null,
    decidedAt: (data.decidedAt as string | null) ?? null,
    decisionNote: (data.decisionNote as string | null) ?? null,
    recalculatedAt: (data.recalculatedAt as string | null) ?? null,
    journalId: (data.journalId as string | null) ?? null,
    reversedBy: (data.reversedBy as string | null) ?? null,
    reversedAt: (data.reversedAt as string | null) ?? null,
    reversalNote: (data.reversalNote as string | null) ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function fail<T>(message: string, errors?: FieldError[]): ApiResponse<T> {
  return { data: null as unknown as T, message, ...(errors ? { errors } : {}) };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

export const WorkScheduleService = {
  /* ---------------------------- templates -------------------------------- */

  async listTemplates(companyId: string): Promise<ApiResponse<ScheduleTemplate[]>> {
    return withLogging(SERVICE_NAME, "listTemplates", (async () => {
      const snap = await getDocs(TEMPLATES(companyId));
      const templates = snap.docs
        .map((d) => mapTemplate(d.id, d.data()))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { data: templates, message: "Success" };
    })());
  },

  /**
   * Seed the configurable Office/Online defaults on first use. Idempotent:
   * a company that already has templates (or seeds twice concurrently) never
   * gets duplicates because the doc ids are fixed.
   */
  async ensureDefaultTemplates(companyId: string): Promise<ApiResponse<ScheduleTemplate[]>> {
    return withLogging(SERVICE_NAME, "ensureDefaultTemplates", (async () => {
      const uid = currentUid();
      const presets = [
        { key: "office" as const, id: "preset_office_default" },
        { key: "online" as const, id: "preset_online_default" },
      ];
      for (const p of presets) {
        const ref = doc(db, "companies", companyId, "hr_schedule_templates", p.id);
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          const preset = SCHEDULE_PRESETS[p.key];
          await setDoc(
            ref,
            {
              ...preset.values,
              name: preset.name,
              description: "Seeded product default — edit freely; edits never rewrite existing assignments.",
              mode: p.key,
              effectiveFrom: null,
              effectiveTo: null,
              isActive: true,
              version: 1,
              createdBy: uid || "system",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              changeLog: [],
            }
          );
        }
      }
      return WorkScheduleService.listTemplates(companyId);
    })());
  },

  async createTemplate(
    companyId: string,
    dto: CreateScheduleTemplateDTO
  ): Promise<ApiResponse<ScheduleTemplate>> {
    return withLogging(SERVICE_NAME, "createTemplate", (async () => {
      const errors = validateScheduleValues(dto);
      if (errors.length > 0) return fail<ScheduleTemplate>(errors.map((e) => e.messageKey).join("; "), errors);
      const uid = currentUid();
      const ref = await addDocTo("hr_schedule_templates", companyId, {
        ...valuesOf(dto as unknown as Record<string, unknown>),
        name: dto.name,
        description: dto.description ?? null,
        mode: dto.mode,
        effectiveFrom: dto.effectiveFrom ?? null,
        effectiveTo: dto.effectiveTo ?? null,
        isActive: dto.isActive !== false,
        version: 1,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        changeLog: [],
      });
      const snap = await getDoc(ref);
      return {
        data: mapTemplate(ref.id, snap.data() ?? {}),
        message: "Template created",
      };
    })());
  },

  /**
   * Versioned edit. The frozen snapshots on assignments/attendance are NOT
   * touched — editing a template never rewrites history.
   */
  async updateTemplate(
    companyId: string,
    templateId: string,
    patch: Partial<ScheduleValues> & { name?: string; description?: string | null; isActive?: boolean },
    reason: string
  ): Promise<ApiResponse<ScheduleTemplate>> {
    return withLogging(SERVICE_NAME, "updateTemplate", (async () => {
      const ref = doc(db, "companies", companyId, "hr_schedule_templates", templateId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<ScheduleTemplate>("Template not found");
      const current = mapTemplate(snap.id, snap.data() ?? {});
      const merged: ScheduleValues = { ...current, ...patch };
      const errors = validateScheduleValues(merged);
      if (errors.length > 0) return fail<ScheduleTemplate>(errors.map((e) => e.messageKey).join("; "), errors);
      const uid = currentUid();
      await updateDoc(ref, {
        ...valuesOf(merged as unknown as Record<string, unknown>),
        name: patch.name ?? current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        isActive: patch.isActive !== undefined ? patch.isActive : current.isActive,
        version: current.version + 1,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
        changeLog: [
          ...current.changeLog,
          {
            at: new Date().toISOString(),
            by: uid,
            reason: reason.trim() || "—",
            summary: `v${current.version + 1}: ${patch.name ?? current.name} (${merged.startTime}–${merged.endTime})`,
          },
        ],
      });
      const after = await getDoc(ref);
      return {
        data: mapTemplate(ref.id, after.data() ?? {}),
        message: "Template updated — existing assignments keep their frozen snapshot",
      };
    })());
  },

  /** Templates are deactivated, never hard-deleted, while assignments exist. */
  async setTemplateActive(
    companyId: string,
    templateId: string,
    isActive: boolean,
    reason: string
  ): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "setTemplateActive", (async () => {
      const ref = doc(db, "companies", companyId, "hr_schedule_templates", templateId);
      await updateDoc(ref, {
        isActive,
        updatedBy: currentUid(),
        updatedAt: serverTimestamp(),
        ...(isActive
          ? {}
          : {
              effectiveTo: new Date().toISOString().slice(0, 10),
            }),
        changeLog: [
          {
            at: new Date().toISOString(),
            by: currentUid(),
            reason: reason.trim() || "—",
            summary: isActive ? "Re-activated" : "Deactivated",
          },
        ],
      });
      return { data: undefined as void, message: isActive ? "Template activated" : "Template deactivated" };
    })());
  },

  /* ---------------------------- assignments -------------------------------- */

  async listAssignments(companyId: string): Promise<ApiResponse<ScheduleAssignment[]>> {
    return withLogging(SERVICE_NAME, "listAssignments", (async () => {
      const snap = await getDocs(ASSIGNMENTS(companyId));
      const rows = snap.docs
        .map((d) => mapAssignment(d.id, d.data()))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
      return { data: rows, message: "Success" };
    })());
  },

  /**
   * Assign a template to an employee or a department group. The template's
   * current values are FROZEN into `snapshot` at this moment.
   */
  async createAssignment(
    companyId: string,
    input: {
      scope: "employee" | "group";
      employeeId?: string | null;
      department?: string | null;
      templateId: string;
      overrides?: Partial<ScheduleValues> | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      reason?: string | null;
    }
  ): Promise<ApiResponse<ScheduleAssignment>> {
    return withLogging(SERVICE_NAME, "createAssignment", (async () => {
      if (input.scope === "employee" && !input.employeeId) {
        return fail<ScheduleAssignment>("policy.validation.employeeRequired");
      }
      if (input.scope === "group" && !input.department) {
        return fail<ScheduleAssignment>("policy.validation.departmentRequired");
      }
      const templateSnap = await getDoc(
        doc(db, "companies", companyId, "hr_schedule_templates", input.templateId)
      );
      if (!templateSnap.exists()) {
        return fail<ScheduleAssignment>("Template not found");
      }
      const template = mapTemplate(templateSnap.id, templateSnap.data() ?? {});
      const merged = { ...template, ...(input.overrides ?? {}) };
      const errors = validateScheduleValues(merged);
      if (errors.length > 0) return fail<ScheduleAssignment>(errors.map((e) => e.messageKey).join("; "), errors);

      const { data: existing } = await WorkScheduleService.listAssignments(companyId);
      const conflict = findAssignmentConflict(
        {
          scope: input.scope,
          employeeId: input.employeeId ?? null,
          department: input.department ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
        },
        existing ?? []
      );
      if (conflict) {
        return fail<ScheduleAssignment>(
          `schedules.assignmentConflict: overlaps assignment ${conflict.id} (${conflict.effectiveFrom} → ${conflict.effectiveTo ?? "…"})`
        );
      }

      const uid = currentUid();
      const nowIso = new Date().toISOString();
      const docRef = await addDocTo("hr_schedule_assignments", companyId, {
        scope: input.scope,
        employeeId: input.scope === "employee" ? input.employeeId : null,
        department: input.scope === "group" ? input.department : null,
        templateId: template.id,
        templateVersion: template.version,
        templateMode: template.mode,
        snapshot: valuesOf(template as unknown as Record<string, unknown>),
        overrides: input.overrides ? valuesOf(input.overrides as unknown as Record<string, unknown>) : null,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        reason: input.reason ?? null,
        status: "active",
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        audit: [{ at: nowIso, by: uid, action: "created", reason: input.reason ?? "Initial assignment" }],
      });
      const after = await getDoc(docRef);
      return { data: mapAssignment(docRef.id, after.data() ?? {}), message: "Assignment created" };
    })());
  },

  /** Change overrides / end date. An audit entry with the reason is required. */
  async updateAssignment(
    companyId: string,
    assignmentId: string,
    patch: {
      overrides?: Partial<ScheduleValues> | null;
      effectiveTo?: string | null;
      reason: string;
    }
  ): Promise<ApiResponse<ScheduleAssignment>> {
    return withLogging(SERVICE_NAME, "updateAssignment", (async () => {
      if (!patch.reason || !patch.reason.trim()) {
        return fail<ScheduleAssignment>("schedules.validation.reasonRequired");
      }
      const ref = doc(db, "companies", companyId, "hr_schedule_assignments", assignmentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<ScheduleAssignment>("Assignment not found");
      const current = mapAssignment(snap.id, snap.data() ?? {});
      const nextOverrides =
        patch.overrides !== undefined
          ? patch.overrides
            ? { ...(current.overrides ?? {}), ...patch.overrides }
            : null
          : current.overrides;
      const errors = validateScheduleValues({
        ...current.snapshot,
        ...(nextOverrides ?? {}),
      });
      if (errors.length > 0) return fail<ScheduleAssignment>(errors.map((e) => e.messageKey).join("; "), errors);
      const uid = currentUid();
      await updateDoc(ref, {
        overrides: nextOverrides ? valuesOf(nextOverrides as unknown as Record<string, unknown>) : null,
        effectiveTo: patch.effectiveTo !== undefined ? patch.effectiveTo : current.effectiveTo,
        reason: patch.reason,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
        audit: [
          ...current.audit,
          { at: new Date().toISOString(), by: uid, action: "updated", reason: patch.reason },
        ],
      });
      const after = await getDoc(ref);
      return {
        data: mapAssignment(ref.id, after.data() ?? {}),
        message: "Assignment updated — punches before this kept their own snapshots",
      };
    })());
  },

  async deactivateAssignment(
    companyId: string,
    assignmentId: string,
    reason: string
  ): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deactivateAssignment", (async () => {
      const ref = doc(db, "companies", companyId, "hr_schedule_assignments", assignmentId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { data: undefined as void, message: "Assignment not found" };
      const current = mapAssignment(snap.id, snap.data() ?? {});
      const uid = currentUid();
      await updateDoc(ref, {
        status: "deactivated",
        effectiveTo: current.effectiveTo ?? new Date().toISOString().slice(0, 10),
        updatedBy: uid,
        updatedAt: serverTimestamp(),
        audit: [
          ...current.audit,
          { at: new Date().toISOString(), by: uid, action: "deactivated", reason: reason.trim() || "—" },
        ],
      });
      return { data: undefined as void, message: "Assignment deactivated — the employee falls back to the company late cutoff" };
    })());
  },

  /**
   * Effective assignment for one employee on one date — exported for the
   * check-in path (PeopleService) so BOTH read the same precedence rules.
   */
  async resolveAssignment(
    companyId: string,
    employeeId: string,
    department: string | undefined,
    dateIso: string
  ): Promise<ScheduleAssignment | null> {
    const snap = await getDocs(
      query(ASSIGNMENTS(companyId), where("status", "==", "active"))
    );
    const rows = snap.docs.map((d) => mapAssignment(d.id, d.data()));
    return resolveAssignmentFor(rows, employeeId, department, dateIso);
  },

  /* ------------------------------- policies -------------------------------- */

  async listPolicies(companyId: string): Promise<ApiResponse<LatenessPolicy[]>> {
    return withLogging(SERVICE_NAME, "listPolicies", (async () => {
      const snap = await getDocs(POLICIES(companyId));
      const rows = snap.docs
        .map((d) => mapPolicy(d.id, d.data()))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.name.localeCompare(b.name));
      return { data: rows, message: "Success" };
    })());
  },

  async createPolicy(
    companyId: string,
    dto: CreateLatenessPolicyDTO
  ): Promise<ApiResponse<LatenessPolicy>> {
    return withLogging(SERVICE_NAME, "createPolicy", (async () => {
      const errors = validatePolicyDraft(dto);
      if (errors.length > 0) return fail<LatenessPolicy>(errors.map((e) => e.messageKey).join("; "), errors);
      const uid = currentUid();
      const ref = await addDocTo("hr_lateness_policies", companyId, {
        ...dto,
        isActive: dto.isActive !== false,
        version: 1,
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const snap = await getDoc(ref);
      return { data: mapPolicy(ref.id, snap.data() ?? {}), message: "Policy created" };
    })());
  },

  /** Versioned edit; existing deduction cases keep their frozen snapshot. */
  async updatePolicy(
    companyId: string,
    policyId: string,
    patch: Partial<Omit<LatenessPolicy, "id" | "createdAt">>
  ): Promise<ApiResponse<LatenessPolicy>> {
    return withLogging(SERVICE_NAME, "updatePolicy", (async () => {
      const ref = doc(db, "companies", companyId, "hr_lateness_policies", policyId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<LatenessPolicy>("Policy not found");
      const current = mapPolicy(snap.id, snap.data() ?? {});
      const merged = { ...current, ...patch };
      const errors = validatePolicyDraft(merged);
      if (errors.length > 0) return fail<LatenessPolicy>(errors.map((e) => e.messageKey).join("; "), errors);
      const uid = currentUid();
      await updateDoc(ref, {
        ...patch,
        thresholds: merged.thresholds,
        appliesTo: merged.appliesTo,
        version: current.version + 1,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      const after = await getDoc(ref);
      return {
        data: mapPolicy(ref.id, after.data() ?? {}),
        message: "Policy updated to v" + (current.version + 1) + " — existing cases are unaffected",
      };
    })());
  },

  async setPolicyActive(
    companyId: string,
    policyId: string,
    isActive: boolean
  ): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "setPolicyActive", (async () => {
      const ref = doc(db, "companies", companyId, "hr_lateness_policies", policyId);
      await updateDoc(ref, {
        isActive,
        updatedBy: currentUid(),
        updatedAt: serverTimestamp(),
      });
      return { data: undefined as void, message: isActive ? "Policy activated" : "Policy deactivated" };
    })());
  },

  async deletePolicy(companyId: string, policyId: string): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deletePolicy", (async () => {
      // Only a policy without any case history may be removed; otherwise the
      // audit trail would lose its anchor.
      const casesSnap = await getDocs(
        query(CASES(companyId), where("policyId", "==", policyId))
      );
      if (!casesSnap.empty) {
        return {
          data: undefined as void,
          message: "policy.hasHistoryUseDeactivate",
        };
      }
      await deleteDoc(doc(db, "companies", companyId, "hr_lateness_policies", policyId));
      return { data: undefined as void, message: "Policy deleted" };
    })());
  },

  /* ---------------------------- monthly evaluation -------------------------- */

  /**
   * Re-derive the month from attendance rows and create ONLY the missing
   * deduction cases. Deterministic doc ids make re-running this safe; nothing
   * that was ever decided or posted is mutated here.
   */
  async evaluateMonth(
    companyId: string,
    employeeId: string,
    periodKey: string, // "YYYY-MM"
    actorUid?: string
  ): Promise<
    ApiResponse<{
      createdCases: DeductionCase[];
      perPolicy: { policyId: string; totalMinutes: number; legacyMinutes: number; excusedMinutes: number }[];
    }>
  > {
    return withLogging(SERVICE_NAME, "evaluateMonth", (async () => {
      const employeeSnap = await getDoc(
        doc(db, "companies", companyId, "employees", employeeId)
      );
      if (!employeeSnap.exists()) {
        return fail("Employee not found");
      }
      const employee = employeeSnap.data() as Employee;

      const attSnap = await getDocs(
        query(
          collection(db, "companies", companyId, "attendance"),
          where("date", ">=", `${periodKey}-01`),
          where("date", "<=", `${periodKey}-31`)
        )
      );
      const rows = attSnap.docs
        .filter((d) => d.data().employeeId === employeeId)
        .map((d) => ({
          id: d.id,
          date: String(d.data().date ?? ""),
          status: String(d.data().status ?? "present"),
          lateMinutes: Number(d.data().lateMinutes ?? 0) || 0,
          schedule: (d.data().schedule as {
            rawLateMinutes: number;
            excusedLateMinutes: number;
            countableLateMinutes: number;
            workMode?: string | null;
          } | null) ?? null,
        }));

      const casesSnap = await getDocs(
        query(CASES(companyId), where("employeeId", "==", employeeId), where("periodKey", "==", periodKey))
      );
      const existingCases = casesSnap.docs.map((d) => mapCase(d.id, d.data()));

      const { data: policies } = await WorkScheduleService.listPolicies(companyId);
      const activePolicies = (policies ?? []).filter(
        (p) => p.isActive && (!p.effectiveFrom || p.effectiveFrom <= `${periodKey}-31`)
      );

      const uid = actorUid ?? currentUid() ?? "system";
      const createdCases: DeductionCase[] = [];
      const perPolicy: { policyId: string; totalMinutes: number; legacyMinutes: number; excusedMinutes: number }[] = [];

      for (const policy of activePolicies) {
        // Scope filters: departments; workModes match the punch snapshot only
        // (legacy rows without a snapshot count ONLY for unscoped policies —
        // inventing a mode for them would be fabrication).
        if (policy.appliesTo?.departments?.length && !policy.appliesTo.departments.includes(employee.department)) {
          continue;
        }
        const modeFilter = policy.appliesTo?.workModes?.length
          ? policy.appliesTo.workModes
          : null;
        const scopedRows = modeFilter
          ? rows.filter((r) => r.schedule?.workMode != null && modeFilter.includes(r.schedule.workMode as never))
          : rows;

        const acc = accumulateMonth(scopedRows, employeeId, periodKey);
        perPolicy.push({
          policyId: policy.id,
          totalMinutes: acc.totalMinutes,
          legacyMinutes: acc.legacyMinutes,
          excusedMinutes: acc.excusedMinutes,
        });
        if (acc.totalMinutes <= 0) continue;

        const mine = existingCases.filter((c) => c.policyId === policy.id);
        const firedMinutes = mine
          .filter((c) => c.status !== "rejected" && c.status !== "reversed")
          .map((c) => c.policySnapshot?.thresholdMinutes ?? 0);
        const reached = reachedThresholds(acc.totalMinutes, policy, firedMinutes);

        // Per-employee monthly commitment across ALL policies (caps apply).
        const committedThisPeriod = existingCases
          .filter((c) => ["proposed", "approved", "posted"].includes(c.status))
          .reduce((s, c) => s + (c.amount ?? 0), 0);

        for (const threshold of reached) {
          const caseId = deductionCaseId(employeeId, periodKey, threshold.id);
          const already = await getDoc(doc(db, "companies", companyId, "hr_deduction_cases", caseId));
          if (already.exists()) continue;

          const hasLegalBasis = !!policy.legalBasis;
          const amountResult =
            threshold.action.kind === "propose_deduction"
              ? computeDeductionAmount({
                  monthlyGross: Number(employee.salary ?? 0) || 0,
                  action: threshold.action,
                  workingDaysPerMonth: policy.workingDaysPerMonth,
                  alreadyCommitted: committedThisPeriod,
                  maxMonthlyDeductionAmount: policy.maxMonthlyDeductionAmount,
                  maxMonthlyDeductionGrossFraction: policy.maxMonthlyDeductionGrossFraction,
                  // Approved 8h→1day conversion: days derive from the CANONICAL
                  // accumulation whenever the policy states a ratio.
                  accumulatedMinutes: acc.totalMinutes,
                  hoursPerDeductionDay: policy.hoursPerDeductionDay ?? null,
                })
              : { days: null, dailyRate: null, amount: 0, capped: false, capReason: null } as DeductionAmountResult;

          // Manual thresholds, non-deduction actions and anything without a
          // stated legal basis START as review items. Automatic deductions with
          // a configured legal basis start as proposals awaiting approval.
          const autoDeduction =
            threshold.automatic &&
            threshold.action.kind === "propose_deduction" &&
            hasLegalBasis &&
            amountResult.amount > 0;

          const snapshot: CasePolicySnapshot = {
            policyName: policy.name,
            policyVersion: policy.version,
            thresholdMinutes: threshold.afterMinutes,
            action: threshold.action,
            thresholdMode: policy.thresholdMode,
            workingDaysPerMonth: policy.workingDaysPerMonth,
            hoursPerDeductionDay: policy.hoursPerDeductionDay ?? null,
            legalBasisPresent: hasLegalBasis,
            currency: employee.currency || "SAR",
          };

          const nowIso = new Date().toISOString();
          const caseData: Omit<DeductionCase, "createdAt" | "updatedAt"> = {
            id: caseId,
            employeeId,
            subjectUserId: String(employee.userId || ""),
            periodKey,
            accumulatedMinutes: acc.totalMinutes,
            contributingAttendanceIds: acc.contributingIds,
            thresholdId: threshold.id,
            policyId: policy.id,
            policySnapshot: snapshot,
            kind: threshold.action.kind,
            status: autoDeduction ? "proposed" : "pending_review",
            deductionDays: amountResult.days,
            dailyRate: amountResult.dailyRate,
            amount: threshold.action.kind === "propose_deduction" ? amountResult.amount : null,
            currency: threshold.action.kind === "propose_deduction" ? snapshot.currency : null,
            proposedBy: uid || "system",
            decidedBy: null,
            decidedAt: null,
            decisionNote:
              amountResult.capReason === "no_gross_on_record"
                ? "policy.validation.noGrossOnRecord"
                : amountResult.capReason
                  ? `capped:${amountResult.capReason}`
                  : null,
          };
          await setDoc(doc(db, "companies", companyId, "hr_deduction_cases", caseId), {
            ...caseData,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          createdCases.push({
            ...caseData,
            createdAt: nowIso,
            updatedAt: nowIso,
          } as DeductionCase);
        }
      }

      return { data: { createdCases, perPolicy }, message: "Month evaluated" };
    })());
  },

  /**
   * After a correction the derived month totals change. ONLY undecided
   * cases (pending_review / proposed) are refreshed — approved, rejected
   * and posted history is immutable by design (reversal is the official
   * path for posted money).
   */
  async recalculateUndecidedCases(
    companyId: string,
    employeeId: string,
    periodKey: string
  ): Promise<ApiResponse<DeductionCase[]>> {
    return withLogging(SERVICE_NAME, "recalculateUndecidedCases", (async () => {
      const casesSnap = await getDocs(
        query(
          CASES(companyId),
          where("employeeId", "==", employeeId),
          where("periodKey", "==", periodKey)
        )
      );
      const undecided = casesSnap.docs
        .map((d) => mapCase(d.id, d.data()))
        .filter((c) => c.status === "pending_review" || c.status === "proposed");
      if (undecided.length === 0) return { data: [], message: "Nothing to recalculate" };

      const attSnap = await getDocs(
        query(
          collection(db, "companies", companyId, "attendance"),
          where("date", ">=", `${periodKey}-01`),
          where("date", "<=", `${periodKey}-31`)
        )
      );
      const rows = attSnap.docs
        .filter((d) => d.data().employeeId === employeeId)
        .map((d) => ({
          id: d.id,
          date: String(d.data().date ?? ""),
          status: String(d.data().status ?? "present"),
          lateMinutes: Number(d.data().lateMinutes ?? 0) || 0,
          schedule: (d.data().schedule as {
            rawLateMinutes: number;
            excusedLateMinutes: number;
            countableLateMinutes: number;
            workMode?: string | null;
          } | null) ?? null,
        }));

      const employeeSnap = await getDoc(doc(db, "companies", companyId, "employees", employeeId));
      const employee = employeeSnap.data() as Employee | undefined;
      const allCases = casesSnap.docs.map((d) => mapCase(d.id, d.data()));

      const updated: DeductionCase[] = [];
      for (const kase of undecided) {
        const policySnap = await getDoc(
          doc(db, "companies", companyId, "hr_lateness_policies", kase.policyId)
        );
        const policy = policySnap.exists() ? mapPolicy(policySnap.id, policySnap.data() ?? {}) : null;

        const modeFilter = policy?.appliesTo?.workModes?.length ? policy.appliesTo.workModes : null;
        const scopedRows = modeFilter
          ? rows.filter((r) => r.schedule?.workMode != null && modeFilter.includes(r.schedule.workMode as never))
          : rows;
        const acc = accumulateMonth(scopedRows, employeeId, periodKey);

        const patch: Record<string, unknown> = {};
        if (acc.totalMinutes !== kase.accumulatedMinutes) {
          patch.accumulatedMinutes = acc.totalMinutes;
          patch.contributingAttendanceIds = acc.contributingIds;
        }
        if (policy && kase.kind === "propose_deduction" && employee) {
          const alreadyCommitted = allCases
            .filter(
              (c) =>
                c.id !== kase.id &&
                ["proposed", "approved", "posted"].includes(c.status)
            )
            .reduce((s, c) => s + (c.amount ?? 0), 0);
          const amountResult = computeDeductionAmount({
            monthlyGross: Number(employee.salary ?? 0) || 0,
            action: kase.policySnapshot?.action ?? { kind: kase.kind },
            workingDaysPerMonth: policy.workingDaysPerMonth,
            alreadyCommitted,
            maxMonthlyDeductionAmount: policy.maxMonthlyDeductionAmount,
            maxMonthlyDeductionGrossFraction: policy.maxMonthlyDeductionGrossFraction,
            // Undecided cases follow the CURRENT canonical accumulation and
            // the conversion stated at case creation (snapshot first, policy
            // as fallback for pre-field cases). Decided cases are never touched.
            accumulatedMinutes: acc.totalMinutes,
            hoursPerDeductionDay:
              kase.policySnapshot?.hoursPerDeductionDay ??
              policy.hoursPerDeductionDay ??
              null,
          });
          if (amountResult.amount !== (kase.amount ?? 0)) {
            patch.amount = amountResult.amount;
            patch.dailyRate = amountResult.dailyRate;
            patch.deductionDays = amountResult.days;
          }
        }
        if (Object.keys(patch).length === 0) continue;

        const nowIso = new Date().toISOString();
        patch.recalculatedAt = nowIso;
        patch.updatedAt = nowIso;
        await updateDoc(
          doc(db, "companies", companyId, "hr_deduction_cases", kase.id),
          patch
        );
        updated.push({ ...kase, ...patch } as DeductionCase);
      }
      return { data: updated, message: `Recalculated ${updated.length} open case(s)` };
    })());
  },

  async listCases(companyId: string): Promise<ApiResponse<DeductionCase[]>> {
    return withLogging(SERVICE_NAME, "listCases", (async () => {
      const snap = await getDocs(CASES(companyId));
      const rows = snap.docs
        .map((d) => mapCase(d.id, d.data()))
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey) || b.createdAt.localeCompare(a.createdAt));
      return { data: rows, message: "Success" };
    })());
  },

  async listCasesForEmployee(
    companyId: string,
    employeeId: string
  ): Promise<ApiResponse<DeductionCase[]>> {
    return withLogging(SERVICE_NAME, "listCasesForEmployee", (async () => {
      const snap = await getDocs(query(CASES(companyId), where("employeeId", "==", employeeId)));
      const rows = snap.docs
        .map((d) => mapCase(d.id, d.data()))
        .sort((a, b) => b.periodKey.localeCompare(a.periodKey));
      return { data: rows, message: "Success" };
    })());
  },

  /* ------------------------------- decisions -------------------------------- */

  /**
   * HR/owner decision on a review item or proposal. The subject of the case
   * can NEVER decide their own case regardless of role.
   */
  async decideCase(
    companyId: string,
    caseId: string,
    decision: "approved" | "rejected",
    note: string
  ): Promise<ApiResponse<DeductionCase>> {
    return withLogging(SERVICE_NAME, "decideCase", (async () => {
      const uid = currentUid();
      const ref = doc(db, "companies", companyId, "hr_deduction_cases", caseId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<DeductionCase>("Case not found");
      const kase = mapCase(snap.id, snap.data() ?? {});
      if (!canTransitionDeductionCase(kase.status, decision)) {
        return fail<DeductionCase>(`policy.invalidTransition: ${kase.status} → ${decision}`);
      }
      if (uid && kase.subjectUserId === uid) {
        return fail<DeductionCase>("policy.selfDecisionNotAllowed");
      }
      if (!note || !note.trim()) {
        return fail<DeductionCase>("schedules.validation.reasonRequired");
      }
      const nowIso = new Date().toISOString();
      await updateDoc(ref, {
        status: decision,
        decidedBy: uid,
        decidedAt: nowIso,
        decisionNote: note,
        updatedAt: nowIso,
      });
      const after = mapCase(ref.id, { ...snap.data(), status: decision, decidedBy: uid, decidedAt: nowIso, decisionNote: note, updatedAt: nowIso });
      return { data: after, message: decision === "approved" ? "Case approved" : "Case rejected" };
    })());
  },

  /* ------------------------------ payroll post ------------------------------ */

  /**
   * Post an APPROVED deduction to accounting through the existing idempotent
   * journal engine: Dr 2310 Salaries Payable / Cr 5100 Salary Expense (the
   * deduction reduces the wage cost). Deterministic id
   * `je_payroll_<caseId>` makes a second post a no-op, and a case without a
   * legal basis or an amount can never get here.
   */
  async postCaseToPayroll(
    companyId: string,
    caseId: string
  ): Promise<ApiResponse<{ kase: DeductionCase; journal: JournalEntry }>> {
    return withLogging(SERVICE_NAME, "postCaseToPayroll", (async () => {
      const ref = doc(db, "companies", companyId, "hr_deduction_cases", caseId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<{ kase: DeductionCase; journal: JournalEntry }>("Case not found");
      const kase = mapCase(snap.id, snap.data() ?? {});
      if (!canTransitionDeductionCase(kase.status, "posted")) {
        return fail(`policy.invalidTransition: ${kase.status} → posted`);
      }
      if (kase.kind !== "propose_deduction" || !(kase.amount && kase.amount > 0)) {
        return fail("policy.nothingToPost");
      }
      if (!kase.policySnapshot?.legalBasisPresent) {
        // Configuration is never assumed to be legal compliance — posting an
        // amount whose policy has no stated legal basis is refused outright.
        return fail("policy.legalBasisRequired");
      }

      const accountsRes = await BillingService.accounts.getAll(companyId);
      const payable = accountsRes.data.find((a) => a.code === "2310");
      const expense = accountsRes.data.find((a) => a.code === "5100");
      if (!payable?.id || !expense?.id) {
        return fail("policy.accountsMissing: 2310/5100");
      }

      const amount = round2(kase.amount);
      const documentNumber = await BillingService.reserveDocumentNumber(companyId, "payroll");
      const uid = currentUid();
      const journal = await BillingService.postJournalWithBalances(companyId, {
        journalNumber: documentNumber,
        date: new Date(),
        reference: `LATE-DED-${kase.periodKey}-${kase.thresholdId}`,
        notes: `Monthly lateness deduction — employee ${kase.employeeId}, period ${kase.periodKey}, accumulated ${kase.accumulatedMinutes} min (policy v${kase.policySnapshot.policyVersion} "${kase.policySnapshot.policyName}")`,
        currency: kase.currency || "SAR",
        status: "posted",
        sourceType: "payroll",
        sourceId: caseId,
        postedBy: uid,
        lines: [
          { accountId: payable.id, debit: amount, credit: 0, taxAmount: 0 },
          { accountId: expense.id, debit: 0, credit: amount, taxAmount: 0 },
        ],
        totalDebit: amount,
        totalCredit: amount,
      });

      const nowIso = new Date().toISOString();
      await updateDoc(ref, {
        status: "posted",
        journalId: journal.id,
        updatedAt: nowIso,
      });
      const after = mapCase(ref.id, { ...snap.data(), status: "posted", journalId: journal.id, updatedAt: nowIso });
      return { data: { kase: after, journal }, message: "Deduction posted to payroll accounts" };
    })());
  },

  /**
   * Reversal for an already-posted case (decided later, e.g. after a
   * grievance). Uses the same engine so balances move back exactly once:
   * `je_rev_payroll_<caseId>`.
   */
  async reverseCase(companyId: string, caseId: string, note: string): Promise<ApiResponse<DeductionCase>> {
    return withLogging(SERVICE_NAME, "reverseCase", (async () => {
      const ref = doc(db, "companies", companyId, "hr_deduction_cases", caseId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return fail<DeductionCase>("Case not found");
      const kase = mapCase(snap.id, snap.data() ?? {});
      if (!canTransitionDeductionCase(kase.status, "reversed")) {
        return fail<DeductionCase>(`policy.invalidTransition: ${kase.status} → reversed`);
      }
      if (!note || !note.trim()) {
        return fail<DeductionCase>("schedules.validation.reasonRequired");
      }
      const uid = currentUid();
      if (kase.subjectUserId && kase.subjectUserId === uid) {
        return fail<DeductionCase>("policy.selfDecisionNotAllowed");
      }

      if (kase.journalId && kase.amount && kase.amount > 0) {
        const accountsRes = await BillingService.accounts.getAll(companyId);
        const payable = accountsRes.data.find((a) => a.code === "2310");
        const expense = accountsRes.data.find((a) => a.code === "5100");
        if (payable?.id && expense?.id) {
          const amount = round2(kase.amount);
          const documentNumber = await BillingService.reserveDocumentNumber(companyId, "payroll");
          await BillingService.postJournalWithBalances(companyId, {
            journalNumber: documentNumber,
            date: new Date(),
            reference: `REV-LATE-DED-${kase.periodKey}-${kase.thresholdId}`,
            notes: `Reversal of lateness deduction ${caseId}: ${note}`,
            currency: kase.currency || "SAR",
            status: "posted",
            sourceType: "payroll",
            sourceId: caseId,
            reversalOfId: kase.journalId,
            postedBy: uid,
            lines: [
              { accountId: payable.id, debit: 0, credit: amount, taxAmount: 0 },
              { accountId: expense.id, debit: amount, credit: 0, taxAmount: 0 },
            ],
            totalDebit: amount,
            totalCredit: amount,
          });
        }
      }

      const nowIso = new Date().toISOString();
      await updateDoc(ref, {
        status: "reversed",
        reversedBy: uid,
        reversedAt: nowIso,
        reversalNote: note,
        updatedAt: nowIso,
      });
      const after = mapCase(ref.id, { ...snap.data(), status: "reversed", reversedBy: uid, reversedAt: nowIso, reversalNote: note, updatedAt: nowIso });
      return { data: after, message: "Case reversed" };
    })());
  },

  /* ------------------------------ reports ---------------------------------- */

  /**
   * Raw material for the month report — the numbers are always re-derived
   * from attendance rows; no stored total is ever trusted.
   */
  async monthlyLatenessReport(
    companyId: string,
    periodKey: string
  ): Promise<
    ApiResponse<
      {
        employeeId: string;
        employeeName: string;
        department: string;
        totalMinutes: number;
        legacyMinutes: number;
        excusedMinutes: number;
        cases: DeductionCase[];
      }[]
    >
  > {
    return withLogging(SERVICE_NAME, "monthlyLatenessReport", (async () => {
      const [empRes, attRes, casesRes] = await Promise.all([
        getDocs(collection(db, "companies", companyId, "employees")),
        getDocs(
          query(
            collection(db, "companies", companyId, "attendance"),
            where("date", ">=", `${periodKey}-01`),
            where("date", "<=", `${periodKey}-31`)
          )
        ),
        getDocs(query(CASES(companyId), where("periodKey", "==", periodKey))),
      ]);
      const casesByEmployee = new Map<string, DeductionCase[]>();
      casesRes.docs.forEach((d) => {
        const c = mapCase(d.id, d.data());
        const list = casesByEmployee.get(c.employeeId) ?? [];
        list.push(c);
        casesByEmployee.set(c.employeeId, list);
      });

      const rows = attRes.docs.map((d) => ({
        id: d.id,
        employeeId: String(d.data().employeeId ?? ""),
        date: String(d.data().date ?? ""),
        status: String(d.data().status ?? "present"),
        lateMinutes: Number(d.data().lateMinutes ?? 0) || 0,
        schedule: (d.data().schedule as {
          rawLateMinutes: number;
          excusedLateMinutes: number;
          countableLateMinutes: number;
        } | null) ?? null,
      }));

      const out = empRes.docs
        .map((d) => {
          const emp = d.data() as Employee;
          const acc = accumulateMonth(
            rows.filter((r) => r.employeeId === d.id),
            d.id,
            periodKey
          );
          return {
            employeeId: d.id,
            employeeName: [emp.firstName, emp.lastName].filter(Boolean).join(" ") || emp.name || d.id,
            department: emp.department || "",
            totalMinutes: acc.totalMinutes,
            legacyMinutes: acc.legacyMinutes,
            excusedMinutes: acc.excusedMinutes,
            cases: casesByEmployee.get(d.id) ?? [],
          };
        })
        .sort((a, b) => b.totalMinutes - a.totalMinutes);

      return { data: out, message: "Success" };
    })());
  },
};

/* -------------------------------------------------------------------------- */
/* Local utilities                                                             */
/* -------------------------------------------------------------------------- */

/** addDoc with the undefined-pruning Firestore requires on every write. */
async function addDocTo(
  collectionName: string,
  companyId: string,
  data: Record<string, unknown>
): Promise<DocumentReference> {
  const pruned = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined)
  );
  return addDoc(collection(db, "companies", companyId, collectionName), pruned);
}
