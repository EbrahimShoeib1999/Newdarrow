export type ProjectStatus =
  | "planning"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled"
  | "archived";

export type ProjectPriority = "low" | "medium" | "high" | "urgent";

/** Machine keys of the built-in activity presets (see constants/activity-presets). */
export type ProjectActivityType =
  | "software"
  | "marketing"
  | "consulting"
  | "construction"
  | "general";

export type ProjectDeliveryStage =
  | "not_started"
  | "pending_review"
  | "changes_requested"
  | "accepted"
  | "support";

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  value: string;
}

/** Auditable status transition retained on the project document itself. */
export interface ProjectStatusChange {
  from: ProjectStatus;
  to: ProjectStatus;
  /** ISO string of the actual transition time. */
  at: string;
  /** User id of the actor who performed the transition. */
  by: string;
  /** Reason captured on hold / cancel / delay transitions. */
  note?: string;
}

export interface ProjectDelivery {
  stage: ProjectDeliveryStage;
  requirements?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  acceptedAt?: string | null;
  acceptedBy?: string | null;
  /** Post-delivery support end date (if any). */
  supportUntil?: string | null;
  notes?: string;
}

export interface Project {
  id: string;
  name: string;
  slug?: string;
  /** Human-readable stable code, e.g. PRJ-0001 (sequence lives in settings/projects). */
  code?: string;
  description: string;
  status: ProjectStatus;
  priority?: ProjectPriority;
  category?: string;
  /** Activity preset key — drives default milestones, not the storage shape. */
  activityType?: ProjectActivityType | (string & {}) | null;
  tags?: string[];
  customFields?: Record<string, string>;
  members: string[]; // array of user IDs
  /** Accountable owner (single) — distinct from the working team. */
  ownerId?: string | null;
  createdBy: string;
  startDate: string | null;
  endDate: string | null;
  /** Actual dates are recorded by transitions, never inferred from a manual percentage. */
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  /** Canonical customer (CRM contact id). Never duplicated as free text. */
  contactId?: string | null;
  /** Commercial chain references — authoritative records stay the source of amounts. */
  dealId?: string | null;
  contractId?: string | null;
  /** Budget (planned cost). Financial actuals are always derived from billing records. */
  budget?: number | null;
  currency?: string;
  pauseReason?: string;
  cancellationReason?: string;
  delayReason?: string;
  blockers?: string[];
  risks?: string[];
  delivery?: ProjectDelivery;
  statusHistory?: ProjectStatusChange[];
  /**
   * Idempotency key for conversions, e.g. "contract:{contractId}".
   * A retry of the same conversion finds this project instead of creating a duplicate.
   */
  conversionKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  status: "planned" | "completed" | "cancelled";
  completedAt?: string | null;
  sequenceOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateProjectDTO = Omit<
  Project,
  "id" | "code" | "createdAt" | "updatedAt" | "statusHistory"
>;
export type UpdateProjectDTO = Partial<CreateProjectDTO>;
