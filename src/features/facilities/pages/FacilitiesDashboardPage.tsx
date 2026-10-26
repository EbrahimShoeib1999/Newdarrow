import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { Building, Package, Wrench, CalendarClock, Coins } from "lucide-react";
import { useAssets, usePmSchedules, useWorkOrders } from "../hooks/use-facilities";
import {
  isWorkOrderOverdue,
  scheduleNeedsWorkOrder,
  scheduleDueState,
  workOrderTotalCost,
  todayIso,
  addDaysIso,
} from "../lib/work-order-rules";
import { WO_STATUS_COLORS, DUE_STATE_COLORS } from "../lib/ui-maps";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Facilities dashboard — every number is derived from persisted records
 * (work orders, schedules, assets); nothing is mocked or estimated.
 */
export function FacilitiesDashboardPage() {
  const { t } = useTranslation("facilities");
  const { data: workOrders = [], isLoading } = useWorkOrders();
  const { data: schedules = [] } = usePmSchedules();
  const { data: assets = [] } = useAssets();

  const stats = useMemo(() => {
    const today = todayIso();
    const monthAgo = addDaysIso(today, -30);
    const open = workOrders.filter((w) => w.status !== "completed" && w.status !== "cancelled");
    const overdue = open.filter((w) => isWorkOrderOverdue(w.dueDate, w.status, today));
    const due = schedules.filter((s) =>
      scheduleNeedsWorkOrder({ nextDueDate: s.nextDueDate, active: s.active }, today),
    );
    const spend30 = workOrders
      .filter((w) => w.status === "completed" && (w.completedAt ?? "").slice(0, 10) >= monthAgo)
      .reduce((sum, w) => sum + workOrderTotalCost(w.partsCost, w.laborCost), 0);
    return {
      openCount: open.length,
      overdueCount: overdue.length,
      dueCount: due.length,
      activeAssets: assets.filter((a) => a.lifecycle === "active").length,
      spend30,
      dueSchedules: due,
    };
  }, [workOrders, schedules, assets]);

  const recent = useMemo(
    () =>
      workOrders
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 6),
    [workOrders],
  );

  const kpis = [
    { label: t("dashboard.openWos"), value: String(stats.openCount), icon: Wrench, to: "/facilities/work-orders" },
    { label: t("dashboard.overdueWos"), value: String(stats.overdueCount), icon: CalendarClock, to: "/facilities/work-orders" },
    { label: t("dashboard.dueSchedules"), value: String(stats.dueCount), icon: CalendarClock, to: "/facilities/schedules" },
    { label: t("dashboard.activeAssets"), value: String(stats.activeAssets), icon: Package, to: "/facilities/assets" },
    { label: t("dashboard.spend30"), value: formatCurrency(stats.spend30), icon: Coins, to: "/facilities/reports" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <Building className="w-6 h-6 text-primary" />
          {t("dashboard.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <Link key={kpi.label} to={kpi.to}>
            <Card className="border border-default-100 hover:border-primary/40 transition-colors">
              <CardBody className="p-4 gap-1">
                <div className="flex items-center gap-2 text-default-400">
                  <kpi.icon className="w-4 h-4" />
                  <span className="text-xs">{kpi.label}</span>
                </div>
                <span className="text-2xl font-bold text-default-900 tabular-nums">
                  {isLoading ? "—" : kpi.value}
                </span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-base font-semibold">{t("dashboard.recentWos")}</CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.dueDate")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-default-400">
                      {t("dashboard.noOpen")}
                    </td>
                  </tr>
                ) : (
                  recent.map((wo) => (
                    <tr key={wo.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <Link to={`/facilities/work-orders/${wo.id}`} className="text-primary text-sm font-medium">
                          {wo.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm max-w-[220px] truncate">{wo.title}</td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[wo.status]}>
                          {t(`status.${wo.status}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(wo.dueDate)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-base font-semibold">{t("dashboard.dueSchedulesCard")}</CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.nextDue")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.dueSchedules.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-default-400">
                      {t("dashboard.noDue")}
                    </td>
                  </tr>
                ) : (
                  stats.dueSchedules.map((s) => {
                    const state = scheduleDueState(s.nextDueDate);
                    return (
                      <tr key={s.id} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <Link to="/facilities/schedules" className="text-primary text-sm font-medium">
                            {s.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(s.nextDueDate)}</td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={DUE_STATE_COLORS[state]}>
                            {t(`dueState.${state}`)}
                          </Chip>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
