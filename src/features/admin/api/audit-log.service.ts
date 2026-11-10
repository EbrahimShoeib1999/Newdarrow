import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { withLogging } from "@/lib/service-utils";

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  targetEntity: string;
  targetId?: string;
  companyId?: string;
  timestamp: string;
  details?: Record<string, unknown>;
  result: "SUCCESS" | "FAILURE" | "DENIED";
}

const SERVICE_NAME = "AuditLogService";

export const AuditLogService = {
  async record(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    return withLogging(SERVICE_NAME, "record", (async () => {
      const logId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const logRef = doc(db, "audit_logs", logId);

      const payload = {
        ...entry,
        timestamp: new Date().toISOString(),
        createdAt: serverTimestamp(),
      };

      await setDoc(logRef, payload);

      if (entry.companyId) {
        try {
          const compLogRef = doc(db, "companies", entry.companyId, "audit_logs", logId);
          await setDoc(compLogRef, payload);
        } catch {
          // company-specific log best-effort mirror
        }
      }
    })());
  },

  async listRecent(maxEntries: number = 50): Promise<AuditLogEntry[]> {
    return withLogging(SERVICE_NAME, "listRecent", (async () => {
      const q = query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(maxEntries));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AuditLogEntry, "id">),
      }));
    })());
  },
};

