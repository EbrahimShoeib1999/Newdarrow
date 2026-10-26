/**
 * Marketing Agency — Firestore service.
 *
 * Every collection name comes from the shared activity-domain naming contract
 * (prefix `mkt_`), so these writes land exactly in the collections the
 * Firestore rules gate by the tenant's authoritative MARKETING_AGENCY
 * activity. The service re-enforces the pure domain rules (transition
 * legality, budget-revision audit, publication gates, money normalization)
 * at write time — the UI is never the only validator — and validates every
 * cross-reference (CRM client, contract, campaign link) against the tenant's
 * own records so a forged id from another tenant can never be attached.
 *
 * Clients/contracts/invoices are NOT duplicated: campaigns store references
 * (ids) into the shared collections; revenue is always derived from billing.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { domainCollection } from "@/features/activities/types/activity-domain";
import {
  normalizeMoney,
  canTransitionCampaign,
  canActivateCampaign,
  hasPendingRevision,
  applyRevisionApproval,
  rejectRevision,
  validateCampaignDraft,
  validateRevisionDraft,
  validateExpenseDraft,
} from "../lib/campaign-rules";
import {
  canTransitionDeliverable,
  canPublishDeliverable,
  canSetClientApproval,
  canTransitionContent,
  canScheduleContent,
  validateDeliverableDraft,
  validateContentDraft,
  validateBriefDraft,
} from "../lib/deliverable-rules";
import type {
  BudgetRevision,
  Campaign,
  CampaignStatus,
  CampaignStatusChange,
  ClientApprovalRecord,
  ClientApprovalState,
  ContentItem,
  ContentStatus,
  ContentStatusChange,
  CreateCampaignDTO,
  CreateCampaignExpenseDTO,
  CreateContentItemDTO,
  CreateCreativeBriefDTO,
  CreateDeliverableDTO,
  CreativeBrief,
  CampaignExpense,
  Deliverable,
  DeliverableStatus,
  DeliverableStatusChange,
  UpdateCampaignDTO,
  UpdateCampaignExpenseDTO,
  UpdateContentItemDTO,
  UpdateCreativeBriefDTO,
  UpdateDeliverableDTO,
} from "../types/marketing.types";

const SERVICE_NAME = "MarketingService";

function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

/** The contract-derived, rules-gated collection names. Never hand-typed. */
export const MKT_COLLECTIONS = {
  campaigns: domainCollection("MARKETING_AGENCY", "campaigns"), // mkt_campaigns
  expenses: domainCollection("MARKETING_AGENCY", "expenses"), // mkt_expenses
  deliverables: domainCollection("MARKETING_AGENCY", "deliverables"), // mkt_deliverables
  briefs: domainCollection("MARKETING_AGENCY", "briefs"), // mkt_briefs
  contentItems: domainCollection("MARKETING_AGENCY", "content_items"), // mkt_content_items
} as const;

/** Shared CRM collection names the marketing references point into. */
const SHARED_CONTACTS = "contacts";
const SHARED_CONTRACTS = "contracts";

/** Firestore rejects `undefined` — strip before every write (repo convention). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

const conv = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

function normalize<T extends { id: string }>(id: string, data: Record<string, unknown> | undefined): T {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ...d,
    id,
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
    startDate: "startDate" in d ? conv(d.startDate) : undefined,
    endDate: "endDate" in d ? conv(d.endDate) : undefined,
    dueDate: "dueDate" in d ? conv(d.dueDate) : undefined,
    scheduledDate: "scheduledDate" in d ? conv(d.scheduledDate) : undefined,
    scheduledPublishDate: "scheduledPublishDate" in d ? conv(d.scheduledPublishDate) : undefined,
    publishedAt: "publishedAt" in d ? conv(d.publishedAt) : undefined,
    spentAt: "spentAt" in d ? conv(d.spentAt) : undefined,
  } as unknown as T;
}

async function listCollection<T extends { id: string }>(companyId: string, name: string): Promise<ApiResponse<T[]>> {
  const ref = collection(db, "companies", companyId, name);
  const q = query(ref, orderBy("createdAt", "desc"), limit(300));
  const snap = await getDocs(q);
  return { data: snap.docs.map((d) => normalize<T>(d.id, d.data())), message: "Success" };
}

/* -------------------------------------------------------------------------- */
/* Cross-relationship validation (trusted service layer)                      */
/* -------------------------------------------------------------------------- */

