import { useEffect, useMemo, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { localizedName } from "@/lib/localized-name";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useSectionsEntity, useGrades } from "../hooks/use-school";
import { validateSection } from "../lib/school-rules";
import type { Section } from "../types/school.types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  section?: Section | null;
}

export function SectionFormModal({ isOpen, onOpenChange, section }: Props) {
  const { t } = useTranslation("school");
  const { i18n } = useTranslation();
  const createMut = useSectionsEntity.useCreate();
  const updateMut = useSectionsEntity.useUpdate();
  const { data: grades = [] } = useGrades();
  const { data: allUsers = [] } = useAllUsers();
  const isEdit = !!section;

  const gradeOptions = useMemo(
    () => grades.map((g) => ({ id: g.id, label: g.name })),
    [grades],
  );

  const teacherOptions = useMemo(
    () => [{ id: "", label: "—" }, ...allUsers.map((u) => ({ id: u.id, label: localizedName(i18n.language, u) }))],
    [allUsers, i18n.language],
  );

  const [gradeId, setGradeId] = useState("");
  const [name, setName] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [capacity, setCapacity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setGradeId(section?.gradeId ?? "");
    setName(section?.name ?? "");
    setTeacherId(section?.teacherId ?? "");
    setCapacity(section?.capacity != null ? String(section.capacity) : "");
  }, [isOpen, section]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateSection({ name, gradeId });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      gradeId, name: name.trim(),
      teacherId: teacherId || null,
      capacity: capacity ? Number(capacity) : null,
    };
    if (isEdit && section) {
      await updateMut.mutateAsync({ id: section.id, data: payload });
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
            <ModalHeader>{t(isEdit ? "sectionsPage.formEdit" : "sectionsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Select {...selectFieldProps()} label={t("fields.grade")}
                selectedKeys={gradeId ? [gradeId] : []}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string | undefined; if (v) setGradeId(v); }}
                isInvalid={!!errors.gradeId} errorMessage={errors.gradeId}>
                {gradeOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
              </Select>
              <Input label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
              <Select {...selectFieldProps()} label={t("fields.teacher")}
                selectedKeys={[teacherId]}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string | undefined; setTeacherId(v ?? ""); }}>
                {teacherOptions.map((o) => <SelectItem key={o.id} textValue={o.label}>{o.label}</SelectItem>)}
              </Select>
              <Input type="number" label={t("fields.capacity")} value={capacity} onValueChange={setCapacity} min="1" />
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
