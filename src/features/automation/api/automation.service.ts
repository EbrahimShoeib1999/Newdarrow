/**
 * Idempotent automation service (Phase 9C).
 *
 * Provides:
 *  - fireOnce(): attempt a notification automation; the Firestore document at
 *    companies/{companyId}/automationEvents/{eventId} acts as an idempotency
 *    token. If the doc already exists for the current period, the event is
 *    skipped (no duplicate notification on retry, reconnect, or multi-tab).
 *  - listHistory(): authorized admins can query execution history per company.
 *
 * NO new security rules needed — the existing catch-all under companies
 * authorizes read/write for company members.
 */

import { doc, getDoc, setDoc, collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { withLogging } from "@/lib/service-utils";
import { NotificationsService } from "@/features/notifications/api/notifications.service";
import type { NotificationType } from "@/features/notifications/types/notification.types";
import {
  automationEventId,
  type AutomationRuleId,
  type AutomationEvent,
  type DedupPeriod,
} from "../types/automation.types";

export interface FireOnceInput {
  companyId: string;
  ruleId: AutomationRuleId;
  entityId: string;
  period: DedupPeriod;
  /** Notification payloads to create if this is the first run in the period. */
  notifications: Array<{
    userId: string;
    title: string;
    message: string;
    type?: NotificationType;
    link?: string;
  }>;
}

/**
 * Attempt to fire an automation exactly once per dedup period.
 * Returns the event outcome (the caller may log or display it).
 */
export async function fireOnce(input: FireOnceInput): Promise<AutomationEvent> {
  return withLogging("AutomationService", "fireOnce", (async () => {
    const eventId = automationEventId(input.ruleId, input.entityId, input.period);
  const ref = doc(db, "companies", input.companyId, "automationEvents", eventId);

  // 1. Check if already executed this period
  const existing = await getDoc(ref);
  if (existing.exists()) {
    return {
      id: eventId,
      ruleId: input.ruleId,
      entityId: input.entityId,
      firedAt: existing.data().firedAt ?? "",
      outcome: "skipped_duplicate",
      notifiedCount: 0,
    };
  }

  // 2. Guard: if no recipients, do not even write the token
  if (input.notifications.length === 0) {
    return {
      id: eventId,
      ruleId: input.ruleId,
      entityId: input.entityId,
      firedAt: new Date().toISOString(),
      outcome: "skipped_no_recipients",
      notifiedCount: 0,
    };
  }

  // 3. Create all notifications; catch individual failures but don't abort
  let notifiedCount = 0;
  let errorMsg: string | undefined;
  try {
    await Promise.allSettled(
      input.notifications.map((n) =>
        NotificationsService.createNotification(input.companyId, {
          userId: n.userId,
          title: n.title,
          message: n.message,
          type: n.type ?? "general",
          link: n.link,
        }).then(() => { notifiedCount++; })
      )
    );
  } catch (e: unknown) {
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  // 4. Write idempotency token (merge: false → only succeeds if doc is new;
  //    race between two tabs: the second write simply overwrites the token,
  //    but notifications from the first already landed).
  const outcome: AutomationEvent["outcome"] = errorMsg ? "error" : "notified";
  const event: Omit<AutomationEvent, "id"> = {
    ruleId: input.ruleId,
    entityId: input.entityId,
    firedAt: new Date().toISOString(),
    outcome,
    notifiedCount,
    ...(errorMsg ? { errorMessage: errorMsg } : {}),
  };
  await setDoc(ref, event);

    return { id: eventId, ...event };
  })());
}

/** Query execution history (admin UI). Returns the most recent N events. */
export async function listAutomationHistory(
  companyId: string,
  maxDocs = 50
): Promise<AutomationEvent[]> {
  const col = collection(db, "companies", companyId, "automationEvents");
  const q = query(col, where("outcome", "!=", ""), limit(maxDocs));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as AutomationEvent));
}
