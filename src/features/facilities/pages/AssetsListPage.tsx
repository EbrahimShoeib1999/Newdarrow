import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem } from "@heroui/react";
import { Package, Plus, Search } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAssets, useFacilities, useDeleteAssetMutation } from "../hooks/use-facilities";
import { ASSET_LIFECYCLE_COLORS, ASSET_CONDITION_COLORS, nameOf } from "../lib/ui-maps";
import { AssetFormModal } from "../components/AssetFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Asset, AssetCondition } from "../types/facilities.types";

export function AssetsListPage() {
  const { t } = useTranslation("facilities");
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");
  const canDelete = can("facilities.delete");

  const { data: assets = [], isLoading } = useAssets();
  const { data: facilities = [] } = useFacilities();
  const deleteAsset = useDeleteAssetMutation();

  const [search, setSearch] = useState("");
  const [condition, setCondition] = useState<AssetCondition | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (condition !== "all" && a.condition !== condition) return false;
      if (!term) return true;
      return (
        a.name.toLowerCase().includes(term) ||
        a.tag.toLowerCase().includes(term) ||
        (a.location ?? "").toLowerCase().includes(term)
      );
    });
  }, [assets, search, condition]);

  const facilityName = (id?: string | null) => {
    if (!id) return t("misc.unlocated");
    return nameOf(facilities, id) ?? t("misc.removedRef");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            {t("assetsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("assetsPage.subtitle")}</p>
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

      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-xs"
        />
        <Select
          {...selectFieldProps()}
          placeholder={t("filters.allConditions")}
          selectedKeys={[condition]}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as AssetCondition | "all" | undefined;
            if (v) setCondition(v);
          }}
          className="max-w-[200px]"
        >
          {(["all", "good", "fair", "poor", "out_of_service"] as const).map((c) => (
            <SelectItem key={c}>
              {c === "all" ? t("filters.allConditions") : t(`assetCondition.${c}`)}
            </SelectItem>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.tag")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.category")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.facility")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.condition")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.lifecycle")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("assetsPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 text-xs text-default-500">{a.tag}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/facilities/assets/${a.id}`} className="text-primary font-medium text-sm">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{t(`assetCategory.${a.category}`)}</td>
                    <td className="px-4 py-2.5 text-sm text-default-500">{facilityName(a.facilityId)}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={ASSET_CONDITION_COLORS[a.condition]}>
                        {t(`assetCondition.${a.condition}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={ASSET_LIFECYCLE_COLORS[a.lifecycle]}>
                        {t(`lifecycle.${a.lifecycle}`)}
                      </Chip>
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {canManage && (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => {
                              setEditing(a);
                              setFormOpen(true);
                            }}
                          >
                            {t("buttons.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(a)}>
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

      <AssetFormModal isOpen={formOpen} onOpenChange={setFormOpen} asset={editing} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("assetsPage.title")}
        body={deleting ? `${deleting.name} — ${t("assetsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteAsset.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteAsset.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
