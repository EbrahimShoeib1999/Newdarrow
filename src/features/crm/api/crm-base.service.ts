/**
 * @deprecated Legacy Firestore CRM collection service base.
 * All CRM modules have been migrated to NestJS + PostgreSQL via apiClient.
 */
import type { ApiResponse } from "@/types/api.types";

export interface CrmListOptions {
  orderByField?: string;
  orderDirection?: "asc" | "desc";
  limitCount?: number;
}

export function createCrmCollectionService<T extends { id: string }, CreateDTO, UpdateDTO>(
  _collectionName: string,
  serviceName: string,
  _defaults?: Partial<CreateDTO>
) {
  return {
    async getAll(_companyId: string, _options?: CrmListOptions): Promise<ApiResponse<T[]>> {
      console.warn(`[${serviceName}] createCrmCollectionService is deprecated. Use apiClient instead.`);
      return { data: [], message: "Deprecated" };
    },
    async getById(_companyId: string, _id: string): Promise<ApiResponse<T>> {
      throw new Error(`[${serviceName}] createCrmCollectionService is deprecated. Use apiClient instead.`);
    },
    async create(_companyId: string, _data: CreateDTO): Promise<ApiResponse<T>> {
      throw new Error(`[${serviceName}] createCrmCollectionService is deprecated. Use apiClient instead.`);
    },
    async update(_companyId: string, _id: string, _data: UpdateDTO): Promise<ApiResponse<T>> {
      throw new Error(`[${serviceName}] createCrmCollectionService is deprecated. Use apiClient instead.`);
    },
    async delete(_companyId: string, _id: string): Promise<void> {
      throw new Error(`[${serviceName}] createCrmCollectionService is deprecated. Use apiClient instead.`);
    },
  };
}
