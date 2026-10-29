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
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { useAuthStore } from "@/stores/auth.store";
import { useCreatePropertyMutation, useUpdatePropertyMutation } from "../hooks/use-real-estate";
import { validatePropertyDraft } from "../lib/rem-rules";
import { RemSelect } from "./RemSelect";
import type { Property, PropertyStatus, PropertyType, MeasurementUnit } from "../types/real-estate.types";

const TYPES: PropertyType[] = ["residential", "commercial", "administrative", "medical", "mixed_use", "industrial", "other"];
const STATUSES: PropertyStatus[] = ["active", "under_development", "archived"];

interface PropertyFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property | null;
}

/**
 * Property create/edit. The code is allocated transactionally by the service
 * (PRP-0001…) — it is deliberately not an input field, so codes can never
 * collide under concurrency.
 */
export function PropertyFormModal({ isOpen, onOpenChange, property }: PropertyFormModalProps) {
  const { t, i18n } = useTranslation("real_estate");
  const { data: allUsers = [] } = useAllUsers();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const createProperty = useCreatePropertyMutation();
  const updateProperty = useUpdatePropertyMutation();
  const isEdit = !!property;

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("residential");
  const [status, setStatus] = useState<PropertyStatus>("active");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [acquisitionPrice, setAcquisitionPrice] = useState("");
  const [valuation, setValuation] = useState("");
  const [valuationDate, setValuationDate] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [totalArea, setTotalArea] = useState("");
  const [commonArea, setCommonArea] = useState("");
  const [areaUnit, setAreaUnit] = useState<MeasurementUnit>("m2");
  const [managerId, setManagerId] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setNameEn(property?.nameEn ?? "");
    setNameAr(property?.nameAr ?? "");
    setPropertyType(property?.propertyType ?? "residential");
    setStatus(property?.status ?? "active");
    setCountry(property?.country ?? "");
    setCity(property?.city ?? "");
    setDistrict(property?.district ?? "");
    setStreet(property?.street ?? "");
    setPostalCode(property?.postalCode ?? "");
    setLat(property?.lat != null ? String(property.lat) : "");
    setLng(property?.lng != null ? String(property.lng) : "");
    setAcquisitionDate(property?.acquisitionDate ?? "");
    setAcquisitionPrice(property?.acquisitionPrice != null ? String(property.acquisitionPrice) : "");
    setValuation(property?.valuation != null ? String(property.valuation) : "");
    setValuationDate(property?.valuationDate ?? "");
    setCurrency(property?.currency ?? "SAR");
    setTotalArea(property?.totalArea != null ? String(property.totalArea) : "");
    setCommonArea(property?.commonArea != null ? String(property.commonArea) : "");
    setAreaUnit(property?.areaUnit ?? "m2");
    setManagerId(property?.managerId ?? (isEdit ? "" : currentUserId ?? ""));
    setNotes(property?.notes ?? "");
  }, [isOpen, property, isEdit, currentUserId]);

  const submitting = createProperty.isPending || updateProperty.isPending;
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const onSubmit = async () => {
    const draft = {
      nameEn,
      propertyType,
      totalArea: num(totalArea),
      acquisitionPrice: num(acquisitionPrice),
      valuation: num(valuation),
    };
    const found = validatePropertyDraft(draft);
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(`validation.${e.messageKey.split(".").pop()}`)])));
      return;
    }
    const payload = {
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim() || null,
      propertyType,
      status,
      country: country.trim() || null,
      city: city.trim() || null,
      district: district.trim() || null,
      street: street.trim() || null,
      postalCode: postalCode.trim() || null,
      lat: num(lat),
      lng: num(lng),
      acquisitionDate: acquisitionDate || null,
      acquisitionPrice: num(acquisitionPrice),
      valuation: num(valuation),
      valuationDate: valuationDate || null,
      currency: currency.trim().toUpperCase() || "SAR",
      totalArea: num(totalArea),
      commonArea: num(commonArea),
      areaUnit,
      managerId: managerId || null,
      notes: notes.trim() || null,
    };
    if (isEdit && property) {
      await updateProperty.mutateAsync({ id: property.id, data: payload });
    } else {
      await createProperty.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "propertiesPage.formEdit" : "propertiesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("fields.nameEn")}
                  value={nameEn}
                  onValueChange={setNameEn}
                  isRequired
                  isInvalid={!!errors.nameEn}
                  errorMessage={errors.nameEn}
                />
                <Input label={t("fields.nameAr")} value={nameAr} onValueChange={setNameAr} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.propertyType")}
                  selectedKeys={[propertyType]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as PropertyType | undefined;
                    if (v) setPropertyType(v);
                  }}
                >
                  {TYPES.map((k) => (
                    <SelectItem key={k} textValue={t(`propertyType.${k}`)}>
                      {t(`propertyType.${k}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Select
                  {...selectFieldProps()}
                  label={t("fields.status")}
                  selectedKeys={[status]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as PropertyStatus | undefined;
                    if (v) setStatus(v);
                  }}
                >
                  {STATUSES.map((s) => (
                    <SelectItem key={s} textValue={t(`propertyStatus.${s}`)}>
                      {t(`propertyStatus.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
                <RemSelect
                  label={t("fields.manager")}
                  value={managerId}
                  onChange={setManagerId}
                  placeholderKey={t("misc.unassigned")}
                  options={allUsers.map((u) => ({
                    id: u.id,
                    label: localizedName(i18n.language, u) || u.name,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label={t("fields.country")} value={country} onValueChange={setCountry} />
                <Input label={t("fields.city")} value={city} onValueChange={setCity} />
                <Input label={t("fields.district")} value={district} onValueChange={setDistrict} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label={t("fields.street")} value={street} onValueChange={setStreet} />
                <Input label={t("fields.postalCode")} value={postalCode} onValueChange={setPostalCode} />
                <Input label={t("fields.currency")} value={currency} onValueChange={setCurrency} maxLength={3} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input type="number" step="0.000001" label={t("fields.lat")} value={lat} onValueChange={setLat} />
                <Input type="number" step="0.000001" label={t("fields.lng")} value={lng} onValueChange={setLng} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.totalArea")}
                  value={totalArea}
                  onValueChange={setTotalArea}
                  isInvalid={!!errors.totalArea}
                  errorMessage={errors.totalArea}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.commonArea")}
                  value={commonArea}
                  onValueChange={setCommonArea}
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Input type="date" label={t("fields.acquisitionDate")} value={acquisitionDate} onValueChange={setAcquisitionDate} />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.acquisitionPrice")}
                  value={acquisitionPrice}
                  onValueChange={setAcquisitionPrice}
                  isInvalid={!!errors.acquisitionPrice}
                  errorMessage={errors.acquisitionPrice}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.valuation")}
                  value={valuation}
                  onValueChange={setValuation}
                  isInvalid={!!errors.valuation}
                  errorMessage={errors.valuation}
                />
                <Input type="date" label={t("fields.valuationDate")} value={valuationDate} onValueChange={setValuationDate} />
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
