/**
 * Small reusable "reason required" prompt — the schedule/deduction workflow
 * refuses any mutation without a written justification, so every such action
 * funnels through this dialog instead of a bare window.prompt.
 */
import { useState } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Textarea } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface Props {
  isOpen: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => Promise<void> | void;
  confirmLabel?: string;
  confirmColor?: "primary" | "success" | "danger" | "warning";
}

export function ReasonModal({ isOpen, title, onOpenChange, onConfirm, confirmLabel, confirmColor = "primary" }: Props) {
  const { t } = useTranslation("people");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md" scrollBehavior="inside">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="font-black">{title}</ModalHeader>
            <ModalBody>
              <Textarea
                label={t("schedules.field_reason")}
                placeholder={t("schedules.reason_placeholder")}
                value={reason}
                onValueChange={setReason}
                minRows={3}
                isInvalid={reason.trim().length > 0 && reason.trim().length < 3}
                errorMessage={t("schedules.validation.reasonRequired")}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                color={confirmColor}
                onPress={submit}
                isDisabled={!reason.trim()}
                isLoading={busy}
              >
                {confirmLabel ?? t("common.confirm")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
