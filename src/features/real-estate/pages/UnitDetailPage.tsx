import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider } from "@heroui/react";
import { ArrowLeft, CircleParking, Gauge, Wrench } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useProperties, useUnitProfile } from "../hooks/use-real-estate";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { MeterReadingsCard } from "../components/MeterReadingsCard";
import {
  INSTALLMENT_STATUS_COLORS,
  LEASE_STATUS_COLORS,
  OCCUPANCY_COLORS,
  UNIT_OPERATIONAL_COLORS,
} from "../lib/ui-maps";
import { installmentTotal } from "../types/real-estate.types";

/** Read-only rollup table shell: header row + children rows (or empty note). */
function MiniTable({
  title,
  headers,
  empty,
  rows,
}: {
  title: string;
  headers: string[];
  empty: string;
  rows: React.ReactNode[];
}) {
  return (
    <Card>
      <CardBody className="gap-2">
        <h2 className="text-base font-semibold text-default-800">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-default-400">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                  {headers.map((h) => (
                    <th key={h} className="px-2 py-2 text-start">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-default-400">{label}</p>
      <p className="text-sm text-default-800 mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

/**
 * Unit profile: persisted facts only. Lease/schedule sections are read-only
 * rollups here — their lifecycle actions arrive with the leasing phases.
 */
export function UnitDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("real_estate");
  const { data: profile, isLoading } = useUnitProfile(id);
  const { data: properties = [] } = useProperties();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile || !profile.unit) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-default-500">{t("validation.notFound")}</p>
        <Button as={Link} to="/real-estate/units" variant="flat">
          {t("unitProfile.backToUnits")}
        </Button>
      </div>
    );
  }

  const { unit, leases, installments, expenses, inspections, handovers } = profile;
  const property = properties.find((p) => p.id === unit.propertyId);
  const activeLease = leases.find((l) => l.status === "active" || l.status === "expiring");

  return (
    <div className="space-y-4">
      <div>
        <Button as={Link} to="/real-estate/units" size="sm" variant="light" startContent={<ArrowLeft className="w-4 h-4" />}>
          {t("unitProfile.backToUnits")}
        </Button>
        <h1 className="text-2xl font-bold text-default-900 flex flex-wrap items-center gap-2 mt-2">
          <CircleParking className="w-6 h-6 text-primary" />
          {unit.name}
          <span className="text-sm font-mono text-default-400">{unit.code}</span>
          <Chip size="sm" variant="flat" color={OCCUPANCY_COLORS[unit.occupancyStatus]}>
            {t(`occupancyStatus.${unit.occupancyStatus}`)}
          </Chip>
          <Chip size="sm" variant="flat" color={UNIT_OPERATIONAL_COLORS[unit.operationalStatus]}>
            {t(`operationalStatus.${unit.operationalStatus}`)}
          </Chip>
          {unit.archived && (
            <Chip size="sm" variant="flat" color="default">
              {t("misc.archivedBadge")}
            </Chip>
          )}
        </h1>
        {unit.maintenanceHold && (
          <p className="text-sm text-primary mt-1 flex items-center gap-1">
            <Wrench className="w-4 h-4" /> {t("unitProfile.maintenanceHoldOn")}
          </p>
        )}
        <p className="text-xs text-default-400 mt-1">{t("unitProfile.occupancyNote")}</p>
      </div>

      {/* Unit facts */}
      <Card>
        <CardBody className="gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Info
              label={t("fields.property")}
              value={
                property ? (
                  <Link to={`/real-estate/properties/${property.id}`} className="text-primary">
                    {property.code} — {property.nameEn}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Info label={t("fields.unitType")} value={t(`unitType.${unit.unitType}`)} />
            <Info label={t("fields.area")} value={unit.area != null ? `${unit.area} ${t(`areaUnit.${unit.areaUnit}`)}` : "—"} />
            <Info label={t("fields.usageClassification")} value={unit.usageClassification} />
            <Info label={t("fields.bedrooms")} value={unit.bedrooms ?? "—"} />
            <Info label={t("fields.bathrooms")} value={unit.bathrooms ?? "—"} />
            <Info label={t("fields.parkingSpaces")} value={unit.parkingSpaces ?? "—"} />
            <Info label={t("fields.furnished")} value={unit.furnished ? t("misc.all") : t("misc.none")} />
            <Info label={t("fields.askingRent")} value={unit.askingRent != null ? formatCurrency(unit.askingRent, unit.currency) : "—"} />
            <Info
              label={t("fields.suggestedSalePrice")}
              value={unit.suggestedSalePrice != null ? formatCurrency(unit.suggestedSalePrice, unit.currency) : "—"}
            />
            <Info label={t("fields.availabilityDate")} value={unit.availabilityDate ? formatDate(unit.availabilityDate) : "—"} />
            <Info label={t("fields.availabilityNote")} value={unit.availabilityNote} />
          </div>
          {unit.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {unit.amenities.map((a) => (
                <Chip key={a} size="sm" variant="flat" color="default">
                  {a}
                </Chip>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Meters */}
      {unit.meters.length > 0 && (
        <Card>
          <CardBody className="gap-2">
            <h2 className="text-base font-semibold text-default-800 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" /> {t("unitProfile.metersSection")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {unit.meters.map((m) => (
                <Chip key={m.id || m.meterNumber} size="sm" variant="flat" color="default">
                  {t(`utility.${m.utility}`, { defaultValue: m.utility })}: {m.meterNumber}
                </Chip>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Meter readings ledger (append-only, note-gated regressions) */}
      <MeterReadingsCard unit={unit} />

      {/* Current tenant (from the active lease, never a duplicate contact) */}
      <Card>
        <CardBody className="gap-2">
          <h2 className="text-base font-semibold text-default-800">{t("unitProfile.currentTenant")}</h2>
          {activeLease ? (
            <p className="text-sm text-default-700">
              {activeLease.tenantDisplayNameSnapshot || activeLease.tenantContactId} ·{" "}
              {formatCurrency(activeLease.rentAmount, activeLease.currency)} / {t(`frequency.${activeLease.frequency}`)}
            </p>
          ) : (
            <p className="text-sm text-default-400">{t("unitProfile.noCurrentLease")}</p>
          )}
        </CardBody>
      </Card>

      <Divider />

      {/* Lease history */}
      <MiniTable
        title={t("unitProfile.leaseHistory")}
        headers={[t("fields.contract"), t("fields.tenant"), t("fields.date"), t("fields.amount"), t("fields.status")]}
        empty={t("misc.noData")}
        rows={leases.map((l) => (
          <tr key={l.id} className="border-b border-default-100 last:border-0">
            <td className="px-2 py-2 text-xs font-mono">{l.contractNumber}</td>
            <td className="px-2 py-2">{l.tenantDisplayNameSnapshot || l.tenantContactId}</td>
            <td className="px-2 py-2 text-xs text-default-500">
              {formatDate(l.startDate)} → {formatDate(l.endDate)}
            </td>
            <td className="px-2 py-2 tabular-nums">{formatCurrency(l.rentAmount, l.currency)}</td>
            <td className="px-2 py-2">
              <Chip size="sm" variant="flat" color={LEASE_STATUS_COLORS[l.status]}>
                {t(`leaseStatus.${l.status}`)}
              </Chip>
            </td>
          </tr>
        ))}
      />

      {/* Rent installments */}
      <MiniTable
        title={t("unitProfile.installments")}
        headers={[t("fields.period"), t("fields.dueDate"), t("fields.amount"), t("fields.paid"), t("fields.status")]}
        empty={t("misc.noData")}
        rows={[...installments]
          .sort((a, b) => a.periodIndex - b.periodIndex)
          .map((i) => (
            <tr key={i.id} className="border-b border-default-100 last:border-0">
              <td className="px-2 py-2 text-xs">
                {formatDate(i.periodStart)} → {formatDate(i.periodEnd)}
              </td>
              <td className="px-2 py-2 text-xs">{formatDate(i.dueDate)}</td>
              <td className="px-2 py-2 tabular-nums">{formatCurrency(installmentTotal(i), i.currency)}</td>
              <td className="px-2 py-2 tabular-nums">{formatCurrency(i.paidAmount, i.currency)}</td>
              <td className="px-2 py-2">
                <Chip size="sm" variant="flat" color={INSTALLMENT_STATUS_COLORS[i.status]}>
                  {t(`installmentStatus.${i.status}`)}
                </Chip>
              </td>
            </tr>
          ))}
      />

      {/* Expenses */}
      <MiniTable
        title={t("unitProfile.expenses")}
        headers={[t("fields.date"), t("fields.category"), t("fields.description"), t("fields.amount")]}
        empty={t("misc.noData")}
        rows={expenses.map((e) => (
          <tr key={e.id} className="border-b border-default-100 last:border-0">
            <td className="px-2 py-2 text-xs">{formatDate(e.expenseDate)}</td>
            <td className="px-2 py-2 text-sm">{t(`expenseCategory.${e.category}`)}</td>
            <td className="px-2 py-2 text-sm">{e.description}</td>
            <td className="px-2 py-2 tabular-nums">{formatCurrency(e.amount, e.currency)}</td>
          </tr>
        ))}
      />

      {/* Inspections */}
      <MiniTable
        title={t("unitProfile.inspections")}
        headers={[t("fields.code"), t("fields.type"), t("fields.date"), t("fields.status")]}
        empty={t("misc.noData")}
        rows={inspections.map((i) => (
          <tr key={i.id} className="border-b border-default-100 last:border-0">
            <td className="px-2 py-2 text-xs font-mono">{i.code}</td>
            <td className="px-2 py-2 text-sm">{t(`inspectionType.${i.type}`)}</td>
            <td className="px-2 py-2 text-xs">{formatDate(i.inspectionDate)}</td>
            <td className="px-2 py-2">
              <Chip size="sm" variant="flat" color={i.finalized ? "success" : "warning"}>
                {i.finalized ? t("misc.completed") : t("misc.pending")}
              </Chip>
            </td>
          </tr>
        ))}
      />

      {/* Handovers */}
      <MiniTable
        title={t("unitProfile.handovers")}
        headers={[t("fields.kind"), t("fields.date"), t("fields.status")]}
        empty={t("misc.noData")}
        rows={handovers.map((h) => (
          <tr key={h.id} className="border-b border-default-100 last:border-0">
            <td className="px-2 py-2 text-sm">{t(`handoverKind.${h.kind}`)}</td>
            <td className="px-2 py-2 text-xs">{formatDate(h.handoverDate)}</td>
            <td className="px-2 py-2">
              <Chip size="sm" variant="flat" color={h.completed ? "success" : "warning"}>
                {h.completed ? t("misc.completed") : t("misc.pending")}
              </Chip>
            </td>
          </tr>
        ))}
      />

      {/* Documents — managed panel (upload/delete) in the activity-owned
          Storage partition; sensitive files stay officer-only. */}
      <DocumentsPanel entityType="unit" entityId={unit.id} />
    </div>
  );
}
