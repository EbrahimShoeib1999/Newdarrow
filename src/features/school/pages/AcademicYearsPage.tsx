import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Plus, Search, CalendarClock } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAcademicYears, useAcademicYearsEntity } from "../hooks/use-school";
import { AcademicYearFormModal } from "../components/AcademicYearFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import { formatDate } from "@/lib/utils";
import type { AcademicYear } from "../types/school.types";

const STATUS_COLORS: Record<string, "default" | "success" | "warning"> = {
  planned: "default", active: "success", closed: "warning",
};

export function AcademicYearsPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: years = [], isLoading } = useAcademicYears();
  const removeMut = useAcademicYearsEntity.useRemove();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [deleting, setDeleting] = useState<AcademicYear | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return years.filter((y) => !term || y.name.toLowerCase().includes(term));
  }, [years, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            {t("academicYearsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("academicYearsPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button color="primary" startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setEditing(null); setFormOpen(true); }}>
            {t("buttons.new")}
          </Button>
        )}
      </div>

      <Input placeholder={t("buttons.search")} value={search} onValueChange={setSearch}
        startContent={<Search className="w-4 h-4 text-default-400" />} className="max-w-xs" />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.startDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.endDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-default-400">{t("academicYearsPage.empty")}</td></tr>
              ) : rows.map((y) => (
                <tr key={y.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{y.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{formatDate(y.startDate)}</td>
                  <td className="px-4 py-2.5 text-default-600">{formatDate(y.endDate)}</td>
                  <td className="px-4 py-2.5">
                    <Chip size="sm" variant="flat" color={STATUS_COLORS[y.status]}>{t(`status.${y.status}`)}</Chip>
                  </td>
                  {(canManage || canDelete) && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {canManage && <Button size="sm" variant="light" onPress={() => { setEditing(y); setFormOpen(true); }}>{t("buttons.edit")}</Button>}
                      {canDelete && <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(y)}>{t("buttons.delete")}</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <AcademicYearFormModal isOpen={formOpen} onOpenChange={setFormOpen} year={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("academicYearsPage.title")}
        body={deleting ? `${deleting.name} — ${t("academicYearsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
