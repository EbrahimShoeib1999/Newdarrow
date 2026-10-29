import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider } from "@heroui/react";
import { ArrowLeft, Building2, Home, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  useBuildings,
  useDeleteBuildingMutation,
  useDeletePropertyMutation,
  useDeleteOwnershipMutation,
  useOwnershipsForProperty,
  useProperty,
  useSetBuildingArchivedMutation,
  useUnits,
} from "../hooks/use-real-estate";
import { PROPERTY_STATUS_COLORS, OCCUPANCY_COLORS, remErrorText, remName } from "../lib/ui-maps";
import { BuildingFormModal } from "../components/BuildingFormModal";
import { OwnershipFormModal } from "../components/OwnershipFormModal";
import { UnitFormModal } from "../components/UnitFormModal";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Building, Ownership } from "../types/real-estate.types";

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-default-800">{title}</h2>
          {action}
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

/** Small labelled value cell for the overview grid. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-default-400">{label}</p>
      <p className="text-sm text-default-800 mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export function PropertyDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canManage = can("real_estate.create");
  const canDelete = can("real_estate.delete");

  const { data: property, isLoading } = useProperty(id);
  const { data: allBuildings = [] } = useBuildings();
  const { data: allUnits = [] } = useUnits();
  const { data: ownerships = [] } = useOwnershipsForProperty(id);
  const { data: allUsers = [] } = useAllUsers();

  const setBuildingArchived = useSetBuildingArchivedMutation();
  const deleteBuilding = useDeleteBuildingMutation();
  const deleteProperty = useDeletePropertyMutation();
  const deleteOwnership = useDeleteOwnershipMutation();

  const [buildingModalOpen, setBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);
  const [ownershipModalOpen, setOwnershipModalOpen] = useState(false);
  const [editingOwnership, setEditingOwnership] = useState<Ownership | null>(null);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [archivingBuilding, setArchivingBuilding] = useState<Building | null>(null);
  const [deletingBuilding, setDeletingBuilding] = useState<Building | null>(null);
  const [removingProperty, setRemovingProperty] = useState(false);
  const [deletingOwnership, setDeletingOwnership] = useState<Ownership | null>(null);

  const buildings = useMemo(
    () => allBuildings.filter((b) => b.propertyId === id),
    [allBuildings, id],
  );
  const units = useMemo(() => allUnits.filter((u) => u.propertyId === id), [allUnits, id]);
  const sharesTotal = useMemo(
    () => Math.round(ownerships.reduce((s, o) => s + (Number.isFinite(o.percentage) ? o.percentage : 0), 0) * 100) / 100,
    [ownerships],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-default-500">{t("validation.propertyNotFound")}</p>
        <Button as={Link} to="/real-estate/properties" variant="flat">
          {t("propertyProfile.backToProperties")}
        </Button>
      </div>
    );
  }

  const address = [property.country, property.city, property.district, property.street]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <Button as={Link} to="/real-estate/properties" size="sm" variant="light" startContent={<ArrowLeft className="w-4 h-4" />}>
            {t("propertyProfile.backToProperties")}
          </Button>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2 mt-2">
            <Home className="w-6 h-6 text-primary" />
            {remName(i18n.language, property)}
            <span className="text-sm font-mono text-default-400">{property.code}</span>
            <Chip size="sm" variant="flat" color={PROPERTY_STATUS_COLORS[property.status]}>
              {t(`propertyStatus.${property.status}`)}
            </Chip>
            {property.archived && (
              <Chip size="sm" variant="flat" color="default">
                {t("misc.archivedBadge")}
              </Chip>
            )}
          </h1>
        </div>
        <div className="flex gap-2">
          {canManage && (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<Plus className="w-4 h-4" />}
              onPress={() => setUnitModalOpen(true)}
            >
              {t("unitsPage.formNew")}
            </Button>
          )}
          {canDelete && (
            <Button size="sm" color="danger" variant="light" onPress={() => setRemovingProperty(true)}>
              {t("buttons.delete")}
            </Button>
          )}
        </div>
      </div>

      {/* Overview */}
      <Card>
        <CardBody className="gap-4">
          <h2 className="text-base font-semibold text-default-800">{t("propertyProfile.details")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label={t("fields.propertyType")} value={t(`propertyType.${property.propertyType}`)} />
            <Field label={t("fields.country")} value={property.country} />
            <Field label={t("fields.city")} value={property.city} />
            <Field label={t("fields.manager")} value={(() => { const u = allUsers.find((x) => x.id === property.managerId); return u ? localizedName(i18n.language, u) || u.name : "—"; })()} />
            <Field label={t("fields.totalArea")} value={property.totalArea != null ? `${property.totalArea} ${t(`areaUnit.${property.areaUnit}`)}` : "—"} />
            <Field label={t("fields.commonArea")} value={property.commonArea != null ? `${property.commonArea} ${t(`areaUnit.${property.areaUnit}`)}` : "—"} />
            <Field label={t("fields.acquisitionPrice")} value={property.acquisitionPrice != null ? formatCurrency(property.acquisitionPrice, property.currency) : "—"} />
            <Field label={t("fields.valuation")} value={property.valuation != null ? formatCurrency(property.valuation, property.currency) : "—"} />
          </div>
          {address && <p className="text-sm text-default-500">{address}</p>}
          {property.notes && <p className="text-sm text-default-600 whitespace-pre-line">{property.notes}</p>}
        </CardBody>
      </Card>

      {/* Buildings & floors */}
      <SectionCard
        title={t("buildingsSection.title")}
        action={
          canManage && (
            <Button
              size="sm"
              variant="flat"
              startContent={<Plus className="w-4 h-4" />}
              onPress={() => {
                setEditingBuilding(null);
                setBuildingModalOpen(true);
              }}
            >
              {t("buildingsSection.add")}
            </Button>
          )
        }
      >
        <p className="text-xs text-default-400">{t("buildingsSection.subtitle")}</p>
        {buildings.length === 0 ? (
          <p className="text-sm text-default-400">{t("buildingsSection.empty")}</p>
        ) : (
          <div className="space-y-2">
            {buildings.map((b) => (
              <div key={b.id} className="flex flex-col sm:flex-row sm:items-center gap-2 border border-default-200 rounded-lg p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-default-800 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" />
                    {remName(i18n.language, b)}
                    <span className="text-xs font-mono text-default-400">{b.code}</span>
                    {b.archived && (
                      <Chip size="sm" variant="flat" color="default">
                        {t("misc.archivedBadge")}
                      </Chip>
                    )}
                  </p>
                  <p className="text-xs text-default-500 mt-1">
                    {t("buildingsSection.floors")}:{" "}
                    {b.floors.length === 0 ? t("misc.noData") : b.floors.map((f) => f.nameEn).join(", ")}
                    {" · "}
                    {t("buildingsSection.unitCount")}: {b.unitCount}
                  </p>
                </div>
                {(canManage || canDelete) && !b.archived && (
                  <div className="flex gap-1">
                    {canManage && (
                      <>
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            setEditingBuilding(b);
                            setBuildingModalOpen(true);
                          }}
                        >
                          {t("buttons.edit")}
                        </Button>
                        <Button size="sm" variant="light" color="warning" onPress={() => setArchivingBuilding(b)}>
                          {t("buttons.archive")}
                        </Button>
                      </>
                    )}
                    {canDelete && b.unitCount === 0 && (
                      <Button size="sm" variant="light" color="danger" onPress={() => setDeletingBuilding(b)}>
                        {t("buttons.delete")}
                      </Button>
                    )}
                  </div>
                )}
                {canManage && b.archived && (
                  <Button
                    size="sm"
                    variant="light"
                    onPress={() => setBuildingArchived.mutate({ id: b.id, archived: false })}
                  >
                    {t("buttons.restore")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Divider />

      {/* Owners & ownership */}
      <SectionCard
        title={t("propertyProfile.owners")}
        action={
          canManage && (
            <Button
              size="sm"
              variant="flat"
              startContent={<UserRound className="w-4 h-4" />}
              onPress={() => {
                setEditingOwnership(null);
                setOwnershipModalOpen(true);
              }}
            >
              {t("propertyProfile.addOwner")}
            </Button>
          )
        }
      >
        {ownerships.length === 0 ? (
          <p className="text-sm text-default-400">{t("propertyProfile.ownersEmpty")}</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                  <th className="px-2 py-2 text-start">{t("propertyProfile.contact")}</th>
                  <th className="px-2 py-2 text-start">{t("propertyProfile.ownerType")}</th>
                  <th className="px-2 py-2 text-start">{t("propertyProfile.percentage")}</th>
                  <th className="px-2 py-2 text-start">{t("propertyProfile.startDate")}</th>
                  <th className="px-2 py-2 text-start">{t("propertyProfile.endDate")}</th>
                  {(canManage || canDelete) && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {ownerships.map((o) => (
                  <tr key={o.id} className="border-b border-default-100 last:border-0">
                    <td className="px-2 py-2">{o.displayNameSnapshot || o.contactId}</td>
                    <td className="px-2 py-2">{t(`ownerType.${o.ownerType}`)}</td>
                    <td className="px-2 py-2 tabular-nums">{o.percentage}%</td>
                    <td className="px-2 py-2 text-xs text-default-500">{o.startDate ? formatDate(o.startDate) : "—"}</td>
                    <td className="px-2 py-2 text-xs text-default-500">{o.endDate ? formatDate(o.endDate) : "—"}</td>
                    {(canManage || canDelete) && (
                      <td className="px-2 py-2 whitespace-nowrap text-end">
                        {canManage && (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => {
                              setEditingOwnership(o);
                              setOwnershipModalOpen(true);
                            }}
                          >
                            {t("buttons.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeletingOwnership(o)}>
                            {t("buttons.delete")}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`text-xs ${sharesTotal === 100 ? "text-default-500" : "text-warning-600"}`}>
              {t("propertyProfile.sharesTotal")}: {sharesTotal}%
              {sharesTotal !== 100 && ` — ${t("propertyProfile.sharesMust100")}`}
            </p>
          </>
        )}
      </SectionCard>

      <Divider />

      {/* Units in this property */}
      <SectionCard title={t("propertyProfile.unitsSection")}>
        {units.length === 0 ? (
          <p className="text-sm text-default-400">{t("propertyProfile.unitsEmpty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                <th className="px-2 py-2 text-start">{t("fields.code")}</th>
                <th className="px-2 py-2 text-start">{t("fields.name")}</th>
                <th className="px-2 py-2 text-start">{t("fields.unitType")}</th>
                <th className="px-2 py-2 text-start">{t("fields.occupancyStatus")}</th>
                <th className="px-2 py-2 text-start">{t("fields.askingRent")}</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-b border-default-100 last:border-0">
                  <td className="px-2 py-2 text-xs font-mono text-default-600">{u.code}</td>
                  <td className="px-2 py-2">
                    <Link to={`/real-estate/units/${u.id}`} className="text-primary font-medium">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{t(`unitType.${u.unitType}`)}</td>
                  <td className="px-2 py-2">
                    <Chip size="sm" variant="flat" color={OCCUPANCY_COLORS[u.occupancyStatus]}>
                      {t(`occupancyStatus.${u.occupancyStatus}`)}
                    </Chip>
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {u.askingRent != null ? formatCurrency(u.askingRent, u.currency) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Documents — managed panel in the activity-owned Storage partition */}
      <DocumentsPanel entityType="property" entityId={property.id} />

      <BuildingFormModal
        isOpen={buildingModalOpen}
        onOpenChange={setBuildingModalOpen}
        building={editingBuilding}
        lockedPropertyId={id}
      />
      <OwnershipFormModal
        isOpen={ownershipModalOpen}
        onOpenChange={setOwnershipModalOpen}
        propertyId={id}
        ownership={editingOwnership}
      />
      <UnitFormModal isOpen={unitModalOpen} onOpenChange={setUnitModalOpen} lockedPropertyId={id} />

      <ConfirmModal
        isOpen={!!archivingBuilding}
        onOpenChange={(o) => !o && setArchivingBuilding(null)}
        title={t("buttons.archive")}
        body={archivingBuilding ? `${archivingBuilding.nameEn} — ${t("buildingsSection.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.archive")}
        cancelLabel={t("buttons.cancel")}
        isLoading={setBuildingArchived.isPending}
        onConfirm={async () => {
          if (archivingBuilding) {
            await setBuildingArchived.mutateAsync({ id: archivingBuilding.id, archived: true });
            setArchivingBuilding(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={!!deletingBuilding}
        onOpenChange={(o) => !o && setDeletingBuilding(null)}
        title={t("buttons.delete")}
        body={deletingBuilding ? `${deletingBuilding.nameEn} — ${t("buildingsSection.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteBuilding.isPending}
        onConfirm={async () => {
          if (deletingBuilding) {
            try {
              await deleteBuilding.mutateAsync(deletingBuilding.id);
            } catch (e) {
              // Race with a unit being assigned: the service keeps the record.
              toast.error(remErrorText(t, e));
            }
            setDeletingBuilding(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={!!deletingOwnership}
        onOpenChange={(o) => !o && setDeletingOwnership(null)}
        title={t("buttons.delete")}
        body={t("propertyProfile.deleteOwnershipConfirm")}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteOwnership.isPending}
        onConfirm={async () => {
          if (deletingOwnership) {
            await deleteOwnership.mutateAsync(deletingOwnership.id);
            setDeletingOwnership(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={removingProperty}
        onOpenChange={(o) => !o && setRemovingProperty(false)}
        title={t("buttons.delete")}
        body={`${property.code} — ${t("propertiesPage.deleteConfirm")}`}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteProperty.isPending}
        onConfirm={async () => {
          try {
            await deleteProperty.mutateAsync(property.id);
            setRemovingProperty(false);
          } catch (e) {
            // Service refuses when linked records exist — archive instead.
            toast.error(remErrorText(t, e));
            setRemovingProperty(false);
          }
        }}
      />
    </div>
  );
}
