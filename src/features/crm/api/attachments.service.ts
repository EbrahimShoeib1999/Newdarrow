import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type { CrmAttachment, CreateAttachmentDTO } from "../types/attachments.types";

export const AttachmentsService = {
  async getAttachments(_companyId?: string): Promise<ApiResponse<CrmAttachment[]>> {
    const res = await apiClient.get<ApiResponse<CrmAttachment[]>>("/crm/attachments");
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      message: res.data?.message || "Success",
    };
  },

  async getAttachmentById(_companyId: string, id: string): Promise<ApiResponse<CrmAttachment>> {
    const res = await apiClient.get<ApiResponse<CrmAttachment>>(`/crm/attachments/${id}`);
    return {
      data: res.data?.data,
      message: res.data?.message || "Success",
    };
  },

  async uploadAttachment(
    entityType: string,
    entityId: string,
    file: File
  ): Promise<ApiResponse<CrmAttachment>> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);

    const res = await apiClient.post<ApiResponse<CrmAttachment>>(
      "/crm/attachments/upload",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return {
      data: res.data?.data,
      message: res.data?.message || "Attachment uploaded successfully",
    };
  },

  async downloadAttachment(id: string, fileName: string): Promise<void> {
    const response = await apiClient.get<Blob>(`/crm/attachments/${id}/content`, {
      responseType: "blob",
    });

    const blob = new Blob([response.data], {
      type: response.headers["content-type"] || "application/octet-stream",
    });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.setAttribute("download", fileName || "attachment");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  },

  async getAttachmentBlobUrl(id: string): Promise<string> {
    const response = await apiClient.get<Blob>(`/crm/attachments/${id}/content`, {
      responseType: "blob",
    });

    const blob = new Blob([response.data], {
      type: response.headers["content-type"] || "application/octet-stream",
    });
    return window.URL.createObjectURL(blob);
  },

  async createAttachment(
    _companyId: string,
    data: CreateAttachmentDTO
  ): Promise<ApiResponse<CrmAttachment>> {
    const res = await apiClient.post<ApiResponse<CrmAttachment>>("/crm/attachments", data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Attachment created successfully",
    };
  },

  async updateAttachment(
    _companyId: string,
    id: string,
    data: Partial<CreateAttachmentDTO>
  ): Promise<ApiResponse<CrmAttachment>> {
    const res = await apiClient.put<ApiResponse<CrmAttachment>>(`/crm/attachments/${id}`, data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Attachment updated successfully",
    };
  },

  async deleteAttachment(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/attachments/${id}`);
  },
};
