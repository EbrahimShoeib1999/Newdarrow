import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { RemSelect } from "./RemSelect";
import { useCreateBuildingMutation, useUpdateBuildingMutation, useProperties } from "../hooks/use-real-estate";
import type { Building, Floor } from "../types/real-estate.types";

interface BuildingFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  building?: Building | null;
  /** When opened from a property profile the parent is fixed. */
  lockedPropertyId?: string;
}

/**
 * Building + embedded floor structure editor. Floors are light nested records
 * (the service assigns stable ids); units reference floorId afterwards.
 */
export function BuildingFormModal({ isOpen, onOpenChange, building, lockedPropertyId }: BuildingFormModalProps) {
  const { t } = useTranslation("real_estate");
  const { data: properties = [] } = useProperties();
  const createBuilding = useCreateBuildingMutation();
  const updateBuilding = useUpdateBuildingMutation();
  const isEdit = !!building;

  const [propertyId, setPropertyId] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [sharedFacilities, setSharedFacilities] = useState("");
  const [notes, setNotes] = useState("");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setPropertyId(lockedPropertyId ?? building?.propertyId ?? "");
    setNameEn(building?.nameEn ?? "");
    setNameAr(building?.nameAr ?? "");
    setLocationNote(building?.locationNote ?? "");
    setSharedFacilities(building?.sharedFacilities ?? "");
    setNotes(building?.notes ?? "");
    setFloors(building?.floors ? [...building.floors] : []);
  }, [isOpen, building, lockedPropertyId]);

  const submitting = createBuilding.isPending || updateBuilding.isPending;

  const addFloor = () => {
    setFloors((f) => [...f, { id: "", nameEn: `Floor ${f.length + 1}`, nameAr: null, level: f.length + 1 }]);
  };
  const patchFloor = (idx: number, patch: Partial<Floor>) => {
    setFloors((f) => f.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const onSubmit = async () => {
    if (!propertyId) {
      setError(t("validation.propertyRequired"));
      return;
    }
    if (nameEn.trim().length < 2) {
      setError(t("validation.nameMin"));
      return;
    }
    const payload = {
      propertyId,
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim() || null,
      locationNote: locationNote.trim() || null,
      sharedFacilities: sharedFacilities.trim() || null,
      notes: notes.trim() || null,
      floors: floors.map((f) => ({ ...f, level: Number.isFinite(f.level) ? f.level : 0 })),
    };
    if (isEdit && building) {
      await updateBuilding.mutateAsync({ id: building.id, data: payload });
    } else {
      await createBuilding.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "buildingsSection.edit" : "buildingsSection.add")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <RemSelect
                  label={t("fields.property")}
                  value={propertyId}
                  onChange={setPropertyId}
                  isInvalid={!!error}
                  errorMessage={error ?? undefined}
                  options={properties
                    .filter((p) => !p.archived)
                    .map((p) => ({ id: p.id, label: `${p.code} — ${p.nameEn}` }))}
                />
                <Input
                  label={t("fields.nameEn")}
                  value={nameEn}
                  onValueChange={setNameEn}
                  isRequired
                />
                <Input label={t("fields.nameAr")} value={nameAr} onValueChange={setNameAr} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("buildingsSection.locationNote")} value={locationNote} onValueChange={setLocationNote} />
                <Input label={t("buildingsSection.sharedFacilities")} value={sharedFacilities} onValueChange={setSharedFacilities} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-default-700">{t("buildingsSection.floors")}</p>
                  <Button size="sm" variant="light" startContent={<Plus className="w-4 h-4" />} onPress={addFloor}>
                    {t("buildingsSection.addFloor")}
                  </Button>
                </div>
                {floors.length === 0 && (
                  <p className="text-xs text-default-400">{t("misc.noData")}</p>
                )}
                {floors.map((f, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <Input
                      className="flex-1"
                      size="sm"
                      label={t("buildingsSection.floorName")}
                      value={f.nameEn}
                      onValueChange={(v) => patchFloor(idx, { nameEn: v })}
                    />
                    <Input
                      className="w-28"
                      size="sm"
                      type="number"
                      label={t("buildingsSection.level")}
                      value={String(f.level)}
                      onValueChange={(v) => patchFloor(idx, { level: Number(v) || 0 })}
                    />
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      aria-label={t("buttons.remove")}
                      startContent={<Trash2 className="w-4 h-4" />}
                      onPress={() => setFloors((rows) => rows.filter((_, i) => i !== idx))}
                    />
                  </div>
                ))}
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
