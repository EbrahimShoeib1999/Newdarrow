import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Checkbox, Chip, Input } from "@heroui/react";
import { Home, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatDate } from "@/lib/utils";
import {
  useDeletePropertyMutation,
  useProperties,
  useSetPropertyArchivedMutation,
  useUnits,
} from "../hooks/use-real-estate";
import { PROPERTY_STATUS_COLORS, remErrorText, remName } from "../lib/ui-maps";
import { PropertyFormModal } from "../components/PropertyFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { Property } from "../types/real-estate.types";

export function PropertiesListPage() {
  const { t, i18n } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canManage = can("real_estate.create");
  const canDelete = can("real_estate.delete");

  const { data: properties = [], isLoading } = useProperties();
  const { data: units = [] } = useUnits();
  const setArchived = useSetPropertyArchivedMutation();
  const deleteProperty = useDeletePropertyMutation();

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [archiving, setArchiving] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<Property | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return properties.filter(
      (p) =>
        (showArchived || !p.archived) &&
        (!term ||
          p.code.toLowerCase().includes(term) ||
          (p.nameEn ?? "").toLowerCase().includes(term) ||
          (p.nameAr ?? "").toLowerCase().includes(term) ||
          (p.city ?? "").toLowerCase().includes(term)),
    );
  }, [properties, search, showArchived]);

  const unitCountFor = (id: string) => units.filter((u) => u.propertyId === id && !u.archived).length;

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await deleteProperty.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (e) {
      // Service refuses deletion when linked records exist — archive instead.
      toast.error(remErrorText(t, e));
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Home className="w-6 h-6 text-primary" />
            {t("propertiesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("propertiesPage.subtitle")}</p>
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

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-sm"
        />
        <Checkbox
          isSelected={showArchived}
          onValueChange={setShowArchived}
          classNames={{ base: "text-sm text-default-600" }}
        >
          {t("propertiesPage.showArchived")}
        </Checkbox>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.propertyType")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.city")}</th>
                <th className="px-4 py-2.5 text-start">{t("propertiesPage.unitsCount")}</th>
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
                    {t("propertiesPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                    <td className="px-4 py-2.5 text-xs font-mono text-default-600">{p.code}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/real-estate/properties/${p.id}`} className="text-primary font-medium text-sm">
                        {remName(i18n.language, p)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-sm">{t(`propertyType.${p.propertyType}`)}</td>
                    <td className="px-4 py-2.5 text-sm text-default-500">{p.city || "—"}</td>
                    <td className="px-4 py-2.5 text-sm tabular-nums">{unitCountFor(p.id)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <Chip size="sm" variant="flat" color={PROPERTY_STATUS_COLORS[p.status]}>
                          {t(`propertyStatus.${p.status}`)}
                        </Chip>
                        {p.archived && (
                          <Chip size="sm" variant="flat" color="default">
                            {t("misc.archivedBadge")}
                          </Chip>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(p.createdAt)}</td>
                    {(canManage || canDelete) && (
                      <td className="px-4 py-2.5 whitespace-nowrap text-end">
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => {
                                setEditing(p);
                                setFormOpen(true);
                              }}
                            >
                              {t("buttons.edit")}
                            </Button>
                            <Button
                              size="sm"
                              variant="light"
                              color={p.archived ? "default" : "warning"}
                              onPress={() => p.archived ? setArchived.mutate({ id: p.id, archived: false }) : setArchiving(p)}
                            >
                              {p.archived ? t("buttons.restore") : t("buttons.archive")}
                            </Button>
                          </>
                        )}
                        {canDelete && !p.archived && (
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(p)}>
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

      <PropertyFormModal isOpen={formOpen} onOpenChange={setFormOpen} property={editing} />

      <ConfirmModal
        isOpen={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t("buttons.archive")}
        body={archiving ? `${archiving.code} — ${t("propertiesPage.archiveConfirm")}` : ""}
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
        body={deleting ? `${deleting.code} — ${t("propertiesPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteProperty.isPending}
        onConfirm={onDelete}
      />
    </div>
  );
}
