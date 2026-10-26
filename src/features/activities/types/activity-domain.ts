/**
 * Phase 2 — activity-owned domain collection contract.
 *
 * The Firestore/Storage security boundary derives a record's owning activity
 * from the *collection name prefix* (never from a document field), so this map
 * is the single naming contract that BOTH the rules engine and every future
 * domain service must follow. It is intentionally duplicated in
 * `firestore.rules`/`storage.rules` (the rules language cannot import TS);
 * these two definitions are kept in sync by the emulator test suite, which
 * asserts that every prefix here resolves to the same owning activity as the
 * rules do.
 *
 * Why prefix-based (not field-based) authorization:
 * - A client could write `activity: "MEDICAL_CLINIC"` onto any document to try
 *   to escape its tenant's real activity. Deriving ownership from the server-
 *   known collection name makes that forgery inert.
 * - Any new domain collection is protected fail-closed the instant it is
 *   written, without editing security rules.
 *
 * PROJECTS is deliberately absent: it already persists in bare shared
 * collections (projects/tasks/sprints/…), so leaving it un-prefixed preserves
 * every existing tenant with zero regression.
 */

import type { ActivityId } from "./activity.types";

/** Reserved collection-name prefix → the activity that owns that namespace. */
export const DOMAIN_COLLECTION_PREFIX = {
  REAL_ESTATE_MANAGEMENT: "rem_",
  REAL_ESTATE_BROKERAGE: "reb_",
  FACILITIES_MANAGEMENT: "fm_",
  REAL_ESTATE_DEVELOPMENT: "rdv_",
  MARKETING_AGENCY: "mkt_",
  MEDICAL_CLINIC: "cln_",
  SCHOOL_MANAGEMENT: "sch_",
} as const satisfies Partial<Record<ActivityId, string>>;

/**
 * Domains whose records carry clinical/student sensitivity. Their access also
 * requires a least-privilege role (admin/manager/`domain.manage`) on top of the
 * activity gate — enforced identically in firestore.rules and storage.rules.
 */
export const SENSITIVE_DOMAIN_ACTIVITIES: readonly ActivityId[] = [
  "MEDICAL_CLINIC",
  "SCHOOL_MANAGEMENT",
];

export type DomainCollectionPrefix =
  (typeof DOMAIN_COLLECTION_PREFIX)[keyof typeof DOMAIN_COLLECTION_PREFIX];

/** Build a tenant-scoped domain collection path segment for a module entity. */
export function domainCollection(
  activity: keyof typeof DOMAIN_COLLECTION_PREFIX,
  entity: string,
): string {
  return `${DOMAIN_COLLECTION_PREFIX[activity]}${entity}`;
}

/** The activity that owns a given collection name, or null for shared data. */
export function owningActivityOfCollection(collection: string): ActivityId | null {
  for (const [activity, prefix] of Object.entries(DOMAIN_COLLECTION_PREFIX)) {
    if (collection.startsWith(prefix)) return activity as ActivityId;
  }
  return null;
}

export function isDomainCollection(collection: string): boolean {
  return owningActivityOfCollection(collection) !== null;
}

export function isSensitiveDomainCollection(collection: string): boolean {
  const owner = owningActivityOfCollection(collection);
  return owner !== null && SENSITIVE_DOMAIN_ACTIVITIES.includes(owner);
}
