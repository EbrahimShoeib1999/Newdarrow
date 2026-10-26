import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Building, Plus, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import {
  useFacilities,
  useAssets,
  useWorkOrders,
  useDeleteFacilityMutation,
} from "../hooks/use-facilities";
import { FACILITY_STATUS_COLORS } from "../lib/ui-maps";
import { FacilityFormModal } from "../components/FacilityFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { formatDate } from "@/lib/utils";
import type { Facility } from "../types/facilities.types";

export function FacilitiesListPage() {
  const { t } = useTranslation("facilities");
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");
  const canDelete = can("facilities.delete");

  const { data: facilities = [], isLoading } = useFacilities();
  const { data: assets = [] } = useAssets();
  const { data: workOrders = [] } = useWorkOrders();
  const deleteFacility = useDeleteFacilityMutation();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [deleting, setDeleting] = useState<Facility | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return facilities.filter(
      (f) =>
        !term ||
        f.name.toLowerCase().includes(term) ||
        (f.location ?? "").toLowerCase().includes(term),
    );
  }, [facilities, search]);

  const openCountFor = (id: string) =>
    workOrders.filter(
      (w) => w.facilityId === id && w.status !== "completed" && w.status !== "cancelled",
    ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Building className="w-6 h-6 text-primary" />
            {t("facilitiesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("facilitiesPage.subtitle")}</p>
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

      <Input
        placeholder={t("buttons.search")}
        value={search}
        onValueChange={setSearch}
        startContent={<Search className="w-4 h-4 text-default-400" />}
        className="max-w-sm"
      />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.kind")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.location")}</th>
                <th className="px-4 py-2.5 text-start">{t("facilitiesPage.assetsCount")}</th>
                <th className="px-4 py-2.5 text-start">{t("facilitiesPage.openWosCount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.createdAt")}</th>
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
                    {t("facilitiesPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((f) => (
                  <tr key={f.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60 cursor-pointer">
                    <td className="px-4 py-2.5">
                      <Link to={`/facilities/facilities/${f.id}`} className="text-primary font-medium text-sm">
                        {f.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{t(`facilityKind.${f.kind}`)}</td>
                    <td className="px-4 py-2.5 text-sm text-default-500">{f.location || "—"}</td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">
                      {assets.filter((a) => a.facilityId === f.id).length}
                    </td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">{openCountFor(f.id)}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={FACILITY_STATUS_COLORS[f.status]}>
                        {t(`facilityStatus.${f.status}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(f.createdAt)}</td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {canManage && (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => {
                              setEditing(f);
                              setFormOpen(true);
                            }}
                          >
                            {t("buttons.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(f)}>
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

      <FacilityFormModal isOpen={formOpen} onOpenChange={setFormOpen} facility={editing} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("facilitiesPage.title")}
        body={deleting ? `${deleting.name} — ${t("facilitiesPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteFacility.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteFacility.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
