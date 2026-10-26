/**
 * Activity configuration state — the app's single authoritative read of the
 * tenant's primary business activity.
 *
 * Sources of truth discipline:
 * - The value is resolved from the Firestore company profile (same cached
 *   query the settings page uses), never from localStorage or the rendered
 *   navigation. A refresh, a new tab or an expired-then-restored session
 *   re-reads it.
 * - While auth/company/query state is unresolved the status stays "loading",
 *   so guards render loaders instead of flashing protected content.
 * - Multi-user updates propagate through React Query invalidation plus the
 *   short staleTime/window-focus refetch: when an admin saves a new activity,
 *   every activity-scoped cache is invalidated and each client re-resolves
 *   its route registry on the next render.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/features/companies/context/company-context";
import { CompanyService } from "@/features/companies/api/company.service";
import { QUERY_KEYS } from "@/lib/constants";
import {
  resolveStoredActivity,
  type ActivityId,
} from "../types/activity.types";
import type { ActivityConfigState } from "@/lib/activity-routes";

export type ActivityConfig = ActivityConfigState & {
  /** Convenience: the resolved activity, or the default while not ready. */
  activityOrFallback: ActivityId;
  isConfigLoading: boolean;
  refetch: () => void;
};

export function useActivityConfig(): ActivityConfig {
  const { companyId, isLoading: companyLoading } = useCompany();
  const { data, isPending, isError, refetch } = useQuery({
    // Shares the company-profile cache — resolving the activity never adds a
    // second fetch on top of what the shell already loads.
    queryKey: QUERY_KEYS.company.profile(companyId ?? ""),
    queryFn: () => CompanyService.getProfile(companyId!),
    enabled: !!companyId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  // No signed-in company: nothing to resolve. Guards sit behind ProtectedRoute,
  // so "ready + default" keeps the pure decision functions total.
  if (!companyLoading && !companyId) {
    return {
      status: "ready",
      activity: resolveStoredActivity(undefined),
      activityOrFallback: resolveStoredActivity(undefined),
      isConfigLoading: false,
      refetch: () => undefined,
    };
  }

  if (isError) {
    return {
      status: "error",
      activityOrFallback: resolveStoredActivity(undefined),
      isConfigLoading: false,
      refetch: () => void refetch(),
    };
  }

  if (companyLoading || isPending || !data) {
    return {
      status: "loading",
      activityOrFallback: resolveStoredActivity(undefined),
      isConfigLoading: true,
      refetch: () => void refetch(),
    };
  }

  const activity = resolveStoredActivity(data.data?.primaryActivity);
  return {
    status: "ready",
    activity,
    activityOrFallback: activity,
    isConfigLoading: false,
    refetch: () => void refetch(),
  };
}

/**
 * Persist a new primary activity for the tenant (authorized admins only —
 * enforced by the `company.manage` UI gate and by the Firestore rules, which
 * reject unknown ids and non-admin changes of this field).
 *
 * Switching only re-points the experience: no record is deleted, converted or
 * rewritten. Everything cached under the previous activity is invalidated so
 * stale domain data cannot remain visible.
 */
export function useUpdatePrimaryActivityMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async (activity: ActivityId) => {
      if (!companyId) throw new Error("No active company");
      return CompanyService.updateProfile(companyId, { primaryActivity: activity });
    },
    onSuccess: (_res, activity) => {
      if (companyId) {
        // Seed the authoritative cache immediately, then invalidate every
        // activity-scoped query so no stale data from the previous activity
        // stays visible anywhere in the app.
        queryClient.setQueryData(
          QUERY_KEYS.company.profile(companyId),
          (old: Awaited<ReturnType<typeof CompanyService.getProfile>> | undefined) =>
            old ? { ...old, data: { ...old.data, primaryActivity: activity } } : old,
        );
      }
      queryClient.invalidateQueries();
    },
  });
}
