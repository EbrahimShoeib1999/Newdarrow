import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
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
import type {
  Project,
  ProjectMilestone,
  ProjectStatus,
  ProjectStatusChange,
  CreateProjectDTO,
  UpdateProjectDTO,
} from "../types/projects.types";
import {
  canTransitionProject,
  requiredReasonField,
} from "../constants/project-lifecycle";
import type { SavedContract } from "@/features/crm/types/contract.types";

const SERVICE_NAME = "ProjectService";

/** Firestore rejects `undefined` field values — strip them before any write. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function isoNow(): string {
  return new Date().toISOString();
}

interface ProjectSequenceState {
  prefix: string;
  nextNumber: number;
  padding: number;
}

const DEFAULT_PROJECT_SEQUENCE: ProjectSequenceState = {
  prefix: "PRJ-",
  nextNumber: 1,
  padding: 4,
};

function formatCode(seq: ProjectSequenceState, n: number): string {
  return `${seq.prefix}${String(n).padStart(seq.padding, "0")}`;
}

/**
 * Allocate the next human-readable project code inside a transaction on
 * companies/{companyId}/settings/projects — the same precedent the billing
 * invoice sequence uses, so codes are per-tenant and never reused.
 */
async function allocateProjectCode(
  tx: Transaction,
  companyId: string
): Promise<string> {
  const settingsRef = doc(db, "companies", companyId, "settings", "projects");
  const snap = await tx.get(settingsRef);
  const seq: ProjectSequenceState = snap.exists()
    ? {
        ...DEFAULT_PROJECT_SEQUENCE,
        ...((snap.data() as Record<string, unknown>)?.projectSequence as
          | Partial<ProjectSequenceState>
          | undefined),
      }
    : DEFAULT_PROJECT_SEQUENCE;
  const code = formatCode(seq, seq.nextNumber);
  tx.set(
    settingsRef,
    { projectSequence: { ...seq, nextNumber: seq.nextNumber + 1 } },
    { merge: true }
  );
  return code;
}

/** Convert Firestore Timestamps on a project doc to ISO strings for the UI types. */
function normalizeProject(id: string, data: Record<string, any> | undefined): Project {
  const d = (data ?? {}) as Omit<Project, "id" | "createdAt" | "updatedAt"> &
    Record<string, any>;
  const conv = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Timestamp) return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  const history: ProjectStatusChange[] = Array.isArray(d.statusHistory)
    ? d.statusHistory.map((h: Record<string, any>) => ({
        ...(h as Omit<ProjectStatusChange, "at">),
        at: conv(h.at) ?? "",
      }))
    : [];
  return {
    ...(d as Omit<Project, "id" | "createdAt" | "updatedAt">),
    id,
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
    startDate: conv(d.startDate),
    endDate: conv(d.endDate),
    actualStartDate: conv(d.actualStartDate),
    actualEndDate: conv(d.actualEndDate),
    statusHistory: history,
  } as Project;
}

/** Deterministic document id for a contract conversion (retry-safe). */
export function conversionDocId(contractId: string): string {
  return `from_contract_${contractId}`;
}

