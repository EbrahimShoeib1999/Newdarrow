import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Search, Calendar } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useTerms, useAcademicYears, useTermsEntity } from "../hooks/use-school";
import { TermFormModal } from "../components/TermFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import { formatDate } from "@/lib/utils";
import type { Term } from "../types/school.types";

export function TermsPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: terms = [], isLoading } = useTerms();
  const { data: years = [] } = useAcademicYears();
  const removeMut = useTermsEntity.useRemove();

  const yearName = useMemo(() => {
    const m = new Map<string, string>();
    for (const y of years) m.set(y.id, y.name);
    return m;
  }, [years]);

  const [yearFilter, setYearFilter] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Term | null>(null);
  const [deleting, setDeleting] = useState<Term | null>(null);

  const yearFilterOptions = useMemo(
    () => [{ id: "", label: t("termsPage.allYears") }, ...years.map((y) => ({ id: y.id, label: y.name }))],
    [years, t],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return terms
      .filter((t) => !yearFilter || t.academicYearId === yearFilter)
      .filter((t) => !term || t.name.toLowerCase().includes(term));
  }, [terms, yearFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" />
            {t("termsPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("termsPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button color="primary" startContent={<Plus className="w-4 h-4" />}
            onPress={() => { setEditing(null); setFormOpen(true); }}>
            {t("buttons.new")}
          </Button>
        )}
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select {...selectFieldProps()} label={t("termsPage.academicYear")}
          selectedKeys={yearFilter ? [yearFilter] : []}
          onSelectionChange={(keys) => setYearFilter((Array.from(keys)[0] as string) ?? "")}
          className="w-56">
          {yearFilterOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
        </Select>
        <Input placeholder={t("buttons.search")} value={search} onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />} className="max-w-xs" />
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("termsPage.academicYear")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.startDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.endDate")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-default-400">{t("termsPage.empty")}</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{row.name}</td>
                  <td className="px-4 py-2.5 text-default-600">{yearName.get(row.academicYearId) ?? "—"}</td>
                  <td className="px-4 py-2.5 text-default-600">{formatDate(row.startDate)}</td>
                  <td className="px-4 py-2.5 text-default-600">{formatDate(row.endDate)}</td>
                  {(canManage || canDelete) && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {canManage && <Button size="sm" variant="light" onPress={() => { setEditing(row); setFormOpen(true); }}>{t("buttons.edit")}</Button>}
                      {canDelete && <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(row)}>{t("buttons.delete")}</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <TermFormModal isOpen={formOpen} onOpenChange={setFormOpen} term={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("termsPage.title")}
        body={deleting ? `${deleting.name} — ${t("termsPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
