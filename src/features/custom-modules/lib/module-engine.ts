/**
 * Custom Business Modules Engine — pure domain core.
 *
 * No React, no Firebase: everything the engine needs to decide (key legality,
 * definition integrity, field coercion/validation, lifecycle transitions,
 * search/sort/filter/pagination, access resolution) lives here so it can be
 * unit-tested exactly like rem-rules.ts / work-order-rules.ts, and so the same
 * function is the single validator behind BOTH the write service and the form.
 * The UI is never the only validator (repo convention).
 */

import type { UserRole } from "@/features/auth/types/auth.types";
import type { Permission } from "@/lib/permissions";
import type { ActivityId } from "@/features/activities/types/activity.types";
import { moduleRecordCollection } from "@/features/activities/types/activity-domain";
import type {
  CustomModuleDefinition,
  FieldError,
  ModuleFieldDefinition,
  ModuleFieldType,
  ModuleRecord,
  ModuleStageDefinition,
  RelationTarget,
} from "../types/custom-module.types";

/* -------------------------------------------------------------------------- */
/* Identity contracts                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Module keys become Firestore collection-name segments
 * (`mod_<activity>_rec_<key>`), so they are restricted to a safe, indexable
 * shape: lowercase lead, then lowercase letters/digits/underscore, 2–30 chars.
 * No separators that could collide with the namespace grammar.
 */
const MODULE_KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
/** Field keys address document properties, so they avoid Firestore dot-paths. */
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

export function isValidModuleKey(key: string): boolean {
  if (!MODULE_KEY_RE.test(key)) return false;
  // The record-collection grammar must stay unambiguous.
  return !key.startsWith("rec_") && !key.includes("_rec_");
}

export function isValidFieldKey(key: string): boolean {
  return FIELD_KEY_RE.test(key);
}

/** Best-effort transliteration of a display name into a candidate key. */
export function slugifyModuleKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/g, "")
    .slice(0, 30);
}

/** Collection holding a module's records for one tenant/activity. */
export function recordCollectionFor(activity: ActivityId, moduleKey: string): string {
  return moduleRecordCollection(activity, moduleKey);
}

/* -------------------------------------------------------------------------- */
/* Mass-assignment protection                                                  */
/* -------------------------------------------------------------------------- */

/** Fields a configuration editor may write. Everything else is derived. */
const WRITABLE_DEFINITION_KEYS = [
  "key",
  "name",
  "description",
  "icon",
  "activity",
  "templateKey",
  "lifecycle",
  "fields",
  "stages",
  "initialStage",
  "listConfig",
  "roleGrants",
  "allowPermanentDelete",
  "permissions",
] as const;

/** Audit/derived keys the client must never set on a definition. */
export const PROTECTED_DEFINITION_KEYS = [
  "id",
  "revision",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
] as const;

export const PROTECTED_RECORD_KEYS = [
  "id",
  "moduleKey",
  "code",
  "archived",
  "stageHistory",
  "revision",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "attachments",
] as const;

/** Drop anything the caller is not allowed to set (no silent coercion). */
export function sanitizeDefinitionInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE_DEFINITION_KEYS) {
    if (k in input) out[k] = input[k];
  }
  return out;
}

/**
 * Record writes carry ONLY values + an optional stage move. Identity, code,
 * archive flag, audit trail and revision are engine-owned, so any of them in
 * the payload is rejected rather than ignored (a caller trying to set them is
 * a bug or an attack, and both deserve a loud failure).
 */
export function splitRecordInput(payload: Record<string, unknown>): {
  values: Record<string, unknown>;
  status?: string;
} {
  for (const protectedKey of PROTECTED_RECORD_KEYS) {
    if (protectedKey in payload) {
      throw new Error(`protected_field:${protectedKey}`);
    }
  }
  const values = payload.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("record_values_required");
  }
  const status = payload.status;
  return {
    values: values as Record<string, unknown>,
    status: typeof status === "string" ? status : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Definition integrity                                                        */
/* -------------------------------------------------------------------------- */

export const ICON_ALLOW_LIST = [
  "Box",
  "ClipboardList",
  "FileText",
  "Users",
  "Calendar",
  "Receipt",
  "Wrench",
  "Stethoscope",
  "GraduationCap",
  "Building2",
  "Car",
  "Package",
  "Truck",
  "PawPrint",
  "Utensils",
  "Dumbbell",
  "Gavel",
  "Gem",
] as const;

export type IconName = (typeof ICON_ALLOW_LIST)[number];

function isBilingual(v: unknown): boolean {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { ar?: unknown }).ar === "string" &&
    typeof (v as { en?: unknown }).en === "string" &&
    (v as { ar: string }).ar.trim().length > 0 &&
    (v as { en: string }).en.trim().length > 0
  );
}

