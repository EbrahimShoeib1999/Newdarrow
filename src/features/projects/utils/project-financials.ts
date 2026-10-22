import type { Project } from "../types/projects.types";
import type { Invoice } from "@/features/billing/schemas/invoice";
import type { Bill } from "@/features/billing/schemas/bill";
import type { CreditNote } from "@/features/billing/schemas/credit-note";
import type { SavedContract } from "@/features/crm/types/contract.types";

/**
 * Project financial summary — DERIVED ONLY. Nothing here is stored on the
 * project document; every figure is computed from the authoritative billing
 * records (invoices, bills, credit notes) and the linked contract.
 *
 * Definitions (documented per mission requirement):
 * - contractedValue: the linked contract's own tax-EXCLUSIVE value
 *   (`amountExclVat` field). This is a commercial commitment — it is NOT
 *   recognized revenue.
 * - invoicedAmount: Σ grandTotal (VAT-inclusive) of invoices attached to the
 *   project whose status is issued (any status except `draft` and `cancelled`)
 *   and which are not reversed. Drafts are not bills to the customer; a
 *   cancelled/reversed invoice is excluded entirely (the reversal journal is
 *   the authoritative correction, we do not double-count it here).
 * - collectedAmount: Σ amountPaid maintained by the payment transactions on
 *   those invoices. Collections are cash, NOT revenue.
 * - creditNotesAmount: Σ grandTotal of posted credit notes against the
 *   project's invoices (reduces receivables).
 * - outstandingReceivables: invoicedAmount − collectedAmount − creditNotesAmount.
 *   Never re-derived from payment rows independently — invoice.amountPaid is
 *   the single source maintained transactionally with each payment.
 * - expensesActual: RECORDED costs — Σ grandTotal of non-draft, non-cancelled,
 *   non-rejected bills attached to the project (VAT-inclusive;
 *   `expensesNetOfTax` also exposed). Recording is not approval: this tier
 *   includes bills the accountant has not reviewed yet.
 * - costsApproved: APPROVED ACTUAL costs — only bills an authorized accountant
 *   marked approvalStatus === "approved". Accounting policy basis for margin.
 *   Legacy bills without a review field stay unapproved — never inferred.
 * - costsPendingReview / costsRejected: the unreviewed and rejected slices of
 *   recorded costs, kept visible so closure reviews are complete.
 * - paidCosts: settled amounts (Σ bill.amountPaid) across counted bills —
 *   payment is a cash fact independent of review; a paid-but-rejected bill
 *   stays visible in billRows for an authorized adjustment/refund, never
 *   silently merged into cost totals.
 * - unpaidObligations: Σ (bill.grandTotal − bill.amountPaid) over recorded
 *   bills. Unpaid invoices are payable cash, NOT an expense recognition.
 * - budgetVariance: project.budget − expensesActual (positive = under budget).
 * - forecastCost: expensesActual + unpaidObligations (committed + incurred).
 * - estimatedMargin: contractedValue − forecastCost — an OPERATIONAL estimate.
 * - actualMargin: (invoicedAmount − creditNotesAmount) − expensesActual
 *   (recorded basis). approvedActualMargin uses costsApproved instead.
 *   All margins are operational margins, NOT authoritative accounting profit:
 *   accrual journals, allocations, and inter-company effects live in the
 *   General Ledger, which stays the sole source for profit.
 *
 * Taxes/discounts: invoice and bill grandTotals are post-discount, post-tax
 * totals as persisted on the documents — we never recompute line math here.
 * Currency: records in a currency other than the project currency are
 * EXCLUDED from totals and counted in `foreignCurrencyExcluded` rather than
 * silently converted (no FX rate source exists in-app yet).
 */

