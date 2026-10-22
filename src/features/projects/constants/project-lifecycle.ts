import type { ProjectStatus } from "../types/projects.types";

/**
 * Validated lifecycle transitions. Operational status is kept separate from
 * financial status — completing a project never touches invoice/payment records,
 * and money never flips the operational state on its own.
 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
  "archived",
];

export const PROJECT_STATUS_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ["active", "cancelled", "archived"],
  active: ["on_hold", "completed", "cancelled", "archived"],
  on_hold: ["active", "completed", "cancelled", "archived"],
  completed: ["active", "archived"],
  cancelled: ["active", "archived"],
  archived: ["active"],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return (PROJECT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/** Transitions that must carry an explicit reason (auditable). */
export const PROJECT_TRANSITION_REASONS: Partial<
  Record<ProjectStatus, { requiredFor: ProjectStatus[]; reasonField: string }>
> = {
  on_hold: { requiredFor: ["active"], reasonField: "pauseReason" },
  cancelled: { requiredFor: ["planning", "active", "on_hold"], reasonField: "cancellationReason" },
};

/**
 * Returns the reason field that must be filled when moving `from` → `to`,
 * or null when no reason is required.
 */
export function requiredReasonField(
  from: ProjectStatus,
  to: ProjectStatus
): "pauseReason" | "cancellationReason" | null {
  if (to === "on_hold" && from === "active") return "pauseReason";
  if (to === "cancelled" && from !== "archived") return "cancellationReason";
  return null;
}
