import { useEffect, useMemo, useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RemSelect } from "./RemSelect";
import { useProperties, useUnits, useRemActor } from "../hooks/use-real-estate";
import { useLeases } from "../hooks/use-real-estate";
import {
  useCreateInspectionMutation,
  useUpdateInspectionMutation,
} from "../hooks/use-real-estate-ops";
import { remErrorText, remFieldErrors } from "../lib/ui-maps";
import type { ChecklistItem, Inspection, InspectionIssue, InspectionType } from "../types/real-estate.types";

const TYPES: InspectionType[] = ["initial", "move_in", "periodic", "move_out", "final_handover"];
const RESULTS: ChecklistItem["result"][] = ["ok", "issue", "na"];

const rid = () => Math.random().toString(36).slice(2, 10);

interface InspectionFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Draft inspection to edit; finalized rows are immutable (versions instead). */
  inspection?: Inspection | null;
  lockedUnitId?: string;
}

export function InspectionFormModal({ isOpen, onOpenChange, inspection, lockedUnitId }: InspectionFormModalProps) {
  const { t } = useTranslation("real_estate");
  const actor = useRemActor();
  const create = useCreateInspectionMutation();
  const update = useUpdateInspectionMutation();
  const isEdit = !!inspection;

  const { data: properties = [] } = useProperties();
  const { data: units = [] } = useUnits();
  const { data: leases = [] } = useLeases();

  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [type, setType] = useState<string>("periodic");
  const [inspectionDate, setInspectionDate] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [issues, setIssues] = useState<InspectionIssue[]>([]);
  const [handed, setHanded] = useState<{ id: string; label: string; quantity: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setPropertyId(
      inspection?.propertyId ??
        (lockedUnitId ? units.find((u) => u.id === lockedUnitId)?.propertyId ?? "" : "")
    );
    setUnitId(inspection?.unitId ?? lockedUnitId ?? "");
    setLeaseId(inspection?.leaseId ?? "");
    setType(inspection?.type ?? "periodic");
    setInspectionDate(inspection?.inspectionDate ?? new Date().toISOString().slice(0, 10));
    setConditionNote(inspection?.conditionNote ?? "");
    setChecklist(inspection?.checklist?.length ? inspection.checklist : [{ id: rid(), label: t("inspectionsPage.conditionGeneral"), result: "ok", note: "" }]);
    setIssues((inspection?.issues ?? []).map((i) => ({ ...i })));
    setHanded((inspection?.handedItems ?? []).map((h) => ({ id: h.id, label: h.label, quantity: String(h.quantity) })));
  }, [isOpen, inspection, lockedUnitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unitOptions = useMemo(
    () =>
      units
        .filter((u) => !u.archived && (!propertyId || u.propertyId === propertyId))
        .map((u) => ({ id: u.id, label: `${u.code} — ${u.name}` })),
    [units, propertyId]
  );
  const leaseOptions = useMemo(
    () =>
      leases
        .filter((l) => l.unitId === unitId)
        .map((l) => ({ id: l.id, label: l.contractNumber })),
    [leases, unitId]
  );
  // The unit's registered meters become optional reading captures.
  const unitMeters = useMemo(() => units.find((u) => u.id === unitId)?.meters ?? [], [units, unitId]);

  const onSubmit = async () => {
    const e: Record<string, string> = {};
    if (!propertyId) e.propertyId = t("validation.propertyRequired");
    if (!inspectionDate) e.inspectionDate = t("validation.dateIso");
    setErrors(e);
    if (Object.keys(e).length) return;

    const dto = {
      propertyId,
      unitId: unitId || null,
      leaseId: leaseId || null,
      type: type as InspectionType,
      inspectionDate,
      inspectorId: inspection?.inspectorId ?? actor,
      conditionNote: conditionNote.trim() || null,
      checklist,
      photos: inspection?.photos ?? [],
      meterReadings: inspection?.meterReadings ?? [],
      handedItems: handed
        .filter((h) => h.label.trim())
        .map((h) => ({ id: h.id, label: h.label.trim(), quantity: Number(h.quantity) || 1 })),
      issues: issues.filter((i) => i.description.trim()),
      acknowledgment: inspection?.acknowledgment ?? null,
    };
    try {
      if (isEdit && inspection) {
        await update.mutateAsync({ id: inspection.id, dto });
      } else {
        await create.mutateAsync({ dto, by: actor });
      }
      onOpenChange(false);
    } catch (err) {
      const field = remFieldErrors(t, err);
      if (Object.keys(field).length) setErrors(field);
      else toast.error(remErrorText(t, err));
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{isEdit ? t("inspectionsPage.formEdit") : t("inspectionsPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <RemSelect
                  label={t("fields.property")}
                  value={propertyId}
                  onChange={(v) => {
                    setPropertyId(v);
                    setUnitId("");
                    setLeaseId("");
                  }}
                  options={properties.filter((p) => !p.archived).map((p) => ({ id: p.id, label: `${p.nameEn} · ${p.code}` }))}
                  isInvalid={!!errors.propertyId}
                  errorMessage={errors.propertyId}
                />
                <RemSelect
                  label={t("fields.unit")}
                  value={unitId}
                  onChange={(v) => {
                    setUnitId(v);
                    setLeaseId("");
                  }}
                  disabled={!!lockedUnitId}
                  options={unitOptions}
                />
                <RemSelect
                  label={t("fields.contract")}
                  value={leaseId}
                  onChange={setLeaseId}
                  options={leaseOptions}
                  placeholderKey={t("misc.none")}
                />
                <RemSelect
                  label={t("fields.type")}
                  value={type}
                  onChange={setType}
                  options={TYPES.map((tt) => ({ id: tt, label: t(`inspectionType.${tt}`) }))}
                />
                <Input type="date" label={t("fields.date")} value={inspectionDate} onValueChange={setInspectionDate} isInvalid={!!errors.inspectionDate} errorMessage={errors.inspectionDate} />
              </div>

              <Textarea label={t("inspectionsPage.conditionNote")} value={conditionNote} onValueChange={setConditionNote} minRows={2} />

              {/* Checklist */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-default-700">{t("inspectionsPage.checklist")}</h3>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<Plus className="w-3.5 h-3.5" />}
                    onPress={() => setChecklist((c) => [...c, { id: rid(), label: "", result: "ok", note: "" }])}
                  >
                    {t("inspectionsPage.addItem")}
                  </Button>
                </div>
                {checklist.map((row, idx) => (
                  <div key={row.id} className="flex gap-2 items-start">
                    <Input
                      size="sm"
                      className="flex-1"
                      placeholder={t("inspectionsPage.itemLabel")}
                      value={row.label}
                      onValueChange={(v) => setChecklist((c) => c.map((r, i) => (i === idx ? { ...r, label: v } : r)))}
                    />
                    <RemSelect
                      label=""
                      value={row.result}
                      onChange={(v) => setChecklist((c) => c.map((r, i) => (i === idx ? { ...r, result: v as ChecklistItem["result"] } : r)))}
                      options={RESULTS.map((r) => ({ id: r, label: t(`checklistResult.${r}`) }))}
                    />
                    <Button
                      size="sm"
                      variant="light"
                      color="danger"
                      isIconOnly
                      onPress={() => setChecklist((c) => c.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Issues */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-default-700">{t("inspectionsPage.issues")}</h3>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<Plus className="w-3.5 h-3.5" />}
                    onPress={() => setIssues((q) => [...q, { id: rid(), description: "", estimatedCost: null }])}
                  >
                    {t("inspectionsPage.addIssue")}
                  </Button>
                </div>
                {issues.map((row, idx) => (
                  <div key={row.id} className="flex gap-2 items-start">
                    <Input
                      size="sm"
                      className="flex-1"
                      placeholder={t("inspectionsPage.issueDescription")}
                      value={row.description}
                      onValueChange={(v) => setIssues((q) => q.map((r, i) => (i === idx ? { ...r, description: v } : r)))}
                    />
                    <Input
                      size="sm"
                      className="w-32"
                      type="number"
                      min={0}
                      placeholder={t("fields.amount")}
                      value={row.estimatedCost == null ? "" : String(row.estimatedCost)}
                      onValueChange={(v) => setIssues((q) => q.map((r, i) => (i === idx ? { ...r, estimatedCost: v === "" ? null : Number(v) } : r)))}
                    />
                    <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => setIssues((q) => q.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Handed items (keys, cards…) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-default-700">{t("inspectionsPage.handedItems")}</h3>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<Plus className="w-3.5 h-3.5" />}
                    onPress={() => setHanded((h) => [...h, { id: rid(), label: "", quantity: "1" }])}
                  >
                    {t("inspectionsPage.addItem")}
                  </Button>
                </div>
                {handed.map((row, idx) => (
                  <div key={row.id} className="flex gap-2 items-start">
                    <Input
                      size="sm"
                      className="flex-1"
                      placeholder={t("inspectionsPage.itemLabel")}
                      value={row.label}
                      onValueChange={(v) => setHanded((h) => h.map((r, i) => (i === idx ? { ...r, label: v } : r)))}
                    />
                    <Input
                      size="sm"
                      className="w-24"
                      type="number"
                      min={1}
                      placeholder={t("fields.quantity")}
                      value={row.quantity}
                      onValueChange={(v) => setHanded((h) => h.map((r, i) => (i === idx ? { ...r, quantity: v } : r)))}
                    />
                    <Button size="sm" variant="light" color="danger" isIconOnly onPress={() => setHanded((h) => h.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {unitMeters.length > 0 && !isEdit && (
                <p className="text-xs text-default-400">
                  {t("inspectionsPage.meterHint")} — {unitMeters.map((m) => `${m.utility} ${m.meterNumber}`).join(" · ")}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={create.isPending || update.isPending} onPress={onSubmit}>
                {t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
