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
import { useAuthStore } from "@/stores/auth.store";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  useCreateProjectMutation,
  useUpdateProjectMutation,
} from "../hooks/use-projects";
import type { Project, ProjectStatus } from "../types/projects.types";

const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "on_hold",
  "completed",
  "cancelled",
];

interface ProjectFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
}

export function ProjectFormModal({
  isOpen,
  onOpenChange,
  project,
}: ProjectFormModalProps) {
  const { t } = useTranslation("projects");
  const { data: users } = useAllUsers();
  const userId = useAuthStore((s) => s.user?.id);
  const createProject = useCreateProjectMutation();
  const updateProject = useUpdateProjectMutation();
  const isEdit = !!project;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [members, setMembers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setStatus(project.status);
      setMembers(project.members ?? []);
      setStartDate(project.startDate ?? "");
      setEndDate(project.endDate ?? "");
    } else {
      setName("");
      setDescription("");
      setStatus("active");
      setMembers(userId ? [userId] : []);
      setStartDate("");
      setEndDate("");
    }
  }, [isOpen, project, userId]);

  const busy = createProject.isPending || updateProject.isPending;
  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    const payload = {
      name: name.trim(),
      description: description.trim(),
      status,
      members,
      createdBy: project?.createdBy ?? userId ?? "",
      startDate: startDate || null,
      endDate: endDate || null,
    };

    if (isEdit && project) {
      await updateProject.mutateAsync({ id: project.id, data: payload });
    } else {
      await createProject.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[90vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl bg-background",
        header: "border-b border-default-100 px-6 py-4 text-xl font-black shrink-0",
        body: "px-6 py-5 gap-5 overflow-y-auto flex-1",
        footer: "border-t border-default-100 px-6 py-4 flex items-center justify-end gap-3 shrink-0 bg-background/95 backdrop-blur-md",
      }}
    >
      <ModalContent>
        {(onClose) => (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalHeader>
              {isEdit ? t("form.editTitle") : t("form.createTitle")}
            </ModalHeader>
            <ModalBody className="gap-5">
              <Input
                label={t("form.name")}
                value={name}
                onValueChange={setName}
                isRequired
              />
              <Textarea
                label={t("form.description")}
                value={description}
                onValueChange={setDescription}
                minRows={3}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("form.status")}
                  selectedKeys={[status]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as ProjectStatus | undefined;
                    if (v) setStatus(v);
                  }}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} textValue={t(`status.${s}`)}>
                      {t(`status.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
                <ControllerDate
                  label={t("form.startDate")}
                  value={startDate}
                  onChange={setStartDate}
                />
                <ControllerDate
                  label={t("form.endDate")}
                  value={endDate}
                  onChange={setEndDate}
                />
              </div>
              <Select
                {...selectFieldProps()}
                label={t("form.members")}
                placeholder={t("form.membersPlaceholder")}
                selectionMode="multiple"
                selectedKeys={new Set(members)}
                onSelectionChange={(keys) => {
                  setMembers(Array.from(keys) as string[]);
                }}
              >
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} textValue={u.name ?? u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </Select>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("form.cancel")}
              </Button>
              <Button color="primary" isDisabled={!valid} isLoading={busy} onPress={submit}>
                {t("form.save")}
              </Button>
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}

function ControllerDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="date"
      label={label}
      value={value}
      onValueChange={onChange}
      classNames={{ input: "text-start" }}
    />
  );
}
