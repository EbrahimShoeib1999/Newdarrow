import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { ArrowLeft, Building } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useFacility, useAssets, useWorkOrders, usePmSchedules } from "../hooks/use-facilities";
import { FACILITY_STATUS_COLORS, WO_STATUS_COLORS } from "../lib/ui-maps";
import { FacilityFormModal } from "../components/FacilityFormModal";
import { formatCurrency, formatDate } from "@/lib/utils";

export function FacilityDetailPage() {
  const { t } = useTranslation("facilities");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");

  const { data: facility, isLoading } = useFacility(id);
  const { data: assets = [] } = useAssets();
  const { data: workOrders = [] } = useWorkOrders();
  const { data: schedules = [] } = usePmSchedules();
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <p className="py-10 text-center text-sm text-default-400">…</p>;
  if (!facility) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-sm text-default-500">{t("facilitiesPage.notFound")}</p>
        <Button
          variant="light"
          startContent={<ArrowLeft className="w-4 h-4" />}
          onPress={() => navigate("/facilities/facilities")}
        >
          {t("buttons.back")}
        </Button>
      </div>
    );
  }

  const facilityAssets = assets.filter((a) => a.facilityId === facility.id);
  const facilityWos = workOrders.filter((w) => w.facilityId === facility.id);
  const facilitySchedules = schedules.filter((s) => s.facilityId === facility.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="flat" onPress={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Building className="w-6 h-6 text-primary" />
            {facility.name}
          </h1>
          <Chip size="sm" variant="flat" color={FACILITY_STATUS_COLORS[facility.status]}>
            {t(`facilityStatus.${facility.status}`)}
          </Chip>
        </div>
        {canManage && (
          <Button color="primary" variant="flat" onPress={() => setEditOpen(true)}>
            {t("buttons.edit")}
          </Button>
        )}
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-default-400">{t("fields.kind")}</p>
            <p className="font-medium text-default-800">{t(`facilityKind.${facility.kind}`)}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.location")}</p>
            <p className="font-medium text-default-800">{facility.location || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.area")}</p>
            <p className="font-medium text-default-800 tabular-nums">
              {facility.area != null ? `${facility.area} m²` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.createdAt")}</p>
            <p className="font-medium text-default-800">{formatDate(facility.createdAt)}</p>
          </div>
          {facility.notes && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-default-400">{t("fields.notes")}</p>
              <p className="text-default-700">{facility.notes}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-base font-semibold">
            {t("facilitiesPage.assetsCount")} ({facilityAssets.length})
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.tag")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.condition")}</th>
                </tr>
              </thead>
              <tbody>
                {facilityAssets.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-default-400">—</td>
                  </tr>
                ) : (
                  facilityAssets.map((a) => (
                    <tr key={a.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2.5 text-xs text-default-500">{a.tag}</td>
                      <td className="px-4 py-2.5">
                        <Link to={`/facilities/assets/${a.id}`} className="text-primary text-sm font-medium">
                          {a.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm">{t(`assetCondition.${a.condition}`)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-base font-semibold">
            {t("facilitiesPage.openWosCount")} ({facilityWos.filter((w) => w.status !== "completed" && w.status !== "cancelled").length})
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.totalCost")}</th>
                </tr>
              </thead>
              <tbody>
                {facilityWos.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-default-400">—</td>
                  </tr>
                ) : (
                  facilityWos.slice(0, 12).map((w) => (
                    <tr key={w.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <Link to={`/facilities/work-orders/${w.id}`} className="text-primary text-sm font-medium">
                          {w.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm max-w-[200px] truncate">{w.title}</td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[w.status]}>
                          {t(`status.${w.status}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-sm tabular-nums">
                        {formatCurrency((w.partsCost ?? 0) + (w.laborCost ?? 0), w.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {facilitySchedules.length > 0 && (
        <Card>
          <CardHeader className="text-base font-semibold">
            {t("nav.schedules")} ({facilitySchedules.length})
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {facilitySchedules.map((s) => (
              <Link
                key={s.id}
                to="/facilities/schedules"
                className="inline-flex items-center rounded-full px-3 py-1 text-xs bg-default-100 text-default-700 hover:bg-default-200"
              >
                {s.title}
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <FacilityFormModal isOpen={editOpen} onOpenChange={setEditOpen} facility={facility} />
    </div>
  );
}
