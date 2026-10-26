/**
 * Facilities UI helpers — pure color maps and id→name resolution.
 *
 * Colors are keyed by the stable machine ids (never by translated labels),
 * so a status chip reads the same in Arabic and English tenants.
 */

import type {
  AssetCondition,
  AssetLifecycle,
  FacilityStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from "../types/facilities.types";
import type { ScheduleDueState } from "./work-order-rules";

export type ChipColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export const WO_STATUS_COLORS: Record<WorkOrderStatus, ChipColor> = {
  requested: "default",
  assigned: "secondary",
  in_progress: "primary",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
};

export const PRIORITY_COLORS: Record<WorkOrderPriority, ChipColor> = {
  low: "default",
  medium: "secondary",
  high: "warning",
  urgent: "danger",
};

export const FACILITY_STATUS_COLORS: Record<FacilityStatus, ChipColor> = {
  operational: "success",
  under_maintenance: "warning",
  closed: "default",
};

export const ASSET_CONDITION_COLORS: Record<AssetCondition, ChipColor> = {
  good: "success",
  fair: "secondary",
  poor: "warning",
  out_of_service: "danger",
};

export const ASSET_LIFECYCLE_COLORS: Record<AssetLifecycle, ChipColor> = {
  active: "success",
  retired: "default",
};

export const DUE_STATE_COLORS: Record<ScheduleDueState, ChipColor> = {
  overdue: "danger",
  due_today: "warning",
  due_soon: "secondary",
  ok: "success",
};

/** Resolve a linked record's display name; null ref → null, missing ref → caller shows "removed". */
export function nameOf<T extends { id: string; name?: string; title?: string }>(
  list: readonly T[] | undefined,
  id?: string | null,
): string | null {
  if (!id) return null;
  const hit = list?.find((x) => x.id === id);
  if (!hit) return null;
  return hit.name ?? hit.title ?? null;
}
