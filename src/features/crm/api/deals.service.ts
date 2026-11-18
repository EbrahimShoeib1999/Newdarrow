import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  Deal,
  CreateDealDTO,
  UpdateDealDTO,
  DealStage,
} from "../types/deals.types";

export interface BackendDeal {
  id: string;
  companyId: string;
  title: string;
  amount: number;
  currency: string;
  stage: string;
  probability: number;
  expectedCloseDate: string | null;
  contactId: string | null;
  leadId: string | null;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    accountName?: string | null;
  } | null;
  lead?: { id: string; name: string; companyName?: string | null } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function mapBackendStageToFrontend(stage: string): DealStage {
  const s = (stage || "").toUpperCase();
  switch (s) {
    case "PROSPECTING":
      return "lead";
    case "NEEDS_ANALYSIS":
      return "contacted";
    case "QUALIFICATION":
      return "qualified";
    case "VALUE_PROPOSAL":
      return "proposal_sent";
    case "NEGOTIATION":
      return "negotiation";
    case "CLOSED_WON":
    case "WON":
      return "won";
    case "CLOSED_LOST":
    case "LOST":
      return "lost";
    default:
      return (stage?.toLowerCase() as DealStage) || "lead";
  }
}

export function mapBackendDealToDeal(b: BackendDeal): Deal {
  const stage = mapBackendStageToFrontend(b.stage);
  const createdAt = b.createdAt
    ? new Date(b.createdAt).toISOString()
    : new Date().toISOString();
  const updatedAt = b.updatedAt
    ? new Date(b.updatedAt).toISOString()
    : createdAt;
  const expectedCloseDate = b.expectedCloseDate
    ? new Date(b.expectedCloseDate).toISOString()
    : null;

  return {
    id: b.id,
    title: b.title || "",
    amount: b.amount ?? 0,
    currency: b.currency || "SAR",
    stage,
    probability: b.probability ?? 0,
    expectedCloseDate,
    contactId: b.contactId || null,
    leadId: b.leadId || null,
    assignedTo: b.assignedToId || null,
    ownerId: b.assignedToId || null,
    tags: [],
    createdAt,
    updatedAt,
  };
}

export function mapDealDTOToBackendPayload(
  dto: Partial<CreateDealDTO>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (dto.title !== undefined) payload.title = dto.title;
  if (dto.amount !== undefined) payload.amount = Math.round(Number(dto.amount) || 0);
  if (dto.currency !== undefined) payload.currency = dto.currency;
  if (dto.stage !== undefined) payload.stage = dto.stage;
  if (dto.probability !== undefined) payload.probability = dto.probability;
  if (dto.expectedCloseDate !== undefined) payload.expectedCloseDate = dto.expectedCloseDate;
  if (dto.contactId !== undefined) payload.contactId = dto.contactId;
  if (dto.leadId !== undefined) payload.leadId = dto.leadId;
  if (dto.assignedTo !== undefined) {
    payload.assignedToId = dto.assignedTo;
    payload.assignedTo = dto.assignedTo;
  }

  return payload;
}

export const DealsService = {
  async getDeals(_companyId?: string): Promise<ApiResponse<Deal[]>> {
    const res = await apiClient.get<ApiResponse<BackendDeal[]>>("/crm/deals");
    const rawList = res.data?.data ?? [];
    const list = Array.isArray(rawList) ? rawList : [];
    return {
      data: list.map(mapBackendDealToDeal),
      message: res.data?.message || "Success",
    };
  },

  async getDealById(_companyId: string, id: string): Promise<ApiResponse<Deal>> {
    const res = await apiClient.get<ApiResponse<BackendDeal>>(`/crm/deals/${id}`);
    const raw = res.data?.data ?? (res.data as unknown as BackendDeal);
    return {
      data: mapBackendDealToDeal(raw),
      message: res.data?.message || "Success",
    };
  },

  async createDeal(
    _companyId: string,
    data: CreateDealDTO
  ): Promise<ApiResponse<Deal>> {
    const payload = mapDealDTOToBackendPayload(data);
    const res = await apiClient.post<ApiResponse<BackendDeal>>(
      "/crm/deals",
      payload
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendDeal);
    return {
      data: mapBackendDealToDeal(raw),
      message: res.data?.message || "Deal created successfully",
    };
  },

  async updateDeal(
    _companyId: string,
    id: string,
    data: UpdateDealDTO
  ): Promise<ApiResponse<Deal>> {
    const payload = mapDealDTOToBackendPayload(data);
    const res = await apiClient.patch<ApiResponse<BackendDeal>>(
      `/crm/deals/${id}`,
      payload
    );
    const raw = res.data?.data ?? (res.data as unknown as BackendDeal);
    return {
      data: mapBackendDealToDeal(raw),
      message: res.data?.message || "Deal updated successfully",
    };
  },

  async deleteDeal(
    _companyId: string,
    id: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const res = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
      `/crm/deals/${id}`
    );
    return {
      data: res.data?.data ?? { removed: true },
      message: res.data?.message || "Deal deleted successfully",
    };
  },
};
