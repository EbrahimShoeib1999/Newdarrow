/**
 * Automation Scanner Hook (Phase 9B).
 *
 * Mounted once in AppLayout (like useMeetingReminders) — checks pending
 * automations on an interval and fires them idempotently via fireOnce().
 * Covers: overdue tasks (B2), budget threshold (B3), invoice due/overdue (B6/B7).
 *
 * Event-driven rules (bill_review_needed, bill_status_changed, unit_status_changed)
 * are wired inline into the respective mutation hooks — they don't need a scanner.
 */

import { useEffect, useRef } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCompany } from "@/features/companies/context/company-context";
import { useAuthStore } from "@/stores/auth.store";
import { fireOnce } from "../api/automation.service";
import {
  overdueTaskAlerts,
  budgetThresholdAlert,
  invoiceDueAlerts,
} from "../lib/automation-predicates";

const SCAN_INTERVAL_MS = 120_000; // 2 minutes

/**
 * Run automation scans while the authenticated shell is mounted.
 * Each rule is deduplicated via fireOnce — if the same entity already fired
 * an alert today, the second scan simply skips it. Rules only produce
 * notifications, never mutate their source entity (no infinite loops).
 */
export function useAutomationScanner() {
  const { companyId } = useCompany();
  const userId = useAuthStore((s) => s.user?.id);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!companyId || !userId) return;

    const scan = async () => {
      try {
        // ---- Resolve managers/admins once per scan tick ----
        const usersSnap = await getDocs(
          query(collection(db, "users"), where("companyId", "==", companyId))
        );
        const users = usersSnap.docs.map((d) => ({
          id: d.id,
          role: (d.data().role as string) ?? "",
        }));
        const managers = users.filter((u) =>
          ["super_admin", "admin", "manager"].includes(u.role)
        );

        // ---- B2: Overdue tasks ----
        if (!inFlightRef.current.has("overdue-tasks")) {
          inFlightRef.current.add("overdue-tasks");
          try {
            const tasksSnap = await getDocs(
              collection(db, "companies", companyId, "tasks")
            );
            // Firestore doc data is untyped; cast through unknown for filter safety.
            const tasks: any[] = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const overdueTasks = tasks.filter((t) => t.status !== "done");
            const alerts = overdueTaskAlerts(overdueTasks as any, managers as any);
            for (const alert of alerts) {
              await fireOnce({
                companyId,
                ruleId: "overdue_task_notify_pm",
                entityId: alert.entityId,
                period: "day",
                notifications: alert.notifications,
              });
            }
          } finally {
            inFlightRef.current.delete("overdue-tasks");
          }
        }

        // ---- B3: Budget threshold (per project with linked contract) ----
        if (!inFlightRef.current.has("budget-threshold")) {
          inFlightRef.current.add("budget-threshold");
          try {
            const projectsSnap = await getDocs(
              collection(db, "companies", companyId, "projects")
            );
            const billsSnap = await getDocs(
              collection(db, "companies", companyId, "bills")
            );
            const contractsSnap = await getDocs(
              collection(db, "companies", companyId, "contracts")
            );

            for (const pSnap of projectsSnap.docs) {
              const pdata = pSnap.data();
              const cid = pdata.contractId as string | undefined;
              if (!cid) continue;
              const cSnap = contractsSnap.docs.find((c) => c.id === cid);
              if (!cSnap) continue;
              const cdata = cSnap.data();
              const contractValue =
                (cdata.totalValue as number) ?? (cdata.value as number) ?? 0;
              if (contractValue <= 0) continue;

              // Sum approved bills directly
              const totalApproved = billsSnap.docs
                .filter((b) => {
                  const bd = b.data();
                  return bd.projectId === pSnap.id && bd.approvalStatus === "approved";
                })
                .reduce((sum, b) => sum + ((b.data().grandTotal as number) ?? 0), 0);

              const alert = budgetThresholdAlert(
                {
                  projectId: pSnap.id,
                  totalApproved,
                  contractValue,
                  currency: (pdata.currency as string) ?? "SAR",
                },
                managers
              );
              if (alert) {
                await fireOnce({
                  companyId,
                  ruleId: "budget_threshold",
                  entityId: alert.entityId,
                  period: "day",
                  notifications: alert.notifications,
                });
              }
            }
          } finally {
            inFlightRef.current.delete("budget-threshold");
          }
        }

        // ---- B6/B7: Invoice due / overdue alerts ----
        if (!inFlightRef.current.has("invoice-due")) {
          inFlightRef.current.add("invoice-due");
          try {
            const invoicesSnap = await getDocs(
              collection(db, "companies", companyId, "invoices")
            );
            const allInvoices: any[] = invoicesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const invoices = allInvoices.filter((inv) =>
              ["pending", "sent", "overdue"].includes(inv.status as string)
            );
            const alerts = invoiceDueAlerts(invoices as any, managers, {
              warnWindow: 3,
            });
            for (const alert of alerts) {
              await fireOnce({
                companyId,
                ruleId: alert.ruleId,
                entityId: alert.entityId,
                period: "day",
                notifications: alert.notifications,
              });
            }
          } finally {
            inFlightRef.current.delete("invoice-due");
          }
        }
      } catch {
        // Swallow scan errors — next tick retries.
      }
    };

    void scan();
    const timer = window.setInterval(() => void scan(), SCAN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [companyId, userId]);
}
