/**
 * Custom Business Modules Engine — TanStack Query hooks.
 *
 * Same contract as the facilities/projects hooks: company-scoped keys,
 * mutations invalidate on success, the acting user id comes from the auth
 * store (never a form), and the tenant's authoritative activity gates which
 * definitions are even fetched — a definition bound to another activity can
 * never render data here, mirroring the Firestore prefix gate.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";
import {
  DefinitionService,
  RecordService,
  fetchRelationLabelMaps,
  listRelationOptions,
} from "../api/custom-modules.service";
import {
  canPerformModuleAction,
  moduleVisibleTo,
  queryRecords,
  type ModuleListQuery,
} from "../lib/module-engine";
import type {
  CustomModuleDefinition,
  ModuleRecord,
} from "../types/custom-module.types";

const QUERY_KEY = ["customModules"] as const;

/* -------------------------------------------------------------------------- */
/* Definitions                                                                 */
/* -------------------------------------------------------------------------- */

/** Every definition of the tenant (config UI needs drafts/archived too). */
export function useModuleDefinitions() {
  const { companyId, isLoading: companyLoading } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "definitions", companyId],
    queryFn: async () => (await DefinitionService.list(companyId!)).data ?? [],
    enabled: !!companyId && !companyLoading,
    staleTime: 30_000,
  });
}

/** One definition by key (record pages + the config editor). */
export function useModuleDefinition(key?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "definition", companyId, key],
    queryFn: async () => (await DefinitionService.get(companyId!, key!)).data,
    enabled: !!companyId && !!key,
    staleTime: 30_000,
  });
}

/**
 * Active modules of the CURRENT activity this user may at least view. The
 * activity filter is not cosmetic: records live in activity-prefixed
 * collections the rules deny for other activities, so hiding them in the
 * workspace mirrors the security boundary instead of widening it.
 */
export function useVisibleModules() {
  const activityConfig = useActivityConfig();
  const { role, can } = useAppPermissions();
  const { data: definitions = [], isLoading, isError } = useModuleDefinitions();
  const activity = activityConfig.status === "ready" ? activityConfig.activity : null;
  const modules = definitions.filter(
    (def) =>
      def.activity === activity &&
      moduleVisibleTo(def, role, (p) => can(p)),
  );
  return { modules, isLoading: isLoading || activityConfig.isConfigLoading, isError };
}

/* -------------------------------------------------------------------------- */
/* Access resolution per module                                                */
/* -------------------------------------------------------------------------- */

export function useModuleAccess(def: CustomModuleDefinition | null | undefined) {
  const { role, can, isAdmin } = useAppPermissions();
  const checker = (permission: Parameters<typeof can>[0]) => can(permission);
  if (!def) {
    return {
      canView: false,
      canCreate: false,
      canUpdate: false,
      canArchive: false,
      canManageConfig: isAdmin && can("custom_modules.manage_config"),
      canDelete: false,
    };
  }
  return {
    canView: canPerformModuleAction(def, "view", role, checker),
    canCreate: canPerformModuleAction(def, "create", role, checker),
    canUpdate: canPerformModuleAction(def, "update", role, checker),
    canArchive: canPerformModuleAction(def, "archive", role, checker),
    canManageConfig: isAdmin && can("custom_modules.manage_config"),
    // Permanent removal additionally requires the per-module opt-in flag.
    canDelete: def.allowPermanentDelete && isAdmin && can("custom_modules.archive"),
  };
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

/** All records of one module plus resolved relation labels for rendering. */
export function useModuleRecords(def: CustomModuleDefinition | null | undefined) {
  const { companyId } = useCompany();
  const { data: definitions = [] } = useModuleDefinitions();
  return useQuery({
    queryKey: [...QUERY_KEY, "records", companyId, def?.activity, def?.key],
    queryFn: async () => {
      const records = (await RecordService.list(companyId!, def!)).data ?? [];
      const relationLabels = await fetchRelationLabelMaps(companyId!, def!, records, definitions);
      return { records, relationLabels };
    },
    enabled: !!companyId && !!def && def.lifecycle === "active",
  });
}

/** Client-side list view (search/sort/filter/paginate) over the fetched rows. */
export function useQueryModuleRecords(
  def: CustomModuleDefinition | null | undefined,
  data: { records: ModuleRecord[]; relationLabels: Record<string, Record<string, string>> } | undefined,
  q: ModuleListQuery,
) {
  const records = data?.records ?? [];
  const result = def ? queryRecords(def, records, q, flattenLabels(data?.relationLabels)) : { rows: [] as ModuleRecord[], total: 0, pages: 1, page: 1 };
  return { ...result, allRecords: records };
}

/** The engine searches relation cells by label, so merge every field map. */
function flattenLabels(
  maps: Record<string, Record<string, string>> | undefined,
): Record<string, string> {
  if (!maps) return {};
  const out: Record<string, string> = {};
  for (const byId of Object.values(maps)) Object.assign(out, byId);
  return out;
}

export function useModuleRecord(def: CustomModuleDefinition | null | undefined, id?: string | null) {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "record", companyId, def?.key, id],
    queryFn: async () => (await RecordService.get(companyId!, def!, id!)).data,
    enabled: !!companyId && !!def && !!id,
  });
}

