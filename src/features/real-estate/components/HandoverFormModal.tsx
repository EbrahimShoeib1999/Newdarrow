import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from "@heroui/react";
import { toast } from "sonner";
import { useRemActor } from "../hooks/use-real-estate";
import { useCreateHandoverMutation, useInspections } from "../hooks/use-real-estate-ops";
import { RemSelect } from "./RemSelect";
import { remErrorText } from "../lib/ui-maps";
import type { Lease } from "../types/real-estate.types";

interface HandoverFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  lease: Lease;
}

/**
 * Move-in / move-out handover event for a lease. Links the governing
 * inspection when one exists; the record itself is a factual log —
 * completion is a separate authorized action.
 */
export function HandoverFormModal({ isOpen, onOpenChange, lease }: HandoverFormModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const create = useCreateHandoverMutation();
  const { data: inspections = [] } = useInspections();

  const [kind, setKind] = useState<string>("move_in");
  const [handoverDate, setHandoverDate] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setKind(lease.status === "terminated" || lease.status === "expired" ? "move_out" : "move_in");
      setHandoverDate(new Date().toISOString().slice(0, 10));
      setInspectionId("");
      setNote("");
      setErrors({});
    }
  }, [isOpen, lease.status]);

  // Only inspections on the same unit can evidence this handover.
  const unitInspections = useMemo(
    () => inspections.filter((i) => i.unitId === lease.unitId),
    [inspections, lease.unitId]
  );

  const onSubmit = async () => {
    const e: Record<string, string> = {};
    if (!handoverDate) e.handoverDate = t("validation.dateIso");
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await create.mutateAsync({
        by: actor,
        dto: {
          leaseId: lease.id,
          unitId: lease.unitId,
          propertyId: lease.propertyId,
          kind: kind as "move_in" | "move_out",
          handoverDate,
          inspectionId: inspectionId || null,
          note: note.trim() || null,
        },
      });
      onOpenChange(false);
    } catch (err) {
      const field = remErrorText(t, err);
      toast.error(field);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t("handoversSection.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RemSelect
                  label={t("fields.kind")}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { id: "move_in", label: t("handoverKind.move_in") },
                    { id: "move_out", label: t("handoverKind.move_out") },
                  ]}
                />
                <Input
                  type="date"
                  label={t("fields.date")}
                  value={handoverDate}
                  onValueChange={setHandoverDate}
                  errorMessage={errors.handoverDate}
                  isInvalid={!!errors.handoverDate}
                />
              </div>
              <RemSelect
                label={t("handoversSection.inspection")}
                value={inspectionId}
                onChange={setInspectionId}
                placeholderKey={t("handoversSection.noInspection")}
                options={unitInspections.map((i) => ({ id: i.id, label: `${i.code} — ${t(`inspectionType.${i.type}`)}` }))}
              />
              <Textarea label={t("handoversSection.note")} value={note} onValueChange={setNote} minRows={2} />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={create.isPending} onPress={() => void onSubmit()}>
                {t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
