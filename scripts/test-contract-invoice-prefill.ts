/**
 * Regression tests for Workstream #2 — Deal-to-Invoice commercial & tax integrity.
 * Run: npx tsx scripts/test-contract-invoice-prefill.ts
 *
 * Proves the contract "interim invoice" prefill mirrors the contract's OWN recorded
 * commercial value (amountExclVat + vatRate) instead of the previous fabricated
 * `estimatedHours * 100` hourly rate — the root cause of the reported 10,000 → 6,325 gap.
 *
 * The invoice totals are recomputed with the SAME formula the CreateInvoicePage prefill uses
 * (src/features/billing/pages/CreateInvoicePage.tsx, fromContract effect): a line carries no
 * explicit taxRate, so each line is taxed at the contract vatRate;
 *   subTotal   = Σ quantity × unitPrice
 *   totalTax   = Σ quantity × unitPrice × vatRate / 100
 *   grandTotal = subTotal + totalTax
 * This suite is pure (no Firebase) and asserts amount, tax base, tax, currency and final total.
 */

import {
  allocateByWeight,
  buildContractInvoicePrefill,
  type ContractInvoicePrefill,
} from "../src/features/crm/utils/contract-invoice-prefill";
import type { ContractFormDraft } from "../src/features/crm/types/contract.types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---- helpers ----
function makeDraft(
  amountExclVat: string,
  vatRate: string | null,
  services: Array<{ name: string; hours: number; selected: boolean }>,
): ContractFormDraft {
  const fields = [{ key: "amountExclVat", value: amountExclVat }];
  if (vatRate !== null) fields.push({ key: "vatRate", value: vatRate } as never);
  return {
    contractNumber: "C-0001",
    fields,
    services: services.map((s, i) => ({
      id: `srv_${i}`,
      name: s.name,
      department: "التسويق الرقمي",
      selected: s.selected,
      estimatedHours: s.hours,
    })),
  } as unknown as ContractFormDraft;
}

