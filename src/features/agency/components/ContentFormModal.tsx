import { useEffect, useState } from "react";
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
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import {
  CAMPAIGN_CHANNELS,
  type Campaign,
  type CampaignChannel,
  type ContentItem,
  type CreativeBrief,
} from "../types/marketing.types";
import { validateContentDraft } from "../lib/deliverable-rules";
import {
  useCreateContentMutation,
  useUpdateContentMutation,
} from "../hooks/use-marketing";
import { SingleSelectField } from "./SingleSelectField";

interface ContentFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: readonly Campaign[];
  briefs: readonly CreativeBrief[];
  campaign?: Campaign | null;
  content?: ContentItem | null;
}

/**
 * Create/edit a content calendar item. Publication moves are guarded
 * transitions on the list surface; this form only owns descriptive fields
 * and the scheduled date that scheduling later requires.
 */
export function ContentFormModal({
  isOpen,
  onOpenChange,
  campaigns,
  briefs,
  campaign,
  content,
}: ContentFormModalProps) {
  const { t, i18n } = useTranslation("marketing");
  const { data: allUsers = [] } = useAllUsers();
  const createContent = useCreateContentMutation();
  const updateContent = useUpdateContentMutation();
  const isEdit = !!content;

  const [campaignId, setCampaignId] = useState("");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("social");
  const [scheduledDate, setScheduledDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [briefId, setBriefId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setCampaignId(content?.campaignId ?? campaign?.id ?? "");
    setTitle(content?.title ?? "");
    setChannel(content?.channel ?? "social");
    setScheduledDate(content?.scheduledDate ?? "");
    setAssigneeId(content?.assigneeId ?? "");
    setBriefId(content?.briefId ?? "");
    setNotes(content?.notes ?? "");
  }, [isOpen, content, campaign]);

  const submitting = createContent.isPending || updateContent.isPending;

  const campaignBriefs = briefs.filter((b) => !campaignId || b.campaignId === campaignId);

  const onSubmit = async () => {
    const found = validateContentDraft({
      campaignId,
      title: title.trim(),
      channel,
      scheduledDate: scheduledDate || null,
    });
    if (Object.keys(found).length) {
      setErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    const shared = {
      title: title.trim(),
      channel,
      scheduledDate: scheduledDate || null,
      assigneeId: assigneeId || null,
      briefId: briefId || null,
      notes: notes.trim() || null,
    };
    if (isEdit && content) {
      await updateContent.mutateAsync({ id: content.id, data: shared });
    } else {
      await createContent.mutateAsync({ campaignId, ...shared });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("content.formEdit") : t("content.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              {!isEdit && (
                <SingleSelectField
                  label={t("fields.campaign")}
                  value={campaignId}
                  onChange={setCampaignId}
                  options={campaigns.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                  placeholder={t("content.pickCampaign")}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SingleSelectField
                  label={t("fields.channel")}
                  value={channel}
                  onChange={(v) => setChannel(v as CampaignChannel)}
                  options={CAMPAIGN_CHANNELS.map((c) => ({ id: c, label: t(`channel.${c}`) }))}
                  placeholder={t("content.pickChannel")}
                  isInvalid={!!errors.channel}
                  errorMessage={errors.channel}
                />
                <Input
                  type="date"
                  label={t("fields.scheduledDate")}
                  value={scheduledDate}
                  onValueChange={setScheduledDate}
                  isInvalid={!!errors.scheduledDate}
                  errorMessage={errors.scheduledDate}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SingleSelectField
                  label={t("fields.assignee")}
                  value={assigneeId}
                  onChange={setAssigneeId}
                  options={allUsers.map((u) => ({
                    id: u.id,
                    label: localizedName(i18n.language, u) || u.name,
                  }))}
                  placeholder={t("misc.unassigned")}
                />
                <SingleSelectField
                  label={t("fields.brief")}
                  value={briefId}
                  onChange={setBriefId}
                  options={campaignBriefs.map((b) => ({ id: b.id, label: b.title }))}
                  placeholder={t("misc.none")}
                />
              </div>
              <Textarea
                label={t("fields.notes")}
                value={notes}
                onValueChange={setNotes}
                minRows={2}
              />
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
