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
  Divider,
} from "@heroui/react";
import { Plus, Trash2, Sliders, Globe } from "lucide-react";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useAuthStore } from "@/stores/auth.store";
import { useCompany } from "@/features/companies/context/company-context";
import { selectFieldProps } from "@/components/shared/select-field";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { useDealsQuery } from "@/features/crm/hooks/use-deals";
import { useContractsQuery } from "@/features/crm/hooks/use-contracts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import {
  useCreateProjectMutation,
  useUpdateProjectMutation,
} from "../hooks/use-projects";
import { useProjectT } from "../hooks/use-project-terminology";
import { ACTIVITY_PRESETS, getActivityPreset } from "../constants/activity-presets";
import { MilestoneService } from "../api/projects.service";
import type {
  Project,
  ProjectActivityType,
  ProjectPriority,
  ProjectStatus,
} from "../types/projects.types";

const PROJECT_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
  "archived",
];

const CURRENCIES = ["SAR", "AED", "EGP", "USD", "EUR"];

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
  // Terminology-aware labels for every field title.
  const { t, i18n } = useProjectT();
  const { companyId } = useCompany();
  const { data: users } = useAllUsers();
  const { data: contactsRes } = useContactsQuery();
  const { data: dealsRes } = useDealsQuery();
  const { data: contractsRes } = useContractsQuery();
  const contacts = contactsRes?.data ?? [];
  const deals = dealsRes?.data ?? [];
  const contracts = contractsRes?.data ?? [];
  const userId = useAuthStore((s) => s.user?.id);
  const createProject = useCreateProjectMutation();
  const updateProject = useUpdateProjectMutation();
  const isEdit = !!project;

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [priority, setPriority] = useState<ProjectPriority>("medium");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [contractId, setContractId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [activityType, setActivityType] = useState<ProjectActivityType | "">("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("SAR");

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
      setContactId(project.contactId ?? "");
      setDealId(project.dealId ?? "");
      setContractId(project.contractId ?? "");
      setOwnerId(project.ownerId ?? "");
      setActivityType(
        project.activityType ? (project.activityType as ProjectActivityType) : ""
      );
      setBudget(project.budget != null ? String(project.budget) : "");
      setCurrency(project.currency || "SAR");
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
      setStatus("planning");
      setPriority("medium");
      setCategory("");
      setTagsInput("");
      setMembers(userId ? [userId] : []);
      setStartDate("");
      setEndDate("");
      setCustomFields([]);
      setContactId("");
      setDealId("");
      setContractId("");
      setOwnerId(userId ?? "");
      setActivityType("");
      setBudget("");
      setCurrency("SAR");
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
      contactId: contactId || null,
      dealId: dealId || null,
      contractId: contractId || null,
      ownerId: ownerId || null,
      activityType: activityType || null,
      budget: budget.trim() ? Number(budget) : null,
      currency,
    };

    if (isEdit && project) {
      await updateProject.mutateAsync({ id: project.id, data: payload });
    } else {
      const created = await createProject.mutateAsync(payload);
      // Activity presets only seed default milestones — all remain editable.
      const preset = getActivityPreset(activityType);
      const lang = i18n.language?.startsWith("ar") ? "ar" : "en";
      if (created?.id && preset && preset.milestones[lang].length > 0) {
        await Promise.all(
          preset.milestones[lang].map((title, idx) =>
            MilestoneService.create(
              companyId!,
              created.id,
              { title, status: "planned", sequenceOrder: idx },
              `preset_${activityType}_${idx}`
            )
          )
        );
      }
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

              {/* Commercial linkage — pure references to the authoritative CRM records */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("form.customer")}
                  placeholder={t("form.customerPlaceholder")}
                  selectedKeys={contactId ? [contactId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setContactId(v ?? "");
                    // Keep references consistent when the customer changes.
                    if (!v) {
                      setDealId("");
                      setContractId("");
                    }
                  }}
                >
                  {[
                    { id: "", label: t("form.noCustomer") },
                    ...contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>

                <Select
                  {...selectFieldProps()}
                  label={t("form.deal")}
                  placeholder={t("form.none")}
                  selectedKeys={dealId ? [dealId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setDealId(v ?? "");
                  }}
                >
                  {[
                    { id: "", label: t("form.none") },
                    ...deals
                      .filter((d) => !contactId || d.contactId === contactId)
                      .map((d) => ({ id: d.id, label: d.title })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>

                <Select
                  {...selectFieldProps()}
                  label={t("form.contract")}
                  placeholder={t("form.none")}
                  selectedKeys={contractId ? [contractId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setContractId(v ?? "");
                  }}
                >
                  {[
                    { id: "", label: t("form.none") },
                    ...contracts
                      .filter((c) => !contactId || c.contactId === contactId)
                      .map((c) => ({ id: c.id, label: c.title })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("form.owner")}
                  placeholder={t("form.membersPlaceholder")}
                  selectedKeys={ownerId ? [ownerId] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setOwnerId(v ?? "");
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
                  label={t("form.activityType")}
                  placeholder={t("form.none")}
                  selectedKeys={activityType ? [activityType] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as ProjectActivityType | undefined;
                    setActivityType(v ?? "");
                  }}
                >
                  {[
                    { id: "", label: t("form.none") },
                    ...ACTIVITY_PRESETS.map((p) => ({
                      id: p.key as string,
                      label: i18n.language?.startsWith("ar") ? p.labels.ar : p.labels.en,
                    })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>

                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  label={t("form.budget")}
                  value={budget}
                  onValueChange={setBudget}
                  description={t("form.budgetHint")}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("form.currency")}
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
                {activityType && (
                  <p className="sm:col-span-2 self-end text-[11px] text-default-400 pb-1">
                    {t("form.activityPresetHint")}
                  </p>
                )}
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
