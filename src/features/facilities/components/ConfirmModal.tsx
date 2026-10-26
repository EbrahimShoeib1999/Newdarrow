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
  /** Optional extra content (e.g. the completion note field). */
  children?: React.ReactNode;
  /** Disable confirm until the extra content is valid (e.g. note typed). */
  confirmDisabled?: boolean;
}

/**
 * Single confirmation surface for destructive/financial actions (delete,
 * cancel order, complete order) — mirrors the guarded-transition principle:
 * the serious actions always pass through an explicit confirm step.
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
