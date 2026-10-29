import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Checkbox, Chip } from "@heroui/react";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatDate } from "@/lib/utils";
import { useRemActor } from "../hooks/use-real-estate";
import {
  useDeleteDocumentMutation,
  useEntityDocuments,
  useUploadDocumentMutation,
} from "../hooks/use-real-estate-ops";
import { RemSelect } from "./RemSelect";
import { ConfirmModal } from "./ConfirmModal";
import { remErrorText } from "../lib/ui-maps";
import type { RemDocument, RemEntityType } from "../types/real-estate.types";

const KINDS = ["contract", "deed", "id_copy", "photo", "report", "invoice", "other"] as const;

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentsPanelProps {
  entityType: RemEntityType;
  entityId?: string | null;
}

/**
 * Entity document attachments. Uploads land in the activity-owned Storage
 * partition (domain/rem_property_documents/… or the officer-only sensitive
 * partition) under the existing storage.rules domain gate — no new bucket,
 * no public path. Sensitive documents are hidden unless the viewer holds the
 * approve permission (officer-level in this module).
 */
export function DocumentsPanel({ entityType, entityId }: DocumentsPanelProps) {
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const actor = useRemActor();
  const canCreate = can("real_estate.create");
  const isOfficer = can("real_estate.approve");

  const { data: documents = [] } = useEntityDocuments(entityType, entityId);
  const upload = useUploadDocumentMutation();
  const remove = useDeleteDocumentMutation();

  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>("contract");
  const [sensitive, setSensitive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RemDocument | null>(null);

  const visible = isOfficer ? documents : documents.filter((d) => !d.sensitive);

  const onPick = async (file: File | null) => {
    if (!file || !entityId) return;
    try {
      await upload.mutateAsync({
        by: actor,
        input: { entityType, entityId, kind, file, sensitive },
      });
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      toast.error(remErrorText(t, e));
    }
  };

  return (
    <Card>
      <CardBody className="gap-3">
        <h2 className="text-base font-semibold text-default-800">{t("documentsSection.title")}</h2>

        {canCreate && entityId && (
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <RemSelect
              label={t("documentsSection.kind")}
              value={kind}
              onChange={setKind}
              options={KINDS.map((k) => ({ id: k, label: t(`documentKind.${k}`) }))}
            />
            <div className="flex flex-col gap-2">
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.xls,.xlsx,.doc,.docx,.zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPick(file);
                  e.target.value = "";
                }}
              />
              <Checkbox isSelected={sensitive} onValueChange={setSensitive} isDisabled={!isOfficer}>
                <span className="text-xs">{t("documentsSection.sensitive")}</span>
              </Checkbox>
            </div>
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<Paperclip className="w-4 h-4" />}
              isLoading={upload.isPending}
              onPress={() => inputRef.current?.click()}
            >
              {t("documentsSection.upload")}
            </Button>
          </div>
        )}

        {visible.length === 0 ? (
          <p className="text-sm text-default-400">{t("documentsSection.empty")}</p>
        ) : (
          <ul className="divide-y divide-default-100">
            {visible.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-3">
                <FileText className="w-4 h-4 text-default-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-sm text-primary truncate block">
                    {d.fileName}
                  </a>
                  <p className="text-xs text-default-400">
                    {t(`documentKind.${d.kind}`, { defaultValue: d.kind })} · {fileSize(d.sizeBytes)} · {formatDate(d.createdAt)}
                    {d.sensitive && " · "}
                    {d.sensitive && (
                      <Chip size="sm" variant="flat" color="warning" className="ms-1">
                        {t("documentsSection.sensitive")}
                      </Chip>
                    )}
                  </p>
                </div>
                {canCreate && (
                  <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => setDeleteTarget(d)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("documentsSection.deleteConfirm")}
        body={deleteTarget?.fileName ?? ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={remove.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await remove.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          } catch (e) {
            toast.error(remErrorText(t, e));
          }
        }}
      />
    </Card>
  );
}