export interface ProjectFinancials {
  currency: string;
  contractedValue: number;
  /** Contract VAT amount (base × rate) — shown, never merged into invoices. */
  contractVat: number;
  contractGrandTotal: number;
  invoicedAmount: number;
  invoicedNetOfTax: number;
  collectedAmount: number;
  creditNotesAmount: number;
  outstandingReceivables: number;
  overdueReceivables: number;
  overdueInvoiceCount: number;
  expensesActual: number;
  expensesNetOfTax: number;
  paidExpenses: number;
  unpaidObligations: number;
  /** APPROVED ACTUAL costs — accountant-reviewed bills only (policy basis). */
  costsApproved: number;
  /** RECORDED-but-unreviewed slice of costsActual (includes legacy no-review). */
  costsPendingReview: number;
  /** Bills rejected by the accountant (excluded from every cost total). */
  costsRejected: number;
  rejectedBillCount: number;
  pendingReviewCount: number;
  /** Settled cash over counted bills — same value as paidExpenses, explicit name. */
  paidCosts: number;
  /** Margin on the approved-actual basis — the headline profitability figure. */
  approvedActualMargin: number;
  budget: number | null;
  budgetVariance: number | null;
  forecastCost: number;
  estimatedMargin: number | null;
  actualMargin: number;
  cashIn: number;
  cashOut: number;
  invoiceCount: number;
  billCount: number;
  foreignCurrencyExcluded: number;
  /** Invoices due on/after today, past-due flagged — payment schedule view. */
  schedule: Array<{
    invoiceId: string;
    invoiceNumber: string;
    dueDate: string | null;
    grandTotal: number;
    amountPaid: number;
    open: number;
    overdue: boolean;
  }>;
  /** Bill drill-down — the review queue reads its rows from here. */
  billRows: Array<{
    billId: string;
    billNumber: string;
    vendorName: string;
    dueDate: string | null;
    grandTotal: number;
    amountPaid: number;
    open: number;
    overdue: boolean;
    /** Undefined = never reviewed (legacy or fresh entry). */
    approvalStatus?: "pending" | "approved" | "rejected";
    approvedBy?: string | null;
    reviewNote?: string;
  }>;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Contract tax-exclusive value from its own recorded field — never an invoice guess. */
export function contractValueOf(c: SavedContract | undefined | null): {
  base: number;
  vatRate: number;
  vat: number;
  grand: number;
} {
  if (!c) return { base: 0, vatRate: 0, vat: 0, grand: 0 };
  const field = (k: string) => c.form?.fields?.find((f) => f.key === k)?.value ?? "";
  const base = parseFloat(field("amountExclVat")) || 0;
  const rawRate = parseFloat(field("vatRate"));
  const vatRate = Number.isFinite(rawRate) && rawRate >= 0 && rawRate <= 100 ? rawRate : 0;
  const vat = round2((base * vatRate) / 100);
  return { base, vatRate, vat, grand: round2(base + vat) };
}

/** Invoices count as "attached" when they carry the project id or the project's contract id. */
export function invoiceAttachedToProject(inv: Invoice, project: Project): boolean {
  if (inv.projectId && inv.projectId === project.id) return true;
  if (project.contractId && inv.contractId === project.contractId) return true;
  return false;
}

function billAttachedToProject(bill: Bill, project: Project): boolean {
  return !!bill.projectId && bill.projectId === project.id;
}

function isIssuedInvoice(inv: Invoice): boolean {
  if (inv.status === "draft" || inv.status === "cancelled") return false;
  // A reversed invoice no longer represents a receivable.
  if (inv.reversedAt) return false;
  return true;
}

function isPostedCreditNote(cn: CreditNote): boolean {
  return cn.status === "posted";
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function computeProjectFinancials(params: {
  project: Project;
  contracts: SavedContract[];
  invoices: Invoice[];
  bills: Bill[];
  creditNotes: CreditNote[];
  /** ISO string used as "today" — injectable for deterministic tests. */
  now?: string;
}): ProjectFinancials {
  const { project, contracts, invoices, bills, creditNotes } = params;
  const now = params.now ? new Date(params.now) : new Date();
  const currency = project.currency || invoices[0]?.currency || "SAR";

  const contract = contracts.find((c) => c.id === project.contractId);
  const cv = contractValueOf(contract);

  const projInvoices = invoices.filter(
    (inv) => invoiceAttachedToProject(inv, project) && isIssuedInvoice(inv)
  );
  const projInvoiceIds = new Set(projInvoices.map((i) => i.id).filter((x): x is string => !!x));

  let invoiced = 0;
  let invoicedNet = 0;
  let collected = 0;
  let overdue = 0;
  let overdueCount = 0;
  let cashIn = 0;
  let foreign = 0;
  const schedule: ProjectFinancials["schedule"] = [];

  for (const inv of projInvoices) {
    const cur = inv.currency || "SAR";
    const paid = inv.amountPaid ?? 0;
    const dueDate = toDate(inv.dueDate);
    const isOverdue =
      !!dueDate && dueDate < now && inv.status !== "paid" && (inv.grandTotal - paid) > 0.005;
    if (cur !== currency) {
      foreign += 1;
      continue;
    }
    invoiced += inv.grandTotal;
    invoicedNet += inv.subTotal;
    collected += paid;
    cashIn += paid;
    if (isOverdue) {
      overdue += inv.grandTotal - paid;
      overdueCount += 1;
    }
    schedule.push({
      invoiceId: inv.id ?? "",
      invoiceNumber: inv.invoiceNumber,
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null,
      grandTotal: inv.grandTotal,
      amountPaid: paid,
      open: round2(inv.grandTotal - paid),
      overdue: isOverdue,
    });
  }

  const credits = creditNotes
    .filter(
      (cn) =>
        cn.type === "credit_note" &&
        isPostedCreditNote(cn) &&
        ((cn.invoiceId && projInvoiceIds.has(cn.invoiceId)) ||
          (cn.projectId && cn.projectId === project.id))
    )
    .filter((cn) => (cn.currency || "SAR") === currency);
  const creditSum = credits.reduce((s, cn) => s + cn.grandTotal, 0);

  const projBillsAll = bills.filter(
    (b) => billAttachedToProject(b, project) && b.status !== "draft" && b.status !== "cancelled"
  );
  // Rejected obligations are excluded from every cost total — they remain
  // visible through billRows so nothing silently disappears from the review.
  const projBills = projBillsAll.filter((b) => b.approvalStatus !== "rejected");
  let expenses = 0;
  let expensesNet = 0;
  let paidExp = 0;
  let cashOut = 0;
  let unpaid = 0;
  let approved = 0;
  let pendingReview = 0;
  let pendingCount = 0;
  let rejectedSum = 0;
  let rejectedCount = 0;
  const billRows: ProjectFinancials["billRows"] = [];
  for (const b of projBillsAll) {
    const isForeign = (b.currency || "SAR") !== currency;
    const paid = b.amountPaid ?? 0;
    const dueDate = toDate(b.dueDate);
    const isOverdue =
      !!dueDate && dueDate < now && b.status !== "paid" && (b.grandTotal - paid) > 0.005;
    billRows.push({
      billId: b.id ?? "",
      billNumber: b.billNumber,
      vendorName: b.vendorName || b.vendorId || "—",
      dueDate: b.dueDate ? new Date(b.dueDate).toISOString().slice(0, 10) : null,
      grandTotal: b.grandTotal,
      amountPaid: paid,
      open: round2(b.grandTotal - paid),
      overdue: isOverdue,
      approvalStatus: b.approvalStatus,
      approvedBy: b.approvedBy,
      reviewNote: b.reviewNote,
    });
    if (b.approvalStatus === "rejected") {
      if (!isForeign) {
        rejectedSum += b.grandTotal;
        rejectedCount += 1;
      }
      continue;
    }
    if (isForeign) {
      foreign += 1;
      continue;
    }
    expenses += b.grandTotal;
    expensesNet += b.subTotal;
    paidExp += paid;
    cashOut += paid;
    unpaid += b.grandTotal - paid;
    if (b.approvalStatus === "approved") {
      approved += b.grandTotal;
    } else {
      // Unset (legacy/fresh) counts as recorded-but-unreviewed.
      pendingReview += b.grandTotal;
      pendingCount += 1;
    }
  }
  billRows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const budget = typeof project.budget === "number" ? project.budget : null;

  return {
    currency,
    contractedValue: cv.base,
    contractVat: cv.vat,
    contractGrandTotal: cv.grand,
    invoicedAmount: round2(invoiced),
    invoicedNetOfTax: round2(invoicedNet),
    collectedAmount: round2(collected),
    creditNotesAmount: round2(creditSum),
    outstandingReceivables: round2(invoiced - collected - creditSum),
    overdueReceivables: round2(overdue),
    overdueInvoiceCount: overdueCount,
    expensesActual: round2(expenses),
    expensesNetOfTax: round2(expensesNet),
    paidExpenses: round2(paidExp),
    unpaidObligations: round2(unpaid),
    costsApproved: round2(approved),
    costsPendingReview: round2(pendingReview),
    costsRejected: round2(rejectedSum),
    rejectedBillCount: rejectedCount,
    pendingReviewCount: pendingCount,
    paidCosts: round2(paidExp),
    approvedActualMargin: round2(invoiced - creditSum - approved),
    budget,
    budgetVariance: budget === null ? null : round2(budget - expenses),
    forecastCost: round2(expenses + unpaid),
    estimatedMargin: budget === null && cv.base === 0 ? null : round2(cv.base - (expenses + unpaid)),
    actualMargin: round2(invoiced - creditSum - expenses),
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    // Counted figures cover only what is actually summed into the totals: same
    // currency, issued, non-reversed — drafts/foreign never appear in the UI lists.
    invoiceCount: schedule.length,
    billCount: projBills.filter((b) => (b.currency || "SAR") === currency).length,
    foreignCurrencyExcluded: foreign,
    schedule: schedule.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    billRows,
  };
}
