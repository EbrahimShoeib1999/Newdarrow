import type { ContractFormDraft } from "../types/contract.types";

/**
 * Commercial prefill for the contract "interim invoice" (فاتورة مرحلية) flow.
 *
 * Business rule: an invoice raised from a contract must reflect the contract's OWN recorded
 * commercial value — `amountExclVat` as the tax base and `vatRate` (percent) as the tax rate —
 * never a fabricated hourly rate. Lines are the selected services, with `amountExclVat`
 * allocated proportionally to `estimatedHours` (equal-split fallback when no hours are set),
 * remainder-safe in integer cents so the subtotal equals the contract value EXACTLY and the
 * resulting grand total equals `amountExclVat × (1 + vatRate/100)` — the same figure the
 * contract itself prints as `amountInclVat`.
 */

/** Percent — matches the contract template field "نسبة الضريبة %" (e.g. "15"). */
const DEFAULT_VAT_RATE_PERCENT = 15;

export interface ContractInvoiceLine {
  description: string;
  quantity: number;
  /** Per-line share of the contract's tax-exclusive value (excl VAT). */
  unitPrice: number;
}

export interface ContractInvoicePrefill {
  /** Contract tax-exclusive value — the invoice's authoritative tax base. */
  amount: number;
  /** Percent, taken from the contract's own `vatRate` field. */
  vatRate: number;
  currency: string;
  title: string;
  items: ContractInvoiceLine[];
}

function contractFieldValue(form: ContractFormDraft, key: string): string {
  return form.fields.find((f) => f.key === key)?.value ?? "";
}

/**
 * Allocate `total` across `weights` proportionally, remainder-safe in integer cents so the
 * returned shares always sum to exactly `total` (no 0.01 drift). A zero/negative total weight
 * falls back to an equal split.
 */
export function allocateByWeight(weights: number[], total: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalCents = Math.round(total * 100);
  if (totalCents === 0) return new Array(n).fill(0);
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sumW = safe.reduce((s, w) => s + w, 0);
  const cents: number[] = [];
  if (sumW <= 0) {
    const base = Math.floor(totalCents / n);
    for (let i = 0; i < n; i++) cents.push(base);
  } else {
    const exact = safe.map((w) => (totalCents * w) / sumW);
    for (const e of exact) cents.push(Math.floor(e));
    // Distribute the remainder to the lines with the largest fractional loss.
    const remainder = totalCents - cents.reduce((s, c) => s + c, 0);
    const order = exact
      .map((e, i) => ({ i, frac: e - Math.floor(e) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < order.length && k < remainder; k++) cents[order[k].i] += 1;
  }
  // Last-resort exactness guard (e.g. negative totals): pin the residual to the final line.
  const drift = totalCents - cents.reduce((s, c) => s + c, 0);
  cents[n - 1] += drift;
  return cents.map((c) => c / 100);
}

/**
 * Build the `fromContract` invoice prefill from the live contract form.
 * The returned amounts are exactly reproducible from persisted contract fields
 * (`amountExclVat`, `vatRate`, selected services + `estimatedHours`).
 */
export function buildContractInvoicePrefill(
  form: ContractFormDraft,
): ContractInvoicePrefill {
  const amount = parseFloat(contractFieldValue(form, "amountExclVat")) || 0;
  const rawRate = parseFloat(contractFieldValue(form, "vatRate"));
  const vatRate =
    Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100
      ? rawRate
      : DEFAULT_VAT_RATE_PERCENT;
  const selected = (form.services || []).filter((s) => s.selected);
  const title = `دفعة تعاقدية - عقد #${form.contractNumber}`;
  if (selected.length === 0) {
    return { amount, vatRate, currency: "SAR", title, items: [] };
  }
  const shares = allocateByWeight(
    selected.map((s) => s.estimatedHours || 0),
    amount,
  );
  const items: ContractInvoiceLine[] = selected.map((s, i) => ({
    description: s.name,
    quantity: 1,
    unitPrice: shares[i],
  }));
  return { amount, vatRate, currency: "SAR", title, items };
}
