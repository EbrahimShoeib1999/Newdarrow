/**
 * Custom Business Modules Engine — Firestore service.
 *
 * Two persisted shapes, both inside the tenant boundary:
 * - definitions: companies/{companyId}/module_definitions/{key}
 * - records:     companies/{companyId}/mod_<activity>_rec_<key>/{id}
 *
 * The record collection name carries the owning activity (activity-domain
 * contract), so the prefix-based rules gate applies exactly like the built-in
 * rem_/fm_/mkt_ domains: the service derives the name from the DEFINITION's
 * activity, and the rules re-derive it from the collection — a forged
 * `activity` field on any document stays inert.
 *
 * Every write path re-runs the pure engine validation (the UI is never the
 * only validator, repo convention), relation values are resolved to real
 * documents inside the transaction, and stale writes are rejected through
 * optimistic revisions rather than last-write-wins.
 */

import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { moduleRecordCollection } from "@/features/activities/types/activity-domain";
import type { ActivityId } from "@/features/activities/types/activity.types";
import type {
  CustomModuleDefinition,
  FieldError,
  ModuleAttachment,
  ModuleRecord,
  ModuleStageChange,
} from "../types/custom-module.types";
import {
  canMoveStage,
  sanitizeDefinitionInput,
  splitRecordInput,
  validateDefinition,
  validateRecordValues,
} from "../lib/module-engine";

const SERVICE_NAME = "CustomModulesService";

function logged<T>(actionName: string, fn: () => Promise<T>): Promise<T> {
  return withLogging(SERVICE_NAME, actionName, fn());
}

/** Definitions live in one fixed tenant subcollection (rules: admin-config gate). */
export const MODULE_DEFINITIONS_COLLECTION = "module_definitions";

/**
 * Validation failures surface as a typed error so the form can render the
 * exact per-field reasons instead of a generic toast (shared FieldError shape).
 */
export class ModuleValidationError extends Error {
  errors: FieldError[];
  constructor(errors: FieldError[]) {
    super("validation_failed");
    this.name = "ModuleValidationError";
    this.errors = errors;
  }
}

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

function normalizeDefinition(id: string, data: Record<string, unknown> | undefined): CustomModuleDefinition {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ...(d as unknown as CustomModuleDefinition),
    key: id,
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
  };
}

