/**
 * Marketing Agency — deliverable & content workflow rules (pure).
 *
 * Deliverables walk an internal review machine (assignment → production →
 * review → revision loop → approval) and may additionally require a client
 * sign-off before publication. Content items have their own publication
 * machine where a scheduled date is a hard precondition for scheduling —
 * "published" is only ever asserted for work that went live.
 */

import type {
  ClientApprovalState,
  ContentItem,
  ContentStatus,
  Deliverable,
  DeliverableStatus,
} from "../types/marketing.types";
import { todayIso, type FieldErrors } from "./campaign-rules";

/* -------------------------------------------------------------------------- */
/* Deliverable status machine                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Allowed edges. Terminals: published and cancelled. in_review → published is
 * intentionally NOT an edge: approval must be its own recorded step, and
 * publication is a separate action on top of an approved deliverable (also
 * gated by the client sign-off state below).
 */
const DELIVERABLE_TRANSITIONS: Record<DeliverableStatus, readonly DeliverableStatus[]> = {
  not_started: ["in_progress", "cancelled"],
  in_progress: ["in_review", "cancelled"],
  in_review: ["revision_requested", "approved", "cancelled"],
  revision_requested: ["in_progress", "cancelled"],
  approved: ["published", "revision_requested", "cancelled"],
  published: [],
  cancelled: [],
};

export function canTransitionDeliverable(
  from: DeliverableStatus,
  to: DeliverableStatus
): boolean {
  return DELIVERABLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextDeliverableStatuses(
  from: DeliverableStatus
): readonly DeliverableStatus[] {
  return DELIVERABLE_TRANSITIONS[from] ?? [];
}

export function isTerminalDeliverableStatus(status: DeliverableStatus): boolean {
  return DELIVERABLE_TRANSITIONS[status]?.length === 0;
}

/**
 * Publication gate: internal approval alone is not enough when the client
 * signed up to approve the piece — their decision must be on record.
 */
export function canPublishDeliverable(
  d: Pick<Deliverable, "status" | "requiresClientApproval" | "clientApprovalState">
): boolean {
  if (d.status !== "approved") return false;
  if (!d.requiresClientApproval) return true;
  return d.clientApprovalState === "approved";
}

/** Which client-approval transitions are legal for the internal status. */
export function canSetClientApproval(
  deliverableStatus: DeliverableStatus,
  from: ClientApprovalState,
  to: ClientApprovalState
): boolean {
  // Sign-off only makes sense once the piece is out of the producer's hands.
  const reviewable = deliverableStatus === "in_review" || deliverableStatus === "approved";
  if (!reviewable) return false;
  if (from === "pending") return to === "approved" || to === "rejected";
  if (from === "rejected") return to === "pending";
  if (from === "not_required") return to === "pending";
  return to === "pending";
}

/* -------------------------------------------------------------------------- */
/* Content item publication machine                                           */
/* -------------------------------------------------------------------------- */

const CONTENT_TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["scheduled", "draft", "cancelled"],
  scheduled: ["published", "approved", "cancelled"],
  published: [],
  cancelled: [],
};

export function canTransitionContent(
  from: ContentStatus,
  to: ContentStatus
): boolean {
  return CONTENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextContentStatuses(from: ContentStatus): readonly ContentStatus[] {
  return CONTENT_TRANSITIONS[from] ?? [];
}

export function isTerminalContentStatus(status: ContentStatus): boolean {
  return CONTENT_TRANSITIONS[status]?.length === 0;
}

/** Scheduling and publishing both require a concrete date on record. */
export function canScheduleContent(
  c: Pick<ContentItem, "status" | "scheduledDate">
): boolean {
  return c.status === "approved" && Boolean(c.scheduledDate);
}

/* -------------------------------------------------------------------------- */
/* Validators                                                                 */
/* -------------------------------------------------------------------------- */

export function validateDeliverableDraft(draft: {
  campaignId?: string | null;
  title?: string | null;
  dueDate?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.campaignId) errors.campaignId = "deliverable.campaignRequired";
  if (!draft.title || draft.title.trim().length < 3) errors.title = "deliverable.titleRequired";
  if (draft.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) {
    errors.dueDate = "deliverable.dueDateInvalid";
  }
  return errors;
}

export function validateContentDraft(draft: {
  campaignId?: string | null;
  title?: string | null;
  channel?: string | null;
  scheduledDate?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.campaignId) errors.campaignId = "content.campaignRequired";
  if (!draft.title || draft.title.trim().length < 3) errors.title = "content.titleRequired";
  if (!draft.channel) errors.channel = "content.channelRequired";
  if (draft.scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledDate)) {
    errors.scheduledDate = "content.dateInvalid";
  }
  return errors;
}

export function validateBriefDraft(draft: {
  campaignId?: string | null;
  title?: string | null;
  body?: string | null;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.campaignId) errors.campaignId = "brief.campaignRequired";
  if (!draft.title || draft.title.trim().length < 3) errors.title = "brief.titleRequired";
  if (!draft.body || draft.body.trim().length < 10) errors.body = "brief.bodyRequired";
  return errors;
}

/** Deliverables whose due date passed — used by dashboards and reports. */
export function overdueDeliverables(
  deliverables: readonly Deliverable[],
  today = todayIso()
): Deliverable[] {
  return deliverables.filter((d) => {
    if (!d.dueDate) return false;
    if (["approved", "published", "cancelled"].includes(d.status)) return false;
    return d.dueDate < today;
  });
}
