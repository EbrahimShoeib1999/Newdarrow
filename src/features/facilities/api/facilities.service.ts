/**
 * Facilities Management — Firestore service.
 *
 * Every collection name comes from the shared activity-domain naming contract
 * (prefix `fm_`), so these writes land exactly in the collections the
 * Firestore rules gate by the tenant's authoritative FACILITIES_MANAGEMENT
 * activity. The service additionally re-enforces the pure domain rules
 * (transition legality, completion-note requirement, money normalization)
 * at write time — the UI is never the only validator.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { domainCollection } from "@/features/activities/types/activity-domain";
import {
  canTransitionWorkOrder,
  requiresCompletionNote,
  normalizeMoney,
  computeNextDue,
  todayIso,
} from "../lib/work-order-rules";
import type {
  Asset,
  CreateAssetDTO,
  CreateFacilityDTO,
  CreatePmScheduleDTO,
  CreateVendorDTO,
  CreateWorkOrderDTO,
  Facility,
  PmSchedule,
  UpdateAssetDTO,
  UpdateFacilityDTO,
  UpdatePmScheduleDTO,
  UpdateVendorDTO,
  UpdateWorkOrderDTO,
  Vendor,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderStatusChange,
} from "../types/facilities.types";

const SERVICE_NAME = "FacilitiesService";

/** withLogging takes a promise; this adapter keeps the call sites readable. */
function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

/** The contract-derived, rules-gated collection names. Never hand-typed. */
export const FM_COLLECTIONS = {
  facilities: domainCollection("FACILITIES_MANAGEMENT", "facilities"), // fm_facilities
  assets: domainCollection("FACILITIES_MANAGEMENT", "assets"), // fm_assets
  workOrders: domainCollection("FACILITIES_MANAGEMENT", "work_orders"), // fm_work_orders
  schedules: domainCollection("FACILITIES_MANAGEMENT", "pm_schedules"), // fm_pm_schedules
  vendors: domainCollection("FACILITIES_MANAGEMENT", "vendors"), // fm_vendors
} as const;

/** Firestore rejects `undefined` — strip before every write (repo convention). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

const conv = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

function normalize<T extends { id: string }>(id: string, data: Record<string, unknown> | undefined): T {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ...d,
    id,
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
    purchaseDate: "purchaseDate" in d ? conv(d.purchaseDate) : undefined,
    lastDoneDate: "lastDoneDate" in d ? conv(d.lastDoneDate) : undefined,
    completedAt: "completedAt" in d ? conv(d.completedAt) : undefined,
  } as unknown as T;
}

async function listCollection<T extends { id: string }>(companyId: string, name: string): Promise<ApiResponse<T[]>> {
  const ref = collection(db, "companies", companyId, name);
  const q = query(ref, orderBy("createdAt", "desc"), limit(300));
  const snap = await getDocs(q);
  return { data: snap.docs.map((d) => normalize<T>(d.id, d.data())), message: "Success" };
}

/* -------------------------------------------------------------------------- */
/* Work-order code sequence (transactional, per-tenant, never reused)          */
/* -------------------------------------------------------------------------- */

interface WoSeqState {
  prefix: string;
  nextNumber: number;
  padding: number;
}
const DEFAULT_WO_SEQ: WoSeqState = { prefix: "WO-", nextNumber: 1, padding: 4 };

async function allocateWorkOrderCode(tx: Transaction, companyId: string): Promise<string> {
  const settingsRef = doc(db, "companies", companyId, "settings", "facilities");
  const snap = await tx.get(settingsRef);
  const seq: WoSeqState = snap.exists()
    ? { ...DEFAULT_WO_SEQ, ...((snap.data() as Record<string, unknown>)?.woSequence as Partial<WoSeqState> | undefined) }
    : DEFAULT_WO_SEQ;
  const code = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
  tx.set(settingsRef, { woSequence: { ...seq, nextNumber: seq.nextNumber + 1 } }, { merge: true });
  return code;
}

/* -------------------------------------------------------------------------- */
/* Facilities                                                                 */
/* -------------------------------------------------------------------------- */

