/**
 * Real Estate Management — core registry service (properties, buildings,
 * units, ownerships).
 *
 * Codes (PRP-/BLD-/UNT-) are allocated in a Firestore transaction from the
 * tenant's counter doc, so uniqueness holds under concurrency without relying
 * on client-side duplicate checks. Optional user-supplied unit codes are
 * validated against the property scope before write; the documented residual
 * race on FREE-TEXT codes (serverless web clients cannot query inside a
 * transaction) is why auto-allocation is the default. Cross-entity references
 * (building -> property, unit -> property/building, ownership -> property +
 * CRM contact) are re-read inside the tenant's own subcollections at write
 * time — a foreign id simply does not resolve, and the write is rejected.
 */

import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import {
  REM_COLLECTIONS,
  listCollection,
  listCollectionUnordered,
  normalize,
  allocateRemCode,
  addRecord,
  patchRecord,
  removeRecord,
  getDocData,
  runTransaction,
  doc,
  collection,
  getDocs,
  query,
  where,
  limit as fsLimit,
  serverTimestamp,
  type Transaction,
} from "./rem-base";
import { db } from "@/lib/firebase";
import { stripUndefined } from "./rem-base";
import {
  validatePropertyDraft,
  validateUnitDraft,
  validateOwnershipAllocation,
  validateOwnershipDates,
  ownershipDateRangesConflict,
  deriveOccupancyState,
  canArchiveUnit,
  todayIso,
} from "../lib/rem-rules";
import type {
  Building,
  CreateBuildingDTO,
  CreatePropertyDTO,
  CreateOwnershipDTO,
  CreateUnitDTO,
  Floor,
  HandoverRecord,
  Inspection,
  Lease,
  Ownership,
  Property,
  PropertyExpense,
  RemDocument,
  RentInstallment,
  Unit,
  UpdateBuildingDTO,
  UpdatePropertyDTO,
  UpdateOwnershipDTO,
  UpdateUnitDTO,
} from "../types/real-estate.types";

const SERVICE_NAME = "RemCoreService";
function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

export class DomainValidationError extends Error {
  fieldErrors: { field: string; messageKey: string }[];
  constructor(messageKey: string, fieldErrors: { field: string; messageKey: string }[] = []) {
    super(messageKey);
    this.name = "DomainValidationError";
    this.fieldErrors = fieldErrors;
  }
}

const PROPERTY_DATES = ["acquisitionDate", "valuationDate"];
const OWNERSHIP_DATES = ["startDate", "endDate"];

