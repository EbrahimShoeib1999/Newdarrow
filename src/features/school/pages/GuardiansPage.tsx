import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { Plus, Search, UserRound } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useGuardians, useGuardiansEntity, useStudents } from "../hooks/use-school";
import { GuardianFormModal } from "../components/GuardianFormModal";
import { ConfirmModal } from "@/features/facilities/components/ConfirmModal";
import type { Guardian } from "../types/school.types";

export function GuardiansPage() {
  const { t } = useTranslation("school");
  const { can } = useAppPermissions();
  const canManage = can("school.manage");
  const canDelete = can("school.delete");

  const { data: guardians = [], isLoading } = useGuardians();
  const { data: students = [] } = useStudents();
  const removeMut = useGuardiansEntity.useRemove();

  const studentsCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of students) m.set(s.guardianId, (m.get(s.guardianId) ?? 0) + 1);
    return m;
  }, [students]);

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Guardian | null>(null);
  const [deleting, setDeleting] = useState<Guardian | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return guardians.filter((g) => {
      if (!term) return true;
      return g.name.toLowerCase().includes(term) || g.phone.toLowerCase().includes(term) || (g.email ?? "").toLowerCase().includes(term);
    });
  }, [guardians, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <UserRound className="w-6 h-6 text-primary" />{t("guardiansPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("guardiansPage.subtitle")}</p>
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
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.name")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.phone")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.email")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.relationship")}</th>
                <th className="px-4 py-2.5 text-start">{t("guardiansPage.studentsCount")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-default-400">{t("guardiansPage.empty")}</td></tr>
              ) : rows.map((g) => (
                <tr key={g.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                  <td className="px-4 py-2.5 font-medium text-default-800">{g.name}</td>
                  <td className="px-4 py-2.5 text-default-600" dir="ltr">{g.phone}</td>
                  <td className="px-4 py-2.5 text-default-600" dir="ltr">{g.email ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Chip size="sm" variant="flat">{t(`guardianRelationship.${g.relationship}`)}</Chip>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{studentsCount.get(g.id) ?? 0}</td>
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

      <GuardianFormModal isOpen={formOpen} onOpenChange={setFormOpen} guardian={editing} />
      <ConfirmModal
        isOpen={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}
        title={t("guardiansPage.title")}
        body={deleting ? `${deleting.name} — ${t("guardiansPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")} cancelLabel={t("buttons.cancel")} danger
        isLoading={removeMut.isPending}
        onConfirm={async () => { if (deleting) { await removeMut.mutateAsync(deleting.id); setDeleting(null); } }}
      />
    </div>
  );
}
