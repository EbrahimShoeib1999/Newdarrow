/**
 * Real Estate Management — lease, rent schedule, collections & deposit service.
 *
 * Invariants enforced HERE (and mirrored by the pure rules they call):
 * - Contract numbers come from the tenant's transactional sequence.
 * - A unit cannot hold two blocking leases whose dates overlap. Activation
 *   re-checks against the CURRENT data (the caller may hold a stale view).
 * - Rent schedules use deterministic doc ids (`${leaseId}_${index}`), so a
 *   retried generation overwrites the same documents and can NEVER create a
 *   duplicate installment — idempotency by construction, not by lookup.
 * - An installment's paidAmount only ever changes through a validated payment
 *   allocation; "mark paid" does not exist as an operation.
 * - Payments carry an optional idempotency key enforced by a deterministic doc
 *   id (`ipk_<hash>`), so a double-submit writes the same document once.
 * - Deposits are liability rows; money movement validates against the received
 *   balance and never touches revenue reports.
 *
 * Concurrency note (documented limitation): Firestore web clients cannot run
 * queries inside a transaction, so overlap detection is read-then-write with
 * an activation re-check. Code allocation and schedule idempotency ARE
 * transaction/deterministic-id safe; simultaneous creation of two OVERLAPPING
 * leases for one unit is guarded at the UI + service layer, not by a Firestore
 * where-clause inside the transaction.
 */

import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { db } from "@/lib/firebase";
import {
  REM_COLLECTIONS,
  listCollectionUnordered,
  normalize,
  allocateRemCode,
  patchRecord,
  getDocData,
  stripUndefined,
  runTransaction,
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  limit as fsLimit,
  setDoc,
  serverTimestamp,
} from "./rem-base";
import {
  canTransitionLease,
  findLeaseOverlap,
  isUnitAvailableForNewLease,
  deriveOccupancyState,
  validateLeaseDraft,
  isValidIsoDate,
  todayIso,
  shouldFlagExpired,
  shouldFlagExpiring,
} from "../lib/rem-rules";
import {
  buildRentSchedule,
  deriveInstallmentStatus,
  installmentOutstanding,
  validatePaymentAllocations,
  normalizeMoney,
  depositHeld,
  depositLiability,
  depositStatusFor,
  validateDepositMovement,
  effectiveAllocations,
} from "../lib/rem-finance";
import { DomainValidationError } from "./rem-core.service";
import type {
  CreateLeaseDTO,
  CreateRentPaymentDTO,
  DepositRecord,
  Lease,
  LeaseStatus,
  RentInstallment,
  RentPayment,
  Unit,
} from "../types/real-estate.types";

const SERVICE_NAME = "RemLeasingService";
function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

const LEASE_DATES = ["startDate", "endDate", "terminatedAt"];

async function readLease(companyId: string, id: string): Promise<Lease> {
  const data = await getDocData(companyId, REM_COLLECTIONS.leases, id);
  if (!data) throw new DomainValidationError("leaseNotFound");
  return normalize<Lease>(id, data, LEASE_DATES);
}

async function readUnit(companyId: string, id: string): Promise<Unit> {
  const data = await getDocData(companyId, REM_COLLECTIONS.units, id);
  if (!data) throw new DomainValidationError("unitNotFound");
  return normalize<Unit>(id, data);
}

async function unitLeases(companyId: string, unitId: string, ignoreLeaseId?: string) {
  const leases = await listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases, [where("unitId", "==", unitId)]);
  return leases.filter((l) => l.id !== ignoreLeaseId);
}

/** Rewrite the unit's occupancy cache from live lease data. */
async function syncUnitOccupancy(companyId: string, unitId: string): Promise<void> {
  const [unit, leases] = await Promise.all([readUnit(companyId, unitId), unitLeases(companyId, unitId)]);
  const occupancy = deriveOccupancyState(unit, leases, todayIso(), Boolean(unit.maintenanceHold));
  if (occupancy !== unit.occupancyStatus) {
    await patchRecord(companyId, REM_COLLECTIONS.units, unitId, { occupancyStatus: occupancy } as never);
  }
}

/* -------------------------------------------------------------------------- */
/* Rent schedule (idempotent)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate (or regenerate) the lease's installment schedule. Deterministic ids
 * make retries safe; installments that already have payments allocated are
 * NEVER overwritten — their money state is protected, only descriptive terms
 * refresh when unchanged. Returns the resulting schedule.
 */
