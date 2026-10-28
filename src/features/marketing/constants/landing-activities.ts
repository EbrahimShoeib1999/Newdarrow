/**
 * Public marketing catalog of business activities/services.
 *
 * This is a PRESENTATION concern, deliberately separate from the internal
 * activity registry that gates tenant navigation. It reuses the registry as
 * the single source of truth for identity + bilingual copy + real
 * availability (`moduleLive`) so the public page can never claim a service is
 * "available" when its workflows are not actually shipped.
 *
 * Rules encoded here (see P0 spec Phase 1):
 * - Every supported activity is listed, including ones not enabled for a
 *   given tenant — visitors see the full product scope.
 * - `live` mirrors ACTIVITY_REGISTRY.moduleLive: only genuinely implemented
 *   domains are marked Available; the rest are honest "Coming soon".
 * - No entry performs an internal action: cards link to public routes only
 *   (register / login). They never change tenant configuration or open an
 *   internal, permission-gated workspace route.
 */

import {
  Building,
  FolderKanban,
  GraduationCap,
  Hammer,
  Megaphone,
  Stethoscope,
  Store,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  ACTIVITY_IDS,
  ACTIVITY_REGISTRY,
  type ActivityId,
} from "@/features/activities/types/activity.types";

export type PublicActivityCard = {
  /** Stable registry id — never a display name. */
  id: ActivityId;
  icon: LucideIcon;
  /** Bilingual copy sourced straight from the registry (no duplication). */
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  /** True only when the domain module is actually implemented + mounted. */
  live: boolean;
};

/** Icons are display-only; keyed by stable id so renames can't break them. */
const ACTIVITY_ICONS: Record<ActivityId, LucideIcon> = {
  PROJECTS: FolderKanban,
  REAL_ESTATE_MANAGEMENT: Building,
  REAL_ESTATE_BROKERAGE: Store,
  FACILITIES_MANAGEMENT: Wrench,
  REAL_ESTATE_DEVELOPMENT: Hammer,
  MARKETING_AGENCY: Megaphone,
  MEDICAL_CLINIC: Stethoscope,
  SCHOOL_MANAGEMENT: GraduationCap,
};

/**
 * Derived from the registry, so adding a new activity to the product automatically
 * surfaces it here (disabled until its module ships) — no second list to maintain.
 */
export const PUBLIC_ACTIVITY_CARDS: PublicActivityCard[] = ACTIVITY_IDS.map((id) => {
  const meta = ACTIVITY_REGISTRY[id];
  return {
    id,
    icon: ACTIVITY_ICONS[id],
    nameEn: meta.labels.en,
    nameAr: meta.labels.ar,
    descEn: meta.description.en,
    descAr: meta.description.ar,
    live: meta.moduleLive,
  };
});
