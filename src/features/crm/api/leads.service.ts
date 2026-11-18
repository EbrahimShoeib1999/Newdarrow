import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  Lead,
  CreateLeadDTO,
  UpdateLeadDTO,
  LeadStatus,
} from "../types/leads.types";

export interface BackendLead {
  id: string;
  companyId: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  priority: string;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  contactId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function mapBackendLeadToLead(b: BackendLead): Lead {
  let status: LeadStatus = "new";
  const s = (b.status || "").toUpperCase();
  if (s === "CONTACTED") status = "contacted";
  else if (s === "QUALIFIED") status = "qualified";
  else if (s === "PROPOSAL" || s === "PROPOSAL_SENT") status = "proposal_sent";
  else if (s === "NEGOTIATION") status = "negotiation";
  else if (s === "CLOSED_WON" || s === "WON") status = "won";
  else if (s === "CLOSED_LOST" || s === "LOST") status = "lost";
  else status = "new";

  const createdAt = b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = b.updatedAt ? new Date(b.updatedAt).toISOString() : createdAt;

  return {
    id: b.id,
    name: b.name || "",
    company: b.companyName || "",
    email: b.email || "",
    phone: b.phone || "",
    status,
    source: b.source || "other",
    sourceOther: undefined,
    priority: (b.priority as any) || "medium",
    assignedTo: b.assignedToId || null,
    contactId: b.contactId || null,
    notes: b.notes || "",
    ownerId: b.assignedToId || null,
    tags: [],
    createdAt,
    updatedAt,
  };
}

export function mapLeadDTOToBackendPayload(
  dto: Partial<CreateLeadDTO>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (dto.name !== undefined) payload.name = dto.name;
  if (dto.company !== undefined) payload.companyName = dto.company;
  if (dto.email !== undefined) payload.email = dto.email;
  if (dto.phone !== undefined) payload.phone = dto.phone;

  if (dto.status !== undefined) {
    const s = dto.status.toLowerCase();
    if (s === "proposal_sent" || s === "proposal") payload.status = "PROPOSAL";
    else if (s === "won" || s === "closed_won") payload.status = "CLOSED_WON";
    else if (s === "lost" || s === "closed_lost") payload.status = "CLOSED_LOST";
    else payload.status = s.toUpperCase();
  }

  if (dto.source !== undefined) {
    if (dto.source === "other" && dto.sourceOther) {
      payload.source = dto.sourceOther;
    } else {
      payload.source = dto.source;
    }
  }

  if (dto.priority !== undefined) payload.priority = dto.priority;
  if (dto.assignedTo !== undefined) payload.assignedToId = dto.assignedTo;
  if (dto.contactId !== undefined) payload.contactId = dto.contactId;
  if (dto.notes !== undefined) payload.notes = dto.notes;

  return payload;
}

export const LeadsService = {
  async getLeads(_companyId?: string): Promise<ApiResponse<Lead[]>> {
    const res = await apiClient.get<ApiResponse<BackendLead[]>>("/crm/leads");
    const rawList = res.data?.data ?? [];
    const list = Array.isArray(rawList) ? rawList : [];
    return {
      data: list.map(mapBackendLeadToLead),
      message: res.data?.message || "Success",
    };
  },

  async getLeadById(_companyId: string, id: string): Promise<ApiResponse<Lead>> {
    const res = await apiClient.get<ApiResponse<BackendLead>>(`/crm/leads/${id}`);
    return {
      data: mapBackendLeadToLead(res.data.data),
      message: res.data?.message || "Success",
    };
  },

  async createLead(_companyId: string, data: CreateLeadDTO): Promise<ApiResponse<Lead>> {
    const payload = mapLeadDTOToBackendPayload(data);
    const res = await apiClient.post<ApiResponse<BackendLead>>("/crm/leads", payload);
    return {
      data: mapBackendLeadToLead(res.data.data),
      message: res.data?.message || "Created successfully",
    };
  },

  async updateLead(_companyId: string, id: string, data: UpdateLeadDTO): Promise<ApiResponse<Lead>> {
    const payload = mapLeadDTOToBackendPayload(data);
    const res = await apiClient.put<ApiResponse<BackendLead>>(`/crm/leads/${id}`, payload);
    return {
      data: mapBackendLeadToLead(res.data.data),
      message: res.data?.message || "Updated successfully",
    };
  },

  async deleteLead(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/leads/${id}`);
  },
};
