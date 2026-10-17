import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/features/companies/context/company-context";
import {
  ContactClassificationService,
  DEFAULT_CLASSIFICATIONS,
} from "../api/contact-classification.service";
import type {
  ContactClassificationItem,
  CreateClassificationDTO,
  UpdateClassificationDTO,
} from "../types/classification.types";
import { toast } from "sonner";

export function useContactClassifications() {
  const { companyId } = useCompany();

  const query = useQuery({
    queryKey: ["contact_classifications", companyId],
    queryFn: async () => {
      if (!companyId) return DEFAULT_CLASSIFICATIONS;
      const res = await ContactClassificationService.getClassifications(companyId);
      return res.data ?? DEFAULT_CLASSIFICATIONS;
    },
    staleTime: 5 * 60 * 1000,
  });

  const classifications: ContactClassificationItem[] = query.data ?? DEFAULT_CLASSIFICATIONS;

  const activeClassifications = useMemo(
    () => classifications.filter((c) => c.isActive !== false && !c.isArchived),
    [classifications]
  );

  const classificationsMap = useMemo(() => {
    const map: Record<string, ContactClassificationItem> = {};
    for (const item of classifications) {
      map[item.key] = item;
    }
    return map;
  }, [classifications]);

  return {
    ...query,
    classifications,
    activeClassifications,
    classificationsMap,
  };
}

export function useCreateClassificationMutation() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateClassificationDTO) => {
      if (!companyId) throw new Error("No company selected");
      return await ContactClassificationService.createClassification(companyId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["contact_classifications", companyId],
      });
      toast.success("Classification saved successfully");
    },
    onError: () => {
      toast.error("Failed to save classification");
    },
  });
}

export function useUpdateClassificationMutation() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateClassificationDTO }) => {
      if (!companyId) throw new Error("No company selected");
      return await ContactClassificationService.updateClassification(companyId, id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["contact_classifications", companyId],
      });
      toast.success("Classification updated");
    },
    onError: () => {
      toast.error("Failed to update classification");
    },
  });
}

export function useDeleteClassificationMutation() {
  const { companyId } = useCompany();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!companyId) throw new Error("No company selected");
      return await ContactClassificationService.deleteClassification(companyId, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["contact_classifications", companyId],
      });
      toast.success("Classification removed");
    },
    onError: () => {
      toast.error("Failed to delete classification");
    },
  });
}
