/**
 * Event-driven automation wiring (Phase 9B: B4, B5, B12).
 *
 * These functions are called from within mutation onSuccess callbacks of the
 * existing hooks. They resolve recipients, then delegate to fireOnce for
 * idempotent notification creation. Kept fire-and-forget: automation failures
 * must NEVER break the user's mutation flow.
 */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fireOnce } from "../api/automation.service";
import {
  billReviewNeededAlert,
  billStatusChangedAlert,
  unitStatusChangedAlert,
} from "../lib/automation-predicates";
import type { Bill } from "@/features/billing/schemas/bill";
import type { ProjectUnit, UnitStatus } from "@/features/projects/types/unit.types";

/** Roles eligible to receive bill-review notifications (accountants + admins). */
const REVIEW_ROLES = ["super_admin", "admin", "manager"];

async function getCompanyUsers(companyId: string, roles?: string[]) {
  let q = query(collection(db, "users"), where("companyId", "==", companyId));
  // Firestore `in` supports at most 10 values; our role arrays are small.
  if (roles && roles.length > 0) {
    q = query(q, where("role", "in", roles));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id }));
}

/**
 * B4: When a bill is created as PENDING, notify accountants/admins that it
 * awaits their review. Only fires once per bill per period.
 */
export async function onBillCreated(companyId: string, bill: Bill): Promise<void> {
  try {
    const recipients = await getCompanyUsers(companyId, REVIEW_ROLES);
    const alert = billReviewNeededAlert(bill, recipients);
    if (!alert) return;
    await fireOnce({
      companyId,
      ruleId: "bill_review_needed",
      entityId: alert.entityId,
      period: "once",
      notifications: alert.notifications,
    });
  } catch {
    // Fire-and-forget: automation failures never interrupt the user workflow.
  }
}

/**
 * B5: When a bill's approvalStatus changes (approved/rejected), notify the
 * bill's creator/project team.
 */
export async function onBillApprovalChanged(
  companyId: string,
  bill: Bill,
  previousApproval: string | undefined
): Promise<void> {
  try {
    // Notify all company members (the bill creator is in there)
    const recipients = await getCompanyUsers(companyId);
    const alert = billStatusChangedAlert(bill, previousApproval, recipients);
    if (!alert) return;
    await fireOnce({
      companyId,
      ruleId: "bill_status_changed",
      entityId: alert.entityId,
      period: "hour",
      notifications: alert.notifications,
    });
  } catch {
    // fire-and-forget
  }
}

/**
 * B12: Notify project team when a real-estate unit changes status.
 * Only relevant when the module is enabled (i.e. unit transitions fire from UI).
 */
export async function onUnitStatusChanged(
  companyId: string,
  unit: ProjectUnit,
  from: UnitStatus,
  to: UnitStatus
): Promise<void> {
  try {
    // Notify project members (or all company admins/managers)
    const recipients = await getCompanyUsers(companyId, REVIEW_ROLES);
    const alert = unitStatusChangedAlert(unit, from, to, recipients);
    if (!alert) return;
    await fireOnce({
      companyId,
      ruleId: "unit_status_changed",
      entityId: alert.entityId,
      period: "hour",
      notifications: alert.notifications,
    });
  } catch {
    // fire-and-forget
  }
}
