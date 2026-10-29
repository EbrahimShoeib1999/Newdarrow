import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider, Input } from "@heroui/react";
import { BarChart3, Download } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useLeases, useProperties, useUnits } from "../hooks/use-real-estate";
import { useAllInstallments, useAllPayments, useDeposits } from "../hooks/use-real-estate-finance";
import { useExpenses } from "../hooks/use-real-estate-ops";
import { RemSelect } from "../components/RemSelect";
import { downloadRemCsv } from "../lib/rem-export";
import { arrearsAging, depositHeld, summarizeCollections } from "../lib/rem-finance";
import { addDaysIso, todayIso } from "../lib/rem-rules";
import { leaseOutstandingBalance } from "../api/rem-leasing.service";
import { LEASE_STATUS_COLORS } from "../lib/ui-maps";
import type { Lease, OccupancyStatus } from "../types/real-estate.types";

const OCC_KEYS: OccupancyStatus[] = ["occupied", "vacant", "reserved", "under_maintenance", "unavailable"];

/** Report card shell: title + optional gated CSV export + children. */
function ReportCard({
  title,
  onExport,
  children,
}: {
  title: string;
  exportName?: string;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-default-800">{title}</h2>
          {onExport && can("real_estate.export") && (
            <Button size="sm" variant="light" startContent={<Download className="w-4 h-4" />} onPress={onExport}>
              {t("reportsPage.export")}
            </Button>
          )}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

const TH = "px-2 py-2 text-start text-xs font-semibold uppercase tracking-wide text-default-500";
const TD = "px-2 py-2 text-sm";

/**
 * Reports desk — every figure derives from persisted, authorized records
 * already loaded through the module services (no aggregates are invented,
 * no fabricated history). Filters narrow the date-driven sections only.
 */
export function RemReportsPage() {
  const { t } = useTranslation("real_estate");
  const { data: properties = [] } = useProperties();
  const { data: units = [] } = useUnits();
  const { data: leases = [] } = useLeases();
  const { data: installments = [] } = useAllInstallments();
  const { data: deposits = [] } = useDeposits();
  const { data: expenses = [] } = useExpenses();
  const { data: payments = [] } = useAllPayments();

  const [propertyId, setPropertyId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const today = todayIso();
  const liveProps = useMemo(
    () => properties.filter((p) => !p.archived && (!propertyId || p.id === propertyId)),
    [properties, propertyId]
  );
  const propIds = useMemo(() => new Set(liveProps.map((p) => p.id)), [liveProps]);
  const liveUnits = useMemo(
    () => units.filter((u) => !u.archived && propIds.has(u.propertyId)),
    [units, propIds]
  );
  const propLeases = useMemo(() => leases.filter((l) => propIds.has(l.propertyId)), [leases, propIds]);
  const leaseById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases]);
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const inRange = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

  /* ---- 1. Property & unit register (with recorded valuation) ---- */
  const register = useMemo(
    () =>
      liveProps.map((p) => {
        const pUnits = units.filter((u) => u.propertyId === p.id && !u.archived);
        const occupied = pUnits.filter((u) => u.occupancyStatus === "occupied").length;
        return {
          property: p,
          units: pUnits.length,
          occupied,
          askingTotal: pUnits.reduce((a, u) => a + (u.askingRent ?? 0), 0),
        };
      }),
    [liveProps, units]
  );

  /* ---- 2. Occupancy summary (formula documented on-card) ---- */
  const occupancy = useMemo(() => {
    const counts = Object.fromEntries(OCC_KEYS.map((k) => [k, 0])) as Record<OccupancyStatus, number>;
    for (const u of liveUnits) if (u.occupancyStatus in counts) counts[u.occupancyStatus] += 1;
    const rate = liveUnits.length ? Math.round((counts.occupied / liveUnits.length) * 100) : 0;
    return { counts, rate };
  }, [liveUnits]);

  /* ---- 3. Lease expirations (window: next 90 days + already expired) ---- */
  const expirations = useMemo(
    () =>
      propLeases
        .filter((l) => ["active", "expiring", "expired"].includes(l.status) && l.endDate <= addDaysIso(today, 90))
        .sort((a, b) => (a.endDate < b.endDate ? -1 : 1)),
    [propLeases, today]
  );

  /* ---- 4. Rent collection & arrears aging (per currency) ---- */
  const collections = useMemo(() => {
    const collectable = propLeases.filter((l) => l.status !== "draft" && l.status !== "pending_approval" && l.status !== "cancelled");
    const ids = new Set(collectable.map((l) => l.id));
    const grace = new Map(collectable.map((l) => [l.id, l.gracePeriodDays ?? 0]));
    const byCurrency = new Map<string, typeof installments>();
    for (const i of installments) {
      if (!ids.has(i.leaseId)) continue;
      const list = byCurrency.get(i.currency) ?? [];
      list.push(i);
      byCurrency.set(i.currency, list);
    }
    return [...byCurrency.entries()].map(([currency, rows]) => ({
      currency,
      summary: summarizeCollections(rows, grace, currency),
      aging: arrearsAging(rows, grace, currency),
    }));
  }, [propLeases, installments]);

  /* ---- 5. Outstanding balances by tenant ---- */
  const byTenant = useMemo(() => {
    const map = new Map<string, { tenant: string; leases: Lease[]; total: number; currency: string }>();
    for (const l of propLeases) {
      if (l.status === "draft" || l.status === "pending_approval" || l.status === "cancelled") continue;
      const out = leaseOutstandingBalance(l, installments);
      if (out <= 0) continue;
      const key = `${l.tenantDisplayNameSnapshot || l.tenantContactId}|${l.currency}`;
      const row = map.get(key) ?? { tenant: l.tenantDisplayNameSnapshot || l.tenantContactId, leases: [], total: 0, currency: l.currency };
      row.leases.push(l);
      row.total += out;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [propLeases, installments]);

  /* ---- 6. Deposit liabilities (per currency) ---- */
  const depositTotals = useMemo(() => {
    const byCurrency = new Map<string, { expected: number; received: number; held: number; deductions: number; refunds: number }>();
    for (const d of deposits) {
      if (!propIds.has(d.propertyId)) continue;
      const row = byCurrency.get(d.currency) ?? { expected: 0, received: 0, held: 0, deductions: 0, refunds: 0 };
      row.expected += d.expectedAmount;
      row.received += d.receivedAmount;
      row.held += depositHeld(d);
      row.deductions += (d.deductions ?? []).reduce((a, x) => a + x.amount, 0);
      row.refunds += (d.refunds ?? []).reduce((a, x) => a + x.amount, 0);
      byCurrency.set(d.currency, row);
    }
    return [...byCurrency.entries()];
  }, [deposits, propIds]);

  /* ---- 7. Income vs expenses (cash basis, date-filtered) ---- */
  const money = useMemo(() => {
    // Deposit receipts are liability events, not income — excluded (mirrors
    // the lease detail ledger). Voided payments net out completely.
    const rentIn = new Map<string, number>();
    for (const p of payments) {
      if (p.voided) continue;
      if ((p as { isDepositReceipt?: boolean }).isDepositReceipt) continue;
      const lease = leaseById.get(p.leaseId);
      if (!lease || !propIds.has(lease.propertyId)) continue;
      if (!inRange(p.paymentDate)) continue;
      rentIn.set(p.currency, (rentIn.get(p.currency) ?? 0) + p.amount);
    }
    const expApproved = new Map<string, number>();
    const expPending = new Map<string, number>();
    for (const e of expenses) {
      if (!propIds.has(e.propertyId)) continue;
      if (!inRange(e.expenseDate)) continue;
      const target = e.approvalStatus === "approved" ? expApproved : e.approvalStatus === "pending" ? expPending : null;
      if (!target) continue; // rejected entries are excluded from obligations
      target.set(e.currency, (target.get(e.currency) ?? 0) + e.amount);
    }
    const currencies = [...new Set([...rentIn.keys(), ...expApproved.keys(), ...expPending.keys()])];
    return currencies.map((currency) => ({
      currency,
      rent: rentIn.get(currency) ?? 0,
      approved: expApproved.get(currency) ?? 0,
      pending: expPending.get(currency) ?? 0,
    }));
  }, [payments, expenses, leaseById, propIds, dateFrom, dateTo]);

  /* ---- 8. Maintenance costs by property (recorded expense category) ---- */
  const maintenance = useMemo(() => {
    const byProp = new Map<string, { amount: number; count: number }>();
    for (const e of expenses) {
      if (e.category !== "maintenance_repairs") continue;
      if (!propIds.has(e.propertyId)) continue;
      if (!inRange(e.expenseDate)) continue;
      const row = byProp.get(e.propertyId) ?? { amount: 0, count: 0 };
      row.amount += e.amount;
      row.count += 1;
      byProp.set(e.propertyId, row);
    }
    return [...byProp.entries()]
      .map(([id, v]) => ({ property: liveProps.find((p) => p.id === id), ...v }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, propIds, liveProps, dateFrom, dateTo]);

  /* ---- 9. Period-over-period (last 6 calendar months, per currency) ---- */
  const trend = useMemo(() => {
    const months: string[] = [];
    const d = new Date();
    for (let k = 5; k >= 0; k--) {
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
    }
    const currencies = [...new Set([...payments.map((p) => p.currency), ...expenses.map((e) => e.currency)])];
    return {
      months,
      rows: currencies.map((currency) => ({
        currency,
        collected: months.map((m) =>
          payments
            .filter((p) => !p.voided && !(p as { isDepositReceipt?: boolean }).isDepositReceipt && p.currency === currency && p.paymentDate.slice(0, 7) === m && (leaseById.get(p.leaseId) ? propIds.has(leaseById.get(p.leaseId)!.propertyId) : false))
            .reduce((a, p) => a + p.amount, 0)
        ),
        paid: months.map((m) =>
          expenses
            .filter((e) => e.currency === currency && e.approvalStatus === "approved" && e.expenseDate.slice(0, 7) === m && propIds.has(e.propertyId))
            .reduce((a, e) => a + e.amount, 0)
        ),
      })),
    };
  }, [payments, expenses, leaseById, propIds]);

  const empty = properties.length === 0 && leases.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-primary" />
          {t("reportsPage.title")}
        </h1>
        <p className="text-sm text-default-500 mt-1">{t("reportsPage.subtitle")}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <RemSelect
          label={t("fields.property")}
          value={propertyId}
          onChange={setPropertyId}
          placeholderKey={t("misc.all")}
          options={properties.filter((p) => !p.archived).map((p) => ({ id: p.id, label: `${p.code} — ${p.nameEn}` }))}
        />
        <Input size="sm" type="date" className="sm:max-w-[180px]" label={t("reportsPage.from")} value={dateFrom} onValueChange={setDateFrom} />
        <Input size="sm" type="date" className="sm:max-w-[180px]" label={t("reportsPage.to")} value={dateTo} onValueChange={setDateTo} />
      </div>

      {empty ? (
        <Card>
          <CardBody>
            <p className="text-sm text-default-400">{t("misc.noData")}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <ReportCard
            title={t("reportsPage.register")}
            exportName="register"
            onExport={() =>
              downloadRemCsv("register", [
                [t("fields.property"), t("reportsPage.unitCount"), t("reportsPage.occupiedCount"), t("fields.askingRent"), t("reportsPage.acquisition"), t("reportsPage.valuation")],
                ...register.map((r) => [
                  `${r.property.code} ${r.property.nameEn}`,
                  r.units,
                  r.occupied,
                  r.askingTotal,
                  r.property.acquisitionPrice ?? "",
                  r.property.valuation ?? "",
                ]),
              ])
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-default-200">
                    <th className={TH}>{t("fields.property")}</th>
                    <th className={TH}>{t("reportsPage.unitCount")}</th>
                    <th className={TH}>{t("reportsPage.occupiedCount")}</th>
                    <th className={TH}>{t("fields.askingRent")}</th>
                    <th className={TH}>{t("reportsPage.acquisition")}</th>
                    <th className={TH}>{t("reportsPage.valuation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {register.map((r) => (
                    <tr key={r.property.id} className="border-b border-default-100 last:border-0">
                      <td className={TD}>
                        <span className="font-mono text-xs">{r.property.code}</span> {r.property.nameEn}
                      </td>
                      <td className={TD}>{r.units}</td>
                      <td className={TD}>{r.occupied}</td>
                      <td className={`${TD} tabular-nums`}>{formatCurrency(r.askingTotal, r.property.currency)}</td>
                      <td className={`${TD} tabular-nums`}>{r.property.acquisitionPrice != null ? formatCurrency(r.property.acquisitionPrice, r.property.currency) : "—"}</td>
                      <td className={`${TD} tabular-nums`}>
                        {r.property.valuation != null ? (
                          <>
                            {formatCurrency(r.property.valuation, r.property.currency)}
                            {r.property.valuationDate && <span className="text-xs text-default-400"> · {formatDate(r.property.valuationDate)}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportCard>

          <ReportCard title={t("reportsPage.occupancy")}>
            <div className="flex flex-wrap gap-2">
              {OCC_KEYS.map((k) => (
                <Chip key={k} size="sm" variant="flat">
                  {t(`occupancyStatus.${k}`)}: {occupancy.counts[k]}
                </Chip>
              ))}
              <Chip size="sm" variant="flat" color="primary">
                {t("dashboard.occupancyRate")}: {occupancy.rate}%
              </Chip>
            </div>
            <p className="text-xs text-default-400">{t("reportsPage.occupancyFormula")}</p>
          </ReportCard>

          <ReportCard
            title={t("reportsPage.expirations")}
            exportName="expirations"
            onExport={() =>
              downloadRemCsv("expirations", [
                [t("fields.contract"), t("fields.tenant"), t("fields.endDate"), t("reportsPage.daysLeft"), t("fields.rentAmount")],
                ...expirations.map((l) => [l.contractNumber, l.tenantDisplayNameSnapshot || l.tenantContactId, l.endDate, Math.ceil((new Date(l.endDate).getTime() - new Date(today).getTime()) / 86400000), l.rentAmount]),
              ])
            }
          >
            {expirations.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              <ul className="space-y-1">
                {expirations.map((l) => {
                  const days = Math.ceil((new Date(l.endDate).getTime() - new Date(today).getTime()) / 86400000);
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs">{l.contractNumber}</span>
                      <span className="flex-1 min-w-0 truncate">{l.tenantDisplayNameSnapshot || l.tenantContactId}</span>
                      <Chip size="sm" variant="flat" color={days < 0 ? "danger" : "warning"}>
                        {days < 0 ? t("reportsPage.expiredAlready") : `${t("reportsPage.daysLeft")}: ${days}`}
                      </Chip>
                      <Chip size="sm" variant="flat" color={LEASE_STATUS_COLORS[l.status]}>
                        {t(`leaseStatus.${l.status}`)}
                      </Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          </ReportCard>

          {collections.map(({ currency, summary, aging }, idx) => (
            <ReportCard
              key={currency}
              title={`${t("reportsPage.collections")} · ${currency}`}
              exportName={`collections_${currency}`}
              onExport={idx === collections.length - 1
                ? () =>
                    downloadRemCsv(`collections`, [
                      [t("fields.currency"), t("collectionsPage.dueTotal"), t("collectionsPage.collectedTotal"), t("collectionsPage.outstandingTotal"), "1-30", "31-60", "61-90", "90+"],
                      ...collections.map((c) => [c.currency, c.summary.dueTotal, c.summary.collectedTotal, c.summary.outstandingTotal, c.aging.days1_30, c.aging.days31_60, c.aging.days61_90, c.aging.over90]),
                    ])
                : undefined}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-default-400">{t("collectionsPage.dueTotal")}</p>
                  <p className="text-sm font-semibold tabular-nums">{formatCurrency(summary.dueTotal, currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-default-400">{t("collectionsPage.collectedTotal")}</p>
                  <p className="text-sm font-semibold tabular-nums">{formatCurrency(summary.collectedTotal, currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-default-400">{t("collectionsPage.outstandingTotal")}</p>
                  <p className="text-sm font-semibold tabular-nums text-danger-600">{formatCurrency(summary.outstandingTotal, currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-default-400">{t("reportsPage.arrearsAging")}</p>
                  <p className="text-xs tabular-nums">
                    1–30: {formatCurrency(aging.days1_30, currency)} · 31–60: {formatCurrency(aging.days31_60, currency)} · 61–90: {formatCurrency(aging.days61_90, currency)} · 90+: {formatCurrency(aging.over90, currency)}
                  </p>
                </div>
              </div>
            </ReportCard>
          ))}

          <ReportCard
            title={t("reportsPage.byTenant")}
            exportName="outstanding"
            onExport={byTenant.length > 0
              ? () =>
                  downloadRemCsv("outstanding_by_tenant", [
                    [t("fields.tenant"), t("fields.currency"), t("reportsPage.leaseCount"), t("collectionsPage.outstandingTotal")],
                    ...byTenant.map((r) => [r.tenant, r.currency, r.leases.length, r.total]),
                  ])
              : undefined}
          >
            {byTenant.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              <ul className="space-y-1">
                {byTenant.map((r) => (
                  <li key={`${r.tenant}-${r.currency}`} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{r.tenant}</span>
                    <span className="text-xs text-default-400">{r.leases.length} {t("fields.contract")}</span>
                    <span className="tabular-nums font-semibold text-danger-600">{formatCurrency(r.total, r.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </ReportCard>

          {depositTotals.length > 0 && (
            <ReportCard
              title={t("reportsPage.deposits")}
              exportName="deposits"
              onExport={() =>
                downloadRemCsv("deposit_liabilities", [
                  [t("fields.currency"), t("fields.depositAmount"), t("reportsPage.receivedTotal"), t("misc.held"), t("reportsPage.deductionsTotal"), t("reportsPage.refundsTotal")],
                  ...depositTotals.map(([currency, v]) => [currency, v.expected, v.received, v.held, v.deductions, v.refunds]),
                ])
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-default-200">
                      <th className={TH}>{t("fields.currency")}</th>
                      <th className={TH}>{t("fields.depositAmount")}</th>
                      <th className={TH}>{t("reportsPage.receivedTotal")}</th>
                      <th className={TH}>{t("misc.held")}</th>
                      <th className={TH}>{t("reportsPage.deductionsTotal")}</th>
                      <th className={TH}>{t("reportsPage.refundsTotal")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depositTotals.map(([currency, v]) => (
                      <tr key={currency} className="border-b border-default-100 last:border-0">
                        <td className={TD}>{currency}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(v.expected, currency)}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(v.received, currency)}</td>
                        <td className={`${TD} tabular-nums font-semibold`}>{formatCurrency(v.held, currency)}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(v.deductions, currency)}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(v.refunds, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ReportCard>
          )}

          <ReportCard
            title={t("reportsPage.incomeExpenses")}
            exportName="income-expenses"
            onExport={money.length > 0
              ? () =>
                  downloadRemCsv("income_expenses", [
                    [t("fields.currency"), t("reportsPage.rentCollected"), t("reportsPage.approvedExpenses"), t("reportsPage.pendingExpenses"), t("reportsPage.netCash")],
                    ...money.map((m) => [m.currency, m.rent, m.approved, m.pending, m.rent - m.approved]),
                  ])
              : undefined}
          >
            <p className="text-xs text-default-400">{t("reportsPage.cashBasisNote")}</p>
            {money.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-default-200">
                      <th className={TH}>{t("fields.currency")}</th>
                      <th className={TH}>{t("reportsPage.rentCollected")}</th>
                      <th className={TH}>{t("reportsPage.approvedExpenses")}</th>
                      <th className={TH}>{t("reportsPage.pendingExpenses")}</th>
                      <th className={TH}>{t("reportsPage.netCash")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.map((m) => (
                      <tr key={m.currency} className="border-b border-default-100 last:border-0">
                        <td className={TD}>{m.currency}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(m.rent, m.currency)}</td>
                        <td className={`${TD} tabular-nums`}>{formatCurrency(m.approved, m.currency)}</td>
                        <td className={`${TD} tabular-nums text-warning-600`}>{formatCurrency(m.pending, m.currency)}</td>
                        <td className={`${TD} tabular-nums font-semibold ${m.rent - m.approved >= 0 ? "text-success-600" : "text-danger-600"}`}>
                          {formatCurrency(m.rent - m.approved, m.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ReportCard>

          <ReportCard
            title={t("reportsPage.maintenance")}
            exportName="maintenance"
            onExport={maintenance.length > 0
              ? () =>
                  downloadRemCsv("maintenance_by_property", [
                    [t("fields.property"), t("reportsPage.entryCount"), t("fields.amount")],
                    ...maintenance.map((m) => [m.property ? `${m.property.code} ${m.property.nameEn}` : "—", m.count, m.amount]),
                  ])
              : undefined}
          >
            {maintenance.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              <ul className="space-y-1">
                {maintenance.map((m) => (
                  <li key={m.property?.id ?? "unknown"} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">{m.property ? `${m.property.code} — ${m.property.nameEn}` : "—"}</span>
                    <span className="text-xs text-default-400">{m.count}</span>
                    <span className="tabular-nums font-semibold">{formatCurrency(m.amount, m.property?.currency ?? "SAR")}</span>
                  </li>
                ))}
              </ul>
            )}
          </ReportCard>

          <ReportCard
            title={t("reportsPage.trend")}
            exportName="trend"
            onExport={trend.rows.length > 0
              ? () =>
                  downloadRemCsv(
                    "period_trend",
                    [
                      [t("fields.currency"), ...trend.months.map((m) => `${m} ${t("reportsPage.rentCollected")}/${t("reportsPage.approvedExpenses")}`)],
                      ...trend.rows.map((r) => [r.currency, ...trend.months.flatMap((_, i) => [r.collected[i], r.paid[i]])]),
                    ]
                  )
              : undefined}
          >
            {trend.rows.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              trend.rows.map((r) => (
                <div key={r.currency} className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-default-500">{r.currency}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {trend.months.map((m, i) => (
                      <div key={m} className="rounded-lg bg-default-50 p-2 text-center">
                        <p className="text-xs text-default-400">{m}</p>
                        <p className="text-xs tabular-nums text-success-600">{formatCurrency(r.collected[i], r.currency)}</p>
                        <p className="text-xs tabular-nums text-danger-600">{formatCurrency(r.paid[i], r.currency)}</p>
                      </div>
                    ))}
                  </div>
                  <Divider />
                </div>
              ))
            )}
          </ReportCard>

          {/* Unit rollup for the filtered scope (availability register) */}
          <ReportCard title={t("reportsPage.unitAvailability")}>
            {liveUnits.length === 0 ? (
              <p className="text-sm text-default-400">{t("misc.noData")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {liveUnits.map((u) => (
                  <Chip key={u.id} size="sm" variant="flat" color={u.occupancyStatus === "vacant" ? "success" : "default"}>
                    {unitById.get(u.id)?.code ?? u.code}: {t(`occupancyStatus.${u.occupancyStatus}`)}
                  </Chip>
                ))}
              </div>
            )}
          </ReportCard>
        </>
      )}
    </div>
  );
}
