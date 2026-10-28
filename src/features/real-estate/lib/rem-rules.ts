/**
 * Real Estate Management — pure domain rules (no Firebase, no React).
 *
 * The ONLY definition of lease lifecycle legality, occupancy derivation,
 * date-overlap math and validation. Both the Firestore service (write-time
 * enforcement) and the UI (button enablement) call these, so a transition can
 * never be legal in one layer and illegal in the other.
 * Unit-tested by scripts/test-rem-unit.ts.
 */

import type {
  LeaseStatus,
  OccupancyRecord,
  OccupancyStatus,
  Unit,
} from "../types/real-estate.types";

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

export function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Local-time YYYY-MM-DD (leases follow local calendars, not UTC). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Inclusive ISO date comparison — lease periods share boundary days. */
export function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function addDaysIso(fromIso: string, days: number): string {
  const base = isValidIsoDate(fromIso) ? fromIso : todayIso();
  const d = new Date(`${base}T00:00:00`);
  const offset = Number.isFinite(days) ? Math.round(days) : 0;
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addMonthsIso(fromIso: string, months: number): string {
  const base = isValidIsoDate(fromIso) ? fromIso : todayIso();
  const d = new Date(`${base}T00:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(months));
  // Clamp to the last valid day of the target month (Jan 31 + 1m -> Feb 28).
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole-month duration heuristic for display; end-exclusive of the extra day. */
export function leaseDurationMonths(startIso: string, endIso: string): number {
  if (!isValidIsoDate(startIso) || !isValidIsoDate(endIso) || endIso < startIso) return 0;
  const s = new Date(`${startIso}T00:00:00`);
  const e = new Date(`${endIso}T00:00:00`);
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  return Math.max(0, months + 1);
}

/* -------------------------------------------------------------------------- */
/* Lease status machine                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Allowed edges. A lease is created as draft; activation is the only path to
 * active. Expiration is applied by the due-date processor (on demand), which
 * must never delete or fabricate history. "renewed" marks the SUPERSEDED
 * original when a renewal lease is activated — the new lease starts active
 * through its own activation edge from draft/pending.
 */
const LEASE_TRANSITIONS: Record<LeaseStatus, readonly LeaseStatus[]> = {
  draft: ["pending_approval", "active", "cancelled"],
  pending_approval: ["active", "draft", "cancelled"],
  active: ["expiring", "expired", "terminated", "renewed"],
  expiring: ["expired", "terminated", "renewed", "active"],
  expired: ["renewed", "terminated"],
  terminated: [],
  cancelled: [],
  renewed: [],
};

export function canTransitionLease(from: LeaseStatus, to: LeaseStatus): boolean {
  return LEASE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextLeaseStatuses(from: LeaseStatus): readonly LeaseStatus[] {
  return LEASE_TRANSITIONS[from] ?? [];
}

export function isTerminalLeaseStatus(status: LeaseStatus): boolean {
  return (LEASE_TRANSITIONS[status]?.length ?? 0) === 0;
}

/** Statuses that occupy the unit's calendar (overlap protection set). */
const BLOCKING_LEASE_STATUSES: readonly LeaseStatus[] = ["draft", "pending_approval", "active", "expiring"];

export function isBlockingLeaseStatus(status: LeaseStatus): boolean {
  return BLOCKING_LEASE_STATUSES.includes(status);
}

/**
 * A lease expiring within N days is flagged "expiring" by the due-date
 * processor. This is a notification-grade transition — it never terminates.
 */
export function shouldFlagExpiring(status: LeaseStatus, endDate: string, windowDays: number, today = todayIso()): boolean {
  if (status !== "active") return false;
  if (!isValidIsoDate(endDate)) return false;
  const soon = addDaysIso(today, Math.max(0, windowDays));
  return endDate <= soon && endDate >= today;
}

/** An active/expiring lease whose end date has passed is expired (processor). */
export function shouldFlagExpired(status: LeaseStatus, endDate: string, today = todayIso()): boolean {
  if (status !== "active" && status !== "expiring") return false;
  return isValidIsoDate(endDate) && endDate < today;
}

/* -------------------------------------------------------------------------- */
/* Lease overlap protection                                                   */
/* -------------------------------------------------------------------------- */

export interface LeaseConflict {
  leaseId: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  status: LeaseStatus;
}

/**
 * The dates of a proposed lease must not intersect any blocking lease on the
 * SAME unit (multi-tenant arrangements are not modeled — one unit, one
 * calendar). Expired/terminated/cancelled/renewed rows do not block.
 */
export function findLeaseOverlap(
  unitId: string,
  startIso: string,
  endIso: string,
  allLeases: {
    id: string;
    unitId: string;
    contractNumber?: string;
    status: LeaseStatus;
    startDate: string;
    endDate: string;
  }[],
  ignoreLeaseId?: string
): LeaseConflict | null {
  for (const l of allLeases) {
    if (l.id === ignoreLeaseId) continue;
    if (l.unitId !== unitId) continue;
    if (!isBlockingLeaseStatus(l.status)) continue;
    if (datesOverlap(startIso, endIso, l.startDate, l.endDate)) {
      return {
        leaseId: l.id,
        contractNumber: l.contractNumber ?? l.id,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Occupancy derivation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Occupancy is DERIVED, never freely typed:
 * - a blocking lease covering TODAY (active/expiring, or draft/pending whose
 *   dates already cover today) => occupied;
 * - a blocking lease starting in the future => reserved;
 * - otherwise the unit's operational status decides
 *   (under_construction/unavailable/archived => unavailable, else vacant).
 * `maintenanceHold` (an open maintenance designation set by the workflow)
 * wins over vacancy but never over an actual lease relationship.
 */
export function deriveOccupancyState(
  unit: Pick<Unit, "operationalStatus">,
  unitLeases: OccupancyRecord[],
  today = todayIso(),
  maintenanceHold = false
): OccupancyStatus {
  let covering = false;
  let future = false;
  for (const l of unitLeases) {
    if (!isBlockingLeaseStatus(l.status)) continue;
    if (!isValidIsoDate(l.startDate) || !isValidIsoDate(l.endDate)) continue;
    if (l.startDate <= today && today <= l.endDate) covering = true;
    else if (l.startDate > today) future = true;
  }
  if (covering) return "occupied";
  if (future) return "reserved";
  if (maintenanceHold) return "under_maintenance";
  if (unit.operationalStatus === "unavailable" || unit.operationalStatus === "archived" || unit.operationalStatus === "under_construction") {
    return "unavailable";
  }
  return "vacant";
}

/** Units under maintenance/unavailable must not be offered as available. */
export function isUnitAvailableForNewLease(
  unit: Pick<Unit, "operationalStatus" | "archived">,
  occupancy: OccupancyStatus
): boolean {
  if (unit.archived) return false;
  if (unit.operationalStatus !== "active") return false;
  return occupancy === "vacant";
}

/* -------------------------------------------------------------------------- */
/* Validation (shared by service writes and forms)                            */
/* -------------------------------------------------------------------------- */

export interface FieldError {
  field: string;
  messageKey: string;
}

export function validatePropertyDraft(draft: {
  nameEn: string;
  propertyType?: string;
  totalArea?: number | null;
  acquisitionPrice?: number | null;
  valuation?: number | null;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.nameEn || draft.nameEn.trim().length < 2) errors.push({ field: "nameEn", messageKey: "validation.nameMin" });
  if (draft.totalArea != null && (!Number.isFinite(draft.totalArea) || draft.totalArea < 0))
    errors.push({ field: "totalArea", messageKey: "validation.area" });
  if (draft.acquisitionPrice != null && (!Number.isFinite(draft.acquisitionPrice) || draft.acquisitionPrice < 0))
    errors.push({ field: "acquisitionPrice", messageKey: "validation.money" });
  if (draft.valuation != null && (!Number.isFinite(draft.valuation) || draft.valuation < 0))
    errors.push({ field: "valuation", messageKey: "validation.money" });
  return errors;
}

export function validateUnitDraft(draft: {
  code: string;
  name: string;
  propertyId: string;
  area?: number | null;
  askingRent?: number | null;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.propertyId) errors.push({ field: "propertyId", messageKey: "validation.propertyRequired" });
  if (!draft.code || !/^[A-Za-z0-9-]{2,24}$/.test(draft.code.trim()))
    errors.push({ field: "code", messageKey: "validation.codeFormat" });
  if (!draft.name || draft.name.trim().length < 1) errors.push({ field: "name", messageKey: "validation.nameRequired" });
  if (draft.area != null && (!Number.isFinite(draft.area) || draft.area < 0))
    errors.push({ field: "area", messageKey: "validation.area" });
  if (draft.askingRent != null && (!Number.isFinite(draft.askingRent) || draft.askingRent < 0))
    errors.push({ field: "askingRent", messageKey: "validation.money" });
  return errors;
}

export function validateLeaseDraft(draft: {
  propertyId: string;
  unitId: string;
  tenantContactId: string;
  startDate: string;
  endDate: string;
  rentAmount: number;
  currency: string;
  dueDay: number;
  depositAmount?: number;
  escalations?: { effectiveDate: string; percent: number }[];
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!draft.propertyId) errors.push({ field: "propertyId", messageKey: "validation.propertyRequired" });
  if (!draft.unitId) errors.push({ field: "unitId", messageKey: "validation.unitRequired" });
  if (!draft.tenantContactId) errors.push({ field: "tenantContactId", messageKey: "validation.tenantRequired" });
  if (!isValidIsoDate(draft.startDate)) errors.push({ field: "startDate", messageKey: "validation.dateIso" });
  if (!isValidIsoDate(draft.endDate)) errors.push({ field: "endDate", messageKey: "validation.dateIso" });
  if (isValidIsoDate(draft.startDate) && isValidIsoDate(draft.endDate) && draft.endDate <= draft.startDate)
    errors.push({ field: "endDate", messageKey: "validation.endAfterStart" });
  if (!Number.isFinite(draft.rentAmount) || draft.rentAmount < 0)
    errors.push({ field: "rentAmount", messageKey: "validation.money" });
  if (!draft.currency || !/^[A-Z]{3}$/.test(draft.currency))
    errors.push({ field: "currency", messageKey: "validation.currency" });
  if (!Number.isInteger(draft.dueDay) || draft.dueDay < 1 || draft.dueDay > 28)
    errors.push({ field: "dueDay", messageKey: "validation.dueDayRange" });
  if (draft.depositAmount != null && (!Number.isFinite(draft.depositAmount) || draft.depositAmount < 0))
    errors.push({ field: "depositAmount", messageKey: "validation.money" });
  for (const esc of draft.escalations ?? []) {
    if (!isValidIsoDate(esc.effectiveDate)) errors.push({ field: "escalations", messageKey: "validation.dateIso" });
    if (!Number.isFinite(esc.percent) || esc.percent < 0 || esc.percent > 100)
      errors.push({ field: "escalations", messageKey: "validation.escalationPercent" });
  }
  return errors;
}

/** Ownership shares: each 0<x<=100; when any share is set the total must be 100. */
export function validateOwnershipAllocation(shares: number[], requireTotal100 = true): FieldError[] {
  const errors: FieldError[] = [];
  for (const s of shares) {
    if (!Number.isFinite(s) || s <= 0 || s > 100) errors.push({ field: "percentage", messageKey: "validation.percentageRange" });
  }
  if (requireTotal100 && shares.length > 0) {
    const total = shares.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.01) errors.push({ field: "percentage", messageKey: "validation.percentageTotal100" });
  }
  return errors;
}

export function validateOwnershipDates(start?: string | null, end?: string | null): FieldError[] {
  const errors: FieldError[] = [];
  if (start && !isValidIsoDate(start)) errors.push({ field: "startDate", messageKey: "validation.dateIso" });
  if (end && !isValidIsoDate(end)) errors.push({ field: "endDate", messageKey: "validation.dateIso" });
  if (start && end && isValidIsoDate(start) && isValidIsoDate(end) && end < start)
    errors.push({ field: "endDate", messageKey: "validation.endAfterStart" });
  return errors;
}

/** A unit with financial/lease/audit history must not be hard-deleted. */
export function canArchiveUnit(hints: {
  leaseCount: number;
  installmentCount: number;
  expenseCount: number;
  inspectionCount: number;
}): { archive: boolean; hardDelete: boolean } {
  const hasHistory = hints.leaseCount + hints.installmentCount + hints.expenseCount + hints.inspectionCount > 0;
  return { archive: true, hardDelete: !hasHistory };
}

/** Overlap check used before finalizing an ownership set. */
export function ownershipDateRangesConflict(
  rows: { startDate?: string | null; endDate?: string | null; contactId: string }[]
): boolean {
  // Same contact twice with overlapping windows is a data-integrity error.
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.contactId !== b.contactId) continue;
      const aStart = a.startDate ?? "0000-01-01";
      const aEnd = a.endDate ?? "9999-12-31";
      const bStart = b.startDate ?? "0000-01-01";
      const bEnd = b.endDate ?? "9999-12-31";
      if (datesOverlap(aStart, aEnd, bStart, bEnd)) return true;
    }
  }
  return false;
}
