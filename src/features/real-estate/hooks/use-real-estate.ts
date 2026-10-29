/**
 * Real Estate Management — TanStack Query hooks (core registry).
 *
 * Same contract as the facilities hooks: company-scoped keys, mutations
 * invalidate on success, and acting-user ids come from the auth store
 * (never from a form) so audit entries are trustworthy.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PropertyService,
  BuildingService,
  UnitService,
  OwnershipService,
} from "../api/rem-core.service";
import { LeaseService } from "../api/rem-leasing.service";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import type {
  CreatePropertyDTO,
  UpdatePropertyDTO,
  CreateBuildingDTO,
  UpdateBuildingDTO,
  CreateUnitDTO,
  UpdateUnitDTO,
  CreateOwnershipDTO,
  UpdateOwnershipDTO,
} from "../types/real-estate.types";

const QUERY_KEY = ["real_estate"] as const;

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export function useProperties() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "property-list", companyId],
    queryFn: async () => (await PropertyService.list(companyId!)).data,
    enabled: !!companyId,
  });
}

export function useProperty(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "property", companyId, id],
    queryFn: async () => (await PropertyService.get(companyId!, id!)).data,
    enabled: !!companyId && !!id,
  });
}

export function useCreatePropertyMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreatePropertyDTO) => (await PropertyService.create(companyId!, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "property-list", companyId] });
    },
  });
}

export function useUpdatePropertyMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePropertyDTO }) =>
      (await PropertyService.update(companyId!, id, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSetPropertyArchivedMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await PropertyService.setArchived(companyId!, id, archived)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeletePropertyMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await PropertyService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Buildings (embedded floors)                                                */
/* -------------------------------------------------------------------------- */

export function useBuildings() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "building-list", companyId],
    queryFn: async () => (await BuildingService.listWithUnitCounts(companyId!)).data,
    enabled: !!companyId,
  });
}

export function useBuilding(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "building", companyId, id],
    queryFn: async () => (await BuildingService.get(companyId!, id!)).data,
    enabled: !!companyId && !!id,
  });
}

export function useCreateBuildingMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateBuildingDTO) => (await BuildingService.create(companyId!, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "building-list", companyId] });
    },
  });
}

export function useUpdateBuildingMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateBuildingDTO }) =>
      (await BuildingService.update(companyId!, id, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSetBuildingArchivedMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await BuildingService.setArchived(companyId!, id, archived)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteBuildingMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await BuildingService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

export function useUnits() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "unit-list", companyId],
    queryFn: async () => (await UnitService.list(companyId!)).data,
    enabled: !!companyId,
  });
}

export function useUnit(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "unit", companyId, id],
    queryFn: async () => (await UnitService.get(companyId!, id!)).data,
    enabled: !!companyId && !!id,
  });
}

/** Profile rollups: leases, installments, expenses, inspections, handovers, docs. */
export function useUnitProfile(id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "unit-profile", companyId, id],
    queryFn: async () => (await UnitService.profile(companyId!, id!)).data,
    enabled: !!companyId && !!id,
  });
}

export function useCreateUnitMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateUnitDTO) => (await UnitService.create(companyId!, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "unit-list", companyId] });
    },
  });
}

export function useUpdateUnitMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUnitDTO }) =>
      (await UnitService.update(companyId!, id, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSetMaintenanceHoldMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, hold }: { id: string; hold: boolean }) =>
      (await UnitService.setMaintenanceHold(companyId!, id, hold)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useSetUnitArchivedMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      (await UnitService.setArchived(companyId!, id, archived)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteUnitMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await UnitService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Ownerships                                                                 */
/* -------------------------------------------------------------------------- */

export function useOwnershipsForProperty(propertyId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "ownership-list", companyId, propertyId],
    queryFn: async () => (await OwnershipService.listForProperty(companyId!, propertyId!)).data,
    enabled: !!companyId && !!propertyId,
  });
}

export function useCreateOwnershipMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (data: CreateOwnershipDTO) => (await OwnershipService.create(companyId!, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useUpdateOwnershipMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateOwnershipDTO }) =>
      (await OwnershipService.update(companyId!, id, data)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

export function useDeleteOwnershipMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  return useMutation({
    mutationFn: async (id: string) => {
      await OwnershipService.remove(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
    },
  });
}

/** Acting user id for audit-stamped transitions (never taken from a form). */
export function useRemActor(): string {
  return useAuthStore((s) => s.user?.id) ?? "";
}

/* -------------------------------------------------------------------------- */
/* Leases (read-only rollups here; lifecycle lives in the leasing hooks)      */
/* -------------------------------------------------------------------------- */

export function useLeases() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "lease-list", companyId],
    queryFn: async () => (await LeaseService.list(companyId!)).data,
    enabled: !!companyId,
  });
}
