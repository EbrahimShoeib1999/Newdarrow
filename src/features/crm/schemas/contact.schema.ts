import { z } from "zod";
import type { CreateContactDTO, EstablishmentType } from "../types/contacts.types";

export const associatedContactPersonSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z
    .string()
    .optional()
    .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
  type: z.string().optional(),
  isDecisionMaker: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().optional(),
});

export const contactSocialAccountSchema = z.object({
  id: z.string(),
  platform: z.string().min(1, "Platform is required"),
  url: z.string().optional(),
  username: z.string().optional(),
  notes: z.string().optional(),
});

export const contactAddressSchema = z.object({
  id: z.string(),
  type: z.enum(["national", "mailing", "branch", "other"]),
  buildingNumber: z.string().optional(),
  street: z.string().optional(),
  district: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  additionalNumber: z.string().optional(),
  shortAddress: z.string().optional(),
  country: z.string().optional(),
  notes: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const contactFormSchema = z
  .object({
    entityType: z.enum([
      "individual",
      "company",
      "establishment",
      "government",
      "non_profit",
      "bank",
      "media",
      "influencer",
      "other",
    ]),

    // Individual Names
    firstName: z.string().optional(),
    fatherName: z.string().optional(),
    lastName: z.string().optional(),

    // Organization Names
    accountName: z.string().optional(),
    legalName: z.string().optional(),

    // Contact
    email: z
      .string()
      .optional()
      .refine((v) => !v || z.string().email().safeParse(v).success, "Invalid email"),
    phone: z.string().optional(),
    secondaryPhone: z.string().optional(),
    whatsappPhone: z.string().optional(),
    landlinePhone: z.string().optional(),
    website: z.string().optional(),

    // Organization details
    establishmentType: z.string().optional(),
    commercialRegister: z.string().optional(),
    unifiedNumber: z.string().optional(),
    taxNumber: z.string().optional(),
    crExpiryDate: z.string().optional(),
    mainActivity: z.string().optional(),
    companySize: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    branchesCount: z.number().optional(),

    // Specialized entity fields
    govSector: z.string().optional(),
    administration: z.string().optional(),
    department: z.string().optional(),
    tenderNumber: z.string().optional(),
    contractNumber: z.string().optional(),
    licenseNumber: z.string().optional(),
    nonProfitType: z.string().optional(),
    financialInstitutionType: z.string().optional(),
    mediaPlatformType: z.string().optional(),
    audienceSize: z.string().optional(),
    contentNiche: z.string().optional(),
    collaborationAreas: z.string().optional(),
    managerName: z.string().optional(),

    // Individual details
    nationalId: z.string().optional(),
    nationality: z.string().optional(),
    jobTitle: z.string().optional(),

    // Relationships & Classifications
    relationships: z.array(z.string()).default([]),
    relationshipStatuses: z.record(z.string(), z.string()).optional(),
    classification: z.string().optional(),
    source: z.string().optional(),
    status: z.string().optional(),
    satisfaction: z.enum(["satisfied", "neutral", "unsatisfied"]).optional(),
    satisfactionNotes: z.string().optional(),
    interests: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().optional(),

    // Sub-structures
    associatedContacts: z.array(associatedContactPersonSchema).default([]),
    socialAccounts: z.array(contactSocialAccountSchema).default([]),
    addresses: z.array(contactAddressSchema).default([]),
    financialInfo: z
      .object({
        taxNumber: z.string().optional(),
        vatRegistered: z.enum(["yes", "no", "unknown"]).optional(),
        preferredPaymentMethod: z.string().optional(),
        paymentTerms: z.string().optional(),
        paymentPeriod: z.string().optional(),
        creditLimit: z.number().optional(),
        financialNotes: z.string().optional(),
      })
      .optional(),
    crmSalesInfo: z
      .object({
        source: z.string().optional(),
        assignedTo: z.string().nullable().optional(),
        accountManagerId: z.string().nullable().optional(),
        customerSuccessRepId: z.string().nullable().optional(),
        sector: z.string().optional(),
        tags: z.array(z.string()).optional(),
        requestedService: z.string().optional(),
        expectedBudget: z.union([z.number(), z.string()]).optional(),
        expectedStartDate: z.string().optional(),
        hasMarketingTeam: z.boolean().nullable().optional(),
        workingWithOtherAgency: z.boolean().nullable().optional(),
        usedPlatforms: z.array(z.string()).optional(),
        interestedServices: z.array(z.string()).optional(),
        lastContactDate: z.string().nullable().optional(),
      })
      .optional(),

    assignedTo: z.string().nullable().optional(),
    billingAddress: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // If Individual: firstName and lastName are required. Also must have phone or email.
    if (data.entityType === "individual") {
      if (!data.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["firstName"],
          message: "First name is required",
        });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lastName"],
          message: "Last name is required",
        });
      }
      if (!data.phone?.trim() && !data.email?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["phone"],
          message: "Phone number or email is required",
        });
      }
    } else {
      // Organization / Company / Gov / etc: accountName is required
      if (!data.accountName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["accountName"],
          message: "Organization / Company name is required",
        });
      }
    }
  });

