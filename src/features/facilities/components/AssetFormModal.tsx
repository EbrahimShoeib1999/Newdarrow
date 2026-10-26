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
import { useFacilities, useCreateAssetMutation, useUpdateAssetMutation } from "../hooks/use-facilities";
import { validateAssetDraft } from "../lib/work-order-rules";
import type {
  Asset,
  AssetCategory,
  AssetCondition,
  AssetLifecycle,
} from "../types/facilities.types";

const CATEGORIES: AssetCategory[] = [
  "hvac",
  "electrical",
  "plumbing",
  "elevator",
  "fire_safety",
  "security",
  "cleaning",
  "it",
  "vehicle",
  "furniture",
  "other",
];
const CONDITIONS: AssetCondition[] = ["good", "fair", "poor", "out_of_service"];
const LIFECYCLES: AssetLifecycle[] = ["active", "retired"];
const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

interface AssetFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}

export function AssetFormModal({ isOpen, onOpenChange, asset }: AssetFormModalProps) {
  const { t } = useTranslation("facilities");
  const { data: facilities = [] } = useFacilities();
  const createAsset = useCreateAssetMutation();
  const updateAsset = useUpdateAssetMutation();
  const isEdit = !!asset;

  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AssetCategory>("hvac");
  const [facilityId, setFacilityId] = useState("");
  const [location, setLocation] = useState("");
  const [condition, setCondition] = useState<AssetCondition>("good");
  const [lifecycle, setLifecycle] = useState<AssetLifecycle>("active");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setTag(asset?.tag ?? "");
    setName(asset?.name ?? "");
    setCategory(asset?.category ?? "hvac");
    setFacilityId(asset?.facilityId ?? "");
    setLocation(asset?.location ?? "");
    setCondition(asset?.condition ?? "good");
    setLifecycle(asset?.lifecycle ?? "active");
    setPurchaseDate(asset?.purchaseDate ?? "");
    setPurchaseCost(asset?.purchaseCost != null ? String(asset.purchaseCost) : "");
    setCurrency(asset?.currency || "SAR");
    setNotes(asset?.notes ?? "");
  }, [isOpen, asset]);

  const submitting = createAsset.isPending || updateAsset.isPending;

  const onSubmit = async () => {
    const found = validateAssetDraft({ tag, name });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      tag: tag.trim(),
      name: name.trim(),
      category,
      facilityId: facilityId || null,
      location: location.trim() || null,
      condition,
      lifecycle,
      purchaseDate: purchaseDate || null,
      purchaseCost: purchaseCost.trim() ? Number(purchaseCost) : null,
      currency,
      notes: notes.trim() || null,
    };
    if (isEdit && asset) {
      await updateAsset.mutateAsync({ id: asset.id, data: payload });
    } else {
      await createAsset.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "assetsPage.formEdit" : "assetsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  label={t("fields.tag")}
                  value={tag}
                  onValueChange={setTag}
                  isRequired
                  isInvalid={!!errors.tag}
                  errorMessage={errors.tag}
                />
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
                  label={t("fields.category")}
                  selectedKeys={[category]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as AssetCategory | undefined;
                    if (v) setCategory(v);
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} textValue={t(`assetCategory.${c}`)}>
                      {t(`assetCategory.${c}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.facility")}
                  placeholder={t("misc.unlocated")}
                  selectedKeys={facilityId ? [facilityId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setFacilityId(v ?? "");
                  }}
                >
                  {[{ id: "", name: t("misc.none") }, ...facilities].map((f) => (
                    <SelectItem key={f.id} textValue={f.name || t("misc.none")}>
                      {f.name || t("misc.none")}
                    </SelectItem>
                  ))}
                </Select>
                <Input label={t("fields.location")} value={location} onValueChange={setLocation} />
                <Select
                  {...selectFieldProps()}
                  label={t("fields.condition")}
                  selectedKeys={[condition]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as AssetCondition | undefined;
                    if (v) setCondition(v);
                  }}
                >
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} textValue={t(`assetCondition.${c}`)}>
                      {t(`assetCondition.${c}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.lifecycle")}
                  selectedKeys={[lifecycle]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as AssetLifecycle | undefined;
                    if (v) setLifecycle(v);
                  }}
                >
                  {LIFECYCLES.map((l) => (
                    <SelectItem key={l} textValue={t(`lifecycle.${l}`)}>
                      {t(`lifecycle.${l}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  type="date"
                  label={t("fields.purchaseDate")}
                  value={purchaseDate}
                  onValueChange={setPurchaseDate}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.purchaseCost")}
                  value={purchaseCost}
                  onValueChange={setPurchaseCost}
                />
                <Select
                  {...selectFieldProps()}
                  label={t("fields.currency")}
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
