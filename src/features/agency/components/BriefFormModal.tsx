import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Paperclip, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { uploadStorageFile } from "@/lib/storage-utils";
import { useCompany } from "@/features/companies/context/company-context";
import type { BriefAttachment, Campaign, CreativeBrief, Deliverable } from "../types/marketing.types";
import { validateBriefDraft } from "../lib/deliverable-rules";
import { useCreateBriefMutation, useUpdateBriefMutation } from "../hooks/use-marketing";
import { SingleSelectField } from "./SingleSelectField";

/** Same cap as the storage rules' marketing attachment gate. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

interface BriefFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: readonly Campaign[];
  deliverables: readonly Deliverable[];
  campaign?: Campaign | null;
  brief?: CreativeBrief | null;
}

/**
 * Create/edit a creative brief with Storage attachments. Attachment URLs are
 * re-validated by the service against the tenant's storage paths, so a file
 * from another tenant can never be referenced here.
 */
export function BriefFormModal({
  isOpen,
  onOpenChange,
  campaigns,
  deliverables,
  campaign,
  brief,
}: BriefFormModalProps) {
  const { t } = useTranslation("marketing");
  const { companyId } = useCompany();
  const createBrief = useCreateBriefMutation();
  const updateBrief = useUpdateBriefMutation();
  const isEdit = !!brief;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [campaignId, setCampaignId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deliverableId, setDeliverableId] = useState("");
  const [attachments, setAttachments] = useState<BriefAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setCampaignId(brief?.campaignId ?? campaign?.id ?? "");
    setTitle(brief?.title ?? "");
    setBody(brief?.body ?? "");
    setDeliverableId(brief?.deliverableId ?? "");
    setAttachments(brief?.attachments ?? []);
  }, [isOpen, brief, campaign]);

  const submitting = createBrief.isPending || updateBrief.isPending;

  const campaignDeliverables = deliverables.filter((d) => !campaignId || d.campaignId === campaignId);

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !companyId) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(t("briefs.fileTooLarge", { name: file.name }));
          continue;
        }
        const ext = file.name.split(".").pop() ?? "bin";
        const randomId = Math.random().toString(36).slice(2, 12);
        const path = `domain/mkt_briefs/${companyId}/${campaignId || "unassigned"}/${randomId}.${ext}`;
        const url = await uploadStorageFile(path, file, file.type);
        setAttachments((prev) => [
          ...prev,
          { name: file.name, url, type: file.type || "application/octet-stream", size: file.size },
        ]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("briefs.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = async () => {
    const found = validateBriefDraft({ campaignId, title: title.trim(), body: body.trim() });
    if (Object.keys(found).length) {
      setErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    if (isEdit && brief) {
      await updateBrief.mutateAsync({
        id: brief.id,
        data: {
          title: title.trim(),
          body: body.trim(),
          deliverableId: deliverableId || null,
          attachments,
        },
      });
    } else {
      await createBrief.mutateAsync({
        campaignId,
        title: title.trim(),
        body: body.trim(),
        deliverableId: deliverableId || null,
        attachments,
      });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("briefs.formEdit") : t("briefs.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              {!isEdit && (
                <SingleSelectField
                  label={t("fields.campaign")}
                  value={campaignId}
                  onChange={setCampaignId}
                  options={campaigns.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                  placeholder={t("briefs.pickCampaign")}
                  isInvalid={!!errors.campaignId}
                  errorMessage={errors.campaignId}
                />
              )}
              <Input
                label={t("fields.title")}
                value={title}
                onValueChange={setTitle}
                isRequired
                isInvalid={!!errors.title}
                errorMessage={errors.title}
              />
              <Textarea
                label={t("fields.body")}
                value={body}
                onValueChange={setBody}
                minRows={4}
                isRequired
                isInvalid={!!errors.body}
                errorMessage={errors.body}
              />
              <SingleSelectField
                label={t("fields.deliverable")}
                value={deliverableId}
                onChange={setDeliverableId}
                options={campaignDeliverables.map((d) => ({ id: d.id, label: d.title }))}
                placeholder={t("misc.none")}
              />
              <div>
                <p className="text-sm font-semibold text-default-600 mb-2">{t("briefs.attachments")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => onPickFiles(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="bordered"
                  startContent={<Upload className="w-4 h-4" />}
                  isLoading={uploading}
                  onPress={() => fileInputRef.current?.click()}
                >
                  {t("briefs.uploadFile")}
                </Button>
                {attachments.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {attachments.map((a, idx) => (
                      <li
                        key={`${a.url}-${idx}`}
                        className="flex items-center justify-between gap-2 text-sm border border-default-200 rounded-md px-3 py-1.5"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Paperclip className="w-4 h-4 shrink-0 text-default-400" />
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-primary hover:underline"
                          >
                            {a.name}
                          </a>
                          <span className="text-xs text-default-400 shrink-0">
                            {Math.round(a.size / 1024)} KB
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="light"
                          isIconOnly
                          aria-label={t("briefs.removeAttachment")}
                          onPress={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={submitting} onPress={onSubmit}>
                {submitting ? t("buttons.saving") : t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
