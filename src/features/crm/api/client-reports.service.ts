import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import type {
  ClientReport,
  CreateClientReportDTO,
  UpdateClientReportDTO,
} from "../types/client-reports.types";

const SERVICE_NAME = "ClientReportsService";

export const ClientReportsService = {
  async getClientReports(
    _companyId: string,
    filters?: {
      contactId?: string;
      dealId?: string;
      authorId?: string;
      reportType?: string;
      clientMood?: string;
    }
  ): Promise<ApiResponse<ClientReport[]>> {
    return withLogging(SERVICE_NAME, "getClientReports", (async () => {
      const params = new URLSearchParams();
      if (filters?.contactId) params.append("contactId", filters.contactId);
      if (filters?.dealId) params.append("dealId", filters.dealId);
      if (filters?.authorId) params.append("authorId", filters.authorId);
      if (filters?.reportType) params.append("reportType", filters.reportType);
      if (filters?.clientMood) params.append("clientMood", filters.clientMood);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiClient.get<ApiResponse<ClientReport[]>>(`/crm/client-reports${qs}`);
      return {
        data: Array.isArray(res.data?.data) ? res.data.data : [],
        message: res.data?.message || "Fetched client reports successfully",
      };
    })());
  },

  async getClientReportById(
    _companyId: string,
    reportId: string
  ): Promise<ApiResponse<ClientReport>> {
    return withLogging(SERVICE_NAME, "getClientReportById", (async () => {
      const res = await apiClient.get<ApiResponse<ClientReport>>(`/crm/client-reports/${reportId}`);
      return {
        data: res.data?.data,
        message: res.data?.message || "Client report fetched successfully",
      };
    })());
  },

  async createClientReport(
    _companyId: string,
    payload: CreateClientReportDTO,
    _author?: { id: string; name: string; email?: string }
  ): Promise<ApiResponse<ClientReport>> {
    return withLogging(SERVICE_NAME, "createClientReport", (async () => {
      const res = await apiClient.post<ApiResponse<ClientReport>>("/crm/client-reports", payload);
      return {
        data: res.data?.data,
        message: res.data?.message || "تم حفظ تقرير العميل بنجاح",
      };
    })());
  },

  async updateClientReport(
    _companyId: string,
    reportId: string,
    payload: UpdateClientReportDTO
  ): Promise<ApiResponse<ClientReport>> {
    return withLogging(SERVICE_NAME, "updateClientReport", (async () => {
      const res = await apiClient.put<ApiResponse<ClientReport>>(
        `/crm/client-reports/${reportId}`,
        payload
      );
      return {
        data: res.data?.data,
        message: res.data?.message || "تم تحديث تقرير العميل بنجاح",
      };
    })());
  },

  async approveClientReport(
    _companyId: string,
    reportId: string,
    _reviewer?: { id: string; name: string }
  ): Promise<ApiResponse<ClientReport>> {
    return withLogging(SERVICE_NAME, "approveClientReport", (async () => {
      const res = await apiClient.post<ApiResponse<ClientReport>>(
        `/crm/client-reports/${reportId}/approve`
      );
      return {
        data: res.data?.data,
        message: res.data?.message || "تم اعتماد ومراجعة التقرير بنجاح",
      };
    })());
  },

  async deleteClientReport(_companyId: string, reportId: string): Promise<ApiResponse<void>> {
    return withLogging(SERVICE_NAME, "deleteClientReport", (async () => {
      await apiClient.delete(`/crm/client-reports/${reportId}`);
      return {
        data: undefined,
        message: "تم حذف تقرير العميل بنجاح",
      };
    })());
  },

  async generateShareLink(
    _companyId: string,
    reportId: string,
    expiresInDays = 30
  ): Promise<ApiResponse<{ token: string; expiresAt: string; reportId: string }>> {
    return withLogging(SERVICE_NAME, "generateShareLink", (async () => {
      const res = await apiClient.post<
        ApiResponse<{ token: string; expiresAt: string; reportId: string }>
      >(`/crm/client-reports/${reportId}/share`, { expiresInDays });
      return res.data;
    })());
  },

  async revokeShareLink(
    _companyId: string,
    reportId: string
  ): Promise<ApiResponse<{ success: boolean }>> {
    return withLogging(SERVICE_NAME, "revokeShareLink", (async () => {
      const res = await apiClient.post<ApiResponse<{ success: boolean }>>(
        `/crm/client-reports/${reportId}/revoke`
      );
      return res.data;
    })());
  },
};