export type ContactFormValues = z.infer<typeof contactFormSchema>;

export function toCreateContactDTO(values: Partial<ContactFormValues> | ContactFormValues): CreateContactDTO {
  const entityType = values.entityType || (values.accountName ? "company" : "individual");
  const isIndividual = entityType === "individual";

  // Build full name
  const fullName = isIndividual
    ? `${values.firstName || ""} ${values.fatherName ? values.fatherName + " " : ""}${values.lastName || ""}`.trim()
    : values.accountName?.trim() || "";

  // For compatibility with legacy views that read firstName and lastName
  let firstName = values.firstName?.trim() || "";
  let lastName = values.lastName?.trim() || "";
  if (!isIndividual && !firstName) {
    firstName = values.accountName?.trim() || "";
    lastName = "";
  }

  // Derive primary classification
  const relationships = values.relationships || [];
  const primaryClassification =
    values.classification ||
    (relationships.length > 0 ? relationships[0] : "actual_client");

  return {
    entityType,
    firstName,
    lastName,
    fatherName: values.fatherName?.trim() || undefined,
    fullName,
    accountName: values.accountName?.trim() || undefined,
    legalName: values.legalName?.trim() || undefined,
    email: values.email?.trim() || "",
    phone: values.phone?.trim() || "",
    secondaryPhone: values.secondaryPhone?.trim() || undefined,
    whatsappPhone: values.whatsappPhone?.trim() || undefined,
    landlinePhone: values.landlinePhone?.trim() || undefined,
    website: values.website?.trim() || undefined,
    establishmentType: values.establishmentType as EstablishmentType | undefined,
    commercialRegister: values.commercialRegister?.trim() || undefined,
    unifiedNumber: values.unifiedNumber?.trim() || undefined,
    taxNumber: values.taxNumber?.trim() || undefined,
    crExpiryDate: values.crExpiryDate?.trim() || undefined,
    mainActivity: values.mainActivity?.trim() || undefined,
    companySize: values.companySize?.trim() || undefined,
    city: values.city?.trim() || undefined,
    region: values.region?.trim() || undefined,
    branchesCount: values.branchesCount || undefined,

    // Specialized fields
    govSector: values.govSector?.trim() || undefined,
    administration: values.administration?.trim() || undefined,
    department: values.department?.trim() || undefined,
    tenderNumber: values.tenderNumber?.trim() || undefined,
    contractNumber: values.contractNumber?.trim() || undefined,
    licenseNumber: values.licenseNumber?.trim() || undefined,
    nonProfitType: values.nonProfitType?.trim() || undefined,
    financialInstitutionType: values.financialInstitutionType?.trim() || undefined,
    mediaPlatformType: values.mediaPlatformType?.trim() || undefined,
    audienceSize: values.audienceSize?.trim() || undefined,
    contentNiche: values.contentNiche?.trim() || undefined,
    collaborationAreas: values.collaborationAreas?.trim() || undefined,
    managerName: values.managerName?.trim() || undefined,

    nationalId: values.nationalId?.trim() || undefined,
    nationality: values.nationality?.trim() || undefined,
    jobTitle: values.jobTitle?.trim() || undefined,

    relationships,
    relationshipStatuses: (values.relationshipStatuses as Record<string, string>) || {},
    classification: primaryClassification,
    source: values.source?.trim() || undefined,
    status: values.status?.trim() || "active",
    satisfaction: values.satisfaction || "satisfied",
    satisfactionNotes: values.satisfactionNotes?.trim() || undefined,
    interests: values.interests || values.tags || [],
    tags: values.tags || values.interests || [],
    notes: values.notes?.trim() || undefined,

    associatedContacts: (values.associatedContacts as any) || [],
    socialAccounts: (values.socialAccounts as any) || [],
    addresses: (values.addresses as any) || [],
    financialInfo: values.financialInfo as any,
    crmSalesInfo: values.crmSalesInfo as any,

    billingAddress: values.billingAddress?.trim() || undefined,
    assignedTo: values.assignedTo ?? values.crmSalesInfo?.assignedTo ?? null,
    ownerId: values.assignedTo ?? null,
    leadId: null,
  };
}
