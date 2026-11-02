/**
 * Work schedules, monthly lateness and the deduction policy — domain types.
 *
 * Extends (never replaces) the existing people attendance model:
 * `companies/{id}/attendance` rows stay exactly as they are; the fields added
 * here are SNAPSHOTS of the schedule that was in effect at check-in, so a
 * later template edit can never rewrite the meaning of a historical punch.
 *
 * Collections (all company-scoped):
 *   hr_schedule_templates   — Office/Online/Custom defaults, versioned.
 *   hr_schedule_assignments — employee/group assignments with effective dates.
 *   hr_lateness_policies    — versioned threshold/deduction policy configs.
 *   hr_deduction_cases      — deterministic per employee+period+threshold
 *                             review/proposal/posting workflow records.
 * The `hr_` prefix is deliberately NOT one of the reserved activity prefixes
 * (rem_/reb_/fm_/rdv_/mkt_/cln_/sch_) so these cross-cutting HR collections
 * are never captured by the activity-domain gate in firestore.rules.
 */

export type WorkMode = "office" | "online" | "custom";

/** One entry in a template's own change history (who/when/why). */
export interface TemplateChangeEntry {
  at: string;
  by: string;
  reason: string;
  summary: string;
}

/**
 * The schedule values an assignment freezes at assignment time. Adding a
 * field here (never removing) is how the snapshot stays backward compatible.
 */
export interface ScheduleValues {
  /** "HH:mm" 24h in the schedule's timezone. */
  startTime: string;
  endTime: string;
  /** JS getDay() convention: 0=Sunday … 5=Friday, 6=Saturday. */
  workingDays: number[];
  breakMinutes: number;
  /** When true the break is paid working time (does not reduce required hours). */
  breakCountsAsWork: boolean;
  /** Minutes after the start time before lateness begins accumulating. */
  graceMinutes: number;
  /** Required productive minutes per day; null derives from duration-break. */
  requiredDailyMinutes: number | null;
  /** Optional flexible start window ("HH:mm" pair) inside which starts are on time. */
  flexibleStartWindow: [string, string] | null;
  /** IANA zone the start/end times are interpreted in. */
  timezone: string;
  /** Overtime, if the deployment enables it. */
  overtime: { enabled: boolean; afterWorkMinutes: number } | null;
}

export interface ScheduleTemplate extends ScheduleValues {
  id: string;
  name: string;
  description?: string | null;
  mode: WorkMode;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  isActive: boolean;
  /** Bumped on every edit; assignments pin the version they snapshotted. */
  version: number;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  changeLog: TemplateChangeEntry[];
}

export type CreateScheduleTemplateDTO = Omit<
  ScheduleTemplate,
  "id" | "version" | "createdAt" | "updatedAt" | "changeLog"
>;

/**
 * Configurable defaults — the Office/Online presets below are the PRODUCT
 * defaults seeded into templates, not constants sprayed through the app.
 * Everything past the seed lives in editable template rows.
 */
export const OFFICE_SCHEDULE_DEFAULTS: ScheduleValues = {
  startTime: "13:00",
  endTime: "20:00",
  workingDays: [0, 1, 2, 3, 4], // Sun–Thu (KSA weekend Fri/Sat excluded)
  breakMinutes: 0,
  breakCountsAsWork: true,
  graceMinutes: 0,
  requiredDailyMinutes: null, // derived: 7h
  flexibleStartWindow: null,
  timezone: "Asia/Riyadh",
  overtime: null,
};

export const ONLINE_SCHEDULE_DEFAULTS: ScheduleValues = {
  startTime: "11:00",
  endTime: "19:00",
  workingDays: [0, 1, 2, 3, 4],
  breakMinutes: 0,
  breakCountsAsWork: true,
  graceMinutes: 0,
  requiredDailyMinutes: null, // derived: 8h
  flexibleStartWindow: null,
  timezone: "Asia/Riyadh",
  overtime: null,
};

export const SCHEDULE_PRESETS: Record<
  Exclude<WorkMode, "custom">,
  { name: string; values: ScheduleValues }
