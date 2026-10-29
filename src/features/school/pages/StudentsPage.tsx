import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Search, GraduationCap } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useStudents, useStudentsEntity, useGrades, useSections, useGuardians } from "../hooks/use-school";
import { StudentFormModal } from "../components/StudentFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import type { Student, StudentStatus } from "../types/school.types";

const STATUS_COLORS: Record<StudentStatus, "default" | "success" | "warning"> = {
  pending: "warning", enrolled: "success", withdrawn: "default",
};

export function StudentsPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: students = [], isLoading } = useStudents();
  const { data: grades = [] } = useGrades();
  const { data: sections = [] } = useSections();
  const { data: guardians = [] } = useGuardians();
  const removeMut = useStudentsEntity.useRemove();

  const gradeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of grades) m.set(g.id, g.name);
    return m;
  }, [grades]);

  const sectionName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) m.set(s.id, s.name);
    return m;
  }, [sections]);

  const guardianName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of guardians) m.set(g.id, g.name);
    return m;
  }, [guardians]);

  const [statusFilter, setStatusFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);

  // Sections filtered by grade for the filter dropdown.
  const filterSections = useMemo(
    () => sections.filter((s) => !gradeFilter || s.gradeId === gradeFilter),
    [sections, gradeFilter],
  );

  const statusFilterOptions = useMemo(
    () => [
      { id: "", label: t("studentsPage.allStatuses") },
      ...(["pending", "enrolled", "withdrawn"] as StudentStatus[]).map((s) => ({ id: s, label: t(`studentStatus.${s}`) })),
    ],
    [t],
  );
  const gradeFilterOptions = useMemo(
    () => [{ id: "", label: t("studentsPage.allGrades") }, ...grades.map((g) => ({ id: g.id, label: g.name }))],
    [grades, t],
  );
  const sectionFilterOptions = useMemo(
    () => [{ id: "", label: t("studentsPage.allSections") }, ...filterSections.map((s) => ({ id: s.id, label: s.name }))],
    [filterSections, t],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students
      .filter((s) => !statusFilter || s.status === statusFilter)
      .filter((s) => !gradeFilter || s.gradeId === gradeFilter)
      .filter((s) => !sectionFilter || s.sectionId === sectionFilter)
      .filter((s) => !term || s.name.toLowerCase().includes(term) || (s.identifier ?? "").toLowerCase().includes(term));
  }, [students, statusFilter, gradeFilter, sectionFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-primary" />{t("studentsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("studentsPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button color="primary" startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setEditing(null); setFormOpen(true); }}>{t("buttons.new")}</Button>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input placeholder={t("buttons.search")} value={search} onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />} className="max-w-xs" />
        <Select {...selectFieldProps()} label={t("studentsPage.filterStatus")}
          selectedKeys={statusFilter ? [statusFilter] : []}
          onSelectionChange={(keys) => setStatusFilter((Array.from(keys)[0] as string) ?? "")}
          className="w-40">
          {statusFilterOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
        </Select>
        <Select {...selectFieldProps()} label={t("studentsPage.filterGrade")}
          selectedKeys={gradeFilter ? [gradeFilter] : []}
          onSelectionChange={(keys) => { setGradeFilter((Array.from(keys)[0] as string) ?? ""); setSectionFilter(""); }}
          className="w-40">
          {gradeFilterOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
        </Select>
        {gradeFilter && (
          <Select {...selectFieldProps()} label={t("studentsPage.filterSection")}
            selectedKeys={sectionFilter ? [sectionFilter] : []}
            onSelectionChange={(keys) => setSectionFilter((Array.from(keys)[0] as string) ?? "")}
            className="w-40">
            {sectionFilterOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
          </Select>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.identifier")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.guardian")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.grade")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.section")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">{t("studentsPage.empty")}</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{s.identifier ?? "—"}</td>
                  <td className="px-4 py-2.5 text-default-600">{guardianName.get(s.guardianId) ?? "—"}</td>
                  <td className="px-4 py-2.5 text-default-600">{s.gradeId ? (gradeName.get(s.gradeId) ?? "—") : "—"}</td>
                  <td className="px-4 py-2.5 text-default-600">{s.sectionId ? (sectionName.get(s.sectionId) ?? "—") : "—"}</td>
                  <td className="px-4 py-2.5">
                    <Chip size="sm" variant="flat" color={STATUS_COLORS[s.status]}>{t(`studentStatus.${s.status}`)}</Chip>
                  </td>
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

      <StudentFormModal isOpen={formOpen} onOpenChange={setFormOpen} student={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("studentsPage.title")}
        body={deleting ? `${deleting.name} — ${t("studentsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
