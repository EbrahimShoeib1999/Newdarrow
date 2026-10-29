import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem, Switch } from "@heroui/react";
import { Plus, Search, Archive, Trash2 } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import {
  useModuleDefinition,
  useModuleAccess,
  useModuleRecords,
  useQueryModuleRecords,
  useArchiveRecordMutation,
  useDeleteRecordMutation,
} from "../hooks/use-custom-modules";
import {
  formatCellValue,
  stageColor,
  stageLabel,
  type ModuleListQuery,
} from "../lib/module-engine";
import { moduleIcon } from "../lib/module-ui-helpers";
import { ConfirmModal } from "../components/ConfirmModal";
import type { ModuleRecord } from "../types/custom-module.types";

/**
 * `/modules/:moduleKey` — the configurable list surface. Search, status filter,
 * archived toggle, sortable columns and pagination all run through the pure
 * engine (queryRecords) over the activity-scoped rows the service returned, so
 * the view never reaches outside the tenant/activity boundary.
 */
export function ModuleRecordsListPage() {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";

  const { data: def, isLoading: defLoading } = useModuleDefinition(moduleKey);
  const access = useModuleAccess(def);
  const { data, isLoading } = useModuleRecords(def);
  const archiveRecord = useArchiveRecordMutation(def);
  const deleteRecord = useDeleteRecordMutation(def);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [archiving, setArchiving] = useState<ModuleRecord | null>(null);
  const [deleting, setDeleting] = useState<ModuleRecord | null>(null);

  const fieldByKey = useMemo(
    () => new Map((def?.fields ?? []).map((f) => [f.key, f])),
    [def],
  );
  const columns = (def?.listConfig.columns ?? [])
    .map((k) => fieldByKey.get(k))
    .filter((f): f is NonNullable<typeof f> => !!f);

  const q: ModuleListQuery = {
    search,
    status,
    includeArchived,
    sortField: def?.listConfig.sortField,
    sortDir: def?.listConfig.sortDir,
    page,
    pageSize: def?.listConfig.pageSize,
  };
  const { rows, total, pages } = useQueryModuleRecords(def, data, q);
  const relationLabels = data?.relationLabels ?? {};

  if (defLoading) return <LoadingSpinner />;

  if (!def) {
    return (
      <EmptyState
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundBody")}
        action={
          <Button as={Link} to="/modules" variant="flat">
            {t("list.back")}
          </Button>
        }
      />
    );
  }

  if (!access.canView) {
    return (
      <EmptyState title={t("detail.notFoundTitle")} description={t("detail.notFoundBody")} />
    );
  }

  const Icon = moduleIcon(def.icon);
  const primaryField = fieldByKey.get(def.listConfig.primaryField);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-default-900">{def.name[lang]}</h1>
            <p className="truncate text-sm text-default-500">{def.description?.[lang]}</p>
          </div>
        </div>
        {access.canCreate && (
          <Button
            color="primary"
            startContent={<Plus className="h-4 w-4" />}
            onPress={() => navigate(`/modules/${def.key}/new`)}
          >
            {t("list.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t("list.search")}
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          startContent={<Search className="h-4 w-4 text-default-400" />}
          className="max-w-xs"
        />
        <Select
          {...selectFieldProps()}
          placeholder={t("list.allStatuses")}
          selectedKeys={[status]}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as string | undefined;
            if (v) {
              setStatus(v);
              setPage(1);
            }
          }}
          className="max-w-[200px]"
        >
          {(["all", ...def.stages.map((s) => s.key)] as string[]).map((k) => (
            <SelectItem key={k}>{k === "all" ? t("list.allStatuses") : stageLabel(def, k, lang)}</SelectItem>
          ))}
        </Select>
        <Switch isSelected={includeArchived} onValueChange={(v: boolean) => { setIncludeArchived(v); setPage(1); }}>
          <span className="text-sm">{t("list.showArchived")}</span>
        </Switch>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                {primaryField && <th className="px-4 py-2.5 text-start">{primaryField.label[lang]}</th>}
                {columns
                  .filter((f) => f.key !== def.listConfig.primaryField)
                  .map((f) => (
                    <th key={f.key} className="px-4 py-2.5 text-start">{f.label[lang]}</th>
                  ))}
                <th className="px-4 py-2.5 text-start">{t("form.stage")}</th>
                {(access.canArchive || access.canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length + 3} className="px-4 py-10 text-center text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3} className="px-4 py-10 text-center text-sm text-default-400">
                    {total === 0 ? t("list.firstEmpty") : t("list.noResults")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const primary = primaryField
                    ? formatCellValue(primaryField, r.values[primaryField.key], lang, relationLabels[primaryField.key]?.[String(r.values[primaryField.key])])
                    : r.code ?? r.id;
                  return (
                    <tr key={r.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                      <td className="px-4 py-2.5">
                        <Link to={`/modules/${def.key}/${r.id}`} className="font-medium text-primary">
                          {primary}
                          {r.archived && (
                            <Chip size="sm" variant="flat" className="ms-2">{t("list.archivedTag")}</Chip>
                          )}
                        </Link>
                      </td>
                      {columns
                        .filter((f) => f.key !== def.listConfig.primaryField)
                        .map((f) => (
                          <td key={f.key} className="px-4 py-2.5 text-default-700">
                            {formatCellValue(f, r.values[f.key], lang, relationLabels[f.key]?.[String(r.values[f.key])])}
                          </td>
                        ))}
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={stageColor(def, r.status) as never}>
                          {stageLabel(def, r.status, lang)}
                        </Chip>
                      </td>
                      {(access.canArchive || access.canDelete) && (
                        <td className="whitespace-nowrap px-4 py-2.5 text-end">
                          {access.canArchive && (
                            <Button isIconOnly size="sm" variant="light" onPress={() => setArchiving(r)} aria-label={t("detail.archive")}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          )}
                          {access.canDelete && (
                            <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => setDeleting(r)} aria-label={t("detail.delete")}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="light" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
            {t("list.prev")}
          </Button>
          <span className="text-sm text-default-500">{t("list.pageInfo", { page, pages })}</span>
          <Button size="sm" variant="light" isDisabled={page >= pages} onPress={() => setPage((p) => p + 1)}>
            {t("list.next")}
          </Button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={t("detail.archive")}
        body={t("detail.archiveConfirm")}
        confirmLabel={t("detail.archive")}
        cancelLabel={t("common:actions.cancel")}
        isLoading={archiveRecord.isPending}
        onConfirm={async () => {
          if (archiving) {
            await archiveRecord.mutateAsync({ id: archiving.id, archived: !archiving.archived });
            setArchiving(null);
          }
        }}
      />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("detail.delete")}
        body={t("detail.deleteConfirm")}
        confirmLabel={t("detail.delete")}
        cancelLabel={t("common:actions.cancel")}
        danger
        isLoading={deleteRecord.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteRecord.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
