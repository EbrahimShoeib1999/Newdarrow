/**
 * Facilities Management — TanStack Query hooks.
 *
 * Same contract as the projects hooks: company-scoped keys, mutations
 * invalidate on success, transitions pass the acting user id from the auth
 * store (never from a form) so the audit history entry is trustworthy.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FacilityService,
  AssetService,
  WorkOrderService,
  ScheduleService,
  VendorService,
} from "../api/facilities.service";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import type {
  CreateFacilityDTO,
  UpdateFacilityDTO,
  CreateAssetDTO,
  UpdateAssetDTO,
  CreateWorkOrderDTO,
  UpdateWorkOrderDTO,
  WorkOrderStatus,
  CreatePmScheduleDTO,
  UpdatePmScheduleDTO,
  CreateVendorDTO,
  UpdateVendorDTO,
} from "../types/facilities.types";

const QUERY_KEY = ["facilities"] as const;

/* -------------------------------------------------------------------------- */
/* Facilities                                                                 */
/* -------------------------------------------------------------------------- */

export function useFacilities() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "facility-list", companyId],
    queryFn: async () => {
      const res = await FacilityService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useFacility(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "facility", companyId, id],
    queryFn: async () => {
      const res = await FacilityService.get(companyId!, id!);
      return res.data;
    },
    enabled: !!companyId && !!id,
  });
}

export function useCreateFacilityMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateFacilityDTO) => {
      const res = await FacilityService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "facility-list", companyId] });
    },
  });
}

export function useUpdateFacilityMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFacilityDTO }) => {
      const res = await FacilityService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteFacilityMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await FacilityService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

export function useAssets() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "asset-list", companyId],
    queryFn: async () => {
      const res = await AssetService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useAsset(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "asset", companyId, id],
    queryFn: async () => {
      const res = await AssetService.get(companyId!, id!);
      return res.data;
    },
    enabled: !!companyId && !!id,
  });
}

export function useCreateAssetMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateAssetDTO) => {
      const res = await AssetService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "asset-list", companyId] });
    },
  });
}

export function useUpdateAssetMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAssetDTO }) => {
      const res = await AssetService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteAssetMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await AssetService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Work orders                                                                */
/* -------------------------------------------------------------------------- */

export function useWorkOrders() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "wo-list", companyId],
    queryFn: async () => {
      const res = await WorkOrderService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useWorkOrder(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "wo", companyId, id],
    queryFn: async () => {
      const res = await WorkOrderService.get(companyId!, id!);
      return res.data;
    },
    enabled: !!companyId && !!id,
  });
}

export function useCreateWorkOrderMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async (data: Omit<CreateWorkOrderDTO, "requestedBy">) => {
      const res = await WorkOrderService.create(companyId!, {
        ...data,
        requestedBy: userId ?? "",
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "wo-list", companyId] });
    },
  });
}

/** Descriptive fields & costs only — status is moved by the transition hook. */
export function useUpdateWorkOrderMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateWorkOrderDTO }) => {
      const res = await WorkOrderService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/** The only legal status path; server re-validates the edge and stamps history. */
export function useTransitionWorkOrderMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async ({
      id,
      to,
      note,
      partsCost,
      laborCost,
    }: {
      id: string;
      to: WorkOrderStatus;
      note?: string;
      partsCost?: number;
      laborCost?: number;
    }) => {
      const res = await WorkOrderService.transition(companyId!, id, to, userId ?? "", {
        note,
        partsCost,
        laborCost,
      });
      return res.data;
    },
    onSuccess: () => {
      // Completion may roll a linked schedule → refresh schedules too.
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteWorkOrderMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await WorkOrderService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Preventive-maintenance schedules                                            */
/* -------------------------------------------------------------------------- */

export function usePmSchedules() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "schedule-list", companyId],
    queryFn: async () => {
      const res = await ScheduleService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateScheduleMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreatePmScheduleDTO) => {
      const res = await ScheduleService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "schedule-list", companyId] });
    },
  });
}

export function useUpdateScheduleMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePmScheduleDTO }) => {
      const res = await ScheduleService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteScheduleMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await ScheduleService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/** Idempotent per business day — double-clicks do not duplicate orders. */
export function useGenerateWorkOrderMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  return useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await ScheduleService.generateWorkOrder(companyId!, scheduleId, userId ?? "");
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Vendors                                                                    */
/* -------------------------------------------------------------------------- */

export function useVendors() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "vendor-list", companyId],
    queryFn: async () => {
      const res = await VendorService.list(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useCreateVendorMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateVendorDTO) => {
      const res = await VendorService.create(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "vendor-list", companyId] });
    },
  });
}

export function useUpdateVendorMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateVendorDTO }) => {
      const res = await VendorService.update(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteVendorMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await VendorService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}
