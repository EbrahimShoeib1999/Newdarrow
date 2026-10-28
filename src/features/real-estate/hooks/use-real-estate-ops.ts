/**
 * Real Estate Management — TanStack Query hooks (operations: expenses,
 * inspections, handovers, documents, meter readings, reminders).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  InspectionService,
  HandoverService,
  ExpenseService,
  DocumentService,
  MeterReadingService,
  generateReminders,
} from "../api/rem-ops.service";
import { useCompany } from "@/features/companies/context/company-context";
import type {
  CreateInspectionDTO,
  CreatePropertyExpenseDTO,
  HandoverRecord,
  Inspection,
  Lease,
  Property,
  PropertyExpense,
  RentInstallment,
  RemDocument,
  RemEntityType,
  Unit,
} from "../types/real-estate.types";
import type { MeterReading } from "../api/rem-ops.service";

const QUERY_KEY = ["real_estate"] as const;

function useOpsMutation<TData, TVars>(fn: (companyId: string, vars: TVars) => Promise<TData>) {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(companyId!, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export function useExpenses() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "expenses", companyId],
    queryFn: async () => (await ExpenseService.list(companyId!)).data,
    enabled: !!companyId,
  });
}

export function useCreateExpenseMutation() {
  return useOpsMutation((companyId, vars: { dto: CreatePropertyExpenseDTO; by: string; canApprove: boolean }) =>
    ExpenseService.create(companyId, vars.dto, vars.by, vars.canApprove)
  );
}

export function useUpdateExpenseMutation() {
  return useOpsMutation(
    (companyId, vars: { id: string; dto: Partial<PropertyExpense>; by: string; canApprove: boolean }) =>
      ExpenseService.update(companyId, vars.id, vars.dto, vars.by, vars.canApprove)
  );
}

export function useDeleteExpenseMutation() {
  return useOpsMutation((companyId, id: string) => ExpenseService.remove(companyId, id));
}

/* ------------------------------------------------------------------ */
/* Inspections                                                         */
/* ------------------------------------------------------------------ */

export function useInspections() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "inspections", companyId],
    queryFn: async () => (await InspectionService.list(companyId!)).data,
    enabled: !!companyId,
  });
}

export function useCreateInspectionMutation() {
  return useOpsMutation((companyId, vars: { dto: CreateInspectionDTO; by: string }) =>
    InspectionService.create(companyId, vars.dto, vars.by)
  );
}

export function useUpdateInspectionMutation() {
  return useOpsMutation((companyId, vars: { id: string; dto: Partial<Inspection> }) =>
    InspectionService.update(companyId, vars.id, vars.dto)
  );
}

export function useFinalizeInspectionMutation() {
  return useOpsMutation((companyId, id: string) => InspectionService.finalize(companyId, id));
}

/** Immutable-after-finalize corrections: creates the superseding version. */
export function useInspectionVersionMutation() {
  return useOpsMutation((companyId, vars: { id: string; by: string }) =>
    InspectionService.createVersion(companyId, vars.id, {}, vars.by)
  );
}

export function useWorkOrderForIssueMutation() {
  return useOpsMutation(
    (companyId, vars: { inspectionId: string; issueId: string; requestedBy: string; facilityId?: string | null }) =>
      InspectionService.createWorkOrderForIssue(companyId, vars.inspectionId, vars.issueId, vars.requestedBy, vars.facilityId)
  );
}

/* ------------------------------------------------------------------ */
/* Handovers                                                           */
/* ------------------------------------------------------------------ */

export function useLeaseHandovers(leaseId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease-handovers", companyId, leaseId],
    queryFn: async () => (await HandoverService.listForLease(companyId!, leaseId!)).data,
    enabled: !!companyId && !!leaseId,
  });
}

export function useCreateHandoverMutation() {
  return useOpsMutation(
    (
      companyId,
      vars: {
        dto: Omit<HandoverRecord, "id" | "createdAt" | "updatedAt" | "completed" | "followUpWorkOrderIds" | "createdBy">;
        by: string;
      }
    ) => HandoverService.create(companyId, vars.dto, vars.by)
  );
}

export function useCompleteHandoverMutation() {
  return useOpsMutation((companyId, vars: { id: string; by: string }) => HandoverService.complete(companyId, vars.id, vars.by));
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export function useEntityDocuments(entityType: RemEntityType, entityId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "documents", companyId, entityType, entityId],
    queryFn: async () => (await DocumentService.listFor(companyId!, entityType, entityId!)).data,
    enabled: !!companyId && !!entityId,
  });
}

export function useUploadDocumentMutation() {
  return useOpsMutation(
    (companyId, vars: { input: { entityType: RemEntityType; entityId: string; kind: string; file: File; sensitive?: boolean }; by: string }) =>
      DocumentService.upload(companyId, vars.input, vars.by)
  );
}

export function useDeleteDocumentMutation() {
  return useOpsMutation((companyId, id: string) => DocumentService.remove(companyId, id));
}

export type { RemDocument, MeterReading };

/* ------------------------------------------------------------------ */
/* Meter readings (append-only)                                        */
/* ------------------------------------------------------------------ */

export function useMeterReadings(unitId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "meter-readings", companyId, unitId],
    queryFn: async () => (await MeterReadingService.listForUnit(companyId!, unitId!)).data,
    enabled: !!companyId && !!unitId,
  });
}

export function useAddMeterReadingMutation() {
  return useOpsMutation(
    (companyId, vars: { input: Omit<MeterReading, "id" | "createdAt" | "updatedAt">; by: string }) =>
      MeterReadingService.add(companyId, vars.input, vars.by)
  );
}

/* ------------------------------------------------------------------ */
/* Reminders (idempotent, on-demand)                                   */
/* ------------------------------------------------------------------ */

export function useGenerateRemindersMutation() {
  return useOpsMutation(
    (
      companyId,
      vars: {
        leases: Lease[];
        installments: RentInstallment[];
        properties: Property[];
        units: Unit[];
        recipients: string[];
      }
    ) => generateReminders(companyId, vars)
  );
}
