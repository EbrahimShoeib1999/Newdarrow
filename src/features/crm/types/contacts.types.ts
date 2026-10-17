import type { CrmBaseFields } from "./crm.common.types";

export type EntityType =
  | "individual"
  | "company"
  | "establishment"
  | "government"
  | "non_profit"
  | "bank"
  | "media"
  | "influencer"
  | "other";

export type ContactRelationship =
  | "lead"
  | "new_client"
  | "active_client"
  | "former_client"
  | "paused_client"
  | "vip_client"
  | "vendor"
  | "partner"
  | "contractor"
  | "referral"
  | "media"
  | "influencer"
  | (string & {});

export type EstablishmentType =
  | "sole_proprietorship"
  | "llc"
  | "joint_stock"
  | "simplified_joint_stock"
  | "partnership"
  | "other";

export type ContactPersonType =
  | "owner"
  | "gm"
  | "marketing_dir"
  | "marketing_rep"
  | "purchasing"
  | "finance"
  | "pr"
  | "content"
  | "employee"
  | "other"
  | (string & {});

export interface AssociatedContactPerson {
  id: string;
  name: string;
  jobTitle?: string;
  department?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  type?: ContactPersonType;
  contactRole?: string;
  isDecisionMaker?: boolean;
  isPrimary?: boolean;
  notes?: string;
}

export interface ContactSocialAccount {
  id: string;
  platform: string;
  url?: string;
  username?: string;
  notes?: string;
}

export type AddressType = "national" | "mailing" | "branch" | "other" | (string & {});

export interface ContactAddress {
  id: string;
  type?: AddressType;
  addressType?: AddressType;
  buildingNumber?: string;
  street?: string;
  streetName?: string;
  district?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  additionalNumber?: string;
  shortAddress?: string;
  country?: string;
  notes?: string;
  isDefault?: boolean;
}

export interface ContactFinancialInfo {
  taxNumber?: string;
  vatRegistered?: "yes" | "no" | "unknown" | "registered" | "not_registered";
  preferredPaymentMethod?: "bank_transfer" | "payment_link" | "cash" | "other" | string;
  paymentTerms?: "full_advance" | "50_percent_advance" | "credit" | "as_per_contract" | "other" | string;
  paymentPeriod?: "immediate" | "7_days" | "15_days" | "30_days" | "60_days" | "custom" | string;
  creditLimit?: number;
  financialNotes?: string;
}

export interface ContactCrmSalesInfo {
  source?: string;
  assignedTo?: string | null;
  accountManagerId?: string | null;
  customerSuccessRepId?: string | null;
  sector?: string;
  tags?: string[];
  requestedService?: string;
  expectedBudget?: number | string;
  expectedStartDate?: string;
  hasMarketingTeam?: boolean | null;
  workingWithOtherAgency?: boolean | null;
  usedPlatforms?: string[];
  interestedServices?: string[];
  servicesInterested?: string[];
  lastContactDate?: string | null;
}

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
  /** Entity Type: Individual, Company, Gov, etc. */
  entityType?: EntityType;

  /** Primary individual names */
  firstName: string;
  lastName: string;
  fatherName?: string;
  fullName?: string;

  /** Commercial or organization name */
  accountName?: string;
  legalName?: string;

  /** Core contact data */
  email: string;
  phone: string;
  secondaryPhone?: string;
  whatsappPhone?: string;
  landlinePhone?: string;
  website?: string;

  /** Commercial / Organization specifics */
  establishmentType?: EstablishmentType;
  commercialRegister?: string;
  unifiedNumber?: string;
  taxNumber?: string;
  crExpiryDate?: string;
  commercialRegisterExpiry?: string;
  mainActivity?: string;
  companySize?: string;
  city?: string;
  region?: string;
  branchesCount?: number;

  /** Specialized Entity Fields */
  govSector?: string;
  administration?: string;
  department?: string;
  tenderNumber?: string;
  contractNumber?: string;
  licenseNumber?: string;
  nonProfitType?: string;
  financialInstitutionType?: string;
  mediaPlatformType?: string;
  audienceSize?: string;
  contentNiche?: string;
  collaborationAreas?: string;
  managerName?: string;

  /** Individual specific */
  nationalId?: string;
  nationality?: string;
  jobTitle?: string;

  /** Multiple relationships with D-Arrow */
  relationships?: ContactRelationship[];
  relationshipStatuses?: Record<string, string>;

  /** Legacy / direct classification */
  classification?: ContactClassification;
  satisfaction?: CustomerSatisfaction;
  satisfactionNotes?: string;
  interests?: string[];
  source?: ContactSource;
  status?: ContactStatus;
  notes?: string;

  /** Rich sub-structures */
  associatedContacts?: AssociatedContactPerson[];
  socialAccounts?: ContactSocialAccount[];
  addresses?: ContactAddress[];
  financialInfo?: ContactFinancialInfo;
  crmSalesInfo?: ContactCrmSalesInfo;

  /** Billing Address for invoices */
  billingAddress?: string;
  leadId?: string | null;
  assignedTo?: string | null;
}

export type CreateContactDTO = Omit<Contact, "id" | "createdAt" | "updatedAt">;
export type UpdateContactDTO = Partial<CreateContactDTO>;

export interface ContactFilters {
  search?: string;
  ownerId?: string;
  entityType?: EntityType | "all";
  relationship?: ContactRelationship | "all";
  classification?: ContactClassification | "all";
  satisfaction?: CustomerSatisfaction | "all";
  source?: string;
  status?: string;
  assignedTo?: string;
  city?: string;
  sector?: string;
}
