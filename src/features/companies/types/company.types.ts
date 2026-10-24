export interface CompanyProfile {
  id: string;
  name: string;
  nameAr?: string;
  commercialRegister: string;
  taxNumber?: string;
  legalName?: string;
  email?: string;
  phone?: string;
  /**
   * Tenant-configured WhatsApp support number (the assistant's support entry
   * reads this; the number is never invented by the app). Digits and an optional
   * leading + only.
   */
  whatsappSupportPhone?: string;
  address?: string;
  city?: string;
  country?: string;
  defaultCurrency: string;
  /** URL of the company's logo image. Editable by super_admin only. */
  logoUrl?: string;
  /** Hex color, e.g. "#ff6b4a" — overrides the app's default primary brand color for this company. */
  brandColor?: string;
  /** Hex color, e.g. "#d53a81" — overrides the app's default secondary brand color for this company. */
  brandSecondaryColor?: string;
  createdAt: string;
  updatedAt: string;
}

export type UpdateCompanyProfileDTO = Partial<
  Omit<CompanyProfile, "id" | "createdAt" | "updatedAt">
>;