export const ProjectService = {
  async getProjects(companyId: string): Promise<ApiResponse<Project[]>> {
    return withLogging(SERVICE_NAME, "getProjects", (async () => {
      const projectsRef = collection(db, "companies", companyId, "projects");
      const q = query(projectsRef, orderBy("createdAt", "desc"), limit(200));

      const querySnapshot = await getDocs(q);
      const projects: Project[] = querySnapshot.docs.map((d) =>
        normalizeProject(d.id, d.data())
      );

      return {
        data: projects,
        message: "Success",
      };
    })());
  },

  async getProject(companyId: string, projectId: string): Promise<ApiResponse<Project | null>> {
    return withLogging(SERVICE_NAME, "getProject", (async () => {
      const ref = doc(db, "companies", companyId, "projects", projectId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { data: null, message: "Not found" };
      return { data: normalizeProject(snap.id, snap.data()), message: "Success" };
    })());
  },

  async createProject(companyId: string, data: CreateProjectDTO): Promise<ApiResponse<Project>> {
    return withLogging(SERVICE_NAME, "createProject", (async () => {
      const clean = stripUndefined(data as unknown as Record<string, unknown>);
      const projectsRef = collection(db, "companies", companyId, "projects");

      const docRef = await addDoc(projectsRef, {
        ...clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const newDoc = await getDoc(docRef);

      return {
        data: normalizeProject(newDoc.id, newDoc.data()),
        message: "Project created successfully",
      };
    })());
  },

  /**
   * Create a project with an allocated human-readable code. The code sequence
   * document and the project document are written in ONE transaction, so two
   * concurrent creations can never receive the same code.
   */
  async createProjectWithCode(
    companyId: string,
    data: CreateProjectDTO
  ): Promise<ApiResponse<Project>> {
    return withLogging(SERVICE_NAME, "createProjectWithCode", (async () => {
      const clean = stripUndefined(data as unknown as Record<string, unknown>);
      let created: Project | null = null;

      await runTransaction(db, async (tx) => {
        const code = await allocateProjectCode(tx, companyId);
        const ref = doc(collection(db, "companies", companyId, "projects"));
        tx.set(ref, {
          ...clean,
          code,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        created = { ...clean, id: ref.id, code, createdAt: "", updatedAt: "" } as Project;
      });

      return { data: created!, message: "Project created successfully" };
    })());
  },

  async updateProject(
    companyId: string,
    projectId: string,
    data: UpdateProjectDTO
  ): Promise<ApiResponse<Project>> {
    return withLogging(SERVICE_NAME, "updateProject", (async () => {
      const clean = stripUndefined(data as unknown as Record<string, unknown>);
      const projectRef = doc(db, "companies", companyId, "projects", projectId);

      await updateDoc(projectRef, {
        ...clean,
        updatedAt: serverTimestamp(),
      });

      const updatedDoc = await getDoc(projectRef);

      return {
        data: normalizeProject(updatedDoc.id, updatedDoc.data()),
        message: "Project updated successfully",
      };
    })());
  },

  /**
   * Validated lifecycle transition. Rejects illegal edges, requires a reason
   * for hold/cancel, stamps actual start/end dates from the transition itself,
   * and appends an auditable statusHistory entry — all in one read-modify-write.
   */
  async transitionStatus(
    companyId: string,
    projectId: string,
    to: ProjectStatus,
    actorId: string,
    reason?: string
  ): Promise<ApiResponse<Project>> {
    return withLogging(SERVICE_NAME, "transitionStatus", (async () => {
      const ref = doc(db, "companies", companyId, "projects", projectId);

      const updated = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("project_not_found");
        const data = snap.data() as Record<string, any>;
        const from = data.status as ProjectStatus;

        if (!canTransitionProject(from, to)) {
          throw new Error(`invalid_transition:${from}->${to}`);
        }
        const reasonField = requiredReasonField(from, to);
        if (reasonField && !(reason ?? "").trim()) {
          throw new Error(`reason_required:${reasonField}`);
        }

        const at = isoNow();
        const entry: ProjectStatusChange = {
          from,
          to,
          at,
          by: actorId,
          ...(reason?.trim() ? { note: reason.trim() } : {}),
        };
        const history: ProjectStatusChange[] = Array.isArray(data.statusHistory)
          ? data.statusHistory
          : [];

        const patch: Record<string, unknown> = {
          status: to,
          statusHistory: [...history, entry],
          updatedAt: serverTimestamp(),
        };
        // Record ACTUAL dates from the real transition, never from a typed percentage.
        if (from === "planning" && (to === "active" || to === "on_hold") && !data.actualStartDate) {
          patch.actualStartDate = at;
        }
        if (to === "completed" || to === "cancelled") {
          patch.actualEndDate = at;
        }
        if (reasonField === "pauseReason") patch.pauseReason = reason!.trim();
        if (reasonField === "cancellationReason") patch.cancellationReason = reason!.trim();
        if (to === "active" && from === "on_hold") patch.pauseReason = null;

        tx.update(ref, stripUndefined(patch));
        return normalizeProject(snap.id, { ...data, ...patch });
      });

      return { data: updated, message: "Status updated successfully" };
    })());
  },

  /**
   * Contract → project conversion, idempotent by construction: the project doc
   * id is derived from the contract id, and the transaction creates it only
   * when absent — a retried click returns the existing project, never a copy.
   */
  async createProjectFromContract(
    companyId: string,
    contract: SavedContract,
    actorId: string,
    overrides?: Partial<CreateProjectDTO>
  ): Promise<ApiResponse<Project & { alreadyExisted: boolean }>> {
    return withLogging(SERVICE_NAME, "createProjectFromContract", (async () => {
      if (contract.approvalStatus !== "approved") {
        throw new Error("contract_not_approved");
      }
      const conversionKey = `contract:${contract.id}`;
      const ref = doc(
        db,
        "companies",
        companyId,
        "projects",
        conversionDocId(contract.id)
      );

      let result: (Project & { alreadyExisted: boolean }) | null = null;

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) {
          result = {
            ...normalizeProject(snap.id, snap.data()),
            alreadyExisted: true,
          };
          return;
        }
        const code = await allocateProjectCode(tx, companyId);
        const contactId = contract.contactId ?? contract.form?.contactId ?? null;
        const dealId = contract.dealId ?? contract.form?.dealId ?? null;
        tx.set(ref, {
          name: contract.title,
          description: "",
          status: "planning",
          priority: "medium",
          members: actorId ? [actorId] : [],
          ownerId: actorId || null,
          createdBy: actorId,
          startDate: null,
          endDate: null,
          contactId,
          dealId,
          contractId: contract.id,
          conversionKey,
          code,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          ...(overrides ? stripUndefined(overrides as Record<string, unknown>) : {}),
        });
        result = {
          ...(overrides as object),
          id: ref.id,
          name: contract.title,
          status: "planning",
          contactId,
          dealId,
          contractId: contract.id,
          conversionKey,
          code,
          createdBy: actorId,
          createdAt: "",
          updatedAt: "",
          alreadyExisted: false,
        } as Project & { alreadyExisted: boolean };
      });

      return {
        data: result!,
        message: result!.alreadyExisted
          ? "Project already exists for this contract"
          : "Project created from contract",
      };
    })());
  },

  /**
   * Link the contract's delivery scope onto a freshly converted project:
   * 1. Stamp `projectId` on tasks already converted from this contract's
   *    service items (only where none is set — a task belongs to one
   *    project; assignment and every other field is left untouched).
   * 2. Seed one milestone per contracted service item, dates chained from
   *    the contract duration estimate. Deterministic doc ids make the whole
   *    operation retry-safe: existing milestones are never overwritten.
   */
  async linkContractScopeToProject(
    companyId: string,
    projectId: string,
    contract: SavedContract
  ): Promise<ApiResponse<{ linkedTasks: number; milestones: number }>> {
    return withLogging(SERVICE_NAME, "linkContractScopeToProject", (async () => {
      // --- Tasks backfill -------------------------------------------------
      const tasksRef = collection(db, "companies", companyId, "tasks");
      const snap = await getDocs(query(tasksRef, where("contractId", "==", contract.id)));
      let linkedTasks = 0;
      const batch = writeBatch(db);
      for (const tSnap of snap.docs) {
        const data = tSnap.data() as Record<string, unknown>;
        if (!data.projectId) {
          batch.update(tSnap.ref, { projectId, updatedAt: serverTimestamp() });
          linkedTasks += 1;
        }
      }
      if (linkedTasks > 0) await batch.commit();

      // --- Milestone seed from contracted service scope -------------------
      const services = (contract.form?.services || []).filter(
        (s) => s.selected && s.isConverted
      );
      let cursor = new Date();
      let sequence = 0;
      for (const svc of services) {
        const days = svc.durationDays && svc.durationDays > 0 ? svc.durationDays : 7;
        cursor = new Date(cursor.getTime() + days * 24 * 60 * 60 * 1000);
        const dueDate = cursor.toISOString().slice(0, 10);
        sequence += 1;
        // Deterministic id → a retried conversion never doubles milestones.
        const mRef = doc(
          db,
          "companies",
          companyId,
          "projects",
          projectId,
          "milestones",
          `ms-${svc.id}`
        );
        const existing = await getDoc(mRef);
        if (existing.exists()) continue;
        await setDoc(mRef, {
          title: svc.name,
          description: `${svc.department || ""}${
            svc.estimatedHours ? ` · ${svc.estimatedHours}h` : ""
          }`,
          dueDate,
          status: "planned",
          completedAt: null,
          sequenceOrder: sequence,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      return {
        data: { linkedTasks, milestones: services.length },
        message: "Contract scope linked",
      };
    })());
  },

  /** Backfill codes for legacy projects created before sequencing (single pass, idempotent). */
  async assignCodeIfMissing(
    companyId: string,
    projectId: string
  ): Promise<ApiResponse<Project>> {
    return withLogging(SERVICE_NAME, "assignCodeIfMissing", (async () => {
      const ref = doc(db, "companies", companyId, "projects", projectId);
      const code = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("project_not_found");
        const existing = (snap.data() as Record<string, any>).code as string | undefined;
        if (existing) return existing;
        const newCode = await allocateProjectCode(tx, companyId);
        tx.update(ref, { code: newCode });
        return newCode;
      });
      const snap = await getDoc(ref);
      return { data: normalizeProject(snap.id, snap.data()), message: code };
    })());
  },

  async deleteProject(companyId: string, projectId: string): Promise<void> {
    return withLogging(SERVICE_NAME, "deleteProject", (async () => {
      const projectRef = doc(db, "companies", companyId, "projects", projectId);
      await deleteDoc(projectRef);
    })());
  },
};

/* -------------------------------------------------------------------------- */
/* Milestones — subcollection under the project; lifecycle-only, no money.     */
/* -------------------------------------------------------------------------- */

function normalizeMilestone(id: string, data: Record<string, any> | undefined): ProjectMilestone {
  const d = (data ?? {}) as Omit<ProjectMilestone, "id"> & Record<string, any>;
  const conv = (v: unknown): string | null => {
    if (!v) return null;
    if (v instanceof Timestamp) return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  return {
    ...(d as Omit<ProjectMilestone, "id">),
    id,
    dueDate: conv(d.dueDate),
    completedAt: conv(d.completedAt),
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
  } as ProjectMilestone;
}

export const MilestoneService = {
  async list(companyId: string, projectId: string): Promise<ApiResponse<ProjectMilestone[]>> {
    return withLogging("MilestoneService", "list", (async () => {
      const ref = collection(db, "companies", companyId, "projects", projectId, "milestones");
      const snap = await getDocs(query(ref, orderBy("sequenceOrder", "asc")));
      return {
        data: snap.docs.map((d) => normalizeMilestone(d.id, d.data())),
        message: "Success",
      };
    })());
  },

  async create(
    companyId: string,
    projectId: string,
    data: Omit<ProjectMilestone, "id" | "createdAt" | "updatedAt">,
    deterministicId?: string
  ): Promise<ApiResponse<ProjectMilestone>> {
    return withLogging("MilestoneService", "create", (async () => {
      const clean = stripUndefined(data as unknown as Record<string, unknown>);
      const ref = deterministicId
        ? doc(db, "companies", companyId, "projects", projectId, "milestones", deterministicId)
        : doc(collection(db, "companies", companyId, "projects", projectId, "milestones"));
      if (deterministicId) {
        // Preset seeding retry-safety: never overwrite an edited milestone.
        const existing = await getDoc(ref);
        if (existing.exists()) {
          return { data: normalizeMilestone(existing.id, existing.data()), message: "Exists" };
        }
        await setDoc(ref, { ...clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        await addDoc(
          collection(db, "companies", companyId, "projects", projectId, "milestones"),
          { ...clean, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
        );
      }
      const snap = await getDoc(ref);
      return { data: normalizeMilestone(snap.id, snap.data()), message: "Created" };
    })());
  },

  async update(
    companyId: string,
    projectId: string,
    milestoneId: string,
    data: Partial<ProjectMilestone>
  ): Promise<ApiResponse<ProjectMilestone>> {
    return withLogging("MilestoneService", "update", (async () => {
      const clean = stripUndefined(data as unknown as Record<string, unknown>);
      const ref = doc(db, "companies", companyId, "projects", projectId, "milestones", milestoneId);
      await updateDoc(ref, { ...clean, updatedAt: serverTimestamp() });
      const snap = await getDoc(ref);
      return { data: normalizeMilestone(snap.id, snap.data()), message: "Updated" };
    })());
  },

  async remove(companyId: string, projectId: string, milestoneId: string): Promise<void> {
    return withLogging("MilestoneService", "remove", (async () => {
      await deleteDoc(
        doc(db, "companies", companyId, "projects", projectId, "milestones", milestoneId)
      );
    })());
  },
};
