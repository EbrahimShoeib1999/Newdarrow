import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip } from "@heroui/react";
import { Banknote, Building2, CalendarClock, CircleParking, GaugeCircle, Home, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useLeases, useProperties, useRemActor, useUnits } from "../hooks/use-real-estate";
import { useAllInstallments } from "../hooks/use-real-estate-finance";
import { useGenerateRemindersMutation } from "../hooks/use-real-estate-ops";
import { OCCUPANCY_COLORS, remErrorText } from "../lib/ui-maps";
import { shouldFlagExpiring } from "../lib/rem-rules";
import { summarizeCollections } from "../lib/rem-finance";
import type { OccupancyStatus, RentInstallment } from "../types/real-estate.types";

const OCC_ORDER: OccupancyStatus[] = ["occupied", "vacant", "reserved", "under_maintenance", "unavailable"];

/**
 * REM overview — every number is counted from persisted records only
 * (properties, units, leases); no fabricated targets or sample data.
 */
export function RemDashboardPage() {
  const { t } = useTranslation("real_estate");
  const { data: properties = [], isLoading: pLoading } = useProperties();
  const { data: units = [], isLoading: uLoading } = useUnits();
  const { data: leases = [] } = useLeases();
  const { data: installments = [] } = useAllInstallments();
  const actor = useRemActor();
  const generateReminders = useGenerateRemindersMutation();

  const liveProperties = properties.filter((p) => !p.archived);
  const liveUnits = units.filter((u) => !u.archived);

  const occupancy = useMemo(() => {
    const counts = Object.fromEntries(OCC_ORDER.map((k) => [k, 0])) as Record<OccupancyStatus, number>;
    for (const u of liveUnits) {
      if (u.occupancyStatus in counts) counts[u.occupancyStatus] += 1;
    }
    return counts;
  }, [liveUnits]);

  const occupancyRate = liveUnits.length
    ? Math.round((occupancy.occupied / liveUnits.length) * 100)
    : null;

  const activeLeases = leases.filter((l) => l.status === "active" || l.status === "expiring");
  const expiringSoon = leases.filter((l) => shouldFlagExpiring(l.status, l.endDate, 60) || l.status === "expiring");

  // Overdue rent, recomputed from the installment ledger (same pure helper the
  // services use) — grouped per currency because payments are lease-currency.
  const overdueByCurrency = useMemo(() => {
    const collectableLeases = leases.filter(
      (l) => l.status !== "draft" && l.status !== "pending_approval" && l.status !== "cancelled"
    );
    const collectableIds = new Set(collectableLeases.map((l) => l.id));
    const grace = new Map(collectableLeases.map((l) => [l.id, l.gracePeriodDays ?? 0]));
    const byCurrency = new Map<string, RentInstallment[]>();
    for (const i of installments) {
      if (!collectableIds.has(i.leaseId)) continue;
      const list = byCurrency.get(i.currency) ?? [];
      list.push(i);
      byCurrency.set(i.currency, list);
    }
    return [...byCurrency.entries()].map(([currency, rows]) => ({
      currency,
      overdue: summarizeCollections(rows, grace, currency).overdueTotal,
    }));
  }, [installments, leases]);

  const loading = pLoading || uLoading;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          {t("dashboard.title")}
        </h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : properties.length === 0 && units.length === 0 ? (
        <Card>
          <CardBody className="items-center gap-3 py-10 text-center">
            <p className="text-sm text-default-500">{t("dashboard.empty")}</p>
            <Button as={Link} to="/real-estate/properties" color="primary" variant="flat">
              {t("propertiesPage.title")}
            </Button>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardBody className="gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-default-400 flex items-center gap-1.5">
                  <Home className="w-3.5 h-3.5" /> {t("dashboard.propertiesCount")}
                </p>
                <p className="text-2xl font-bold text-default-900 tabular-nums">{liveProperties.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-default-400 flex items-center gap-1.5">
                  <CircleParking className="w-3.5 h-3.5" /> {t("dashboard.unitsCount")}
                </p>
                <p className="text-2xl font-bold text-default-900 tabular-nums">{liveUnits.length}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-default-400 flex items-center gap-1.5">
                  <GaugeCircle className="w-3.5 h-3.5" /> {t("dashboard.occupancyRate")}
                </p>
                <p className="text-2xl font-bold text-default-900 tabular-nums">
                  {occupancyRate == null ? "—" : `${occupancyRate}%`}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-default-400 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" /> {t("dashboard.activeLeases")}
                </p>
                <p className="text-2xl font-bold text-default-900 tabular-nums">{activeLeases.length}</p>
                {expiringSoon.length > 0 && (
                  <p className="text-xs text-warning-600">
                    {t("dashboard.expiringSoon")}: {expiringSoon.length}
                  </p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="gap-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-default-400 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5" /> {t("dashboard.overdueRent")}
                </p>
                {overdueByCurrency.length === 0 ? (
                  <p className="text-2xl font-bold text-default-900 tabular-nums">—</p>
                ) : (
                  overdueByCurrency.map(({ currency, overdue }) => (
                    <p key={currency} className={`text-lg font-bold tabular-nums ${overdue > 0 ? "text-danger-600" : "text-default-900"}`}>
                      {formatCurrency(overdue, currency)}
                    </p>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardBody className="gap-3">
              <p className="text-sm font-semibold text-default-700">{t("dashboard.unitsCount")} · {t("fields.occupancyStatus")}</p>
              <div className="flex flex-wrap gap-2">
                {OCC_ORDER.map((k) => (
                  <Chip key={k} size="sm" variant="flat" color={OCCUPANCY_COLORS[k]}>
                    {t(`occupancyStatus.${k}`)}: {occupancy[k]}
                  </Chip>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button as={Link} to="/real-estate/properties" variant="flat" color="primary">
              {t("nav.properties")}
            </Button>
            <Button as={Link} to="/real-estate/units" variant="flat" color="primary">
              {t("nav.units")}
            </Button>
            <Button as={Link} to="/real-estate/leases" variant="flat" color="primary">
              {t("nav.leases")}
            </Button>
            <Button as={Link} to="/real-estate/collections" variant="flat" color="primary">
              {t("nav.collections")}
            </Button>
            {/* On-demand reminder sweep (no scheduler in this architecture):
                idempotent per period, so pressing it twice changes nothing. */}
            <Button
              variant="flat"
              color="secondary"
              startContent={<CalendarClock className="w-4 h-4" />}
              isLoading={generateReminders.isPending}
              onPress={async () => {
                try {
                  const res = await generateReminders.mutateAsync({
                    leases,
                    installments,
                    properties,
                    units,
                    recipients: [actor],
                  });
                  toast.success(t("dashboard.remindersResult", { created: res.created, skipped: res.skipped }));
                } catch (e) {
                  toast.error(remErrorText(t, e));
                }
              }}
            >
              {t("dashboard.generateReminders")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
