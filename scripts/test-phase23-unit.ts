/**
 * D-Arrow Business — Phase 2 & 3 unit acceptance tests (pure, no Firebase/DOM)
 *
 * Phase 2: Monthly lateness accumulation & 8h → 1 deduction-day conversion.
 * Phase 3: Invoice VAT calculation (subtotal, 15% tax, grand total).
 *
 * Run: npx tsx scripts/test-phase23-unit.ts
 */

import {
  LATE_HOURS_PER_DEDUCTION_DAY,
  lateDeductionConversion,
  computeDeductionAmount,
  accumulateMonth,
  round2,
} from "../src/features/people/lib/work-schedule-rules";
import type { LatenessPolicy } from "../src/features/people/types/work-schedule.types";

import {
  computeInvoiceTotals,
  invoiceVatPercent,
} from "../src/features/billing/utils/invoice-line-utils";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}\n      expected ${b}\n      actual   ${a}`);
  }
}
function ok(cond: boolean, label: string) {
  eq(cond, true, label);
}

/* -------------------------------------------------------------------------- */
/* Phase 2: 8 accumulated late hours = 1 deduction day                         */
/* -------------------------------------------------------------------------- */

eq(LATE_HOURS_PER_DEDUCTION_DAY, 8, "Default constant is 8 hours per deduction day");

// 24 hours = 1440 minutes → exactly 3 days, remainder 0
{
  const conv = lateDeductionConversion(1440, 8);
  eq(conv.totalMinutes, 1440, "24h totalMinutes");
  eq(conv.totalHours, 24, "24h totalHours");
  eq(conv.deductionDays, 3, "24h → 3 deduction days (exact)");
  eq(conv.fullDays, 3, "24h → 3 full days");
  eq(conv.remainingMinutes, 0, "24h → 0 remaining");
  eq(conv.minutesPerDay, 480, "8h → 480 minutes per day");
}

// 20 hours = 1200 minutes → 2.5 days, remainder 4h (240min)
{
  const conv = lateDeductionConversion(1200, 8);
  eq(conv.deductionDays, 2.5, "20h → 2.5 fractional days (never rounds up)");
  eq(conv.fullDays, 2, "20h → 2 full days");
  eq(conv.remainingMinutes, 240, "20h → 240 min remainder (4h)");
}

// 7 hours = 420 min → less than 1 day → 0.875 days, fullDays=0, remainder=420
{
  const conv = lateDeductionConversion(420, 8);
  eq(conv.deductionDays, 0.88, "7h → 0.88 days (rounded 2dp)");
  eq(conv.fullDays, 0, "7h → 0 full days");
  eq(conv.remainingMinutes, 420, "7h remainder preserved");
}

// Zero lateness
{
  const conv = lateDeductionConversion(0);
  eq(conv.deductionDays, 0, "zero lateness → 0 days");
  eq(conv.remainingMinutes, 0, "zero remainder");
}

// Negative input clamped to 0
{
  const conv = lateDeductionConversion(-60);
  eq(conv.totalMinutes, 0, "negative clamped to 0");
  eq(conv.deductionDays, 0, "negative → 0 days");
}

// Custom ratio (12h = 1 day)
{
  const conv = lateDeductionConversion(2400, 12);
  eq(conv.deductionDays, 3.33, "2400min at 12h/day → 3.33 days");
  eq(conv.fullDays, 3, "3 full days");
  eq(conv.remainingMinutes, 240, "remainder = 240 min (4h)");
}

/* ---- computeDeductionAmount with conversion ---- */

{
  const result = computeDeductionAmount({
    monthlyGross: 10000,
    action: { kind: "propose_deduction", deductionDays: null, basis: "calendar_30" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
    accumulatedMinutes: 1440, // 24h
    hoursPerDeductionDay: 8,
  });
  eq(result.days, 3, "24h accumulation / 8h rule = 3 days");
  eq(result.dailyRate, round2(10000 / 30), "daily rate = gross/30 (calendar_30)");
  eq(result.amount, round2((result.dailyRate ?? 0) * 3), "amount = rate × 3");
  eq(result.capped, false, "no cap hit");
}

// Without conversion (legacy fixed days)
{
  const result = computeDeductionAmount({
    monthlyGross: 10000,
    action: { kind: "propose_deduction", deductionDays: 2, basis: "calendar_30" },
    workingDaysPerMonth: 26,
    alreadyCommitted: 0,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
    accumulatedMinutes: undefined,
    hoursPerDeductionDay: null,
  });
  eq(result.days, 2, "legacy fixed 2 days preserved");
}

/* ---- accumulateMonth exclusions (cancelled rows) ---- */
{
  const rows = [
    { id: "a1", date: "2026-10-05", status: "late", lateMinutes: 30, schedule: null },
    { id: "a2", date: "2026-10-10", status: "late", lateMinutes: 45, schedule: null },
    // cancelled row must NOT contribute
    { id: "a3", date: "2026-10-12", status: "cancelled", lateMinutes: 60, schedule: null },
    // absent contributes 0 (no lateMinutes on absent)
    { id: "a4", date: "2026-10-14", status: "absent", lateMinutes: 0, schedule: null },
  ];
  const acc = accumulateMonth(rows, "e1", "2026-10");
  eq(acc.totalMinutes, 75, "cancelled row excluded (30+45=75)");
  ok(acc.contributingIds.length === 2, "only two distinct contributors");
  ok(!acc.contributingIds.includes("a3"), "cancelled excluded from contributingIds");
  ok(!acc.contributingIds.includes("a4"), "absent row with 0 min not in contributors");
}

/* -------------------------------------------------------------------------- */
/* Phase 3: Invoice VAT (15% approved default)                                */
/* -------------------------------------------------------------------------- */

// Canonical scenario: 10000 SAR, 15% VAT → 1500 tax → 11500 grand total
{
  const totals = computeInvoiceTotals([
    { quantity: 1, unitPrice: 10000, taxRate: 15, discount: 0 },
  ]);
  eq(totals.subTotal, 10000, "subTotal = 10000");
  eq(totals.totalTax, 1500, "VAT at 15% = 1500");
  eq(totals.totalDiscount, 0, "no discount");
  eq(totals.grandTotal, 11500, "grand total = 11500");
}

// Zero tax (tax-exempt)
{
  const totals = computeInvoiceTotals([
    { quantity: 1, unitPrice: 5000, taxRate: 0, discount: 0 },
  ]);
  eq(totals.totalTax, 0, "zero-rate invoice: no tax");
  eq(totals.grandTotal, 5000, "zero-rate: total = subtotal");
}

// Multiple items, mixed rates (legacy 14% still derivable per-item, but new
// invoices use the 15% default).
{
  const totals = computeInvoiceTotals([
    { quantity: 2, unitPrice: 1000, taxRate: 15, discount: 0 },
    { quantity: 1, unitPrice: 3000, taxRate: 15, discount: 500 },
  ]);
  // item1: gross=2000, beforeTax=2000, tax=300
  // item2: gross=3000, beforeTax=2500, tax=375
  // subtotal = 2000+3000 = 5000 (gross before discount)
  // totalDiscount = 0+500 = 500
  // totalTax = 300+375 = 675
  // grandTotal = 5000 - 500 + 675 = 5175
  eq(totals.subTotal, 5000, "multi-item subTotal");
  eq(totals.totalDiscount, 500, "multi-item discount sum");
  eq(totals.totalTax, 675, "multi-item tax: 300 + 375 (both 15%)");
  eq(totals.grandTotal, 5175, "multi-item grand total");
}

// Decimal precision (rounding to 2 dp)
{
  const totals = computeInvoiceTotals([
    { quantity: 3, unitPrice: 33.33, taxRate: 15, discount: 0 },
  ]);
  // gross = 99.99, tax = 14.9985 → round 15.00
  eq(totals.subTotal, 99.99, "decimal subtotal rounds to 2dp");
  eq(totals.totalTax, 15, "decimal tax rounds to 2dp");
  eq(totals.grandTotal, 114.99, "decimal grand rounds to 2dp");
}

// invoiceVatPercent derives from stored amounts
{
  eq(invoiceVatPercent(10000, 1500), 15, "derived 15% from amounts (approved default)");
  eq(invoiceVatPercent(10000, 1400), 14, "legacy 14% invoice still derives correctly");
  eq(invoiceVatPercent(0, 0, 15), 15, "fallback to config when no tax");
  eq(invoiceVatPercent(5000, 0, 15), 15, "zero tax → uses fallback (15% default)");
}

// Editing recalculation: change quantity and verify totals update
{
  const items = [{ quantity: 10, unitPrice: 100, taxRate: 15, discount: 0 }];
  const t1 = computeInvoiceTotals(items);
  eq(t1.grandTotal, 1150, "before edit: 10×100 = 1000 + 15% = 1150");
  const t2 = computeInvoiceTotals([{ ...items[0], quantity: 5 }]);
  eq(t2.grandTotal, 575, "after edit: 5×100 = 500 + 15% = 575");
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(50)}`);
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(50)}\n`);
if (failed > 0) process.exit(1);
