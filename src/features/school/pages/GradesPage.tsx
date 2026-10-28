import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Input } from "@heroui/react";
import { Plus, Search, Layers } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useGrades, useGradesEntity } from "../hooks/use-school";
import { GradeFormModal } from "../components/GradeFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import type { Grade } from "../types/school.types";

export function GradesPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: grades = [], isLoading } = useGrades();
  const removeMut = useGradesEntity.useRemove();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Grade | null>(null);
  const [deleting, setDeleting] = useState<Grade | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return grades
      .filter((g) => !term || g.name.toLowerCase().includes(term) || (g.code ?? "").toLowerCase().includes(term))
      .sort((a, b) => a.level - b.level);
  }, [grades, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />{t("gradesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("gradesPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button color="primary" startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setEditing(null); setFormOpen(true); }}>{t("buttons.new")}</Button>
        )}
      </div>

      <Input placeholder={t("buttons.search")} value={search} onValueChange={setSearch}
        startContent={<Search className="w-4 h-4 text-default-400" />} className="max-w-xs" />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.level")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-default-400">{t("gradesPage.empty")}</td></tr>
              ) : rows.map((g) => (
                <tr key={g.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 tabular-nums text-default-600">{g.level}</td>
                  <td className="px-4 py-2.5 font-medium text-default-800">{g.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{g.code ?? "—"}</td>
                  {(canManage || canDelete) && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {canManage && <Button size="sm" variant="light" onPress={() => { setEditing(g); setFormOpen(true); }}>{t("buttons.edit")}</Button>}
                      {canDelete && <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(g)}>{t("buttons.delete")}</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <GradeFormModal isOpen={formOpen} onOpenChange={setFormOpen} grade={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("gradesPage.title")}
        body={deleting ? `${deleting.name} — ${t("gradesPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