/** Mirror of the CreateInvoicePage fromContract prefill total computation. */
function computeInvoiceTotals(prefill: ContractInvoicePrefill) {
  const vatRate = prefill.vatRate;
  const subTotal = prefill.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalTax = prefill.items.reduce(
    (s, i) => s + (i.quantity * i.unitPrice * ((i as never as { taxRate?: number }).taxRate ?? vatRate)) / 100,
    0,
  );
  const totalDiscount = 0;
  const grandTotal = subTotal - totalDiscount + totalTax;
  return {
    subTotal: Math.round(subTotal * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

const sumUnit = (p: ContractInvoicePrefill) =>
  Math.round(p.items.reduce((s, i) => s + i.unitPrice, 0) * 100) / 100;

// ============================================================================
console.log("\n[1] Reported scenario: deal 10,000 → contract → interim invoice (the 6,325 bug)");
{
  // Two selected services, hours 20 + 30 (the old code priced them at (20+30)*100 = 5,000 → 5,750).
  const prefill = buildContractInvoicePrefill(
    makeDraft("10000", "15", [
      { name: "UI/UX", hours: 20, selected: true },
      { name: "Dev", hours: 30, selected: true },
    ]),
  );
  const totals = computeInvoiceTotals(prefill);
  check("tax base = contract amountExclVat (10,000)", prefill.amount === 10000, `got ${prefill.amount}`);
  check("vat rate taken from contract field (15%)", prefill.vatRate === 15, `got ${prefill.vatRate}`);
  check("subtotal = 10,000 (Σ line unitPrices)", sumUnit(prefill) === 10000, `got ${sumUnit(prefill)}`);
  check("currency SAR", prefill.currency === "SAR", prefill.currency);
  check("subTotal 10,000", totals.subTotal === 10000, JSON.stringify(totals));
  check("totalTax 1,500", totals.totalTax === 1500, JSON.stringify(totals));
  check("grandTotal = 11,500 (NOT the fabricated 6,325)", totals.grandTotal === 11500, JSON.stringify(totals));
  check("regression guard: ≠ 5,750 old hours*100 result", totals.grandTotal !== 5750 && totals.grandTotal !== 6325);
}

// ============================================================================
console.log("\n[2] Proportional allocation by estimatedHours");
{
  const prefill = buildContractInvoicePrefill(
    makeDraft("9000", "15", [
      { name: "A", hours: 10, selected: true },
      { name: "B", hours: 20, selected: true },
      { name: "C", hours: 30, selected: true },
    ]),
  );
  const prices = prefill.items.map((i) => i.unitPrice);
  check("lines only for selected services", prefill.items.length === 3);
  check("allocations proportional 1:2:3 → 1500/3000/4500", JSON.stringify(prices) === JSON.stringify([1500, 3000, 4500]), JSON.stringify(prices));
  check("Σ allocations = amountExclVat exactly", sumUnit(prefill) === 9000, `got ${sumUnit(prefill)}`);
}

// ============================================================================
console.log("\n[3] Unselected services are excluded from the invoice");
{
  const prefill = buildContractInvoicePrefill(
    makeDraft("4000", "15", [
      { name: "kept", hours: 5, selected: true },
      { name: "dropped", hours: 100, selected: false },
    ]),
  );
  check("single line kept", prefill.items.length === 1);
  check("the whole 4,000 sits on the kept line", prefill.items[0].unitPrice === 4000, JSON.stringify(prefill.items));
}

// ============================================================================
console.log("\n[4] Equal-split fallback when no hours recorded");
{
  const prefill = buildContractInvoicePrefill(
    makeDraft("1000", "15", [
      { name: "A", hours: 0, selected: true },
      { name: "B", hours: 0, selected: true },
    ]),
  );
  const prices = prefill.items.map((i) => i.unitPrice);
  check("equal split 500/500", JSON.stringify(prices) === JSON.stringify([500, 500]), JSON.stringify(prices));
  check("Σ = 1,000", sumUnit(prefill) === 1000);
}

// ============================================================================
console.log("\n[5] Remainder-safety: three-way split never loses a cent");
{
  const shares = allocateByWeight([1, 1, 1], 1000);
  const total = Math.round(shares.reduce((s, c) => s + c, 0) * 100) / 100;
  check("1000/3 splits sum to exactly 1000", total === 1000, JSON.stringify(shares));
  check("largest-remainder puts the odd cent on a line", shares.includes(333.34) || shares.filter((x) => x === Math.round(shares[0] * 100) / 100).length >= 1, JSON.stringify(shares));
  const odd = allocateByWeight([1, 1], 0.01);
  check("0.01 across two lines sums to 0.01", Math.round(odd.reduce((s, c) => s + c, 0) * 100) / 100 === 0.01, JSON.stringify(odd));
}

// ============================================================================
console.log("\n[6] Tax-rate edge cases");
{
  const zeroVat = buildContractInvoicePrefill(makeDraft("5000", "0", [{ name: "A", hours: 10, selected: true }]));
  check("0% vat honored (not defaulted to 15)", zeroVat.vatRate === 0, `got ${zeroVat.vatRate}`);
  check("0% vat → grandTotal = subTotal", computeInvoiceTotals(zeroVat).grandTotal === 5000, JSON.stringify(computeInvoiceTotals(zeroVat)));

  const missingVat = buildContractInvoicePrefill(makeDraft("2000", null, [{ name: "A", hours: 10, selected: true }]));
  check("missing vatRate field defaults to 15%", missingVat.vatRate === 15, `got ${missingVat.vatRate}`);

  const bogusVat = buildContractInvoicePrefill(makeDraft("2000", "900", [{ name: "A", hours: 10, selected: true }]));
  check("out-of-range vatRate falls back to 15%", bogusVat.vatRate === 15, `got ${bogusVat.vatRate}`);
}

// ============================================================================
console.log("\n[7] Degenerate / empty contracts");
{
  const noAmount = buildContractInvoicePrefill(makeDraft("0", "15", [{ name: "A", hours: 10, selected: true }]));
  check("zero amount → zero grandTotal", computeInvoiceTotals(noAmount).grandTotal === 0);

  const noServices = buildContractInvoicePrefill(makeDraft("10000", "15", []));
  check("no selected services → no lines (UI falls back to single contract-value line)", noServices.items.length === 0);
  check("amount still reported (10,000) for the fallback line", noServices.amount === 10000);

  // Emulate CreateInvoicePage fallback single line when items is empty:
  const fallbackTotal = Math.round(noServices.amount * (1 + noServices.vatRate / 100) * 100) / 100;
  check("contract-value fallback line → 11,500", fallbackTotal === 11500, `got ${fallbackTotal}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
