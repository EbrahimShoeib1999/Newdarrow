import type { InvoiceItem } from "../schemas/invoice";

/** Minor currency unit: 1 SAR = 100 halalas */
export function toHalalas(amount: unknown): number {
  return Math.round((Number(amount) || 0) * 100);
}

export function fromHalalas(halalas: number): number {
  return halalas / 100;
}

export function roundMoney(amount: unknown): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

export interface ComputedInvoiceLine {
  gross: number;
  discount: number;
  beforeTax: number;
  vat: number;
  total: number;
  grossHalalas: number;
  discountHalalas: number;
  beforeTaxHalalas: number;
  vatHalalas: number;
  totalHalalas: number;
}

/**
 * Computes exact financial minor units (halalas) for a single line item,
 * eliminating JavaScript floating-point drift and rounding discrepancies.
 */
export function computeInvoiceLineValues(item: {
  quantity: unknown;
  unitPrice: unknown;
  taxRate?: unknown;
  discount?: unknown;
}): ComputedInvoiceLine {
  const q = Number(item.quantity) || 0;
  const r = Number(item.unitPrice) || 0;
  const d = Math.max(0, Number(item.discount) || 0);
  const tx = Math.max(0, Number(item.taxRate) || 0);

  // Exact halala integer calculation
  const grossHalalas = Math.max(0, Math.round(q * r * 100));
  const discountHalalas = Math.min(grossHalalas, Math.round(d * 100));
  const beforeTaxHalalas = Math.max(0, grossHalalas - discountHalalas);
  const vatHalalas = Math.max(0, Math.round((beforeTaxHalalas * tx) / 100));
  const totalHalalas = beforeTaxHalalas + vatHalalas;

  return {
    gross: fromHalalas(grossHalalas),
    discount: fromHalalas(discountHalalas),
    beforeTax: fromHalalas(beforeTaxHalalas),
    vat: fromHalalas(vatHalalas),
    total: fromHalalas(totalHalalas),
    grossHalalas,
    discountHalalas,
    beforeTaxHalalas,
    vatHalalas,
    totalHalalas,
  };
}

export function invoiceLineBeforeTax(item: Pick<InvoiceItem, "quantity" | "unitPrice" | "discount">): number {
  return computeInvoiceLineValues(item).beforeTax;
}

export function invoiceLineVat(item: Pick<InvoiceItem, "quantity" | "unitPrice" | "discount" | "taxRate">): number {
  return computeInvoiceLineValues(item).vat;
}

export function invoiceLineTotal(item: Pick<InvoiceItem, "quantity" | "unitPrice" | "discount" | "taxRate">): number {
  return computeInvoiceLineValues(item).total;
}

/**
 * Canonical invoice totals computation. ALL pages, print/PDF views, detail
 * views, and the accounting integration derive their numbers from HERE —
 * formulas are never duplicated in a UI component.
 */
export interface InvoiceTotals {
  subTotal: number;
  totalDiscount: number;
  totalTax: number;
  grandTotal: number;
}

export function computeInvoiceTotals(
  items: Array<{ quantity: unknown; unitPrice: unknown; taxRate: unknown; discount?: unknown }>,
  invoiceDiscount: unknown = 0
): InvoiceTotals {
  let subTotalHalalas = 0;
  let lineDiscountHalalas = 0;
  let taxHalalas = 0;

  for (const item of items) {
    const line = computeInvoiceLineValues(item);
    subTotalHalalas += line.grossHalalas;
    lineDiscountHalalas += line.discountHalalas;
    taxHalalas += line.vatHalalas;
  }

  const rawInvDiscount = Math.max(0, toHalalas(invoiceDiscount));
  const maxAllowableInvDiscount = Math.max(0, subTotalHalalas - lineDiscountHalalas);
  const appliedInvDiscountHalalas = Math.min(maxAllowableInvDiscount, rawInvDiscount);
  const totalDiscountHalalas = lineDiscountHalalas + appliedInvDiscountHalalas;

  const grandTotalHalalas = subTotalHalalas - totalDiscountHalalas + taxHalalas;

  return {
    subTotal: fromHalalas(subTotalHalalas),
    totalDiscount: fromHalalas(totalDiscountHalalas),
    totalTax: fromHalalas(taxHalalas),
    grandTotal: fromHalalas(grandTotalHalalas),
  };
}

/**
 * Derives the effective VAT percentage from actual stored amounts.
 * - When both subTotal and totalTax are positive: rate = tax / subtotal × 100.
 * - Otherwise: falls back to the provided config fallback (e.g. the company's
 *   primary tax rate from billing settings) — NOT a hardcoded constant.
 */
export function invoiceVatPercent(
  subTotal: number,
  totalTax: number,
  fallback: number = 0
): number {
  if (subTotal <= 0 || totalTax <= 0) return fallback;
  return Math.round((totalTax / subTotal) * 100);
}
