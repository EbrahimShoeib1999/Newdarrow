import type { InvoiceItem } from "../schemas/invoice";

export function invoiceLineBeforeTax(item: InvoiceItem): number {
  return Math.max(0, item.quantity * item.unitPrice - (item.discount || 0));
}

export function invoiceLineVat(item: InvoiceItem): number {
  return invoiceLineBeforeTax(item) * (item.taxRate / 100);
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
  items: Array<{ quantity: unknown; unitPrice: unknown; taxRate: unknown; discount?: unknown }>
): InvoiceTotals {
  let subTotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;
  for (const item of items) {
    const q = Number(item.quantity) || 0;
    const r = Number(item.unitPrice) || 0;
    const d = Math.max(0, Number(item.discount) || 0);
    const tx = Number(item.taxRate) || 0;
    const gross = Math.max(0, q * r);
    const beforeTax = Math.max(0, gross - d);
    subTotal += gross;
    totalDiscount += d;
    totalTax += beforeTax * (tx / 100);
  }
  // 2-dp money rounding, consistent with the rest of the system.
  subTotal = Math.round(subTotal * 100) / 100;
  totalDiscount = Math.round(totalDiscount * 100) / 100;
  totalTax = Math.round(totalTax * 100) / 100;
  const grandTotal = Math.round((subTotal - totalDiscount + totalTax) * 100) / 100;
  return { subTotal, totalDiscount, totalTax, grandTotal };
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
