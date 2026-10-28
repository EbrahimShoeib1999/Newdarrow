/**
 * D-Arrow Business — REAL_ESTATE_MANAGEMENT domain unit suite
 *
 * Pure deterministic tests over the money/rules helpers the REM services use
 * (no Firebase, no DOM): schedule generation + retry idempotency, payment
 * allocation validation, outstanding-balance math, deposit liability/status
 * derivation, arrears aging, and the lease overlap/occupancy state machine.
 * Run: npx tsx scripts/test-rem-unit.ts
 */

import {
  addDaysIso,
  addMonthsIso,
  datesOverlap,
  isValidIsoDate,
  canTransitionLease,
  isTerminalLeaseStatus,
  allowedNextLeaseStatuses,
  shouldFlagExpiring,
  shouldFlagExpired,
  findLeaseOverlap,
  deriveOccupancyState,
  isUnitAvailableForNewLease,
} from "../src/features/real-estate/lib/rem-rules";
import {
  normalizeMoney,
  buildPeriodSpans,
  escalatedRent,
  installmentDueDate,
  buildRentSchedule,
  deriveInstallmentStatus,
  installmentOutstanding,
  validatePaymentAllocations,
  effectiveAllocations,
  depositHeld,
  depositLiability,
  depositStatusFor,
  validateDepositMovement,
  summarizeCollections,
  arrearsAging,
  type AllocationContext,
} from "../src/features/real-estate/lib/rem-finance";
import { installmentTotal } from "../src/features/real-estate/types/real-estate.types";
import type { Lease, RentInstallment, RentPayment } from "../src/features/real-estate/types/real-estate.types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function eq(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS - ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err?.message ?? err}`);
    failedCount++;
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const installment = (over: Partial<RentInstallment> & { id: string }): RentInstallment =>
  ({
    leaseId: "L1",
    unitId: "U1",
    propertyId: "P1",
    periodKey: `${over.leaseId ?? "L1"}_1`,
    periodIndex: 1,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    dueDate: "2026-01-01",
    principalAmount: 1000,
    feesAmount: 0,
    taxAmount: 0,
    discountAmount: 0,
    paidAmount: 0,
    currency: "SAR",
    status: "upcoming",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as RentInstallment;

const leaseFixture = (over: Partial<Lease>): Lease =>
  ({
    id: "L1",
    unitId: "U1",
    propertyId: "P1",
    contractNumber: "CTR-0001",
    status: "active",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    rentAmount: 1000,
    currency: "SAR",
    frequency: "monthly",
    dueDay: 1,
    timing: "advance",
    gracePeriodDays: 0,
    depositAmount: 0,
    depositStatus: "expected",
    escalations: [],
    feesAmount: 0,
    taxAmount: 0,
    taxPercent: 0,
    discountAmount: 0,
    approvals: [],
    amendments: [],
    ...over,
  }) as unknown as Lease;

/* -------------------------------------------------------------------------- */
/* Suite                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log("\n=== REM domain unit suite (pure helpers used by the services) ===\n");

  /* Date helpers */
  await test("iso date validation accepts dates and rejects garbage", () => {
    assert(isValidIsoDate("2026-02-28"), "valid date accepted");
    assert(!isValidIsoDate("2026-13-01"), "impossible month rejected");
    assert(!isValidIsoDate("28-02-2026"), "wrong order rejected");
    assert(!isValidIsoDate(""), "empty rejected");
  });

  await test("addDaysIso crosses month and year boundaries", () => {
    eq(addDaysIso("2026-01-31", 1), "2026-02-01", "month rollover");
    eq(addDaysIso("2026-12-31", 1), "2027-01-01", "year rollover");
  });

  await test("addMonthsIso clamps to the real end of month", () => {
    eq(addMonthsIso("2026-01-31", 1), "2026-02-28", "Jan 31 + 1M clamps to Feb 28");
    eq(addMonthsIso("2024-01-31", 1), "2024-02-29", "leap-year clamp");
  });

  /* Overlap semantics */
  await test("datesOverlap detects intersection but not back-to-back terms", () => {
    assert(datesOverlap("2026-01-01", "2026-06-30", "2026-06-01", "2026-12-31"), "shared June overlaps");
    assert(!datesOverlap("2027-01-01", "2027-12-31", "2026-01-01", "2026-12-31"), "consecutive years do not overlap");
  });

  await test("findLeaseOverlap blocks only blocking statuses on the same unit", () => {
    const leases = [
      { id: "A", unitId: "U1", status: "active" as const, startDate: "2026-01-01", endDate: "2026-12-31" },
      { id: "B", unitId: "U1", status: "expired" as const, startDate: "2025-01-01", endDate: "2025-12-31" },
      { id: "C", unitId: "U2", status: "active" as const, startDate: "2026-01-01", endDate: "2026-12-31" },
    ];
    eq(findLeaseOverlap("U1", "2026-06-01", "2026-12-31", leases)?.leaseId, "A", "conflicts with active A");
    eq(findLeaseOverlap("U1", "2025-06-01", "2025-12-31", leases), null, "expired B does not block");
    eq(findLeaseOverlap("U2", "2026-06-01", "2026-12-31", leases)?.leaseId, "C", "other unit's lease C conflicts on U2");
    eq(findLeaseOverlap("U1", "2026-06-01", "2026-12-31", leases, "A"), null, "self is ignored when amending");
  });

  /* Lease state machine */
  await test("terminal statuses allow no transitions; expired may renew", () => {
    assert(!canTransitionLease("terminated", "active"), "terminated is frozen");
    assert(!canTransitionLease("cancelled", "draft"), "cancelled is frozen");
    assert(isTerminalLeaseStatus("renewed"), "renewed is terminal");
    assert(allowedNextLeaseStatuses("expired").includes("renewed"), "expired can renew");
    assert(!allowedNextLeaseStatuses("expired").includes("active"), "expired cannot reactivate directly");
  });

  await test("expiring/expired flags respect status and window", () => {
    const today = "2026-06-01";
    assert(shouldFlagExpiring("active", "2026-07-01", 60, today), "30 days out within a 60-day window");
    assert(!shouldFlagExpiring("draft", "2026-07-01", 60, today), "draft never flagged");
    assert(!shouldFlagExpiring("active", "2026-09-01", 60, today), "beyond window not flagged");
    assert(shouldFlagExpired("expiring", "2026-05-31", today), "past end date expires");
    assert(!shouldFlagExpired("active", "2026-06-01", today), "ending today is not past");
  });

  /* Occupancy derivation */
  await test("occupancy derives from leases first, operational status second", () => {
    const today = "2026-06-01";
    const unit = { operationalStatus: "active" as const };
    eq(
      deriveOccupancyState(unit, [{ id: "A", status: "active", startDate: "2026-01-01", endDate: "2026-12-31" }], today),
      "occupied",
      "covering active lease"
    );
    eq(
      deriveOccupancyState(unit, [{ id: "A", status: "pending_approval", startDate: "2026-09-01", endDate: "2027-08-31" }], today),
      "reserved",
      "future blocking lease reserves"
    );
    eq(deriveOccupancyState(unit, [], today, true), "under_maintenance", "maintenance hold without lease");
    eq(deriveOccupancyState(unit, [], today), "vacant", "no lease, no hold");
    eq(
      deriveOccupancyState({ operationalStatus: "unavailable" as const }, [], today),
      "unavailable",
      "operational status decides when lease-free"
    );
    eq(
      deriveOccupancyState(
        { operationalStatus: "unavailable" as const },
        [{ id: "A", status: "active", startDate: "2026-01-01", endDate: "2026-12-31" }],
        today
      ),
      "occupied",
      "a live lease outranks the operational flag"
    );
  });

  await test("unit availability for a new lease requires vacant + active + not archived", () => {
    assert(!isUnitAvailableForNewLease({ operationalStatus: "active", archived: false }, "occupied"), "occupied not offerable");
    assert(!isUnitAvailableForNewLease({ operationalStatus: "active", archived: true }, "vacant"), "archived not offerable");
    assert(isUnitAvailableForNewLease({ operationalStatus: "active", archived: false }, "vacant"), "vacant active is offerable");
  });

  /* Money primitives */
  await test("normalizeMoney rounds to 2dp and coerces junk to 0", () => {
    eq(normalizeMoney("100.005"), 100.01, "half-cent rounds up at 2dp");
    eq(normalizeMoney("abc"), 0, "junk becomes 0");
    eq(normalizeMoney(null), 0, "null becomes 0");
    eq(normalizeMoney(12.345), 12.35, "float rounded");
  });

  await test("installment total includes fees + tax and subtracts discount", () => {
    const i = installment({ id: "I1", principalAmount: 1000, feesAmount: 50, taxAmount: 150, discountAmount: 100 });
    eq(installmentTotal(i), 1100, "1000+50+150-100");
    eq(installmentOutstanding({ ...i, paidAmount: 400 }), 700, "outstanding = total - paid");
    eq(installmentOutstanding({ ...i, paidAmount: 5000 }), 0, "never negative");
  });

  /* Schedule generation */
  await test("buildPeriodSpans covers the lease term per frequency", () => {
    eq(buildPeriodSpans("2026-01-01", "2026-12-31", "monthly").length, 12, "12 monthly periods");
    eq(buildPeriodSpans("2026-01-01", "2026-12-31", "quarterly").length, 4, "4 quarterly periods");
    eq(buildPeriodSpans("2026-01-01", "2027-12-31", "annual").length, 2, "2 annual periods");
    const q = buildPeriodSpans("2026-01-01", "2026-12-31", "quarterly");
    eq(q[0].start, "2026-01-01", "first span starts on lease start");
    eq(q[3].end, "2026-12-31", "last span ends on lease end");
  });

  await test("escalatedRent applies percentage uplifts from their effective date", () => {
    const esc = [{ effectiveDate: "2027-01-01", percent: 10 }];
    eq(escalatedRent(1000, esc, "2026-06-01"), 1000, "before uplift");
    eq(escalatedRent(1000, esc, "2027-03-01"), 1100, "after uplift");
  });

  await test("due dates honour customDueDates, timing anchor and day-of-month clamp", () => {
    const lease = { dueDay: 1, timing: "advance" as const, gracePeriodDays: 0 };
    eq(installmentDueDate("2026-02-01", "2026-02-28", lease, 1), "2026-02-01", "advance anchors at period start");
    // Arrears anchors in the period-END month; the due day is the lease's dueDay.
    eq(installmentDueDate("2026-02-01", "2026-02-28", { ...lease, dueDay: 28, timing: "arrears" }, 1), "2026-02-28", "arrears dueDay 28 lands on period end");
    eq(installmentDueDate("2026-02-01", "2026-02-28", { ...lease, timing: "arrears" }, 1), "2026-02-01", "arrears keeps dueDay inside the end month");
    eq(installmentDueDate("2026-02-01", "2026-02-28", { ...lease, dueDay: 31 }, 1), "2026-02-28", "day 31 clamps into the month");
    eq(installmentDueDate("2026-02-01", "2026-02-28", { ...lease, customDueDates: ["2026-02-10"] }, 1), "2026-02-10", "custom list wins");
  });

  await test("rent schedule is deterministic and discount applies to period 1 only", () => {
    const lease = leaseFixture({ discountAmount: 500, taxAmount: 100, feesAmount: 50, escalations: [{ effectiveDate: "2026-07-01", percent: 5 }] });
    const s1 = buildRentSchedule(lease);
    const s2 = buildRentSchedule(lease);
    eq(JSON.stringify(s1), JSON.stringify(s2), "retry produces identical docs (idempotent)");
    eq(s1.length, 12, "monthly full term");
    eq(s1[0].id, "L1_1", "id is leaseId_index");
    eq(s1[0].discountAmount, 500, "first period carries the signing discount");
    eq(s1[1].discountAmount, 0, "later periods do not");
    eq(s1[0].principalAmount, 1000, "pre-escalation rent");
    eq(s1[6].principalAmount, 1050, "July uplift");
    eq(installmentTotal(s1[0]), 650, "period 1: 1000+50+100-500 discount");
    eq(installmentTotal(s1[1]), 1150, "period 2: 1000+50+100");
  });

  /* Installment status derivation */
  await test("status derives from amounts then dates, never contradicting the ledger", () => {
    const base = installment({ id: "I1" });
    const grace = 5;
    eq(deriveInstallmentStatus({ ...base, paidAmount: 1000 }, grace, "2026-06-01"), "paid", "fully paid");
    eq(deriveInstallmentStatus({ ...base, paidAmount: 300 }, grace, "2026-06-01"), "partially_paid", "some paid");
    eq(deriveInstallmentStatus(base, grace, "2026-06-01"), "overdue", "due 2026-01-01 + 5 grace < today");
    eq(deriveInstallmentStatus({ ...base, dueDate: "2026-06-01" }, grace, "2026-06-01"), "due", "due today inside grace");
    eq(deriveInstallmentStatus({ ...base, dueDate: "2026-08-01" }, grace, "2026-06-01"), "upcoming", "future due date");
  });

  /* Payment allocations */
  await test("allocation validation enforces currency, outstanding and positivity", () => {
    const i = installment({ id: "I1", principalAmount: 1000 });
    const j = installment({ id: "I2", currency: "EGP" });
    const ctx = (inst: RentInstallment, already: number): AllocationContext => ({ installment: inst, alreadyAllocated: already });
    eq(
      validatePaymentAllocations({ amount: 1000, currency: "SAR", allocations: [{ installmentId: "I1", amount: 1000 }] }, [ctx(i, 0)]),
      { ok: true },
      "exact settlement passes"
    );
    eq(
      validatePaymentAllocations({ amount: 1000, currency: "SAR", allocations: [{ installmentId: "I1", amount: 1001 }] }, [ctx(i, 0)]).ok,
      false,
      "more than outstanding rejected"
    );
    eq(
      (validatePaymentAllocations({ amount: 700, currency: "SAR", allocations: [{ installmentId: "I1", amount: 700 }] }, [ctx(i, 500)]) as any).reason,
      "over_allocation",
      "prior allocations count toward the cap"
    );
    eq(
      (validatePaymentAllocations({ amount: 500, currency: "SAR", allocations: [{ installmentId: "I2", amount: 500 }] }, [ctx(i, 0), ctx(j, 0)]) as any).reason,
      "currency_mismatch",
      "EGP installment cannot absorb SAR payment"
    );
    eq(
      (validatePaymentAllocations({ amount: 500, currency: "SAR", allocations: [{ installmentId: "GONE", amount: 500 }] }, [ctx(i, 0)]) as any).reason,
      "installment_not_found",
      "unknown installment rejected"
    );
    eq(
      (validatePaymentAllocations({ amount: 500, currency: "SAR", allocations: [{ installmentId: "I1", amount: 0 }] }, [ctx(i, 0)]) as any).reason,
      "non_positive",
      "zero allocation rejected"
    );
    eq(
      (validatePaymentAllocations({ amount: 100, currency: "SAR", allocations: [{ installmentId: "I1", amount: 200 }] }, [ctx(i, 0)]) as any).reason,
      "over_allocation",
      "allocating beyond the payment itself rejected"
    );
  });

  await test("voided payments wash out of the effective allocation map", () => {
    const payments = [
      { id: "p1", voided: false, allocations: [{ installmentId: "I1", amount: 400 }] },
      { id: "p2", voided: true, allocations: [{ installmentId: "I1", amount: 600 }] },
    ] as unknown as RentPayment[];
    eq(effectiveAllocations(payments).get("I1"), 400, "void reversal is complete");
  });

  /* Deposits */
  const ded = (amount: number) => ({ id: `D${amount}`, amount, reason: "damage", inspectionId: null, approvedBy: null, at: "2026-05-01T00:00:00Z" });
  const ref = (amount: number) => ({ id: `R${amount}`, amount, at: "2026-05-01T00:00:00Z", reference: null });

  await test("deposit held/liability exclude deductions and refunds", () => {
    const d = { expectedAmount: 3000, receivedAmount: 3000, deductions: [ded(500)], refunds: [ref(1000)] };
    eq(depositHeld(d), 1500, "held = received - deducted - refunded");
    eq(depositLiability(d), 1500, "liability mirrors held");
    eq(depositLiability({ expectedAmount: 3000, receivedAmount: 0, deductions: [], refunds: [] }), 0, "un-received expectation is not a liability");
  });

  await test("deposit status lifecycle derives from the ledger rows", () => {
    eq(depositStatusFor({ expectedAmount: 3000, receivedAmount: 0, deductions: [], refunds: [] }), "expected", "nothing received");
    eq(depositStatusFor({ expectedAmount: 3000, receivedAmount: 3000, deductions: [], refunds: [] }), "received", "held");
    eq(depositStatusFor({ expectedAmount: 3000, receivedAmount: 3000, deductions: [ded(3000)], refunds: [] }), "forfeited", "all deducted");
    eq(depositStatusFor({ expectedAmount: 3000, receivedAmount: 3000, deductions: [], refunds: [ref(3000)] }), "fully_refunded", "all refunded");
    eq(depositStatusFor({ expectedAmount: 3000, receivedAmount: 3000, deductions: [ded(1000)], refunds: [ref(2000)] }), "partially_refunded", "mixed settle");
  });

  await test("deposit movements cannot exceed what is held", () => {
    const d = { receivedAmount: 3000, deductions: [ded(2500)], refunds: [] };
    eq(validateDepositMovement(d, { kind: "refund", amount: 600 }), "validation.depositInsufficientBalance", "over-movement rejected");
    eq(validateDepositMovement(d, { kind: "refund", amount: 500 }), null, "remaining balance movable");
    eq(validateDepositMovement(d, { kind: "deduction", amount: 0 }), "validation.money", "zero movement rejected");
  });

  /* Aggregations */
  await test("collections summary skips cancelled rows and foreign currencies", () => {
    const rows = [
      installment({ id: "I1", dueDate: "2026-01-01", paidAmount: 0 }),
      installment({ id: "I2", dueDate: "2026-06-01", paidAmount: 1000 }),
      installment({ id: "I3", dueDate: "2026-01-01", status: "cancelled" }),
      installment({ id: "I4", currency: "EGP", dueDate: "2026-01-01" }),
    ];
    const grace = new Map([["L1", 0]]);
    const s = summarizeCollections(rows, grace, "SAR", "2026-06-15");
    eq(s.dueTotal, 2000, "two live SAR installments accrue");
    eq(s.collectedTotal, 1000, "paid amounts count as collected");
    eq(s.overdueTotal, 1000, "I1 overdue, I2 settled");
    eq(s.outstandingTotal, 1000, "open balance");
  });

  await test("arrears aging buckets respect the grace period", () => {
    const mk = (id: string, due: string) => installment({ id, dueDate: due });
    const rows = [mk("A", "2026-07-01"), mk("B", "2026-05-15"), mk("C", "2026-04-01"), mk("D", "2026-02-01"), mk("E", "2025-12-01")];
    const grace = new Map<string, number>([["L1", 10]]);
    const a = arrearsAging(rows, grace, "SAR", "2026-06-01");
    // overdueFrom = due + grace; days late vs 2026-06-01:
    // A 07-11 (future) -> current; B 05-25 (+7d) -> 1-30; C 04-11 (+51d) -> 31-60;
    // D 02-11 (+110d) and E 12-11 (+172d) -> over 90; nothing lands in 61-90.
    eq(a.current, 1000, "A not due yet");
    eq(a.days1_30, 1000, "B is 7 days past its grace-adjusted due date");
    eq(a.days31_60, 1000, "C is 51 days late");
    eq(a.days61_90, 0, "no row ages into 61-90");
    eq(a.over90, 2000, "D and E are both past 90 days");
  });

  console.log(`\n Results: ${passedCount} passed, ${failedCount} failed\n`);
  process.exit(failedCount > 0 ? 1 : 0);
}

main();
