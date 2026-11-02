/**
 * Real Estate Management — operations service: inspections, handovers,
 * property expenses, documents, meter readings and idempotent reminders.
 *
 * Integrations (kept inside the existing architecture, no parallel systems):
 * - Maintenance: work orders are created through the FACILITIES module's
 *   WorkOrderService (its own fm_ collections and lifecycle) and linked by id.
 *   This module never re-implements a work-order workflow.
 * - Expenses: a REM expense is a domain VIEW over shared billing documents —
 *   it stores the property/unit linkage plus a reference (bill/voucher/journal)
 *   and an amount snapshot for reporting. It never posts ledger entries itself;
 *   accounting approval mirrors the shared bills contract (only a reviewer may
 *   set approved/rejected — enforced client-side like bills, as firestore.rules
 *   allows company members generic subcollection writes; documented gap).
 * - Reminders: written into the SHARED `notifications` collection with a
 *   deterministic doc id per (type, entity, period), so repeated dashboard
 *   loads create zero duplicates and notification creation is idempotent by
 *   construction.
 */

import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { db } from "@/lib/firebase";
import { uploadStorageFile } from "@/lib/storage-utils";
import { WorkOrderService } from "@/features/facilities/api/facilities.service";
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
  stripUndefined,
  runTransaction,
  doc,
  collection,
  getDoc,
  setDoc,
  serverTimestamp,
  where,
} from "./rem-base";
import { DomainValidationError } from "./rem-core.service";
import { normalizeMoney } from "../lib/rem-finance";
import { isValidIsoDate, todayIso } from "../lib/rem-rules";
import type {
  CreateInspectionDTO,
  CreatePropertyExpenseDTO,
  HandoverRecord,
  Inspection,
  PropertyExpense,
  RemDocument,
  RemEntityType,
  RentInstallment,
  Lease,
  Property,
  Unit,
} from "../types/real-estate.types";

const SERVICE_NAME = "RemOpsService";
function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

const INSPECTION_DATES = ["inspectionDate", "finalizedAt"];

/* -------------------------------------------------------------------------- */
/* Inspections — finalize freezes evidence; edits create a new version        */
/* -------------------------------------------------------------------------- */

