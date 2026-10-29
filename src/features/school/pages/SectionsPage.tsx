import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Search, FolderOpen } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { localizedName } from "@/lib/localized-name";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useSections, useGrades, useStudents, useSectionsEntity } from "../hooks/use-school";
import { SectionFormModal } from "../components/SectionFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import type { Section } from "../types/school.types";

export function SectionsPage() {
  const { t, i18n } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: sections = [], isLoading } = useSections();
  const { data: grades = [] } = useGrades();
  const { data: students = [] } = useStudents();
  const { data: allUsers = [] } = useAllUsers();
  const removeMut = useSectionsEntity.useRemove();

  const gradeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grades) m.set(g.id, g.name);
    return m;
  }, [grades]);

  const teacherName = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUsers) m.set(u.id, localizedName(i18n.language, u));
    return m;
  }, [allUsers, i18n.language]);

  const studentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of students) {
      if (s.sectionId) m.set(s.sectionId, (m.get(s.sectionId) ?? 0) + 1);
    }
    return m;
  }, [students]);

  const [gradeFilter, setGradeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Section | null>(null);
  const [deleting, setDeleting] = useState<Section | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sections
      .filter((s) => !gradeFilter || s.gradeId === gradeFilter)
      .filter((s) => !term || s.name.toLowerCase().includes(term));
  }, [sections, gradeFilter, search]);

  const gradeFilterOptions = useMemo(
    () => [{ id: "", label: t("studentsPage.allGrades") }, ...grades.map((g) => ({ id: g.id, label: g.name }))],
    [grades, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <FolderOpen className="w-6 h-6 text-primary" />{t("sectionsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("sectionsPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button color="primary" startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setEditing(null); setFormOpen(true); }}>{t("buttons.new")}</Button>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select {...selectFieldProps()} label={t("fields.grade")}
          selectedKeys={gradeFilter ? [gradeFilter] : []}
          onSelectionChange={(keys) => setGradeFilter((Array.from(keys)[0] as string) ?? "")}
          className="w-48">
          {gradeFilterOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
        </Select>
        <Input placeholder={t("buttons.search")} value={search} onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />} className="max-w-xs" />
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.grade")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.teacher")}</th>
                <th className="px-4 py-2.5 text-start">{t("sectionsPage.studentCount")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.capacity")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">{t("sectionsPage.empty")}</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{gradeName.get(s.gradeId) ?? "—"}</td>
                  <td className="px-4 py-2.5 text-default-600">{s.teacherId ? (teacherName.get(s.teacherId) ?? "—") : "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{studentCount.get(s.id) ?? 0}</td>
                  <td className="px-4 py-2.5 tabular-nums text-default-600">{s.capacity ?? "—"}</td>
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

      <SectionFormModal isOpen={formOpen} onOpenChange={setFormOpen} section={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("sectionsPage.title")}
        body={deleting ? `${deleting.name} — ${t("sectionsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
