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
}

/**
 * Engine-local confirmation surface (mirrors the facilities/agency/REM copy):
 * every destructive or irreversible action — archive, permanent delete,
 * lifecycle activation — routes through this explicit confirm step.
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
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody className="gap-4">
              <p className="text-sm text-default-600">{body}</p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {cancelLabel}
              </Button>
              <Button
                color={danger ? "danger" : "primary"}
                isLoading={isLoading}
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
