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
import { useRenewLeaseMutation } from "../hooks/use-real-estate-leases";
import { remErrorText, remFieldErrors } from "../lib/ui-maps";
import type { Lease } from "../types/real-estate.types";

interface RenewLeaseModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease | null;
  onRenewed?: (successor: Lease) => void;
}

/**
 * Renewal never touches the original: it creates a draft successor linked via
 * renewedFromLeaseId (the service flips the original to `renewed` only when
 * the successor is activated).
 */
export function RenewLeaseModal({ isOpen, onOpenChange, lease, onRenewed }: RenewLeaseModalProps) {
  const { t } = useTranslation("real_estate");
  const renew = useRenewLeaseMutation();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen || !lease) return;
    setErrors({});
    // Sensible defaults: day after the current end, same duration and rent.
    const nextStart = new Date(lease.endDate);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const startIso = nextStart.toISOString().slice(0, 10);
    const months = Math.max(1, Math.round((new Date(lease.endDate).getTime() - new Date(lease.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
    const nextEnd = new Date(nextStart);
    nextEnd.setUTCMonth(nextEnd.getUTCMonth() + months);
    setStartDate(startIso);
    setEndDate(nextEnd.toISOString().slice(0, 10));
    setRentAmount(String(lease.rentAmount));
    setDepositAmount(lease.depositAmount ? String(lease.depositAmount) : "");
  }, [isOpen, lease]);

  const onSubmit = async () => {
    if (!lease) return;
    setErrors({});
    try {
      const successor = await renew.mutateAsync({
        id: lease.id,
        changes: {
          startDate,
          endDate,
          rentAmount: Number(rentAmount),
          ...(depositAmount.trim() ? { depositAmount: Number(depositAmount) } : {}),
        },
      });
      toast.success(`${t("leasesPage.renewTitle")}: ${successor.contractNumber}`);
      onRenewed?.(successor);
      onOpenChange(false);
    } catch (e) {
      const field = remFieldErrors(t, e);
      if (Object.keys(field).length) setErrors(field);
      else toast.error(remErrorText(t, e));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t("leasesPage.renewTitle")}</ModalHeader>
            <ModalBody className="gap-4">
              <p className="text-xs text-default-500">{t("leasesPage.renewInfo")}</p>
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
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.rentAmount")}
                  value={rentAmount}
                  onValueChange={setRentAmount}
                  isInvalid={!!errors.rentAmount}
                  errorMessage={errors.rentAmount}
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
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button
                color="primary"
                isLoading={renew.isPending}
                isDisabled={!startDate || !endDate || !rentAmount}
                onPress={onSubmit}
              >
                {t("leasesPage.renew")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
