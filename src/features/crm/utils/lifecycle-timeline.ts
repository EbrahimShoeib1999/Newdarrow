/**
 * Unified customer lifecycle timeline.
 *
 * Design (honest-by-construction):
 * - Every emitted event is backed by a REAL persisted timestamp on an existing
 *   record or by a recorded Activity document. We never invent a dated event for
 *   a transition the system does not retain (e.g. a deal's intermediate stage
 *   history is only shown when a matching Activity record exists — deals already
 *   log "Deal stage changed" activities via the existing audit architecture).
 * - Relationships are resolved with canonical persisted IDs, never mutable text.
 * - Duplicate events (retries / double listener runs) collapse on a stable key.
 */

import type { Contact } from "../types/contacts.types";
import type { Deal } from "../types/deals.types";
import type { SavedContract } from "../types/contract.types";
import type { Activity } from "../types/activities.types";
import type { Task } from "@/features/tasks/types/task.types";
import type { Invoice } from "@/features/billing/schemas/invoice";
import type { Payment } from "@/features/billing/schemas/payment";
import type { Project } from "@/features/projects/types/projects.types";

export type TimelineCategory =
  | "customer"
  | "deal"
  | "contract"
  | "project"
  | "task"
  | "invoice"
  | "payment"
  | "activity";

export type TimelineEntityType =
  | "contact"
  | "deal"
  | "contract"
  | "project"
  | "task"
  | "invoice"
  | "payment"
  | "activity";

export interface TimelineEvent {
  /** Stable de-duplication key. */
  id: string;
  category: TimelineCategory;
  /** Machine kind, e.g. "created" | "approved" | "stage_changed" | "payment_recorded". */
  kind: string;
  entityType: TimelineEntityType;
  entityId: string;
  /** ISO string of the ACTUAL persisted timestamp. */
  timestamp: string;
  /** ACTUAL persisted actor id when available. */
  actorUserId?: string;
  /** i18n key under crm:timeline.events.* */
  labelKey: string;
  /** Interpolation params for the label. */
  params?: Record<string, string | number>;
  /** Optional in-app navigation route to the underlying record. */
  route?: string;
}

/** Normalize Date | string | Firestore-Timestamp-like to an ISO string, or null. */
export function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      const t = d.getTime();
      return Number.isNaN(t) ? null : d.toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export interface CustomerRecordSet {
  contacts: Contact[];
  deals: Deal[];
  contracts: SavedContract[];
  /** Optional — projects arrive from the Projects module sources. */
  projects?: Project[];
  tasks: Task[];
  invoices: Invoice[];
  payments: Payment[];
  activities: Activity[];
}

export interface ScopedCustomerRecords {
  contact?: Contact;
  deals: Deal[];
  contracts: SavedContract[];
  projects: Project[];
  tasks: Task[];
  invoices: Invoice[];
  /** Only payments whose parent invoice is present in `invoices` (drops orphan/deleted). */
  payments: Payment[];
  /** Contact-tagged + deal-tagged activity records for this customer. */
  activities: Activity[];
}

/**
 * Resolve every record that can be RELIABLY associated with the canonical customer
 * using persisted IDs only. Missing/deleted related records are dropped (a payment
 * whose invoice no longer exists is excluded rather than guessed).
 *
 * Access/tenant filtering is expected to have happened upstream (hooks filter by
 * company + role); this function only performs relationship resolution.
 */
export function scopeCustomerRecords(
  contactId: string,
  set: CustomerRecordSet
): ScopedCustomerRecords {
  const contact = set.contacts.find((c) => c.id === contactId);

  const deals = set.deals.filter((d) => d.contactId === contactId);
  const dealIds = new Set(deals.map((d) => d.id));

  const contracts = set.contracts.filter((c) => c.contactId === contactId);
  const contractIds = new Set(contracts.map((c) => c.id));

  // Tasks link via contact directly, or through a contract / deal of this customer.
  const tasks = set.tasks.filter(
    (t) =>
      t.contactId === contactId ||
      (t.contractId && contractIds.has(t.contractId)) ||
      (t.dealId && dealIds.has(t.dealId))
  );

  // Projects link via the canonical customer or one of this customer's deals/contracts.
  const projects = (set.projects ?? []).filter(
    (p) =>
      p.contactId === contactId ||
      (p.contractId && contractIds.has(p.contractId)) ||
      (p.dealId && dealIds.has(p.dealId))
  );

  const invoices = set.invoices.filter((inv) => inv.customerId === contactId);
  const invoiceIds = new Set(invoices.map((inv) => inv.id).filter((x): x is string => !!x));

  // Payments have no customerId — resolve through their parent invoice. Orphans dropped.
  const payments = set.payments.filter((p) => p.invoiceId && invoiceIds.has(p.invoiceId));

  // Activities are entity-scoped (contact | deal). Include the customer's own + deal events.
  const activities = set.activities.filter(
    (a) =>
      (a.entityType === "contact" && a.entityId === contactId) ||
      (a.entityType === "deal" && dealIds.has(a.entityId))
  );

  return { contact, deals, contracts, projects, tasks, invoices, payments, activities };
}