/**
 * Full structural validation of a definition. Run before every write so an
 * activated module is guaranteed renderable (a broken definition would
 * otherwise surface as a blank list or an unusable form).
 */
export function validateDefinition(def: Partial<CustomModuleDefinition>): FieldError[] {
  const errors: FieldError[] = [];
  const push = (fieldKey: string, reason: string, params?: Record<string, string | number>) =>
    errors.push({ fieldKey, reason, params });

  if (typeof def.key !== "string" || !isValidModuleKey(def.key)) {
    push("key", "invalidModuleKey");
  }
  if (!isBilingual(def.name)) push("name", "bilingualRequired");
  if (def.description !== undefined && !isBilingual(def.description)) {
    push("description", "bilingualRequired");
  }
  if (typeof def.icon !== "string" || !(ICON_ALLOW_LIST as readonly string[]).includes(def.icon)) {
    push("icon", "iconNotAllowed");
  }

  const fields = def.fields ?? [];
  if (!Array.isArray(fields) || fields.length === 0) push("fields", "noFields");
  const seenFields = new Set<string>();
  for (const f of fields) {
    if (!isValidFieldKey(f.key)) push(`field:${f.key}`, "invalidFieldKey");
    if (seenFields.has(f.key)) push(`field:${f.key}`, "duplicateFieldKey");
    seenFields.add(f.key);
    if (!isBilingual(f.label)) push(`field:${f.key}`, "bilingualRequired");
    if (f.help !== undefined && !isBilingual(f.help)) push(`field:${f.key}`, "bilingualRequired");
    if (!FIELD_TYPE_SET.includes(f.type)) {
      push(`field:${f.key}`, "unknownFieldType");
      continue;
    }
    if (f.type === "select" || f.type === "multiselect") {
      const opts = f.options ?? [];
      if (opts.length === 0) push(`field:${f.key}`, "optionsRequired");
      const seenOpts = new Set<string>();
      for (const o of opts) {
        if (!isValidFieldKey(o.key)) push(`field:${f.key}`, "invalidOptionKey", { option: o.key });
        if (seenOpts.has(o.key)) push(`field:${f.key}`, "duplicateOptionKey", { option: o.key });
        seenOpts.add(o.key);
        if (!isBilingual(o.label)) push(`field:${f.key}`, "bilingualRequired");
      }
    }
    if (f.type === "relation") {
      const rel = f.relation;
      if (!rel || !(RELATION_TARGET_SET as readonly string[]).includes(rel.target)) {
        push(`field:${f.key}`, "relationTargetRequired");
      } else if (rel.target === "module" && (!rel.moduleKey || !isValidModuleKey(rel.moduleKey))) {
        // A self reference (parent/child within the same module) is legal and
        // resolves to this key, so it needs no special case here.
        push(`field:${f.key}`, "relationModuleKeyRequired");
      }
    }
    if (f.minLen !== undefined && f.maxLen !== undefined && f.minLen > f.maxLen) {
      push(`field:${f.key}`, "minMaxLength");
    }
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
      push(`field:${f.key}`, "minMaxValue");
    }
  }

  const stages = def.stages ?? [];
  if (!Array.isArray(stages) || stages.length === 0) push("stages", "noStages");
  const seenStages = new Set<string>();
  for (const s of stages) {
    if (!isValidFieldKey(s.key)) push(`stage:${s.key}`, "invalidStageKey");
    if (seenStages.has(s.key)) push(`stage:${s.key}`, "duplicateStageKey");
    seenStages.add(s.key);
    if (!isBilingual(s.label)) push(`stage:${s.key}`, "bilingualRequired");
    for (const n of s.next ?? []) {
      if (!seenStages.has(n) && !stages.some((x) => x.key === n)) {
        push(`stage:${s.key}`, "unknownNextStage", { stage: n });
      }
    }
    if (s.terminal && (s.next ?? []).length > 0) {
      push(`stage:${s.key}`, "terminalHasNext");
    }
  }
  if (!def.initialStage || !seenStages.has(def.initialStage)) {
    push("initialStage", "unknownInitialStage");
  }

  const list = def.listConfig;
  if (!list) {
    push("listConfig", "listConfigRequired");
  } else {
    if (!seenFields.has(list.primaryField)) push("listConfig.primaryField", "unknownField");
    if (!seenFields.has(list.sortField)) push("listConfig.sortField", "unknownField");
    for (const c of list.columns ?? []) {
      if (!seenFields.has(c)) push("listConfig.columns", "unknownField", { field: c });
    }
    if (!Number.isInteger(list.pageSize) || list.pageSize < 5 || list.pageSize > 100) {
      push("listConfig.pageSize", "pageSizeRange");
    }
    if (list.sortDir !== "asc" && list.sortDir !== "desc") push("listConfig.sortDir", "invalidSortDir");
  }

  const grants = def.roleGrants;
  if (!grants) {
    push("roleGrants", "grantsRequired");
  } else {
    for (const action of ["view", "create", "update", "archive"] as const) {
      const roles = grants[action] ?? [];
      if (roles.length === 0) push(`roleGrants.${action}`, "grantsEmpty");
      for (const r of roles) {
        if (!(VALID_ROLES as readonly string[]).includes(r)) push(`roleGrants.${action}`, "unknownRole", { role: r });
      }
    }
    // Nobody can ever see the module if the admins are excluded from viewing.
    if (!grants.view.includes("admin") && !grants.view.includes("super_admin")) {
      push("roleGrants.view", "adminMustView");
    }
  }

  const perms = def.permissions;
  if (!perms) {
    push("permissions", "permissionsRequired");
  } else {
    for (const [action, value] of Object.entries(perms)) {
      if (!(ALL_PERMISSION_ATOMS as readonly string[]).includes(value)) {
        push(`permissions.${action}`, "unknownPermission", { permission: String(value) });
      }
    }
  }

  return errors;
}

