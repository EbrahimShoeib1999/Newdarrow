import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { BarChart2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useAssets, useWorkOrders } from "../hooks/use-facilities";
import {
  isWorkOrderOverdue,
  todayIso,
  workOrderTotalCost,
} from "../lib/work-order-rules";
import { ASSET_CONDITION_COLORS, WO_STATUS_COLORS } from "../lib/ui-maps";
import type { AssetCategory, WorkOrderStatus } from "../types/facilities.types";

const BACKLOG_STATUSES: WorkOrderStatus[] = ["requested", "assigned", "in_progress", "on_hold"];
const CONDITIONS = ["good", "fair", "poor", "out_of_service"] as const;

export function ReportsPage() {
  const { t } = useTranslation("facilities");

  const { data: workOrders = [], isLoading } = useWorkOrders();
  const { data: assets = [] } = useAssets();

  const today = todayIso();

  /* Every figure below is DERIVED from stored records at render time — the
     report stores nothing, so it can never drift from the ledger. */
  const backlog = useMemo(() => {
    const map = new Map<WorkOrderStatus, number>();
    for (const w of workOrders) map.set(w.status, (map.get(w.status) ?? 0) + 1);
    return BACKLOG_STATUSES.map((s) => ({ status: s, count: map.get(s) ?? 0 }));
  }, [workOrders]);

  const overdueCount = useMemo(
    () => workOrders.filter((w) => isWorkOrderOverdue(w.dueDate, w.status, today)).length,
    [workOrders, today],
  );

  const completed = useMemo(() => workOrders.filter((w) => w.status === "completed"), [workOrders]);

  const costByMonth = useMemo(() => {
    const rows = new Map<string, { parts: number; labor: number; currency: string }>();
    for (const w of completed) {
      const month = (w.completedAt ?? w.createdAt).slice(0, 7);
      const cur = rows.get(month) ?? { parts: 0, labor: 0, currency: w.currency };
      cur.parts += w.partsCost;
      cur.labor += w.laborCost;
      rows.set(month, cur);
    }
    return [...rows.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([month, r]) => ({ month, ...r, total: workOrderTotalCost(r.parts, r.labor) }));
  }, [completed]);

  const spendByCategory = useMemo(() => {
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const map = new Map<AssetCategory, number>();
    for (const w of completed) {
      const asset = w.assetId ? assetById.get(w.assetId) : undefined;
      if (!asset) continue;
      map.set(asset.category, (map.get(asset.category) ?? 0) + workOrderTotalCost(w.partsCost, w.laborCost));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, amount]) => ({ category, amount }));
  }, [completed, assets]);

  const conditionSummary = useMemo(() => {
    const active = assets.filter((a) => a.lifecycle === "active");
    return CONDITIONS.map((c) => ({
      condition: c,
      count: active.filter((a) => a.condition === c).length,
    }));
  }, [assets]);

  const hasAny = !isLoading && workOrders.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <BarChart2 className="w-6 h-6 text-primary" />
          {t("reportsPage.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("reportsPage.subtitle")}</p>
      </div>

      {!isLoading && !hasAny && (
        <Card>
          <CardBody className="py-10 text-center text-sm text-default-400">{t("reportsPage.noData")}</CardBody>
        </Card>
      )}

      {hasAny && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="text-base font-semibold">{t("reportsPage.backlog")}</CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {backlog.map((b) => (
                      <tr key={b.status} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[b.status]}>
                            {t(`status.${b.status}`)}
                          </Chip>
                        </td>
                        <td className="px-4 py-2.5 text-end font-semibold tabular-nums">{b.count}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-default-200">
                      <td className="px-4 py-2.5 text-sm text-default-500">{t("reportsPage.overdueCard")}</td>
                      <td className="px-4 py-2.5 text-end">
                        <Chip size="sm" variant="flat" color={overdueCount > 0 ? "danger" : "success"}>
                          {overdueCount}
                        </Chip>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardBody>
            </Card>

            <Card>
              <CardHeader className="text-base font-semibold">{t("reportsPage.conditionCard")}</CardHeader>
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {conditionSummary.map((c) => (
                      <tr key={c.condition} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={ASSET_CONDITION_COLORS[c.condition]}>
                            {t(`assetCondition.${c.condition}`)}
                          </Chip>
                        </td>
                        <td className="px-4 py-2.5 text-end font-semibold tabular-nums">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="text-base font-semibold">{t("reportsPage.costByMonth")}</CardHeader>
            <CardBody className="p-0 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                    <th className="px-4 py-2.5 text-start">{t("reportsPage.colMonth")}</th>
                    <th className="px-4 py-2.5 text-end">{t("reportsPage.colParts")}</th>
                    <th className="px-4 py-2.5 text-end">{t("reportsPage.colLabor")}</th>
                    <th className="px-4 py-2.5 text-end">{t("reportsPage.colTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {costByMonth.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-default-400">
                        {t("reportsPage.noData")}
                      </td>
                    </tr>
                  ) : (
                    costByMonth.map((r) => (
                      <tr key={r.month} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5 font-medium" dir="ltr">{r.month}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums">{formatCurrency(r.parts, r.currency)}</td>
                        <td className="px-4 py-2.5 text-end tabular-nums">{formatCurrency(r.labor, r.currency)}</td>
                        <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                          {formatCurrency(r.total, r.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="text-base font-semibold">{t("reportsPage.spendByCategory")}</CardHeader>
            <CardBody className="p-0 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <tbody>
                  {spendByCategory.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm text-default-400">
                        {t("reportsPage.noData")}
                      </td>
                    </tr>
                  ) : (
                    spendByCategory.map((r) => (
                      <tr key={r.category} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">{t(`assetCategory.${r.category}`)}</td>
                        <td className="px-4 py-2.5 text-end font-semibold tabular-nums">
                          {formatCurrency(r.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
