import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/constants";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { LeadsService } from "../api/leads.service";
import type { CreateLeadDTO, UpdateLeadDTO } from "../types/leads.types";
import { filterCrmRecordsByAccess } from "../utils/crm-access.utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function useLeadsQuery() {
  const { companyId } = useCompany();
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: QUERY_KEYS.crm.leads(companyId!),
    queryFn: async () => {
      const res = await LeadsService.getLeads(companyId!);
      return { ...res, data: filterCrmRecordsByAccess(res.data, user) };
    },
    enabled: !!companyId,
  });
}

export function useLeadQuery(leadId: string) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: QUERY_KEYS.crm.lead(leadId),
    queryFn: () => LeadsService.getLeadById(companyId!, leadId),
    enabled: !!companyId && !!leadId,
  });
}

export function useCreateLeadMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLeadDTO) => {
      return LeadsService.createLead(companyId!, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("leads.toast.created"));
    },
    onError: () => toast.error(t("leads.toast.createFailed")),
  });
}

export function useUpdateLeadMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLeadDTO }) => {
      return LeadsService.updateLead(companyId!, id, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.lead(id) });
      toast.success(t("leads.toast.updated"));
    },
    onError: () => toast.error(t("leads.toast.updateFailed")),
  });
}

export function useDeleteLeadMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await LeadsService.deleteLead(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("leads.toast.deleted", { defaultValue: "Lead deleted successfully" }));
    },
    onError: () => toast.error(t("leads.toast.deleteFailed", { defaultValue: "Failed to delete lead" })),
  });
}
