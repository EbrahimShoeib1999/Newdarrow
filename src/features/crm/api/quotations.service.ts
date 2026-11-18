import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  SavedQuotation,
  CreateQuotationDTO,
  UpdateQuotationDTO,
} from "../types/quotation.types";

export const QuotationsService = {
  async getAll(_companyId?: string): Promise<ApiResponse<SavedQuotation[]>> {
    const res = await apiClient.get<ApiResponse<SavedQuotation[]>>("/crm/quotations");
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      message: res.data?.message || "Success",
    };
  },

  async getById(_companyId: string, id: string): Promise<ApiResponse<SavedQuotation>> {
    const res = await apiClient.get<ApiResponse<SavedQuotation>>(`/crm/quotations/${id}`);
    return {
      data: res.data?.data,
      message: res.data?.message || "Success",
    };
  },

  async create(_companyId: string, data: CreateQuotationDTO): Promise<ApiResponse<SavedQuotation>> {
    const res = await apiClient.post<ApiResponse<SavedQuotation>>("/crm/quotations", data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Quotation created successfully",
    };
  },

  async update(
    _companyId: string,
    id: string,
    data: UpdateQuotationDTO
  ): Promise<ApiResponse<SavedQuotation>> {
    const res = await apiClient.put<ApiResponse<SavedQuotation>>(`/crm/quotations/${id}`, data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Quotation updated successfully",
    };
  },

  async delete(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/quotations/${id}`);
  },
};