function normalizeRecord(id: string, data: Record<string, unknown> | undefined): ModuleRecord {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ...(d as unknown as ModuleRecord),
    id,
    values: (d.values ?? {}) as Record<string, unknown>,
    stageHistory: (Array.isArray(d.stageHistory) ? d.stageHistory : []) as ModuleStageChange[],
    archived: d.archived === true,
    revision: Number(d.revision ?? 1),
    createdAt: conv(d.createdAt) ?? "",
    updatedAt: conv(d.updatedAt) ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* Definitions                                                                 */
/* -------------------------------------------------------------------------- */

export const DefinitionService = {
  async list(companyId: string): Promise<ApiResponse<CustomModuleDefinition[]>> {
    return logged("listDefinitions", async () => {
      const ref = collection(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION);
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), fsLimit(200)));
      return {
        data: snap.docs.map((d) => normalizeDefinition(d.id, d.data())),
        message: "Success",
      };
    });
  },

  async get(companyId: string, key: string): Promise<ApiResponse<CustomModuleDefinition | null>> {
    return logged("getDefinition", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key));
      return snap.exists()
        ? { data: normalizeDefinition(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },

  /**
   * Key = document id, so duplicate keys collide on the write itself instead
   * of quietly forking a second definition. `activity` is forced to the
   * tenant's active activity by the caller — never to editor-supplied text.
   */
  async create(
    companyId: string,
    activity: ActivityId,
    input: Record<string, unknown>,
    uid: string,
  ): Promise<ApiResponse<CustomModuleDefinition>> {
    return logged("createDefinition", async () => {
      const clean = sanitizeDefinitionInput({ ...input, activity });
      const errors = validateDefinition(clean as Partial<CustomModuleDefinition>);
      if (errors.length) throw new ModuleValidationError(errors);
      const key = clean.key as string;
      const ref = doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key);
      const existing = await getDoc(ref);
      if (existing.exists()) {
        throw new ModuleValidationError([{ fieldKey: "key", reason: "duplicateModuleKey" }]);
      }
      const def = {
        ...(clean as object),
        key,
        activity,
        lifecycle: "draft" as const, // new configs start as previewable drafts
        revision: 1,
        createdBy: uid,
        updatedBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(ref, stripUndefined(def as Record<string, unknown>));
      const snap = await getDoc(ref);
      return { data: normalizeDefinition(snap.id, snap.data()), message: "Module created" };
    });
  },

  /**
   * Full-config edit with optimistic concurrency: the caller supplies the
   * revision it loaded; a stale editor is rejected instead of overwriting.
   * Identity (key) and the activity binding are immutable after creation.
   */
  async update(
    companyId: string,
    key: string,
    input: Record<string, unknown>,
    expectedRevision: number,
    uid: string,
  ): Promise<ApiResponse<CustomModuleDefinition>> {
    return logged("updateDefinition", async () => {
      const clean = sanitizeDefinitionInput(input);
      delete clean.key;
      delete clean.activity; // re-bound below from the stored definition
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("module_not_found");
        const current = snap.data() as Record<string, unknown>;
        if (Number(current.revision ?? 1) !== expectedRevision) throw new Error("stale_revision");
        const merged = { ...current, ...clean, key, activity: current.activity };
        const errors = validateDefinition(merged as unknown as Partial<CustomModuleDefinition>);
        if (errors.length) throw new ModuleValidationError(errors);
        tx.update(ref, stripUndefined({
          ...clean,
          revision: expectedRevision + 1,
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        }));
      });
      const after = await getDoc(doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key));
      return { data: normalizeDefinition(after.id, after.data()), message: "Module updated" };
    });
  },

  /**
   * Lifecycle activation: draft → active (goes live for its grantees),
   * active → archived (hides the module and blocks new writes), and an
   * archived module may only return to draft for review before reactivation.
   */
  async setLifecycle(
    companyId: string,
    key: string,
    lifecycle: "draft" | "active" | "archived",
    expectedRevision: number,
    uid: string,
  ): Promise<ApiResponse<CustomModuleDefinition>> {
    return logged("setModuleLifecycle", async () => {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("module_not_found");
        const current = snap.data() as Record<string, unknown>;
        if (Number(current.revision ?? 1) !== expectedRevision) throw new Error("stale_revision");
        const from = String(current.lifecycle ?? "draft");
        const legal =
          (from === "draft" && lifecycle === "active") ||
          (from === "active" && lifecycle === "archived") ||
          (from === "archived" && lifecycle === "draft");
        if (!legal) throw new Error(`illegal_lifecycle:${from}->${lifecycle}`);
        tx.update(ref, {
          lifecycle,
          revision: expectedRevision + 1,
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        });
      });
      const after = await getDoc(doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, key));
      return { data: normalizeDefinition(after.id, after.data()), message: "Module lifecycle updated" };
    });
  },
};

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

/** Relation targets resolve to real tenant collections — never a blind id. */
const RELATION_COLLECTIONS: Record<string, string> = {
  contact: "contacts",
  project: "projects",
  task: "tasks",
  employee: "employees",
  invoice: "invoices",
};

/**
 * Verify every relation value points at an existing document INSIDE this
 * tenant. Module-to-module targets resolve through the referenced module's
 * own definition (same company), so a cross-tenant or forged id fails here
 * long before it can corrupt a detail view.
 */
