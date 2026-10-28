import { useEffect, useMemo, useState } from "react";
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
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { RemSelect } from "./RemSelect";
import { useCreateLeaseMutation, useUpdateLeaseMutation } from "../hooks/use-real-estate-leases";
import { useProperties, useUnits } from "../hooks/use-real-estate";
import { validateLeaseDraft } from "../lib/rem-rules";
import { contactDisplayName, remErrorText, remFieldErrors } from "../lib/ui-maps";
import type { Lease, PaymentFrequency, RentEscalation } from "../types/real-estate.types";

const FREQUENCIES: PaymentFrequency[] = ["monthly", "quarterly", "semi_annual", "annual"];

interface LeaseFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Draft/pending leases only — active leases change via renew/amend. */
  lease?: Lease | null;
}

/**
 * Lease create/edit (draft-stage). The contract number is allocated
 * transactionally by the service; status transitions never happen here.
 */
export function LeaseFormModal({ isOpen, onOpenChange, lease }: LeaseFormModalProps) {
  const { t, i18n } = useTranslation("real_estate");
  const { data: properties = [] } = useProperties();
  const { data: units = [] } = useUnits();
  const { data: contactsRes } = useContactsQuery();
  const contacts = useMemo(() => contactsRes?.data ?? [], [contactsRes]);
  const { data: allUsers = [] } = useAllUsers();
  const createLease = useCreateLeaseMutation();
  const updateLease = useUpdateLeaseMutation();
  const isEdit = !!lease;

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [tenantContactId, setTenantContactId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [frequency, setFrequency] = useState<PaymentFrequency>("monthly");
  const [dueDay, setDueDay] = useState("1");
  const [timing, setTiming] = useState<"advance" | "arrears">("advance");
  const [gracePeriodDays, setGracePeriodDays] = useState("0");
  const [depositAmount, setDepositAmount] = useState("");
  const [feesAmount, setFeesAmount] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [escalations, setEscalations] = useState<RentEscalation[]>([]);
  const [includedServices, setIncludedServices] = useState("");
  const [chargeableUtilities, setChargeableUtilities] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setPropertyId(lease?.propertyId ?? "");
    setUnitId(lease?.unitId ?? "");
    setTenantContactId(lease?.tenantContactId ?? "");
    setStartDate(lease?.startDate ?? "");
    setEndDate(lease?.endDate ?? "");
    setRentAmount(lease ? String(lease.rentAmount) : "");
    setCurrency(lease?.currency ?? "SAR");
    setFrequency(lease?.frequency ?? "monthly");
    setDueDay(lease ? String(lease.dueDay) : "1");
    setTiming(lease?.timing ?? "advance");
    setGracePeriodDays(lease ? String(lease.gracePeriodDays) : "0");
    setDepositAmount(lease?.depositAmount ? String(lease.depositAmount) : "");
    setFeesAmount(lease?.feesAmount ? String(lease.feesAmount) : "");
    setTaxPercent(lease?.taxPercent ? String(lease.taxPercent) : "");
    setTaxAmount(lease?.taxAmount ? String(lease.taxAmount) : "");
    setDiscountAmount(lease?.discountAmount ? String(lease.discountAmount) : "");
    setEscalations(lease?.escalations ? [...lease.escalations] : []);
    setIncludedServices(lease?.includedServices ?? "");
    setChargeableUtilities(lease?.chargeableUtilities ?? "");
    setResponsibleUserId(lease?.responsibleUserId ?? "");
  }, [isOpen, lease]);

  const submitting = createLease.isPending || updateLease.isPending;
  const num = (v: string) => (v.trim() ? Number(v) : null);

  // Only leasable units of the chosen property: never archived, operationally active.
  const unitOptions = units
    .filter((u) => u.propertyId === propertyId && !u.archived && u.operationalStatus === "active")
    .map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` }));

  const onPropertyChange = (v: string) => {
    setPropertyId(v);
    setUnitId("");
  };

  const addEscalation = () => {
    setEscalations((e) => [...e, { effectiveDate: "", percent: 0 }]);
  };
  const patchEscalation = (idx: number, patch: Partial<RentEscalation>) => {
    setEscalations((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const onSubmit = async () => {
    setErrors({});
    const draft = {
      propertyId,
      unitId,
      tenantContactId,
      startDate,
      endDate,
      rentAmount: Number(rentAmount) || NaN,
      currency: currency.trim().toUpperCase(),
      dueDay: Number(dueDay),
      depositAmount: num(depositAmount) ?? undefined,
      escalations,
    };
    const found = validateLeaseDraft(draft as never);
    if (found.length) {
      setErrors(
        Object.fromEntries(
          found.map((e) => [e.field, t(`validation.${e.messageKey.split(".").pop()}`, { defaultValue: t("validation.failed") })]),
        ),
      );
      return;
    }
    const contact = contacts.find((c) => c.id === tenantContactId);
    const payload = {
      propertyId,
      unitId,
      tenantContactId,
      tenantDisplayNameSnapshot: contact ? contactDisplayName(contact) : null,
      startDate,
      endDate,
      rentAmount: Number(rentAmount),
      currency: draft.currency,
      frequency,
      dueDay: Number(dueDay),
      timing,
      gracePeriodDays: Number(gracePeriodDays) || 0,
      depositAmount: num(depositAmount) ?? 0,
      feesAmount: num(feesAmount) ?? 0,
      taxPercent: num(taxPercent) ?? 0,
      taxAmount: num(taxAmount) ?? 0,
      discountAmount: num(discountAmount) ?? 0,
      escalations: escalations.filter((e) => e.effectiveDate),
      includedServices: includedServices.trim() || null,
      chargeableUtilities: chargeableUtilities.trim() || null,
      responsibleUserId: responsibleUserId || null,
    };
    try {
      if (isEdit && lease) {
        await updateLease.mutateAsync({ id: lease.id, data: payload });
      } else {
        await createLease.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (e) {
      const field = remFieldErrors(t, e);
      if (Object.keys(field).length) setErrors(field);
      else toast.error(remErrorText(t, e));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "leasesPage.formEdit" : "leasesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RemSelect
                  label={t("fields.property")}
                  value={propertyId}
                  onChange={onPropertyChange}
                  isInvalid={!!errors.propertyId}
                  errorMessage={errors.propertyId}
                  options={properties
                    .filter((p) => !p.archived)
                    .map((p) => ({ id: p.id, label: `${p.code} — ${p.nameEn}` }))}
                />
                <RemSelect
                  label={t("fields.unit")}
                  value={unitId}
                  onChange={setUnitId}
                  isInvalid={!!errors.unitId}
                  errorMessage={errors.unitId}
                  options={unitOptions}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RemSelect
                  label={t("fields.tenant")}
                  value={tenantContactId}
                  onChange={setTenantContactId}
                  isInvalid={!!errors.tenantContactId}
                  errorMessage={errors.tenantContactId}
                  options={contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) }))}
                />
                <RemSelect
                  label={t("fields.responsibleUser")}
                  value={responsibleUserId}
                  onChange={setResponsibleUserId}
                  placeholderKey={t("misc.unassigned")}
                  options={allUsers.map((u) => ({
                    id: u.id,
                    label: localizedName(i18n.language, u) || u.name,
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="date"
                  label={t("fields.startDate")}
                  value={startDate}
                  onValueChange={setStartDate}
                  isInvalid={!!errors.startDate}
                  errorMessage={errors.startDate}
                />
                <Input
                  type="date"
                  label={t("fields.endDate")}
                  value={endDate}
                  onValueChange={setEndDate}
                  isInvalid={!!errors.endDate}
                  errorMessage={errors.endDate}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.rentAmount")}
                  value={rentAmount}
                  onValueChange={setRentAmount}
                  isRequired
                  isInvalid={!!errors.rentAmount}
                  errorMessage={errors.rentAmount}
                />
                <Input label={t("fields.currency")} value={currency} onValueChange={setCurrency} maxLength={3} />
                <Select
                  {...selectFieldProps()}
                  label={t("fields.frequency")}
                  selectedKeys={[frequency]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as PaymentFrequency | undefined;
                    if (v) setFrequency(v);
                  }}
                >
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} textValue={t(`frequency.${f}`)}>
                      {t(`frequency.${f}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  label={t("fields.dueDay")}
                  value={dueDay}
                  onValueChange={setDueDay}
                  isInvalid={!!errors.dueDay}
                  errorMessage={errors.dueDay}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.timing")}
                  selectedKeys={[timing]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as "advance" | "arrears" | undefined;
                    if (v) setTiming(v);
                  }}
                >
                  {(["advance", "arrears"] as const).map((k) => (
                    <SelectItem key={k} textValue={t(`timing.${k}`)}>
                      {t(`timing.${k}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  type="number"
                  min={0}
                  label={t("fields.gracePeriodDays")}
                  value={gracePeriodDays}
                  onValueChange={setGracePeriodDays}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.depositAmount")}
                  value={depositAmount}
                  onValueChange={setDepositAmount}
                  isInvalid={!!errors.depositAmount}
                  errorMessage={errors.depositAmount}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.feesAmount")}
                  value={feesAmount}
                  onValueChange={setFeesAmount}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.taxPercent")}
                  value={taxPercent}
                  onValueChange={setTaxPercent}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.taxAmount")}
                  value={taxAmount}
                  onValueChange={setTaxAmount}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.discountAmount")}
                  value={discountAmount}
                  onValueChange={setDiscountAmount}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-default-700">{t("fields.escalations")}</p>
                  <Button size="sm" variant="light" startContent={<Plus className="w-4 h-4" />} onPress={addEscalation}>
                    {t("buttons.add")}
                  </Button>
                </div>
                {escalations.length === 0 && <p className="text-xs text-default-400">{t("misc.noData")}</p>}
                {escalations.map((e, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <Input
                      className="flex-1"
                      size="sm"
                      type="date"
                      label={t("fields.effectiveDate")}
                      value={e.effectiveDate}
                      onValueChange={(v) => patchEscalation(idx, { effectiveDate: v })}
                    />
                    <Input
                      className="w-28"
                      size="sm"
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      label={t("fields.percent")}
                      value={String(e.percent)}
                      onValueChange={(v) => patchEscalation(idx, { percent: Number(v) || 0 })}
                    />
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      aria-label={t("buttons.remove")}
                      startContent={<Trash2 className="w-4 h-4" />}
                      onPress={() => setEscalations((rows) => rows.filter((_, i) => i !== idx))}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("fields.includedServices")} value={includedServices} onValueChange={setIncludedServices} />
                <Input label={t("fields.chargeableUtilities")} value={chargeableUtilities} onValueChange={setChargeableUtilities} />
              </div>
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
