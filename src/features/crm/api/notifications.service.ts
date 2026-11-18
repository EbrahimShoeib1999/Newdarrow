import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  CrmNotification,
  CrmNotificationType,
  CreateNotificationDTO,
  UpdateNotificationDTO,
} from "../types/notifications.types";

export interface BackendNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  read: boolean;
  createdAt: string;
  updatedAt?: string;
}

export function mapBackendNotificationToNotification(
  b: BackendNotification
): CrmNotification {
  return {
    id: b.id,
    userId: b.userId,
    type: (b.type?.toLowerCase() as CrmNotificationType) || "general",
    title: b.title || "",
    body: b.body || "",
    entityType: (b.entityType as any) ?? undefined,
    entityId: b.entityId ?? undefined,
    read: Boolean(b.read),
    createdAt: b.createdAt
      ? new Date(b.createdAt).toISOString()
      : new Date().toISOString(),
  };
}

export const CrmNotificationsService = {
  async getNotifications(
    _companyId?: string
  ): Promise<ApiResponse<CrmNotification[]>> {
    const res = await apiClient.get<ApiResponse<BackendNotification[]>>(
      "/crm/notifications"
    );
    const rawList = res.data?.data ?? [];
    const list = Array.isArray(rawList) ? rawList : [];
    return {
      data: list.map(mapBackendNotificationToNotification),
      message: res.data?.message || "Success",
    };
  },

  async getUnreadCount(
    _companyId?: string
  ): Promise<ApiResponse<{ count: number }>> {
    const res = await apiClient.get<ApiResponse<{ count: number }>>(
      "/crm/notifications/unread-count"
    );
    return {
      data: res.data?.data ?? { count: 0 },
      message: res.data?.message || "Success",
    };
  },

  async getNotificationById(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<CrmNotification>> {
    const res = await apiClient.get<ApiResponse<BackendNotification>>(
      `/crm/notifications/${id}`
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendNotification);
    return {
      data: mapBackendNotificationToNotification(raw),
      message: res.data?.message || "Success",
    };
  },

  async createNotification(
    _companyId: string,
    data: CreateNotificationDTO
  ): Promise<ApiResponse<CrmNotification>> {
    const res = await apiClient.post<ApiResponse<BackendNotification>>(
      "/crm/notifications",
      data
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendNotification);
    return {
      data: mapBackendNotificationToNotification(raw),
      message: res.data?.message || "Notification created successfully",
    };
  },

  async updateNotification(
    _companyId: string,
    id: string,
    data: UpdateNotificationDTO
  ): Promise<ApiResponse<CrmNotification>> {
    if (data.read) {
      const res = await apiClient.patch<ApiResponse<BackendNotification>>(
        `/crm/notifications/${id}/read`
      );
      const raw = res.data?.data ?? (res.data as unknown as BackendNotification);
      return {
        data: mapBackendNotificationToNotification(raw),
        message: res.data?.message || "Notification marked as read",
      };
    }
    return this.getNotificationById(_companyId, id);
  },

  async markAsRead(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<CrmNotification>> {
    const res = await apiClient.patch<ApiResponse<BackendNotification>>(
      `/crm/notifications/${id}/read`
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendNotification);
    return {
      data: mapBackendNotificationToNotification(raw),
      message: res.data?.message || "Notification marked as read",
    };
  },

  async markAllAsRead(
    _companyId?: string
  ): Promise<ApiResponse<{ count: number; success: boolean }>> {
    const res = await apiClient.post<
      ApiResponse<{ count: number; success: boolean }>
    >("/crm/notifications/mark-all-read");
    return {
      data: res.data?.data ?? { count: 0, success: true },
      message: res.data?.message || "All notifications marked as read",
    };
  },

  async deleteNotification(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const res = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
      `/crm/notifications/${id}`
    );
    return {
      data: res.data?.data ?? { removed: true },
      message: res.data?.message || "Notification deleted successfully",
    };
  },
};
