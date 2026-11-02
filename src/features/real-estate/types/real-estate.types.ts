/**
 * Real Estate Management & Leasing (REAL_ESTATE_MANAGEMENT activity) — domain types.
 *
 * Records persist in activity-owned collections (rem_properties, rem_units, …)
 * whose names come from the shared naming contract
 * (@/features/activities/types/activity-domain); the Firestore rules gate those
 * prefixes by the tenant's authoritative activity, so a tenant on another
 * activity can neither read nor write them.
 *
 * Every status value is a stable machine id — Arabic/English labels live only
 * in the real-estate i18n namespace and never double as identifiers.
 *
 * Financial architecture (kept deliberately conservative):
 * - Rent installments are durable records with DERIVED paid amounts; payments
 *   are separate immutable-ish records whose allocations reference them.
 * - Security deposits are liability tracking, never rental revenue.
 * - Property expenses reference the shared billing modules (bills/vouchers/
 *   journals) instead of creating a parallel accounting ledger. Full accounting
 *   posting from REM remains an integration boundary (see REM_EXPENSE_GAP doc
 * * * comment in the service).
 */

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export type PropertyType =
  | "residential"
  | "commercial"
  | "administrative"
  | "medical"
  | "mixed_use"
  | "industrial"
  | "other";

/** Operational (business usability) — distinct from unit occupancy. */
export type PropertyStatus = "active" | "under_development" | "archived";

export type MeasurementUnit = "m2" | "ft2";

export interface PropertyDocumentRef {
  id: string;
  name: string;
  /** Firebase Storage URL or inline data URL (repo upload convention). */
  url: string;
  /** Deed / license / title / contract / photo / other. */
  kind: string;
  uploadedAt: string;
}

