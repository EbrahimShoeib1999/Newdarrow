/**
 * Real-estate unit domain — an extensible project TYPE module that plugs into
 * the shared Project model rather than replacing it. Units live in a project
 * subcollection (companies/{id}/projects/{id}/units), exactly like milestones.
 *
 * Financial stance (important): a unit carries its own asking price only. The
 * authoritative money (contracts, invoices, payments) stays in the existing
 * billing/CRM records and is referenced here by id — never duplicated, never
 * faked. Unit valuations below are inventory asking-price rollups, clearly
 * distinct from collected revenue.
 */

export type UnitTypeKey =
  | "apartment"
  | "office"
  | "villa"
  | "townhouse"
  | "retail"
  | "warehouse"
  | "parking"
  | "land"
  | (string & {});

export type UnitStatus = "available" | "reserved" | "sold" | "maintenance" | "withdrawn";

/** Auditable status transition retained on the unit document itself. */
export interface UnitStatusChange {
  from: UnitStatus;
  to: UnitStatus;
  /** ISO string of the actual transition time. */
  at: string;
  /** User id of the actor who performed the transition. */
  by: string;
  /** Optional reason (e.g. why a reservation was released). */
  note?: string;
}

export interface ProjectUnit {
  id: string;
  /** Owning project id — stored for traceability even though the doc lives under the project. */
  projectId: string;
  /** Unique, human-readable unit code within the project (e.g. "A-101"). */
  code: string;
  /** Building / tower label (free text — the property spec, not a separate model). */
  building?: string;
  /** Floor label (free text — keeps the shape simple and configurable). */
  floor?: string;
  unitType: UnitTypeKey;
  /** Saleable area in square metres. */
  area?: number | null;
  /** Asking price in `currency`. Inventory value only — not collected revenue. */
  price: number;
  currency: string;
  status: UnitStatus;
  /** Canonical buyer/prospect (CRM contact id). Never duplicated as free text. */
  buyerContactId?: string | null;
  /** Link to the authoritative sale contract (CRM contract id) when one exists. */
  contractId?: string | null;
  notes?: string;
  statusHistory?: UnitStatusChange[];
  createdAt: string;
  updatedAt: string;
}

export type CreateUnitDTO = Omit<
  ProjectUnit,
  "id" | "projectId" | "statusHistory" | "createdAt" | "updatedAt"
>;
export type UpdateUnitDTO = Partial<Omit<CreateUnitDTO, "projectId">>;

/* -------------------------------------------------------------------------- */
/* Status machine — the real-estate business rules, kept as pure functions.     */
/* -------------------------------------------------------------------------- */

/**
 * Allowed edges. `sold` is terminal on purpose: reversing a sale must go
 * through a corrective contract/invoice flow in billing, never by silently
 * flipping the unit back to available.
 */
export const UNIT_STATUS_TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  available: ["reserved", "sold", "maintenance", "withdrawn"],
  reserved: ["available", "sold", "withdrawn"],
  sold: [],
  maintenance: ["available", "withdrawn"],
  withdrawn: ["available"],
};

export function canTransitionUnit(from: UnitStatus, to: UnitStatus): boolean {
  return (UNIT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * A reservation or sale may only be recorded against a unit that is not already
 * committed, so two active reservations/sales can never coexist on one unit.
 * `available → sold` and `reserved → sold` are legal; anything else is rejected.
 */
export function isCommitmentAllowed(from: UnitStatus, to: UnitStatus): boolean {
  if (to !== "reserved" && to !== "sold") return true;
  // Reaching a committed state is only permitted from an uncommitted one.
  return from === "available" || (to === "sold" && from === "reserved");
}

/* -------------------------------------------------------------------------- */
/* Inventory valuation rollup (asking prices; reconciles against unit total).   */
/* -------------------------------------------------------------------------- */

export interface UnitRollup {
  total: number;
  available: number;
  reserved: number;
  sold: number;
  maintenance: number;
  withdrawn: number;
  /** Total asking-price value of every unit in the inventory. */
  inventoryValue: number;
  /** Asking-price value still marketable (available + maintenance). */
  unsoldValue: number;
  /** Asking-price value currently held by reservations. */
  reservedValue: number;
  /** Asking-price value of units marked sold. */
  soldValue: number;
  /** Sum of areas (sqm) across all units. */
  totalArea: number;
  currency: string;
}

/**
 * Derive unit-level and project-level rollups from the authoritative unit list.
 * Money is asking-price valuation only; collected revenue must be read from the
 * linked invoices/payments elsewhere, so nothing here double-counts finance.
 */
export function computeUnitRollup(
  units: ProjectUnit[],
  fallbackCurrency = "SAR"
): UnitRollup {
  const base: UnitRollup = {
    total: units.length,
    available: 0,
    reserved: 0,
    sold: 0,
    maintenance: 0,
    withdrawn: 0,
    inventoryValue: 0,
    unsoldValue: 0,
    reservedValue: 0,
    soldValue: 0,
    totalArea: 0,
    currency: fallbackCurrency,
  };
  for (const u of units) {
    base[u.status] += 1;
    const price = Number(u.price) || 0;
    base.inventoryValue += price;
    base.totalArea += Number(u.area) || 0;
    if (u.status === "sold") base.soldValue += price;
    else if (u.status === "reserved") base.reservedValue += price;
    else if (u.status === "available" || u.status === "maintenance") base.unsoldValue += price;
    if (!base.currency && u.currency) base.currency = u.currency;
  }
  return base;
}
