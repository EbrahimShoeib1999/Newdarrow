import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  Activity,
  ActivityType,
  CreateActivityDTO,
  UpdateActivityDTO,
} from "../types/activities.types";

export interface BackendActivity {
  id: string;
  type: string;
  subject: string;
  description?: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  durationMinutes?: number;
  userId: string;
  createdAt: string;
  updatedAt?: string;
}

export function mapBackendActivityToActivity(b: BackendActivity): Activity {
  return {
    id: b.id,
    type: (b.type?.toLowerCase() as ActivityType) || "note",
    subject: b.subject || "",
    description: b.description || undefined,
    entityType: b.entityType as any,
    entityId: b.entityId,
    occurredAt: b.occurredAt
      ? new Date(b.occurredAt).toISOString()
      : new Date().toISOString(),
    durationMinutes: b.durationMinutes ?? undefined,
    userId: b.userId,
    createdAt: b.createdAt
      ? new Date(b.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

export const ActivitiesService = {
  async getActivities(
    _companyId?: string,
    filters?: { entityType?: string; entityId?: string }
  ): Promise<ApiResponse<Activity[]>> {
    const params: Record<string, string> = {};
    if (filters?.entityType) params.entityType = filters.entityType;
    if (filters?.entityId) params.entityId = filters.entityId;

    const res = await apiClient.get<ApiResponse<BackendActivity[]>>(
      "/crm/activities",
      { params }
    );
    const rawList = res.data?.data ?? [];
    const list = Array.isArray(rawList) ? rawList : [];
    return {
      data: list.map(mapBackendActivityToActivity),
      message: res.data?.message || "Success",
    };
  },

  async getActivityById(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<Activity>> {
    const res = await apiClient.get<ApiResponse<BackendActivity>>(
      `/crm/activities/${id}`
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendActivity);
    return {
      data: mapBackendActivityToActivity(raw),
      message: res.data?.message || "Success",
    };
  },

  async createActivity(
    _companyId: string,
    data: CreateActivityDTO
  ): Promise<ApiResponse<Activity>> {
    const res = await apiClient.post<ApiResponse<BackendActivity>>(
      "/crm/activities",
      data
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendActivity);
    return {
      data: mapBackendActivityToActivity(raw),
      message: res.data?.message || "Activity created successfully",
    };
  },

  async updateActivity(
    _companyId: string,
    id: string,
    data: UpdateActivityDTO
  ): Promise<ApiResponse<Activity>> {
    const res = await apiClient.patch<ApiResponse<BackendActivity>>(
      `/crm/activities/${id}`,
      data
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendActivity);
    return {
      data: mapBackendActivityToActivity(raw),
      message: res.data?.message || "Activity updated successfully",
    };
  },

  async deleteActivity(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const res = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
      `/crm/activities/${id}`
    );
    return {
      data: res.data?.data ?? { removed: true },
      message: res.data?.message || "Activity deleted successfully",
    };
  },
};
