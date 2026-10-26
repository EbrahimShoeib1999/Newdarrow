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
  Switch,
} from "@heroui/react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import {
  useAssets,
  useCreateScheduleMutation,
  useFacilities,
  useUpdateScheduleMutation,
} from "../hooks/use-facilities";
import { validateScheduleDraft } from "../lib/work-order-rules";
import type { PmSchedule } from "../types/facilities.types";

interface ScheduleFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: PmSchedule | null;
}

export function ScheduleFormModal({ isOpen, onOpenChange, schedule }: ScheduleFormModalProps) {
  const { t, i18n } = useTranslation("facilities");
  const { data: facilities = [] } = useFacilities();
  const { data: assets = [] } = useAssets();
  const { data: allUsers = [] } = useAllUsers();
  const createSchedule = useCreateScheduleMutation();
  const updateSchedule = useUpdateScheduleMutation();
  const isEdit = !!schedule;

  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [lastDoneDate, setLastDoneDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setTitle(schedule?.title ?? "");
    setAssetId(schedule?.assetId ?? "");
    setFacilityId(schedule?.facilityId ?? "");
    setIntervalDays(String(schedule?.intervalDays ?? 30));
    setLastDoneDate(schedule?.lastDoneDate ?? "");
    setAssigneeId(schedule?.assigneeId ?? "");
    setActive(schedule?.active ?? true);
  }, [isOpen, schedule]);

  const submitting = createSchedule.isPending || updateSchedule.isPending;

  const nameOfUser = (id: string) => {
    const u = allUsers.find((x) => x.id === id);
    return u ? localizedName(i18n.language, u) || u.name : id;
  };

  const onSubmit = async () => {
    const found = validateScheduleDraft({ title, intervalDays: Number(intervalDays) });
    if (found.length) {
      setErrors(Object.fromEntries(found.map((e) => [e.field, t(e.messageKey)])));
      return;
    }
    const payload = {
      title: title.trim(),
      assetId: assetId || null,
      facilityId: facilityId || null,
      intervalDays: Math.floor(Number(intervalDays)),
      lastDoneDate: lastDoneDate || null,
      assigneeId: assigneeId || null,
      active,
    };
    if (isEdit && schedule) {
      await updateSchedule.mutateAsync({ id: schedule.id, data: payload });
    } else {
      // nextDueDate is derived by the service from lastDone/baseline + interval.
      await createSchedule.mutateAsync({ ...payload, nextDueDate: lastDoneDate || "" });
    }
    onOpenChange(false);
  };

  const singleSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    options: { id: string; label: string }[],
  ) => (
    <Select
      {...selectFieldProps()}
      label={label}
      placeholder={t("misc.none")}
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const v = Array.from(keys)[0] as string | undefined;
        onChange(v ?? "");
      }}
    >
      {[{ id: "", label: t("misc.none") }, ...options].map((o) => (
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
            <ModalHeader>{t(isEdit ? "schedulesPage.formEdit" : "schedulesPage.formNew")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                label={t("fields.title")}
                value={title}
                onValueChange={setTitle}
                isRequired
                isInvalid={!!errors.title}
                errorMessage={errors.title}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {singleSelect(
                  t("fields.asset"),
                  assetId,
                  setAssetId,
                  assets
                    .filter((a) => a.lifecycle === "active")
                    .map((a) => ({ id: a.id, label: `${a.tag} — ${a.name}` })),
                )}
                {singleSelect(
                  t("fields.facility"),
                  facilityId,
                  setFacilityId,
                  facilities.map((f) => ({ id: f.id, label: f.name })),
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  step="1"
                  label={t("fields.intervalDays")}
                  value={intervalDays}
                  onValueChange={setIntervalDays}
                  isRequired
                  isInvalid={!!errors.intervalDays}
                  errorMessage={errors.intervalDays}
                />
                <Input
                  type="date"
                  label={t("fields.lastDone")}
                  value={lastDoneDate}
                  onValueChange={setLastDoneDate}
                />
                {singleSelect(
                  t("fields.assignee"),
                  assigneeId,
                  setAssigneeId,
                  allUsers.map((u) => ({ id: u.id, label: nameOfUser(u.id) })),
                )}
              </div>
              <Switch isSelected={active} onValueChange={setActive}>
                {t("fields.active")}
              </Switch>
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
