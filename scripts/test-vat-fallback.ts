/**
 * D-Arrow Business — VAT Dropdown Fallback & Tax Config Tests
 *
 * Validates the effectiveTaxes / effectiveDefaultTax logic extracted from
 * CreateInvoicePage, ensuring the form always has consistent tax options.
 *
 * Run: npx tsx scripts/test-vat-fallback.ts
 */

import { getDefaultTax, getActiveTaxes } from "../src/features/billing/utils/tax-utils";
import { computeInvoiceTotals, invoiceVatPercent } from "../src/features/billing/utils/invoice-line-utils";
import { DEFAULT_TAXES } from "../src/features/billing/data/product-defaults";
import type { TaxSettings } from "../src/features/billing/schemas/settings";

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
/* Helpers — replicate the effectiveTaxes logic from the component             */
/* -------------------------------------------------------------------------- */

/** Mirrors the component's effectiveTaxes derivation:
 *  tenantTaxes loaded → use them; timeout → DEFAULT_TAXES; loading → []. */
function computeEffectiveTaxes(
  tenantTaxes: TaxSettings[],
  settingsTimedOut: boolean,
): TaxSettings[] {
  return tenantTaxes.length > 0 ? tenantTaxes : (settingsTimedOut ? DEFAULT_TAXES : []);
}

/* -------------------------------------------------------------------------- */
/* Test 1: Tenant settings loaded with VAT 15%                                 */
/* -------------------------------------------------------------------------- */

const tenantVat15: TaxSettings[] = [
  { id: "t_vat15", name: "tax_vat_15", rate: 15, isDefault: true, isActive: true },
  { id: "t_zero", name: "tax_zero", rate: 0, isDefault: false, isActive: true },
];

{
  const effective = computeEffectiveTaxes(tenantVat15, false);
  eq(effective.length, 2, "Test 1: Loaded tenant has 2 tax options");
  const def = getDefaultTax(effective);
  eq(def?.id, "t_vat15", "Test 1: Default is VAT 15%");
  eq(def?.rate, 15, "Test 1: Default rate is 15");
}

/* -------------------------------------------------------------------------- */
/* Test 2: Tenant settings loaded with a custom tax configuration              */
/* -------------------------------------------------------------------------- */

const tenantCustom: TaxSettings[] = [
  { id: "t_custom5", name: "tax_custom_5", rate: 5, isDefault: true, isActive: true },
  { id: "t_exempt", name: "tax_exempt", rate: 0, isDefault: false, isActive: true },
  { id: "t_high", name: "tax_high", rate: 25, isDefault: false, isActive: false },
];

{
  const effective = computeEffectiveTaxes(tenantCustom, false);
  eq(effective.length, 3, "Test 2: Custom tenant taxes preserved");
  const def = getDefaultTax(effective);
  eq(def?.rate, 5, "Test 2: Custom default rate is 5%");
  // Inactive tax should not appear in dropdown (getActiveTaxes)
  const active = getActiveTaxes(effective);
  eq(active.length, 2, "Test 2: Inactive tax excluded from active list");
}

/* -------------------------------------------------------------------------- */
/* Test 3: Settings loading timeout                                            */
/* -------------------------------------------------------------------------- */

{
  const effective = computeEffectiveTaxes([], true);
  eq(effective.length, DEFAULT_TAXES.length, "Test 3: Timeout uses DEFAULT_TAXES");
  eq(effective[0]?.rate, 15, "Test 3: Timeout default rate is 15%");
  const def = getDefaultTax(effective);
  eq(def?.id, "tax_vat_15", "Test 3: Default tax ID is tax_vat_15");
}

/* -------------------------------------------------------------------------- */
/* Test 4: Settings request failure                                            */
/* -------------------------------------------------------------------------- */

{
  // When there's a hard error but the component treats it same as timeout
  const effective = computeEffectiveTaxes([], true);
  ok(effective.length > 0, "Test 4: Failed settings still yields non-empty fallback");
  const def = getDefaultTax(effective);
  ok(def != null && def.rate === 15, "Test 4: Fallback default is 15%");
}

