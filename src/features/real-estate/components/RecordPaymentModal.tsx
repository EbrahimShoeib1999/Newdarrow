import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Checkbox,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RemSelect } from "./RemSelect";
import { useRecordPaymentMutation } from "../hooks/use-real-estate-finance";
import { useRemActor } from "../hooks/use-real-estate";
import { remErrorText } from "../lib/ui-maps";
import { installmentOutstanding } from "../lib/rem-finance";
import { formatDate } from "@/lib/utils";
import type { Lease, RentInstallment } from "../types/real-estate.types";

const METHODS = ["cash", "bank_transfer", "cheque", "card", "online"] as const;

interface RecordPaymentModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease;
  installments: RentInstallment[];
}

/**
 * Payment collection UI: money is only ever recorded through
 * PaymentService.record (allocations validated + installment state re-derived
 * server-side). The form starts from OPEN installments and pre-fills each
 * selected row with its outstanding balance, so over-allocation is impossible
 * by construction — the server stays the authority regardless.
 */
export function RecordPaymentModal({ isOpen, onOpenChange, lease, installments }: RecordPaymentModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const record = useRecordPaymentMutation();

  // Rows still owing money (never cancelled, never fully paid).
  const openRows = useMemo(
    () =>
      installments
        .filter((i) => i.status !== "cancelled" && installmentOutstanding(i) > 0)
        .sort((a, b) => a.periodIndex - b.periodIndex),
    [installments]
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");
  // One key per modal session: retrying the SAME submission cannot double-post.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setSelected({});
    setAmounts({});
    setReference("");
    setMethod("cash");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setIdempotencyKey(`pay_${lease.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  }, [isOpen, lease.id]);

  const total = useMemo(
    () =>
      Object.entries(amounts).reduce(
        (sum, [id, v]) => (selected[id] ? sum + (Number(v) || 0) : sum),
        0
      ),
    [amounts, selected]
  );

  const toggle = (id: string, outstanding: number) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setAmounts((a) => ({ ...a, [id]: a[id] ?? String(outstanding) }));
  };

  const onSubmit = async () => {
    const allocations = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([installmentId]) => ({ installmentId, amount: Number(amounts[installmentId]) || 0 }))
      .filter((a) => a.amount > 0);
    if (!allocations.length) {
      toast.error(t("collectionsPage.pickInstallment"));
      return;
    }
    try {
      await record.mutateAsync({
        by: actor,
        dto: {
          leaseId: lease.id,
          amount: total,
          currency: lease.currency,
          paymentDate,
          method,
          reference: reference.trim() || null,
          allocations,
          idempotencyKey,
        },
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(remErrorText(t, e));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              {t("leasesPage.recordPayment")} — <span className="font-mono text-sm">{lease.contractNumber}</span>
            </ModalHeader>
            <ModalBody className="gap-4">
              {openRows.length === 0 ? (
                <p className="text-sm text-default-400">{t("collectionsPage.nothingDue")}</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-default-100">
                  {openRows.map((i) => {
                    const outstanding = installmentOutstanding(i);
                    return (
                      <div key={i.id} className="py-2 flex items-center gap-3">
                        <Checkbox
                          isSelected={!!selected[i.id]}
                          onValueChange={() => toggle(i.id, outstanding)}
                        >
                          <span className="text-xs">{t("collectionsPage.allocate")}</span>
                        </Checkbox>
                        <div className="flex-1 text-xs text-default-600">
                          #{i.periodIndex + 1} · {formatDate(i.periodStart)} → {formatDate(i.periodEnd)}
                          <div className="text-default-400">
                            {t("fields.dueDate")}: {formatDate(i.dueDate)} ·{" "}
                            {t("fields.outstanding")}: {outstanding.toFixed(2)} {i.currency}
                          </div>
                        </div>
                        {selected[i.id] && (
                          <Input
                            type="number"
                            min={0}
                            max={outstanding}
                            step="0.01"
                            className="w-36"
                            size="sm"
                            value={amounts[i.id] ?? String(outstanding)}
                            onValueChange={(v) => setAmounts((a) => ({ ...a, [i.id]: v }))}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input type="date" label={t("fields.paymentDate")} value={paymentDate} onValueChange={setPaymentDate} />
                <RemSelect
                  label={t("fields.method")}
                  value={method}
                  onChange={setMethod}
                  options={METHODS.map((m) => ({ id: m, label: t(`paymentMethod.${m}`) }))}
                />
                <Input label={t("fields.reference")} value={reference} onValueChange={setReference} />
                <Input
                  isReadOnly
                  label={t("collectionsPage.total")}
                  value={total.toFixed(2)}
                  description={lease.currency}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={record.isPending} onPress={onSubmit} isDisabled={total <= 0}>
                {t("leasesPage.recordPayment")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
