import { useEffect, useMemo, useState } from "react";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Input, Select, SelectItem, Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useStudentsEntity, useGuardians, useGrades, useSections } from "../hooks/use-school";
import { validateStudent } from "../lib/school-rules";
import type { Student, StudentStatus } from "../types/school.types";

const STATUSES: StudentStatus[] = ["pending", "enrolled", "withdrawn"];

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  student?: Student | null;
}

export function StudentFormModal({ isOpen, onOpenChange, student }: Props) {
  const { t } = useTranslation("school");
  const createMut = useStudentsEntity.useCreate();
  const updateMut = useStudentsEntity.useUpdate();
  const { data: guardians = [] } = useGuardians();
  const { data: grades = [] } = useGrades();
  const { data: allSections = [] } = useSections();
  const isEdit = !!student;

  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [guardianId, setGuardianId] = useState("");
  const [status, setStatus] = useState<StudentStatus>("pending");
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sections filtered to the selected grade.
  const sectionOptions = useMemo(
    () => allSections.filter((s) => !gradeId || s.gradeId === gradeId),
    [allSections, gradeId],
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(student?.name ?? "");
    setIdentifier(student?.identifier ?? "");
    setGuardianId(student?.guardianId ?? "");
    setStatus(student?.status ?? "pending");
    setGradeId(student?.gradeId ?? "");
    setSectionId(student?.sectionId ?? "");
    setEnrollmentDate(student?.enrollmentDate ?? "");
    setNotes(student?.notes ?? "");
  }, [isOpen, student]);

  const isEnrolled = status === "enrolled";
  const submitting = createMut.isPending || updateMut.isPending;

  const onSubmit = async () => {
    const found = validateStudent({ name, guardianId, status, gradeId: gradeId || undefined, sectionId: sectionId || undefined });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      name: name.trim(),
      identifier: identifier.trim() || null,
      guardianId,
      status,
      gradeId: isEnrolled ? (gradeId || null) : null,
      sectionId: isEnrolled ? (sectionId || null) : null,
      enrollmentDate: isEnrolled ? (enrollmentDate || null) : null,
      notes: notes.trim() || null,
    };
    if (isEdit && student) {
      await updateMut.mutateAsync({ id: student.id, data: payload });
    } else {
      await createMut.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "studentsPage.formEdit" : "studentsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("fields.name")} value={name} onValueChange={setName}
                  isRequired isInvalid={!!errors.name} errorMessage={errors.name} />
                <Input label={t("fields.identifier")} value={identifier} onValueChange={setIdentifier} />
              </div>

              <Select {...selectFieldProps()} label={t("fields.guardian")}
                selectedKeys={guardianId ? [guardianId] : []}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string | undefined; if (v) setGuardianId(v); }}
                isRequired isInvalid={!!errors.guardianId} errorMessage={errors.guardianId}>
                {guardians.map((g) => <SelectItem key={g.id} textValue={g.name}>{g.name} ({g.phone})</SelectItem>)}
              </Select>

              <Select {...selectFieldProps()} label={t("fields.status")}
                selectedKeys={[status]}
                onSelectionChange={(keys) => { const v = Array.from(keys)[0] as StudentStatus | undefined; if (v) setStatus(v); }}>
                {STATUSES.map((s) => <SelectItem key={s} textValue={t(`studentStatus.${s}`)}>{t(`studentStatus.${s}`)}</SelectItem>)}
              </Select>

              {isEnrolled && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select {...selectFieldProps()} label={t("fields.grade")}
                      selectedKeys={gradeId ? [gradeId] : []}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string | undefined;
                        if (v) { setGradeId(v); setSectionId(""); }
                      }}
                      isInvalid={!!errors.gradeId} errorMessage={errors.gradeId}>
                      {grades.map((g) => <SelectItem key={g.id} textValue={g.name}>{g.name}</SelectItem>)}
                    </Select>
                    <Select {...selectFieldProps()} label={t("fields.section")}
                      selectedKeys={sectionId ? [sectionId] : []}
                      onSelectionChange={(keys) => { const v = Array.from(keys)[0] as string | undefined; if (v) setSectionId(v); }}
                      isInvalid={!!errors.sectionId} errorMessage={errors.sectionId}>
                      {sectionOptions.map((s) => <SelectItem key={s.id} textValue={s.name}>{s.name}</SelectItem>)}
                    </Select>
                  </div>
                  <Input type="date" label={t("fields.enrollmentDate")} value={enrollmentDate} onValueChange={setEnrollmentDate} />
                </>
              )}

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
