/**
 * Real Estate Management — financial domain rules (pure, no Firebase).
 *
 * Rent-schedule generation, payment allocation math, deposit liability and
 * report aggregations are defined HERE only, so the service, the UI and the
 * tests can never disagree. Money follows the repo convention: decimals
 * normalized to 2 dp (normalizeMoney in facilities rules), currency preserved
 * on every record, and NO cross-currency aggregation anywhere.
 */

import type {
  DepositRecord,
  InstallmentStatus,
  Lease,
  PaymentAllocation,
  RentInstallment,
  RentPayment,
} from "../types/real-estate.types";
import { installmentTotal } from "../types/real-estate.types";
import { addDaysIso, addMonthsIso, isValidIsoDate, todayIso } from "./rem-rules";

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/** Same 2-dp minor-unit-safe convention as the shared facilities/billing rules. */
export function normalizeMoney(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Money totals NEVER mix currencies: aggregation helpers take a currency and
 * filter records to it. Callers surface other-currency records separately.
 */
export function sumInCurrency<T extends { currency: string }>(records: T[], currency: string, pick: (r: T) => number): number {
  const c = currency.toUpperCase();
  return normalizeMoney(records.filter((r) => (r.currency ?? "").toUpperCase() === c).reduce((a, r) => a + pick(r), 0));
}

/* -------------------------------------------------------------------------- */
/* Period math & escalations                                                  */
/* -------------------------------------------------------------------------- */

const FREQUENCY_MONTHS: Record<Lease["frequency"], number> = {
  monthly: 1,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

/** Period boundaries covering the lease: [start, end] inclusive per period. */
export interface PeriodSpan {
  index: number;
  start: string;
  end: string;
}

export function buildPeriodSpans(startDate: string, endDate: string, frequency: Lease["frequency"]): PeriodSpan[] {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || endDate < startDate) return [];
  const step = FREQUENCY_MONTHS[frequency] ?? 1;
  const spans: PeriodSpan[] = [];
  let cursor = startDate;
  let index = 1;
  while (cursor <= endDate) {
    // Period end = cursor + step months - 1 day, clamped to lease end.
    let end = addDaysIso(addMonthsIso(cursor, step), -1);
    if (end > endDate) end = endDate;
    spans.push({ index, start: cursor, end });
    cursor = addDaysIso(end, 1);
    index += 1;
    if (spans.length > 1200) break; // hard stop: 100 years of monthly periods
  }
  return spans;
}

/** Rent for a period start after applying the latest escalation in effect. */
export function escalatedRent(baseRent: number, escalations: Lease["escalations"], periodStart: string): number {
  let rent = normalizeMoney(baseRent);
  const applicable = (escalations ?? [])
    .filter((e) => isValidIsoDate(e.effectiveDate) && isValidIsoDate(periodStart) && periodStart >= e.effectiveDate)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  for (const e of applicable) {
    const pct = Number.isFinite(e.percent) ? e.percent : 0;
    rent = normalizeMoney(rent * (1 + pct / 100));
  }
  return rent;
}

export function installmentDueDate(periodStart: string, periodEnd: string, lease: Pick<Lease, "dueDay" | "timing" | "customDueDates" | "gracePeriodDays">, periodIndex: number): string {
  if (lease.customDueDates?.[periodIndex - 1] && isValidIsoDate(lease.customDueDates[periodIndex - 1])) {
    return lease.customDueDates[periodIndex - 1];
  }
  const anchor = lease.timing === "advance" ? periodStart : periodEnd;
  const year = Number(anchor.slice(0, 4));
  const month = Number(anchor.slice(5, 7));
  const day = Math.min(lease.dueDay || 1, 28);
  const last = new Date(year, month, 0).getDate();
  const due = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  return isValidIsoDate(due) ? due : anchor;
}

/* -------------------------------------------------------------------------- */
/* Rent schedule generation (idempotent)                                      */
/* -------------------------------------------------------------------------- */

export interface GeneratedInstallment {
  id: string;
  leaseId: string;
  unitId: string;
  propertyId: string;
  periodKey: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  principalAmount: number;
  feesAmount: number;
  taxAmount: number;
  discountAmount: number;
  currency: string;
  paidAmount: number;
  status: InstallmentStatus;
}

/**
 * Deterministic documents for a full lease schedule. The doc id/periodKey is
 * `${leaseId}_${index}`, so a RETRIED generation writes the exact same ids —
 * duplicate schedules are impossible by construction (the service writes with
 * setDoc-merge semantics; already-paid installments are never overwritten).
 */
export function buildRentSchedule(lease: Lease): GeneratedInstallment[] {
  const spans = buildPeriodSpans(lease.startDate, lease.endDate, lease.frequency);
  // Per-period tax: explicit taxAmount is treated as per-period when the
  // schedule was built with it; discount applies to the FIRST period only
  // (signing discounts) — both are snapshots of the lease terms.
  return spans.map((span) => {
    const principal = escalatedRent(lease.rentAmount, lease.escalations, span.start);
    const perPeriodTax = normalizeMoney(lease.taxAmount ?? 0);
    const discount = span.index === 1 ? normalizeMoney(lease.discountAmount ?? 0) : 0;
    return {
      id: `${lease.id}_${span.index}`,
      leaseId: lease.id,
      unitId: lease.unitId,
      propertyId: lease.propertyId,
      periodKey: `${lease.id}_${span.index}`,
      periodIndex: span.index,
      periodStart: span.start,
      periodEnd: span.end,
      dueDate: installmentDueDate(span.start, span.end, lease, span.index),
      principalAmount: principal,
      feesAmount: normalizeMoney(lease.feesAmount ?? 0),
      taxAmount: perPeriodTax,
      discountAmount: discount,
      currency: lease.currency,
      paidAmount: 0,
      status: "upcoming" as InstallmentStatus,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Installment status (derived)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Status is DERIVED from amounts + dates, so it can never silently contradict
 * the payment records:
 * paid >= total -> paid; 0 < paid < total -> partially_paid; else past the due
 * date (+grace) -> overdue; within the due window -> due; else upcoming.
 * A cancelled installment stays cancelled (explicit financial decision).
 */
export function deriveInstallmentStatus(
  i: Pick<RentInstallment, "principalAmount" | "feesAmount" | "taxAmount" | "discountAmount" | "paidAmount" | "dueDate">,
  graceDays: number,
  today = todayIso()
): InstallmentStatus {
  const total = normalizeMoney(installmentTotal(i));
  const paid = normalizeMoney(i.paidAmount);
  if (total > 0 && paid >= total) return "paid";
  if (paid > 0) return "partially_paid";
  if (!isValidIsoDate(i.dueDate)) return "upcoming";
  const overdueFrom = addDaysIso(i.dueDate, Math.max(0, graceDays || 0));
  if (overdueFrom < today) return "overdue";
  if (i.dueDate <= today) return "due";
  return "upcoming";
}

export function installmentOutstanding(i: Pick<RentInstallment, "principalAmount" | "feesAmount" | "taxAmount" | "discountAmount" | "paidAmount">): number {
  const total = normalizeMoney(installmentTotal(i));
  const paid = normalizeMoney(i.paidAmount);
  return Math.max(0, normalizeMoney(total - paid));
}

/* -------------------------------------------------------------------------- */
/* Payment allocation validation                                              */
/* -------------------------------------------------------------------------- */

export interface AllocationContext {
  installment: RentInstallment;
  /** Sum of allocations from PREVIOUS valid payments for this installment. */
  alreadyAllocated: number;
}

export type AllocationRejection = "installment_not_found" | "currency_mismatch" | "over_allocation" | "non_positive";

/**
 * A payment's allocations are validated against the installment currency and
 * outstanding balance (never against the mutable status field). Overpayment is
 * rejected — the tenant must allocate exactly what was collected; credit
 * notes/refunds are separate financial workflows.
 */
export function validatePaymentAllocations(
  payment: { amount: number; currency: string; allocations: PaymentAllocation[] },
  contexts: AllocationContext[]
): { ok: true } | { ok: false; reason: AllocationRejection; installmentId: string } {
  const total = normalizeMoney(payment.amount);
  if (total <= 0) return { ok: false, reason: "non_positive", installmentId: "" };
  const allocSum = normalizeMoney(payment.allocations.reduce((a, al) => a + (Number(al.amount) || 0), 0));
  if (allocSum > total + 0.001) {
    return { ok: false, reason: "over_allocation", installmentId: payment.allocations[0]?.installmentId ?? "" };
  }
  for (const al of payment.allocations) {
    const ctx = contexts.find((c) => c.installment.id === al.installmentId);
    if (!ctx) return { ok: false, reason: "installment_not_found", installmentId: al.installmentId };
    if ((ctx.installment.currency ?? "").toUpperCase() !== (payment.currency ?? "").toUpperCase())
      return { ok: false, reason: "currency_mismatch", installmentId: al.installmentId };
    const amount = normalizeMoney(al.amount);
    if (amount <= 0) return { ok: false, reason: "non_positive", installmentId: al.installmentId };
    const outstanding = installmentOutstanding({ ...ctx.installment, paidAmount: ctx.alreadyAllocated });
    if (amount > outstanding + 0.001) return { ok: false, reason: "over_allocation", installmentId: al.installmentId };
  }
  return { ok: true };
}

/** Allocations re-applied to installments after a void = full reversal. */
export function effectiveAllocations(payments: RentPayment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of payments) {
    if (p.voided) continue;
    for (const al of p.allocations ?? []) {
      map.set(al.installmentId, normalizeMoney((map.get(al.installmentId) ?? 0) + normalizeMoney(al.amount)));
    }
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* Deposits — liability math (never revenue)                                  */
/* -------------------------------------------------------------------------- */

export function depositHeld(d: Pick<DepositRecord, "receivedAmount" | "deductions" | "refunds">): number {
  const deducted = normalizeMoney((d.deductions ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  const refunded = normalizeMoney((d.refunds ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  return Math.max(0, normalizeMoney(normalizeMoney(d.receivedAmount) - deducted - refunded));
}

export function depositLiability(d: Pick<DepositRecord, "expectedAmount" | "receivedAmount" | "deductions" | "refunds">): number {
  const refunded = normalizeMoney((d.refunds ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  const deducted = normalizeMoney((d.deductions ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  // Owed = received - deducted - refunded; an un-received expected deposit is a
  // receivable, not a liability, so it floors at zero here.
  return Math.max(0, normalizeMoney(normalizeMoney(d.receivedAmount) - deducted - refunded));
}

/**
 * Deposit lifecycle state, derived from the ledger rows: nothing received ->
 * expected; liability left -> received; settled with both deductions and
 * refunds -> partially_refunded; only refunds -> fully_refunded; only
 * deductions -> forfeited.
 */
export function depositStatusFor(d: Pick<DepositRecord, "expectedAmount" | "receivedAmount" | "deductions" | "refunds">): DepositRecord["status"] {
  const received = normalizeMoney(d.receivedAmount);
  if (received <= 0) return "expected";
  const held = depositHeld(d);
  if (held > 0) return "received";
  const refunded = normalizeMoney((d.refunds ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  const deducted = normalizeMoney((d.deductions ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  if (refunded > 0 && deducted > 0) return "partially_refunded";
  if (refunded > 0) return "fully_refunded";
  return "forfeited";
}

/** Refund + deduction may never exceed what was received. */
export function validateDepositMovement(
  d: Pick<DepositRecord, "receivedAmount" | "deductions" | "refunds">,
  movement: { kind: "refund" | "deduction"; amount: number }
): string | null {
  const amount = normalizeMoney(movement.amount);
  if (amount <= 0) return "validation.money";
  const used =
    normalizeMoney((d.deductions ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0)) +
    normalizeMoney((d.refunds ?? []).reduce((a, x) => a + normalizeMoney(x.amount), 0));
  if (used + amount > normalizeMoney(d.receivedAmount) + 0.001) return "validation.depositInsufficientBalance";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reporting aggregations                                                     */
/* -------------------------------------------------------------------------- */

export interface CollectionSummary {
  dueTotal: number;
  collectedTotal: number;
  overdueTotal: number;
  partialTotal: number;
  outstandingTotal: number;
}

/**
 * Collections summary for a set of installments + the lease grace map. Only
 * ACTIVE-calendar installments count (caller filters terminal leases). Cash
 * basis = collected (paid allocations); accrual = due totals. Voided payments
 * are excluded via effectiveAllocations upstream.
 */
export function summarizeCollections(
  installments: RentInstallment[],
  graceByLease: Map<string, number>,
  currency: string,
  today = todayIso()
): CollectionSummary {
  const c = currency.toUpperCase();
  const inScope = installments.filter(
    (i) => (i.currency ?? "").toUpperCase() === c && i.status !== "cancelled"
  );
  let due = 0;
  let collected = 0;
  let overdue = 0;
  let partial = 0;
  let outstanding = 0;
  for (const i of inScope) {
    const total = normalizeMoney(installmentTotal(i));
    const paid = normalizeMoney(i.paidAmount);
    due += total;
    collected += paid;
    const grace = graceByLease.get(i.leaseId) ?? 0;
    const status = deriveInstallmentStatus(i, grace, today);
    if (status === "overdue") overdue += total - paid;
    if (status === "partially_paid") partial += total - paid;
    outstanding += Math.max(0, total - paid);
  }
  return {
    dueTotal: normalizeMoney(due),
    collectedTotal: normalizeMoney(collected),
    overdueTotal: normalizeMoney(overdue),
    partialTotal: normalizeMoney(partial),
    outstandingTotal: normalizeMoney(outstanding),
  };
}

/** Arrears aging buckets by days past due date (grace-adjusted). */
export function arrearsAging(
  installments: RentInstallment[],
  graceByLease: Map<string, number>,
  currency: string,
  today = todayIso()
): { current: number; days1_30: number; days31_60: number; days61_90: number; over90: number } {
  const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, over90: 0 };
  const c = currency.toUpperCase();
  for (const i of installments) {
    if ((i.currency ?? "").toUpperCase() !== c || i.status === "cancelled") continue;
    const outstanding = installmentOutstanding(i);
    if (outstanding <= 0) continue;
    const grace = graceByLease.get(i.leaseId) ?? 0;
    const overdueFrom = addDaysIso(i.dueDate, grace);
    if (overdueFrom >= today) {
      buckets.current += outstanding;
      continue;
    }
    const days = Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${overdueFrom}T00:00:00`)) / 86_400_000);
    if (days <= 30) buckets.days1_30 += outstanding;
    else if (days <= 60) buckets.days31_60 += outstanding;
    else if (days <= 90) buckets.days61_90 += outstanding;
    else buckets.over90 += outstanding;
  }
  for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[k] = normalizeMoney(buckets[k]);
  return buckets;
}

/**
 * Occupancy rate — documented formula:
 * occupied units / units that are leasable (operational, non-archived) —
 * unavailable/maintenance units are excluded from the denominator.
 */
export function occupancyRate(unitOccupancy: { occupancyStatus: OccupancyStatusLike; operationalStatus: string }[]): number {
  const leasable = unitOccupancy.filter((u) => u.operationalStatus === "active");
  if (leasable.length === 0) return 0;
  const occupied = leasable.filter((u) => u.occupancyStatus === "occupied").length;
  return Math.round((occupied / leasable.length) * 1000) / 10;
}

type OccupancyStatusLike = "vacant" | "reserved" | "occupied" | "under_maintenance" | "unavailable";

/**
 * NOI summary for one currency. Expenses counted = the rows the caller passed
 * (approved/recorded snapshots); rows that reference the SAME billing document
 * are counted once — a duplicate posting never inflates the total. Deposits
 * are NOT income and are never passed here (liability, separate lifecycle).
 */
export function operatingSummary(
  collected: number,
  expenses: {
    amount: number;
    currency: string;
    category?: string;
    billId?: string | null;
    voucherId?: string | null;
    journalId?: string | null;
  }[],
  currency: string
): { income: number; expenses: number; noi: number; expenseByCategory: Map<string, number> } {
  const c = currency.toUpperCase();
  const seenRefs = new Set<string>();
  let expenseTotal = 0;
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    if ((e.currency ?? "").toUpperCase() !== c) continue;
    const refs = [e.billId, e.voucherId, e.journalId].filter((r): r is string => Boolean(r));
    const dupRef = refs.find((r) => seenRefs.has(r));
    if (dupRef) continue; // same billing document already counted
    for (const r of refs) seenRefs.add(r);
    const amount = normalizeMoney(e.amount);
    expenseTotal += amount;
    const cat = e.category ?? "other";
    byCategory.set(cat, normalizeMoney((byCategory.get(cat) ?? 0) + amount));
  }
  return {
    income: normalizeMoney(collected),
    expenses: normalizeMoney(expenseTotal),
    noi: normalizeMoney(normalizeMoney(collected) - normalizeMoney(expenseTotal)),
    expenseByCategory: byCategory,
  };
}
