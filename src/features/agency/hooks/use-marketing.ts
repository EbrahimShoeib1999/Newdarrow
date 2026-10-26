/**
 * Marketing Agency — TanStack Query hooks.
 *
 * Same contract as the facilities hooks: company-scoped keys, mutations
 * invalidate on success, transitions pass the acting user id from the auth
 * store (never from a form) so the audit history entry is trustworthy.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CampaignService,
  ExpenseService,
  DeliverableService,
  BriefService,
  ContentService,
} from "../api/marketing.service";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import type {
  CampaignStatus,
  ClientApprovalState,
  ContentStatus,
  CreateCampaignDTO,
  CreateCampaignExpenseDTO,
  CreateContentItemDTO,
  CreateCreativeBriefDTO,
  CreateDeliverableDTO,
  DeliverableStatus,
  UpdateCampaignDTO,
  UpdateCampaignExpenseDTO,
  UpdateContentItemDTO,
  UpdateCreativeBriefDTO,
  UpdateDeliverableDTO,
} from "../types/marketing.types";

const QUERY_KEY = ["marketing"] as const;

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

export function useCampaigns() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "campaign-list", companyId],
    queryFn: async () => {
      const res = await CampaignService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCampaign(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "campaign", companyId, id],
    queryFn: async () => {
      const res = await CampaignService.get(companyId!, id!);
      return res.data;
    },
    enabled: !!companyId && !!id,
  });
}

export function useCreateCampaignMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateCampaignDTO) => {
      const res = await CampaignService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useUpdateCampaignMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCampaignDTO }) => {
      const res = await CampaignService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useTransitionCampaignMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, to, note }: { id: string; to: CampaignStatus; note?: string }) => {
      const res = await CampaignService.transition(companyId!, id, to, userId ?? "", { note });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useProposeRevisionMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, newAmount, reason }: { id: string; newAmount: number; reason: string }) => {
      const res = await CampaignService.proposeBudgetRevision(companyId!, id, { newAmount, reason }, userId ?? "");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDecideRevisionMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, revisionId, approve }: { id: string; revisionId: string; approve: boolean }) => {
      const res = await CampaignService.decideBudgetRevision(companyId!, id, revisionId, approve, userId ?? "");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteCampaignMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await CampaignService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/** Billing integration — links an existing invoice; amounts stay in billing. */
export function useLinkInvoiceMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ invoiceId, campaignId }: { invoiceId: string; campaignId: string }) => {
      const res = await CampaignService.linkInvoice(companyId!, invoiceId, campaignId);
      return res.message;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing", "invoices"] });
    },
  });
}

/** Removes the campaign reference from a linked invoice (amounts stay in billing). */
export function useUnlinkInvoiceMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await CampaignService.unlinkInvoice(companyId!, invoiceId);
      return res.message;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["billing", "invoices"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Expenses (actual campaign spend)                                           */
/* -------------------------------------------------------------------------- */

export function useExpenses() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "expense-list", companyId],
    queryFn: async () => {
      const res = await ExpenseService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateExpenseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateCampaignExpenseDTO) => {
      const res = await ExpenseService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "expense-list"] });
    },
  });
}

export function useUpdateExpenseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCampaignExpenseDTO }) => {
      const res = await ExpenseService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "expense-list"] });
    },
  });
}

export function useDeleteExpenseMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await ExpenseService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "expense-list"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Deliverables                                                               */
/* -------------------------------------------------------------------------- */

export function useDeliverables() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "deliverable-list", companyId],
    queryFn: async () => {
      const res = await DeliverableService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useDeliverable(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "deliverable", companyId, id],
    queryFn: async () => {
      const res = await DeliverableService.get(companyId!, id!);
      return res.data;
    },
    enabled: !!companyId && !!id,
  });
}

export function useCreateDeliverableMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateDeliverableDTO) => {
      const res = await DeliverableService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "deliverable-list"] });
    },
  });
}

export function useTransitionDeliverableMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, to, note }: { id: string; to: DeliverableStatus; note?: string }) => {
      const res = await DeliverableService.transition(companyId!, id, to, userId ?? "", note);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSetClientApprovalMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, to, note }: { id: string; to: ClientApprovalState; note?: string }) => {
      const res = await DeliverableService.setClientApproval(companyId!, id, to, userId ?? "", note);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useUpdateDeliverableMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateDeliverableDTO }) => {
      const res = await DeliverableService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "deliverable-list"] });
    },
  });
}

export function useDeleteDeliverableMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await DeliverableService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "deliverable-list"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Creative briefs                                                            */
/* -------------------------------------------------------------------------- */

export function useBriefs() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "brief-list", companyId],
    queryFn: async () => {
      const res = await BriefService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateBriefMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async (data: Omit<CreateCreativeBriefDTO, "createdBy">) => {
      const res = await BriefService.create(companyId!, { ...data, createdBy: userId ?? "" });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "brief-list"] });
    },
  });
}

export function useUpdateBriefMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCreativeBriefDTO }) => {
      const res = await BriefService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "brief-list"] });
    },
  });
}

export function useDeleteBriefMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await BriefService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "brief-list"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Content calendar                                                           */
/* -------------------------------------------------------------------------- */

export function useContentItems() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "content-list", companyId],
    queryFn: async () => {
      const res = await ContentService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateContentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateContentItemDTO) => {
      const res = await ContentService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "content-list"] });
    },
  });
}

export function useTransitionContentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({ id, to }: { id: string; to: ContentStatus }) => {
      const res = await ContentService.transition(companyId!, id, to, userId ?? "");
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "content-list"] });
    },
  });
}

export function useUpdateContentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateContentItemDTO }) => {
      const res = await ContentService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "content-list"] });
    },
  });
}

export function useDeleteContentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await ContentService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "content-list"] });
    },
  });
}
