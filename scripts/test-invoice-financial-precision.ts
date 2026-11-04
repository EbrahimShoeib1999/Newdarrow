/**
 * D-Arrow Business — Financial Precision & Minor Units (Halala) Test Suite
 *
 * Verifies:
 * 1. Decimal unit prices with multiple quantities avoid floating-point drift.
 * 2. Item-level discounts are rounded in integer halalas.
 * 3. Line total matches: beforeTax + vat down to the exact halala.
 * 4. Invoice subtotal, total discount, total tax, and grand total have 0 halala discrepancy.
 * 5. Invoice-level discounts allocate accurately without exceeding subtotal.
 * 6. Partial payments compute exact amount due with no 0.000000000000001 residue.
 * 7. Paid status detection (syncInvoiceStatuses) triggers reliably.
 */

import {
  toHalalas,
  fromHalalas,
  roundMoney,
  computeInvoiceLineValues,
  computeInvoiceTotals,
  invoiceLineBeforeTax,
  invoiceLineVat,
  invoiceLineTotal,
} from "../src/features/billing/utils/invoice-line-utils";

import { getInvoiceAmountDue, syncInvoiceStatuses } from "../src/features/billing/utils/accounting-engine";
import type { Invoice } from "../src/features/billing/schemas/invoice";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow — Financial Precision (Halalas) Test Suite");
console.log("=======================================================\n");

// 1. Minor Units Conversions
{
  assert(toHalalas(10.33) === 1033, "10.33 SAR is exactly 1033 halalas");
  assert(toHalalas(0.1 + 0.2) === 30, "0.1 + 0.2 floating point sum converted cleanly to 30 halalas");
  assert(fromHalalas(1033) === 10.33, "1033 halalas converts back to 10.33 SAR");
  assert(roundMoney(12.3456) === 12.35, "Half-up rounding on 12.3456 -> 12.35");
}

// 2. Line Item Calculations with Decimals & Discounts
{
  const item1 = {
    quantity: 3,
    unitPrice: 10.33,
    discount: 1.50,
    taxRate: 15,
  };
  const line1 = computeInvoiceLineValues(item1);
  assert(line1.gross === 30.99, `Gross is 30.99 SAR (got ${line1.gross})`);
  assert(line1.discount === 1.50, `Discount is 1.50 SAR (got ${line1.discount})`);
  assert(line1.beforeTax === 29.49, `Before tax is 29.49 SAR (got ${line1.beforeTax})`);
  assert(line1.vat === 4.42, `VAT 15% on 29.49 is exactly 4.42 SAR (got ${line1.vat})`);
  assert(line1.total === 33.91, `Line total is exactly 33.91 SAR (got ${line1.total})`);
  assert(
    Math.round((line1.beforeTax + line1.vat) * 100) === Math.round(line1.total * 100),
    "Line beforeTax + VAT exactly equals line total to the halala"
  );
  assert(invoiceLineBeforeTax(item1 as any) === 29.49, "invoiceLineBeforeTax matches");
  assert(invoiceLineVat(item1 as any) === 4.42, "invoiceLineVat matches");
  assert(invoiceLineTotal(item1 as any) === 33.91, "invoiceLineTotal matches");
}

// 3. Multi-line Invoices: Zero discrepancy between line totals and grand total
{
  const items = [
    { quantity: 7, unitPrice: 33.33, discount: 5.00, taxRate: 15 },
    { quantity: 12, unitPrice: 14.99, discount: 0, taxRate: 15 },
    { quantity: 1, unitPrice: 100.55, discount: 10.55, taxRate: 0 }, // 0% VAT
  ];

  const totals = computeInvoiceTotals(items);

  const lines = items.map(computeInvoiceLineValues);
  const sumOfLineTotals = lines.reduce((acc, l) => acc + l.totalHalalas, 0) / 100;
  const sumOfLineVat = lines.reduce((acc, l) => acc + l.vatHalalas, 0) / 100;
  const sumOfLineBeforeTax = lines.reduce((acc, l) => acc + l.beforeTaxHalalas, 0) / 100;
  const sumOfLineGross = lines.reduce((acc, l) => acc + l.grossHalalas, 0) / 100;
  const sumOfLineDiscount = lines.reduce((acc, l) => acc + l.discountHalalas, 0) / 100;

  assert(totals.subTotal === sumOfLineGross, `Subtotal ${totals.subTotal} equals sum of line gross ${sumOfLineGross}`);
  assert(totals.totalDiscount === sumOfLineDiscount, `Total discount ${totals.totalDiscount} equals line discounts`);
  assert(totals.totalTax === sumOfLineVat, `Total tax ${totals.totalTax} equals sum of line VATs`);
  assert(totals.grandTotal === sumOfLineTotals, `Grand total ${totals.grandTotal} EXACTLY equals sum of line totals ${sumOfLineTotals}`);

  // Re-verify canonical equation
  const expectedGrand = Math.round((totals.subTotal - totals.totalDiscount + totals.totalTax) * 100) / 100;
  assert(totals.grandTotal === expectedGrand, "Canonical equation subTotal - discount + tax == grandTotal strictly holds");
}

// 4. Invoice-level Discount Allocation
{
  const items = [
    { quantity: 2, unitPrice: 50.00, discount: 0, taxRate: 15 }, // 100 SAR gross, 15 SAR vat
  ];
  const invoiceDiscount = 20.00; // 20 SAR invoice discount
  const totals = computeInvoiceTotals(items, invoiceDiscount);

  assert(totals.subTotal === 100.00, "Subtotal is 100.00 SAR");
  assert(totals.totalDiscount === 20.00, "Total discount reflects invoice discount of 20.00 SAR");
  assert(totals.grandTotal === 95.00, `Grand total is 100 - 20 + 15 = 95.00 SAR (got ${totals.grandTotal})`);
}

// 5. Amount Due & Floating Residue Elimination
{
  const mockInvoice: Partial<Invoice> = {
    grandTotal: 115.35,
    amountPaid: 115.35,
  };
  const due = getInvoiceAmountDue(mockInvoice as Invoice);
  assert(due === 0, `Fully paid invoice has exactly 0 amount due (got ${due})`);

  const partialInvoice: Partial<Invoice> = {
    grandTotal: 300.10,
    amountPaid: 200.00,
  };
  const partialDue = getInvoiceAmountDue(partialInvoice as Invoice);
  assert(partialDue === 100.10, `Partial due on 300.10 - 200.00 is exactly 100.10 SAR (got ${partialDue})`);

  // Status sync with floating numbers
  const syncResult = syncInvoiceStatuses([
    {
      id: "inv-1",
      invoiceNumber: "INV-001",
      status: "sent",
      dueDate: new Date(Date.now() - 86400000), // overdue date
      grandTotal: 300.10,
      amountPaid: 300.10,
      issueDate: new Date(),
      items: [],
      subTotal: 300.10,
      totalTax: 0,
      totalDiscount: 0,
    } as any,
  ]);
  assert(syncResult[0].status === "paid", "Fully paid invoice with decimal halalas transitions status to 'paid'");
}

console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);

