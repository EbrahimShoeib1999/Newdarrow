import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useGuardiansEntity } from "../hooks/use-school";
import { validateGuardian } from "../lib/school-rules";
import type { Guardian, GuardianRelationship } from "../types/school.types";

const RELATIONSHIPS: GuardianRelationship[] = ["father", "mother", "guardian", "other"];

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  guardian?: Guardian | null;
}

export function GuardianFormModal({ isOpen, onOpenChange, guardian }: Props) {
  const { t } = useTranslation("school");
  const createMut = useGuardiansEntity.useCreate();
  const updateMut = useGuardiansEntity.useUpdate();
  const isEdit = !!guardian;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState<GuardianRelationship>("father");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(guardian?.name ?? "");
    setPhone(guardian?.phone ?? "");
    setEmail(guardian?.email ?? "");
    setRelationship(guardian?.relationship ?? "father");
    setNotes(guardian?.notes ?? "");
  }, [isOpen, guardian]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateGuardian({ name, phone });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      name: name.trim(), phone: phone.trim(),
      email: email.trim() || null, relationship,
      contactId: null, notes: notes.trim() || null,
    };
    if (isEdit && guardian) {
      await updateMut.mutateAsync({ id: guardian.id, data: payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "guardiansPage.formEdit" : "guardiansPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("fields.phone")} value={phone} onValueChange={setPhone}
                  isRequired isInvalid={!!errors.phone} errorMessage={errors.phone} />
                <Input type="email" label={t("fields.email")} value={email} onValueChange={setEmail} />
              </div>
              <Select {...selectFieldProps()} label={t("fields.relationship")}
                selectedKeys={[relationship]}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0] as GuardianRelationship | undefined; if (v) setRelationship(v); }}>
                {RELATIONSHIPS.map((r) => (
                  <SelectItem key={r} textValue={t(`guardianRelationship.${r}`)}>{t(`guardianRelationship.${r}`)}</SelectItem>
                ))}
              </Select>
              <Textarea label={t("fields.notes")} value={notes} onValueChange={setNotes} minRows={2} />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>{t("buttons.cancel")}</Button>
              <Button color="primary" isLoading={submitting} onPress={onSubmit}>{t("buttons.save")}</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
