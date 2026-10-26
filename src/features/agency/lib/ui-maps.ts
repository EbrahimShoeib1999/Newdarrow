/**
 * Marketing Agency UI helpers — pure color maps keyed by the stable machine
 * ids (never by translated labels), so chips read the same in Arabic and
 * English tenants. Mirrors the facilities ui-maps convention.
 */

import type {
  BudgetRevisionState,
  CampaignStatus,
  ClientApprovalState,
  ContentStatus,
  DeliverableStatus,
} from "../types/marketing.types";

export type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, ChipColor> = {
  draft: "default",
  approved: "secondary",
  active: "primary",
  paused: "warning",
  completed: "success",
  cancelled: "danger",
};

export const DELIVERABLE_STATUS_COLORS: Record<DeliverableStatus, ChipColor> = {
  not_started: "default",
  in_progress: "primary",
  in_review: "warning",
  revision_requested: "secondary",
  approved: "success",
  published: "success",
  cancelled: "danger",
};

export const CLIENT_APPROVAL_COLORS: Record<ClientApprovalState, ChipColor> = {
  not_required: "default",
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

export const CONTENT_STATUS_COLORS: Record<ContentStatus, ChipColor> = {
  draft: "default",
  approved: "secondary",
  scheduled: "warning",
  published: "success",
  cancelled: "danger",
};

export const REVISION_STATE_COLORS: Record<BudgetRevisionState, ChipColor> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};
