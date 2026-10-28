/**
 * Real Estate Management — shared Firestore service helpers.
 *
 * Every collection name comes from the shared activity-domain naming contract
 * (prefix `rem_`), so these writes land exactly in the collections the
 * Firestore rules gate by the tenant's authoritative REAL_ESTATE_MANAGEMENT
 * activity. The service layer additionally re-enforces the pure domain rules
 * (transition legality, money normalization, overlap checks) at write time —
 * the UI is never the only validator.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { domainCollection } from "@/features/activities/types/activity-domain";

/** The contract-derived, rules-gated collection names. Never hand-typed. */
export const REM_COLLECTIONS = {
  properties: domainCollection("REAL_ESTATE_MANAGEMENT", "properties"), // rem_properties
  buildings: domainCollection("REAL_ESTATE_MANAGEMENT", "buildings"), // rem_buildings
  units: domainCollection("REAL_ESTATE_MANAGEMENT", "units"), // rem_units
  ownerships: domainCollection("REAL_ESTATE_MANAGEMENT", "ownerships"), // rem_ownerships
  leases: domainCollection("REAL_ESTATE_MANAGEMENT", "leases"), // rem_leases
  installments: domainCollection("REAL_ESTATE_MANAGEMENT", "rent_installments"), // rem_rent_installments
  payments: domainCollection("REAL_ESTATE_MANAGEMENT", "rent_payments"), // rem_rent_payments
  deposits: domainCollection("REAL_ESTATE_MANAGEMENT", "security_deposits"), // rem_security_deposits
  expenses: domainCollection("REAL_ESTATE_MANAGEMENT", "property_expenses"), // rem_property_expenses
  inspections: domainCollection("REAL_ESTATE_MANAGEMENT", "inspections"), // rem_inspections
  handovers: domainCollection("REAL_ESTATE_MANAGEMENT", "handover_records"), // rem_handover_records
  meterReadings: domainCollection("REAL_ESTATE_MANAGEMENT", "meter_readings"), // rem_meter_readings
  documents: domainCollection("REAL_ESTATE_MANAGEMENT", "property_documents"), // rem_property_documents
} as const;

/** Firestore rejects `undefined` — strip before every write (repo convention). */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export const conv = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

/** Normalize a snapshot into a typed record with converted timestamps. */
export function normalize<T extends { id: string }>(
  id: string,
  data: Record<string, unknown> | undefined,
  dateFields: string[] = []
): T {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...d, id, createdAt: conv(d.createdAt) ?? "", updatedAt: conv(d.updatedAt) ?? "" };
  for (const f of dateFields) {
    if (f in d) out[f] = conv(d[f]);
  }
  return out as unknown as T;
}

/** Standard list: newest first, capped like the facilities module (300). */
export async function listCollection<T extends { id: string }>(
  companyId: string,
  name: string,
  extraFilters: QueryConstraint[] = []
): Promise<T[]> {
  const ref = collection(db, "companies", companyId, name);
  const constraints = [
    ...(extraFilters.length ? extraFilters : []),
    orderBy("createdAt", "desc"),
    limit(300),
  ];
  const q = query(ref, ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalize<T>(d.id, d.data()));
}

/** List without an orderBy (for filtered queries that lack a composite index). */
export async function listCollectionUnordered<T extends { id: string }>(
  companyId: string,
  name: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> {
  const ref = collection(db, "companies", companyId, name);
  const q = query(ref, ...constraints, limit(500));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalize<T>(d.id, d.data()));
}

/* -------------------------------------------------------------------------- */
/* Transactional code sequences (per-tenant, never reused)                    */
/* -------------------------------------------------------------------------- */

export interface SeqState {
  prefix: string;
  nextNumber: number;
  padding: number;
}

export const REM_SEQ_DEFAULTS = {
  property: { prefix: "PRP-", nextNumber: 1, padding: 4 } as SeqState,
  building: { prefix: "BLD-", nextNumber: 1, padding: 3 } as SeqState,
  unit: { prefix: "UNT-", nextNumber: 1, padding: 4 } as SeqState,
  lease: { prefix: "LSE-", nextNumber: 1, padding: 4 } as SeqState,
  inspection: { prefix: "INS-", nextNumber: 1, padding: 4 } as SeqState,
} as const;

export type RemSeqKind = keyof typeof REM_SEQ_DEFAULTS;

/**
 * Codes are allocated inside the caller's transaction from the tenant's
 * `settings/real_estate` counter — deterministic under concurrency because
 * the counter read/write participates in the transaction's conflict rules.
 */
export async function allocateRemCode(tx: Transaction, companyId: string, kind: RemSeqKind): Promise<string> {
  const settingsRef = doc(db, "companies", companyId, "settings", "real_estate");
  const snap = await tx.get(settingsRef);
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  const stored = (data as Record<string, unknown>).sequences as Record<string, Partial<SeqState>> | undefined;
  const seq: SeqState = { ...REM_SEQ_DEFAULTS[kind], ...(stored?.[kind] ?? {}) };
  const code = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
  tx.set(settingsRef, { sequences: { [kind]: { ...seq, nextNumber: seq.nextNumber + 1 } } }, { merge: true });
  return code;
}

/* -------------------------------------------------------------------------- */
/* Small primitives                                                           */
/* -------------------------------------------------------------------------- */

export async function getDocData(companyId: string, name: string, id: string): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(db, "companies", companyId, name, id));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}

export async function addRecord(companyId: string, name: string, data: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, "companies", companyId, name), stripUndefined({ ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  return ref.id;
}

export async function setRecordById(companyId: string, name: string, id: string, data: Record<string, unknown>, merge = false): Promise<void> {
  await setDoc(doc(db, "companies", companyId, name, id), stripUndefined({ ...data, updatedAt: serverTimestamp(), ...(merge ? {} : { createdAt: serverTimestamp() }) }), { merge });
}

export async function patchRecord(companyId: string, name: string, id: string, patch: Record<string, unknown>): Promise<void> {
  await updateDoc(doc(db, "companies", companyId, name, id), stripUndefined({ ...patch, updatedAt: serverTimestamp() }));
}

export async function removeRecord(companyId: string, name: string, id: string): Promise<void> {
  await deleteDoc(doc(db, "companies", companyId, name, id));
}

export { runTransaction, doc, collection, getDoc, getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp, setDoc, updateDoc, addDoc, deleteDoc };
export type { Transaction };
