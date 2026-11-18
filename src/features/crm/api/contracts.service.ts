import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  SavedContract,
  CreateContractDTO,
  UpdateContractDTO,
} from "../types/contract.types";
import {
  validateContractPayload,
  normalizeContractPayload,
} from "../utils/contract-normalization";

export const ContractsService = {
  async getAll(_companyId?: string): Promise<ApiResponse<SavedContract[]>> {
    const res = await apiClient.get<ApiResponse<SavedContract[]>>("/crm/contracts");
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      message: res.data?.message || "Success",
    };
  },

  async getById(_companyId: string, id: string): Promise<ApiResponse<SavedContract>> {
    const res = await apiClient.get<ApiResponse<SavedContract>>(`/crm/contracts/${id}`);
    return {
      data: res.data?.data,
      message: res.data?.message || "Success",
    };
  },

  async create(_companyId: string, data: CreateContractDTO): Promise<ApiResponse<SavedContract>> {
    validateContractPayload(data);
    const normalized = normalizeContractPayload(data);
    const res = await apiClient.post<ApiResponse<SavedContract>>("/crm/contracts", normalized);
    return {
      data: res.data?.data,
      message: res.data?.message || "Contract created successfully",
    };
  },

  async update(
    _companyId: string,
    id: string,
    data: UpdateContractDTO
  ): Promise<ApiResponse<SavedContract>> {
    validateContractPayload(data);
    const normalized = normalizeContractPayload(data);
    const res = await apiClient.put<ApiResponse<SavedContract>>(`/crm/contracts/${id}`, normalized);
    return {
      data: res.data?.data,
      message: res.data?.message || "Contract updated successfully",
    };
  },

  async delete(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/contracts/${id}`);
  },
};
