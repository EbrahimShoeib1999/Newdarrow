import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  ContactClassificationItem,
  CreateClassificationDTO,
  UpdateClassificationDTO,
} from "../types/classification.types";

const SERVICE_NAME = "ContactClassificationService";

export const DEFAULT_CLASSIFICATIONS: ContactClassificationItem[] = [
  {
    id: "default-actual-client",
    key: "actual_client",
    nameAr: "عميل فعلي",
    nameEn: "Actual Client",
    color: "success",
    emoji: "🟢",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-potential-lead",
    key: "potential_lead",
    nameAr: "عميل محتمل",
    nameEn: "Potential Lead",
    color: "warning",
    emoji: "🟡",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-callback",
    key: "callback",
    nameAr: "معاودة الاتصال",
    nameEn: "Callback",
    color: "primary",
    emoji: "🔵",
    isDefault: true,
    isActive: true,
    isArchived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const ContactClassificationService = {
  async getClassifications(
    _companyId?: string
  ): Promise<ApiResponse<ContactClassificationItem[]>> {
    return withLogging(SERVICE_NAME, "getClassifications", (async () => {
      try {
        const res = await apiClient.get<ApiResponse<ContactClassificationItem[]>>(
          "/crm/contact-classifications"
        );
        const data = Array.isArray(res.data?.data) ? res.data.data : [];
        return {
          data: data.length > 0 ? data : DEFAULT_CLASSIFICATIONS,
          message: res.data?.message || "Classifications loaded successfully",
        };
      } catch (err) {
        // Safe fallback to default classifications if offline or not yet initialized
        return {
          data: DEFAULT_CLASSIFICATIONS,
          message: "Standard default classifications (fallback)",
        };
      }
    })());
  },

  async createClassification(
    _companyId: string,
    data: CreateClassificationDTO
  ): Promise<ApiResponse<ContactClassificationItem>> {
    return withLogging(SERVICE_NAME, "createClassification", (async () => {
      const res = await apiClient.post<ApiResponse<ContactClassificationItem>>(
        "/crm/contact-classifications",
        data
      );
      return {
        data: res.data?.data,
        message: res.data?.message || "Classification created successfully",
      };
    })());
  },

  async updateClassification(
    _companyId: string,
    id: string,
    data: UpdateClassificationDTO
  ): Promise<ApiResponse<ContactClassificationItem>> {
    return withLogging(SERVICE_NAME, "updateClassification", (async () => {
      const res = await apiClient.put<ApiResponse<ContactClassificationItem>>(
        `/crm/contact-classifications/${id}`,
        data
      );
      return {
        data: res.data?.data,
        message: res.data?.message || "Classification updated successfully",
      };
    })());
  },

  async deleteClassification(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deleteClassification", (async () => {
      await apiClient.delete(`/crm/contact-classifications/${id}`);
      return { data: undefined, message: "Classification deleted successfully" };
    })());
  },
};
