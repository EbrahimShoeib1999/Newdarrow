import { useState } from "react";
import { Button, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Trash2, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContactAddress, AddressType } from "../types/contacts.types";

interface AddressesSectionProps {
  addresses: ContactAddress[];
  onChange: (addresses: ContactAddress[]) => void;
  isAr: boolean;
}

export function AddressesSection({ addresses, onChange, isAr }: AddressesSectionProps) {
  const { t } = useTranslation("crm");
  const [type, setType] = useState<AddressType>("national");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [street, setStreet] = useState("");
  const [buildingNumber, setBuildingNumber] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [shortAddress, setShortAddress] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = () => {
    if (!city.trim() && !district.trim() && !shortAddress.trim()) return;

    const newAddr: ContactAddress = {
      id: crypto.randomUUID(),
      type,
      city: city.trim() || undefined,
      district: district.trim() || undefined,
      street: street.trim() || undefined,
      buildingNumber: buildingNumber.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      shortAddress: shortAddress.trim() || undefined,
      country: isAr ? "المملكة العربية السعودية" : "Saudi Arabia",
    };

    onChange([...addresses, newAddr]);
    setCity("");
    setDistrict("");
    setStreet("");
    setBuildingNumber("");
    setPostalCode("");
    setShortAddress("");
    setIsAdding(false);
  };

  const handleRemove = (id: string) => {
    onChange(addresses.filter((a) => a.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-default-700">
          {t("contacts.addresses.title")}
        </label>
        {!isAdding && (
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={() => setIsAdding(true)}
            startContent={<Plus className="h-3.5 w-3.5" />}
          >
            {t("contacts.addresses.add")}
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="rounded-2xl border border-primary-200 bg-primary-50/20 p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Select
              size="sm"
              label="نوع العنوان"
              selectedKeys={[type]}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as AddressType;
                if (k) setType(k);
              }}
            >
              <SelectItem key="national" textValue={t("contacts.addresses.national")}>
                {t("contacts.addresses.national")}
              </SelectItem>
              <SelectItem key="branch" textValue={t("contacts.addresses.branch")}>
                {t("contacts.addresses.branch")}
              </SelectItem>
              <SelectItem key="mailing" textValue={t("contacts.addresses.mailing")}>
                {t("contacts.addresses.mailing")}
              </SelectItem>
              <SelectItem key="other" textValue={t("contacts.addresses.other")}>
                {t("contacts.addresses.other")}
              </SelectItem>
            </Select>

            <Input
              size="sm"
              label={t("contacts.addresses.city")}
              placeholder="مثال: الرياض"
              value={city}
              onValueChange={setCity}
            />

            <Input
              size="sm"
              label={t("contacts.addresses.district")}
              placeholder="مثال: حي العليا"
              value={district}
              onValueChange={setDistrict}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Input
              size="sm"
              label={t("contacts.addresses.street")}
              placeholder="مثال: طريق الملك فهد"
              value={street}
              onValueChange={setStreet}
            />

            <Input
              size="sm"
              label={t("contacts.addresses.buildingNumber")}
              placeholder="1234"
              value={buildingNumber}
              onValueChange={setBuildingNumber}
            />

            <Input
              size="sm"
              label={t("contacts.addresses.shortAddress")}
              placeholder="مثال: RRRD2929"
              value={shortAddress}
              onValueChange={setShortAddress}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="light" onPress={() => setIsAdding(false)}>
              {t("contacts.form.cancel")}
            </Button>
            <Button size="sm" color="primary" onPress={handleAdd}>
              {t("contacts.addresses.add")}
            </Button>
          </div>
        </div>
      )}

      {addresses.length > 0 && (
        <div className="space-y-2">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-default-200 bg-default-50/50 p-2.5 text-xs"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-default-800">
                    <span>
                      {addr.type === "national"
                        ? t("contacts.addresses.national")
                        : addr.type === "branch"
                        ? t("contacts.addresses.branch")
                        : addr.type === "mailing"
                        ? t("contacts.addresses.mailing")
                        : t("contacts.addresses.other")}
                    </span>
                    {addr.city && <span className="text-default-500">• {addr.city}</span>}
                    {addr.district && <span className="text-default-500">• {addr.district}</span>}
                  </div>
                  <div className="text-[11px] text-default-500 pt-0.5">
                    {[addr.street, addr.buildingNumber && `مبنى ${addr.buildingNumber}`, addr.shortAddress]
                      .filter(Boolean)
                      .join("، ")}
                  </div>
                </div>
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                onPress={() => handleRemove(addr.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
