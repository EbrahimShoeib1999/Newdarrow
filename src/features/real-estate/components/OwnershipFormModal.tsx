import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { RemSelect } from "./RemSelect";
import { useCreateOwnershipMutation, useUpdateOwnershipMutation } from "../hooks/use-real-estate";
import { remErrorText, remFieldErrors, contactDisplayName } from "../lib/ui-maps";
import type { Ownership, OwnerType } from "../types/real-estate.types";

interface OwnershipFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  ownership?: Ownership | null;
}

/**
 * Ownership links an EXISTING CRM contact to the property — personal identity
 * is never re-modeled here (CRM stays the source of truth, the service
 * validates the contact exists in this company).
 */
export function OwnershipFormModal({ isOpen, onOpenChange, propertyId, ownership }: OwnershipFormModalProps) {
  const { t } = useTranslation("real_estate");
  const { data: contactsRes } = useContactsQuery();
  const contacts = useMemo(() => contactsRes?.data ?? [], [contactsRes]);
  const createOwnership = useCreateOwnershipMutation();
  const updateOwnership = useUpdateOwnershipMutation();
  const isEdit = !!ownership;

  const [ownerType, setOwnerType] = useState<OwnerType>("individual");
  const [contactId, setContactId] = useState("");
  const [percentage, setPercentage] = useState("100");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setOwnerType(ownership?.ownerType ?? "individual");
    setContactId(ownership?.contactId ?? "");
    setPercentage(ownership ? String(ownership.percentage) : "100");
    setStartDate(ownership?.startDate ?? "");
    setEndDate(ownership?.endDate ?? "");
    setNotes(ownership?.notes ?? "");
  }, [isOpen, ownership]);

  const submitting = createOwnership.isPending || updateOwnership.isPending;

  const onSubmit = async () => {
    setErrors({});
    const contact = contacts.find((c) => c.id === contactId);
    const payload = {
      propertyId,
      ownerType,
      contactId,
      displayNameSnapshot: contact ? contactDisplayName(contact) : null,
      percentage: Number(percentage),
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes.trim() || null,
    };
    try {
      if (isEdit && ownership) {
        await updateOwnership.mutateAsync({ id: ownership.id, data: payload });
      } else {
        await createOwnership.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (e) {
      const field = remFieldErrors(t, e);
      if (Object.keys(field).length) setErrors(field);
      else setErrors({ contactId: remErrorText(t, e) });
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "buttons.edit" : "propertyProfile.addOwner")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("propertyProfile.ownerType")}
                  selectedKeys={[ownerType]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as OwnerType | undefined;
                    if (v) setOwnerType(v);
                  }}
                >
                  {(["individual", "company"] as OwnerType[]).map((k) => (
                    <SelectItem key={k} textValue={t(`ownerType.${k}`)}>
                      {t(`ownerType.${k}`)}
                    </SelectItem>
                  ))}
                </Select>
                <RemSelect
                  label={t("propertyProfile.contact")}
                  value={contactId}
                  onChange={setContactId}
                  isInvalid={!!errors.contactId}
                  errorMessage={errors.contactId}
                  options={contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  label={t("propertyProfile.percentage")}
                  value={percentage}
                  onValueChange={setPercentage}
                  isInvalid={!!errors.percentage}
                  errorMessage={errors.percentage}
                />
                <Input
                  type="date"
                  label={t("propertyProfile.startDate")}
                  value={startDate}
                  onValueChange={setStartDate}
                  isInvalid={!!errors.startDate}
                  errorMessage={errors.startDate}
                />
                <Input
                  type="date"
                  label={t("propertyProfile.endDate")}
                  value={endDate}
                  onValueChange={setEndDate}
                  isInvalid={!!errors.endDate}
                  errorMessage={errors.endDate}
                />
              </div>

              <Textarea label={t("fields.notes")} value={notes} onValueChange={setNotes} minRows={2} />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={submitting} onPress={onSubmit}>
                {t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
