import apiClient from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type { CompanyProfile, UpdateCompanyProfileDTO } from "../types/company.types";

export const CompanyService = {
  async getCompany(companyId: string): Promise<ApiResponse<CompanyProfile | null>> {
    const response = await apiClient.get<ApiResponse<CompanyProfile | null>>(
      `/companies/${companyId}`
    );
    return response.data;
  },

  async getProfile(companyId: string): Promise<ApiResponse<CompanyProfile | null>> {
    return CompanyService.getCompany(companyId);
  },

  async createProfile(
    companyId: string,
    data: UpdateCompanyProfileDTO & { name: string; commercialRegister: string }
  ): Promise<ApiResponse<CompanyProfile>> {
    const response = await apiClient.post<ApiResponse<CompanyProfile>>(
      "/companies",
      { ...data, id: companyId }
    );
    return response.data;
  },

  async updateProfile(
    companyId: string,
    data: UpdateCompanyProfileDTO
  ): Promise<ApiResponse<CompanyProfile>> {
    const response = await apiClient.put<ApiResponse<CompanyProfile>>(
      `/companies/${companyId}`,
      data
    );
    return response.data;
  },

  async listAllCompanies(): Promise<ApiResponse<CompanyProfile[]>> {
    const response = await apiClient.get<ApiResponse<CompanyProfile[]>>("/companies");
    return response.data;
  },

  async deleteCompany(companyId: string): Promise<ApiResponse<void>> {
    const response = await apiClient.delete<ApiResponse<void>>(
      `/companies/${companyId}`
    );
    return response.data;
  },
};
