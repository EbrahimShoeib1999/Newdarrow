import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Textarea,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import {
  useAssets,
  useCreateWorkOrderMutation,
  useFacilities,
  useUpdateWorkOrderMutation,
  useVendors,
} from "../hooks/use-facilities";
import { validateWorkOrderDraft } from "../lib/work-order-rules";
import type { WorkOrder, WorkOrderPriority } from "../types/facilities.types";

const PRIORITIES: WorkOrderPriority[] = ["low", "medium", "high", "urgent"];
const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

interface WorkOrderFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder | null;
}

/**
 * Create/edit the descriptive fields and cost buckets of a work order.
 * Deliberately excludes `status`: lifecycle moves are guarded transitions
 * on the detail page, never a side effect of editing this form.
 */
export function WorkOrderFormModal({ isOpen, onOpenChange, workOrder }: WorkOrderFormModalProps) {
  const { t, i18n } = useTranslation("facilities");
  const { data: facilities = [] } = useFacilities();
  const { data: assets = [] } = useAssets();
  const { data: vendors = [] } = useVendors();
  const { data: allUsers = [] } = useAllUsers();
  const createWo = useCreateWorkOrderMutation();
  const updateWo = useUpdateWorkOrderMutation();
  const isEdit = !!workOrder;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [laborCost, setLaborCost] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setTitle(workOrder?.title ?? "");
    setDescription(workOrder?.description ?? "");
    setFacilityId(workOrder?.facilityId ?? "");
    setAssetId(workOrder?.assetId ?? "");
    setVendorId(workOrder?.vendorId ?? "");
    setAssigneeId(workOrder?.assigneeId ?? "");
    setPriority(workOrder?.priority ?? "medium");
    setDueDate(workOrder?.dueDate ?? "");
    setPartsCost(workOrder ? String(workOrder.partsCost ?? 0) : "");
    setLaborCost(workOrder ? String(workOrder.laborCost ?? 0) : "");
    setCurrency(workOrder?.currency || "SAR");
  }, [isOpen, workOrder]);

  const submitting = createWo.isPending || updateWo.isPending;

  const nameOfUser = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? localizedName(i18n.language, u) || u.name : id;
  };

  const onSubmit = async () => {
    const found = validateWorkOrderDraft({
      title,
      priority,
      dueDate: dueDate || null,
      partsCost: partsCost.trim() ? Number(partsCost) : 0,
      laborCost: laborCost.trim() ? Number(laborCost) : 0,
    });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const shared = {
      title: title.trim(),
      description: description.trim() || null,
      facilityId: facilityId || null,
      assetId: assetId || null,
      vendorId: vendorId || null,
      assigneeId: assigneeId || null,
      priority,
      dueDate: dueDate || null,
      partsCost: partsCost.trim() ? Number(partsCost) : 0,
      laborCost: laborCost.trim() ? Number(laborCost) : 0,
      currency,
    };
    if (isEdit && workOrder) {
      await updateWo.mutateAsync({ id: workOrder.id, data: shared });
    } else {
      await createWo.mutateAsync({ ...shared, scheduleId: null });
    }
    onOpenChange(false);
  };

  const singleSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { id: string; label: string }[],
    placeholder: string,
  ) => (
    <Select
      {...selectFieldProps()}
      label={label}
      placeholder={placeholder}
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const v = Array.from(keys)[0] as string | undefined;
        onChange(v ?? "");
      }}
    >
      {[{ id: "", label: placeholder }, ...options].map((o) => (
        <SelectItem key={o.id} textValue={o.label}>
          {o.label}
        </SelectItem>
      ))}
    </Select>
  );

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{t(isEdit ? "workOrdersPage.formEdit" : "workOrdersPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                label={t("fields.title")}
                value={title}
                onValueChange={setTitle}
                isRequired
                isInvalid={!!errors.title}
                errorMessage={errors.title}
              />
              <Textarea
                label={t("fields.description")}
                value={description}
                onValueChange={setDescription}
                minRows={2}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {singleSelect(
                  t("fields.facility"),
                  facilityId,
                  setFacilityId,
                  facilities.map((f) => ({ id: f.id, label: f.name })),
                  t("misc.none"),
                )}
                {singleSelect(
                  t("fields.asset"),
                  assetId,
                  setAssetId,
                  assets
                    .filter((a) => a.lifecycle === "active")
                    .map((a) => ({ id: a.id, label: `${a.tag} — ${a.name}` })),
                  t("misc.none"),
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {singleSelect(
                  t("fields.vendor"),
                  vendorId,
                  setVendorId,
                  vendors.filter((v) => v.active).map((v) => ({ id: v.id, label: v.name })),
                  t("misc.none"),
                )}
                {singleSelect(
                  t("fields.assignee"),
                  assigneeId,
                  setAssigneeId,
                  allUsers.map((u) => ({ id: u.id, label: nameOfUser(u.id) })),
                  t("misc.unassigned"),
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("fields.priority")}
                  selectedKeys={[priority]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as WorkOrderPriority | undefined;
                    if (v) setPriority(v);
                  }}
                >
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} textValue={t(`priority.${p}`)}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </Select>
                <Input
                  type="date"
                  label={t("fields.dueDate")}
                  value={dueDate}
                  onValueChange={setDueDate}
                  isInvalid={!!errors.dueDate}
                  errorMessage={errors.dueDate}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.partsCost")}
                  value={partsCost}
                  onValueChange={setPartsCost}
                  isInvalid={!!errors.partsCost}
                  errorMessage={errors.partsCost}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("fields.laborCost")}
                  value={laborCost}
                  onValueChange={setLaborCost}
                  isInvalid={!!errors.laborCost}
                  errorMessage={errors.laborCost}
                />
              </div>

              <Select
                {...selectFieldProps()}
                label={t("fields.currency")}
                selectedKeys={[currency]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string | undefined;
                  if (v) setCurrency(v);
                }}
              >
                {CURRENCIES.map((c) => (
                  <SelectItem key={c}>{c}</SelectItem>
                ))}
              </Select>

              {isEdit && (
                <p className="text-[11px] text-default-400">{t("workOrdersPage.editNote")}</p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("buttons.cancel")}
              </Button>
              <Button color="primary" isLoading={submitting} onPress={onSubmit}>
                {t("buttons.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
