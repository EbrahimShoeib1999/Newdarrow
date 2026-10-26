import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader, Chip, Progress } from "@heroui/react";
import { BarChart2 } from "lucide-react";
import { useInvoices } from "@/features/billing/hooks/use-invoices";
import { useCampaigns, useDeliverables, useExpenses } from "../hooks/use-marketing";
import { computeBudgetVsActual, computeDeliverySummary } from "../lib/campaign-rules";
import type { DeliverableStatus, InvoiceRevenueLike } from "../types/marketing.types";
import { DELIVERABLE_STATUS_COLORS } from "../lib/ui-maps";

const DELIVERABLE_STATUS_ORDER: DeliverableStatus[] = [
  "not_started",
  "in_progress",
  "in_review",
  "revision_requested",
  "approved",
  "published",
  "cancelled",
];

/**
 * Campaign reports — every figure is derived from persisted mkt_ records plus
 * shared billing invoices that reference a campaign. No synthetic analytics.
 */
export function AgencyReportsPage() {
  const { t } = useTranslation("marketing");

  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: expenses = [] } = useExpenses();
  const { data: deliverables = [] } = useDeliverables();
  const { data: invoices = [] } = useInvoices();

  // Billing invoices stay the single source of revenue: map read-only into the
  // report shape without copying amounts anywhere.
  const revenueInvoices: InvoiceRevenueLike[] = useMemo(
    () =>
      invoices.map((inv) => ({
        id: inv.id ?? "",
        campaignId: inv.campaignId ?? null,
        status: inv.status,
        grandTotal: inv.grandTotal,
        amountPaid: inv.amountPaid ?? 0,
        currency: inv.currency,
      })),
    [invoices],
  );

  const budgetRows = useMemo(
    () => campaigns.map((c) => computeBudgetVsActual(c, expenses, revenueInvoices)),
    [campaigns, expenses, revenueInvoices],
  );

  const delivery = useMemo(() => computeDeliverySummary(deliverables), [deliverables]);
  const pendingApprovals = deliverables.filter(
    (d) => d.clientApprovalState === "pending" && d.status !== "cancelled",
  ).length;

  const totals = useMemo(() => {
    const budget = budgetRows.reduce((s, r) => s + r.budget, 0);
    const spent = budgetRows.reduce((s, r) => s + r.spent, 0);
    const invoiced = budgetRows.reduce((s, r) => s + r.invoiced, 0);
    const collected = budgetRows.reduce((s, r) => s + r.collected, 0);
    return { budget, spent, invoiced, collected };
  }, [budgetRows]);

  const money = (v: number, currency?: string) =>
    `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-primary" />
          {t("reports.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("reports.subtitle")}</p>
      </div>

      {/* Budget vs actual — one row per persisted campaign */}
      <Card>
        <CardHeader className="pb-0">{t("reports.budgetVsActual")}</CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.budgetAmount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.spent")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.remaining")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.utilization")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.invoiced")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.collected")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : budgetRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("reports.empty")}
                  </td>
                </tr>
              ) : (
                budgetRows.map((r) => (
                  <tr key={r.campaignId} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.code}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {r.name}
                      {r.overBudget && (
                        <Chip size="sm" variant="flat" color="danger" className="ms-2">
                          {t("reports.overBudget")}
                        </Chip>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{money(r.budget)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{money(r.spent)}</td>
                    <td className={`px-4 py-2.5 tabular-nums ${r.remaining < 0 ? "text-danger font-medium" : ""}`}>
                      {money(r.remaining)}
                    </td>
                    <td className="px-4 py-2.5 min-w-[120px]">
                      <Progress
                        size="sm"
                        value={Math.min(r.utilization * 100, 100)}
                        color={r.overBudget ? "danger" : r.utilization >= 0.8 ? "warning" : "primary"}
                        aria-label={t("fields.utilization")}
                      />
                      <span className="text-xs text-default-500 tabular-nums">
                        {(r.utilization * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{money(r.invoiced)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{money(r.collected)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {budgetRows.length > 0 && (
              <tfoot>
                <tr className="border-t border-default-300 bg-default-50/80 font-semibold text-xs">
                  <td className="px-4 py-2.5" colSpan={2}>{t("reports.total")}</td>
                  <td className="px-4 py-2.5 tabular-nums">{money(totals.budget)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{money(totals.spent)}</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 tabular-nums">{money(totals.invoiced)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{money(totals.collected)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardBody>
      </Card>

      {/* Delivery summary — pipeline counts from persisted deliverables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-0">{t("reports.deliveryTitle")}</CardHeader>
          <CardBody className="gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-default-200 p-3">
                <p className="text-xs text-default-500">{t("reports.totalDeliverables")}</p>
                <p className="text-xl font-bold tabular-nums">{delivery.total}</p>
              </div>
              <div className="rounded-lg border border-default-200 p-3">
                <p className="text-xs text-default-500">{t("reports.overdue")}</p>
                <p className={`text-xl font-bold tabular-nums ${delivery.overdue > 0 ? "text-danger" : ""}`}>
                  {delivery.overdue}
                </p>
              </div>
              <div className="rounded-lg border border-default-200 p-3">
                <p className="text-xs text-default-500">{t("reports.onTime")}</p>
                <p className="text-xl font-bold tabular-nums text-success">{delivery.completedOnTime}</p>
              </div>
              <div className="rounded-lg border border-default-200 p-3">
                <p className="text-xs text-default-500">{t("reports.late")}</p>
                <p className="text-xl font-bold tabular-nums text-warning">{delivery.completedLate}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {DELIVERABLE_STATUS_ORDER.map((s) => (
                <Chip key={s} size="sm" variant="flat" color={DELIVERABLE_STATUS_COLORS[s]}>
                  {t(`deliverableStatus.${s}`)}: {delivery.byStatus[s]}
                </Chip>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="pb-0">{t("reports.clientApprovals")}</CardHeader>
          <CardBody className="gap-3">
            <div className="rounded-lg border border-default-200 p-3">
              <p className="text-xs text-default-500">{t("reports.awaitingApproval")}</p>
              <p className={`text-xl font-bold tabular-nums ${pendingApprovals > 0 ? "text-warning" : "text-success"}`}>
                {pendingApprovals}
              </p>
            </div>
            <p className="text-xs text-default-400">{t("reports.dataSourceNote")}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