function eventId(
  category: TimelineCategory,
  entityType: TimelineEntityType,
  entityId: string,
  kind: string,
  timestamp: string
): string {
  return `${category}:${entityType}:${entityId}:${kind}:${timestamp}`;
}

/**
 * Aggregate the real, retained lifecycle events for a single canonical customer.
 * Returns a de-duplicated, chronologically-descending (newest first) list.
 */
export function buildCustomerTimeline(scoped: ScopedCustomerRecords): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, "id">) => {
    if (!e.timestamp) return;
    const id = eventId(e.category, e.entityType, e.entityId, e.kind, e.timestamp);
    // de-duplicate by stable key
    if (events.some((x) => x.id === id)) return;
    events.push({ ...e, id });
  };

  // --- Customer / contact ---
  if (scoped.contact) {
    const created = toIso(scoped.contact.createdAt);
    if (created) {
      push({
        category: "customer",
        kind: "created",
        entityType: "contact",
        entityId: scoped.contact.id,
        timestamp: created,
        actorUserId: scoped.contact.createdBy ?? undefined,
        labelKey: "customer_created",
        route: `/crm/contacts/${scoped.contact.id}`,
      });
    }
  }

  // --- Deals (creation only; stage history arrives via Activity records) ---
  for (const deal of scoped.deals) {
    const created = toIso(deal.createdAt);
    if (created) {
      push({
        category: "deal",
        kind: "created",
        entityType: "deal",
        entityId: deal.id,
        timestamp: created,
        actorUserId: deal.createdBy ?? undefined,
        labelKey: "deal_created",
        params: { title: deal.title },
        route: `/crm/deals/${deal.id}`,
      });
    }
  }

  // --- Contracts ---
  for (const c of scoped.contracts) {
    const created = toIso(c.createdAt);
    if (created) {
      push({
        category: "contract",
        kind: "created",
        entityType: "contract",
        entityId: c.id,
        timestamp: created,
        actorUserId: c.createdBy ?? undefined,
        labelKey: "contract_created",
        params: { title: c.title },
        route: `/crm/contracts?contractId=${c.id}`,
      });
    }
    const approved = toIso(c.approvedAt);
    if (c.approvalStatus === "approved" && approved) {
      push({
        category: "contract",
        kind: "approved",
        entityType: "contract",
        entityId: c.id,
        timestamp: approved,
        actorUserId: c.approvedBy ?? undefined,
        labelKey: "contract_approved",
        params: { title: c.title },
        route: `/crm/contracts?contractId=${c.id}`,
      });
    }
  }

  // --- Projects (execution events; financial amounts stay on their own records) ---
  for (const p of scoped.projects) {
    const created = toIso(p.createdAt);
    if (created) {
      push({
        category: "project",
        kind: "created",
        entityType: "project",
        entityId: p.id,
        timestamp: created,
        actorUserId: p.createdBy ?? undefined,
        labelKey: "project_created",
        params: { title: p.name },
        route: `/projects/${p.id}`,
      });
    }
    // Genuine audited status transitions retained on the project document.
    for (const h of p.statusHistory ?? []) {
      const ts = toIso(h.at);
      if (!ts) continue;
      push({
        category: "project",
        kind: "status_changed",
        entityType: "project",
        entityId: p.id,
        timestamp: ts,
        actorUserId: h.by || undefined,
        labelKey: "project_status_changed",
        params: { from: h.from, to: h.to, title: p.name },
        route: `/projects/${p.id}`,
      });
    }
    const submitted = toIso(p.delivery?.submittedAt);
    if (submitted) {
      push({
        category: "project",
        kind: "delivery_submitted",
        entityType: "project",
        entityId: p.id,
        timestamp: submitted,
        labelKey: "project_delivery_submitted",
        params: { title: p.name },
        route: `/projects/${p.id}`,
      });
    }
    const accepted = toIso(p.delivery?.acceptedAt);
    if (accepted) {
      push({
        category: "project",
        kind: "delivery_accepted",
        entityType: "project",
        entityId: p.id,
        timestamp: accepted,
        actorUserId: p.delivery?.acceptedBy ?? undefined,
        labelKey: "project_delivery_accepted",
        params: { title: p.name },
        route: `/projects/${p.id}`,
      });
    }
  }

  // --- Tasks ---
  for (const t of scoped.tasks) {
    const created = toIso(t.createdAt);
    if (created) {
      push({
        category: "task",
        kind: "created",
        entityType: "task",
        entityId: t.id,
        timestamp: created,
        labelKey: "task_created",
        params: { title: t.title },
        route: `/tasks/${t.id}`,
      });
    }
    const claimed = toIso(t.claimedAt);
    if (claimed) {
      push({
        category: "task",
        kind: "claimed",
        entityType: "task",
        entityId: t.id,
        timestamp: claimed,
        actorUserId: t.claimedBy ?? undefined,
        labelKey: "task_claimed",
        params: { title: t.title },
        route: `/tasks/${t.id}`,
      });
    }
    const completed = toIso(t.completedAt);
    if (completed) {
      push({
        category: "task",
        kind: "completed",
        entityType: "task",
        entityId: t.id,
        timestamp: completed,
        labelKey: "task_completed",
        params: { title: t.title },
        route: `/tasks/${t.id}`,
      });
    }
    // Genuine status transitions retained in the task's own history ledger.
    for (const h of t.history ?? []) {
      if (h.field !== "status") continue;
      const ts = toIso(h.timestamp);
      if (!ts) continue;
      push({
        category: "task",
        kind: "status_changed",
        entityType: "task",
        entityId: t.id,
        timestamp: ts,
        actorUserId: h.userId,
        labelKey: "task_status_changed",
        params: { from: h.oldValue ?? "—", to: h.newValue ?? "—", title: t.title },
        route: `/tasks/${t.id}`,
      });
    }
  }

  // --- Invoices ---
  for (const inv of scoped.invoices) {
    if (!inv.id) continue;
    const issued = toIso(inv.postedAt) ?? toIso(inv.issueDate) ?? toIso(inv.createdAt);
    if (issued) {
      push({
        category: "invoice",
        kind: "issued",
        entityType: "invoice",
        entityId: inv.id,
        timestamp: issued,
        labelKey: "invoice_issued",
        params: { number: inv.invoiceNumber, amount: inv.grandTotal },
        route: `/billing/invoices/${inv.id}`,
      });
    }
    const approved = toIso(inv.approvedAt);
    if (inv.approvalStatus === "approved" && approved) {
      push({
        category: "invoice",
        kind: "approved",
        entityType: "invoice",
        entityId: inv.id,
        timestamp: approved,
        actorUserId: inv.approvedBy ?? undefined,
        labelKey: "invoice_approved",
        params: { number: inv.invoiceNumber },
        route: `/billing/invoices/${inv.id}`,
      });
    }
    const reversed = toIso(inv.reversedAt);
    if (reversed) {
      push({
        category: "invoice",
        kind: "reversed",
        entityType: "invoice",
        entityId: inv.id,
        timestamp: reversed,
        labelKey: "invoice_reversed",
        params: { number: inv.invoiceNumber },
        route: `/billing/invoices/${inv.id}`,
      });
    }
  }

  // --- Payments ---
  for (const p of scoped.payments) {
    if (!p.id) continue;
    const ts = toIso(p.date) ?? toIso(p.createdAt);
    if (!ts) continue;
    push({
      category: "payment",
      kind: "recorded",
      entityType: "payment",
      entityId: p.id,
      timestamp: ts,
      labelKey: "payment_recorded",
      params: { amount: p.amount, method: p.methodName ?? "" },
      route: p.invoiceId ? `/billing/invoices/${p.invoiceId}` : undefined,
    });
  }

  // --- Recorded Activity events (existing audit architecture) ---
  for (const a of scoped.activities) {
    const ts = toIso(a.occurredAt);
    if (!ts) continue;
    // Recognize deal stage-change activities to render as a structured transition.
    const isStageChange = a.subject === "Deal stage changed";
    push({
      category: "activity",
      kind: isStageChange ? "stage_changed" : "logged",
      entityType: a.entityType === "contact" ? "contact" : "deal",
      entityId: a.entityId,
      timestamp: ts,
      actorUserId: a.userId,
      labelKey: isStageChange ? "deal_stage_changed" : "activity_logged",
      params: isStageChange
        ? { transition: a.description ?? "" }
        : { subject: a.subject },
      route:
        a.entityType === "deal"
          ? `/crm/deals/${a.entityId}`
          : `/crm/contacts/${a.entityId}`,
    });
  }

  // Newest first.
  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/** Categories exposed for the filter control. */
export const TIMELINE_FILTERS: TimelineCategory[] = [
  "customer",
  "deal",
  "contract",
  "project",
  "task",
  "invoice",
  "payment",
  "activity",
];
