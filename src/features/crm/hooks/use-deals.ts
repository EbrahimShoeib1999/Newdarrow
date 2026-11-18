import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/constants";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { DealsService } from "../api/deals.service";
import type { CreateDealDTO, UpdateDealDTO } from "../types/deals.types";
import { filterCrmRecordsByAccess } from "../utils/crm-access.utils";
import {
  normalizeDealStage,
  DEAL_STAGE_PROBABILITY,
  normalizeDealProbability,
} from "../constants/deal-workflow";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function useDealsQuery() {
  const { companyId } = useCompany();
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: QUERY_KEYS.crm.deals(companyId!),
    queryFn: async () => {
      const res = await DealsService.getDeals(companyId!);
      const data = filterCrmRecordsByAccess(
        res.data.map((d) => ({ ...d, stage: normalizeDealStage(d.stage) })),
        user
      );
      return { ...res, data };
    },
    enabled: !!companyId,
  });
}

export function useDealQuery(dealId: string) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ["crm", "deal", dealId],
    queryFn: async () => {
      const res = await DealsService.getDealById(companyId!, dealId);
      return {
        ...res,
        data: { ...res.data, stage: normalizeDealStage(res.data.stage) },
      };
    },
    enabled: !!companyId && !!dealId,
  });
}

export function useCreateDealMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateDealDTO) => {
      const payload = {
        ...data,
        probability: normalizeDealProbability(
          data.probability ?? DEAL_STAGE_PROBABILITY[data.stage]
        ),
      };
      return DealsService.createDeal(companyId!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("deals.toast.created", "Deal created successfully"));
    },
    onError: () => toast.error(t("deals.toast.createFailed", "Failed to create deal")),
  });
}

export function useUpdateDealMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateDealDTO }) => {
      return DealsService.updateDeal(companyId!, id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      queryClient.invalidateQueries({ queryKey: ["crm", "deal", id] });
      toast.success(t("deals.toast.updated", "Deal updated successfully"));
    },
    onError: () => toast.error(t("deals.toast.updateFailed", "Failed to update deal")),
  });
}

export function useUpdateDealStageMutation() {
  const update = useUpdateDealMutation();
  return {
    ...update,
    mutate: ({ id, stage }: { id: string; stage: UpdateDealDTO["stage"] }) =>
      update.mutate({
        id,
        data: {
          stage,
          probability: stage ? DEAL_STAGE_PROBABILITY[stage] : undefined,
        },
      }),
    mutateAsync: ({ id, stage }: { id: string; stage: UpdateDealDTO["stage"] }) =>
      update.mutateAsync({
        id,
        data: {
          stage,
          probability: stage ? DEAL_STAGE_PROBABILITY[stage] : undefined,
        },
      }),
  };
}

export function useDeleteDealMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return DealsService.deleteDeal(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("deals.toast.deleted", "Deal deleted successfully"));
    },
    onError: () => toast.error(t("deals.toast.deleteFailed", "Failed to delete deal")),
  });
}
