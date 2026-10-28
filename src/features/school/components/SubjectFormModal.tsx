import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useSubjectsEntity } from "../hooks/use-school";
import { validateSubject } from "../lib/school-rules";
import type { Subject } from "../types/school.types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: Subject | null;
}

export function SubjectFormModal({ isOpen, onOpenChange, subject }: Props) {
  const { t } = useTranslation("school");
  const createMut = useSubjectsEntity.useCreate();
  const updateMut = useSubjectsEntity.useUpdate();
  const isEdit = !!subject;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(subject?.name ?? "");
    setCode(subject?.code ?? "");
  }, [isOpen, subject]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateSubject({ name });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = { name: name.trim(), code: code.trim() || null };
    if (isEdit && subject) {
      await updateMut.mutateAsync({ id: subject.id, data: payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "subjectsPage.formEdit" : "subjectsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
              <Input label={t("fields.code")} value={code} onValueChange={setCode} />
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
