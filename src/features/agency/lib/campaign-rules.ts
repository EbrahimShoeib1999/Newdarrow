/**
 * Marketing Agency — pure workflow logic (no Firebase, no React).
 *
 * The service layer re-validates every rule in this file at write time and the
 * UI derives its buttons from it, so an illegal transition can never be
 * produced by a stale view — the same three-layer pattern the facilities
 * module uses. Money is normalized on write and totals are always DERIVED
 * (never stored), so spend/budget figures can never disagree with their parts.
 */

import type {
  BudgetRevision,
  BudgetVsActual,
  Campaign,
  CampaignExpense,
  CampaignStatus,
  DeliverySummary,
  Deliverable,
  DeliverableStatus,
  InvoiceRevenueLike,
} from "../types/marketing.types";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** Round to 2 decimals — the repo-wide money convention. */
export function normalizeMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* Campaign status machine                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Allowed edges. A campaign must be approved before it runs and cannot be
 * completed from draft/approved — "delivery happened" is only assertable for
 * work that actually started. Terminals: completed, cancelled.
 */
const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["active", "draft", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionCampaign(
  from: CampaignStatus,
  to: CampaignStatus
): boolean {
  return CAMPAIGN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextCampaignStatuses(from: CampaignStatus): readonly CampaignStatus[] {
  return CAMPAIGN_TRANSITIONS[from] ?? [];
}

export function isTerminalCampaignStatus(status: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[status]?.length === 0;
}

/** Activating a campaign with no approved budget would fake a spend cap. */
export function canActivateCampaign(campaign: Pick<Campaign, "budgetAmount">): boolean {
  return normalizeMoney(campaign.budgetAmount) > 0;
}

/* -------------------------------------------------------------------------- */
/* Budget revisions — the only way the approved budget changes               */
/* -------------------------------------------------------------------------- */

export function canProposeRevision(
  status: CampaignStatus
): boolean {
  // Draft campaigns can still edit their initial budget directly; once the
  // campaign is approved/running every change needs an auditable revision.
  return status === "approved" || status === "active" || status === "paused";
}

export function canDecideRevision(revision: BudgetRevision): boolean {
  return revision.state === "pending";
}

/** Pending revisions block a second proposal — one open decision at a time. */
export function hasPendingRevision(revisions: readonly BudgetRevision[]): boolean {
  return revisions.some((r) => r.state === "pending");
}

/** Approving a revision yields the new campaign budget (derived, not stored twice). */
export function applyRevisionApproval(
  campaign: Pick<Campaign, "budgetAmount" | "budgetRevisions">,
  revisionId: string
): { budgetAmount: number; revisions: BudgetRevision[] } | null {
  const target = campaign.budgetRevisions.find((r) => r.id === revisionId);
  if (!target || target.state !== "pending") return null;
  const revisions = campaign.budgetRevisions.map((r) =>
    r.id === revisionId
      ? { ...r, state: "approved" as const, decidedAt: new Date().toISOString() }
      : r
  );
  return { budgetAmount: normalizeMoney(target.newAmount), revisions };
}

export function rejectRevision(
  campaign: Pick<Campaign, "budgetRevisions">,
  revisionId: string
): BudgetRevision[] | null {
  const target = campaign.budgetRevisions.find((r) => r.id === revisionId);
  if (!target || target.state !== "pending") return null;
  return campaign.budgetRevisions.map((r) =>
    r.id === revisionId
      ? { ...r, state: "rejected" as const, decidedAt: new Date().toISOString() }
      : r
  );
}

/* -------------------------------------------------------------------------- */
/* Validators (used by both forms and the service)                            */
/* -------------------------------------------------------------------------- */

export interface FieldErrors {
  [field: string]: string;
}

export function validateCampaignDraft(draft: {
  name?: string | null;
  clientId?: string | null;
  channels?: readonly string[] | null;
  budgetAmount?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name || draft.name.trim().length < 3) errors.name = "campaign.nameRequired";
  if (!draft.clientId) errors.clientId = "campaign.clientRequired";
  if (!draft.channels || draft.channels.length === 0) errors.channels = "campaign.channelsRequired";
  const budget = Number(draft.budgetAmount);
  if (!Number.isFinite(budget) || budget < 0) errors.budgetAmount = "campaign.budgetRequired";
  if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
    errors.endDate = "campaign.endDateBeforeStart";
  }
  if (!draft.currency) errors.currency = "campaign.currencyRequired";
  return errors;
}

export function validateRevisionDraft(draft: {
  newAmount?: number | null;
  reason?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  const amount = Number(draft.newAmount);
  if (!Number.isFinite(amount) || amount <= 0) errors.newAmount = "campaign.revisionAmountInvalid";
  if (!draft.reason || draft.reason.trim().length < 3) errors.reason = "campaign.revisionReasonRequired";
  return errors;
}

export function validateExpenseDraft(draft: {
  campaignId?: string | null;
  title?: string | null;
  amount?: number | null;
  spentAt?: string | null;
  currency?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.campaignId) errors.campaignId = "expense.campaignRequired";
  if (!draft.title || draft.title.trim().length < 2) errors.title = "expense.titleRequired";
  if (!Number.isFinite(Number(draft.amount)) || Number(draft.amount) <= 0) {
    errors.amount = "expense.amountRequired";
  }
  if (!draft.spentAt) errors.spentAt = "expense.dateRequired";
  if (!draft.currency) errors.currency = "expense.currencyRequired";
  return errors;
}

/* -------------------------------------------------------------------------- */
/* Derived reports — computed only from persisted records                     */
/* -------------------------------------------------------------------------- */

export function totalSpent(expenses: readonly CampaignExpense[], campaignId: string): number {
  return normalizeMoney(
    expenses.filter((e) => e.campaignId === campaignId).reduce((sum, e) => sum + Number(e.amount || 0), 0)
  );
}

/**
 * Budget vs actual for one campaign. Revenue comes ONLY from shared billing
 * invoices that reference the campaign id — unpaid/draft invoices count into
 * `invoiced` via grandTotal, collections via amountPaid; nothing is copied.
 */
export function computeBudgetVsActual(
  campaign: Pick<Campaign, "id" | "code" | "name" | "budgetAmount" | "currency">,
  expenses: readonly CampaignExpense[],
  invoices: readonly InvoiceRevenueLike[]
): BudgetVsActual {
  const budget = normalizeMoney(campaign.budgetAmount);
  const spent = totalSpent(expenses, campaign.id);
  const linked = invoices.filter((i) => i.campaignId === campaign.id && i.status !== "cancelled");
  const invoiced = normalizeMoney(linked.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
  const collected = normalizeMoney(linked.reduce((s, i) => s + Number(i.amountPaid || 0), 0));
  return {
    campaignId: campaign.id,
    code: campaign.code,
    name: campaign.name,
    budget,
    spent,
    // Negative when over budget — the sign is meaningful, so no clamp here.
    remaining: Math.round((budget - spent) * 100) / 100,
    utilization: budget > 0 ? Math.round((spent / budget) * 10000) / 10000 : 0,
    invoiced,
    collected,
    overBudget: spent > budget,
  };
}

const DELIVERABLE_DONE_STATUSES: readonly DeliverableStatus[] = ["approved", "published"];

export function isDeliverableOverdue(d: Pick<Deliverable, "status" | "dueDate">, today = todayIso()): boolean {
  if (!d.dueDate) return false;
  if (DELIVERABLE_DONE_STATUSES.includes(d.status) || d.status === "cancelled") return false;
  return d.dueDate < today;
}

/** Delivery report: pipeline counts + on-time vs late completion, derived only. */
export function computeDeliverySummary(deliverables: readonly Deliverable[]): DeliverySummary {
  const byStatus: Record<DeliverableStatus, number> = {
    not_started: 0,
    in_progress: 0,
    in_review: 0,
    revision_requested: 0,
    approved: 0,
    published: 0,
    cancelled: 0,
  };
  let overdue = 0;
  let completedOnTime = 0;
  let completedLate = 0;
  for (const d of deliverables) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    if (isDeliverableOverdue(d)) overdue++;
    if (DELIVERABLE_DONE_STATUSES.includes(d.status) && d.dueDate) {
      // Completion stamp = last transition into the done status; fall back to
      // updatedAt when history is empty (legacy rows).
      const doneAt =
        [...d.statusHistory]
          .reverse()
          .find((h) => DELIVERABLE_DONE_STATUSES.includes(h.to))?.at ?? d.updatedAt;
      const doneDay = String(doneAt || "").slice(0, 10);
      if (doneDay && doneDay <= d.dueDate) completedOnTime++;
      else completedLate++;
    }
  }
  return { total: deliverables.length, byStatus, overdue, completedOnTime, completedLate };
}

/** Client-facing campaign state for display filters (never stored). */
export function isCampaignRunning(status: CampaignStatus): boolean {
  return status === "active" || status === "paused";
}
