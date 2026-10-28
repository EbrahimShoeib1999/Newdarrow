import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Chip, Divider } from "@heroui/react";
import { Archive, Pencil, Trash2, RotateCcw } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useModuleDefinition,
  useModuleAccess,
  useModuleRecord,
  useModuleRecords,
  useUpdateRecordMutation,
  useArchiveRecordMutation,
  useDeleteRecordMutation,
} from "../hooks/use-custom-modules";
import { canMoveStage, formatCellValue, stageColor, stageLabel } from "../lib/module-engine";
import { moduleIcon } from "../lib/module-ui-helpers";
import { ConfirmModal } from "../components/ConfirmModal";

/**
 * Read view of one record: every configured field rendered by the engine's
 * formatter (with resolved relation labels), the legal lifecycle transitions
 * from its CURRENT stage, the immutable stage history and the audit metadata.
 * Write actions are shown only when the module grants them to this user.
 */
export function ModuleRecordDetailPage() {
  const { moduleKey, recordId } = useParams<{ moduleKey: string; recordId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";

  const { data: def, isLoading: defLoading } = useModuleDefinition(moduleKey);
  const access = useModuleAccess(def);
  const { data: record, isLoading } = useModuleRecord(def, recordId);
  const { data: listData } = useModuleRecords(def);
  const updateRecord = useUpdateRecordMutation(def);
  const archiveRecord = useArchiveRecordMutation(def);
  const deleteRecord = useDeleteRecordMutation(def);

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const relationLabels = useMemo(() => {
    const maps = listData?.relationLabels ?? {};
    const flat: Record<string, string> = {};
    for (const byId of Object.values(maps)) Object.assign(flat, byId);
    return flat;
  }, [listData]);

  if (defLoading || isLoading) return <LoadingSpinner />;

  if (!def || !record || !access.canView) {
    return (
      <EmptyState
        title={t("detail.notFoundTitle")}
        description={t("detail.notFoundBody")}
        action={
          <Button as={Link} to={`/modules/${moduleKey}`} variant="flat">
            {t("list.back")}
          </Button>
        }
      />
    );
  }

  const Icon = moduleIcon(def.icon);
  const transitions = record.archived
    ? []
    : def.stages.filter((s) => s.key !== record.status && canMoveStage(def.stages, record.status, s.key));

  const moveStage = (to: string) =>
    updateRecord.mutateAsync({
      id: record.id,
      payload: { values: record.values, status: to },
      expectedRevision: record.revision,
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-default-900">{def.name[lang]}</h1>
            <p className="text-sm text-default-500">{record.code ?? record.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {access.canUpdate && !record.archived && (
            <Button size="sm" variant="flat" startContent={<Pencil className="h-4 w-4" />} onPress={() => navigate(`/modules/${def.key}/${record.id}/edit`)}>
              {t("detail.edit")}
            </Button>
          )}
          {access.canArchive && (
            <Button size="sm" variant="flat" startContent={record.archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />} onPress={() => setConfirmArchive(true)}>
              {record.archived ? t("detail.unarchive") : t("detail.archive")}
            </Button>
          )}
          {access.canDelete && (
            <Button size="sm" variant="flat" color="danger" startContent={<Trash2 className="h-4 w-4" />} onPress={() => setConfirmDelete(true)}>
              {t("detail.delete")}
            </Button>
          )}
        </div>
      </div>

      {record.archived && (
        <Chip color="warning" variant="flat">{t("list.archivedTag")}</Chip>
      )}

      <Card>
        <CardHeader className="pb-0 font-bold">{def.name[lang]}</CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2">
          {def.fields.map((f) => (
            <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : undefined}>
              <p className="text-xs font-semibold uppercase tracking-wide text-default-400">{f.label[lang]}</p>
              <p className="mt-0.5 text-sm text-default-800">
                {formatCellValue(f, record.values[f.key], lang, relationLabels[String(record.values[f.key])])}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between gap-2">
          <span className="font-bold">{t("form.stage")}</span>
          <Chip size="sm" variant="flat" color={stageColor(def, record.status) as never}>
            {stageLabel(def, record.status, lang)}
          </Chip>
        </CardHeader>
        <CardBody className="pt-0">
          {transitions.length > 0 && access.canUpdate ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-default-500">{t("detail.move")}</span>
              {transitions.map((s) => (
                <Button key={s.key} size="sm" variant="bordered" isLoading={updateRecord.isPending} onPress={() => moveStage(s.key)}>
                  {s.label[lang]}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-default-400">{stageLabel(def, record.status, lang)}</p>
          )}

          <Divider className="my-4" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-default-400">{t("detail.stageHistory")}</p>
          <ol className="space-y-1.5">
            {record.stageHistory.map((h, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="text-default-400 tabular-nums">{new Date(h.at).toLocaleString()}</span>
                <span className="text-default-700">
                  {h.from ? `${stageLabel(def, h.from, lang)} → ` : ""}
                  {stageLabel(def, h.to, lang)}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="font-bold">{t("detail.metaTitle")}</CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 pt-0 text-sm sm:grid-cols-2">
          <Meta label={t("detail.code")} value={record.code ?? "—"} />
          <Meta label={t("detail.createdAt")} value={record.createdAt ? new Date(record.createdAt).toLocaleString() : "—"} />
          <Meta label={t("detail.updatedAt")} value={record.updatedAt ? new Date(record.updatedAt).toLocaleString() : "—"} />
        </CardBody>
      </Card>

      <ConfirmModal
        isOpen={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={record.archived ? t("detail.unarchive") : t("detail.archive")}
        body={t("detail.archiveConfirm")}
        confirmLabel={record.archived ? t("detail.unarchive") : t("detail.archive")}
        cancelLabel={t("common:actions.cancel")}
        isLoading={archiveRecord.isPending}
        onConfirm={async () => {
          await archiveRecord.mutateAsync({ id: record.id, archived: !record.archived });
          setConfirmArchive(false);
        }}
      />

      <ConfirmModal
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("detail.delete")}
        body={t("detail.deleteConfirm")}
        confirmLabel={t("detail.delete")}
        cancelLabel={t("common:actions.cancel")}
        danger
        isLoading={deleteRecord.isPending}
        onConfirm={async () => {
          await deleteRecord.mutateAsync(record.id);
          navigate(`/modules/${def.key}`);
        }}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-default-400">{label}</p>
      <p className="mt-0.5 text-default-800">{value}</p>
    </div>
  );
}
