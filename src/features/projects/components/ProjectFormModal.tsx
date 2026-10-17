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
  Divider,
} from "@heroui/react";
import { Plus, Trash2, Sliders, Globe } from "lucide-react";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useAuthStore } from "@/stores/auth.store";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  useCreateProjectMutation,
  useUpdateProjectMutation,
} from "../hooks/use-projects";
import type { Project, ProjectPriority, ProjectStatus } from "../types/projects.types";

const PROJECT_STATUSES: ProjectStatus[] = [
  "active",
  "on_hold",
  "completed",
  "cancelled",
  "archived",
];

const PROJECT_PRIORITIES: ProjectPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

interface ProjectFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06FF\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
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
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [priority, setPriority] = useState<ProjectPriority>("medium");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    if (!isOpen) return;
    if (project) {
      setName(project.name);
      setSlug(project.slug ?? "");
      setSlugManuallyEdited(Boolean(project.slug));
      setDescription(project.description ?? "");
      setStatus(project.status);
      setPriority(project.priority ?? "medium");
      setCategory(project.category ?? "");
      setTagsInput(project.tags ? project.tags.join(", ") : "");
      setMembers(project.members ?? []);
      setStartDate(project.startDate ?? "");
      setEndDate(project.endDate ?? "");
      const cfEntries = Object.entries(project.customFields ?? {}).map(([k, v]) => ({
        key: k,
        value: String(v),
      }));
      setCustomFields(cfEntries);
    } else {
      setName("");
      setSlug("");
      setSlugManuallyEdited(false);
      setDescription("");
      setStatus("active");
      setPriority("medium");
      setCategory("");
      setTagsInput("");
      setMembers(userId ? [userId] : []);
      setStartDate("");
      setEndDate("");
      setCustomFields([]);
    }
  }, [isOpen, project, userId]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManuallyEdited) {
      setSlug(slugify(val));
    }
  };

  const handleAddCustomField = () => {
    setCustomFields((prev) => [...prev, { key: "", value: "" }]);
  };

  const handleRemoveCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCustomFieldChange = (index: number, field: "key" | "value", val: string) => {
    setCustomFields((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item))
    );
  };

  const busy = createProject.isPending || updateProject.isPending;
  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid) return;

    // Process tags
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Process custom fields map
    const customFieldsMap: Record<string, string> = {};
    for (const cf of customFields) {
      if (cf.key.trim()) {
        customFieldsMap[cf.key.trim()] = cf.value.trim();
      }
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim() ? slugify(slug) : slugify(name),
      description: description.trim(),
      status,
      priority,
      category: category.trim(),
      tags,
      customFields: customFieldsMap,
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
        body: "px-6 py-5 gap-4 overflow-y-auto flex-1",
        footer: "border-t border-default-100 px-6 py-4 flex items-center justify-end gap-3 shrink-0 bg-background/95 backdrop-blur-md",
      }}
    >
      <ModalContent>
        {(onClose) => (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalHeader>
              {isEdit ? t("form.editTitle") : t("form.createTitle")}
            </ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("form.name")}
                  value={name}
                  onValueChange={handleNameChange}
                  isRequired
                />
                <Input
                  label={t("form.slug")}
                  placeholder={t("form.slugPlaceholder")}
                  value={slug}
                  onValueChange={(val) => {
                    setSlug(val);
                    setSlugManuallyEdited(true);
                  }}
                  startContent={<Globe className="h-4 w-4 text-default-400" />}
                />
              </div>

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

                <Select
                  {...selectFieldProps()}
                  label={t("form.priority")}
                  selectedKeys={[priority]}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as ProjectPriority | undefined;
                    if (v) setPriority(v);
                  }}
                >
                  {PROJECT_PRIORITIES.map((p) => (
                    <SelectItem key={p} textValue={t(`priority.${p}`)}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </Select>

                <Input
                  label={t("form.category")}
                  placeholder={t("form.categoryPlaceholder")}
                  value={category}
                  onValueChange={setCategory}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              <Input
                label={t("form.tags")}
                placeholder={t("form.tagsPlaceholder")}
                value={tagsInput}
                onValueChange={setTagsInput}
              />

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

              <Textarea
                label={t("form.description")}
                value={description}
                onValueChange={setDescription}
                minRows={3}
              />

              {/* Dynamic Custom Fields Section */}
              <div className="space-y-3 pt-2">
                <Divider />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold text-default-800">
                      {t("form.customFields")}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    startContent={<Plus className="h-3.5 w-3.5" />}
                    onPress={handleAddCustomField}
                  >
                    {t("form.addCustomField")}
                  </Button>
                </div>

                {customFields.length > 0 && (
                  <div className="space-y-2.5">
                    {customFields.map((cf, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          size="sm"
                          placeholder={t("form.customFieldKey")}
                          value={cf.key}
                          onValueChange={(val) => handleCustomFieldChange(idx, "key", val)}
                          className="w-1/2"
                        />
                        <Input
                          size="sm"
                          placeholder={t("form.customFieldValue")}
                          value={cf.value}
                          onValueChange={(val) => handleCustomFieldChange(idx, "value", val)}
                          className="w-1/2"
                        />
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="danger"
                          onPress={() => handleRemoveCustomField(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