/**
 * A reference is only legal when the target exists INSIDE the calling
 * tenant's own subcollections — a document id harvested from another company
 * resolves to a missing doc here and is rejected before any write happens.
 */
async function assertTenantRef(companyId: string, coll: string, id: string, label: string): Promise<void> {
  if (!id) throw new Error(`${label} is required`);
  const snap = await getDoc(doc(db, "companies", companyId, coll, id));
  if (!snap.exists()) throw new Error(`${label} does not belong to this company`);
}

async function assertCampaignExists(companyId: string, campaignId: string): Promise<Record<string, unknown>> {
  if (!campaignId) throw new Error("Campaign is required");
  const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, campaignId));
  if (!snap.exists()) throw new Error("Campaign does not belong to this company");
  return snap.data() as Record<string, unknown>;
}

/**
 * Brief attachments may only point at this tenant's own Storage partition
 * (company or activity-domain path) or an inline data URL from the sanctioned
 * <100KB fallback — never at an arbitrary foreign object reference.
 */
function assertAttachmentUrls(companyId: string, attachments: CreativeBrief["attachments"]): void {
  for (const a of attachments ?? []) {
    const ok =
      a.url.startsWith("data:") ||
      a.url.includes(`/o/${encodeURIComponent(`companies/${companyId}/`)}`) ||
      a.url.includes(`/o/${encodeURIComponent(`domain/mkt_briefs/${companyId}/`)}`) ||
      a.url.includes(`/companies/${companyId}/`) ||
      a.url.includes(`/domain/mkt_briefs/${companyId}/`);
    if (!ok) throw new Error("Attachment does not belong to this company's storage");
  }
}

/* -------------------------------------------------------------------------- */
/* Campaign code sequence (transactional, per-tenant, never reused)           */
/* -------------------------------------------------------------------------- */

interface CmpSeqState {
  prefix: string;
  nextNumber: number;
  padding: number;
}
const DEFAULT_CMP_SEQ: CmpSeqState = { prefix: "CMP-", nextNumber: 1, padding: 4 };

async function allocateCampaignCode(tx: Transaction, companyId: string): Promise<string> {
  const settingsRef = doc(db, "companies", companyId, "settings", "marketing");
  const snap = await tx.get(settingsRef);
  const seq: CmpSeqState = snap.exists()
    ? { ...DEFAULT_CMP_SEQ, ...((snap.data() as Record<string, unknown>)?.campaignSequence as Partial<CmpSeqState> | undefined) }
    : DEFAULT_CMP_SEQ;
  const code = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
  tx.set(settingsRef, { campaignSequence: { ...seq, nextNumber: seq.nextNumber + 1 } }, { merge: true });
  return code;
}

/* -------------------------------------------------------------------------- */
/* Campaigns                                                                  */
/* -------------------------------------------------------------------------- */

