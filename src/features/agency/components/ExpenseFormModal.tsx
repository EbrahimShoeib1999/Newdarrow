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
import { SingleSelectField } from "./SingleSelectField";
import {
  EXPENSE_CATEGORIES,
  type Campaign,
  type CampaignExpense,
  type ExpenseCategory,
} from "../types/marketing.types";
import { validateExpenseDraft } from "../lib/campaign-rules";
import { useCreateExpenseMutation, useUpdateExpenseMutation } from "../hooks/use-marketing";

const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

interface ExpenseFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Campaign picker options (usually all campaigns; one on a detail page). */
  campaigns?: readonly Campaign[];
  /** Pre-selected campaign when opened from a campaign detail page. */
  campaign?: Campaign | null;
  expense?: CampaignExpense | null;
}

/**
 * Record or edit an actual campaign spend entry. Revenue is never entered
 * here — it stays in shared billing invoices (see campaign detail link flow).
 */
export function ExpenseFormModal({ isOpen, onOpenChange, campaigns, campaign, expense }: ExpenseFormModalProps) {
  const { t } = useTranslation("marketing");
  const createExpense = useCreateExpenseMutation();
  const updateExpense = useUpdateExpenseMutation();
  const isEdit = !!expense;

  const [campaignId, setCampaignId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("media_buy");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setCampaignId(expense?.campaignId ?? campaign?.id ?? "");
    setTitle(expense?.title ?? "");
    setCategory(expense?.category ?? "media_buy");
    setAmount(expense ? String(expense.amount) : "");
    setSpentAt(expense?.spentAt ?? "");
    setVendorName(expense?.vendorName ?? "");
    setCurrency(expense?.currency || campaign?.currency || "SAR");
    setNote(expense?.note ?? "");
  }, [isOpen, expense, campaign]);

  const submitting = createExpense.isPending || updateExpense.isPending;

  const onSubmit = async () => {
    const found = validateExpenseDraft({
      campaignId,
      title: title.trim(),
      amount: amount.trim() ? Number(amount) : null,
      spentAt: spentAt || null,
      currency,
    });
    if (Object.keys(found).length) {
      setErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    if (isEdit && expense) {
      await updateExpense.mutateAsync({
        id: expense.id,
        data: {
          title: title.trim(),
          category,
          amount: Number(amount),
          spentAt,
          vendorName: vendorName.trim() || null,
          currency,
          note: note.trim() || null,
        },
      });
    } else {
      await createExpense.mutateAsync({
        campaignId,
        title: title.trim(),
        category,
        amount: Number(amount),
        spentAt,
        vendorName: vendorName.trim() || null,
        currency,
        note: note.trim() || null,
      });
    }
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("expenses.formEdit") : t("expenses.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              {!isEdit && (
                <SingleSelectField
                  label={t("fields.campaign")}
                  value={campaignId}
                  onChange={setCampaignId}
                  options={(campaigns ?? (campaign ? [campaign] : [])).map((c) => ({
                    id: c.id,
                    label: `${c.code} — ${c.name}`,
                  }))}
                  placeholder={t("expenses.pickCampaign")}
                  isInvalid={!!errors.campaignId}
                  errorMessage={errors.campaignId}
                />
              )}
              <Input
                label={t("fields.title")}
                value={title}
                onValueChange={setTitle}
                isRequired
                isInvalid={!!errors.title}
                errorMessage={errors.title}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SingleSelectField
                  label={t("fields.category")}
                  value={category}
                  onChange={(v) => setCategory(v as ExpenseCategory)}
                  options={EXPENSE_CATEGORIES.map((c) => ({ id: c, label: t(`expenseCategory.${c}`) }))}
                  placeholder={t("expenseCategory.other")}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  label={t("fields.amount")}
                  value={amount}
                  onValueChange={setAmount}
                  isRequired
                  isInvalid={!!errors.amount}
                  errorMessage={errors.amount}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="date"
                  label={t("fields.spentAt")}
                  value={spentAt}
                  onValueChange={setSpentAt}
                  isRequired
                  isInvalid={!!errors.spentAt}
                  errorMessage={errors.spentAt}
                />
                <SingleSelectField
                  label={t("fields.currency")}
                  value={currency}
                  onChange={setCurrency}
                  options={CURRENCIES.map((c) => ({ id: c, label: c }))}
                  placeholder="SAR"
                  isInvalid={!!errors.currency}
                  errorMessage={errors.currency}
                />
              </div>
              <Input
                label={t("fields.vendorName")}
                value={vendorName}
                onValueChange={setVendorName}
              />
              <Textarea
                label={t("fields.note")}
                value={note}
                onValueChange={setNote}
                minRows={2}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={submitting} onPress={onSubmit}>
                {submitting ? t("buttons.saving") : t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