> = {
  office: { name: "Office (13:00–20:00)", values: OFFICE_SCHEDULE_DEFAULTS },
  online: { name: "Online / Freelancer (11:00–19:00)", values: ONLINE_SCHEDULE_DEFAULTS },
};

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

export interface AssignmentAuditEntry {
  at: string;
  by: string;
  action: "created" | "updated" | "deactivated";
  reason: string;
}

export interface ScheduleAssignment {
  id: string;
  scope: "employee" | "group";
  /** Set when scope === "employee". */
  employeeId?: string | null;
  /** Department name matched against Employee.department when scope === "group". */
  department?: string | null;
  templateId: string;
  templateVersion: number;
  /** Work mode of the template at assignment time — used for policy scoping. */
  templateMode?: WorkMode | null;
  /**
   * Frozen copy of the template — lateness math reads THIS, so editing a
   * template never rewrites existing assignments or historical punches.
   */
  snapshot: ScheduleValues;
  /**
   * Employee/group-specific deviations applied OVER the snapshot (per-employee
   * override without touching the shared template).
   */
  overrides: Partial<ScheduleValues> | null;
  /** Inclusive ISO dates. */
  effectiveFrom: string;
  effectiveTo?: string | null;
  reason?: string | null;
  status: "active" | "deactivated";
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  audit: AssignmentAuditEntry[];
}

export type CreateScheduleAssignmentDTO = Omit<
  ScheduleAssignment,
  "id" | "createdAt" | "updatedAt" | "audit" | "status"
> & { status?: ScheduleAssignment["status"] };

/* -------------------------------------------------------------------------- */
/* Monthly lateness & deduction policy                                          */
/* -------------------------------------------------------------------------- */

/** How the accumulated total behaves once a threshold action fires. */
export type ThresholdMode = "cumulative" | "stepped" | "reset_after_action";

/**
 * How "three days" (or any N days) translates into money. The spec forbids
 * assuming a meaning: the policy must state it explicitly.
 *  - calendar_30   : one day = monthlyGross / 30
 *  - working_days  : one day = monthlyGross / policy.workingDaysPerMonth
 *  - salary_fraction: amount = monthlyGross * fraction (no days involved)
 */
export type DayWageBasis = "calendar_30" | "working_days" | "salary_fraction";

export type ThresholdActionKind = "warning" | "review" | "propose_deduction";

export interface LatenessThreshold {
  /** Stable id within the policy ("t1", "t2", …) — used in case doc ids. */
  id: string;
  /** Countable accumulated lateness that fires this threshold, in MINUTES. */
  afterMinutes: number;
  action: {
    kind: ThresholdActionKind;
    /** Days of wage to propose (when kind === propose_deduction). */
    deductionDays?: number | null;
    basis?: DayWageBasis | null;
    /** basis === salary_fraction only: fraction of monthly gross (0..1). */
    fraction?: number | null;
  };
  /** Manual review first vs automatic proposal once crossed. */
  automatic: boolean;
}