const VALID_ROLES = ["super_admin", "admin", "manager", "employee", "viewer"] as const;
const RELATION_TARGET_SET: readonly RelationTarget[] = [
  "contact",
  "project",
  "task",
  "employee",
  "invoice",
  "module",
];
const FIELD_TYPE_SET: readonly ModuleFieldType[] = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "boolean",
  "select",
  "multiselect",
  "relation",
  "email",
  "phone",
  "url",
];

/**
 * The atoms a definition may bind its actions to. Deliberately a closed list
 * so a configuration cannot mint a permission the platform does not know.
 */
export const ALL_PERMISSION_ATOMS: readonly Permission[] = [
  "custom_modules.view",
  "custom_modules.create",
  "custom_modules.update",
  "custom_modules.archive",
  "custom_modules.manage_config",
  "facilities.view",
  "facilities.manage",
  "marketing.view",
  "marketing.manage",
  "real_estate.view",
  "real_estate.create",
  "projects.view",
  "projects.manage",
  "crm.view",
  "crm.manage_contacts",
  "tasks.view",
  "tasks.edit",
];

/* -------------------------------------------------------------------------- */
/* Field coercion + validation                                                 */
/* -------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d][\d\s-]{6,19}$/;
const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]{2,}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Coerce a raw form value into its stored form for the field type, or return
 * the machine reason. Dates stay ISO strings (the repo's storage convention),
 * currency/number become finite rounded numbers, selects must hit a declared
 * option, and unknown keys/values are refused instead of silently stored.
 */
