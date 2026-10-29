import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Checkbox, Chip, Input } from "@heroui/react";
import { CircleParking, Plus, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatCurrency } from "@/lib/utils";
import { RemSelect } from "../components/RemSelect";
import {
  useDeleteUnitMutation,
  useProperties,
  useSetMaintenanceHoldMutation,
  useSetUnitArchivedMutation,
  useUnits,
} from "../hooks/use-real-estate";
import { OCCUPANCY_COLORS, UNIT_OPERATIONAL_COLORS, remErrorText } from "../lib/ui-maps";
import { UnitFormModal } from "../components/UnitFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { OccupancyStatus, Unit } from "../types/real-estate.types";

const OCC_OPTIONS: OccupancyStatus[] = ["vacant", "reserved", "occupied", "under_maintenance", "unavailable"];

export function UnitsListPage() {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canManage = can("real_estate.create");
  const canDelete = can("real_estate.delete");

  const { data: units = [], isLoading } = useUnits();
  const { data: properties = [] } = useProperties();
  const setHold = useSetMaintenanceHoldMutation();
  const setArchived = useSetUnitArchivedMutation();
  const deleteUnit = useDeleteUnitMutation();

  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [occupancyFilter, setOccupancyFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [archiving, setArchiving] = useState<Unit | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  const propertyName = (id: string) => {
    const p = properties.find((x) => x.id === id);
    return p ? `${p.code} — ${p.nameEn}` : id;
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return units.filter(
      (u) =>
        (showArchived || !u.archived) &&
        (!propertyFilter || u.propertyId === propertyFilter) &&
        (!occupancyFilter || u.occupancyStatus === occupancyFilter) &&
        (!term ||
          u.code.toLowerCase().includes(term) ||
          u.name.toLowerCase().includes(term) ||
          (u.nameAr ?? "").toLowerCase().includes(term)),
    );
  }, [units, search, propertyFilter, occupancyFilter, showArchived]);

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await deleteUnit.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (e) {
      // Units with lease/financial history are archive-only (service enforced).
      toast.error(remErrorText(t, e));
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <CircleParking className="w-6 h-6 text-primary" />
            {t("unitsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("unitsPage.subtitle")}</p>
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
        <div className="w-56">
          <RemSelect
            label={t("unitsPage.filterProperty")}
            value={propertyFilter}
            onChange={setPropertyFilter}
            placeholderKey={t("misc.all")}
            options={properties.filter((p) => !p.archived).map((p) => ({ id: p.id, label: `${p.code} — ${p.nameEn}` }))}
          />
        </div>
        <div className="w-48">
          <RemSelect
            label={t("unitsPage.filterOccupancy")}
            value={occupancyFilter}
            onChange={setOccupancyFilter}
            placeholderKey={t("misc.all")}
            options={OCC_OPTIONS.map((k) => ({ id: k, label: t(`occupancyStatus.${k}`) }))}
          />
        </div>
        <Checkbox
          isSelected={showArchived}
          onValueChange={setShowArchived}
          classNames={{ base: "text-sm text-default-600" }}
        >
          {t("unitsPage.showArchived")}
        </Checkbox>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.property")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.unitType")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.occupancyStatus")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.operationalStatus")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.askingRent")}</th>
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
                    {t("unitsPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 text-xs font-mono text-default-600">{u.code}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/real-estate/units/${u.id}`} className="text-primary font-medium text-sm">
                        {u.name}
                      </Link>
                      {u.maintenanceHold && (
                        <Wrench className="w-3.5 h-3.5 inline ms-1.5 text-primary" aria-label={t("dashboard.underMaintenance")} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-default-500">
                      <Link to={`/real-estate/properties/${u.propertyId}`} className="hover:underline">
                        {propertyName(u.propertyId)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{t(`unitType.${u.unitType}`)}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={OCCUPANCY_COLORS[u.occupancyStatus]}>
                        {t(`occupancyStatus.${u.occupancyStatus}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <Chip size="sm" variant="flat" color={UNIT_OPERATIONAL_COLORS[u.operationalStatus]}>
                          {t(`operationalStatus.${u.operationalStatus}`)}
                        </Chip>
                        {u.archived && (
                          <Chip size="sm" variant="flat" color="default">
                            {t("misc.archivedBadge")}
                          </Chip>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">
                      {u.askingRent != null ? formatCurrency(u.askingRent, u.currency) : "—"}
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap text-end">
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(u);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                            {!u.archived && (
                              <Button
                                size="sm"
                                variant="light"
                                onPress={() => setHold.mutate({ id: u.id, hold: !u.maintenanceHold })}
                              >
                                {u.maintenanceHold ? t("unitsPage.maintenanceOff") : t("unitsPage.maintenanceOn")}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="light"
                              color={u.archived ? "default" : "warning"}
                              onPress={() =>
                                u.archived
                                  ? setArchived.mutate({ id: u.id, archived: false })
                                  : setArchiving(u)
                              }
                            >
                              {u.archived ? t("buttons.restore") : t("buttons.archive")}
                            </Button>
                          </>
                        )}
                        {canDelete && !u.archived && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(u)}>
                            {t("buttons.delete")}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <UnitFormModal isOpen={formOpen} onOpenChange={setFormOpen} unit={editing} />

      <ConfirmModal
        isOpen={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t("buttons.archive")}
        body={archiving ? `${archiving.code} — ${t("unitsPage.archiveConfirm")}` : ""}
        confirmLabel={t("buttons.archive")}
        cancelLabel={t("buttons.cancel")}
        isLoading={setArchived.isPending}
        onConfirm={async () => {
          if (archiving) {
            await setArchived.mutateAsync({ id: archiving.id, archived: true });
            setArchiving(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("buttons.delete")}
        body={deleting ? `${deleting.code} — ${t("unitsPage.deleteBlocked")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteUnit.isPending}
        onConfirm={onDelete}
      />
    </div>
  );
}
