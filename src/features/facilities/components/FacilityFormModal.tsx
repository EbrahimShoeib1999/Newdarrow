import { useEffect, useState } from "react";
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
import {
  useCreateFacilityMutation,
  useUpdateFacilityMutation,
} from "../hooks/use-facilities";
import { validateFacilityDraft } from "../lib/work-order-rules";
import type { Facility, FacilityKind, FacilityStatus } from "../types/facilities.types";

const KINDS: FacilityKind[] = ["building", "floor", "room", "site"];
const STATUSES: FacilityStatus[] = ["operational", "under_maintenance", "closed"];

interface FacilityFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  facility?: Facility | null;
}

export function FacilityFormModal({ isOpen, onOpenChange, facility }: FacilityFormModalProps) {
  const { t } = useTranslation("facilities");
  const createFacility = useCreateFacilityMutation();
  const updateFacility = useUpdateFacilityMutation();
  const isEdit = !!facility;

  const [name, setName] = useState("");
  const [kind, setKind] = useState<FacilityKind>("building");
  const [location, setLocation] = useState("");
  const [area, setArea] = useState("");
  const [status, setStatus] = useState<FacilityStatus>("operational");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(facility?.name ?? "");
    setKind(facility?.kind ?? "building");
    setLocation(facility?.location ?? "");
    setArea(facility?.area != null ? String(facility.area) : "");
    setStatus(facility?.status ?? "operational");
    setNotes(facility?.notes ?? "");
  }, [isOpen, facility]);

  const submitting = createFacility.isPending || updateFacility.isPending;

  const onSubmit = async () => {
    const draft = { name, area: area.trim() ? Number(area) : null };
    const found = validateFacilityDraft(draft);
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      name: name.trim(),
      kind,
      location: location.trim() || null,
      area: area.trim() ? Number(area) : null,
      status,
      notes: notes.trim() || null,
    };
    if (isEdit && facility) {
      await updateFacility.mutateAsync({ id: facility.id, data: payload });
    } else {
      await createFacility.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "facilitiesPage.formEdit" : "facilitiesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("fields.name")}
                  value={name}
                  onValueChange={setName}
                  isRequired
                  isInvalid={!!errors.name}
                  errorMessage={errors.name}
                />
                <Select
                  {...selectFieldProps()}
                  label={t("fields.kind")}
                  selectedKeys={[kind]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as FacilityKind | undefined;
                    if (v) setKind(v);
                  }}
                >
                  {KINDS.map((k) => (
                    <SelectItem key={k} textValue={t(`facilityKind.${k}`)}>
                      {t(`facilityKind.${k}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label={t("fields.location")} value={location} onValueChange={setLocation} />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.area")}
                  value={area}
                  onValueChange={setArea}
                  isInvalid={!!errors.area}
                  errorMessage={errors.area}
                />
                <Select
                  {...selectFieldProps()}
                  label={t("fields.status")}
                  selectedKeys={[status]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as FacilityStatus | undefined;
                    if (v) setStatus(v);
                  }}
                >
                  {STATUSES.map((s) => (
                    <SelectItem key={s} textValue={t(`facilityStatus.${s}`)}>
                      {t(`facilityStatus.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
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
