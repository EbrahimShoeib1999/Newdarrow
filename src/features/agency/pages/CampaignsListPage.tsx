import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem } from "@heroui/react";
import { Megaphone, Plus, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { selectFieldProps } from "@/components/shared/select-field";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import { useCampaigns, useDeleteCampaignMutation, useExpenses } from "../hooks/use-marketing";
import { CAMPAIGN_STATUS_COLORS } from "../lib/ui-maps";
import { totalSpent } from "../lib/campaign-rules";
import { CampaignFormModal } from "../components/CampaignFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Campaign, CampaignStatus } from "../types/marketing.types";

const CAMPAIGN_STATUSES: CampaignStatus[] = [
  "draft",
  "approved",
  "active",
  "paused",
  "completed",
  "cancelled",
];

export function CampaignsListPage() {
  const { t } = useTranslation("marketing");
  const { can } = useAppPermissions();
  const canManage = can("marketing.manage");
  const canDelete = can("marketing.delete");

  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: expenses = [] } = useExpenses();
  const { data: contactsRes } = useContactsQuery();
  const deleteCampaign = useDeleteCampaignMutation();

  const clientName = (id: string) => {
    const c = (contactsRes?.data ?? []).find((x) => x.id === id);
    return c ? contactDisplayName(c) : t("misc.removedRef");
  };

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "">("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns.filter(
      (c) =>
        (!statusFilter || c.status === statusFilter) &&
        (!term ||
          c.name.toLowerCase().includes(term) ||
          c.code.toLowerCase().includes(term) ||
          clientName(c.clientId).toLowerCase().includes(term)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, search, statusFilter, contactsRes]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" />
            {t("campaigns.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("campaigns.subtitle")}</p>
        </div>
        {canManage && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("buttons.newCampaign")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-sm"
        />
        <Select
          {...selectFieldProps({ compact: true })}
          placeholder={t("filters.allStatuses")}
          selectedKeys={statusFilter ? [statusFilter] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as CampaignStatus | undefined;
            setStatusFilter(v ?? "");
          }}
          className="max-w-[180px]"
        >
          {CAMPAIGN_STATUSES.map((s) => (
            <SelectItem key={s} textValue={t(`campaignStatus.${s}`)}>
              {t(`campaignStatus.${s}`)}
            </SelectItem>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.client")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.budgetAmount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.spent")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.period")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">
                    …
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("campaigns.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const spent = totalSpent(expenses, c.id);
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-default-100 last:border-0 hover:bg-default-50/60"
                    >
                      <td className="px-4 py-2.5 text-xs text-default-500 tabular-nums">{c.code}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/agency/campaigns/${c.id}`} className="text-primary font-medium text-sm">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-default-600">{clientName(c.clientId)}</td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={CAMPAIGN_STATUS_COLORS[c.status]}>
                          {t(`campaignStatus.${c.status}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums">
                        {c.budgetAmount.toLocaleString()} {c.currency}
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums">
                        <span className={spent > c.budgetAmount ? "text-danger font-medium" : ""}>
                          {spent.toLocaleString()} {c.currency}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-default-500">
                        {c.startDate || "—"} → {c.endDate || "—"}
                      </td>
                      {(canManage || canDelete) && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-end">
                          {canManage && (
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                          )}
                          {canDelete && c.status === "draft" && (
                            <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(c)}>
                              {t("buttons.delete")}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <CampaignFormModal isOpen={formOpen} onOpenChange={setFormOpen} campaign={editing} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("campaigns.title")}
        body={deleting ? `${deleting.code} — ${t("campaigns.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteCampaign.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteCampaign.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
