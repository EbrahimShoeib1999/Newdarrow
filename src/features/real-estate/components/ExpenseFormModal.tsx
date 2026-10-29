import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RemSelect } from "./RemSelect";
import { useProperties, useUnits, useRemActor } from "../hooks/use-real-estate";
import {
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
} from "../hooks/use-real-estate-ops";
import { remErrorText, remFieldErrors } from "../lib/ui-maps";
import type { ExpenseCategory, PropertyExpense } from "../types/real-estate.types";

const CATEGORIES: ExpenseCategory[] = [
  "maintenance_repairs",
  "utilities",
  "management_fees",
  "insurance",
  "cleaning_common_area",
  "government_fees_taxes",
  "vendor_services",
  "other",
];

interface ExpenseFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: PropertyExpense | null;
  /** Locked when opened from a property page. */
  lockedPropertyId?: string;
  canApprove: boolean;
}

/**
 * Expense = domain view over a shared billing record: the form snapshots the
 * amount + reference for reporting; it never posts to the ledger here.
 */
export function ExpenseFormModal({ isOpen, onOpenChange, expense, lockedPropertyId, canApprove }: ExpenseFormModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const create = useCreateExpenseMutation();
  const update = useUpdateExpenseMutation();
  const isEdit = !!expense;

  const { data: properties = [] } = useProperties();
  const { data: units = [] } = useUnits();

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [category, setCategory] = useState<string>("maintenance_repairs");
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [expenseDate, setExpenseDate] = useState("");
  const [billRef, setBillRef] = useState("");
  const [approvalStatus, setApprovalStatus] = useState<string>("pending");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setPropertyId(lockedPropertyId ?? expense?.propertyId ?? "");
    setUnitId(expense?.unitId ?? "");
    setCategory(expense?.category ?? "maintenance_repairs");
    setVendorName(expense?.vendorNameSnapshot ?? "");
    setDescription(expense?.description ?? "");
    setAmount(expense ? String(expense.amount) : "");
    setCurrency(expense?.currency ?? "SAR");
    setExpenseDate(expense?.expenseDate ?? new Date().toISOString().slice(0, 10));
    setBillRef(expense?.billId ?? expense?.voucherId ?? expense?.journalId ?? "");
    setApprovalStatus(expense?.approvalStatus ?? "pending");
  }, [isOpen, expense, lockedPropertyId]);

  const unitOptions = useMemo(
    () =>
      units
        .filter((u) => !u.archived && u.propertyId === propertyId)
        .map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` })),
    [units, propertyId]
  );

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!propertyId) e.propertyId = t("validation.propertyRequired");
    if (description.trim().length < 3) e.description = t("validation.nameMin");
    if (!(Number(amount) > 0)) e.amount = t("validation.money");
    if (!expenseDate) e.expenseDate = t("validation.dateIso");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (!validate()) return;
    const payload = {
      propertyId,
      unitId: unitId || null,
      category: category as ExpenseCategory,
      vendorId: null,
      vendorNameSnapshot: vendorName.trim() || null,
      description: description.trim(),
      amount: Number(amount),
      currency: currency.toUpperCase(),
      expenseDate,
      billId: billRef.trim() || null,
      voucherId: null,
      journalId: null,
      createdBy: actor,
      ...(canApprove ? { approvalStatus: approvalStatus as "pending" | "approved" | "rejected" } : {}),
    };
    try {
      if (isEdit && expense) {
        await update.mutateAsync({ id: expense.id, dto: payload, by: actor, canApprove });
      } else {
        // accountingPeriod is derived by the service from expenseDate — not part of the DTO.
        await create.mutateAsync({ dto: payload, by: actor, canApprove });
      }
      onOpenChange(false);
    } catch (err) {
      const field = remFieldErrors(t, err);
      if (Object.keys(field).length) setErrors(field);
      else toast.error(remErrorText(t, err));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("expensesPage.formEdit") : t("expensesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RemSelect
                  label={t("fields.property")}
                  value={propertyId}
                  onChange={(v) => {
                    setPropertyId(v);
                    setUnitId("");
                  }}
                  disabled={!!lockedPropertyId}
                  options={properties.filter((p) => !p.archived).map((p) => ({ id: p.id, label: `${p.nameEn} · ${p.code}` }))}
                  isInvalid={!!errors.propertyId}
                  errorMessage={errors.propertyId}
                />
                <RemSelect
                  label={t("fields.unit")}
                  value={unitId}
                  onChange={setUnitId}
                  options={[{ id: "", label: t("expensesPage.wholeProperty") }, ...unitOptions]}
                />
                <RemSelect
                  label={t("fields.category")}
                  value={category}
                  onChange={setCategory}
                  options={CATEGORIES.map((c) => ({ id: c, label: t(`expenseCategory.${c}`) }))}
                />
                <Input
                  label={t("fields.vendor")}
                  value={vendorName}
                  onValueChange={setVendorName}
                />
                <Input
                  label={t("fields.description")}
                  value={description}
                  onValueChange={setDescription}
                  isInvalid={!!errors.description}
                  errorMessage={errors.description}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.amount")}
                  value={amount}
                  onValueChange={setAmount}
                  isInvalid={!!errors.amount}
                  errorMessage={errors.amount}
                />
                <Input
                  label={t("fields.currency")}
                  maxLength={3}
                  value={currency}
                  onValueChange={setCurrency}
                  isInvalid={!!errors.currency}
                  errorMessage={errors.currency}
                />
                <Input
                  type="date"
                  label={t("fields.date")}
                  value={expenseDate}
                  onValueChange={setExpenseDate}
                  isInvalid={!!errors.expenseDate}
                  errorMessage={errors.expenseDate}
                />
                <Input
                  label={t("expensesPage.billingReference")}
                  value={billRef}
                  onValueChange={setBillRef}
                  description={t("expensesPage.billingReferenceHint")}
                />
                {canApprove && (
                  <RemSelect
                    label={t("expensesPage.approvalStatus")}
                    value={approvalStatus}
                    onChange={setApprovalStatus}
                    options={[
                      { id: "pending", label: t("approvalStatus.pending") },
                      { id: "approved", label: t("approvalStatus.approved") },
                      { id: "rejected", label: t("approvalStatus.rejected") },
                    ]}
                  />
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={create.isPending || update.isPending} onPress={onSubmit}>
                {t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