export const CampaignService = {
  async list(companyId: string) {
    return logged("listCampaigns", async () =>
      listCollection<Campaign>(companyId, MKT_COLLECTIONS.campaigns));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Campaign | null>> {
    return logged("getCampaign", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      return snap.exists()
        ? { data: normalize<Campaign>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  /**
   * New campaigns start as drafts with the initial budget set directly;
   * every later budget change must go through a revision (see below).
   */
  async create(companyId: string, data: CreateCampaignDTO): Promise<ApiResponse<Campaign>> {
    return logged("createCampaign", async () => {
      const errors = validateCampaignDraft(data);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      // Relationship validation — reject foreign/fabricated CRM references.
      await assertTenantRef(companyId, SHARED_CONTACTS, data.clientId, "Client");
      if (data.contractId) await assertTenantRef(companyId, SHARED_CONTRACTS, data.contractId, "Contract");
      let created: Campaign | null = null;
      await runTransaction(db, async (tx) => {
        const code = await allocateCampaignCode(tx, companyId);
        const ref = doc(collection(db, "companies", companyId, MKT_COLLECTIONS.campaigns));
        const clean = stripUndefined({
          ...data,
          budgetAmount: normalizeMoney(data.budgetAmount),
          channels: data.channels ?? [],
          status: "draft" as CampaignStatus,
          budgetRevisions: [],
          statusHistory: [],
        });
        tx.set(ref, { ...clean, code, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        created = { ...clean, id: ref.id, code, status: "draft", budgetRevisions: [], statusHistory: [], createdAt: "", updatedAt: "" } as Campaign;
      });
      return { data: created!, message: "Campaign created" };
    });
  },
  /** Descriptive fields only — status/budget go through transition()/revisions. */
  async update(companyId: string, id: string, data: UpdateCampaignDTO): Promise<ApiResponse<Campaign>> {
    return logged("updateCampaign", async () => {
      if (data.clientId) await assertTenantRef(companyId, SHARED_CONTACTS, data.clientId, "Client");
      if (data.contractId) await assertTenantRef(companyId, SHARED_CONTRACTS, data.contractId, "Contract");
      await updateDoc(
        doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      return { data: normalize<Campaign>(snap.id, snap.data()), message: "Campaign updated" };
    });
  },
  /**
   * Legal status path only, re-validated against the STORED status (the caller
   * may hold a stale view). Activation additionally requires an approved
   * budget > 0. Audit entry never carries undefined values.
   */
  async transition(
    companyId: string,
    id: string,
    to: CampaignStatus,
    by: string,
    opts?: { note?: string }
  ): Promise<ApiResponse<Campaign>> {
    return logged("transitionCampaign", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      if (!snap.exists()) throw new Error("Campaign not found");
      const c = snap.data() as Record<string, unknown>;
      const from = c.status as CampaignStatus;
      if (!canTransitionCampaign(from, to)) throw new Error(`Illegal transition ${from} -> ${to}`);
      if (to === "active" && !canActivateCampaign({ budgetAmount: Number(c.budgetAmount) || 0 })) {
        throw new Error("An approved budget greater than zero is required to activate");
      }
      const history: CampaignStatusChange[] = Array.isArray(c.statusHistory) ? c.statusHistory : [];
      const trimmedNote = opts?.note?.trim();
      const change: CampaignStatusChange = { from, to, at: new Date().toISOString(), by };
      if (trimmedNote) change.note = trimmedNote;
      await updateDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id), stripUndefined({
        status: to,
        statusHistory: [...history, change],
        updatedAt: serverTimestamp(),
      }));
      const after = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      return { data: normalize<Campaign>(after.id, after.data()), message: "Campaign transitioned" };
    });
  },
  /** Propose a budget change. Draft campaigns edit the budget directly instead. */
  async proposeBudgetRevision(
    companyId: string,
    id: string,
    draft: { newAmount: number; reason: string },
    by: string
  ): Promise<ApiResponse<Campaign>> {
    return logged("proposeBudgetRevision", async () => {
      const errors = validateRevisionDraft(draft);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      if (!snap.exists()) throw new Error("Campaign not found");
      const c = snap.data() as Record<string, unknown>;
      const status = c.status as CampaignStatus;
      if (!["approved", "active", "paused"].includes(status)) {
        throw new Error("Budget revisions apply only to approved or running campaigns");
      }
      const revisions: BudgetRevision[] = Array.isArray(c.budgetRevisions) ? c.budgetRevisions : [];
      if (hasPendingRevision(revisions)) throw new Error("A revision is already awaiting decision");
      const revision: BudgetRevision = {
        id: crypto.randomUUID(),
        previousAmount: normalizeMoney(c.budgetAmount),
        newAmount: normalizeMoney(draft.newAmount),
        reason: draft.reason.trim(),
        state: "pending",
        proposedBy: by,
        proposedAt: new Date().toISOString(),
      };
      await updateDoc(snap.ref, stripUndefined({
        budgetRevisions: [...revisions, revision],
        updatedAt: serverTimestamp(),
      }));
      const after = await getDoc(snap.ref);
      return { data: normalize<Campaign>(after.id, after.data()), message: "Revision proposed" };
    });
  },
  /** Approving a revision raises the campaign budget atomically in one write. */
  async decideBudgetRevision(
    companyId: string,
    id: string,
    revisionId: string,
    approve: boolean,
    by: string
  ): Promise<ApiResponse<Campaign>> {
    return logged("decideBudgetRevision", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      if (!snap.exists()) throw new Error("Campaign not found");
      const c = snap.data() as Record<string, unknown>;
      const campaignLike = {
        budgetAmount: Number(c.budgetAmount) || 0,
        budgetRevisions: (Array.isArray(c.budgetRevisions) ? c.budgetRevisions : []) as BudgetRevision[],
      };
      let patch: Record<string, unknown>;
      if (approve) {
        const res = applyRevisionApproval(campaignLike, revisionId);
        if (!res) throw new Error("Revision not found or already decided");
        patch = { budgetAmount: res.budgetAmount, budgetRevisions: res.revisions };
      } else {
        const revisions = rejectRevision(campaignLike, revisionId);
        if (!revisions) throw new Error("Revision not found or already decided");
        patch = { budgetRevisions: revisions };
      }
      for (const r of (patch.budgetRevisions as BudgetRevision[])) {
        if (r.id === revisionId) {
          r.decidedBy = by;
        }
      }
      await updateDoc(snap.ref, stripUndefined({ ...patch, updatedAt: serverTimestamp() }));
      const after = await getDoc(snap.ref);
      return { data: normalize<Campaign>(after.id, after.data()), message: approve ? "Revision approved" : "Revision rejected" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteCampaign", async () => {
      await deleteDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.campaigns, id));
      return { data: null, message: "Campaign deleted" };
    });
  },
  /**
   * Billing integration: attach an existing shared invoice to a campaign.
   * Both sides are re-read inside the tenant's own subcollections, so a
   * foreign invoice or campaign id can never be linked. Only the reference
   * is written — amounts always live in billing.
   */
  async linkInvoice(companyId: string, invoiceId: string, campaignId: string): Promise<ApiResponse<null>> {
    return logged("linkInvoiceToCampaign", async () => {
      await assertCampaignExists(companyId, campaignId);
      await assertTenantRef(companyId, "invoices", invoiceId, "Invoice");
      await updateDoc(doc(db, "companies", companyId, "invoices", invoiceId), {
        campaignId,
        updatedAt: serverTimestamp(),
      });
      return { data: null, message: "Invoice linked to campaign" };
    });
  },
  async unlinkInvoice(companyId: string, invoiceId: string): Promise<ApiResponse<null>> {
    return logged("unlinkInvoiceFromCampaign", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, "invoices", invoiceId));
      if (!snap.exists()) throw new Error("Invoice does not belong to this company");
      await updateDoc(snap.ref, { campaignId: null, updatedAt: serverTimestamp() });
      return { data: null, message: "Invoice unlinked" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Campaign expenses (actual spend — never agency revenue)                    */
/* -------------------------------------------------------------------------- */

export const ExpenseService = {
  async list(companyId: string) {
    return logged("listExpenses", async () =>
      listCollection<CampaignExpense>(companyId, MKT_COLLECTIONS.expenses));
  },
  async create(companyId: string, data: CreateCampaignExpenseDTO): Promise<ApiResponse<CampaignExpense>> {
    return logged("createExpense", async () => {
      const errors = validateExpenseDraft(data);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      await assertCampaignExists(companyId, data.campaignId);
      const ref = await addDoc(
        collection(db, "companies", companyId, MKT_COLLECTIONS.expenses),
        stripUndefined({
          ...data,
          amount: normalizeMoney(data.amount),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<CampaignExpense>(snap.id, snap.data()), message: "Expense recorded" };
    });
  },
  async update(companyId: string, id: string, data: UpdateCampaignExpenseDTO): Promise<ApiResponse<CampaignExpense>> {
    return logged("updateExpense", async () => {
      if (data.campaignId) await assertCampaignExists(companyId, data.campaignId);
      await updateDoc(
        doc(db, "companies", companyId, MKT_COLLECTIONS.expenses, id),
        stripUndefined({
          ...data,
          amount: data.amount != null ? normalizeMoney(data.amount) : undefined,
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.expenses, id));
      return { data: normalize<CampaignExpense>(snap.id, snap.data()), message: "Expense updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteExpense", async () => {
      await deleteDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.expenses, id));
      return { data: null, message: "Expense deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Deliverables                                                               */
/* -------------------------------------------------------------------------- */

export const DeliverableService = {
  async list(companyId: string) {
    return logged("listDeliverables", async () =>
      listCollection<Deliverable>(companyId, MKT_COLLECTIONS.deliverables));
  },
  async get(companyId: string, id: string): Promise<ApiResponse<Deliverable | null>> {
    return logged("getDeliverable", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id));
      return snap.exists()
        ? { data: normalize<Deliverable>(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },
  async create(companyId: string, data: CreateDeliverableDTO): Promise<ApiResponse<Deliverable>> {
    return logged("createDeliverable", async () => {
      const errors = validateDeliverableDraft(data);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      await assertCampaignExists(companyId, data.campaignId);
      const ref = await addDoc(
        collection(db, "companies", companyId, MKT_COLLECTIONS.deliverables),
        stripUndefined({
          ...data,
          status: "not_started" as DeliverableStatus,
          requiresClientApproval: data.requiresClientApproval ?? false,
          clientApprovalState: "not_required" as ClientApprovalState,
          clientApprovalHistory: [],
          statusHistory: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<Deliverable>(snap.id, snap.data()), message: "Deliverable created" };
    });
  },
  /**
   * Status moves through the review machine. Publication is additionally
   * gated by the client sign-off state (and stamps publishedAt).
   */
  async transition(
    companyId: string,
    id: string,
    to: DeliverableStatus,
    by: string,
    note?: string
  ): Promise<ApiResponse<Deliverable>> {
    return logged("transitionDeliverable", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id));
      if (!snap.exists()) throw new Error("Deliverable not found");
      const d = snap.data() as Record<string, unknown>;
      const from = d.status as DeliverableStatus;
      if (!canTransitionDeliverable(from, to)) throw new Error(`Illegal transition ${from} -> ${to}`);
      if (to === "published") {
        if (!canPublishDeliverable({
          status: from,
          requiresClientApproval: Boolean(d.requiresClientApproval),
          clientApprovalState: (d.clientApprovalState as ClientApprovalState) ?? "not_required",
        })) {
          throw new Error("Client sign-off is required before publishing");
        }
      }
      const history: DeliverableStatusChange[] = Array.isArray(d.statusHistory) ? d.statusHistory : [];
      const trimmed = note?.trim();
      const change: DeliverableStatusChange = { from, to, at: new Date().toISOString(), by };
      if (trimmed) change.note = trimmed;
      const patch: Record<string, unknown> = {
        status: to,
        statusHistory: [...history, change],
        updatedAt: serverTimestamp(),
      };
      if (to === "published") patch.publishedAt = serverTimestamp();
      await updateDoc(snap.ref, stripUndefined(patch));
      const after = await getDoc(snap.ref);
      return { data: normalize<Deliverable>(after.id, after.data()), message: "Deliverable transitioned" };
    });
  },
  /** Record a client decision on the sign-off; every ask/answer is history. */
  async setClientApproval(
    companyId: string,
    id: string,
    to: ClientApprovalState,
    by: string,
    note?: string
  ): Promise<ApiResponse<Deliverable>> {
    return logged("setDeliverableClientApproval", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id));
      if (!snap.exists()) throw new Error("Deliverable not found");
      const d = snap.data() as Record<string, unknown>;
      const current = (d.clientApprovalState as ClientApprovalState) ?? "not_required";
      if (!canSetClientApproval(d.status as DeliverableStatus, current, to)) {
        throw new Error(`Illegal client-approval change ${current} -> ${to} at status ${String(d.status)}`);
      }
      const hist: ClientApprovalRecord[] = Array.isArray(d.clientApprovalHistory) ? d.clientApprovalHistory : [];
      const record: ClientApprovalRecord = { state: to, note: note?.trim() || null, by, at: new Date().toISOString() };
      await updateDoc(snap.ref, stripUndefined({
        clientApprovalState: to,
        clientApprovalHistory: [...hist, record],
        updatedAt: serverTimestamp(),
      }));
      const after = await getDoc(snap.ref);
      return { data: normalize<Deliverable>(after.id, after.data()), message: "Client decision recorded" };
    });
  },
  /** Descriptive fields only; transitions and sign-offs have their own paths. */
  async update(companyId: string, id: string, data: UpdateDeliverableDTO): Promise<ApiResponse<Deliverable>> {
    return logged("updateDeliverable", async () => {
      if (data.campaignId) await assertCampaignExists(companyId, data.campaignId);
      await updateDoc(
        doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id));
      return { data: normalize<Deliverable>(snap.id, snap.data()), message: "Deliverable updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteDeliverable", async () => {
      await deleteDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.deliverables, id));
      return { data: null, message: "Deliverable deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Creative briefs                                                            */
/* -------------------------------------------------------------------------- */

export const BriefService = {
  async list(companyId: string) {
    return logged("listBriefs", async () =>
      listCollection<CreativeBrief>(companyId, MKT_COLLECTIONS.briefs));
  },
  async create(companyId: string, data: CreateCreativeBriefDTO): Promise<ApiResponse<CreativeBrief>> {
    return logged("createBrief", async () => {
      const errors = validateBriefDraft(data);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      await assertCampaignExists(companyId, data.campaignId);
      assertAttachmentUrls(companyId, data.attachments ?? []);
      const ref = await addDoc(
        collection(db, "companies", companyId, MKT_COLLECTIONS.briefs),
        stripUndefined({
          ...data,
          attachments: data.attachments ?? [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<CreativeBrief>(snap.id, snap.data()), message: "Brief created" };
    });
  },
  async update(companyId: string, id: string, data: UpdateCreativeBriefDTO): Promise<ApiResponse<CreativeBrief>> {
    return logged("updateBrief", async () => {
      if (data.campaignId) await assertCampaignExists(companyId, data.campaignId);
      if (data.attachments) assertAttachmentUrls(companyId, data.attachments);
      await updateDoc(
        doc(db, "companies", companyId, MKT_COLLECTIONS.briefs, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.briefs, id));
      return { data: normalize<CreativeBrief>(snap.id, snap.data()), message: "Brief updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteBrief", async () => {
      await deleteDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.briefs, id));
      return { data: null, message: "Brief deleted" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Content calendar items                                                     */
/* -------------------------------------------------------------------------- */

export const ContentService = {
  async list(companyId: string) {
    return logged("listContentItems", async () =>
      listCollection<ContentItem>(companyId, MKT_COLLECTIONS.contentItems));
  },
  async create(companyId: string, data: CreateContentItemDTO): Promise<ApiResponse<ContentItem>> {
    return logged("createContentItem", async () => {
      const errors = validateContentDraft(data);
      if (Object.keys(errors).length) throw new Error(Object.values(errors).join(", "));
      await assertCampaignExists(companyId, data.campaignId);
      const ref = await addDoc(
        collection(db, "companies", companyId, MKT_COLLECTIONS.contentItems),
        stripUndefined({
          ...data,
          status: "draft" as ContentStatus,
          statusHistory: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      const snap = await getDoc(ref);
      return { data: normalize<ContentItem>(snap.id, snap.data()), message: "Content item created" };
    });
  },
  /**
   * Publication machine: scheduling requires a date on record, and
   * "published" additionally stamps publishedAt from the server clock.
   */
  async transition(
    companyId: string,
    id: string,
    to: ContentStatus,
    by: string
  ): Promise<ApiResponse<ContentItem>> {
    return logged("transitionContentItem", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.contentItems, id));
      if (!snap.exists()) throw new Error("Content item not found");
      const c = snap.data() as Record<string, unknown>;
      const from = c.status as ContentStatus;
      if (!canTransitionContent(from, to)) throw new Error(`Illegal transition ${from} -> ${to}`);
      if (to === "scheduled" && !canScheduleContent({ status: from, scheduledDate: conv(c.scheduledDate) } as ContentItem)) {
        throw new Error("A scheduled date is required to schedule content");
      }
      if (to === "published" && !c.scheduledDate) {
        throw new Error("Content must carry its scheduled date before publishing");
      }
      const history: ContentStatusChange[] = Array.isArray(c.statusHistory) ? c.statusHistory : [];
      const patch: Record<string, unknown> = {
        status: to,
        statusHistory: [...history, { from, to, at: new Date().toISOString(), by }],
        updatedAt: serverTimestamp(),
      };
      if (to === "published") patch.publishedAt = serverTimestamp();
      await updateDoc(snap.ref, stripUndefined(patch));
      const after = await getDoc(snap.ref);
      return { data: normalize<ContentItem>(after.id, after.data()), message: "Content transitioned" };
    });
  },
  async update(companyId: string, id: string, data: UpdateContentItemDTO): Promise<ApiResponse<ContentItem>> {
    return logged("updateContentItem", async () => {
      if (data.campaignId) await assertCampaignExists(companyId, data.campaignId);
      await updateDoc(
        doc(db, "companies", companyId, MKT_COLLECTIONS.contentItems, id),
        stripUndefined({ ...data, updatedAt: serverTimestamp() })
      );
      const snap = await getDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.contentItems, id));
      return { data: normalize<ContentItem>(snap.id, snap.data()), message: "Content item updated" };
    });
  },
  async remove(companyId: string, id: string) {
    return logged("deleteContentItem", async () => {
      await deleteDoc(doc(db, "companies", companyId, MKT_COLLECTIONS.contentItems, id));
      return { data: null, message: "Content item deleted" };
    });
  },
};