export interface Property {
  id: string;
  /** Human-stable code allocated transactionally per tenant (PRP-0001…). */
  code: string;
  nameEn: string;
  nameAr?: string | null;
  propertyType: PropertyType;
  status: PropertyStatus;
  country?: string | null;
  city?: string | null;
  district?: string | null;
  street?: string | null;
  buildingAddress?: string | null;
  postalCode?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Acquisition economics — recorded only when the tenant has them. */
  acquisitionDate?: string | null;
  acquisitionPrice?: number | null;
  valuation?: number | null;
  valuationDate?: string | null;
  currency: string;
  totalArea?: number | null;
  commonArea?: number | null;
  areaUnit: MeasurementUnit;
  /** users/{uid} of the responsible property manager. */
  managerId?: string | null;
  notes?: string | null;
  documents: PropertyDocumentRef[];
  /** Soft delete: archived properties stay queryable, never silently removed. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreatePropertyDTO = Omit<Property, "id" | "code" | "documents" | "archived" | "createdAt" | "updatedAt"> &
  Partial<Pick<Property, "documents" | "archived">>;
export type UpdatePropertyDTO = Partial<Omit<Property, "id" | "code" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Buildings & floors                                                         */
/* -------------------------------------------------------------------------- */

export interface Building {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  propertyId: string;
  locationNote?: string | null;
  /** Ordered floor labels within this building. Floors are light structure;
   *  units carry the floorId they sit on. */
  floors: Floor[];
  sharedFacilities?: string | null;
  notes?: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Floor {
  id: string;
  nameEn: string;
  nameAr?: string | null;
  /** Display/ordering position (may be negative for basements). */
  level: number;
}

export type CreateBuildingDTO = Omit<Building, "id" | "code" | "archived" | "createdAt" | "updatedAt"> &
  Partial<Pick<Building, "archived">>;
export type UpdateBuildingDTO = Partial<Omit<Building, "id" | "code" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

export type UnitType =
  | "apartment"
  | "villa"
  | "office"
  | "shop"
  | "clinic"
  | "warehouse"
  | "parking"
  | "storage"
  | "other";

/** Business usability of the physical space — NOT who is inside it. */
export type UnitOperationalStatus = "active" | "under_construction" | "unavailable" | "archived";

/**
 * Occupancy is DERIVED from valid lease/reservation records
 * (see rem lib deriveOccupancyState). The stored value is a cache refreshed by
 * the lease workflow; the derivation is the source of truth.
 */
export type OccupancyStatus = "vacant" | "reserved" | "occupied" | "under_maintenance" | "unavailable";

export interface Unit {
  id: string;
  /** Unique per property (allocated/validated in a transaction). */
  code: string;
  name: string;
  nameAr?: string | null;
  propertyId: string;
  buildingId?: string | null;
  floorId?: string | null;
  unitType: UnitType;
  /** Free-text permitted use / usage classification. */
  usageClassification?: string | null;
  area?: number | null;
  areaUnit: MeasurementUnit;
  bedrooms?: number | null;
  bathrooms?: number | null;
  roomsCount?: number | null;
  parkingSpaces?: number | null;
  layoutNote?: string | null;
  finishingCondition?: string | null;
  furnished: boolean;
  amenities: string[];
  operationalStatus: UnitOperationalStatus;
  /** Workflow-set designation feeding the occupancy derivation. */
  maintenanceHold: boolean;
  occupancyStatus: OccupancyStatus;
  askingRent?: number | null;
  suggestedSalePrice?: number | null;
  currency: string;
  availabilityDate?: string | null;
  availabilityNote?: string | null;
  /** Utility meter identifiers (electric/water/gas) tracked on the unit. */
  meters: UnitMeter[];
  images: PropertyDocumentRef[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnitMeter {
  id: string;
  utility: "electric" | "water" | "gas" | (string & {});
  meterNumber: string;
  label?: string | null;
}

export type CreateUnitDTO = Omit<Unit, "id" | "code" | "occupancyStatus" | "meters" | "images" | "archived" | "amenities" | "createdAt" | "updatedAt"> &
  Partial<Pick<Unit, "code" | "occupancyStatus" | "meters" | "images" | "archived" | "amenities">>;
export type UpdateUnitDTO = Partial<Omit<Unit, "id" | "code" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Owners & ownership                                                         */
/* -------------------------------------------------------------------------- */

export type OwnerType = "individual" | "company";

/**
 * An ownership row links an EXISTING CRM contact (canonical identity — no
 * duplicate personal data) to a property with a share and a validity window.
 */
export interface Ownership {
  id: string;
  propertyId: string;
  ownerType: OwnerType;
  /** crm contacts/{id} — required; tenant identity is never re-modeled here. */
  contactId: string;
  /** Snapshot display only (name at link time); CRM stays the source of truth. */
  displayNameSnapshot?: string | null;
  percentage: number;
  startDate?: string | null;
  endDate?: string | null;
  /** users/{uid} holding encrypted ID docs — least-privilege access notes. */
  idDocumentRefs: PropertyDocumentRef[];
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateOwnershipDTO = Omit<Ownership, "id" | "idDocumentRefs" | "createdAt" | "updatedAt"> &
  Partial<Pick<Ownership, "idDocumentRefs">>;
export type UpdateOwnershipDTO = Partial<Omit<Ownership, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Leases                                                                     */
/* -------------------------------------------------------------------------- */

export type LeaseStatus =
  | "draft"
  | "pending_approval"
  | "active"
  | "expiring"
  | "renewed"
  | "expired"
  | "terminated"
  | "cancelled";

export type PaymentFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";

export type DepositStatus =
  | "expected"
  | "received"
  | "partially_refunded"
  | "fully_refunded"
  | "forfeited";

export interface RentEscalation {
  /** Escalation applies to periods whose start is on/after this date. */
  effectiveDate: string;
  /** Percentage uplift over the base rent (0-100). */
  percent: number;
}

export interface LeaseAmendment {
  id: string;
  at: string;
  by: string;
  summary: string;
  /** Field-level before/after for the audit trail. */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface Lease {
  id: string;
  /** Transactional per-tenant sequence (LSE-0001…). */
  contractNumber: string;
  propertyId: string;
  unitId: string;
  /** CRM contact id of the tenant (individual or company contact). */
  tenantContactId: string;
  tenantDisplayNameSnapshot?: string | null;
  status: LeaseStatus;
  startDate: string;
  endDate: string;
  rentAmount: number;
  currency: string;
  frequency: PaymentFrequency;
  /** Day of month each installment is due (1-28) OR an explicit schedule below. */
  dueDay: number;
  /** When set, overrides dueDay rolling and is used verbatim on generation. */
  customDueDates?: string[];
  /** Paid in advance (installment due at period start) or in arrears. */
  timing: "advance" | "arrears";
  gracePeriodDays: number;
  depositAmount: number;
  depositStatus: DepositStatus;
  escalations: RentEscalation[];
  includedServices?: string | null;
  /** Utilities charged separately (free-text list; meter reads live on unit). */
  chargeableUtilities?: string | null;
  feesAmount: number;
  /** Tax is NOT assumed: 0 unless the tenant explicitly configures it. */
  taxPercent: number;
  taxAmount: number;
  discountAmount: number;
  renewalNote?: string | null;
  terminationReason?: string | null;
  terminatedAt?: string | null;
  /** Set when this lease replaced an older one (renewal chain, originals kept). */
  renewedFromLeaseId?: string | null;
  responsibleUserId?: string | null;
  approvals: { userId: string; at: string }[];
  amendments: LeaseAmendment[];
  documents: PropertyDocumentRef[];
  scheduleGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** What the creation form collects — service derives the rest. */
export interface CreateLeaseDTO {
  propertyId: string;
  unitId: string;
  tenantContactId: string;
  tenantDisplayNameSnapshot?: string | null;
  startDate: string;
  endDate: string;
  rentAmount: number;
  currency: string;
  frequency: PaymentFrequency;
  dueDay: number;
  customDueDates?: string[];
  timing?: "advance" | "arrears";
  gracePeriodDays?: number;
  depositAmount?: number;
  escalations?: RentEscalation[];
  includedServices?: string | null;
  chargeableUtilities?: string | null;
  feesAmount?: number;
  taxPercent?: number;
  taxAmount?: number;
  discountAmount?: number;
  responsibleUserId?: string | null;
  documents?: PropertyDocumentRef[];
}

export type UpdateLeaseDTO = Partial<
  Omit<Lease, "id" | "contractNumber" | "status" | "scheduleGenerated" | "createdAt" | "updatedAt">
>;

/* -------------------------------------------------------------------------- */
/* Rent installments & payments                                               */
/* -------------------------------------------------------------------------- */

export type InstallmentStatus =
  | "upcoming"
  | "due"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export interface RentInstallment {
  id: string;
  leaseId: string;
  unitId: string;
  propertyId: string;
  /** Deterministic idempotency key: `${leaseId}_${periodIndex}` (doc id too). */
  periodKey: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  /** Rent for the period (after escalations). */
  principalAmount: number;
  feesAmount: number;
  taxAmount: number;
  discountAmount: number;
  currency: string;
  /** DERIVED from valid payment allocations — never set directly by a user. */
  paidAmount: number;
  status: InstallmentStatus;
  /** Shared billing reference (invoice id) when the tenant issues invoices. */
  invoiceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Total charged for one installment: principal + fees + tax - discount. */
export function installmentTotal(i: Pick<RentInstallment, "principalAmount" | "feesAmount" | "taxAmount" | "discountAmount">): number {
  return i.principalAmount + i.feesAmount + i.taxAmount - i.discountAmount;
}

export interface PaymentAllocation {
  installmentId: string;
  amount: number;
}

export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card" | "online" | (string & {});

export interface RentPayment {
  id: string;
  leaseId: string;
  unitId: string;
  propertyId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string | null;
  receiptUrl?: string | null;
  allocations: PaymentAllocation[];
  /** Corrections never delete: a void reverses the allocations, audit kept. */
  voided: boolean;
  voidReason?: string | null;
  voidedBy?: string | null;
  voidedAt?: string | null;
  /** Caller-supplied idempotency key so double-submits record one payment. */
  idempotencyKey?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRentPaymentDTO {
  leaseId: string;
  amount: number;
  currency: string;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string | null;
  receiptUrl?: string | null;
  allocations: PaymentAllocation[];
  idempotencyKey?: string;
}

/* -------------------------------------------------------------------------- */
/* Security deposits (liability, not revenue)                                 */
/* -------------------------------------------------------------------------- */

export interface DepositDeduction {
  id: string;
  amount: number;
  reason: string;
  /** Inspection record that evidences the deduction (rem_inspections). */
  inspectionId?: string | null;
  approvedBy?: string | null;
  at: string;
}

export interface DepositRecord {
  id: string;
  leaseId: string;
  unitId: string;
  propertyId: string;
  tenantContactId: string;
  expectedAmount: number;
  receivedAmount: number;
  /** Payment record that funded the deposit. */
  paymentId?: string | null;
  deductions: DepositDeduction[];
  refunds: { id: string; amount: number; at: string; reference?: string | null }[];
  currency: string;
  status: DepositStatus;
  /** Liability still owed to the tenant (derived server-side on every write). */
  outstandingLiability: number;
  finalRefundAmount?: number | null;
  handoverInspectionId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Property expenses                                                          */
/* -------------------------------------------------------------------------- */

export type ExpenseCategory =
  | "maintenance_repairs"
  | "utilities"
  | "management_fees"
  | "insurance"
  | "cleaning_common_area"
  | "government_fees_taxes"
  | "vendor_services"
  | "other";

/**
 * A REM expense is a DOMAIN VIEW over a shared billing record (bill / payment
 * voucher / manual journal) — it stores the property/unit linkage and category
 * plus a reference, NOT a duplicated ledger posting. `amount` is a snapshot for
 * reporting; the referenced billing document stays authoritative.
 */
export interface PropertyExpense {
  id: string;
  propertyId: string;
  unitId?: string | null;
  category: ExpenseCategory;
  /** fm_vendors id (facilities vendor) or free vendor name. */
  vendorId?: string | null;
  vendorNameSnapshot?: string | null;
  description: string;
  amount: number;
  currency: string;
  expenseDate: string;
  /** Accounting period (YYYY-MM) for period reports. */
  accountingPeriod: string;
  approvalStatus: "pending" | "approved" | "rejected";
  approvedBy?: string | null;
  approvedAt?: string | null;
  /** Reference into the canonical billing collections (may be empty when the
   *  expense was recorded directly in REM without a posted document). */
  billId?: string | null;
  voucherId?: string | null;
  journalId?: string | null;
  documents: PropertyDocumentRef[];
  createdBy: string;
  /** Soft-delete marker: financial records are never hard-deleted, the UI
   *  "delete" archives them so history survives and they leave the list. */
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreatePropertyExpenseDTO = Omit<
  PropertyExpense,
  "id" | "approvalStatus" | "accountingPeriod" | "documents" | "createdAt" | "updatedAt" | "approvedBy" | "approvedAt"
> &
  Partial<Pick<PropertyExpense, "approvalStatus" | "documents">>;
export type UpdatePropertyExpenseDTO = Partial<Omit<PropertyExpense, "id" | "createdAt" | "updatedAt">>;

/* -------------------------------------------------------------------------- */
/* Inspections & handovers                                                    */
/* -------------------------------------------------------------------------- */

export type InspectionType =
  | "initial"
  | "move_in"
  | "periodic"
  | "move_out"
  | "final_handover";

export interface ChecklistItem {
  id: string;
  label: string;
  result: "ok" | "issue" | "na";
  note?: string | null;
}

export interface InspectionMeterReading {
  meterId: string;
  meterNumber: string;
  utility: string;
  reading: number;
  photoUrl?: string | null;
}

export interface InspectionIssue {
  id: string;
  description: string;
  estimatedCost?: number | null;
  /** Linked maintenance work order (fm_work_orders) via the integration. */
  workOrderId?: string | null;
}

export interface Inspection {
  id: string;
  /** Transactional per-tenant code (INS-0001…); versions suffix it (-v2). */
  code: string;
  propertyId: string;
  unitId?: string | null;
  leaseId?: string | null;
  type: InspectionType;
  inspectionDate: string;
  /** users/{uid} of the inspector. */
  inspectorId: string;
  conditionNote?: string | null;
  checklist: ChecklistItem[];
  photos: PropertyDocumentRef[];
  meterReadings: InspectionMeterReading[];
  /** Keys/access cards handed over, as free items with counts. */
  handedItems: { id: string; label: string; quantity: number }[];
  issues: InspectionIssue[];
  acknowledgment: { name: string; signedAt?: string | null; note?: string | null } | null;
  /** Finalized inspections are immutable; edits create a superseding version. */
  finalized: boolean;
  finalizedAt?: string | null;
  version: number;
  supersedesInspectionId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateInspectionDTO = Omit<
  Inspection,
  "id" | "code" | "finalized" | "version" | "createdBy" | "createdAt" | "updatedAt"
>;

/** Move-in/move-out handover record tying an inspection to a lease event. */
export interface HandoverRecord {
  id: string;
  leaseId: string;
  unitId: string;
  propertyId: string;
  kind: "move_in" | "move_out";
  handoverDate: string;
  inspectionId?: string | null;
  /** Work orders raised to fix move-out damage. */
  followUpWorkOrderIds: string[];
  note?: string | null;
  completed: boolean;
  completedBy?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Documents (organized attachments on any REM entity)                        */
/* -------------------------------------------------------------------------- */

export type RemEntityType =
  | "property"
  | "unit"
  | "ownership"
  | "lease"
  | "inspection"
  | "expense"
  | "deposit";

export interface RemDocument {
  id: string;
  entityType: RemEntityType;
  entityId: string;
  /** Deed, contract, ID, photo, report… (free kind label, translated in UI). */
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Storage path under the activity-owned partition domain/{collection}/{companyId}/… */
  storagePath?: string | null;
  /** Download URL (or inline data URL fallback per repo convention). */
  url: string;
  /** true = sensitive (IDs, deeds): visible to admins/managers only in UI. */
  sensitive: boolean;
  uploadedBy: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Occupancy derivation (lease-driven cache on the unit)                      */
/* -------------------------------------------------------------------------- */

/** Minimal lease projection needed to derive a unit's occupancy. */
export interface OccupancyRecord {
  id: string;
  unitId: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string;
}