export function coerceFieldValue(
  field: ModuleFieldDefinition,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string; params?: Record<string, string | number> } {
  const fail = (reason: string, params?: Record<string, string | number>) => ({ ok: false as const, reason, params });

  const empty =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "") ||
    (Array.isArray(raw) && raw.length === 0);
  if (empty) return { ok: true, value: null };

  switch (field.type) {
    case "text":
    case "email":
    case "phone":
    case "url": {
      if (typeof raw !== "string") return fail("notText");
      const v = raw.trim();
      if (field.minLen !== undefined && v.length < field.minLen) return fail("minLength", { min: field.minLen });
      if (field.maxLen !== undefined && v.length > field.maxLen) return fail("maxLength", { max: field.maxLen });
      if (field.type === "email" && !EMAIL_RE.test(v)) return fail("invalidEmail");
      if (field.type === "phone" && !PHONE_RE.test(v)) return fail("invalidPhone");
      if (field.type === "url" && !URL_RE.test(v)) return fail("invalidUrl");
      return { ok: true, value: v };
    }
    case "textarea": {
      if (typeof raw !== "string") return fail("notText");
      const v = raw.trim();
      const maxLen = field.maxLen ?? 5000;
      if (v.length > maxLen) return fail("maxLength", { max: maxLen });
      return { ok: true, value: v };
    }
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""));
      if (!Number.isFinite(n)) return fail("invalidNumber");
      const min = field.min ?? (field.type === "currency" ? 0 : Number.MIN_SAFE_INTEGER);
      const max = field.max ?? Number.MAX_SAFE_INTEGER;
      if (n < min) return fail("minValue", { min });
      if (n > max) return fail("maxValue", { max });
      return { ok: true, value: field.type === "currency" ? roundMoney(n) : n };
    }
    case "date": {
      const iso = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
      if (!ISO_DATE_RE.test(iso)) return fail("invalidDate");
      // Calendar-day check done arithmetically: parsing through local Date and
      // re-serialising via toISOString would reject perfectly valid dates for
      // users east of Greenwich (e.g. UTC+3 shifts the ISO date back one day).
      const [yy, mm, dd] = iso.split("-").map(Number);
      const daysInMonth = [31, (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
      if (mm < 1 || mm > 12 || dd < 1 || dd > daysInMonth) return fail("invalidDate");
      return { ok: true, value: iso };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "1") return { ok: true, value: true };
      if (raw === "false" || raw === "0") return { ok: true, value: false };
      return fail("invalidBoolean");
    }
    case "select": {
      const key = String(raw);
      const hit = (field.options ?? []).find((o) => o.key === key);
      if (!hit) return fail("unknownOption", { option: key });
      return { ok: true, value: hit.key };
    }
    case "multiselect": {
      const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const known = new Set((field.options ?? []).map((o) => o.key));
      const out: string[] = [];
      for (const item of list) {
        if (!known.has(item)) return fail("unknownOption", { option: item });
        if (!out.includes(item)) out.push(item);
      }
      return { ok: true, value: out };
    }
    case "relation": {
      const id = typeof raw === "string" ? raw.trim() : "";
      if (!id) return fail("relationRequired");
      if (id.length > 128 || /[./\[\]#]/.test(id)) return fail("invalidRelationId");
      return { ok: true, value: id };
    }
    default:
      return fail("unknownFieldType");
  }
}

/**
 * Validate a whole record payload against the definition: unknown keys are
 * rejected (they would otherwise be stored invisible and unvalidated),
 * required fields must be present, and every value is coerced by its type.
 */
export function validateRecordValues(
  def: CustomModuleDefinition,
  rawValues: Record<string, unknown>,
): { ok: true; values: Record<string, unknown>; errors: [] } | { ok: false; values: Record<string, unknown>; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const values: Record<string, unknown> = {};
  const byKey = new Map(def.fields.map((f) => [f.key, f]));

  for (const k of Object.keys(rawValues)) {
    if (!byKey.has(k)) errors.push({ fieldKey: k, reason: "unknownField" });
  }

  for (const field of def.fields) {
    const res = coerceFieldValue(field, rawValues[field.key]);
    if (!res.ok) {
      errors.push({ fieldKey: field.key, reason: res.reason, params: res.params });
      continue;
    }
    if (field.required && (res.value === null || res.value === undefined || res.value === "")) {
      errors.push({ fieldKey: field.key, reason: "required" });
      continue;
    }
    if (res.value !== null) values[field.key] = res.value;
  }

  return errors.length ? { ok: false, values, errors } : { ok: true, values, errors: [] };
}

/** Duplicate check for unique fields, ignoring the record being edited. */
export function findUniqueViolation(
  def: CustomModuleDefinition,
  records: Pick<ModuleRecord, "id" | "values" | "archived">[],
  fieldKey: string,
  value: unknown,
  selfId?: string,
): ModuleRecord | undefined {
  const field = def.fields.find((f) => f.key === fieldKey);
  if (!field?.unique || value === null || value === undefined) return undefined;
  return records.find(
    (r) => r.id !== selfId && !r.archived && String(r.values?.[fieldKey] ?? "") === String(value),
  ) as ModuleRecord | undefined;
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

export function canMoveStage(stages: ModuleStageDefinition[], from: string, to: string): boolean {
  if (from === to) return true;
  const current = stages.find((s) => s.key === from);
  if (!current || current.terminal) return false;
  return (current.next ?? []).includes(to);
}

export function isTerminalStage(stages: ModuleStageDefinition[], key: string): boolean {
  return !!stages.find((s) => s.key === key)?.terminal;
}

/* -------------------------------------------------------------------------- */
/* Access resolution                                                           */
/* -------------------------------------------------------------------------- */

export type ModuleAction = "view" | "create" | "update" | "archive";

/**
 * Effective module access = the global permission atom AND the definition's
 * role grant for that action. The atom is what Firestore rules also check, so
 * hiding a button and rejecting the write can never disagree.
 */
export function canPerformModuleAction(
  def: CustomModuleDefinition,
  action: ModuleAction,
  role: UserRole | undefined,
  hasPermission: (permission: Permission) => boolean,
): boolean {
  if (!role) return false;
  if (!hasPermission(def.permissions[action])) return false;
  return def.roleGrants[action].includes(role);
}

/** Whether the record list/detail page is renderable for this viewer. */
export function moduleVisibleTo(
  def: CustomModuleDefinition,
  role: UserRole | undefined,
  hasPermission: (permission: Permission) => boolean,
): boolean {
  return def.lifecycle === "active" && canPerformModuleAction(def, "view", role, hasPermission);
}

/* -------------------------------------------------------------------------- */
/* List view: search / filter / sort / paginate                                */
/* -------------------------------------------------------------------------- */

export interface ModuleListQuery {
  search?: string;
  status?: string | "all";
  includeArchived?: boolean;
  sortField?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

function searchHaystack(field: ModuleFieldDefinition, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.type === "multiselect") {
    const opts = (field.options ?? []).filter((o) => (value as string[]).includes(o.key));
    return opts.map((o) => `${o.label.ar} ${o.label.en} ${o.key}`).join(" ");
  }
  if (field.type === "select") {
    const o = (field.options ?? []).find((x) => x.key === value);
    return o ? `${o.label.ar} ${o.label.en} ${o.key}` : String(value);
  }
  if (field.type === "relation") {
    // The stored id is searchable; the resolved label is added by the caller
    // through relationLabels.
    return String(value);
  }
  if (field.type === "boolean") return value ? "true 1" : "false 0";
  return String(value);
}

export function queryRecords(
  def: CustomModuleDefinition,
  records: ModuleRecord[],
  q: ModuleListQuery,
  relationLabels: Record<string, string> = {},
): { rows: ModuleRecord[]; total: number; pages: number; page: number } {
  const term = (q.search ?? "").trim().toLowerCase();
  const searchable = def.fields.filter((f) => f.searchable);

  let rows = records.filter((r) => {
    if (q.includeArchived) return true;
    // Archived records stay reachable through the status filter only when
    // explicitly asked for; the default list hides them without deleting.
    return !r.archived;
  });

  if (q.status && q.status !== "all") rows = rows.filter((r) => r.status === q.status);

  if (term) {
    rows = rows.filter((r) => {
      if (r.code?.toLowerCase().includes(term)) return true;
      return searchable.some((f) => {
        const hay = searchHaystack(f, r.values?.[f.key]).toLowerCase();
        const labelled = f.type === "relation" ? `${hay} ${(relationLabels[String(r.values?.[f.key] ?? "")] ?? "").toLowerCase()}` : hay;
        return labelled.includes(term);
      });
    });
  }

  const sortFieldKey = q.sortField ?? def.listConfig.sortField;
  const sortField = def.fields.find((f) => f.key === sortFieldKey);
  const dir = (q.sortDir ?? def.listConfig.sortDir) === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => compareForSort(a, b, sortField, sortFieldKey, def, dir));

  const pageSize = Math.min(100, Math.max(5, q.pageSize ?? def.listConfig.pageSize));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, q.page ?? 1), pages);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, pages, page };
}

