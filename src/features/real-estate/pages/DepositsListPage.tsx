import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { HandCoins, Search } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useDeposits } from "../hooks/use-real-estate-finance";
import { useLeases } from "../hooks/use-real-estate";
import { DEPOSIT_STATUS_COLORS } from "../lib/ui-maps";
import { depositHeld } from "../lib/rem-finance";

/**
 * Security-deposit liabilities desk: one deterministic row per executed lease,
 * every figure derived from the ledger (received − deducted − refunded).
 * Actions live on the lease detail page where the contract context is shown.
 */
export function DepositsListPage() {
  const { t } = useTranslation("real_estate");
  const { data: deposits = [], isLoading } = useDeposits();
  const { data: leases = [] } = useLeases();
  const [query, setQuery] = useState("");

  const leaseById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deposits
      .map((d) => ({ deposit: d, lease: leaseById.get(d.leaseId) }))
      .filter(({ lease }) => {
        if (!q) return true;
        const hay = `${lease?.contractNumber ?? ""} ${lease?.tenantDisplayNameSnapshot ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => b.deposit.outstandingLiability - a.deposit.outstandingLiability);
  }, [deposits, leaseById, query]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <HandCoins className="w-6 h-6 text-primary" />
          {t("depositsPage.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("depositsPage.subtitle")}</p>
      </div>

      <Input
        size="sm"
        className="sm:max-w-xs"
        startContent={<Search className="w-4 h-4 text-default-400" />}
        placeholder={t("depositsPage.searchPlaceholder")}
        value={query}
        onValueChange={setQuery}
      />

      <Card>
        <CardBody>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-default-400 py-4">{t("depositsPage.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("leasesPage.title")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.tenant")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.amount")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.paid")}</th>
                    <th className="px-2 py-2 text-start">{t("misc.held")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.outstandingLiability")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.status")}</th>
                    <th className="px-2 py-2 text-end">{t("fields.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ deposit: d, lease }) => (
                    <tr key={d.id} className="border-b border-default-100 last:border-0">
                      <td className="px-2 py-2">
                        <Link to={`/real-estate/leases/${d.leaseId}`} className="text-primary font-mono text-xs">
                          {lease?.contractNumber ?? d.leaseId}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-xs">{lease?.tenantDisplayNameSnapshot ?? d.tenantContactId}</td>
                      <td className="px-2 py-2 tabular-nums">{formatCurrency(d.expectedAmount, d.currency)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatCurrency(d.receivedAmount, d.currency)}</td>
                      <td className="px-2 py-2 tabular-nums">{formatCurrency(depositHeld(d), d.currency)}</td>
                      <td className="px-2 py-2 tabular-nums font-semibold">{formatCurrency(d.outstandingLiability, d.currency)}</td>
                      <td className="px-2 py-2">
                        <Chip size="sm" variant="flat" color={DEPOSIT_STATUS_COLORS[d.status]}>
                          {t(`depositStatus.${d.status}`)}
                        </Chip>
                        {d.handoverInspectionId && (
                          <div className="text-xs text-default-400 mt-0.5">
                            {t("depositsPage.inspectionLinked")} · {formatDate(d.updatedAt)}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-end">
                        <Button as={Link} to={`/real-estate/leases/${d.leaseId}`} size="sm" variant="light">
                          {t("depositsPage.manage")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