export const FacilityService = {
  async list(companyId: string) {
    return logged("listFacilities", async () =>
      listCollection<Facility>(companyId, FM_COLLECTIONS.facilities));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Facility | null>> {
    return logged("getFacility", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.facilities, id));
      return snap.exists()
        ? { data: normalize<Facility>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, data: CreateFacilityDTO): Promise<ApiResponse<Facility>> {
    return logged("createFacility", async () => {
      const ref = await addDoc(
        collection(db, "companies", companyId, FM_COLLECTIONS.facilities),
        stripUndefined({ ...data, area: data.area ?? null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(ref);
      return { data: normalize<Facility>(snap.id, snap.data()), message: "Facility created" };
    });
  },
  async update(companyId: string, id: string, data: UpdateFacilityDTO): Promise<ApiResponse<Facility>> {
    return logged("updateFacility", async () => {
      await updateDoc(
        doc(db, "companies", companyId, FM_COLLECTIONS.facilities, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.facilities, id));
      return { data: normalize<Facility>(snap.id, snap.data()), message: "Facility updated" };
    });
  },
  /**
   * Hard delete is admin-only by the tenant's UI policy, but records link via
   * id and stay queryable; assets/work orders keep their facilityId (orphan
   * links surface in detail pages as "removed"). Archival (status=closed) is
   * the preferred lifecycle action.
   */
  async remove(companyId: string, id: string) {
    return logged("deleteFacility", async () => {
      await deleteDoc(doc(db, "companies", companyId, FM_COLLECTIONS.facilities, id));
      return { data: null, message: "Facility deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

export const AssetService = {
  async list(companyId: string) {
    return logged("listAssets", async () =>
      listCollection<Asset>(companyId, FM_COLLECTIONS.assets));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Asset | null>> {
    return logged("getAsset", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.assets, id));
      return snap.exists()
        ? { data: normalize<Asset>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, data: CreateAssetDTO): Promise<ApiResponse<Asset>> {
    return logged("createAsset", async () => {
      const ref = await addDoc(
        collection(db, "companies", companyId, FM_COLLECTIONS.assets),
        stripUndefined({
          ...data,
          purchaseCost: data.purchaseCost != null ? normalizeMoney(data.purchaseCost) : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<Asset>(snap.id, snap.data()), message: "Asset created" };
    });
  },
  async update(companyId: string, id: string, data: UpdateAssetDTO): Promise<ApiResponse<Asset>> {
    return logged("updateAsset", async () => {
      await updateDoc(
        doc(db, "companies", companyId, FM_COLLECTIONS.assets, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.assets, id));
      return { data: normalize<Asset>(snap.id, snap.data()), message: "Asset updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteAsset", async () => {
      await deleteDoc(doc(db, "companies", companyId, FM_COLLECTIONS.assets, id));
      return { data: null, message: "Asset deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Work orders                                                                */
/* -------------------------------------------------------------------------- */

export const WorkOrderService = {
  async list(companyId: string) {
    return logged("listWorkOrders", async () =>
      listCollection<WorkOrder>(companyId, FM_COLLECTIONS.workOrders));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<WorkOrder | null>> {
    return logged("getWorkOrder", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id));
      return snap.exists()
        ? { data: normalize<WorkOrder>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, data: CreateWorkOrderDTO): Promise<ApiResponse<WorkOrder>> {
    return logged("createWorkOrder", async () => {
      if (!data.title || data.title.trim().length < 3) throw new Error("Work order title is required (min 3 chars)");
      let created: WorkOrder | null = null;
      await runTransaction(db, async (tx) => {
        const code = await allocateWorkOrderCode(tx, companyId);
        const ref = doc(collection(db, "companies", companyId, FM_COLLECTIONS.workOrders));
        const clean = stripUndefined({
          ...data,
          partsCost: normalizeMoney(data.partsCost ?? 0),
          laborCost: normalizeMoney(data.laborCost ?? 0),
          status: "requested" as WorkOrderStatus,
          statusHistory: [],
        });
        tx.set(ref, { ...clean, code, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        created = { ...clean, id: ref.id, code, status: "requested", statusHistory: [], createdAt: "", updatedAt: "" } as WorkOrder;
      });
      return { data: created!, message: "Work order created" };
    });
  },
  /** Edits descriptive fields and costs ONLY — status moves go through transition(). */
  async update(companyId: string, id: string, data: UpdateWorkOrderDTO): Promise<ApiResponse<WorkOrder>> {
    return logged("updateWorkOrder", async () => {
      const clean = stripUndefined({ ...data, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id), clean);
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id));
      return { data: normalize<WorkOrder>(snap.id, snap.data()), message: "Work order updated" };
    });
  },
  /**
   * The single legal path between statuses. Re-validates the edge server-side
   * (the caller may hold a stale view), stamps the audit entry, freezes costs
   * on completion, requires a note on completion, and rolls a linked
   * preventive schedule forward when the completed service was scheduled.
   */
  async transition(
    companyId: string,
    id: string,
    to: WorkOrderStatus,
    by: string,
    opts?: { note?: string; partsCost?: number; laborCost?: number }
  ): Promise<ApiResponse<WorkOrder>> {
    return logged("transitionWorkOrder", async () => {
      const woSnap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id));
      if (!woSnap.exists()) throw new Error("Work order not found");
      const wo = woSnap.data() as Record<string, unknown>;
      const from = wo.status as WorkOrderStatus;
      if (!canTransitionWorkOrder(from, to)) throw new Error(`Illegal transition ${from} -> ${to}`);
      if (requiresCompletionNote(to) && !(opts?.note ?? "").trim()) {
        throw new Error("A completion note is required to close a work order");
      }
      const history: WorkOrderStatusChange[] = Array.isArray(wo.statusHistory) ? wo.statusHistory : [];
      // Firestore rejects `undefined` ANYWHERE in the write tree — stripUndefined
      // only covers top-level keys, so the audit entry must omit `note` entirely
      // instead of carrying note: undefined for transitions without a comment.
      const trimmedNote = opts?.note?.trim();
      const change: WorkOrderStatusChange = { from, to, at: new Date().toISOString(), by };
      if (trimmedNote) change.note = trimmedNote;
      const patch: Record<string, unknown> = {
        status: to,
        statusHistory: [...history, change],
        updatedAt: serverTimestamp(),
      };
      if (to === "completed") {
        patch.completedAt = serverTimestamp();
        patch.completionNote = opts?.note?.trim() ?? null;
        patch.partsCost = normalizeMoney(opts?.partsCost ?? wo.partsCost ?? 0);
        patch.laborCost = normalizeMoney(opts?.laborCost ?? wo.laborCost ?? 0);
      }
      await updateDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id), stripUndefined(patch));
      if (to === "completed" && wo.scheduleId) {
        const schedRef = doc(db, "companies", companyId, FM_COLLECTIONS.schedules, String(wo.scheduleId));
        const schedSnap = await getDoc(schedRef);
        if (schedSnap.exists()) {
          const s = schedSnap.data() as Record<string, unknown>;
          const done = todayIso();
          await updateDoc(schedRef, {
            lastDoneDate: done,
            nextDueDate: computeNextDue(done, Number(s.intervalDays) || 1, done),
            updatedAt: serverTimestamp(),
          });
        }
      }
      const after = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id));
      return { data: normalize<WorkOrder>(after.id, after.data()), message: "Work order transitioned" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteWorkOrder", async () => {
      await deleteDoc(doc(db, "companies", companyId, FM_COLLECTIONS.workOrders, id));
      return { data: null, message: "Work order deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Preventive-maintenance schedules                                           */
/* -------------------------------------------------------------------------- */

export const ScheduleService = {
  async list(companyId: string) {
    return logged("listSchedules", async () =>
      listCollection<PmSchedule>(companyId, FM_COLLECTIONS.schedules));
  },
  async create(companyId: string, data: CreatePmScheduleDTO): Promise<ApiResponse<PmSchedule>> {
    return logged("createSchedule", async () => {
      const interval = Math.max(1, Math.floor(Number(data.intervalDays) || 1));
      const baseline = data.lastDoneDate || todayIso();
      const ref = await addDoc(
        collection(db, "companies", companyId, FM_COLLECTIONS.schedules),
        stripUndefined({
          ...data,
          intervalDays: interval,
          nextDueDate: computeNextDue(data.lastDoneDate, interval, baseline),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<PmSchedule>(snap.id, snap.data()), message: "Schedule created" };
    });
  },
  async update(companyId: string, id: string, data: UpdatePmScheduleDTO): Promise<ApiResponse<PmSchedule>> {
    return logged("updateSchedule", async () => {
      const clean = stripUndefined({ ...data, updatedAt: serverTimestamp() });
      await updateDoc(doc(db, "companies", companyId, FM_COLLECTIONS.schedules, id), clean);
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.schedules, id));
      return { data: normalize<PmSchedule>(snap.id, snap.data()), message: "Schedule updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteSchedule", async () => {
      await deleteDoc(doc(db, "companies", companyId, FM_COLLECTIONS.schedules, id));
      return { data: null, message: "Schedule deleted" };
    });
  },
  /**
   * Raise the due work order for a schedule. Idempotent per business day:
   * if today's order for this schedule already exists it is returned instead
   * of a duplicate (double-submit / retry safe).
   */
  async generateWorkOrder(companyId: string, scheduleId: string, requestedBy: string): Promise<ApiResponse<WorkOrder>> {
    return logged("generateWorkOrder", async () => {
      const schedSnap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.schedules, scheduleId));
      if (!schedSnap.exists()) throw new Error("Schedule not found");
      const s = schedSnap.data() as Record<string, unknown>;
      const ordersRes = await WorkOrderService.list(companyId);
      const today = todayIso();
      const existing = (ordersRes.data ?? []).find(
        (w) => w.scheduleId === scheduleId && (w.status !== "cancelled") && w.createdAt.slice(0, 10) === today
      );
      if (existing) return { data: existing, message: "Work order already raised today" };
      const res = await WorkOrderService.create(companyId, {
        title: s.title,
        description: s.notes ?? null,
        facilityId: s.facilityId ?? null,
        assetId: s.assetId ?? null,
        assigneeId: s.assigneeId ?? null,
        scheduleId,
        priority: "medium",
        dueDate: String(s.nextDueDate ?? today),
        requestedBy,
        partsCost: 0,
        laborCost: 0,
        currency: s.currency ?? "SAR",
      } as CreateWorkOrderDTO & { notes?: string });
      return { data: res.data, message: "Work order generated from schedule" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Vendors                                                                    */
/* -------------------------------------------------------------------------- */

export const VendorService = {
  async list(companyId: string) {
    return logged("listVendors", async () =>
      listCollection<Vendor>(companyId, FM_COLLECTIONS.vendors));
  },
  async create(companyId: string, data: CreateVendorDTO): Promise<ApiResponse<Vendor>> {
    return logged("createVendor", async () => {
      const ref = await addDoc(
        collection(db, "companies", companyId, FM_COLLECTIONS.vendors),
        stripUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(ref);
      return { data: normalize<Vendor>(snap.id, snap.data()), message: "Vendor created" };
    });
  },
  async update(companyId: string, id: string, data: UpdateVendorDTO): Promise<ApiResponse<Vendor>> {
    return logged("updateVendor", async () => {
      await updateDoc(
        doc(db, "companies", companyId, FM_COLLECTIONS.vendors, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, FM_COLLECTIONS.vendors, id));
      return { data: normalize<Vendor>(snap.id, snap.data()), message: "Vendor updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteVendor", async () => {
      await deleteDoc(doc(db, "companies", companyId, FM_COLLECTIONS.vendors, id));
      return { data: null, message: "Vendor deleted" };
    });
  },
};

/** Set a doc (explicit id) — used by tests/seeding utilities only. */
export async function setDocById(companyId: string, collectionName: string, id: string, data: Record<string, unknown>) {
  await setDoc(doc(db, "companies", companyId, collectionName, id), stripUndefined(data));
}