export async function generateRentSchedule(companyId: string, leaseId: string): Promise<RentInstallment[]> {
  const lease = await readLease(companyId, leaseId);
  const planned = buildRentSchedule(lease);
  const existingSnap = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [
    where("leaseId", "==", leaseId),
  ]);
  const existingById = new Map(existingSnap.map((i) => [i.id, i]));
  const grace = lease.gracePeriodDays ?? 0;
  const today = todayIso();

  for (const item of planned) {
    const prev = existingById.get(item.id);
    if (prev) {
      const prevPaid = normalizeMoney(prev.paidAmount);
      if (prevPaid > 0) continue; // funded history is immutable here
      const status = deriveInstallmentStatus({ ...item, paidAmount: prevPaid }, grace, today);
      await setDoc(
        doc(db, "companies", companyId, REM_COLLECTIONS.installments, item.id),
        stripUndefined({ ...item, paidAmount: 0, status, updatedAt: serverTimestamp() }),
        { merge: true }
      );
    } else {
      await setDoc(
        doc(db, "companies", companyId, REM_COLLECTIONS.installments, item.id),
        stripUndefined({
          ...item,
          status: deriveInstallmentStatus({ ...item, paidAmount: 0 }, grace, today),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    }
  }
  if (!lease.scheduleGenerated) {
    await patchRecord(companyId, REM_COLLECTIONS.leases, leaseId, { scheduleGenerated: true });
  }
  return planned.map((p) => {
    const prev = existingById.get(p.id);
    return prev ? { ...p, paidAmount: prev.paidAmount, status: prev.status, createdAt: prev.createdAt, updatedAt: prev.updatedAt } : { ...p, createdAt: "", updatedAt: "" };
  });
}

/** Re-derive every installment's status from amounts + dates (processor core). */
export async function refreshInstallmentStatuses(companyId: string, lease: Lease): Promise<number> {
  const installments = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [
    where("leaseId", "==", lease.id),
  ]);
  let changed = 0;
  for (const i of installments) {
    if (i.status === "cancelled" || i.status === "paid") continue;
    const next = deriveInstallmentStatus(i, lease.gracePeriodDays ?? 0);
    if (next !== i.status) {
      await patchRecord(companyId, REM_COLLECTIONS.installments, i.id, { status: next });
      changed += 1;
    }
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Leases                                                                     */
/* -------------------------------------------------------------------------- */

export const LeaseService = {
  async list(companyId: string): Promise<ApiResponse<Lease[]>> {
    return logged("listLeases", async () => ({
      data: await listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases),
      message: "Success",
    }));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Lease | null>> {
    return logged("getLease", async () => {
      const data = await getDocData(companyId, REM_COLLECTIONS.leases, id);
      return data ? { data: normalize<Lease>(id, data, LEASE_DATES), message: "Success" } : { data: null, message: "Not found" };
    });
  },
  /** Draft creation validates terms, unit eligibility and date overlap. */
  async create(companyId: string, dto: CreateLeaseDTO): Promise<ApiResponse<Lease>> {
    return logged("createLease", async () => {
      const errors = validateLeaseDraft(dto);
      if (errors.length) throw new DomainValidationError("validation.failed", errors);
      const unit = await readUnit(companyId, dto.unitId);
      if (unit.propertyId !== dto.propertyId) throw new DomainValidationError("unitPropertyMismatch");
      // Tenant identity must resolve inside this tenant's CRM (no duplicates).
      const contactSnap = await getDocs(query(collection(db, "companies", companyId, "contacts"), where("__name__", "==", dto.tenantContactId), fsLimit(1)));
      if (contactSnap.empty) throw new DomainValidationError("tenantContactMissing");
      const leases = await unitLeases(companyId, dto.unitId);
      const conflict = findLeaseOverlap(dto.unitId, dto.startDate, dto.endDate, leases);
      if (conflict) throw new DomainValidationError(`leaseOverlap:${conflict.leaseId}`);
      let createdId = "";
      await runTransaction(db, async (tx) => {
        const contractNumber = await allocateRemCode(tx, companyId, "lease");
        const ref = doc(collection(db, "companies", companyId, REM_COLLECTIONS.leases));
        createdId = ref.id;
        const depositAmount = normalizeMoney(dto.depositAmount ?? 0);
        tx.set(ref, stripUndefined({
          ...dto,
          contractNumber,
          status: "draft" as LeaseStatus,
          depositStatus: depositAmount > 0 ? ("expected" as const) : ("expected" as const),
          timing: dto.timing ?? "advance",
          gracePeriodDays: Math.max(0, Math.floor(dto.gracePeriodDays ?? 0)),
          feesAmount: normalizeMoney(dto.feesAmount ?? 0),
          taxPercent: Number.isFinite(dto.taxPercent) ? dto.taxPercent : 0,
          taxAmount: normalizeMoney(dto.taxAmount ?? 0),
          discountAmount: normalizeMoney(dto.discountAmount ?? 0),
          escalations: dto.escalations ?? [],
          customDueDates: dto.customDueDates ?? [],
          amendments: [],
          approvals: [],
          documents: dto.documents ?? [],
          scheduleGenerated: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }));
      });
      const data = await getDocData(companyId, REM_COLLECTIONS.leases, createdId);
      return { data: normalize<Lease>(createdId, data ?? undefined, LEASE_DATES), message: "Lease draft created" };
    });
  },
  /** Editable descriptive fields while draft/pending; active leases amend via amendment(). */
  async update(companyId: string, id: string, dto: Partial<Lease>): Promise<ApiResponse<Lease>> {
    return logged("updateLease", async () => {
      const lease = await readLease(companyId, id);
      if (lease.status !== "draft" && lease.status !== "pending_approval") {
        throw new DomainValidationError("leaseNotEditableUseAmendment");
      }
      const { id: _i, status: _s, contractNumber: _c, scheduleGenerated: _g, createdAt: _cr, updatedAt: _up, ...rest } = dto as Record<string, unknown> & Lease;
      const merged = { ...lease, ...rest } as unknown as Lease;
      const errors = validateLeaseDraft(merged);
      if (errors.length) throw new DomainValidationError("validation.failed", errors);
      if (merged.unitId !== lease.unitId || merged.startDate !== lease.startDate || merged.endDate !== lease.endDate) {
        const leases = await unitLeases(companyId, merged.unitId, id);
        const conflict = findLeaseOverlap(merged.unitId, merged.startDate, merged.endDate, leases);
        if (conflict) throw new DomainValidationError(`leaseOverlap:${conflict.leaseId}`);
      }
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, stripUndefined(rest as Record<string, unknown>));
      return { data: await readLease(companyId, id), message: "Lease updated" };
    });
  },
  /** draft -> pending_approval (when the tenant uses approvals). */
  async submitForApproval(companyId: string, id: string): Promise<ApiResponse<Lease>> {
    return logged("submitLeaseForApproval", async () => {
      const lease = await readLease(companyId, id);
      if (!canTransitionLease(lease.status, "pending_approval")) throw new DomainValidationError("illegalTransition");
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, { status: "pending_approval" });
      return { data: await readLease(companyId, id), message: "Lease pending approval" };
    });
  },
  /**
   * ACTIVATE — the single path to `active`. Re-validates against CURRENT data:
   * unit eligibility (not maintenance/unavailable/vacant-derivation conflict),
   * date overlap, tenant link; then generates the rent schedule idempotently,
   * opens the deposit liability row and syncs the unit's occupancy cache.
   */
  async activate(companyId: string, id: string, by: string): Promise<ApiResponse<Lease>> {
    return logged("activateLease", async () => {
      const lease = await readLease(companyId, id);
      if (!canTransitionLease(lease.status, "active")) throw new DomainValidationError("illegalTransition");
      const unit = await readUnit(companyId, lease.unitId);
      const occupancy = deriveOccupancyState(unit, await unitLeases(companyId, lease.unitId, id), todayIso(), Boolean(unit.maintenanceHold));
      if (!isUnitAvailableForNewLease(unit, occupancy)) throw new DomainValidationError("unitNotAvailable");
      const others = await unitLeases(companyId, lease.unitId, id);
      const conflict = findLeaseOverlap(lease.unitId, lease.startDate, lease.endDate, others);
      if (conflict) throw new DomainValidationError(`leaseOverlap:${conflict.leaseId}`);
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, {
        status: "active",
        approvals: [...(lease.approvals ?? []), { userId: by, at: new Date().toISOString() }],
      });
      const activated = await readLease(companyId, id);
      await generateRentSchedule(companyId, id);
      await ensureDepositRow(companyId, activated);
      await syncUnitOccupancy(companyId, lease.unitId);
      return { data: activated, message: "Lease activated" };
    });
  },
  /**
   * Terminate with a reason — financial history (installments, payments) is
   * preserved; unpaid future installments are cancelled, past-due ones stay.
   */
  async terminate(companyId: string, id: string, reason: string, by: string): Promise<ApiResponse<Lease>> {
    return logged("terminateLease", async () => {
      if (!reason || reason.trim().length < 3) throw new DomainValidationError("terminationReasonRequired");
      const lease = await readLease(companyId, id);
      if (!canTransitionLease(lease.status, "terminated")) throw new DomainValidationError("illegalTransition");
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, {
        status: "terminated",
        terminationReason: reason.trim(),
        terminatedAt: new Date().toISOString(),
      });
      await cancelFutureInstallments(companyId, lease, by);
      await syncUnitOccupancy(companyId, lease.unitId);
      return { data: await readLease(companyId, id), message: "Lease terminated" };
    });
  },
  /** Cancel a draft/pending lease (never used for executed contracts). */
  async cancel(companyId: string, id: string, reason: string): Promise<ApiResponse<Lease>> {
    return logged("cancelLease", async () => {
      const lease = await readLease(companyId, id);
      if (!canTransitionLease(lease.status, "cancelled")) throw new DomainValidationError("illegalTransition");
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, { status: "cancelled", terminationReason: reason || null });
      // A never-activated lease's untouched schedule is removed; funded rows stay.
      const installments = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [where("leaseId", "==", id)]);
      for (const i of installments) {
        if (normalizeMoney(i.paidAmount) === 0) {
          await patchRecord(companyId, REM_COLLECTIONS.installments, i.id, { status: "cancelled" });
        }
      }
      await syncUnitOccupancy(companyId, lease.unitId);
      return { data: await readLease(companyId, id), message: "Lease cancelled" };
    });
  },
  /**
   * Renew: create the successor lease (draft) from the original's terms with
   * new dates/rent, linking renewedFromLeaseId. The original is NOT touched —
   * it flips to `renewed` only when the successor is activated (below), so a
   * abandoned renewal never destroys the original contract record.
   */
  async renew(companyId: string, id: string, changes: { startDate: string; endDate: string; rentAmount: number; depositAmount?: number }): Promise<ApiResponse<Lease>> {
    return logged("renewLease", async () => {
      const original = await readLease(companyId, id);
      if (original.status !== "active" && original.status !== "expiring" && original.status !== "expired") {
        throw new DomainValidationError("illegalTransition");
      }
      if (!isValidIsoDate(changes.startDate) || !isValidIsoDate(changes.endDate) || changes.endDate <= changes.startDate) {
        throw new DomainValidationError("validation.failed", [{ field: "endDate", messageKey: "validation.endAfterStart" }]);
      }
      const successor = await LeaseService.create(companyId, {
        propertyId: original.propertyId,
        unitId: original.unitId,
        tenantContactId: original.tenantContactId,
        tenantDisplayNameSnapshot: original.tenantDisplayNameSnapshot ?? null,
        startDate: changes.startDate,
        endDate: changes.endDate,
        rentAmount: changes.rentAmount,
        currency: original.currency,
        frequency: original.frequency,
        dueDay: original.dueDay,
        customDueDates: original.customDueDates ?? [],
        timing: original.timing,
        gracePeriodDays: original.gracePeriodDays,
        depositAmount: changes.depositAmount ?? original.depositAmount,
        escalations: original.escalations ?? [],
        includedServices: original.includedServices ?? null,
        chargeableUtilities: original.chargeableUtilities ?? null,
        feesAmount: original.feesAmount,
        taxPercent: original.taxPercent,
        taxAmount: original.taxAmount,
        discountAmount: 0,
        responsibleUserId: original.responsibleUserId ?? null,
      });
      const s = successor.data!;
      await patchRecord(companyId, REM_COLLECTIONS.leases, s.id, { renewedFromLeaseId: id });
      return { data: await readLease(companyId, s.id), message: "Renewal draft created" };
    });
  },
  /** Amendment on an active lease: audited field changes, history preserved. */
  async amend(companyId: string, id: string, by: string, summary: string, changes: Record<string, { from: unknown; to: unknown }>): Promise<ApiResponse<Lease>> {
    return logged("amendLease", async () => {
      const lease = await readLease(companyId, id);
      if (lease.status !== "active" && lease.status !== "expiring") throw new DomainValidationError("leaseNotAmendable");
      if (!summary || summary.trim().length < 3) throw new DomainValidationError("amendmentSummaryRequired");
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes)) {
        if (["status", "contractNumber", "id", "createdAt", "updatedAt", "amendments", "approvals", "scheduleGenerated"].includes(k)) continue;
        patch[k] = v.to;
      }
      const before = lease.amendments ?? [];
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, stripUndefined({
        ...patch,
        amendments: [...before, { id: cryptoId(), at: new Date().toISOString(), by, summary: summary.trim(), changes }],
      }));
      return { data: await readLease(companyId, id), message: "Lease amended" };
    });
  },
  /** Attach a signed contract file reference (documents array, never overwrite). */
  async addDocument(companyId: string, id: string, docRef: Lease["documents"][number]): Promise<ApiResponse<Lease>> {
    return logged("addLeaseDocument", async () => {
      const lease = await readLease(companyId, id);
      await patchRecord(companyId, REM_COLLECTIONS.leases, id, { documents: [...(lease.documents ?? []), docRef] });
      return { data: await readLease(companyId, id), message: "Document attached" };
    });
  },
};

function cryptoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function cancelFutureInstallments(companyId: string, lease: Lease, _by: string): Promise<void> {
  const today = todayIso();
  const installments = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [where("leaseId", "==", lease.id)]);
  for (const i of installments) {
    if (normalizeMoney(i.paidAmount) > 0 || i.status === "paid" || i.status === "cancelled") continue;
    if (i.periodStart > today) {
      await patchRecord(companyId, REM_COLLECTIONS.installments, i.id, { status: "cancelled" });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Payments & collections                                                     */
/* -------------------------------------------------------------------------- */

/** Valid persisted allocations per installment, from un-voided payments. */
async function allocationsByInstallment(companyId: string, leaseId: string): Promise<Map<string, number>> {
  const payments = await listCollectionUnordered<RentPayment>(companyId, REM_COLLECTIONS.payments, [where("leaseId", "==", leaseId)]);
  return effectiveAllocations(payments);
}

export const PaymentService = {
  async listForLease(companyId: string, leaseId: string): Promise<ApiResponse<RentPayment[]>> {
    return logged("listLeasePayments", async () => ({
      data: await listCollectionUnordered<RentPayment>(companyId, REM_COLLECTIONS.payments, [where("leaseId", "==", leaseId)]),
      message: "Success",
    }));
  },
  async installmentsForLease(companyId: string, leaseId: string): Promise<ApiResponse<RentInstallment[]>> {
    return logged("listLeaseInstallments", async () => {
      const rows = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [where("leaseId", "==", leaseId)]);
      rows.sort((a, b) => a.periodIndex - b.periodIndex);
      return { data: rows, message: "Success" };
    });
  },
  /** Whole-company schedule read for the collections desk (equality-free scan). */
  async listInstallments(companyId: string): Promise<ApiResponse<RentInstallment[]>> {
    return logged("listAllInstallments", async () => ({
      data: await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments),
      message: "Success",
    }));
  },
  /** Whole-company payment read for the reports desk (cash-flow basis). */
  async listAllPayments(companyId: string): Promise<ApiResponse<RentPayment[]>> {
    return logged("listAllPayments", async () => ({
      data: await listCollectionUnordered<RentPayment>(companyId, REM_COLLECTIONS.payments),
      message: "Success",
    }));
  },
  /**
   * Record a rent payment with allocations. The payment is the source of the
   * money event: installment paidAmount/status are re-derived from ALL valid
   * allocations afterwards, so a click never "marks paid" by itself.
   * `idempotencyKey` (optional) makes double-submits write one document.
   */
  async record(companyId: string, dto: CreateRentPaymentDTO, by: string): Promise<ApiResponse<RentPayment>> {
    return logged("recordRentPayment", async () => {
      const lease = await readLease(companyId, dto.leaseId);
      if (lease.status === "cancelled" || lease.status === "draft" || lease.status === "pending_approval") {
        throw new DomainValidationError("leaseNotCollectable");
      }
      if ((dto.currency ?? "").toUpperCase() !== (lease.currency ?? "").toUpperCase()) {
        throw new DomainValidationError("currencyMismatch");
      }
      const installments = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [
        where("leaseId", "==", lease.id),
      ]);
      const byId = new Map(installments.map((i) => [i.id, i]));
      const already = await allocationsByInstallment(companyId, lease.id);
      const contexts = dto.allocations.map((al) => ({
        installment: byId.get(al.installmentId) ?? ({ id: al.installmentId, currency: lease.currency, paidAmount: 0, principalAmount: 0, feesAmount: 0, taxAmount: 0, discountAmount: 0, dueDate: "" } as RentInstallment),
        alreadyAllocated: already.get(al.installmentId) ?? 0,
      })).map((c) => ({ installment: byId.get(c.installment.id) ?? c.installment, alreadyAllocated: c.alreadyAllocated }));
      // Foreign installments (ids not in this lease) resolve to missing -> rejected.
      for (const c of contexts) {
        if (!byId.has(c.installment.id)) throw new DomainValidationError(`installmentNotInLease:${c.installment.id}`);
      }
      const verdict = validatePaymentAllocations(dto, contexts);
      if (!verdict.ok) throw new DomainValidationError(`allocationRejected:${verdict.reason}`);

      const payment: Omit<RentPayment, "id" | "createdAt" | "updatedAt"> = {
        leaseId: lease.id,
        unitId: lease.unitId,
        propertyId: lease.propertyId,
        amount: normalizeMoney(dto.amount),
        currency: dto.currency,
        paymentDate: dto.paymentDate,
        method: dto.method,
        reference: dto.reference ?? null,
        receiptUrl: dto.receiptUrl ?? null,
        allocations: dto.allocations.map((a) => ({ installmentId: a.installmentId, amount: normalizeMoney(a.amount) })),
        voided: false,
        idempotencyKey: dto.idempotencyKey ?? null,
        createdBy: by,
      };
      const paymentId = dto.idempotencyKey ? `ipk_${sanitizeKey(dto.idempotencyKey)}` : cryptoId();
      const ref = doc(db, "companies", companyId, REM_COLLECTIONS.payments, paymentId);
      const pre = await getDoc(ref);
      if (pre.exists()) {
        // Retry with the same key: the recorded payment already exists — return it.
        return { data: normalize<RentPayment>(paymentId, pre.data() as Record<string, unknown>, ["paymentDate", "voidedAt"]), message: "Payment already recorded (idempotent)" };
      }
      await setDoc(ref, stripUndefined({ ...payment, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));

      // Re-derive each touched installment from the FULL allocation set.
      const freshAllocs = new Map(already);
      for (const al of payment.allocations) {
        freshAllocs.set(al.installmentId, normalizeMoney((freshAllocs.get(al.installmentId) ?? 0) + al.amount));
      }
      for (const al of dto.allocations) {
        const inst = byId.get(al.installmentId)!;
        const paid = freshAllocs.get(al.installmentId) ?? 0;
        const status = deriveInstallmentStatus({ ...inst, paidAmount: paid }, lease.gracePeriodDays ?? 0);
        await patchRecord(companyId, REM_COLLECTIONS.installments, inst.id, { paidAmount: paid, status });
      }
      // A lease whose full schedule is settled early stays `active` until the
      // due-date processor expires it — money state never rewrites contract state.
      return { data: normalize<RentPayment>(paymentId, (await getDoc(ref)).data() as Record<string, unknown>, ["paymentDate", "voidedAt"]), message: "Payment recorded" };
    });
  },
  /**
   * Void a recorded payment (correction workflow). The payment row is kept
   * with the void audit; installment paid amounts are re-derived. Requires a
   * reason — corrections are traceable, never silent.
   */
  async voidPayment(companyId: string, paymentId: string, reason: string, by: string): Promise<ApiResponse<RentPayment>> {
    return logged("voidRentPayment", async () => {
      if (!reason || reason.trim().length < 3) throw new DomainValidationError("voidReasonRequired");
      const data = await getDocData(companyId, REM_COLLECTIONS.payments, paymentId);
      if (!data) throw new DomainValidationError("paymentNotFound");
      const payment = normalize<RentPayment>(paymentId, data, ["paymentDate", "voidedAt"]);
      if (payment.voided) return { data: payment, message: "Already voided" };
      await patchRecord(companyId, REM_COLLECTIONS.payments, paymentId, { voided: true, voidReason: reason.trim(), voidedBy: by, voidedAt: new Date().toISOString() });
      const lease = await readLease(companyId, payment.leaseId);
      const installments = await listCollectionUnordered<RentInstallment>(companyId, REM_COLLECTIONS.installments, [where("leaseId", "==", lease.id)]);
      const allocs = await allocationsByInstallment(companyId, lease.id); // post-void set
      for (const al of payment.allocations) {
        const inst = installments.find((i) => i.id === al.installmentId);
        if (!inst) continue;
        const paid = allocs.get(inst.id) ?? 0;
        await patchRecord(companyId, REM_COLLECTIONS.installments, inst.id, {
          paidAmount: paid,
          status: deriveInstallmentStatus({ ...inst, paidAmount: paid }, lease.gracePeriodDays ?? 0),
        });
      }
      const after = await getDocData(companyId, REM_COLLECTIONS.payments, paymentId);
      return { data: normalize<RentPayment>(paymentId, after ?? undefined, ["paymentDate", "voidedAt"]), message: "Payment voided" };
    });
  },
};

function sanitizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

/* -------------------------------------------------------------------------- */
/* Security deposits (liability rows)                                         */
/* -------------------------------------------------------------------------- */

/** One deterministic deposit row per lease (doc id = lease id => idempotent). */
async function ensureDepositRow(companyId: string, lease: Lease): Promise<void> {
  const ref = doc(db, "companies", companyId, REM_COLLECTIONS.deposits, lease.id);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, stripUndefined({
    leaseId: lease.id,
    unitId: lease.unitId,
    propertyId: lease.propertyId,
    tenantContactId: lease.tenantContactId,
    expectedAmount: normalizeMoney(lease.depositAmount ?? 0),
    receivedAmount: 0,
    deductions: [],
    refunds: [],
    currency: lease.currency,
    status: "expected",
    outstandingLiability: 0,
  }));
}

async function readDeposit(companyId: string, leaseId: string): Promise<DepositRecord> {
  const snap = await getDoc(doc(db, "companies", companyId, REM_COLLECTIONS.deposits, leaseId));
  if (!snap.exists()) throw new DomainValidationError("depositNotFound");
  return normalize<DepositRecord>(leaseId, snap.data() as Record<string, unknown>);
}

function depositWrite(d: Omit<DepositRecord, "id" | "createdAt" | "updatedAt">): Record<string, unknown> {
  return stripUndefined({
    ...d,
    deductions: d.deductions ?? [],
    refunds: d.refunds ?? [],
    outstandingLiability: depositLiability(d),
    status: depositStatusFor(d),
    updatedAt: serverTimestamp(),
  }) as Record<string, unknown>;
}