export interface UnitProfile {
  unit: Unit;
  leases: Lease[];
  installments: RentInstallment[];
  expenses: PropertyExpense[];
  inspections: Inspection[];
  handovers: HandoverRecord[];
  documents: RemDocument[];
}

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export const PropertyService = {
  async list(companyId: string): Promise<ApiResponse<Property[]>> {
    return logged("listProperties", async () => ({
      data: await listCollection<Property>(companyId, REM_COLLECTIONS.properties),
      message: "Success",
    }));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Property | null>> {
    return logged("getProperty", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.properties, id);
      return data
        ? { data: normalize<Property>(id, data, PROPERTY_DATES), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, dto: CreatePropertyDTO): Promise<ApiResponse<Property>> {
    return logged("createProperty", async () => {
      const errors = validatePropertyDraft(dto as never);
      if (errors.length) throw new DomainValidationError("validation.failed", errors);
      let createdId = "";
      await runTransaction(db, async (tx) => {
        const code = await allocateRemCode(tx, companyId, "property");
        const ref = doc(collection(db, "companies", companyId, REM_COLLECTIONS.properties));
        createdId = ref.id;
        tx.set(ref, stripUndefined({
          ...dto,
          code,
          documents: dto.documents ?? [],
          archived: false,
          currency: dto.currency || "SAR",
          areaUnit: dto.areaUnit || "m2",
          status: dto.status || "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      const data = await getDocData(companyId, REM_COLLECTIONS.properties, createdId);
      return { data: normalize<Property>(createdId, data ?? undefined, PROPERTY_DATES), message: "Property created" };
    });
  },
  async update(companyId: string, id: string, dto: UpdatePropertyDTO): Promise<ApiResponse<Property>> {
    return logged("updateProperty", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.properties, id);
      if (!before) throw new DomainValidationError("notFound");
      const merged = { ...(before as object), ...(dto as object) } as Record<string, unknown>;
      const errors = validatePropertyDraft(merged as never);
      if (errors.length) throw new DomainValidationError("validation.failed", errors);
      await patchRecord(companyId, REM_COLLECTIONS.properties, id, dto as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.properties, id);
      return { data: normalize<Property>(id, data ?? undefined, PROPERTY_DATES), message: "Property updated" };
    });
  },
  /** Archive is the preferred removal: related units/leases stay intact. */
  async setArchived(companyId: string, id: string, archived: boolean): Promise<ApiResponse<Property>> {
    return logged("archiveProperty", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.properties, id, { archived });
      const data = await getDocData(companyId, REM_COLLECTIONS.properties, id);
      if (!data) throw new DomainValidationError("notFound");
      return { data: normalize<Property>(id, data, PROPERTY_DATES), message: archived ? "Property archived" : "Property restored" };
    });
  },
  /**
   * Hard delete only when NOTHING links to the property (units, leases,
   * ownerships, expenses, inspections). Financial/audit history blocks it.
   */
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("deleteProperty", async () => {
      const [units, leases, ownerships, expenses, inspections] = await Promise.all([
        listCollectionUnordered<Unit>(companyId, REM_COLLECTIONS.units, [where("propertyId", "==", id)]),
        listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases, [where("propertyId", "==", id)]),
        listCollectionUnordered<Ownership>(companyId, REM_COLLECTIONS.ownerships, [where("propertyId", "==", id)]),
        listCollectionUnordered(companyId, REM_COLLECTIONS.expenses, [where("propertyId", "==", id)]),
        listCollectionUnordered(companyId, REM_COLLECTIONS.inspections, [where("propertyId", "==", id)]),
      ]);
      const blockers =
        units.filter((u) => !u.archived).length + leases.length + ownerships.length + expenses.length + inspections.length;
      if (blockers > 0 || leases.length + expenses.length > 0) throw new DomainValidationError("propertyHasLinkedRecords");
      await removeRecord(companyId, REM_COLLECTIONS.properties, id);
      return { data: null, message: "Property deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Buildings (with embedded floors)                                           */
/* -------------------------------------------------------------------------- */

async function assertPropertyExists(companyId: string, propertyId: string, tx?: Transaction): Promise<void> {
  if (tx) {
    const snap = await tx.get(doc(db, "companies", companyId, REM_COLLECTIONS.properties, propertyId));
    if (!snap.exists()) throw new DomainValidationError("propertyNotFound");
    return;
  }
  const data = await getDocData(companyId, REM_COLLECTIONS.properties, propertyId);
  if (!data) throw new DomainValidationError("propertyNotFound");
}

export const BuildingService = {
  async list(companyId: string): Promise<ApiResponse<Building[]>> {
    return logged("listBuildings", async () => ({
      data: await listCollection<Building>(companyId, REM_COLLECTIONS.buildings),
      message: "Success",
    }));
  },
  /** Units carry buildingId/floorId; counts are derived, never stored. */
  async listWithUnitCounts(companyId: string): Promise<ApiResponse<(Building & { unitCount: number })[]>> {
    return logged("listBuildingsWithCounts", async () => {
      const [buildings, units] = await Promise.all([
        listCollection<Building>(companyId, REM_COLLECTIONS.buildings),
        listCollectionUnordered<Unit>(companyId, REM_COLLECTIONS.units),
      ]);
      const countByBuilding = new Map<string, number>();
      for (const u of units) {
        if (u.buildingId) countByBuilding.set(u.buildingId, (countByBuilding.get(u.buildingId) ?? 0) + 1);
      }
      return {
        data: buildings.map((b) => ({ ...b, unitCount: countByBuilding.get(b.id) ?? 0 })),
        message: "Success",
      };
    });
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Building | null>> {
    return logged("getBuilding", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.buildings, id);
      return data ? { data: normalize<Building>(id, data), message: "Success" } : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, dto: CreateBuildingDTO): Promise<ApiResponse<Building>> {
    return logged("createBuilding", async () => {
      if (!dto.nameEn || dto.nameEn.trim().length < 2) throw new DomainValidationError("validation.failed", [{ field: "nameEn", messageKey: "validation.nameMin" }]);
      let createdId = "";
      await runTransaction(db, async (tx) => {
        await assertPropertyExists(companyId, dto.propertyId, tx);
        const code = await allocateRemCode(tx, companyId, "building");
        const ref = doc(collection(db, "companies", companyId, REM_COLLECTIONS.buildings));
        createdId = ref.id;
        tx.set(ref, stripUndefined({
          ...dto,
          code,
          floors: (dto.floors ?? []).map((f) => ({ ...f, id: f.id || cryptoRandomId() })),
          archived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      const data = await getDocData(companyId, REM_COLLECTIONS.buildings, createdId);
      return { data: normalize<Building>(createdId, data ?? undefined), message: "Building created" };
    });
  },
  async update(companyId: string, id: string, dto: UpdateBuildingDTO): Promise<ApiResponse<Building>> {
    return logged("updateBuilding", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.buildings, id);
      if (!before) throw new DomainValidationError("notFound");
      if (dto.propertyId && dto.propertyId !== before.propertyId) await assertPropertyExists(companyId, dto.propertyId);
      // Units must stay consistent with a moved building — block property moves
      // once units exist (they would silently orphan their building context).
      if (dto.propertyId && dto.propertyId !== before.propertyId) {
        const units = await listCollectionUnordered<Unit>(companyId, REM_COLLECTIONS.units, [where("buildingId", "==", id)]);
        if (units.length > 0) throw new DomainValidationError("buildingHasUnits");
      }
      const floors = (dto.floors ?? (before.floors as Floor[] | undefined) ?? []).map((f) => ({ ...f, id: f.id || cryptoRandomId() }));
      await patchRecord(companyId, REM_COLLECTIONS.buildings, id, stripUndefined({ ...dto, floors }) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.buildings, id);
      return { data: normalize<Building>(id, data ?? undefined), message: "Building updated" };
    });
  },
  async setArchived(companyId: string, id: string, archived: boolean): Promise<ApiResponse<Building>> {
    return logged("archiveBuilding", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.buildings, id, { archived });
      const data = await getDocData(companyId, REM_COLLECTIONS.buildings, id);
      if (!data) throw new DomainValidationError("notFound");
      return { data: normalize<Building>(id, data), message: "Building archived" };
    });
  },
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("deleteBuilding", async () => {
      const units = await listCollectionUnordered<Unit>(companyId, REM_COLLECTIONS.units, [where("buildingId", "==", id)]);
      if (units.length > 0) throw new DomainValidationError("buildingHasUnits");
      await removeRecord(companyId, REM_COLLECTIONS.buildings, id);
      return { data: null, message: "Building deleted" };
    });
  },
};

function cryptoRandomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------------------------- */
/* Units                                                                      */
/* -------------------------------------------------------------------------- */

async function leasesOfUnit(companyId: string, unitId: string): Promise<Pick<Lease, "id" | "unitId" | "status" | "startDate" | "endDate">[]> {
  const leases = await listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases, [where("unitId", "==", unitId)]);
  return leases.map((l) => ({ id: l.id, unitId: l.unitId, status: l.status, startDate: l.startDate, endDate: l.endDate }));
}

/** Recompute and persist the unit's derived occupancy cache. */
async function refreshOccupancy(companyId: string, unit: Unit): Promise<string> {
  const unitLeases = await leasesOfUnit(companyId, unit.id);
  const occupancy = deriveOccupancyState(unit, unitLeases, todayIso(), Boolean(unit.maintenanceHold));
  if (occupancy !== unit.occupancyStatus) {
    await patchRecord(companyId, REM_COLLECTIONS.units, unit.id, { occupancyStatus: occupancy });
  }
  return occupancy;
}

export const UnitService = {
  async list(companyId: string): Promise<ApiResponse<Unit[]>> {
    return logged("listUnits", async () => ({
      data: await listCollection<Unit>(companyId, REM_COLLECTIONS.units),
      message: "Success",
    }));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Unit | null>> {
    return logged("getUnit", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.units, id);
      return data ? { data: normalize<Unit>(id, data), message: "Success" } : { data: null, message: "Not found" };
    });
  },
  /**
   * Create a unit. With `dto.code` set, uniqueness is checked against the
   * property scope (residual race documented above); without it, the tenant
   * transaction sequence allocates the code — fully concurrency-safe.
   */
  async create(companyId: string, dto: CreateUnitDTO): Promise<ApiResponse<Unit>> {
    return logged("createUnit", async () => {
      const errors = validateUnitDraft({ ...dto, code: dto.code ?? "" });
      // code format only matters when supplied; auto-allocation always valid.
      const fieldErrors = errors.filter((e) => !(e.field === "code" && !dto.code));
      if (fieldErrors.length) throw new DomainValidationError("validation.failed", fieldErrors);
      if (dto.code) {
        const clash = await listCollectionUnordered<Unit>(companyId, REM_COLLECTIONS.units, [
          where("propertyId", "==", dto.propertyId),
          where("code", "==", dto.code.trim().toUpperCase()),
        ]);
        if (clash.length > 0) throw new DomainValidationError("validation.unitCodeDuplicate");
      }
      let createdId = "";
      await runTransaction(db, async (tx) => {
        await assertPropertyExists(companyId, dto.propertyId, tx);
        if (dto.buildingId) {
          const bSnap = await tx.get(doc(db, "companies", companyId, REM_COLLECTIONS.buildings, dto.buildingId));
          if (!bSnap.exists()) throw new DomainValidationError("buildingNotFound");
          const b = bSnap.data() as Record<string, unknown>;
          if (b.propertyId !== dto.propertyId) throw new DomainValidationError("buildingPropertyMismatch");
        }
        const code = dto.code?.trim().toUpperCase() || (await allocateRemCode(tx, companyId, "unit"));
        const ref = doc(collection(db, "companies", companyId, REM_COLLECTIONS.units));
        createdId = ref.id;
        tx.set(ref, stripUndefined({
          ...dto,
          code,
          nameAr: dto.nameAr ?? null,
          occupancyStatus: "vacant",
          meters: dto.meters ?? [],
          images: dto.images ?? [],
          amenities: dto.amenities ?? [],
          archived: false,
          currency: dto.currency || "SAR",
          areaUnit: dto.areaUnit || "m2",
          operationalStatus: dto.operationalStatus || "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      const data = await getDocData(companyId, REM_COLLECTIONS.units, createdId);
      return { data: normalize<Unit>(createdId, data ?? undefined), message: "Unit created" };
    });
  },
  /**
   * Descriptive edits. occupancyStatus is NOT accepted from callers — it is
   * derived from lease records by the lease workflow (refreshOccupancy); an
   * editable status that could contradict lease data is by design impossible.
   */
  async update(companyId: string, id: string, dto: UpdateUnitDTO): Promise<ApiResponse<Unit>> {
    return logged("updateUnit", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.units, id);
      if (!before) throw new DomainValidationError("notFound");
      const { occupancyStatus: _ignored, ...rest } = dto as Record<string, unknown>;
      const merged = { ...(before as object), ...rest } as Record<string, unknown>;
      const errors = validateUnitDraft(merged as never).filter((e) => !(e.field === "code"));
      if (errors.length) throw new DomainValidationError("validation.failed", errors);
      if (rest.propertyId && rest.propertyId !== before.propertyId) await assertPropertyExists(companyId, String(rest.propertyId));
      await patchRecord(companyId, REM_COLLECTIONS.units, id, rest as Record<string, unknown>);
      const after = await getDocData(companyId, REM_COLLECTIONS.units, id);
      const unit = normalize<Unit>(id, after ?? undefined);
      await refreshOccupancy(companyId, unit);
      const fresh = await getDocData(companyId, REM_COLLECTIONS.units, id);
      return { data: normalize<Unit>(id, fresh ?? undefined), message: "Unit updated" };
    });
  },
  /**
   * Flag a unit under maintenance (operational designation, not occupancy).
   * Occupancy re-derives immediately: maintenance never overrides a live lease.
   */
  async setMaintenanceHold(companyId: string, id: string, hold: boolean): Promise<ApiResponse<Unit>> {
    return logged("setUnitMaintenanceHold", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.units, id, { maintenanceHold: hold } as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.units, id);
      if (!data) throw new DomainValidationError("notFound");
      const unit = normalize<Unit>(id, data);
      await refreshOccupancy(companyId, unit);
      const fresh = await getDocData(companyId, REM_COLLECTIONS.units, id);
      return { data: normalize<Unit>(id, fresh ?? undefined), message: hold ? "Unit marked under maintenance" : "Maintenance flag cleared" };
    });
  },
  async setArchived(companyId: string, id: string, archived: boolean): Promise<ApiResponse<Unit>> {
    return logged("archiveUnit", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.units, id, { archived });
      const data = await getDocData(companyId, REM_COLLECTIONS.units, id);
      if (!data) throw new DomainValidationError("notFound");
      return { data: normalize<Unit>(id, data), message: archived ? "Unit archived" : "Unit restored" };
    });
  },
  /**
   * Hard delete is refused once ANY lease/installment/expense/inspection
   * history exists — archive instead (audit + financial preservation).
   */
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("deleteUnit", async () => {
      const [leases, installments, expenses, inspections] = await Promise.all([
        leasesOfUnit(companyId, id),
        listCollectionUnordered(companyId, REM_COLLECTIONS.installments, [where("unitId", "==", id)]),
        listCollectionUnordered(companyId, REM_COLLECTIONS.expenses, [where("unitId", "==", id)]),
        listCollectionUnordered(companyId, REM_COLLECTIONS.inspections, [where("unitId", "==", id)]),
      ]);
      const verdict = canArchiveUnit({
        leaseCount: leases.length,
        installmentCount: installments.length,
        expenseCount: expenses.length,
        inspectionCount: inspections.length,
      });
      if (!verdict.hardDelete) throw new DomainValidationError("unitHasHistory");
      await removeRecord(companyId, REM_COLLECTIONS.units, id);
      return { data: null, message: "Unit deleted" };
    });
  },
  /** Profile rollups derived from relations (never stored duplicates). */
  async profile(companyId: string, id: string): Promise<ApiResponse<UnitProfile | null>> {
    return logged("unitProfile", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.units, id);
      if (!data) return { data: null, message: "Not found" };
      const unit = normalize<Unit>(id, data);
      const [leases, installments, expenses, inspections, handovers, documents] = await Promise.all([
        listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases, [where("unitId", "==", id)]),
        listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [where("unitId", "==", id)]),
        listCollectionUnordered<PropertyExpense>(companyId, REM_COLLECTIONS.expenses, [where("unitId", "==", id)]),
        listCollectionUnordered<Inspection>(companyId, REM_COLLECTIONS.inspections, [where("unitId", "==", id)]),
        listCollectionUnordered<HandoverRecord>(companyId, REM_COLLECTIONS.handovers, [where("unitId", "==", id)]),
        listCollectionUnordered<RemDocument>(companyId, REM_COLLECTIONS.documents, [where("entityId", "==", id)]),
      ]);
      const occupancy = await refreshOccupancy(companyId, unit);
      return {
        data: {
          unit: { ...unit, occupancyStatus: occupancy as Unit["occupancyStatus"] },
          leases,
          installments,
          expenses,
          inspections,
          handovers,
          documents,
        },
        message: "Success",
      };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Ownerships (CRM-linked)                                                    */
/* -------------------------------------------------------------------------- */

export const OwnershipService = {
  async list(companyId: string): Promise<ApiResponse<Ownership[]>> {
    return logged("listOwnerships", async () => ({
      data: await listCollection<Ownership>(companyId, REM_COLLECTIONS.ownerships),
      message: "Success",
    }));
  },
  async listForProperty(companyId: string, propertyId: string): Promise<ApiResponse<Ownership[]>> {
    return logged("listPropertyOwnerships", async () => ({
      data: await listCollectionUnordered<Ownership>(companyId, REM_COLLECTIONS.ownerships, [where("propertyId", "==", propertyId)]),
      message: "Success",
    }));
  },
  async create(companyId: string, dto: CreateOwnershipDTO): Promise<ApiResponse<Ownership>> {
    return logged("createOwnership", async () => {
      await assertPropertyExists(companyId, dto.propertyId);
      // Canonical identity: the contact must exist in this tenant's CRM.
      const contactSnap = await getDocs(query(
        collection(db, "companies", companyId, "contacts"),
        where("__name__", "==", dto.contactId),
        fsLimit(1)
      ));
      if (contactSnap.empty) throw new DomainValidationError("tenantContactMissing");
      const dateErrors = validateOwnershipDates(dto.startDate, dto.endDate);
      if (dateErrors.length) throw new DomainValidationError("validation.failed", dateErrors);
      const existing = await listCollectionUnordered<Ownership>(companyId, REM_COLLECTIONS.ownerships, [where("propertyId", "==", dto.propertyId)]);
      const rows = [...existing.filter((e) => (e.endDate ?? "") === "" || !e.endDate || e.endDate >= todayIso()), dto];
      if (ownershipDateRangesConflict(rows)) throw new DomainValidationError("ownershipDateConflict");
      const id = await addRecord(companyId, REM_COLLECTIONS.ownerships, stripUndefined({
        ...dto,
        idDocumentRefs: dto.idDocumentRefs ?? [],
      }) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.ownerships, id);
      return { data: normalize<Ownership>(id, data ?? undefined, OWNERSHIP_DATES), message: "Owner linked" };
    });
  },
  async update(companyId: string, id: string, dto: UpdateOwnershipDTO): Promise<ApiResponse<Ownership>> {
    return logged("updateOwnership", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.ownerships, id);
      if (!before) throw new DomainValidationError("notFound");
      await patchRecord(companyId, REM_COLLECTIONS.ownerships, id, dto as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.ownerships, id);
      return { data: normalize<Ownership>(id, data ?? undefined, OWNERSHIP_DATES), message: "Ownership updated" };
    });
  },
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("deleteOwnership", async () => {
      await removeRecord(companyId, REM_COLLECTIONS.ownerships, id);
      return { data: null, message: "Ownership removed" };
    });
  },
  /**
   * Finalize check the UI must pass before saving an ownership set where the
   * tenant requires full allocation: shares must total 100%.
   */
  validateAllocation(shares: number[]): { ok: boolean; messageKey?: string } {
    const errors = validateOwnershipAllocation(shares, true);
    return errors.length ? { ok: false, messageKey: errors[0].messageKey } : { ok: true };
  },
};
