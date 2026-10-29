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
  Switch,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { RemSelect } from "./RemSelect";
import { useCreateUnitMutation, useUpdateUnitMutation, useProperties, useBuildings } from "../hooks/use-real-estate";
import { validateUnitDraft } from "../lib/rem-rules";
import type {
  Unit,
  UnitType,
  UnitOperationalStatus,
  MeasurementUnit,
  UnitMeter,
} from "../types/real-estate.types";

const UNIT_TYPES: UnitType[] = [
  "apartment",
  "villa",
  "office",
  "shop",
  "clinic",
  "warehouse",
  "parking",
  "storage",
  "other",
];
// "archived" is driven by the archive action, never by this form.
const OPERATIONAL_STATUSES: UnitOperationalStatus[] = ["active", "under_construction", "unavailable"];
const UTILITIES = ["electric", "water", "gas"] as const;

interface UnitFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  unit?: Unit | null;
  /** When opened from a property profile the parent is fixed. */
  lockedPropertyId?: string;
}

/**
 * Unit create/edit. Occupancy is deliberately NOT editable — the service
 * derives it from lease records (unitProfile.occupancyNote in the locale).
 */
export function UnitFormModal({ isOpen, onOpenChange, unit, lockedPropertyId }: UnitFormModalProps) {
  const { t } = useTranslation("real_estate");
  const { data: properties = [] } = useProperties();
  const { data: buildings = [] } = useBuildings();
  const createUnit = useCreateUnitMutation();
  const updateUnit = useUpdateUnitMutation();
  const isEdit = !!unit;

  const [propertyId, setPropertyId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [unitType, setUnitType] = useState<UnitType>("apartment");
  const [usageClassification, setUsageClassification] = useState("");
  const [area, setArea] = useState("");
  const [areaUnit, setAreaUnit] = useState<MeasurementUnit>("m2");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [roomsCount, setRoomsCount] = useState("");
  const [parkingSpaces, setParkingSpaces] = useState("");
  const [layoutNote, setLayoutNote] = useState("");
  const [finishingCondition, setFinishingCondition] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [amenities, setAmenities] = useState("");
  const [operationalStatus, setOperationalStatus] = useState<UnitOperationalStatus>("active");
  const [askingRent, setAskingRent] = useState("");
  const [suggestedSalePrice, setSuggestedSalePrice] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityNote, setAvailabilityNote] = useState("");
  const [meters, setMeters] = useState<UnitMeter[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setPropertyId(lockedPropertyId ?? unit?.propertyId ?? "");
    setBuildingId(unit?.buildingId ?? "");
    setFloorId(unit?.floorId ?? "");
    setCode(unit?.code ?? "");
    setName(unit?.name ?? "");
    setNameAr(unit?.nameAr ?? "");
    setUnitType(unit?.unitType ?? "apartment");
    setUsageClassification(unit?.usageClassification ?? "");
    setArea(unit?.area != null ? String(unit.area) : "");
    setAreaUnit(unit?.areaUnit ?? "m2");
    setBedrooms(unit?.bedrooms != null ? String(unit.bedrooms) : "");
    setBathrooms(unit?.bathrooms != null ? String(unit.bathrooms) : "");
    setRoomsCount(unit?.roomsCount != null ? String(unit.roomsCount) : "");
    setParkingSpaces(unit?.parkingSpaces != null ? String(unit.parkingSpaces) : "");
    setLayoutNote(unit?.layoutNote ?? "");
    setFinishingCondition(unit?.finishingCondition ?? "");
    setFurnished(unit?.furnished ?? false);
    setAmenities((unit?.amenities ?? []).join(", "));
    setOperationalStatus(unit?.operationalStatus === "archived" ? "active" : unit?.operationalStatus ?? "active");
    setAskingRent(unit?.askingRent != null ? String(unit.askingRent) : "");
    setSuggestedSalePrice(unit?.suggestedSalePrice != null ? String(unit.suggestedSalePrice) : "");
    setCurrency(unit?.currency ?? "SAR");
    setAvailabilityDate(unit?.availabilityDate ?? "");
    setAvailabilityNote(unit?.availabilityNote ?? "");
    setMeters(unit?.meters ? [...unit.meters] : []);
  }, [isOpen, unit, lockedPropertyId]);

  const submitting = createUnit.isPending || updateUnit.isPending;
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const int = (v: string) => (v.trim() ? Math.max(0, Math.floor(Number(v)) || 0) : null);

  // Cascading structure: floors only exist inside the picked building.
  const propertyBuildings = buildings.filter((b) => b.propertyId === propertyId && !b.archived);
  const selectedBuilding = propertyBuildings.find((b) => b.id === buildingId) ?? null;
  const floors = selectedBuilding?.floors ?? [];

  const onPropertyChange = (v: string) => {
    setPropertyId(v);
    setBuildingId("");
    setFloorId("");
  };
  const onBuildingChange = (v: string) => {
    setBuildingId(v);
    setFloorId("");
  };

  const addMeter = () => {
    setMeters((m) => [...m, { id: "", utility: "electric", meterNumber: "", label: null }]);
  };
  const patchMeter = (idx: number, patch: Partial<UnitMeter>) => {
    setMeters((m) => m.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const onSubmit = async () => {
    const draft = { code: code.trim() || "AUTO", name, propertyId, area: num(area), askingRent: num(askingRent) };
    const found = validateUnitDraft(draft);
    // Auto-allocation always yields a valid code; only user-supplied ones matter.
    const relevant = found.filter((e) => !(e.field === "code" && !code.trim()));
    if (relevant.length) {
      setErrors(Object.fromEntries(relevant.map((e) => [e.field, t(`validation.${e.messageKey.split(".").pop()}`)])));
      return;
    }
    const payload = {
      propertyId,
      buildingId: buildingId || null,
      floorId: floorId || null,
      name: name.trim(),
      nameAr: nameAr.trim() || null,
      unitType,
      usageClassification: usageClassification.trim() || null,
      area: num(area),
      areaUnit,
      bedrooms: int(bedrooms),
      bathrooms: int(bathrooms),
      roomsCount: int(roomsCount),
      parkingSpaces: int(parkingSpaces),
      layoutNote: layoutNote.trim() || null,
      finishingCondition: finishingCondition.trim() || null,
      furnished,
      amenities: amenities.split(",").map((a) => a.trim()).filter(Boolean),
      operationalStatus,
      maintenanceHold: unit?.maintenanceHold ?? false,
      askingRent: num(askingRent),
      suggestedSalePrice: num(suggestedSalePrice),
      currency: currency.trim().toUpperCase() || "SAR",
      availabilityDate: availabilityDate || null,
      availabilityNote: availabilityNote.trim() || null,
      meters: meters.filter((m) => m.meterNumber.trim()).map((m) => ({ ...m, meterNumber: m.meterNumber.trim() })),
    };
    if (isEdit && unit) {
      await updateUnit.mutateAsync({ id: unit.id, data: payload });
    } else {
      await createUnit.mutateAsync({ ...payload, ...(code.trim() ? { code: code.trim() } : {}) });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "unitsPage.formEdit" : "unitsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <RemSelect
                  label={t("fields.property")}
                  value={propertyId}
                  onChange={onPropertyChange}
                  disabled={!!lockedPropertyId || isEdit}
                  isInvalid={!!errors.propertyId}
                  errorMessage={errors.propertyId}
                  options={properties
                    .filter((p) => !p.archived)
                    .map((p) => ({ id: p.id, label: `${p.code} — ${p.nameEn}` }))}
                />
                <RemSelect
                  label={t("fields.building")}
                  value={buildingId}
                  onChange={onBuildingChange}
                  placeholderKey={t("misc.none")}
                  options={propertyBuildings.map((b) => ({ id: b.id, label: `${b.code} — ${b.nameEn}` }))}
                />
                <RemSelect
                  label={t("fields.floor")}
                  value={floorId}
                  onChange={setFloorId}
                  placeholderKey={t("misc.none")}
                  options={floors.map((f) => ({ id: f.id, label: f.nameEn }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t("fields.code")}
                  value={isEdit && unit ? unit.code : code}
                  onValueChange={setCode}
                  isReadOnly={isEdit}
                  placeholder={isEdit ? undefined : t("misc.none")}
                  isInvalid={!!errors.code}
                  errorMessage={errors.code}
                />
                <Input
                  label={t("fields.name")}
                  value={name}
                  onValueChange={setName}
                  isRequired
                  isInvalid={!!errors.name}
                  errorMessage={errors.name}
                />
                <Input label={t("fields.nameAr")} value={nameAr} onValueChange={setNameAr} dir="rtl" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.unitType")}
                  selectedKeys={[unitType]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as UnitType | undefined;
                    if (v) setUnitType(v);
                  }}
                >
                  {UNIT_TYPES.map((k) => (
                    <SelectItem key={k} textValue={t(`unitType.${k}`)}>
                      {t(`unitType.${k}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  {...selectFieldProps()}
                  label={t("fields.operationalStatus")}
                  selectedKeys={[operationalStatus]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as UnitOperationalStatus | undefined;
                    if (v) setOperationalStatus(v);
                  }}
                >
                  {OPERATIONAL_STATUSES.map((s) => (
                    <SelectItem key={s} textValue={t(`operationalStatus.${s}`)}>
                      {t(`operationalStatus.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  label={t("fields.usageClassification")}
                  value={usageClassification}
                  onValueChange={setUsageClassification}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
                  label={t("fields.areaUnit")}
                  selectedKeys={[areaUnit]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as MeasurementUnit | undefined;
                    if (v) setAreaUnit(v);
                  }}
                >
                  {(["m2", "ft2"] as MeasurementUnit[]).map((u) => (
                    <SelectItem key={u} textValue={t(`areaUnit.${u}`)}>
                      {t(`areaUnit.${u}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input type="number" min={0} label={t("fields.bedrooms")} value={bedrooms} onValueChange={setBedrooms} />
                <Input type="number" min={0} label={t("fields.bathrooms")} value={bathrooms} onValueChange={setBathrooms} />
                <Input type="number" min={0} label={t("fields.roomsCount")} value={roomsCount} onValueChange={setRoomsCount} />
                <Input type="number" min={0} label={t("fields.parkingSpaces")} value={parkingSpaces} onValueChange={setParkingSpaces} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("fields.layoutNote")} value={layoutNote} onValueChange={setLayoutNote} />
                <Input label={t("fields.finishingCondition")} value={finishingCondition} onValueChange={setFinishingCondition} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Textarea label={t("fields.amenities")} value={amenities} onValueChange={setAmenities} minRows={1} />
<<<<<<< HEAD
                <Switch selected={furnished} onValueChange={setFurnished}>
=======
                <Switch isSelected={furnished} onValueChange={setFurnished}>
>>>>>>> b81fc4b20dad7d0cf42a39d4543f2525c8b0f6ba
                  {t("fields.furnished")}
                </Switch>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.askingRent")}
                  value={askingRent}
                  onValueChange={setAskingRent}
                  isInvalid={!!errors.askingRent}
                  errorMessage={errors.askingRent}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.suggestedSalePrice")}
                  value={suggestedSalePrice}
                  onValueChange={setSuggestedSalePrice}
                />
                <Input label={t("fields.currency")} value={currency} onValueChange={setCurrency} maxLength={3} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input type="date" label={t("fields.availabilityDate")} value={availabilityDate} onValueChange={setAvailabilityDate} />
                <Input label={t("fields.availabilityNote")} value={availabilityNote} onValueChange={setAvailabilityNote} />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-default-700">{t("fields.meters")}</p>
                  <Button size="sm" variant="light" startContent={<Plus className="w-4 h-4" />} onPress={addMeter}>
                    {t("fields.meters")}
                  </Button>
                </div>
                {meters.length === 0 && <p className="text-xs text-default-400">{t("misc.noData")}</p>}
                {meters.map((m, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="w-40">
                      <RemSelect
                        label={t("fields.utility")}
                        value={m.utility}
                        onChange={(v) => patchMeter(idx, { utility: v })}
                        options={UTILITIES.map((u) => ({ id: u, label: t(`utility.${u}`) }))}
                      />
                    </div>
                    <Input
                      className="flex-1"
                      size="sm"
                      label={t("fields.meterNumber")}
                      value={m.meterNumber}
                      onValueChange={(v) => patchMeter(idx, { meterNumber: v })}
                    />
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      aria-label={t("buttons.remove")}
                      startContent={<Trash2 className="w-4 h-4" />}
                      onPress={() => setMeters((rows) => rows.filter((_, i) => i !== idx))}
                    />
                  </div>
                ))}
              </div>

              <p className="text-xs text-default-400">{t("unitProfile.occupancyNote")}</p>
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
