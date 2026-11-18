import { apiClient } from "@/lib/api-client";
import type { ApiResponse } from "@/types/api.types";
import type {
  Contact,
  CreateContactDTO,
  UpdateContactDTO,
  EntityType,
} from "../types/contacts.types";

export interface BackendCustomer {
  id: string;
  companyId: string;
  type: "INDIVIDUAL" | "COMPANY" | "ESTABLISHMENT" | "GOVERNMENT";
  firstName: string | null;
  lastName: string | null;
  accountName: string | null;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  website: string | null;
  commercialRegister: string | null;
  taxNumber: string | null;
  city: string | null;
  country: string | null;
  status: string;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function mapBackendCustomerToContact(c: BackendCustomer): Contact {
  const firstName = c.firstName || "";
  const lastName = c.lastName || "";
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    c.accountName ||
    c.legalName ||
    "";

  let entityType: EntityType = "individual";
  if (c.type === "COMPANY") entityType = "company";
  else if (c.type === "ESTABLISHMENT") entityType = "establishment";
  else if (c.type === "GOVERNMENT") entityType = "government";

  const createdAt = c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = c.updatedAt ? new Date(c.updatedAt).toISOString() : createdAt;

  return {
    id: c.id,
    companyId: c.companyId,
    entityType,
    firstName,
    lastName,
    fullName,
    accountName: c.accountName || undefined,
    legalName: c.legalName || undefined,
    email: c.email || "",
    phone: c.phone || "",
    whatsappPhone: c.whatsappPhone || undefined,
    website: c.website || undefined,
    commercialRegister: c.commercialRegister || undefined,
    taxNumber: c.taxNumber || undefined,
    city: c.city || undefined,
    country: c.country || undefined,
    status: c.status || "active",
    assignedTo: c.assignedToId || null,
    ownerId: c.assignedToId || null,
    tags: [],
    createdAt,
    updatedAt,
  };
}

export function mapContactDTOToBackendPayload(
  dto: Partial<CreateContactDTO>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (dto.entityType) {
    const upper = dto.entityType.toUpperCase();
    if (["INDIVIDUAL", "COMPANY", "ESTABLISHMENT", "GOVERNMENT"].includes(upper)) {
      payload.type = upper;
    }
  }

  if (dto.firstName !== undefined) payload.firstName = dto.firstName;
  if (dto.lastName !== undefined) payload.lastName = dto.lastName;
  if (dto.fullName !== undefined) payload.fullName = dto.fullName;
  if (dto.accountName !== undefined) payload.accountName = dto.accountName;
  if (dto.legalName !== undefined) payload.legalName = dto.legalName;
  if (dto.email !== undefined) payload.email = dto.email;
  if (dto.phone !== undefined) payload.phone = dto.phone;
  if (dto.whatsappPhone !== undefined) payload.whatsappPhone = dto.whatsappPhone;
  if (dto.website !== undefined) payload.website = dto.website;
  if (dto.commercialRegister !== undefined) payload.commercialRegister = dto.commercialRegister;
  if (dto.taxNumber !== undefined) payload.taxNumber = dto.taxNumber;
  if (dto.city !== undefined) payload.city = dto.city;
  if (dto.country !== undefined) payload.country = dto.country;
  if (dto.status !== undefined) payload.status = dto.status;

  const assigned = dto.assignedTo ?? (dto as any).assignedToId;
  if (assigned !== undefined) {
    payload.assignedToId = assigned;
  }

  return payload;
}

export const ContactsService = {
  async getContacts(_companyId?: string): Promise<ApiResponse<Contact[]>> {
    const res = await apiClient.get<ApiResponse<BackendCustomer[]>>("/crm/customers");
    const rawList = res.data?.data ?? [];
    const list = Array.isArray(rawList) ? rawList : [];
    return {
      data: list.map(mapBackendCustomerToContact),
      message: res.data?.message || "Success",
    };
  },

  async getContactById(_companyId: string, id: string): Promise<ApiResponse<Contact>> {
    const res = await apiClient.get<ApiResponse<BackendCustomer>>(`/crm/customers/${id}`);
    return {
      data: mapBackendCustomerToContact(res.data.data),
      message: res.data?.message || "Success",
    };
  },

  async createContact(_companyId: string, data: CreateContactDTO): Promise<ApiResponse<Contact>> {
    const payload = mapContactDTOToBackendPayload(data);
    const res = await apiClient.post<ApiResponse<BackendCustomer>>("/crm/customers", payload);
    return {
      data: mapBackendCustomerToContact(res.data.data),
      message: res.data?.message || "Created successfully",
    };
  },

  async updateContact(_companyId: string, id: string, data: UpdateContactDTO): Promise<ApiResponse<Contact>> {
    const payload = mapContactDTOToBackendPayload(data);
    const res = await apiClient.put<ApiResponse<BackendCustomer>>(`/crm/customers/${id}`, payload);
    return {
      data: mapBackendCustomerToContact(res.data.data),
      message: res.data?.message || "Updated successfully",
    };
  },

  async deleteContact(_companyId: string, id: string): Promise<void> {
    await apiClient.delete(`/crm/customers/${id}`);
  },
};
