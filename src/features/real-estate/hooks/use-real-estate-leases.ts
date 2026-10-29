/**
 * Real Estate Management — TanStack Query hooks (leasing lifecycle).
 *
 * Status transitions are ONLY triggered through the service methods that
 * re-validate server-side rules (approval permission gates in Firestore
 * mirror the UI gating below); hooks never patch `status` directly.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LeaseService, PaymentService, DepositService } from "../api/rem-leasing.service";
import { useCompany } from "@/features/companies/context/company-context";
import type { CreateLeaseDTO, Lease } from "../types/real-estate.types";

const QUERY_KEY = ["real_estate"] as const;

export function useLease(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease", companyId, id],
    queryFn: async () => (await LeaseService.get(companyId!, id!)).data,
    enabled: !!companyId && !!id,
  });
}

/** Schedule rows for one lease (read projection; collection UI comes later). */
export function useLeaseInstallments(leaseId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease-installments", companyId, leaseId],
    queryFn: async () => (await PaymentService.installmentsForLease(companyId!, leaseId!)).data,
    enabled: !!companyId && !!leaseId,
  });
}

export function useLeasePayments(leaseId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease-payments", companyId, leaseId],
    queryFn: async () => (await PaymentService.listForLease(companyId!, leaseId!)).data,
    enabled: !!companyId && !!leaseId,
  });
}

export function useLeaseDeposit(leaseId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease-deposit", companyId, leaseId],
    queryFn: async () => (await DepositService.get(companyId!, leaseId!)).data,
    enabled: !!companyId && !!leaseId,
  });
}

export function useCreateLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateLeaseDTO) => (await LeaseService.create(companyId!, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useUpdateLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Lease> }) =>
      (await LeaseService.update(companyId!, id, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSubmitLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => (await LeaseService.submitForApproval(companyId!, id)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useActivateLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, by }: { id: string; by: string }) =>
      (await LeaseService.activate(companyId!, id, by)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useTerminateLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, reason, by }: { id: string; reason: string; by: string }) =>
      (await LeaseService.terminate(companyId!, id, reason, by)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useCancelLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      (await LeaseService.cancel(companyId!, id, reason)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useRenewLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      changes: { startDate: string; endDate: string; rentAmount: number; depositAmount?: number };
    }) => (await LeaseService.renew(companyId!, id, changes)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useAmendLeaseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({
      id,
      by,
      summary,
      changes,
    }: {
      id: string;
      by: string;
      summary: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    }) => (await LeaseService.amend(companyId!, id, by, summary, changes)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}
