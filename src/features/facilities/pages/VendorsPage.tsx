import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Plus, Search, Truck } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useDeleteVendorMutation, useVendors, useWorkOrders } from "../hooks/use-facilities";
import { VendorFormModal } from "../components/VendorFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Vendor } from "../types/facilities.types";

export function VendorsPage() {
  const { t } = useTranslation("facilities");
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");
  const canDelete = can("facilities.delete");

  const { data: vendors = [], isLoading } = useVendors();
  const { data: workOrders = [] } = useWorkOrders();
  const deleteVendor = useDeleteVendorMutation();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);

  const woCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workOrders) {
      if (w.vendorId) map.set(w.vendorId, (map.get(w.vendorId) ?? 0) + 1);
    }
    return map;
  }, [workOrders]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (!term) return true;
      return (
        v.name.toLowerCase().includes(term) ||
        (v.contactName ?? "").toLowerCase().includes(term) ||
        (v.phone ?? "").toLowerCase().includes(term) ||
        (v.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [vendors, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" />
            {t("vendorsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("vendorsPage.subtitle")}</p>
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
        className="max-w-xs"
      />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.category")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.contactName")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.phone")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.email")}</th>
                <th className="px-4 py-2.5 text-start">{t("vendorsPage.wosCount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.active")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("vendorsPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr key={v.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 text-sm font-medium text-default-800">{v.name}</td>
                    <td className="px-4 py-2.5 text-sm">{t(`assetCategory.${v.category}`)}</td>
                    <td className="px-4 py-2.5 text-sm text-default-600">{v.contactName || "—"}</td>
                    <td className="px-4 py-2.5 text-sm text-default-600" dir="ltr">
                      {v.phone || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-default-600" dir="ltr">
                      {v.email || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">{woCount.get(v.id) ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={v.active ? "success" : "default"}>
                        {v.active ? t("lifecycle.active") : t("lifecycle.retired")}
                      </Chip>
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {canManage && (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => {
                              setEditing(v);
                              setFormOpen(true);
                            }}
                          >
                            {t("buttons.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(v)}>
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

      <VendorFormModal isOpen={formOpen} onOpenChange={setFormOpen} vendor={editing} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("vendorsPage.title")}
        body={deleting ? `${deleting.name} — ${t("vendorsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteVendor.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteVendor.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