export interface LatenessPolicy {
  id: string;
  name: string;
  description?: string | null;
  /** Empty/undefined lists mean "applies to everything in scope". */
  appliesTo: {
    workModes?: WorkMode[] | null;
    departments?: string[] | null;
  };
  /** Reporting period; only calendar_month is implemented, stored for evolution. */
  period: "calendar_month";
  thresholds: LatenessThreshold[];
  thresholdMode: ThresholdMode;
  /** Denominator when a threshold uses the working_days basis. */
  workingDaysPerMonth: number;
  /**
   * Approved accumulation→day conversion: how many accumulated LATE HOURS
   * equal one deduction day (the approved company rule is 8 ⇒ 24h → 3 days).
   * NULL/absent keeps the historical fixed `deductionDays` behavior — the
   * conversion is never silently applied to a policy that does not state it.
   */
  hoursPerDeductionDay?: number | null;
  /** Hard monthly cap per employee, in currency units (0 = no cap configured). */
  maxMonthlyDeductionAmount: number;
  /** Cap as a fraction of monthly gross (0 = none). Never claims legal validity. */
  maxMonthlyDeductionGrossFraction: number;
  /**
   * Explicit statutory basis text an admin entered (e.g. a reviewed, approved
   * labor-office rule). EMPTY ⇒ the system refuses to post and files a review
   * item instead — configuration is never treated as legal compliance.
   */
  legalBasis: string | null;
  isActive: boolean;
  version: number;
  effectiveFrom: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateLatenessPolicyDTO = Omit<
  LatenessPolicy,
  "id" | "version" | "createdAt" | "updatedAt" | "isActive"
> & { isActive?: boolean };

/* -------------------------------------------------------------------------- */
/* Deduction cases (review / proposal / posting workflow)                       */
/* -------------------------------------------------------------------------- */

export type DeductionCaseStatus =
  | "pending_review"
  | "proposed"
  | "approved"
  | "rejected"
  | "posted"
  | "reversed";

export const DEDUCTION_CASE_TRANSITIONS: Record<DeductionCaseStatus, readonly DeductionCaseStatus[]> = {
  // review items (missing legal basis or manual thresholds) wait for a human.
  pending_review: ["approved", "rejected"],
  proposed: ["approved", "rejected"],
  approved: ["posted", "rejected"],
  rejected: [],
  posted: ["reversed"],
  reversed: [],
};

/** The policy values a case freezes at creation — decisions never mutate. */
export interface CasePolicySnapshot {
  policyName: string;
  policyVersion: number;
  thresholdMinutes: number;
  action: LatenessThreshold["action"];
  thresholdMode: ThresholdMode;
  workingDaysPerMonth: number;
  /** Frozen conversion ratio at case creation (8 = approved 8h → 1 day rule). */
  hoursPerDeductionDay?: number | null;
  legalBasisPresent: boolean;
  currency: string;
}

export interface DeductionCase {
  id: string;
  employeeId: string;
  /** Linked account uid (may be "" for unclaimed employee records). */
  subjectUserId: string;
  periodKey: string; // "YYYY-MM" (from the attendance rows' `date` strings)
  accumulatedMinutes: number;
  contributingAttendanceIds: string[];
  thresholdId: string;
  policyId: string;
  policySnapshot: CasePolicySnapshot;
  kind: ThresholdActionKind;
  status: DeductionCaseStatus;
  /** Monetary impact, ONLY when the action is a deduction. */
  deductionDays: number | null;
  dailyRate: number | null;
  amount: number | null;
  currency: string | null;
  proposedBy: string; // actor id of the evaluation run, or "system"
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
  /** Set by a prior correction/reversal recalculation. */
  recalculatedAt?: string | null;
  journalId?: string | null;
  reversedBy?: string | null;
  reversedAt?: string | null;
  reversalNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Attendance row extensions (snapshots, corrections)                           */
/* -------------------------------------------------------------------------- */

/** Appended by PeopleService.checkIn when a schedule resolved for the date. */
export interface AttendanceScheduleSnapshot {
  /** The assignment doc whose snapshot+overrides produced this evaluation. */
  scheduleAssignmentId: string;
  scheduledStart: string; // "HH:mm" in the schedule timezone
  scheduleTimezone: string;
  graceMinutes: number;
  /** Minutes the first valid check-in was past start+grace (>= 0). */
  rawLateMinutes: number;
  /** Portion excused by approved leave/permission covering the date. */
  excusedLateMinutes: number;
  /** rawLate - excused, after the policy's counting rules. */
  countableLateMinutes: number;
  workMode: WorkMode | null;
}

export interface AttendanceCorrectionEntry {
  at: string;
  by: string;
  reason: string;
  /** Field-level before/after for every value the correction changed. */
  changes: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Attendance rows gain the snapshot fields PLAINLY (all optional, historical
 * rows simply don't carry them — never backfilled silently).
 */
export interface AttendanceExtensionFields {
  /** Author's uid, stamped on new writes so the security boundary can tell
   * "my own attendance" without a second read on legacy rows. */
  userId?: string;
  schedule?: AttendanceScheduleSnapshot | null;
  corrections?: AttendanceCorrectionEntry[];
  /** Excusing note applied by an authorized corrector (leave id optional). */
  excusedNote?: string | null;
}
