import type { CrmBaseFields } from "./crm.common.types";

export type ContactClassification =
  | "actual_client"
  | "potential_lead"
  | "callback"
  | (string & {});

export type CustomerSatisfaction =
  | "satisfied"
  | "neutral"
  | "unsatisfied";

export type ContactSource =
  | "website"
  | "referral"
  | "social_media"
  | "cold_call"
  | "event"
  | "whatsapp"
  | "other"
  | (string & {});

export type ContactStatus =
  | "active"
  | "inactive"
  | "archived"
  | (string & {});

export interface Contact extends CrmBaseFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  secondaryPhone?: string;
  whatsappPhone?: string;
  jobTitle?: string;
  department?: string;
  accountName?: string;
  classification?: ContactClassification;
  satisfaction?: CustomerSatisfaction;
  satisfactionNotes?: string;
  interests?: string[];
  source?: ContactSource;
  status?: ContactStatus;
  /** Commercial register (السجل التجاري) for future account linking */
  commercialRegister?: string;
  /** Tax number for billing (الرقم الضريبي) */
  taxNumber?: string;
  /** Address for billing invoices */
  billingAddress?: string;
  leadId?: string | null;
  assignedTo?: string | null;
}

export type CreateContactDTO = Omit<Contact, "id" | "createdAt" | "updatedAt">;
export type UpdateContactDTO = Partial<CreateContactDTO>;

export interface ContactFilters {
  search?: string;
  ownerId?: string;
  classification?: ContactClassification;
  satisfaction?: CustomerSatisfaction;
  source?: string;
  status?: string;
  assignedTo?: string;
}