/* -------------------------------------------------------------------------- */
/* Definition mutations                                                        */
/* -------------------------------------------------------------------------- */

function useDefinitionWriter() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const uid = useAuthStore((s) => s.user?.id) ?? "";
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [...QUERY_KEY] });
  };
  return { companyId, uid, invalidate };
}

export function useCreateDefinitionMutation() {
  const { companyId, uid, invalidate } = useDefinitionWriter();
  const activityConfig = useActivityConfig();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      if (activityConfig.status !== "ready") throw new Error("activity_unresolved");
      const res = await DefinitionService.create(companyId!, activityConfig.activity, input, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateDefinitionMutation() {
  const { companyId, uid, invalidate } = useDefinitionWriter();
  return useMutation({
    mutationFn: async ({ key, input, expectedRevision }: { key: string; input: Record<string, unknown>; expectedRevision: number }) => {
      const res = await DefinitionService.update(companyId!, key, input, expectedRevision, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useModuleLifecycleMutation() {
  const { companyId, uid, invalidate } = useDefinitionWriter();
  return useMutation({
    mutationFn: async ({ key, lifecycle, expectedRevision }: { key: string; lifecycle: "draft" | "active" | "archived"; expectedRevision: number }) => {
      const res = await DefinitionService.setLifecycle(companyId!, key, lifecycle, expectedRevision, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------------- */
/* Record mutations                                                            */
/* -------------------------------------------------------------------------- */

function useRecordWriter(def: CustomModuleDefinition | null | undefined) {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();
  const uid = useAuthStore((s) => s.user?.id) ?? "";
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "records", companyId, def?.activity, def?.key] });
    queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "record", companyId, def?.key] });
  };
  return { companyId, uid, def, invalidate };
}

export function useCreateRecordMutation(def: CustomModuleDefinition | null | undefined) {
  const { companyId, uid, invalidate } = useRecordWriter(def);
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (!def) throw new Error("module_unavailable");
      const res = await RecordService.create(companyId!, def, payload, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRecordMutation(def: CustomModuleDefinition | null | undefined) {
  const { companyId, uid, invalidate } = useRecordWriter(def);
  return useMutation({
    mutationFn: async ({ id, payload, expectedRevision }: { id: string; payload: Record<string, unknown>; expectedRevision: number }) => {
      if (!def) throw new Error("module_unavailable");
      const res = await RecordService.update(companyId!, def, id, payload, expectedRevision, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveRecordMutation(def: CustomModuleDefinition | null | undefined) {
  const { companyId, uid, invalidate } = useRecordWriter(def);
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      if (!def) throw new Error("module_unavailable");
      const res = await RecordService.setArchived(companyId!, def, id, archived, uid);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteRecordMutation(def: CustomModuleDefinition | null | undefined) {
  const { companyId, invalidate } = useRecordWriter(def);
  return useMutation({
    mutationFn: async (id: string) => {
      if (!def) throw new Error("module_unavailable");
      await RecordService.removePermanent(companyId!, def, id);
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------------- */
/* Relation picker options                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Candidate targets for one relation field on the form. Definitions are read
 * from the shared cache (not refetched) because a module→module relation must
 * resolve the TARGET module's collection through its own definition.
 */
export function useRelationOptions(
  field: { key: string; type: string; relation?: { target: string; moduleKey?: string } } | null,
) {
  const { companyId } = useCompany();
  const { data: definitions = [] } = useModuleDefinitions();
  return useQuery({
    queryKey: [...QUERY_KEY, "relationOptions", companyId, field?.relation?.target, field?.relation?.moduleKey],
    queryFn: async () => listRelationOptions(companyId!, field!, definitions),
    enabled: !!companyId && !!field && field.type === "relation" && !!field.relation,
    staleTime: 60_000,
  });
}
