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
