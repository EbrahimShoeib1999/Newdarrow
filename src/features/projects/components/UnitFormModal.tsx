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
import { useCompany } from "@/features/companies/context/company-context";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  useCreateUnitMutation,
  useUpdateUnitMutation,
} from "../hooks/use-projects";
import type { ProjectUnit, UnitTypeKey } from "../types/unit.types";

const UNIT_TYPES: UnitTypeKey[] = [
  "apartment",
  "office",
  "villa",
  "townhouse",
  "retail",
  "warehouse",
  "parking",
  "land",
];

const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

interface UnitFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  unit?: ProjectUnit | null;
}

/**
 * Add/edit a unit's specification. Deliberately excludes `status`: moving a unit
 * through its lifecycle is a guarded transition (reserve/sell/release), never a
 * side effect of editing the form — so this modal cannot bypass the business rules.
 */
export function UnitFormModal({ isOpen, onOpenChange, projectId, unit }: UnitFormModalProps) {
  const { t } = useTranslation("projects");
  const { companyId } = useCompany();
  const { data: contactsRes } = useContactsQuery();
  const contacts = contactsRes?.data ?? [];
  const createUnit = useCreateUnitMutation(projectId);
  const updateUnit = useUpdateUnitMutation(projectId);
  const isEdit = !!unit;

  const [code, setCode] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [unitType, setUnitType] = useState<UnitTypeKey>("apartment");
  const [area, setArea] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [buyerContactId, setBuyerContactId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (unit) {
      setCode(unit.code);
      setBuilding(unit.building ?? "");
      setFloor(unit.floor ?? "");
      setUnitType(unit.unitType);
      setArea(unit.area != null ? String(unit.area) : "");
      setPrice(String(unit.price ?? ""));
      setCurrency(unit.currency || "SAR");
      setBuyerContactId(unit.buyerContactId ?? "");
      setNotes(unit.notes ?? "");
    } else {
      setCode("");
      setBuilding("");
      setFloor("");
      setUnitType("apartment");
      setArea("");
      setPrice("");
      setCurrency("SAR");
      setBuyerContactId("");
      setNotes("");
    }
  }, [isOpen, unit]);

  const submitting = createUnit.isPending || updateUnit.isPending;
  const canSave = code.trim() !== "" && price.trim() !== "";

  const onSubmit = async () => {
    const payload = {
      code: code.trim(),
      building: building.trim() || undefined,
      floor: floor.trim() || undefined,
      unitType,
      area: area.trim() ? Number(area) : null,
      price: Number(price) || 0,
      currency,
      buyerContactId: buyerContactId || null,
      notes: notes.trim() || undefined,
    };
    if (isEdit && unit) {
      await updateUnit.mutateAsync({ unitId: unit.id, data: payload });
    } else {
      await createUnit.mutateAsync({ ...payload, status: "available" });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "units.editTitle" : "units.addTitle")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t("units.code")}
                  value={code}
                  onValueChange={setCode}
                  isRequired
                  placeholder="A-101"
                />
                <Input label={t("units.building")} value={building} onValueChange={setBuilding} />
                <Input label={t("units.floor")} value={floor} onValueChange={setFloor} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("units.unitType")}
                  selectedKeys={[unitType]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as UnitTypeKey | undefined;
                    if (v) setUnitType(v);
                  }}
                >
                  {UNIT_TYPES.map((u) => (
                    <SelectItem key={u} textValue={t(`units.types.${u}`)}>
                      {t(`units.types.${u}`)}
                    </SelectItem>
                  ))}
                </Select>

                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("units.area")}
                  value={area}
                  onValueChange={setArea}
                />

                <Select
                  {...selectFieldProps()}
                  label={t("units.currency")}
                  selectedKeys={[currency]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    if (v) setCurrency(v);
                  }}
                >
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c}>{c}</SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("units.price")}
                  value={price}
                  onValueChange={setPrice}
                  isRequired
                  description={t("units.priceHint")}
                />
                <Select
                  {...selectFieldProps()}
                  label={t("units.buyer")}
                  placeholder={t("units.noBuyer")}
                  selectedKeys={buyerContactId ? [buyerContactId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setBuyerContactId(v ?? "");
                  }}
                >
                  {[
                    { id: "", label: t("units.noBuyer") },
                    ...contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <Textarea
                label={t("units.notes")}
                value={notes}
                onValueChange={setNotes}
                minRows={2}
              />
              {!companyId && (
                <p className="text-[11px] text-danger">{t("units.noCompany")}</p>
              )}
              {isEdit && (
                <p className="text-[11px] text-default-400">{t("units.editStatusNote")}</p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("form.cancel")}
              </Button>
              <Button
                color="primary"
                isDisabled={!canSave}
                isLoading={submitting}
                onPress={onSubmit}
              >
                {t("form.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
