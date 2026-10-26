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
import { SingleSelectField } from "./SingleSelectField";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { useContractsQuery } from "@/features/crm/hooks/use-contracts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import {
  CAMPAIGN_CHANNELS,
  type Campaign,
  type CampaignChannel,
} from "../types/marketing.types";
import { validateCampaignDraft } from "../lib/campaign-rules";
import { useCreateCampaignMutation, useUpdateCampaignMutation } from "../hooks/use-marketing";

const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

interface CampaignFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: Campaign | null;
}

/**
 * Create/edit the descriptive fields of a campaign. Deliberately excludes
 * `status` and `budgetAmount`: lifecycle moves are guarded transitions and
 * budget changes go through the revision flow on the detail page, so this
 * form can never bypass either audit trail.
 */
export function CampaignFormModal({ isOpen, onOpenChange, campaign }: CampaignFormModalProps) {
  const { t, i18n } = useTranslation("marketing");
  const { data: contactsRes } = useContactsQuery();
  const { data: contractsRes } = useContractsQuery();
  const { data: allUsers = [] } = useAllUsers();
  const createCampaign = useCreateCampaignMutation();
  const updateCampaign = useUpdateCampaignMutation();
  const isEdit = !!campaign;

  const contacts = contactsRes?.data ?? [];
  const contracts = contractsRes?.data ?? [];

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [clientId, setClientId] = useState("");
  const [contractId, setContractId] = useState("");
  const [channels, setChannels] = useState<CampaignChannel[]>([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(campaign?.name ?? "");
    setObjective(campaign?.objective ?? "");
    setClientId(campaign?.clientId ?? "");
    setContractId(campaign?.contractId ?? "");
    setChannels(campaign?.channels ?? []);
    setOwnerUserId(campaign?.ownerUserId ?? "");
    setStartDate(campaign?.startDate ?? "");
    setEndDate(campaign?.endDate ?? "");
    setBudgetAmount(campaign ? String(campaign.budgetAmount) : "");
    setCurrency(campaign?.currency || "SAR");
    setNotes(campaign?.notes ?? "");
  }, [isOpen, campaign]);

  const submitting = createCampaign.isPending || updateCampaign.isPending;

  const toggleChannel = (ch: CampaignChannel) =>
    setChannels((prev) => (prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch]));

  const onSubmit = async () => {
    const draft = {
      name: name.trim(),
      clientId,
      channels,
      budgetAmount: budgetAmount.trim() ? Number(budgetAmount) : null,
      startDate: startDate || null,
      endDate: endDate || null,
      currency,
    };
    const found = validateCampaignDraft(draft);
    if (Object.keys(found).length) {
      setErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    if (isEdit && campaign) {
      await updateCampaign.mutateAsync({
        id: campaign.id,
        data: {
          name: name.trim(),
          objective: objective.trim() || null,
          clientId,
          contractId: contractId || null,
          channels,
          ownerUserId: ownerUserId || null,
          startDate: startDate || null,
          endDate: endDate || null,
          currency,
          notes: notes.trim() || null,
        },
      });
    } else {
      await createCampaign.mutateAsync({
        name: name.trim(),
        objective: objective.trim() || null,
        clientId,
        contractId: contractId || null,
        channels,
        ownerUserId: ownerUserId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        budgetAmount: Number(budgetAmount),
        currency,
        notes: notes.trim() || null,
      });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("campaigns.formEdit") : t("campaigns.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                label={t("fields.name")}
                value={name}
                onValueChange={setName}
                isInvalid={!!errors.name}
                errorMessage={errors.name}
              />
              <Input
                label={t("fields.objective")}
                value={objective}
                onValueChange={setObjective}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SingleSelectField
                  label={t("fields.client")}
                  value={clientId}
                  onChange={setClientId}
                  options={contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) }))}
                  placeholder={t("campaigns.pickClient")}
                  isInvalid={!!errors.clientId}
                  errorMessage={errors.clientId}
                />
                <SingleSelectField
                  label={t("fields.contract")}
                  value={contractId}
                  onChange={setContractId}
                  options={contracts.map((ct) => ({ id: ct.id, label: ct.title }))}
                  placeholder={t("campaigns.pickContract")}
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-default-600 mb-2">{t("fields.channels")}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {CAMPAIGN_CHANNELS.map((ch) => (
                    <Checkbox key={ch} isSelected={channels.includes(ch)} onValueChange={() => toggleChannel(ch)}>
                      {t(`channel.${ch}`)}
                    </Checkbox>
                  ))}
                </div>
                {errors.channels && (
                  <p className="text-xs text-danger mt-1">{errors.channels}</p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SingleSelectField
                  label={t("fields.owner")}
                  value={ownerUserId}
                  onChange={setOwnerUserId}
                  options={allUsers.map((u) => ({
                    id: u.id,
                    label: localizedName(i18n.language, u) || u.name,
                  }))}
                  placeholder={t("misc.unassigned")}
                />
                <Input
                  type="date"
                  label={t("fields.startDate")}
                  value={startDate}
                  onValueChange={setStartDate}
                />
                <Input
                  type="date"
                  label={t("fields.endDate")}
                  value={endDate}
                  onValueChange={setEndDate}
                  isInvalid={!!errors.endDate}
                  errorMessage={errors.endDate}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  label={t("fields.budgetAmount")}
                  value={budgetAmount}
                  onValueChange={setBudgetAmount}
                  isDisabled={isEdit}
                  description={isEdit ? t("campaigns.budgetViaRevision") : undefined}
                  isInvalid={!!errors.budgetAmount}
                  errorMessage={errors.budgetAmount}
                />
                <SingleSelectField
                  label={t("fields.currency")}
                  value={currency}
                  onChange={setCurrency}
                  options={CURRENCIES.map((c) => ({ id: c, label: c }))}
                  placeholder="SAR"
                  isInvalid={!!errors.currency}
                  errorMessage={errors.currency}
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
              <Button
                color="primary"
                isLoading={submitting}
                onPress={onSubmit}
              >
                {submitting ? t("buttons.saving") : t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