async function assertRelationsValid(
  tx: Transaction,
  companyId: string,
  def: CustomModuleDefinition,
  values: Record<string, unknown>,
): Promise<void> {
  for (const field of def.fields) {
    if (field.type !== "relation" || !field.relation) continue;
    const raw = values[field.key];
    if (raw === null || raw === undefined || raw === "") continue;
    const id = String(raw);
    let ref;
    if (field.relation.target === "module") {
      const targetKey = field.relation.moduleKey ?? "";
      const defSnap = await tx.get(doc(db, "companies", companyId, MODULE_DEFINITIONS_COLLECTION, targetKey));
      if (!defSnap.exists()) throw new Error(`relation_target_missing:${field.key}`);
      const targetDef = defSnap.data() as Record<string, unknown>;
      ref = doc(
        db,
        "companies",
        companyId,
        moduleRecordCollection(targetDef.activity as ActivityId, targetKey),
        id,
      );
    } else {
      ref = doc(db, "companies", companyId, RELATION_COLLECTIONS[field.relation.target], id);
    }
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(`relation_target_missing:${field.key}`);
  }
}

/** Duplicate check for unique fields (excludes the record being edited). */
async function assertUniqueValues(
  companyId: string,
  def: CustomModuleDefinition,
  values: Record<string, unknown>,
  selfId?: string,
): Promise<void> {
  for (const field of def.fields) {
    if (!field.unique) continue;
    const raw = values[field.key];
    if (raw === null || raw === undefined || raw === "") continue;
    const snap = await getDocs(
      query(
        collection(db, "companies", companyId, moduleRecordCollection(def.activity, def.key)),
        where(`values.${field.key}`, "==", raw),
        fsLimit(5),
      ),
    );
    const clash = snap.docs.find((d) => d.id !== selfId && d.data().archived !== true);
    if (clash) {
      throw new ModuleValidationError([{ fieldKey: field.key, reason: "uniqueViolation" }]);
    }
  }
}

/** Transactional per-module human reference code (never reused, gap-tolerant). */
async function allocateRecordCode(
  tx: Transaction,
  companyId: string,
  moduleKey: string,
): Promise<string> {
  const ref = doc(db, "companies", companyId, "settings", "custom_modules");
  const snap = await tx.get(ref);
  const seq = snap.exists()
    ? Number(((snap.data() as Record<string, unknown>).seq as Record<string, number> | undefined)?.[moduleKey] ?? 0)
    : 0;
  const next = seq + 1;
  tx.set(ref, { seq: { [moduleKey]: next } }, { merge: true });
  return `${moduleKey.toUpperCase().slice(0, 8)}-${String(next).padStart(4, "0")}`;
}

