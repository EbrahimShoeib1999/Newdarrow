import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAcademicYearsEntity } from "../hooks/use-school";
import { validateAcademicYear } from "../lib/school-rules";
import type { AcademicYear, AcademicYearStatus } from "../types/school.types";

const STATUSES: AcademicYearStatus[] = ["planned", "active", "closed"];

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  year?: AcademicYear | null;
}

export function AcademicYearFormModal({ isOpen, onOpenChange, year }: Props) {
  const { t } = useTranslation("school");
  const createMut = useAcademicYearsEntity.useCreate();
  const updateMut = useAcademicYearsEntity.useUpdate();
  const isEdit = !!year;

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<AcademicYearStatus>("planned");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(year?.name ?? "");
    setStartDate(year?.startDate ?? "");
    setEndDate(year?.endDate ?? "");
    setStatus(year?.status ?? "planned");
    setNotes(year?.notes ?? "");
  }, [isOpen, year]);

  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateAcademicYear({ name, startDate, endDate });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      name: name.trim(),
      startDate,
      endDate,
      status,
      notes: notes.trim() || null,
    };
    if (isEdit && year) {
      await updateMut.mutateAsync({ id: year.id, data: payload });
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
            <ModalHeader>{t(isEdit ? "academicYearsPage.formEdit" : "academicYearsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                label={t("fields.name")} value={name} onValueChange={setName}
                isRequired isInvalid={!!errors.name} errorMessage={errors.name}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input type="date" label={t("fields.startDate")} value={startDate} onValueChange={setStartDate}
                  isInvalid={!!errors.startDate} errorMessage={errors.startDate} />
                <Input type="date" label={t("fields.endDate")} value={endDate} onValueChange={setEndDate}
                  isInvalid={!!errors.endDate} errorMessage={errors.endDate} />
              </div>
              <Select
                {...selectFieldProps()}
                label={t("fields.status")}
                selectedKeys={[status]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as AcademicYearStatus | undefined;
                  if (v) setStatus(v);
                }}
              >
                {STATUSES.map((s) => (
                  <SelectItem key={s} textValue={t(`status.${s}`)}>{t(`status.${s}`)}</SelectItem>
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