/* -------------------------------------------------------------------------- */
/* Test 5: Dropdown fallback contains VAT 15% and zero-tax                     */
/* -------------------------------------------------------------------------- */

{
  const effective = computeEffectiveTaxes([], true);
  const vat15 = effective.find((t) => t.rate === 15);
  const zero = effective.find((t) => t.rate === 0);
  ok(!!vat15, "Test 5: VAT 15% present in fallback");
  ok(!!zero, "Test 5: Zero-tax present in fallback");
  eq(vat15?.id, "tax_vat_15", "Test 5: VAT 15% has correct ID");
  eq(zero?.id, "tax_zero", "Test 5: Zero-tax has correct ID");
}

/* -------------------------------------------------------------------------- */
/* Test 6: Selected tax option matches the calculated VAT                      */
/* -------------------------------------------------------------------------- */

{
  const effective = computeEffectiveTaxes(tenantVat15, false);
  const def = getDefaultTax(effective)!;
  // Simulate a single line: 30 SAR @ def rate
  const items = [
    { description: "S", quantity: 1, unitPrice: 30, discount: 0, taxRate: def.rate, taxRateId: def.id, productId: null, total: 0 },
  ];
  const { totalTax } = computeInvoiceTotals(items as any);
  eq(totalTax, 4.5, "Test 6: Line tax amount matches selected rate");
  const rate = invoiceVatPercent(30, totalTax, def.rate);
  eq(rate, 15, "Test 6: Derived rate matches selected tax option");
}

/* -------------------------------------------------------------------------- */
/* Test 7: 30 SAR before tax → 4.50 SAR VAT → 34.50 SAR total                 */
/* -------------------------------------------------------------------------- */

{
  const items = [
    { description: "Widget", quantity: 1, unitPrice: 30, discount: 0, taxRate: 15, taxRateId: "tax_vat_15", productId: null, total: 0 },
  ];
  const { subTotal, totalTax, grandTotal } = computeInvoiceTotals(items as any);
  eq(subTotal, 30, "Test 7: Subtotal is 30");
  eq(totalTax, 4.5, "Test 7: VAT is 4.50");
  eq(grandTotal, 34.5, "Test 7: Grand total is 34.50");
}

/* -------------------------------------------------------------------------- */
/* Test 8: No 0% flash during initial loading                                  */
/* -------------------------------------------------------------------------- */

{
  // While loading: effectiveTaxes is empty, no default available
  const effective = computeEffectiveTaxes([], false);
  eq(effective.length, 0, "Test 8: No taxes during loading (form gated)");
  const def = getDefaultTax(effective);
  eq(def, undefined, "Test 8: No default tax during loading — form shows spinner");
  // This means the useEffect returns early (no setValue), so no 0% appears
}

/* -------------------------------------------------------------------------- */
/* Test 9: No invalid tax ID in the submitted invoice                          */
/* -------------------------------------------------------------------------- */

{
  const effective = computeEffectiveTaxes([], true);
  const def = getDefaultTax(effective)!;
  // Simulate what the form sets: taxRateId from effectiveDefaultTax
  const submittedTaxId = def.id;
  const foundInList = effective.find((t) => t.id === submittedTaxId);
  ok(!!foundInList, "Test 9: Submitted tax ID exists in effective options");
  eq(foundInList?.rate, 15, "Test 9: Rate matches for submitted tax ID");

  // Verify with tenant-loaded scenario: ID from tenant settings
  const tenantDef = getDefaultTax(tenantVat15)!;
  const tenantFound = tenantVat15.find((t) => t.id === tenantDef.id);
  ok(!!tenantFound, "Test 9: Tenant default ID always in tenant's list");
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

console.log("\n" + "=".repeat(50));
console.log(` Summary: ${passed} passed, ${failed} failed`);
console.log("=".repeat(50));
process.exit(failed > 0 ? 1 : 0);
