/**
 * Real Estate UI helpers — pure color maps keyed by the stable machine ids
 * (never by translated labels), so chips read identically in EN and AR.
 */

import type { TFunction } from "i18next";
import type {
  DepositStatus,
  InstallmentStatus,
  LeaseStatus,
  OccupancyStatus,
  PropertyStatus,
  UnitOperationalStatus,
} from "../types/real-estate.types";

export type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export const PROPERTY_STATUS_COLORS: Record<PropertyStatus, ChipColor> = {
  active: "success",
  under_development: "warning",
  archived: "default",
};

export const OCCUPANCY_COLORS: Record<OccupancyStatus, ChipColor> = {
  vacant: "secondary",
  reserved: "warning",
  occupied: "success",
  under_maintenance: "primary",
  unavailable: "danger",
};

export const UNIT_OPERATIONAL_COLORS: Record<UnitOperationalStatus, ChipColor> = {
  active: "success",
  under_construction: "warning",
  unavailable: "danger",
  archived: "default",
};

export const LEASE_STATUS_COLORS: Record<LeaseStatus, ChipColor> = {
  draft: "default",
  pending_approval: "warning",
  active: "success",
  expiring: "warning",
  renewed: "primary",
  expired: "secondary",
  terminated: "danger",
  cancelled: "danger",
};

export const INSTALLMENT_STATUS_COLORS: Record<InstallmentStatus, ChipColor> = {
  upcoming: "default",
  due: "secondary",
  partially_paid: "warning",
  paid: "success",
  overdue: "danger",
  cancelled: "default",
};

export const DEPOSIT_STATUS_COLORS: Record<DepositStatus, ChipColor> = {
  expected: "warning",
  received: "success",
  partially_refunded: "primary",
  fully_refunded: "default",
  forfeited: "danger",
};

/** Resolve a linked record's display name; missing ref → null (caller shows "—"). */
export function nameOf<T extends { id: string; name?: string; nameEn?: string }>(
  list: readonly T[] | undefined,
  id?: string | null,
): string | null {
  if (!id) return null;
  const hit = list?.find((x) => x.id === id);
  if (!hit) return null;
  return hit.name ?? hit.nameEn ?? null;
}

/** EN/AR preference for the nameEn/nameAr pair used across REM entities. */
export function remName(
  locale: string | undefined,
  entity: { nameEn?: string | null; nameAr?: string | null; name?: string | null },
): string {
  const en = (entity.nameEn ?? entity.name ?? "").trim();
  const ar = (entity.nameAr ?? "").trim();
  if ((locale ?? "").toLowerCase().startsWith("ar")) return ar || en;
  return en || ar;
}

/**
 * Display helper for a CRM contact row (company name wins for organizations)
 * — REM never re-models tenant identity, this only formats the linked record.
 */
export function contactDisplayName(c: {
  accountName?: string | null;
  fullName?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  return (
    c.accountName?.trim() ||
    c.fullName?.trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.email ||
    ""
  );
}

type T = TFunction;

/**
 * Map a thrown DomainValidationError's fieldErrors to { field: translated }.
 * messageKeys look like "validation.nameMin" — the leaf is the JSON key.
 */
export function remFieldErrors(t: T, err: unknown): Record<string, string> {
  const list = (err as { fieldErrors?: { field: string; messageKey: string }[] })?.fieldErrors;
  if (!Array.isArray(list)) return {};
  return Object.fromEntries(
    list.map((e) => [e.field, t(`validation.${e.messageKey.split(".").pop()}`, { defaultValue: t("validation.failed") })]),
  );
}

/** One-line readable message for any REM service error (toast friendly). */
export function remErrorText(t: T, err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err ?? "");
  // Some service errors carry a bound id: "leaseOverlap:<id>" — translate the base.
  msg = msg.split(":")[0];
  return t(`validation.${msg.split(".").pop() ?? msg}`, { defaultValue: t("errors.loadFailed") });
}

