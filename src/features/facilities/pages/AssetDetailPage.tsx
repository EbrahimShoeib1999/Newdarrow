import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";
import { ArrowLeft, Package } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAsset, useFacilities, useWorkOrders, usePmSchedules } from "../hooks/use-facilities";
import {
  ASSET_CONDITION_COLORS,
  ASSET_LIFECYCLE_COLORS,
  WO_STATUS_COLORS,
  DUE_STATE_COLORS,
  nameOf,
} from "../lib/ui-maps";
import { scheduleDueState } from "../lib/work-order-rules";
import { AssetFormModal } from "../components/AssetFormModal";
import { formatCurrency, formatDate } from "@/lib/utils";

export function AssetDetailPage() {
  const { t } = useTranslation("facilities");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");

  const { data: asset, isLoading } = useAsset(id);
  const { data: facilities = [] } = useFacilities();
  const { data: workOrders = [] } = useWorkOrders();
  const { data: schedules = [] } = usePmSchedules();
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <p className="py-10 text-center text-sm text-default-400">…</p>;
  if (!asset) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-sm text-default-500">{t("assetsPage.notFound")}</p>
        <Button variant="light" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate("/facilities/assets")}>
          {t("buttons.back")}
        </Button>
      </div>
    );
  }

  const assetWos = workOrders.filter((w) => w.assetId === asset.id);
  const assetSchedules = schedules.filter((s) => s.assetId === asset.id);
  const facilityLabel = asset.facilityId
    ? nameOf(facilities, asset.facilityId) ?? t("misc.removedRef")
    : t("misc.unlocated");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="flat" onPress={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            {asset.name}
          </h1>
          <Chip size="sm" variant="flat">{asset.tag}</Chip>
          {asset.lifecycle === "retired" && (
            <Chip size="sm" variant="flat" color="default">{t("assetsPage.retiredBadge")}</Chip>
          )}
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
            <p className="text-xs text-default-400">{t("fields.category")}</p>
            <p className="font-medium text-default-800">{t(`assetCategory.${asset.category}`)}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.facility")}</p>
            <p className="font-medium text-default-800">{facilityLabel}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.location")}</p>
            <p className="font-medium text-default-800">{asset.location || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.condition")}</p>
            <Chip size="sm" variant="flat" color={ASSET_CONDITION_COLORS[asset.condition]}>
              {t(`assetCondition.${asset.condition}`)}
            </Chip>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.lifecycle")}</p>
            <Chip size="sm" variant="flat" color={ASSET_LIFECYCLE_COLORS[asset.lifecycle]}>
              {t(`lifecycle.${asset.lifecycle}`)}
            </Chip>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.purchaseDate")}</p>
            <p className="font-medium text-default-800">{formatDate(asset.purchaseDate)}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.purchaseCost")}</p>
            <p className="font-medium text-default-800 tabular-nums">
              {asset.purchaseCost != null ? formatCurrency(asset.purchaseCost, asset.currency) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.createdAt")}</p>
            <p className="font-medium text-default-800">{formatDate(asset.createdAt)}</p>
          </div>
          {asset.notes && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-default-400">{t("fields.notes")}</p>
              <p className="text-default-700">{asset.notes}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-base font-semibold">
            {t("workOrdersPage.title")} ({assetWos.length})
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                </tr>
              </thead>
              <tbody>
                {assetWos.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-default-400">—</td>
                  </tr>
                ) : (
                  assetWos.slice(0, 12).map((w) => (
                    <tr key={w.id} className="border-b border-default-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <Link to={`/facilities/work-orders/${w.id}`} className="text-primary text-sm font-medium">
                          {w.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm max-w-[220px] truncate">{w.title}</td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[w.status]}>
                          {t(`status.${w.status}`)}
                        </Chip>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-base font-semibold">
            {t("nav.schedules")} ({assetSchedules.length})
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                  <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.nextDue")}</th>
                  <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                </tr>
              </thead>
              <tbody>
                {assetSchedules.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-default-400">—</td>
                  </tr>
                ) : (
                  assetSchedules.map((s) => {
                    const state = scheduleDueState(s.nextDueDate);
                    return (
                      <tr key={s.id} className="border-b border-default-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <Link to="/facilities/schedules" className="text-primary text-sm font-medium">
                            {s.title}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(s.nextDueDate)}</td>
                        <td className="px-4 py-2.5">
                          <Chip size="sm" variant="flat" color={s.active ? DUE_STATE_COLORS[state] : "default"}>
                            {s.active ? t(`dueState.${state}`) : t("misc.paused")}
                          </Chip>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <AssetFormModal isOpen={editOpen} onOpenChange={setEditOpen} asset={asset} />
    </div>
  );
}
