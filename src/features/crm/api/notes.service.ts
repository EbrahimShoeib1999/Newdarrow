import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type { CrmNote, CreateNoteDTO, UpdateNoteDTO } from "../types/notes.types";

export const NotesService = {
  async getNotes(_companyId?: string): Promise<ApiResponse<CrmNote[]>> {
    const res = await apiClient.get<ApiResponse<CrmNote[]>>("/crm/notes");
    return {
      data: Array.isArray(res.data?.data) ? res.data.data : [],
      message: res.data?.message || "Success",
    };
  },

  async getNoteById(_companyId: string, id: string): Promise<ApiResponse<CrmNote>> {
    const res = await apiClient.get<ApiResponse<CrmNote>>(`/crm/notes/${id}`);
    return {
      data: res.data?.data,
      message: res.data?.message || "Success",
    };
  },

  async createNote(_companyId: string, data: CreateNoteDTO): Promise<ApiResponse<CrmNote>> {
    const res = await apiClient.post<ApiResponse<CrmNote>>("/crm/notes", data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Note created successfully",
    };
  },

  async updateNote(
    _companyId: string,
    id: string,
    data: UpdateNoteDTO
  ): Promise<ApiResponse<CrmNote>> {
    const res = await apiClient.put<ApiResponse<CrmNote>>(`/crm/notes/${id}`, data);
    return {
      data: res.data?.data,
      message: res.data?.message || "Note updated successfully",
    };
  },

  async deleteNote(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/notes/${id}`);
  },
};
