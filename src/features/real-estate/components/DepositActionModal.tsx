import { useEffect, useState } from "react";
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
import {
  useDepositDeductionMutation,
  useDepositReceiptMutation,
  useDepositRefundMutation,
} from "../hooks/use-real-estate-finance";
import { useRemActor } from "../hooks/use-real-estate";
import { remErrorText } from "../lib/ui-maps";
import { depositHeld } from "../lib/rem-finance";
import type { DepositRecord } from "../types/real-estate.types";

const METHODS = ["cash", "bank_transfer", "cheque", "card", "online"] as const;

export type DepositAction = "receipt" | "deduction" | "refund";

interface DepositActionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  deposit: DepositRecord | null;
  action: DepositAction;
}

/**
 * Deposit ledger actions. Balances are NEVER edited here: receipt increases
 * `receivedAmount` (as a non-allocated payment so it cannot read as revenue),
 * deduction/refund append ledger entries — status and liability are derived
 * server-side from the full ledger.
 */
export function DepositActionModal({ isOpen, onOpenChange, leaseId, deposit, action }: DepositActionModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const receipt = useDepositReceiptMutation();
  const deduction = useDepositDeductionMutation();
  const refund = useDepositRefundMutation();

  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const held = deposit ? depositHeld(deposit) : 0;

  useEffect(() => {
    if (!isOpen) return;
    setAmount("");
    setReference("");
    setReason("");
    setMethod("cash");
    setPaymentDate(new Date().toISOString().slice(0, 10));
  }, [isOpen]);

  const titleKey =
    action === "receipt" ? "leasesPage.depositReceipt" : action === "deduction" ? "leasesPage.depositDeduction" : "leasesPage.depositRefund";
  // Refund/deduction may never exceed what is currently held.
  const max = action === "receipt" ? undefined : held;

  const onSubmit = async () => {
    if (!deposit) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t("validation.money"));
      return;
    }
    try {
      if (action === "receipt") {
        await receipt.mutateAsync({
          leaseId,
          by: actor,
          input: {
            amount: value,
            paymentDate,
            method,
            reference: reference.trim() || "SECURITY_DEPOSIT",
            idempotencyKey: `dep_${leaseId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          },
        });
      } else if (action === "deduction") {
        await deduction.mutateAsync({ leaseId, input: { amount: value, reason: reason.trim(), approvedBy: actor } });
      } else {
        await refund.mutateAsync({ leaseId, input: { amount: value, reference: reference.trim() || null } });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(remErrorText(t, e));
    }
  };

  const pending = receipt.isPending || deduction.isPending || refund.isPending;

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(titleKey)}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                type="number"
                min={0}
                max={max}
                step="0.01"
                label={t("fields.amount")}
                isRequired
                value={amount}
                onValueChange={setAmount}
                description={deposit ? `${deposit.currency} · ${t("misc.held")}: ${held.toFixed(2)}` : undefined}
              />
              {action === "receipt" && (
                <>
                  <Input type="date" label={t("fields.paymentDate")} value={paymentDate} onValueChange={setPaymentDate} />
                  <RemSelect
                    label={t("fields.method")}
                    value={method}
                    onChange={setMethod}
                    options={METHODS.map((m) => ({ id: m, label: t(`paymentMethod.${m}`) }))}
                  />
                </>
              )}
              {action === "deduction" ? (
                <Input label={t("fields.reason")} value={reason} onValueChange={setReason} isRequired />
              ) : (
                <Input label={t("fields.reference")} value={reference} onValueChange={setReference} />
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button
                color={action === "receipt" ? "primary" : "warning"}
                isLoading={pending}
                isDisabled={!amount || (action === "deduction" && reason.trim().length < 3)}
                onPress={onSubmit}
              >
                {t(titleKey)}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
