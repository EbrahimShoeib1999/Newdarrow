/**
 * Facilities Management (FACILITIES_MANAGEMENT activity) — domain types.
 *
 * Records persist in activity-owned collections (fm_facilities, fm_assets,
 * fm_work_orders, fm_pm_schedules, fm_vendors) whose names come from the
 * shared naming contract (see @/features/activities/types/activity-domain);
 * the Firestore rules gate those prefixes by the tenant's authoritative
 * activity, so a tenant on another activity can neither read nor write them.
 *
 * Every status value is a stable machine id — Arabic/English labels live only
 * in the facilities i18n namespace and never double as identifiers.
 */

/* -------------------------------------------------------------------------- */
/* Facilities (buildings / floors / rooms / sites)                            */
/* -------------------------------------------------------------------------- */

export type FacilityKind = "building" | "floor" | "room" | "site";

export type FacilityStatus = "operational" | "under_maintenance" | "closed";

export interface Facility {
  id: string;
  name: string;
  kind: FacilityKind;
  /** Free-form physical description: city, tower, wing, floor number… */
  location?: string | null;
  /** Square meters, when known. */
  area?: number | null;
  status: FacilityStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateFacilityDTO = Omit<Facility, "id" | "createdAt" | "updatedAt">;
export type UpdateFacilityDTO = Partial<Omit<Facility, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Managed assets                                                             */
/* -------------------------------------------------------------------------- */

export type AssetCategory =
  | "hvac"
  | "electrical"
  | "plumbing"
  | "elevator"
  | "fire_safety"
  | "security"
  | "cleaning"
  | "it"
  | "vehicle"
  | "furniture"
  | "other";

/** Physical condition — maintained separately from lifecycle status. */
export type AssetCondition = "good" | "fair" | "poor" | "out_of_service";

/** Lifecycle is archival, never destructive: retired records stay queryable. */
export type AssetLifecycle = "active" | "retired";

export interface Asset {
  id: string;
  /** Asset tag / serial shown on the physical sticker; unique per tenant by convention. */
  tag: string;
  name: string;
  category: AssetCategory;
  /** Explicit relationship into fm_facilities. Null = floating/unlocated. */
  facilityId?: string | null;
  /** Sub-location within the facility (room label, grid reference…). */
  location?: string | null;
  condition: AssetCondition;
  lifecycle: AssetLifecycle;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  currency: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateAssetDTO = Omit<Asset, "id" | "createdAt" | "updatedAt">;
export type UpdateAssetDTO = Partial<Omit<Asset, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Work orders                                                                */
/* -------------------------------------------------------------------------- */

export type WorkOrderPriority = "low" | "medium" | "high" | "urgent";

export type WorkOrderStatus =
  | "requested"
  | "assigned"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "cancelled";

export interface WorkOrderStatusChange {
  from: WorkOrderStatus;
  to: WorkOrderStatus;
  at: string;
  by: string;
  note?: string;
}

/**
 * Maintenance spend is recorded in TWO distinct buckets (parts and labor) so
 * reports never conflate them, and totals are always derived — never stored,
 * which prevents the two from ever disagreeing.
 */
export interface WorkOrder {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  facilityId?: string | null;
  assetId?: string | null;
  vendorId?: string | null;
  /** users/{uid} of the technician/staff doing the work. */
  assigneeId?: string | null;
  /** Set when the order was generated from a preventive schedule. */
  scheduleId?: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  dueDate?: string | null;
  requestedBy: string;
  partsCost: number;
  laborCost: number;
  currency: string;
  completionNote?: string | null;
  completedAt?: string | null;
  statusHistory: WorkOrderStatusChange[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkOrderDTO {
  title: string;
  description?: string | null;
  facilityId?: string | null;
  assetId?: string | null;
  vendorId?: string | null;
  assigneeId?: string | null;
  scheduleId?: string | null;
  priority: WorkOrderPriority;
  dueDate?: string | null;
  requestedBy: string;
  partsCost?: number;
  laborCost?: number;
  currency: string;
}
export type UpdateWorkOrderDTO = Partial<Omit<WorkOrder, "id" | "statusHistory" | "status">>;

/* -------------------------------------------------------------------------- */
/* Preventive-maintenance schedules                                           */
/* -------------------------------------------------------------------------- */

export interface PmSchedule {
  id: string;
  title: string;
  assetId?: string | null;
  facilityId?: string | null;
  /** Every N days the service is due. Must be >= 1. */
  intervalDays: number;
  lastDoneDate?: string | null;
  /** Derived and maintained by the service on create and on completion roll-over. */
  nextDueDate: string;
  assigneeId?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreatePmScheduleDTO = Omit<PmSchedule, "id" | "createdAt" | "updatedAt">;
export type UpdatePmScheduleDTO = Partial<Omit<PmSchedule, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Vendors                                                                    */
/* -------------------------------------------------------------------------- */

export interface Vendor {
  id: string;
  name: string;
  category: AssetCategory | "general";
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Free-text service-contract summary (dates & amounts stay in shared billing). */
  notes?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateVendorDTO = Omit<Vendor, "id" | "createdAt" | "updatedAt">;
export type UpdateVendorDTO = Partial<Omit<Vendor, "id" | "createdAt" | "updatedAt">>;
