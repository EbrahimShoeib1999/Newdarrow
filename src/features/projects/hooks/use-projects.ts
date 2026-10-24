import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ProjectService, MilestoneService, UnitService } from "../api/projects.service";
import { useCompany } from "@/features/companies/context/company-context";
import { onUnitStatusChanged } from "@/features/automation/lib/event-automations";
import { useAuthStore } from "@/stores/auth.store";
import type { SavedContract } from "@/features/crm/types/contract.types";
import type {
  CreateProjectDTO,
  UpdateProjectDTO,
  ProjectStatus,
  ProjectMilestone,
} from "../types/projects.types";
import type {
  CreateUnitDTO,
  UpdateUnitDTO,
  UnitStatus,
} from "../types/unit.types";

const QUERY_KEY = ["projects"] as const;

export function useProjects() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "list", companyId],
    queryFn: async () => {
      const res = await ProjectService.getProjects(companyId!);
      return res.data;
    },
    enabled: !!companyId,
  });
}

export function useProject(projectId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "detail", companyId, projectId],
    queryFn: async () => {
      const res = await ProjectService.getProject(companyId!, projectId!);
      return res.data;
    },
    enabled: !!companyId && !!projectId,
  });
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (data: CreateProjectDTO) => {
      const res = await ProjectService.createProjectWithCode(companyId!, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProjectDTO }) => {
      const res = await ProjectService.updateProject(companyId!, id, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/** Validated lifecycle transition with an optional auditable reason. */
export function useTransitionProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: async ({
      id,
      to,
      reason,
    }: {
      id: string;
      to: ProjectStatus;
      reason?: string;
    }) => {
      const res = await ProjectService.transitionStatus(companyId!, id, to, userId ?? "", reason);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/**
 * Contract → project conversion. Idempotent: retrying returns the existing
 * project (alreadyExisted=true) instead of creating a duplicate.
 */
export function useCreateProjectFromContractMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: async ({
      contract,
      overrides,
    }: {
      contract: SavedContract;
      overrides?: Partial<CreateProjectDTO>;
    }) => {
      const res = await ProjectService.createProjectFromContract(
        companyId!,
        contract,
        userId ?? ""
        , overrides
      );
      // Lifecycle chain deal → contract → project → tasks/milestones: a
      // freshly converted project immediately inherits the contract's
      // delivery scope — converted tasks and one milestone per contracted
      // service item. Reused conversions skip this; the link is idempotent
      // anyway, and a hiccup here must never lose the converted project.
      if (res.data && !res.data.alreadyExisted) {
        try {
          await ProjectService.linkContractScopeToProject(
            companyId!,
            res.data.id,
            contract
          );
        } catch (linkErr) {
          console.warn("Contract scope linking failed:", linkErr);
        }
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      // Converted tasks may carry a new projectId after backfill.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (id: string) => {
      await ProjectService.deleteProject(companyId!, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Milestones                                                                 */
/* -------------------------------------------------------------------------- */

export function useMilestones(projectId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "milestones", companyId, projectId],
    queryFn: async () => {
      const res = await MilestoneService.list(companyId!, projectId!);
      return res.data;
    },
    enabled: !!companyId && !!projectId,
  });
}

export function useCreateMilestoneMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (data: Omit<ProjectMilestone, "id" | "createdAt" | "updatedAt">) => {
      const res = await MilestoneService.create(companyId!, projectId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "milestones", companyId, projectId] });
    },
  });
}

export function useUpdateMilestoneMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({
      milestoneId,
      data,
    }: {
      milestoneId: string;
      data: Partial<ProjectMilestone>;
    }) => {
      const res = await MilestoneService.update(companyId!, projectId, milestoneId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "milestones", companyId, projectId] });
    },
  });
}

export function useDeleteMilestoneMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (milestoneId: string) => {
      await MilestoneService.remove(companyId!, projectId, milestoneId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "milestones", companyId, projectId] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Units — real-estate inventory (project-scoped subcollection)               */
/* -------------------------------------------------------------------------- */

export function useUnits(projectId?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "units", companyId, projectId],
    queryFn: async () => {
      const res = await UnitService.list(companyId!, projectId!);
      return res.data;
    },
    enabled: !!companyId && !!projectId,
  });
}

export function useCreateUnitMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (data: CreateUnitDTO) => {
      const res = await UnitService.create(companyId!, projectId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "units", companyId, projectId] });
    },
  });
}

export function useUpdateUnitMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({ unitId, data }: { unitId: string; data: UpdateUnitDTO }) => {
      const res = await UnitService.update(companyId!, projectId, unitId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "units", companyId, projectId] });
    },
  });
}

/** Validated status transition; rejects illegal edges and double commitments. */
export function useChangeUnitStatusMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);

  return useMutation({
    mutationFn: async ({
      unitId,
      to,
      buyerContactId,
      contractId,
      note,
    }: {
      unitId: string;
      to: UnitStatus;
      buyerContactId?: string | null;
      contractId?: string | null;
      note?: string;
    }) => {
      const res = await UnitService.changeStatus(companyId!, projectId, unitId, to, userId ?? "", {
        buyerContactId,
        contractId,
        note,
      });
      // Extract previous status from the history entry the service just stamped
      const unit = res.data;
      const from = unit.statusHistory?.at(-1)?.from ?? to;
      return { unit, from, to };
    },
    onSuccess: ({ unit, from, to }) => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "units", companyId, projectId] });
      // Phase 9B: fire-and-forget automation (B12: notify managers)
      void onUnitStatusChanged(companyId!, unit, from, to);
    },
  });
}

export function useDeleteUnitMutation(projectId: string) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (unitId: string) => {
      await UnitService.remove(companyId!, projectId, unitId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "units", companyId, projectId] });
    },
  });
}
