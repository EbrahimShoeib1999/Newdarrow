import type { ActivityId } from "@/features/activities/types/activity.types";

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
  /**
   * Tenant's primary business activity (stable id, never a display name).
   * Absent means DEFAULT_ACTIVITY (PROJECTS) — the pre-engine behavior.
   * This is the authoritative source for activity-aware routing; the client
   * re-reads it from Firestore and the security rules validate any write.
   */
  primaryActivity?: ActivityId | null;
  createdAt: string;
  updatedAt: string;
}

export type UpdateCompanyProfileDTO = Partial<
  Omit<CompanyProfile, "id" | "createdAt" | "updatedAt">
>;
