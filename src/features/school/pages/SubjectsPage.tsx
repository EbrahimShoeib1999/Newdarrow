import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Input } from "@heroui/react";
import { Plus, Search, BookA } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useSubjects, useSubjectsEntity } from "../hooks/use-school";
import { SubjectFormModal } from "../components/SubjectFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import type { Subject } from "../types/school.types";

export function SubjectsPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: subjects = [], isLoading } = useSubjects();
  const removeMut = useSubjectsEntity.useRemove();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return subjects.filter((s) => !term || s.name.toLowerCase().includes(term) || (s.code ?? "").toLowerCase().includes(term));
  }, [subjects, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <BookA className="w-6 h-6 text-primary" />{t("subjectsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("subjectsPage.subtitle")}</p>
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
          <table className="w-full min-w-[400px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-default-400">{t("subjectsPage.empty")}</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{s.code ?? "—"}</td>
                  {(canManage || canDelete) && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {canManage && <Button size="sm" variant="light" onPress={() => { setEditing(s); setFormOpen(true); }}>{t("buttons.edit")}</Button>}
                      {canDelete && <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(s)}>{t("buttons.delete")}</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <SubjectFormModal isOpen={formOpen} onOpenChange={setFormOpen} subject={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("subjectsPage.title")}
        body={deleting ? `${deleting.name} — ${t("subjectsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