export const InspectionService = {
  async list(companyId: string): Promise<ApiResponse<Inspection[]>> {
    return logged("listInspections", async () => ({
      data: await listCollection<Inspection>(companyId, REM_COLLECTIONS.inspections),
      message: "Success",
    }));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Inspection | null>> {
    return logged("getInspection", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      return data ? { data: normalize<Inspection>(id, data, INSPECTION_DATES), message: "Success" } : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, dto: CreateInspectionDTO, by: string): Promise<ApiResponse<Inspection>> {
    return logged("createInspection", async () => {
      if (!isValidIsoDate(dto.inspectionDate)) throw new DomainValidationError("validation.failed", [{ field: "inspectionDate", messageKey: "validation.dateIso" }]);
      if (!dto.propertyId) throw new DomainValidationError("validation.failed", [{ field: "propertyId", messageKey: "validation.propertyRequired" }]);
      let createdId = "";
      await runTransaction(db, async (tx) => {
        const code = await allocateRemCode(tx, companyId, "inspection");
        const ref = doc(collection(db, "companies", companyId, REM_COLLECTIONS.inspections));
        createdId = ref.id;
        tx.set(ref, stripUndefined({
          ...dto,
          code,
          checklist: dto.checklist ?? [],
          photos: dto.photos ?? [],
          meterReadings: dto.meterReadings ?? [],
          handedItems: dto.handedItems ?? [],
          issues: dto.issues ?? [],
          acknowledgment: dto.acknowledgment ?? null,
          finalized: false,
          version: 1,
          createdBy: by,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, createdId);
      return { data: normalize<Inspection>(createdId, data ?? undefined, INSPECTION_DATES), message: "Inspection created" };
    });
  },
  /** Draft edits only — a finalized inspection is immutable by design. */
  async update(companyId: string, id: string, dto: Partial<Inspection>): Promise<ApiResponse<Inspection>> {
    return logged("updateInspection", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      if (!before) throw new DomainValidationError("notFound");
      if (before.finalized) throw new DomainValidationError("inspectionFinalizedUseVersion");
      const { id: _i, createdBy: _c, createdAt: _cr, updatedAt: _up, finalized: _f, version: _v, ...rest } = dto as Record<string, unknown> & Inspection;
      await patchRecord(companyId, REM_COLLECTIONS.inspections, id, stripUndefined(rest) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      return { data: normalize<Inspection>(id, data ?? undefined, INSPECTION_DATES), message: "Inspection updated" };
    });
  },
  async finalize(companyId: string, id: string): Promise<ApiResponse<Inspection>> {
    return logged("finalizeInspection", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      if (!data) throw new DomainValidationError("notFound");
      await patchRecord(companyId, REM_COLLECTIONS.inspections, id, { finalized: true, finalizedAt: new Date().toISOString() });
      const after = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      return { data: normalize<Inspection>(id, after ?? undefined, INSPECTION_DATES), message: "Inspection finalized" };
    });
  },
  /**
   * Correction after finalization: the original row is NEVER changed — a new
   * version (version+1) supersedes it, keeping the full evidence chain.
   */
  async createVersion(companyId: string, id: string, changes: Partial<Inspection>, by: string): Promise<ApiResponse<Inspection>> {
    return logged("createInspectionVersion", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, id);
      if (!data) throw new DomainValidationError("notFound");
      const base = normalize<Inspection>(id, data, INSPECTION_DATES);
      if (!base.finalized) {
        // Not frozen yet — edit in place instead of spawning a pointless version.
        return InspectionService.update(companyId, id, changes);
      }
      const { id: _i, code: _c, createdAt: _cr, updatedAt: _up, ...rest } = base as unknown as Record<string, unknown>;
      const merged = { ...rest, ...changes };
      const createdId = await addRecord(companyId, REM_COLLECTIONS.inspections, stripUndefined({
        ...merged,
        id: undefined,
        code: `${base.code}-v${base.version + 1}`,
        version: base.version + 1,
        supersedesInspectionId: base.id,
        finalized: false,
        finalizedAt: null,
        createdBy: by,
      }) as Record<string, unknown>);
      const after = await getDocData(companyId, REM_COLLECTIONS.inspections, createdId);
      return { data: normalize<Inspection>(createdId, after ?? undefined, INSPECTION_DATES), message: "New inspection version created" };
    });
  },
  /** Raise a maintenance work order for an inspection issue (facilities module). */
  async linkWorkOrder(companyId: string, inspectionId: string, issueId: string, workOrderId: string): Promise<ApiResponse<Inspection>> {
    return logged("linkIssueWorkOrder", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.inspections, inspectionId);
      if (!data) throw new DomainValidationError("notFound");
      const insp = normalize<Inspection>(inspectionId, data, INSPECTION_DATES);
      const issues = (insp.issues ?? []).map((i) => (i.id === issueId ? { ...i, workOrderId } : i));
      await patchRecord(companyId, REM_COLLECTIONS.inspections, inspectionId, { issues });
      const after = await getDocData(companyId, REM_COLLECTIONS.inspections, inspectionId);
      return { data: normalize<Inspection>(inspectionId, after ?? undefined, INSPECTION_DATES), message: "Work order linked" };
    });
  },
  async createWorkOrderForIssue(
    companyId: string,
    inspectionId: string,
    issueId: string,
    requestedBy: string,
    facilityId?: string | null
  ): Promise<ApiResponse<{ inspection: Inspection; workOrderId: string }>> {
    return logged("createWorkOrderForIssue", async () => {
      const res = await InspectionService.get(companyId, inspectionId);
      if (!res.data) throw new DomainValidationError("notFound");
      const issue = (res.data.issues ?? []).find((i) => i.id === issueId);
      if (!issue) throw new DomainValidationError("issueNotFound");
      // Reuse the FACILITIES work-order lifecycle — no parallel maintenance system.
      const wo = await WorkOrderService.create(companyId, {
        title: `RE: ${issue.description.slice(0, 80)}`,
        description: issue.description,
        facilityId: facilityId ?? res.data.unitId ?? null,
        priority: "medium",
        requestedBy,
        currency: "SAR",
      });
      if (!wo.data) throw new DomainValidationError("workOrderCreateFailed");
      const linked = await InspectionService.linkWorkOrder(companyId, inspectionId, issueId, wo.data.id);
      return { data: { inspection: linked.data!, workOrderId: wo.data.id }, message: "Work order raised via facilities module" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Handover records (move-in / move-out)                                      */
/* -------------------------------------------------------------------------- */

export const HandoverService = {
  async list(companyId: string): Promise<ApiResponse<HandoverRecord[]>> {
    return logged("listHandovers", async () => ({
      data: await listCollection<HandoverRecord>(companyId, REM_COLLECTIONS.handovers),
      message: "Success",
    }));
  },
  async listForLease(companyId: string, leaseId: string): Promise<ApiResponse<HandoverRecord[]>> {
    return logged("listLeaseHandovers", async () => ({
      data: await listCollectionUnordered<HandoverRecord>(companyId, REM_COLLECTIONS.handovers, [where("leaseId", "==", leaseId)]),
      message: "Success",
    }));
  },
  async create(companyId: string, dto: Omit<HandoverRecord, "id" | "createdAt" | "updatedAt" | "completed" | "followUpWorkOrderIds" | "createdBy">, by: string): Promise<ApiResponse<HandoverRecord>> {
    return logged("createHandover", async () => {
      if (!isValidIsoDate(dto.handoverDate)) throw new DomainValidationError("validation.failed", [{ field: "handoverDate", messageKey: "validation.dateIso" }]);
      const id = await addRecord(companyId, REM_COLLECTIONS.handovers, stripUndefined({
        ...dto,
        followUpWorkOrderIds: [],
        completed: false,
        createdBy: by,
      }) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.handovers, id);
      return { data: normalize<HandoverRecord>(id, data ?? undefined), message: "Handover recorded" };
    });
  },
  async complete(companyId: string, id: string, by: string): Promise<ApiResponse<HandoverRecord>> {
    return logged("completeHandover", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.handovers, id, { completed: true, completedBy: by });
      const data = await getDocData(companyId, REM_COLLECTIONS.handovers, id);
      if (!data) throw new DomainValidationError("notFound");
      return { data: normalize<HandoverRecord>(id, data), message: "Handover completed" };
    });
  },
  async addFollowUpWorkOrder(companyId: string, id: string, workOrderId: string): Promise<ApiResponse<HandoverRecord>> {
    return logged("addHandoverFollowUp", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.handovers, id);
      if (!data) throw new DomainValidationError("notFound");
      const rec = normalize<HandoverRecord>(id, data);
      const ids = new Set([...(rec.followUpWorkOrderIds ?? []), workOrderId]);
      await patchRecord(companyId, REM_COLLECTIONS.handovers, id, { followUpWorkOrderIds: [...ids] });
      const after = await getDocData(companyId, REM_COLLECTIONS.handovers, id);
      return { data: normalize<HandoverRecord>(id, after ?? undefined), message: "Follow-up linked" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Property expenses (domain view over shared billing)                        */
/* -------------------------------------------------------------------------- */

export const ExpenseService = {
  async list(companyId: string): Promise<ApiResponse<PropertyExpense[]>> {
    return logged("listExpenses", async () => {
      // Archived expenses are soft-deleted: they stay in Firestore for financial
      // audit/history but are hidden from the working list (see `remove`).
      const rows = await listCollection<PropertyExpense>(companyId, REM_COLLECTIONS.expenses);
      return { data: rows.filter((r) => r.archived !== true), message: "Success" };
    });
  },
  async create(companyId: string, dto: CreatePropertyExpenseDTO, by: string, canApprove: boolean): Promise<ApiResponse<PropertyExpense>> {
    return logged("createExpense", async () => {
      if (!dto.propertyId) throw new DomainValidationError("validation.failed", [{ field: "propertyId", messageKey: "validation.propertyRequired" }]);
      if (!dto.description || dto.description.trim().length < 3) throw new DomainValidationError("validation.failed", [{ field: "description", messageKey: "validation.nameMin" }]);
      if (!isValidIsoDate(dto.expenseDate)) throw new DomainValidationError("validation.failed", [{ field: "expenseDate", messageKey: "validation.dateIso" }]);
      const amount = normalizeMoney(dto.amount);
      if (amount <= 0) throw new DomainValidationError("validation.failed", [{ field: "amount", messageKey: "validation.money" }]);
      const prop = await getDocData(companyId, REM_COLLECTIONS.properties, dto.propertyId);
      if (!prop) throw new DomainValidationError("propertyNotFound");
      if (dto.unitId) {
        const unit = await getDocData(companyId, REM_COLLECTIONS.units, dto.unitId);
        if (!unit) throw new DomainValidationError("unitNotFound");
        if ((unit as Record<string, unknown>).propertyId !== dto.propertyId) throw new DomainValidationError("unitPropertyMismatch");
      }
      // Mirrors the shared bills contract: non-reviewers cannot record an
      // approval decision, only the expense itself.
      const approvalStatus = canApprove && (dto.approvalStatus === "approved" || dto.approvalStatus === "rejected")
        ? dto.approvalStatus
        : "pending";
      const expense: Omit<PropertyExpense, "id" | "createdAt" | "updatedAt"> = {
        ...dto,
        amount,
        accountingPeriod: dto.expenseDate.slice(0, 7),
        approvalStatus,
        approvedBy: approvalStatus === "pending" ? null : by,
        approvedAt: approvalStatus === "pending" ? null : new Date().toISOString(),
        documents: dto.documents ?? [],
        createdBy: by,
      } as Omit<PropertyExpense, "id" | "createdAt" | "updatedAt">;
      const id = await addRecord(companyId, REM_COLLECTIONS.expenses, stripUndefined(expense as unknown as Record<string, unknown>));
      const data = await getDocData(companyId, REM_COLLECTIONS.expenses, id);
      return { data: normalize<PropertyExpense>(id, data ?? undefined), message: "Expense recorded" };
    });
  },
  async update(companyId: string, id: string, dto: Partial<PropertyExpense>, by: string, canApprove: boolean): Promise<ApiResponse<PropertyExpense>> {
    return logged("updateExpense", async () => {
      const before = await getDocData(companyId, REM_COLLECTIONS.expenses, id);
      if (!before) throw new DomainValidationError("notFound");
      const patch = stripUndefined({ ...dto } as Record<string, unknown>);
      if (!canApprove && ("approvalStatus" in patch)) {
        // Non-reviewers may edit descriptive fields but never the approval outcome.
        if (patch.approvalStatus !== before.approvalStatus) delete patch.approvalStatus;
      } else if (patch.approvalStatus === "approved" || patch.approvalStatus === "rejected") {
        patch.approvedBy = by;
        patch.approvedAt = new Date().toISOString();
      }
      if (patch.expenseDate && isValidIsoDate(String(patch.expenseDate))) {
        patch.accountingPeriod = String(patch.expenseDate).slice(0, 7);
      }
      await patchRecord(companyId, REM_COLLECTIONS.expenses, id, patch);
      const data = await getDocData(companyId, REM_COLLECTIONS.expenses, id);
      return { data: normalize<PropertyExpense>(id, data ?? undefined), message: "Expense updated" };
    });
  },
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("archiveExpense", async () => {
      // Financial records are never hard-deleted (the rules deny it): the UI
      // "delete" archives the expense so history and any posted journal/bill
      // reference remain intact while it disappears from the working list.
      const before = await getDocData(companyId, REM_COLLECTIONS.expenses, id);
      if (!before) throw new DomainValidationError("notFound");
      await patchRecord(companyId, REM_COLLECTIONS.expenses, id, { archived: true });
      return { data: null, message: "Expense archived" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Documents (activity-owned Storage partition)                               */
/* -------------------------------------------------------------------------- */

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif)|application\/(pdf|vnd\.openxmlformats-officedocument.*|vnd\.ms-excel|msword|zip|ms-excel))$/;
/**
 * Storage path partition for legally sensitive evidence (deeds, owner IDs,
 * signed contracts). storage.rules restricts this collection to company
 * officers on top of the activity gate — keep the name in sync there.
 */
const SENSITIVE_STORAGE_PARTITION = "rem_sensitive_documents";

export const DocumentService = {
  async listFor(companyId: string, entityType: RemEntityType, entityId: string): Promise<ApiResponse<RemDocument[]>> {
    return logged("listEntityDocuments", async () => ({
      data: await listCollectionUnordered<RemDocument>(companyId, REM_COLLECTIONS.documents, [
        where("entityType", "==", entityType),
        where("entityId", "==", entityId),
      ]),
      message: "Success",
    }));
  },
  /**
   * Upload into the activity-owned Storage partition
   * (`domain/rem_property_documents/{companyId}/…`) governed by the existing
   * storage.rules domain gate — never a public path. Metadata lands in
   * rem_property_documents. Missing/unreachable buckets degrade through the
   * repo's shared upload helper (inline fallback for small files only).
   */
  async upload(
    companyId: string,
    input: { entityType: RemEntityType; entityId: string; kind: string; file: File; sensitive?: boolean },
    by: string
  ): Promise<ApiResponse<RemDocument>> {
    return logged("uploadDocument", async () => {
      if (input.file.size > MAX_DOCUMENT_BYTES) throw new DomainValidationError("documentTooLarge");
      if (!ALLOWED_TYPES.test(input.file.type)) throw new DomainValidationError("documentTypeNotAllowed");
      const safeName = input.file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const partition = input.sensitive ? SENSITIVE_STORAGE_PARTITION : REM_COLLECTIONS.documents;
      const path = `domain/${partition}/${companyId}/${input.entityType}/${input.entityId}/${Date.now()}_${safeName}`;
      const url = await uploadStorageFile(path, input.file, input.file.type);
      const id = await addRecord(companyId, REM_COLLECTIONS.documents, stripUndefined({
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        fileName: input.file.name,
        contentType: input.file.type,
        sizeBytes: input.file.size,
        storagePath: path,
        url,
        sensitive: Boolean(input.sensitive),
        uploadedBy: by,
      }) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.documents, id);
      return { data: normalize<RemDocument>(id, data ?? undefined), message: "Document uploaded" };
    });
  },
  /** Metadata removal also best-effort deletes the Storage object. */
  async remove(companyId: string, id: string): Promise<ApiResponse<null>> {
    return logged("deleteDocument", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.documents, id);
      if (data) {
        const { deleteStorageFileByUrl } = await import("@/lib/storage-utils");
        await deleteStorageFileByUrl(String((data as Record<string, unknown>).url ?? ""));
      }
      await removeRecord(companyId, REM_COLLECTIONS.documents, id);
      return { data: null, message: "Document deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Meter readings — append-only history                                       */
/* -------------------------------------------------------------------------- */

export interface MeterReading {
  id: string;
  unitId: string;
  propertyId: string;
  meterId: string;
  meterNumber: string;
  utility: string;
  reading: number;
  readingDate: string;
  photoUrl?: string | null;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const MeterReadingService = {
  async listForUnit(companyId: string, unitId: string): Promise<ApiResponse<MeterReading[]>> {
    return logged("listMeterReadings", async () => {
      const rows = await listCollectionUnordered<MeterReading>(companyId, REM_COLLECTIONS.meterReadings, [
        where("unitId", "==", unitId),
      ]);
      rows.sort((a, b) => (a.readingDate < b.readingDate ? 1 : -1));
      return { data: rows, message: "Success" };
    });
  },
  async add(companyId: string, input: Omit<MeterReading, "id" | "createdAt" | "updatedAt">, by: string): Promise<ApiResponse<MeterReading>> {
    return logged("addMeterReading", async () => {
      if (!isValidIsoDate(input.readingDate)) throw new DomainValidationError("validation.failed", [{ field: "readingDate", messageKey: "validation.dateIso" }]);
      if (!Number.isFinite(input.reading) || input.reading < 0) throw new DomainValidationError("validation.failed", [{ field: "reading", messageKey: "validation.money" }]);
      const unit = await getDocData(companyId, REM_COLLECTIONS.units, input.unitId);
      if (!unit) throw new DomainValidationError("unitNotFound");
      const prev = await MeterReadingService.listForUnit(companyId, input.unitId);
      const lastSameMeter = (prev.data ?? []).find((r) => r.meterId === input.meterId);
      if (lastSameMeter && input.reading < lastSameMeter.reading) {
        // Meters do not run backwards unless swapped — require the note to say so.
        if (!(input.note ?? "").trim()) throw new DomainValidationError("meterReadingRegressionNeedsNote");
      }
      const id = await addRecord(companyId, REM_COLLECTIONS.meterReadings, stripUndefined({ ...input, createdBy: by }) as Record<string, unknown>);
      const data = await getDocData(companyId, REM_COLLECTIONS.meterReadings, id);
      return { data: normalize<MeterReading>(id, data ?? undefined), message: "Reading recorded" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Reminders — idempotent notifications (on-demand; no scheduler claimed)     */
/* -------------------------------------------------------------------------- */

export interface ReminderSettings {
  leaseExpiryDaysBefore: number;
  rentDueDaysBefore: number;
  inspectionDueDaysBefore: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  leaseExpiryDaysBefore: 60,
  rentDueDaysBefore: 7,
  inspectionDueDaysBefore: 30,
};

/** Deterministic key so a reminder for (type, entity, period) exists at most once. */
function reminderDocId(kind: string, entityId: string, period: string): string {
  return `remind_${kind}_${entityId}_${period}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
}

export interface ReminderGenerationResult {
  created: number;
  skipped: number;
  items: string[];
}

/**
 * Generate reminders for lease expirations, upcoming/overdue installments and
 * deposits due at termination. Idempotent by deterministic notification doc
 * ids — calling it on every dashboard load is safe. Notification titles/bodies
 * use stable machine keys + data (translation happens in the notification UI).
 */
export async function generateReminders(
  companyId: string,
  opts: {
    settings?: ReminderSettings;
    today?: string;
    leases: Lease[];
    installments: RentInstallment[];
    properties: Property[];
    units: Unit[];
    recipients?: string[];
  }
): Promise<ReminderGenerationResult> {
  const settings = opts.settings ?? DEFAULT_REMINDER_SETTINGS;
  const today = opts.today ?? todayIso();
  const recipients = opts.recipients ?? [];
  let created = 0;
  let skipped = 0;
  const items: string[] = [];
  const propById = new Map(opts.properties.map((p) => [p.id, p]));
  const unitById = new Map(opts.units.map((u) => [u.id, u]));

  const push = async (kind: string, entityId: string, period: string, titleKey: string, bodyKey: string, params: Record<string, string>, entityType: string, link: string) => {
    if (recipients.length === 0) return;
    for (const userId of recipients) {
      const id = reminderDocId(`${kind}_${userId}`, entityId, period);
      const ref = doc(db, "companies", companyId, "notifications", id);
      const exists = await getDoc(ref);
      if (exists.exists()) {
        skipped += 1;
        continue;
      }
      // Shared AppNotification contract (title/message/isRead/link) so the
      // existing notification UI renders it today; the machine keys ride
      // along for locale-aware rendering later.
      const text = Object.values(params).join(" · ");
      await setDoc(ref, stripUndefined({
        userId,
        type: "reminder",
        title: `REM ${kind}: ${text}`,
        message: text,
        link,
        titleKey,
        bodyKey,
        params,
        entityType,
        entityId,
        isRead: false,
        createdAt: serverTimestamp(),
      }) as Record<string, unknown>);
      created += 1;
      items.push(id);
    }
  };

  for (const lease of opts.leases) {
    if (lease.status !== "active" && lease.status !== "expiring") continue;
    const unit = unitById.get(lease.unitId);
    const prop = propById.get(lease.propertyId);
    const params = {
      contractNumber: lease.contractNumber,
      unit: unit?.name ?? lease.unitId,
      property: prop?.nameEn ?? lease.propertyId,
      date: lease.endDate,
    };
    if (lease.endDate >= today && lease.endDate <= addDaysLocal(today, settings.leaseExpiryDaysBefore)) {
      await push("lease_expiry", lease.id, lease.endDate, "real_estate:reminder.leaseExpiry.title", "real_estate:reminder.leaseExpiry.body", params, "lease", `/real-estate/leases/${lease.id}`);
    }
    // Upcoming + overdue installments
    const leaseInst = opts.installments.filter((i) => i.leaseId === lease.id && i.status !== "cancelled" && i.status !== "paid");
    for (const i of leaseInst) {
      if (i.dueDate >= today && i.dueDate <= addDaysLocal(today, settings.rentDueDaysBefore)) {
        await push("rent_upcoming", i.id, i.dueDate, "real_estate:reminder.rentUpcoming.title", "real_estate:reminder.rentUpcoming.body", {
          contractNumber: lease.contractNumber, amount: String(i.principalAmount), currency: i.currency, date: i.dueDate,
        }, "installment", `/real-estate/leases/${lease.id}`);
      } else if (i.dueDate < today && (i.paidAmount ?? 0) < i.principalAmount) {
        await push("rent_overdue", i.id, i.dueDate, "real_estate:reminder.rentOverdue.title", "real_estate:reminder.rentOverdue.body", {
          contractNumber: lease.contractNumber, amount: String(i.principalAmount), currency: i.currency, date: i.dueDate,
        }, "installment", `/real-estate/leases/${lease.id}`);
      }
    }
  }
  return { created, skipped, items };
}

function addDaysLocal(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
