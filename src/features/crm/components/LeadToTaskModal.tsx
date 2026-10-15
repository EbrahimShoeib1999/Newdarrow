import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useCreateTask } from "@/features/tasks/hooks/use-task-mutations";
import { selectFieldProps } from "@/components/shared/select-field";
import { TASK_PRIORITIES } from "@/lib/constants";
import type { TaskPriority } from "@/features/tasks/types/task.types";

interface LeadToTaskModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  leadCompany?: string;
  onCreated?: () => void;
}

export function LeadToTaskModal({
  isOpen,
  onOpenChange,
  leadName,
  leadCompany,
  onCreated,
}: LeadToTaskModalProps) {
  const { t, i18n } = useTranslation("crm");
  const { data: users } = useAllUsers();
  const createTask = useCreateTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>("high");

  useEffect(() => {
    if (!isOpen) return;
    setTitle(`${t("leadDetail.wonTask.title", "Follow-up with")}: ${leadName}`);
    setDescription(
      leadCompany
        ? t("leadDetail.wonTask.desc", `Onboard the newly won client: {{company}}`, { company: leadCompany })
        : t("leadDetail.wonTask.descGeneric", "Onboard the newly won client.")
    );
    setAssigneeId(null);
    setPriority("high");
  }, [isOpen, leadName, leadCompany, t]);

  const busy = createTask.isPending;
  const valid = title.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    await createTask.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      status: "todo",
      priority,
      type: "task",
      assigneeId,
      tags: ["lead-won"],
    });
    onCreated?.();
    onOpenChange(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[90vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl bg-background",
        header: "border-b border-default-100 px-6 py-4 text-xl font-black shrink-0",
        body: "px-6 py-5 gap-4 overflow-y-auto flex-1",
        footer: "border-t border-default-100 px-6 py-4 flex items-center justify-end gap-3 shrink-0 bg-background/95 backdrop-blur-md",
      }}
    >
      <ModalContent>
        {(onClose) => (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalHeader>{t("leadDetail.wonTask.heading", "Add to Tasks")}</ModalHeader>
            <ModalBody className="gap-4">
              <Input
                label={t("leadDetail.wonTask.taskTitle", "Task title")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                isRequired
              />
              <Select
                {...selectFieldProps()}
                label={t("leadDetail.wonTask.assignee", "Assign to")}
                selectedKeys={assigneeId ? [assigneeId] : []}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as string | undefined;
                  setAssigneeId(v ?? null);
                }}
              >
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} textValue={u.name ?? u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </Select>
              <Select
                {...selectFieldProps()}
                label={t("leadDetail.wonTask.priority", "Priority")}
                selectedKeys={[priority]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0] as TaskPriority;
                  if (v) setPriority(v);
                }}
              >
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} textValue={t(`tasks:priority.${p}`, p)}>
                    {t(`tasks:priority.${p}`, p)}
                  </SelectItem>
                ))}
              </Select>
              <Textarea
                label={t("leadDetail.wonTask.description", "Description")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minRows={3}
              />
              <p className="text-[11px] text-default-400">
                {i18n.language?.startsWith("ar")
                  ? "سيتم إنشاء المهمة في بوابة المهام ويمكن متابعتها من /tasks."
                  : "The task is created in the Tasks portal and tracked at /tasks."}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("leadDetail.wonTask.cancel", "Cancel")}
              </Button>
              <Button color="primary" isDisabled={!valid} isLoading={busy} onPress={submit}>
                {t("leadDetail.wonTask.create", "Create task")}
              </Button>
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