export const RecordService = {
  async list(companyId: string, def: CustomModuleDefinition): Promise<ApiResponse<ModuleRecord[]>> {
    return logged("listRecords", async () => {
      const ref = collection(db, "companies", companyId, moduleRecordCollection(def.activity, def.key));
      const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), fsLimit(500)));
      return { data: snap.docs.map((d) => normalizeRecord(d.id, d.data())), message: "Success" };
    });
  },

  async get(companyId: string, def: CustomModuleDefinition, id: string): Promise<ApiResponse<ModuleRecord | null>> {
    return logged("getRecord", async () => {
      const snap = await getDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id));
      return snap.exists()
        ? { data: normalizeRecord(snap.id, snap.data()), message: "Success" }
        : { data: null, message: "Not found" };
    });
  },

  async create(
    companyId: string,
    def: CustomModuleDefinition,
    payload: Record<string, unknown>,
    uid: string,
  ): Promise<ApiResponse<ModuleRecord>> {
    return logged("createRecord", async () => {
      const input = splitRecordInput(payload);
      const result = validateRecordValues(def, input.values);
      if (!result.ok) throw new ModuleValidationError(result.errors);
      const status = input.status ?? def.initialStage;
      if (status !== def.initialStage && !canMoveStage(def.stages, def.initialStage, status)) {
        throw new ModuleValidationError([{ fieldKey: "status", reason: "illegalTransition" }]);
      }
      await assertUniqueValues(companyId, def, result.values);
      let createdId = "";
      await runTransaction(db, async (tx) => {
        const code = await allocateRecordCode(tx, companyId, def.key);
        const ref = doc(collection(db, "companies", companyId, moduleRecordCollection(def.activity, def.key)));
        const stamp: ModuleStageChange = { from: "", to: status, at: new Date().toISOString(), by: uid };
        tx.set(ref, stripUndefined({
          moduleKey: def.key,
          code,
          values: result.values,
          status,
          archived: false,
          stageHistory: [stamp],
          revision: 1,
          createdBy: uid,
          updatedBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>);
        await assertRelationsValid(tx, companyId, def, result.values);
        createdId = ref.id;
      });
      const snap = await getDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), createdId));
      return { data: normalizeRecord(snap.id, snap.data()), message: "Record created" };
    });
  },

  /**
   * Values are replaced wholesale (the form owns the full field set), while
   * identity/code/archive/audit stay engine-owned. A status in the payload is
   * a lifecycle move and must be legal from the record's CURRENT stage —
   * the caller's copy may be stale, so the stored doc is the truth.
   */
  async update(
    companyId: string,
    def: CustomModuleDefinition,
    id: string,
    payload: Record<string, unknown>,
    expectedRevision: number,
    uid: string,
  ): Promise<ApiResponse<ModuleRecord>> {
    return logged("updateRecord", async () => {
      const input = splitRecordInput(payload);
      const result = validateRecordValues(def, input.values);
      if (!result.ok) throw new ModuleValidationError(result.errors);
      await assertUniqueValues(companyId, def, result.values, id);
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("record_not_found");
        const current = snap.data() as Record<string, unknown>;
        if (current.archived === true) throw new Error("record_archived");
        if (Number(current.revision ?? 1) !== expectedRevision) throw new Error("stale_revision");
        const from = String(current.status ?? def.initialStage);
        const to = input.status ?? from;
        if (to !== from && !canMoveStage(def.stages, from, to)) {
          throw new ModuleValidationError([{ fieldKey: "status", reason: "illegalTransition" }]);
        }
        await assertRelationsValid(tx, companyId, def, result.values);
        const history = Array.isArray(current.stageHistory) ? current.stageHistory : [];
        const patch: Record<string, unknown> = {
          values: result.values,
          status: to,
          revision: expectedRevision + 1,
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        };
        if (to !== from) {
          patch.stageHistory = [
            ...history,
            { from, to, at: new Date().toISOString(), by: uid },
          ];
        }
        tx.update(ref, stripUndefined(patch));
      });
      const after = await getDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id));
      return { data: normalizeRecord(after.id, after.data()), message: "Record updated" };
    });
  },

  /** Reversible archive — keeps every field/audit trail intact. */
  async setArchived(
    companyId: string,
    def: CustomModuleDefinition,
    id: string,
    archived: boolean,
    uid: string,
  ): Promise<ApiResponse<ModuleRecord>> {
    return logged("setRecordArchived", async () => {
      await updateDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id), {
        archived,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      const after = await getDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id));
      return { data: normalizeRecord(after.id, after.data()), message: archived ? "Record archived" : "Record restored" };
    });
  },

  /**
   * Permanent deletion ONLY when the module config opts in
   * (allowPermanentDelete) — the default is archive. The caller's role gate
   * runs in the UI/hooks and the rules restrict deletes to company admins.
   */
  async removePermanent(companyId: string, def: CustomModuleDefinition, id: string) {
    return logged("deleteRecordPermanent", async () => {
      if (!def.allowPermanentDelete) throw new Error("permanent_delete_disabled");
      await deleteDoc(doc(db, "companies", companyId, moduleRecordCollection(def.activity, def.key), id));
      return { data: null, message: "Record deleted" };
    });
  },

  /** Current attachment descriptor list for one record. */
  readAttachments(record: ModuleRecord): ModuleAttachment[] {
    return Array.isArray(record.attachments) ? (record.attachments as ModuleAttachment[]) : [];
  },
};