export const DepositService = {
  async get(companyId: string, leaseId: string): Promise<ApiResponse<DepositRecord | null>> {
    return logged("getDeposit", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, REM_COLLECTIONS.deposits, leaseId));
      if (!snap.exists()) return { data: null, message: "No deposit row yet" };
      return { data: normalize<DepositRecord>(leaseId, snap.data() as Record<string, unknown>), message: "Success" };
    });
  },
  async list(companyId: string): Promise<ApiResponse<DepositRecord[]>> {
    return logged("listDeposits", async () => ({
      data: await listCollectionUnordered<DepositRecord>(companyId, REM_COLLECTIONS.deposits),
      message: "Success",
    }));
  },
  /**
   * Register the deposit RECEIPT as a real money event: a rent payment of
   * method/reference kind recorded against the lease but NOT allocated to any
   * installment (deposit payments are liability, not revenue). The payment doc
   * is created here and referenced on the deposit row.
   */
  async recordReceipt(
    companyId: string,
    leaseId: string,
    input: { amount: number; paymentDate: string; method: string; reference?: string | null; receiptUrl?: string | null; idempotencyKey?: string },
    by: string
  ): Promise<ApiResponse<DepositRecord>> {
    return logged("recordDepositReceipt", async () => {
      const lease = await readLease(companyId, leaseId);
      const deposit = await readDeposit(companyId, leaseId);
      const amount = normalizeMoney(input.amount);
      if (amount <= 0) throw new DomainValidationError("validation.money");
      const paymentId = input.idempotencyKey ? `ipk_${sanitizeKey(input.idempotencyKey)}` : cryptoId();
      const ref = doc(db, "companies", companyId, REM_COLLECTIONS.payments, paymentId);
      const pre = await getDoc(ref);
      if (!pre.exists()) {
        await setDoc(ref, stripUndefined({
          leaseId,
          unitId: lease.unitId,
          propertyId: lease.propertyId,
          amount,
          currency: lease.currency,
          paymentDate: input.paymentDate,
          method: input.method,
          reference: input.reference ?? "SECURITY_DEPOSIT",
          receiptUrl: input.receiptUrl ?? null,
          // Empty allocations: a deposit is NEVER revenue — collections reports
          // read allocated payments only, so this row cannot inflate income.
          allocations: [],
          isDepositReceipt: true,
          voided: false,
          idempotencyKey: input.idempotencyKey ?? null,
          createdBy: by,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>);
      }
      const next: Omit<DepositRecord, "id" | "createdAt" | "updatedAt"> = {
        ...deposit,
        // A receipt with an idempotency key that hit an existing payment doc was
        // already counted above — re-recording must not double the held amount.
        receivedAmount: normalizeMoney(pre.exists() ? deposit.receivedAmount : deposit.receivedAmount + amount),
        paymentId,
      };
      await setDoc(doc(db, "companies", companyId, REM_COLLECTIONS.deposits, leaseId), depositWrite(next), { merge: true });
      return { data: await readDeposit(companyId, leaseId), message: "Deposit receipt recorded" };
    });
  },
  async addDeduction(companyId: string, leaseId: string, input: { amount: number; reason: string; inspectionId?: string | null; approvedBy?: string | null }): Promise<ApiResponse<DepositRecord>> {
    return logged("addDepositDeduction", async () => {
      if (!input.reason || input.reason.trim().length < 3) throw new DomainValidationError("deductionReasonRequired");
      const d = await readDeposit(companyId, leaseId);
      const err = validateDepositMovement(d, { kind: "deduction", amount: input.amount });
      if (err) throw new DomainValidationError(err);
      const next = {
        ...d,
        deductions: [...(d.deductions ?? []), { id: cryptoId(), amount: normalizeMoney(input.amount), reason: input.reason.trim(), inspectionId: input.inspectionId ?? null, approvedBy: input.approvedBy ?? null, at: new Date().toISOString() }],
      };
      await setDoc(doc(db, "companies", companyId, REM_COLLECTIONS.deposits, leaseId), depositWrite(next), { merge: true });
      return { data: await readDeposit(companyId, leaseId), message: "Deduction recorded" };
    });
  },
  async refund(companyId: string, leaseId: string, input: { amount: number; reference?: string | null }): Promise<ApiResponse<DepositRecord>> {
    return logged("refundDeposit", async () => {
      const d = await readDeposit(companyId, leaseId);
      const err = validateDepositMovement(d, { kind: "refund", amount: input.amount });
      if (err) throw new DomainValidationError(err);
      const next = {
        ...d,
        refunds: [...(d.refunds ?? []), { id: cryptoId(), amount: normalizeMoney(input.amount), at: new Date().toISOString(), reference: input.reference ?? null }],
      };
      await setDoc(doc(db, "companies", companyId, REM_COLLECTIONS.deposits, leaseId), depositWrite(next), { merge: true });
      const saved = await readDeposit(companyId, leaseId);
      // When nothing remains owed, stamp the final refund for the closure record.
      if (depositHeld(saved) === 0) {
        await patchRecord(companyId, REM_COLLECTIONS.deposits, leaseId, { finalRefundAmount: normalizeMoney(input.amount) });
      }
      return { data: await readDeposit(companyId, leaseId), message: "Refund recorded" };
    });
  },
  /** Link the exit inspection that evidences deductions. */
  async linkHandoverInspection(companyId: string, leaseId: string, inspectionId: string): Promise<ApiResponse<DepositRecord>> {
    return logged("linkDepositInspection", async () => {
      await patchRecord(companyId, REM_COLLECTIONS.deposits, leaseId, { handoverInspectionId: inspectionId });
      return { data: await readDeposit(companyId, leaseId), message: "Inspection linked" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Due-date processing (on-demand; NO background scheduler claimed)           */
/* -------------------------------------------------------------------------- */

export const EXPIRY_WINDOW_DAYS_DEFAULT = 60;

/**
 * Reusable due-date processor. There is NO cron in this repo's architecture,
 * so this runs ON DEMAND (dashboard load / explicit action) and is documented
 * as such — nothing here pretends background processing is live. It only flips
 * calendar-derived states: active -> expiring/expired, installment statuses,
 * unit occupancy caches. It never terminates, deletes or fabricates records.
 * Idempotent: re-running with the same clock changes nothing.
 */
export async function processDueDates(
  companyId: string,
  opts: { expiryWindowDays?: number; today?: string } = {}
): Promise<{ leasesExpired: number; leasesFlagged: number; installmentsUpdated: number }> {
  const today = opts.today ?? todayIso();
  const window = opts.expiryWindowDays ?? EXPIRY_WINDOW_DAYS_DEFAULT;
  const leases = await listCollectionUnordered<Lease>(companyId, REM_COLLECTIONS.leases);
  let leasesExpired = 0;
  let leasesFlagged = 0;
  let installmentsUpdated = 0;
  const touchedUnits = new Set<string>();
  for (const raw of leases) {
    const lease = normalize<Lease>(raw.id, raw as unknown as Record<string, unknown>, LEASE_DATES);
    if (shouldFlagExpired(lease.status, lease.endDate, today)) {
      await patchRecord(companyId, REM_COLLECTIONS.leases, lease.id, { status: "expired" });
      leasesExpired += 1;
      touchedUnits.add(lease.unitId);
      installmentsUpdated += await refreshInstallmentStatuses(companyId, { ...lease, status: "expired" });
    } else if (shouldFlagExpiring(lease.status, lease.endDate, window, today)) {
      await patchRecord(companyId, REM_COLLECTIONS.leases, lease.id, { status: "expiring" });
      leasesFlagged += 1;
      installmentsUpdated += await refreshInstallmentStatuses(companyId, { ...lease, status: "expiring" });
    } else if (lease.status === "expiring" && lease.endDate >= today) {
      // Clock moved but end date is back beyond the window (edited lease):
      // restore active rather than strand it in a stale flag.
      await patchRecord(companyId, REM_COLLECTIONS.leases, lease.id, { status: "active" });
      touchedUnits.add(lease.unitId);
    } else if (lease.status === "active" || lease.status === "expiring") {
      installmentsUpdated += await refreshInstallmentStatuses(companyId, lease);
    }
  }
  for (const unitId of touchedUnits) {
    await syncUnitOccupancy(companyId, unitId).catch(() => undefined);
  }
  return { leasesExpired, leasesFlagged, installmentsUpdated };
}

/** Outstanding balance of a lease, derived from durable installment math. */
export function leaseOutstandingBalance(lease: Lease, installments: RentInstallment[]): number {
  return normalizeMoney(
    installments
      .filter((i) => i.leaseId === lease.id && i.status !== "cancelled")
      .reduce((a, i) => a + installmentOutstanding({ ...i, paidAmount: normalizeMoney(i.paidAmount) }), 0)
  );
}
