import apiClient, { getAccessToken, setAccessToken } from "@/lib/api-client";
import type { PaginatedResponse } from "@/types/api.types";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Generic CRUD service that wraps the NestJS REST API.
 * Endpoints follow the pattern: GET /{resource}, GET /{resource}/:id, etc.
 */
export class CrudService<T, CreateDto, UpdateDto> {
  constructor(private resource: string) {}

  async list(params: PaginationParams = {}): Promise<PaginatedResult<T>> {
    const { page = 1, pageSize = 20, search, sortBy, sortOrder } = params;
    const response = await apiClient.get<PaginatedResponse<T>>(this.resource, {
      params: { page, pageSize, search, sortBy, sortOrder },
    });
    return response.data.data;
  }

  async get(id: string): Promise<T> {
    const response = await apiClient.get<{ data: T }>(`${this.resource}/${id}`);
    return response.data.data;
  }

  async create(data: CreateDto): Promise<T> {
    const response = await apiClient.post<{ data: T }>(this.resource, data);
    return response.data.data;
  }

  async update(id: string, data: UpdateDto): Promise<T> {
    const response = await apiClient.patch<{ data: T }>(
      `${this.resource}/${id}`,
      data
    );
    return response.data.data;
  }

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${this.resource}/${id}`);
  }
}

export const crudService = <T, CreateDto, UpdateDto>(
  resource: string
): CrudService<T, CreateDto, UpdateDto> => {
  return new CrudService(resource);
};
