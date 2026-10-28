import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useTermsEntity, useAcademicYears } from "../hooks/use-school";
import { validateTerm } from "../lib/school-rules";
import type { Term } from "../types/school.types";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  term?: Term | null;
}

export function TermFormModal({ isOpen, onOpenChange, term }: Props) {
  const { t } = useTranslation("school");
  const createMut = useTermsEntity.useCreate();
  const updateMut = useTermsEntity.useUpdate();
  const { data: years = [] } = useAcademicYears();
  const isEdit = !!term;

  const [academicYearId, setAcademicYearId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setAcademicYearId(term?.academicYearId ?? "");
    setName(term?.name ?? "");
    setStartDate(term?.startDate ?? "");
    setEndDate(term?.endDate ?? "");
  }, [isOpen, term]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateTerm({ name, startDate, endDate, academicYearId });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = { academicYearId, name: name.trim(), startDate, endDate };
    if (isEdit && term) {
      await updateMut.mutateAsync({ id: term.id, data: payload });
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
            <ModalHeader>{t(isEdit ? "termsPage.formEdit" : "termsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Select
                {...selectFieldProps()}
                label={t("termsPage.academicYear")}
                selectedKeys={academicYearId ? [academicYearId] : []}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string | undefined;
                  if (v) setAcademicYearId(v);
                }}
                isInvalid={!!errors.academicYearId}
                errorMessage={errors.academicYearId}
              >
                {years.map((y) => (
                  <SelectItem key={y.id} textValue={y.name}>{y.name}</SelectItem>
                ))}
              </Select>
              <Input label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
              <div className="grid grid-cols-2 gap-4">
                <Input type="date" label={t("fields.startDate")} value={startDate} onValueChange={setStartDate}
                  isInvalid={!!errors.startDate} errorMessage={errors.startDate} />
                <Input type="date" label={t("fields.endDate")} value={endDate} onValueChange={setEndDate}
                  isInvalid={!!errors.endDate} errorMessage={errors.endDate} />
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
