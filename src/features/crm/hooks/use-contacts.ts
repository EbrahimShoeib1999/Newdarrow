import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/constants";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { ContactsService } from "../api/contacts.service";
import type { CreateContactDTO, UpdateContactDTO } from "../types/contacts.types";
import { filterCrmRecordsByAccess } from "../utils/crm-access.utils";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function useContactsQuery() {
  const { companyId } = useCompany();
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: QUERY_KEYS.crm.contacts(companyId!),
    queryFn: async () => {
      const res = await ContactsService.getContacts(companyId!);
      return { ...res, data: filterCrmRecordsByAccess(res.data, user) };
    },
    enabled: !!companyId,
  });
}

export function useContactQuery(contactId: string) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: ["crm", "contact", contactId],
    queryFn: () => ContactsService.getContactById(companyId!, contactId),
    enabled: !!companyId && !!contactId,
  });
}

export function useCreateContactMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateContactDTO) => {
      return ContactsService.createContact(companyId!, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("contacts.toast.created"));
    },
    onError: () => toast.error(t("contacts.toast.createFailed")),
  });
}

export function useUpdateContactMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateContactDTO }) => {
      return ContactsService.updateContact(companyId!, id, data);
    },
    onSuccess: () => {
      toast.success(t("contacts.toast.updated"));
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
    },
    onError: () => toast.error(t("contacts.toast.updateFailed")),
  });
}

export function useDeleteContactMutation() {
  const { t } = useTranslation("crm");
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await ContactsService.deleteContact(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.crm.all });
      toast.success(t("contacts.toast.deleted", { defaultValue: "Contact deleted successfully" }));
    },
    onError: () => toast.error(t("contacts.toast.deleteFailed", { defaultValue: "Failed to delete contact" })),
  });
}
