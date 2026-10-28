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
import { useAmendLeaseMutation } from "../hooks/use-real-estate-leases";
import { useRemActor } from "../hooks/use-real-estate";
import { remErrorText } from "../lib/ui-maps";
import type { Lease } from "../types/real-estate.types";

/** Fields the UI amends — the service ignores protected keys anyway. */
const AMENDABLE: { key: keyof Lease; labelKey: string; kind: "money" | "text" }[] = [
  { key: "rentAmount", labelKey: "fields.rentAmount", kind: "money" },
  { key: "depositAmount", labelKey: "fields.depositAmount", kind: "money" },
  { key: "feesAmount", labelKey: "fields.feesAmount", kind: "money" },
  { key: "taxPercent", labelKey: "fields.taxPercent", kind: "money" },
  { key: "taxAmount", labelKey: "fields.taxAmount", kind: "money" },
  { key: "discountAmount", labelKey: "fields.discountAmount", kind: "money" },
  { key: "gracePeriodDays", labelKey: "fields.gracePeriodDays", kind: "money" },
  { key: "includedServices", labelKey: "fields.includedServices", kind: "text" },
  { key: "chargeableUtilities", labelKey: "fields.chargeableUtilities", kind: "text" },
];

interface AmendLeaseModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease | null;
}

/**
 * Active-lease changes are audited amendments (field before/after history),
 * never silent patches — the service appends to `lease.amendments`.
 */
export function AmendLeaseModal({ isOpen, onOpenChange, lease }: AmendLeaseModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const amend = useAmendLeaseMutation();

  const [fieldKey, setFieldKey] = useState<string>("rentAmount");
  const [value, setValue] = useState("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setFieldKey("rentAmount");
    setValue("");
    setSummary("");
  }, [isOpen]);

  const field = AMENDABLE.find((f) => f.key === fieldKey) ?? AMENDABLE[0];

  const onSubmit = async () => {
    if (!lease) return;
    const from = lease[fieldKey as keyof Lease];
    const to = field.kind === "money" ? Number(value) : value.trim() || null;
    if (field.kind === "money" && !Number.isFinite(to as number)) {
      toast.error(t("validation.money"));
      return;
    }
    try {
      await amend.mutateAsync({
        id: lease.id,
        by: actor,
        summary,
        changes: { [fieldKey]: { from, to } },
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(remErrorText(t, e));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t("leasesPage.amendTitle")}</ModalHeader>
            <ModalBody className="gap-4">
              <RemSelect
                label={t("leasesPage.amendField")}
                value={fieldKey}
                onChange={(v) => {
                  setFieldKey(v);
                  setValue("");
                }}
                options={AMENDABLE.map((f) => ({ id: f.key as string, label: t(f.labelKey) }))}
              />
              <Input
                label={t("leasesPage.amendValue")}
                type={field.kind === "money" ? "number" : "text"}
                step="0.01"
                min={0}
                value={value}
                onValueChange={setValue}
              />
              <Input
                label={t("leasesPage.amendSummary")}
                value={summary}
                onValueChange={setSummary}
                isRequired
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button
                color="primary"
                isLoading={amend.isPending}
                isDisabled={summary.trim().length < 3 || value.trim() === ""}
                onPress={onSubmit}
              >
                {t("leasesPage.amend")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
