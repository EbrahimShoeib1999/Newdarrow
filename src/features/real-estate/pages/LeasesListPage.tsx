import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Plus, ScrollText, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatDate, formatCurrency } from "@/lib/utils";
import { RemSelect } from "../components/RemSelect";
import { useLeases, useProperties } from "../hooks/use-real-estate";
import { LEASE_STATUS_COLORS } from "../lib/ui-maps";
import { LeaseFormModal } from "../components/LeaseFormModal";
import type { Lease, LeaseStatus } from "../types/real-estate.types";

const STATUS_OPTIONS: LeaseStatus[] = [
  "draft",
  "pending_approval",
  "active",
  "expiring",
  "renewed",
  "expired",
  "terminated",
  "cancelled",
];

export function LeasesListPage() {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canCreate = can("real_estate.create");

  const { data: leases = [], isLoading } = useLeases();
  const { data: properties = [] } = useProperties();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lease | null>(null);

  const unitLabel = (lease: Lease) => {
    const p = properties.find((x) => x.id === lease.propertyId);
    return p ? `${p.code}${lease.unitId ? " · " + lease.unitId.slice(0, 6) : ""}` : "—";
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leases.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (!term) return true;
      const p = properties.find((x) => x.id === l.propertyId);
      return (
        l.contractNumber.toLowerCase().includes(term) ||
        (l.tenantDisplayNameSnapshot ?? "").toLowerCase().includes(term) ||
        (p?.nameEn ?? "").toLowerCase().includes(term) ||
        (p?.nameAr ?? "").toLowerCase().includes(term)
      );
    });
  }, [leases, search, statusFilter, properties]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary" />
            {t("leasesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("leasesPage.subtitle")}</p>
        </div>
        {canCreate && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("buttons.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-xs w-full"
        />
        <div className="w-52">
          <RemSelect
            label={t("leasesPage.filterStatus")}
            value={statusFilter}
            onChange={setStatusFilter}
            placeholderKey={t("misc.all")}
            options={STATUS_OPTIONS.map((s) => ({ id: s, label: t(`leaseStatus.${s}`) }))}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.contract")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.property")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.tenant")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.date")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.rentAmount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                {canCreate && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">
                    …
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("leasesPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((l) => (
                  <tr key={l.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5">
                      <Link to={`/real-estate/leases/${l.id}`} className="text-primary font-medium text-xs font-mono">
                        {l.contractNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-default-500">{unitLabel(l)}</td>
                    <td className="px-4 py-2.5 text-sm">{l.tenantDisplayNameSnapshot || "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">
                      {formatDate(l.startDate)} → {formatDate(l.endDate)}
                    </td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">
                      {formatCurrency(l.rentAmount, l.currency)} / {t(`frequency.${l.frequency}`)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={LEASE_STATUS_COLORS[l.status]}>
                        {t(`leaseStatus.${l.status}`)}
                      </Chip>
                    </td>
                    {canCreate && (l.status === "draft" || l.status === "pending_approval") && (
                      <td className="px-4 py-2.5 text-end">
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            setEditing(l);
                            setFormOpen(true);
                          }}
                        >
                          {t("buttons.edit")}
                        </Button>
                      </td>
                    )}
                    {canCreate && l.status !== "draft" && l.status !== "pending_approval" && <td className="px-4 py-2.5" />}
                    {!canCreate && <td className="px-4 py-2.5" />}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <LeaseFormModal isOpen={formOpen} onOpenChange={setFormOpen} lease={editing} />
    </div>
  );
}
