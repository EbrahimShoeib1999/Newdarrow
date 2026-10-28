import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";

interface ConfirmModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  /** Optional extra content (e.g. the void-payment reason field). */
  children?: React.ReactNode;
  /** Disable confirm until the extra content is valid. */
  confirmDisabled?: boolean;
}

/**
 * Single confirmation surface for destructive / financially significant
 * actions (archive, delete, activate lease, collect payment, refund deposit)
 * — same guarded-transition principle as the facilities module.
 */
export function ConfirmModal({
  isOpen,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  isLoading,
  onConfirm,
  children,
  confirmDisabled,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody className="gap-4">
              <p className="text-sm text-default-600">{body}</p>
              {children}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {cancelLabel}
              </Button>
              <Button
                color={danger ? "danger" : "primary"}
                isLoading={isLoading}
                isDisabled={confirmDisabled}
                onPress={onConfirm}
              >
                {confirmLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