function compareForSort(
  a: ModuleRecord,
  b: ModuleRecord,
  field: ModuleFieldDefinition | undefined,
  fieldKey: string,
  def: CustomModuleDefinition,
  dir: number,
): number {
  if (fieldKey === "createdAt" || fieldKey === "updatedAt" || fieldKey === "code") {
    const av = String(a[fieldKey as keyof ModuleRecord] ?? "");
    const bv = String(b[fieldKey as keyof ModuleRecord] ?? "");
    return av.localeCompare(bv) * dir;
  }
  if (fieldKey === "status") {
    const order = def.stages.findIndex((s) => s.key === a.status);
    const other = def.stages.findIndex((s) => s.key === b.status);
    return (order - other) * dir;
  }
  const av = a.values?.[fieldKey];
  const bv = b.values?.[fieldKey];
  if (av === undefined || av === null) return 1;
  if (bv === undefined || bv === null) return -1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
  if (field?.type === "boolean") return (Number(!!av) - Number(!!bv)) * dir;
  const labelA = field?.type === "select" ? (field.options?.find((o) => o.key === av)?.label.en ?? String(av)) : String(av);
  const labelB = field?.type === "select" ? (field.options?.find((o) => o.key === bv)?.label.en ?? String(bv)) : String(bv);
  return labelA.localeCompare(labelB, undefined, { numeric: true }) * dir;
}

