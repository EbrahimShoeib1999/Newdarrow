import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardBody, Chip } from "@heroui/react";
import { CalendarDays, Megaphone, Send, Clock } from "lucide-react";
import { useCampaigns, useDeliverables, useContentItems, useExpenses } from "../hooks/use-marketing";
import { overdueDeliverables } from "../lib/deliverable-rules";
import { hasPendingRevision, isCampaignRunning, totalSpent } from "../lib/campaign-rules";
import { CAMPAIGN_STATUS_COLORS, CONTENT_STATUS_COLORS, DELIVERABLE_STATUS_COLORS } from "../lib/ui-maps";
import { todayIso } from "../lib/campaign-rules";

/**
 * Agency overview — every number derived from persisted mkt_ records only.
 * No estimated or mocked analytics anywhere.
 */
export function AgencyDashboardPage() {
  const { t } = useTranslation("marketing");
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: deliverables = [] } = useDeliverables();
  const { data: contentItems = [] } = useContentItems();
  const { data: expenses = [] } = useExpenses();

  const running = campaigns.filter((c) => isCampaignRunning(c.status));
  const pendingRevisions = campaigns.filter((c) => hasPendingRevision(c.budgetRevisions));
  const overdue = overdueDeliverables(deliverables);
  const today = todayIso();
  const publishingToday = contentItems.filter(
    (c) => c.status === "scheduled" && c.scheduledDate === today,
  );

  const stats = [
    {
      label: t("dashboard.activeCampaigns"),
      value: running.length,
      icon: Megaphone,
      tone: "text-primary",
      to: "/agency/campaigns",
    },
    {
      label: t("dashboard.pendingBudgetRevisions"),
      value: pendingRevisions.length,
      icon: Clock,
      tone: "text-warning",
      to: "/agency/campaigns",
    },
    {
      label: t("dashboard.overdueDeliverables"),
      value: overdue.length,
      icon: Send,
      tone: "text-danger",
      to: "/agency/deliverables",
    },
    {
      label: t("dashboard.publishingToday"),
      value: publishingToday.length,
      icon: CalendarDays,
      tone: "text-success",
      to: "/agency/content",
    },
  ];

  const recent = [...campaigns]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-default-900">{t("dashboard.title")}</h1>
        <p className="text-sm text-default-500 mt-1">{t("dashboard.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="hover:shadow-small transition-shadow">
            <CardBody>
              <Link to={s.to} className="flex items-center gap-3">
                <span className={`p-2 rounded-full bg-default-100 ${s.tone}`}>
                  <s.icon className="w-5 h-5" />
                </span>
                <span>
                  <span className="block text-2xl font-bold tabular-nums">{isLoading ? "…" : s.value}</span>
                  <span className="block text-xs text-default-500">{s.label}</span>
                </span>
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardBody className="p-0">
            <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-default-700">
              {t("dashboard.recentCampaigns")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm border-collapse">
                <tbody>
                  {recent.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-default-400">{t("dashboard.noCampaigns")}</td>
                    </tr>
                  ) : (
                    recent.map((c) => (
                      <tr key={c.id} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <Link to={`/agency/campaigns/${c.id}`} className="text-primary font-medium">
                            {c.name}
                          </Link>
                          <span className="text-xs text-default-400 ms-2">{c.code}</span>
                        </td>
                        <td className="px-4 py-2.5 text-xs tabular-nums text-default-500">
                          {totalSpent(expenses, c.id).toLocaleString()} / {c.budgetAmount.toLocaleString()} {c.currency}
                        </td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={CAMPAIGN_STATUS_COLORS[c.status]}>
                            {t(`campaignStatus.${c.status}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-0">
            <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-default-700">
              {t("dashboard.dueDeliverables")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm border-collapse">
                <tbody>
                  {overdue.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-default-400">{t("dashboard.noOverdue")}</td>
                    </tr>
                  ) : (
                    overdue.slice(0, 6).map((d) => (
                      <tr key={d.id} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">{d.title}</td>
                        <td className="px-4 py-2.5 text-xs text-danger tabular-nums">{d.dueDate}</td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={DELIVERABLE_STATUS_COLORS[d.status]}>
                            {t(`deliverableStatus.${d.status}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="p-0">
          <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-default-700">
            {t("dashboard.upcomingPublishing")}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm border-collapse">
              <tbody>
                {contentItems.filter((c) => c.status === "scheduled").length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-default-400">{t("dashboard.noScheduled")}</td>
                  </tr>
                ) : (
                  contentItems
                    .filter((c) => c.status === "scheduled")
                    .sort((a, b) => ((a.scheduledDate ?? "") < (b.scheduledDate ?? "") ? -1 : 1))
                    .slice(0, 6)
                    .map((c) => (
                      <tr key={c.id} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">{c.title}</td>
                        <td className="px-4 py-2.5 text-xs text-default-500">{c.scheduledDate}</td>
                        <td className="px-4 py-2.5 text-xs text-default-500">{t(`channel.${c.channel}`)}</td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={CONTENT_STATUS_COLORS[c.status]}>
                            {t(`contentStatus.${c.status}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
