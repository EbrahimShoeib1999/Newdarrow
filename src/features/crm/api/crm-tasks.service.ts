import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type { CrmTask, CreateCrmTaskDTO, UpdateCrmTaskDTO } from "../types/crm-tasks.types";

export const CrmTasksService = {
  async getCrmTasks(_companyId?: string): Promise<ApiResponse<CrmTask[]>> {
    const res = await apiClient.get<ApiResponse<CrmTask[]>>("/crm/tasks");
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      message: res.data?.message || "Success",
    };
  },

  async getCrmTaskById(_companyId: string, id: string): Promise<ApiResponse<CrmTask>> {
    const res = await apiClient.get<ApiResponse<CrmTask>>(`/crm/tasks/${id}`);
    return {
      data: res.data?.data,
      message: res.data?.message || "Success",
    };
  },

  async createCrmTask(_companyId: string, data: CreateCrmTaskDTO): Promise<ApiResponse<CrmTask>> {
    const res = await apiClient.post<ApiResponse<CrmTask>>("/crm/tasks", data);
    return {
      data: res.data?.data,
      message: res.data?.message || "CRM Task created successfully",
    };
  },

  async updateCrmTask(
    _companyId: string,
    id: string,
    data: UpdateCrmTaskDTO
  ): Promise<ApiResponse<CrmTask>> {
    const res = await apiClient.put<ApiResponse<CrmTask>>(`/crm/tasks/${id}`, data);
    return {
      data: res.data?.data,
      message: res.data?.message || "CRM Task updated successfully",
    };
  },

  async deleteCrmTask(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/tasks/${id}`);
  },
};
