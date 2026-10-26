import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Checkbox,
  Input,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import type { Campaign, Deliverable } from "../types/marketing.types";
import { validateDeliverableDraft } from "../lib/deliverable-rules";
import {
  useCreateDeliverableMutation,
  useUpdateDeliverableMutation,
} from "../hooks/use-marketing";
import { SingleSelectField } from "./SingleSelectField";

interface DeliverableFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: readonly Campaign[];
  /** Pre-selected campaign when opened from a campaign detail page. */
  campaign?: Campaign | null;
  deliverable?: Deliverable | null;
}

/**
 * Create/edit the assignment and dates of a deliverable. `status` and client
 * approval are guarded workflow actions on the list/detail surface — never
 * side effects of this form.
 */
export function DeliverableFormModal({
  isOpen,
  onOpenChange,
  campaigns,
  campaign,
  deliverable,
}: DeliverableFormModalProps) {
  const { t, i18n } = useTranslation("marketing");
  const { data: allUsers = [] } = useAllUsers();
  const createDeliverable = useCreateDeliverableMutation();
  const updateDeliverable = useUpdateDeliverableMutation();
  const isEdit = !!deliverable;

  const [campaignId, setCampaignId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiresClientApproval, setRequiresClientApproval] = useState(false);
  const [scheduledPublishDate, setScheduledPublishDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setCampaignId(deliverable?.campaignId ?? campaign?.id ?? "");
    setTitle(deliverable?.title ?? "");
    setDescription(deliverable?.description ?? "");
    setAssigneeId(deliverable?.assigneeId ?? "");
    setDueDate(deliverable?.dueDate ?? "");
    setRequiresClientApproval(deliverable?.requiresClientApproval ?? false);
    setScheduledPublishDate(deliverable?.scheduledPublishDate ?? "");
  }, [isOpen, deliverable, campaign]);

  const submitting = createDeliverable.isPending || updateDeliverable.isPending;

  const onSubmit = async () => {
    const found = validateDeliverableDraft({
      campaignId,
      title: title.trim(),
      dueDate: dueDate || null,
    });
    if (Object.keys(found).length) {
      setErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    const shared = {
      title: title.trim(),
      description: description.trim() || null,
      assigneeId: assigneeId || null,
      dueDate: dueDate || null,
      requiresClientApproval,
      scheduledPublishDate: scheduledPublishDate || null,
    };
    if (isEdit && deliverable) {
      await updateDeliverable.mutateAsync({ id: deliverable.id, data: shared });
    } else {
      await createDeliverable.mutateAsync({ campaignId, ...shared });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              {isEdit ? t("deliverables.formEdit") : t("deliverables.formNew")}
            </ModalHeader>
            <ModalBody className="gap-4">
              {!isEdit && (
                <SingleSelectField
                  label={t("fields.campaign")}
                  value={campaignId}
                  onChange={setCampaignId}
                  options={campaigns.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
                  placeholder={t("deliverables.pickCampaign")}
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
                label={t("fields.description")}
                value={description}
                onValueChange={setDescription}
                minRows={2}
              />
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
                <Input
                  type="date"
                  label={t("fields.dueDate")}
                  value={dueDate}
                  onValueChange={setDueDate}
                  isInvalid={!!errors.dueDate}
                  errorMessage={errors.dueDate}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <Checkbox
                  isSelected={requiresClientApproval}
                  onValueChange={setRequiresClientApproval}
                >
                  {t("deliverables.requiresClientApproval")}
                </Checkbox>
                <Input
                  type="date"
                  label={t("fields.scheduledPublishDate")}
                  value={scheduledPublishDate}
                  onValueChange={setScheduledPublishDate}
                />
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
