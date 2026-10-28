/**
 * Custom Business Modules Engine — shared types.
 *
 * The engine turns an authorized administrator's configuration into a working
 * CRUD module WITHOUT a code change, while every built-in activity module keeps
 * its own hand-written domain pages. Both layers obey the same platform
 * contracts:
 * - persistence stays inside `companies/{companyId}/…` (tenant boundary);
 * - record collections carry the owning activity in their NAME, exactly like
 *   the fixed `rem_`/`fm_`/`mkt_` prefixes (see activity-domain.ts), so a
 *   forged `activity` field on a document can never widen access;
 * - definitions live in `companies/{companyId}/module_definitions/{key}` and
 *   are writable only through the configuration permission.
 */

import type { ActivityId } from "@/features/activities/types/activity.types";
import type { UserRole } from "@/features/auth/types/auth.types";
import type { Permission } from "@/lib/permissions";

/** Bilingual label pair — Arabic-first display with English support. */
export interface BilingualText {
  ar: string;
  en: string;
}

/** Field types the engine can render and validate safely. */
export type ModuleFieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "boolean"
  | "select"
  | "multiselect"
  | "relation"
  | "email"
  | "phone"
  | "url";

export const MODULE_FIELD_TYPES: readonly ModuleFieldType[] = [
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

/** Core records a configurable entity may reference (reused, never copied). */
export type RelationTarget =
  | "contact"
  | "project"
  | "task"
  | "employee"
  | "invoice"
  | "module";

export const RELATION_TARGETS: readonly RelationTarget[] = [
  "contact",
  "project",
  "task",
  "employee",
  "invoice",
  "module",
];

export interface ModuleFieldOption {
  key: string;
  label: BilingualText;
}

export interface ModuleRelationConfig {
  target: RelationTarget;
  /** Required when target is "module": the referenced module's key. */
  moduleKey?: string;
}

/** One configurable field: label, validation and layout participation. */
export interface ModuleFieldDefinition {
  key: string;
  type: ModuleFieldType;
  label: BilingualText;
  help?: BilingualText;
  required: boolean;
  /** Shown as a column in the list view (order comes from listConfig.columns). */
  showInList: boolean;
  /** Included in the free-text search over the list. */
  searchable: boolean;
  /** Reject a value already used by another (non-archived) record. */
  unique?: boolean;
  minLen?: number;
  maxLen?: number;
  min?: number;
  max?: number;
  options?: ModuleFieldOption[];
  relation?: ModuleRelationConfig;
}

/** One configurable lifecycle stage and the stages it may move to. */
export interface ModuleStageDefinition {
  key: string;
  label: BilingualText;
  /** HeroUI chip color name, purely presentational. */
  color?: string;
  /** Terminal stages accept no outgoing transition. */
  terminal?: boolean;
  next: string[];
}

/** Per-module role grants layered ON TOP of the global permission atoms. */
export interface ModuleRoleGrants {
  view: UserRole[];
  create: UserRole[];
  update: UserRole[];
  archive: UserRole[];
}

export interface ModuleListConfig {
  /** Field whose value links to the record detail page. */
  primaryField: string;
  /** Field keys rendered as columns, in order. */
  columns: string[];
  sortField: string;
  sortDir: "asc" | "desc";
  pageSize: number;
}

export type ModuleLifecycle = "draft" | "active" | "archived";

/** The persisted configuration document (companies/{id}/module_definitions). */
export interface CustomModuleDefinition {
  key: string;
  name: BilingualText;
  description?: BilingualText;
  /** Lucide icon name from the engine's allow-list (never free text). */
  icon: string;
  /** Informational copy of the owning activity; the collection name rules. */
  activity: ActivityId;
  /** Template the module was instantiated from, when any. */
  templateKey?: string;
  lifecycle: ModuleLifecycle;
  fields: ModuleFieldDefinition[];
  stages: ModuleStageDefinition[];
  initialStage: string;
  listConfig: ModuleListConfig;
  roleGrants: ModuleRoleGrants;
  /** Permanent deletion stays opt-in; archiving is always available. */
  allowPermanentDelete: boolean;
  /** Action atoms gating this module beyond the tenant/activity boundary. */
  permissions: {
    view: Permission;
    create: Permission;
    update: Permission;
    archive: Permission;
  };
  revision: number;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

/** One record of a configurable module. */
export interface ModuleRecord {
  id: string;
  moduleKey: string;
  /** Human-readable reference, allocated transactionally when configured. */
  code?: string;
  values: Record<string, unknown>;
  status: string;
  archived: boolean;
  stageHistory: ModuleStageChange[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  /** Attachment descriptors (files themselves live in Firebase Storage). */
  attachments?: ModuleAttachment[];
}

export interface ModuleStageChange {
  from: string;
  to: string;
  at: string;
  by: string;
  note?: string;
}

/** Attachment descriptor stored on the record (files live in Storage). */
export interface ModuleAttachment {
  id: string;
  name: string;
  path: string;
  url: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface ModuleRecordInput {
  values: Record<string, unknown>;
  status?: string;
}

/** Field-level validation result shared by the form and the service layer. */
export interface FieldError {
  fieldKey: string;
  /** Machine reason, translated by the UI (custom_modules.errors.*). */
  reason: string;
  params?: Record<string, string | number>;
}