/* -------------------------------------------------------------------------- */
/* Display helpers (shared by table, detail and export)                        */
/* -------------------------------------------------------------------------- */

export function stageLabel(def: CustomModuleDefinition, key: string, lang: "ar" | "en"): string {
  const s = def.stages.find((x) => x.key === key);
  return s ? s.label[lang] : key;
}

export function stageColor(def: CustomModuleDefinition, key: string): string {
  return def.stages.find((x) => x.key === key)?.color ?? "default";
}

export function fieldLabel(field: ModuleFieldDefinition, lang: "ar" | "en"): string {
  return field.label[lang];
}

/** Type-aware, locale-aware rendering of a stored value. */
export function formatCellValue(
  field: ModuleFieldDefinition,
  value: unknown,
  lang: "ar" | "en",
  relationLabel?: string,
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "boolean":
      return value ? (lang === "ar" ? "نعم" : "Yes") : lang === "ar" ? "لا" : "No";
    case "currency":
      return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", {
        style: "currency",
        currency: "SAR",
        maximumFractionDigits: 2,
      }).format(Number(value));
    case "number":
      return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US").format(Number(value));
    case "date":
      return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium" }).format(
        new Date(String(value)),
      );
    case "select": {
      const o = (field.options ?? []).find((x) => x.key === value);
      return o ? o.label[lang] : String(value);
    }
    case "multiselect": {
      const keys = Array.isArray(value) ? value : [value];
      const opts = (field.options ?? []).filter((o) => keys.includes(o.key));
      return opts.length ? opts.map((o) => o.label[lang]).join(lang === "ar" ? "، " : ", ") : "—";
    }
    case "relation":
      return relationLabel ?? String(value);
    default:
      return String(value);
  }
}

/** Values a freshly created record starts with (defaults + initial stage). */
export function emptyRecordValues(def: CustomModuleDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (f.type === "boolean") values[f.key] = false;
    else if (f.type === "multiselect") values[f.key] = [];
  }
  return values;
}
