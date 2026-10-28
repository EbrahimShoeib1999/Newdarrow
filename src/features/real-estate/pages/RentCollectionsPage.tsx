import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Checkbox, Chip, Input } from "@heroui/react";
import { Banknote, CalendarClock, Search } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useCompany } from "@/features/companies/context/company-context";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAllInstallments } from "../hooks/use-real-estate-finance";
import { useLeases } from "../hooks/use-real-estate";
import { RecordPaymentModal } from "../components/RecordPaymentModal";
import { INSTALLMENT_STATUS_COLORS, remErrorText } from "../lib/ui-maps";
import { arrearsAging, installmentOutstanding, summarizeCollections } from "../lib/rem-finance";
import { processDueDates } from "../api/rem-leasing.service";
import type { Lease, RentInstallment } from "../types/real-estate.types";

interface OpenRow {
  installment: RentInstallment;
  lease: Lease | undefined;
  outstanding: number;
}

/**
 * Rent collections desk: every unpaid/partial schedule row across executed
 * leases. Totals are computed from the durable installment math (same pure
 * helpers the services use) — never cached counters.
 */
export function RentCollectionsPage() {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const { companyId } = useCompany();
  const queryClient = useQueryClient();
  const canCollect = can("real_estate.collect");

  const { data: installments = [], isLoading } = useAllInstallments();
  const { data: leases = [] } = useLeases();

  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [payLease, setPayLease] = useState<Lease | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // No cron exists in this architecture: the due-date processor is run here
  // explicitly, so stale statuses refresh transparently (and never silently).
  const runDueDates = async () => {
    if (!companyId) return;
    setRefreshing(true);
    try {
      const r = await processDueDates(companyId);
      await queryClient.invalidateQueries({ queryKey: ["real_estate"] });
      toast.success(
        `${t("collectionsPage.expiredFlagged")}: ${r.leasesExpired} · ${t("collectionsPage.expiringFlagged")}: ${r.leasesFlagged} · ${t("collectionsPage.installmentsUpdated")}: ${r.installmentsUpdated}`
      );
    } catch (e) {
      toast.error(remErrorText(t, e));
    } finally {
      setRefreshing(false);
    }
  };

  const leaseById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases]);

  const openRows = useMemo<OpenRow[]>(() => {
    const rows: OpenRow[] = [];
    for (const i of installments) {
      if (i.status === "cancelled") continue;
      const outstanding = installmentOutstanding(i);
      if (outstanding <= 0) continue;
      const lease = leaseById.get(i.leaseId);
      // Drafts never generate schedules; guard anyway against orphan rows.
      if (lease && (lease.status === "draft" || lease.status === "pending_approval")) continue;
      rows.push({ installment: i, lease, outstanding });
    }
    return rows.sort((a, b) => (a.installment.dueDate < b.installment.dueDate ? -1 : 1));
  }, [installments, leaseById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return openRows.filter((r) => {
      if (overdueOnly && r.installment.status !== "overdue") return false;
      if (!q) return true;
      const hay = `${r.lease?.contractNumber ?? ""} ${r.lease?.tenantDisplayNameSnapshot ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [openRows, query, overdueOnly]);

  // One summary per currency present in the open rows (payments are locked to
  // the lease currency server-side, so mixing currencies would be meaningless).
  const summaries = useMemo(() => {
    const byCurrency = new Map<string, RentInstallment[]>();
    for (const r of filtered) {
      const list = byCurrency.get(r.installment.currency) ?? [];
      list.push(r.installment);
      byCurrency.set(r.installment.currency, list);
    }
    const graceByLease = new Map(leases.map((l) => [l.id, l.gracePeriodDays ?? 0]));
    return [...byCurrency.entries()].map(([currency, rows]) => ({
      currency,
      summary: summarizeCollections(rows, graceByLease, currency),
      aging: arrearsAging(rows, graceByLease, currency),
    }));
  }, [filtered, leases]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <Banknote className="w-6 h-6 text-primary" />
          {t("collectionsPage.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("collectionsPage.subtitle")}</p>
        <Button
          size="sm"
          variant="flat"
          className="mt-2"
          startContent={<CalendarClock className="w-4 h-4" />}
          isLoading={refreshing}
          onPress={runDueDates}
        >
          {t("collectionsPage.refreshStatuses")}
        </Button>
      </div>

      {summaries.map(({ currency, summary, aging }) => (
        <Card key={currency}>
          <CardBody className="gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-default-400">{t("collectionsPage.dueTotal")}</p>
                <p className="text-lg font-bold tabular-nums">{formatCurrency(summary.dueTotal, currency)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-default-400">{t("collectionsPage.collectedTotal")}</p>
                <p className="text-lg font-bold tabular-nums text-success">{formatCurrency(summary.collectedTotal, currency)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-default-400">{t("dashboard.overdueRent")}</p>
                <p className="text-lg font-bold tabular-nums text-danger">{formatCurrency(summary.overdueTotal, currency)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-default-400">{t("collectionsPage.outstandingTotal")}</p>
                <p className="text-lg font-bold tabular-nums">{formatCurrency(summary.outstandingTotal, currency)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-default-600">
              <Chip size="sm" variant="flat">{t("collectionsPage.ageCurrent")}: {formatCurrency(aging.current, currency)}</Chip>
              <Chip size="sm" variant="flat" color="warning">1–30: {formatCurrency(aging.days1_30, currency)}</Chip>
              <Chip size="sm" variant="flat" color="warning">31–60: {formatCurrency(aging.days31_60, currency)}</Chip>
              <Chip size="sm" variant="flat" color="danger">61–90: {formatCurrency(aging.days61_90, currency)}</Chip>
              <Chip size="sm" variant="flat" color="danger">90+: {formatCurrency(aging.over90, currency)}</Chip>
            </div>
          </CardBody>
        </Card>
      ))}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Input
          size="sm"
          className="sm:max-w-xs"
          startContent={<Search className="w-4 h-4 text-default-400" />}
          placeholder={t("collectionsPage.searchPlaceholder")}
          value={query}
          onValueChange={setQuery}
        />
        <Checkbox isSelected={overdueOnly} onValueChange={setOverdueOnly}>
          <span className="text-sm">{t("collectionsPage.overdueOnly")}</span>
        </Checkbox>
      </div>

      <Card>
        <CardBody>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-default-400 py-4">{t("collectionsPage.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("leasesPage.title")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.tenant")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.period")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.dueDate")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.outstanding")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.status")}</th>
                    <th className="px-2 py-2 text-end">{t("fields.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ installment: i, lease, outstanding }) => (
                    <tr key={i.id} className="border-b border-default-100 last:border-0">
                      <td className="px-2 py-2">
                        {lease ? (
                          <Link to={`/real-estate/leases/${lease.id}`} className="text-primary font-mono text-xs">
                            {lease.contractNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-default-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs">{lease?.tenantDisplayNameSnapshot ?? "—"}</td>
                      <td className="px-2 py-2 text-xs">
                        {formatDate(i.periodStart)} → {formatDate(i.periodEnd)}
                      </td>
                      <td className="px-2 py-2 text-xs">{formatDate(i.dueDate)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatCurrency(outstanding, i.currency)}</td>
                      <td className="px-2 py-2">
                        <Chip size="sm" variant="flat" color={INSTALLMENT_STATUS_COLORS[i.status]}>
                          {t(`installmentStatus.${i.status}`)}
                        </Chip>
                      </td>
                      <td className="px-2 py-2 text-end">
                        {canCollect && lease && (
                          <Button size="sm" variant="flat" color="primary" onPress={() => setPayLease(lease)}>
                            {t("leasesPage.recordPayment")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {payLease && (
        <RecordPaymentModal
          isOpen={!!payLease}
          onOpenChange={(o) => !o && setPayLease(null)}
          lease={payLease}
          installments={installments.filter((i) => i.leaseId === payLease.id)}
        />
      )}
    </div>
  );
}
