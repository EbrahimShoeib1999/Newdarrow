import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { useGradesEntity } from "../hooks/use-school";
import { validateGrade } from "../lib/school-rules";
import type { Grade } from "../types/school.types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  grade?: Grade | null;
}

export function GradeFormModal({ isOpen, onOpenChange, grade }: Props) {
  const { t } = useTranslation("school");
  const createMut = useGradesEntity.useCreate();
  const updateMut = useGradesEntity.useUpdate();
  const isEdit = !!grade;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [level, setLevel] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(grade?.name ?? "");
    setCode(grade?.code ?? "");
    setLevel(String(grade?.level ?? 1));
  }, [isOpen, grade]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const lvl = Number(level);
    const found = validateGrade({ name, level: lvl });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = { name: name.trim(), code: code.trim() || null, level: lvl };
    if (isEdit && grade) {
      await updateMut.mutateAsync({ id: grade.id, data: payload });
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
            <ModalHeader>{t(isEdit ? "gradesPage.formEdit" : "gradesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
              <div className="grid grid-cols-2 gap-4">
                <Input label={t("fields.code")} value={code} onValueChange={setCode} />
                <Input type="number" label={t("fields.level")} value={level}
                  onValueChange={setLevel} min="1"
                  isInvalid={!!errors.level} errorMessage={errors.level} />
              </div>
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