/* -------------------------------------------------------------------------- */
/* Relation options (form pickers)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Candidate targets for a relation field, capped at 200 per collection so a
 * picker never streams an entire tenant dataset. Only real tenant documents
 * are offered — the create/update transaction still re-validates the stored
 * id, so this list is a convenience, never the security boundary.
 */
export async function listRelationOptions(
  companyId: string,
  field: { type: string; relation?: { target: string; moduleKey?: string } },
  definitions: CustomModuleDefinition[],
): Promise<{ id: string; label: string }[]> {
  const rel = field.relation;
  if (!rel) return [];
  let collectionName: string | null = null;
  let primaryField: string | null = null;
  if (rel.target === "module") {
    const targetDef = definitions.find((d) => d.key === (rel.moduleKey ?? ""));
    if (!targetDef) return [];
    collectionName = moduleRecordCollection(targetDef.activity, targetDef.key);
    primaryField = `values.${targetDef.listConfig.primaryField}`;
  } else {
    collectionName = RELATION_COLLECTIONS[rel.target] ?? null;
  }
  if (!collectionName) return [];
  const snap = await getDocs(
    query(collection(db, "companies", companyId, collectionName), fsLimit(200)),
  );
  return snap.docs.map((d) => {
    const data = d.data() ?? {};
    let label = "";
    if (primaryField) {
      const v = data[primaryField.split(".")[1]];
      if (typeof v === "string" && v.trim()) label = v.trim();
    }
    return { id: d.id, label: label || labelFromDoc(d) };
  });
}

/* -------------------------------------------------------------------------- */
/* Relation label resolution (detail/list rendering)                           */
/* -------------------------------------------------------------------------- */

/** Best human label out of whatever the referenced collection stores. */
function labelFromDoc(snap: DocumentSnapshot): string {
  const d = snap.data() ?? {};
  const pick = (k: string) => (typeof d[k] === "string" && d[k].trim() ? (d[k] as string).trim() : "");
  return (
    pick("name") ||
    pick("title") ||
    pick("code") ||
    pick("number") ||
    pick("fullName") ||
    snap.id.slice(0, 8)
  );
}

/**
 * id → display label per relation field, capped at 60 ids per field so a
 * pathological page cannot fan out into thousands of reads. Missing/deleted
 * targets simply render as the raw id (detail views show them as "removed").
 */
export async function fetchRelationLabelMaps(
  companyId: string,
  def: CustomModuleDefinition,
  records: ModuleRecord[],
  definitions: CustomModuleDefinition[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  const defByKey = new Map(definitions.map((d) => [d.key, d]));
  for (const field of def.fields) {
    if (field.type !== "relation" || !field.relation) continue;
    const ids = new Set<string>();
    for (const r of records) {
      const v = r.values?.[field.key];
      if (typeof v === "string" && v) ids.add(v);
      if (ids.size >= 60) break;
    }
    const map: Record<string, string> = {};
    let collectionName: string | null = null;
    if (field.relation.target === "module") {
      const targetDef = defByKey.get(field.relation.moduleKey ?? "");
      collectionName = targetDef
        ? moduleRecordCollection(targetDef.activity, targetDef.key)
        : null;
    } else {
      collectionName = RELATION_COLLECTIONS[field.relation.target] ?? null;
    }
    if (!collectionName) {
      out[field.key] = map;
      continue;
    }
    await Promise.all(
      [...ids].map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "companies", companyId, collectionName, id));
          if (snap.exists()) map[id] = labelFromDoc(snap);
        } catch {
          /* unreadable target renders as the raw id — never breaks the list */
        }
      }),
    );
    out[field.key] = map;
  }
  return out;
}
