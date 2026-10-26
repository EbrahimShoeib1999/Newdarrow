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
import { selectFieldProps } from "@/components/shared/select-field";
import { useCreateVendorMutation, useUpdateVendorMutation } from "../hooks/use-facilities";
import { validateVendorDraft } from "../lib/work-order-rules";
import type { AssetCategory, Vendor } from "../types/facilities.types";

const CATEGORIES: (AssetCategory | "general")[] = [
  "general",
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

interface VendorFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: Vendor | null;
}

export function VendorFormModal({ isOpen, onOpenChange, vendor }: VendorFormModalProps) {
  const { t } = useTranslation("facilities");
  const createVendor = useCreateVendorMutation();
  const updateVendor = useUpdateVendorMutation();
  const isEdit = !!vendor;

  const [name, setName] = useState("");
  const [category, setCategory] = useState<AssetCategory | "general">("general");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setName(vendor?.name ?? "");
    setCategory(vendor?.category ?? "general");
    setContactName(vendor?.contactName ?? "");
    setPhone(vendor?.phone ?? "");
    setEmail(vendor?.email ?? "");
    setNotes(vendor?.notes ?? "");
    setActive(vendor?.active ?? true);
  }, [isOpen, vendor]);

  const submitting = createVendor.isPending || updateVendor.isPending;

  const onSubmit = async () => {
    const found = validateVendorDraft({ name, email: email.trim() || undefined });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      name: name.trim(),
      category,
      contactName: contactName.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
      active,
    };
    if (isEdit && vendor) {
      await updateVendor.mutateAsync({ id: vendor.id, data: payload });
    } else {
      await createVendor.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "vendorsPage.formEdit" : "vendorsPage.formNew")}</ModalHeader>
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
                  label={t("fields.category")}
                  selectedKeys={[category]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as AssetCategory | "general" | undefined;
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
                <Input label={t("fields.contactName")} value={contactName} onValueChange={setContactName} />
                <Input label={t("fields.phone")} value={phone} onValueChange={setPhone} />
                <Input
                  type="email"
                  label={t("fields.email")}
                  value={email}
                  onValueChange={setEmail}
                  isInvalid={!!errors.email}
                  errorMessage={errors.email}
                />
              </div>

              <Textarea label={t("fields.notes")} value={notes} onValueChange={setNotes} minRows={2} />
              <Switch isSelected={active} onValueChange={setActive}>
                {t("fields.active")}
              </Switch>
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
