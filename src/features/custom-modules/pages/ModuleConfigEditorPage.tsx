import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, CardHeader, Chip, Divider, Input, Select, SelectItem, Switch, Textarea } from "@heroui/react";
import { Plus, Trash2, Settings2 } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useActivityConfig } from "@/features/activities/hooks/use-activity-config";
import {
  useModuleDefinition,
  useModuleDefinitions,
  useCreateDefinitionMutation,
  useUpdateDefinitionMutation,
} from "../hooks/use-custom-modules";
import {
  ICON_ALLOW_LIST,
  slugifyModuleKey,
  validateDefinition,
} from "../lib/module-engine";
import { MODULE_TEMPLATES } from "../lib/module-templates";
import { moduleIcon } from "../lib/module-ui-helpers";
import { ModuleValidationError } from "../api/custom-modules.service";
import {
  MODULE_FIELD_TYPES,
  RELATION_TARGETS,
  type BilingualText,
  type CustomModuleDefinition,
  type ModuleFieldDefinition,
  type ModuleRoleGrants,
  type ModuleStageDefinition,
} from "../types/custom-module.types";

type UserRoleGrantAction = keyof ModuleRoleGrants;

const ROLES = ["super_admin", "admin", "manager", "employee", "viewer"] as const;
const GRANT_ACTIONS: UserRoleGrantAction[] = ["view", "create", "update", "archive"];
const DEFAULT_PERMISSIONS = {
  view: "custom_modules.view",
  create: "custom_modules.create",
  update: "custom_modules.update",
  archive: "custom_modules.archive",
} as CustomModuleDefinition["permissions"];

/** A fresh, editable draft with the minimum valid scaffolding. */
function blankDraft(): Partial<CustomModuleDefinition> {
  return {
    key: "",
    name: { ar: "", en: "" },
    description: { ar: "", en: "" },
    icon: "Box",
    fields: [
      { key: "name", type: "text", label: { ar: "الاسم", en: "Name" }, required: true, searchable: true, showInList: true },
    ],
    stages: [
      { key: "open", label: { ar: "مفتوح", en: "Open" }, color: "primary", next: ["done"] },
      { key: "done", label: { ar: "مغلق", en: "Done" }, color: "success", terminal: true, next: [] },
    ],
    initialStage: "open",
    listConfig: { primaryField: "name", columns: ["name"], sortField: "name", sortDir: "asc", pageSize: 15 },
    roleGrants: {
      view: ["super_admin", "admin", "manager", "employee"],
      create: ["super_admin", "admin", "manager", "employee"],
      update: ["super_admin", "admin", "manager", "employee"],
      archive: ["super_admin", "admin"],
    },
    allowPermanentDelete: false,
    permissions: DEFAULT_PERMISSIONS,
  };
}

export function ModuleConfigEditorPage() {
  const { moduleKey } = useParams<{ moduleKey?: string }>();
  const isEdit = !!moduleKey && moduleKey !== "new";
  const [searchParams] = useSearchParams();
  const templateKey = searchParams.get("template");
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("custom_modules");
  const lang = i18n.language === "ar" ? "ar" : "en";

  const { can, isAdmin } = useAppPermissions();
  const canManage = isAdmin && can("custom_modules.manage_config");
  const activityConfig = useActivityConfig();

  const { data: existing, isLoading: loadingDef } = useModuleDefinition(isEdit ? moduleKey! : null);
  const { data: allDefs = [] } = useModuleDefinitions();
  const createDef = useCreateDefinitionMutation();
  const updateDef = useUpdateDefinitionMutation();

  const [draft, setDraft] = useState<Partial<CustomModuleDefinition>>(blankDraft());
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the draft: edit → stored definition; new+template → template build();
  // new → blank. Runs once the relevant source resolves.
  useEffect(() => {
    if (isEdit && existing) {
      setDraft(existing);
    } else if (!isEdit && templateKey) {
      const tpl = MODULE_TEMPLATES.find((x) => x.key === templateKey);
      if (tpl) setDraft(tpl.build());
    }
  }, [isEdit, existing, templateKey]);

  const setField = <K extends keyof CustomModuleDefinition>(k: K, v: CustomModuleDefinition[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const fields = draft.fields ?? [];
  const stages = draft.stages ?? [];

  const updateField = (idx: number, patch: Partial<ModuleFieldDefinition>) =>
    setDraft((d) => ({ ...d, fields: (d.fields ?? []).map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  const addField = () =>
    setDraft((d) => ({
      ...d,
      fields: [...(d.fields ?? []), { key: `field_${(d.fields?.length ?? 0) + 1}`, type: "text", label: { ar: "", en: "" }, required: false, searchable: false, showInList: true }],
    }));
  const removeField = (idx: number) =>
    setDraft((d) => ({ ...d, fields: (d.fields ?? []).filter((_, i) => i !== idx) }));

  const updateStage = (idx: number, patch: Partial<ModuleStageDefinition>) =>
    setDraft((d) => ({ ...d, stages: (d.stages ?? []).map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));
  const addStage = () =>
    setDraft((d) => ({
      ...d,
      stages: [...(d.stages ?? []), { key: `stage_${(d.stages?.length ?? 0) + 1}`, label: { ar: "", en: "" }, next: [] }],
    }));
  const removeStage = (idx: number) =>
    setDraft((d) => ({ ...d, stages: (d.stages ?? []).filter((_, i) => i !== idx) }));

  const toggleGrant = (action: UserRoleGrantAction, role: string) => {
    const grants = { ...(draft.roleGrants ?? { view: [], create: [], update: [], archive: [] }) } as CustomModuleDefinition["roleGrants"];
    const list = grants[action] as string[];
    grants[action] = (list.includes(role) ? list.filter((r) => r !== role) : [...list, role]) as CustomModuleDefinition["roleGrants"][typeof action];
    setField("roleGrants", grants);
  };

  const moduleOptions = useMemo(
    () => allDefs.filter((d) => d.key !== moduleKey).map((d) => ({ key: d.key, name: d.name[lang] })),
    [allDefs, moduleKey, lang],
  );

  if (!canManage) {
    return (
      <Card>
        <CardBody className="gap-3 p-8 text-center">
          <Settings2 className="mx-auto h-10 w-10 text-danger" />
          <p className="text-sm text-default-500">{t("config.denied")}</p>
        </CardBody>
      </Card>
    );
  }

  if (isEdit && loadingDef) return <LoadingSpinner />;

  const onSubmit = async () => {
    setErrors({});
    setGeneral(null);
    setSaved(false);
    // listConfig columns auto-derive from showInList flags so they stay valid.
    const columns = fields.filter((f) => f.showInList).map((f) => f.key);
    const payload: Partial<CustomModuleDefinition> = {
      ...draft,
      activity: activityConfig.status === "ready" ? activityConfig.activity : draft.activity,
      listConfig: {
        ...(draft.listConfig ?? blankDraft().listConfig!),
        columns,
      },
    };
    const fieldErrs = validateDefinition(payload);
    if (fieldErrs.length) {
      setErrors(groupErrors(fieldErrs));
      return;
    }
    const input: Record<string, unknown> = {
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      fields: payload.fields,
      stages: payload.stages,
      initialStage: payload.initialStage,
      listConfig: payload.listConfig,
      roleGrants: payload.roleGrants,
      allowPermanentDelete: payload.allowPermanentDelete,
      permissions: payload.permissions,
      ...(isEdit ? {} : { key: payload.key, templateKey: payload.templateKey }),
    };
    try {
      if (isEdit && existing) {
        await updateDef.mutateAsync({ key: existing.key, input, expectedRevision: existing.revision });
      } else {
        await createDef.mutateAsync(input);
      }
      setSaved(true);
      navigate("/modules/manage");
    } catch (err) {
      if (err instanceof ModuleValidationError) {
        setErrors(groupErrors(err.errors));
      } else if (err instanceof Error && err.message === "stale_revision") {
        setGeneral(t("config.staleConflict"));
      } else {
        setGeneral(t("errors.unknown"));
      }
    }
  };

  const PreviewIcon = moduleIcon(draft.icon ?? "Box");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-default-900">
          {isEdit ? draft.name?.[lang] || moduleKey : t("config.newModule")}
        </h1>
        <Button as={Link} to="/modules/manage" variant="light" size="sm">{t("list.back")}</Button>
      </div>

      {general && (
        <div role="alert" className="rounded-lg border border-danger-300 bg-danger-50/60 p-3 text-sm font-semibold text-danger-600">{general}</div>
      )}
      {Object.keys(errors).length > 0 && (
        <div role="alert" className="space-y-1 rounded-lg border border-warning-300 bg-warning-50/60 p-3 text-xs font-semibold text-warning-700">
          {t("form.errorsIntro")}
        </div>
      )}

      {/* Identity */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Input
              label={t("config.keyField")}
              value={draft.key ?? ""}
              isReadOnly={isEdit}
              isInvalid={!!errors.key}
              description={isEdit ? undefined : t("config.keyHint")}
              onValueChange={(v) => setField("key", isEdit ? draft.key! : v)}
              startContent={!isEdit ? undefined : undefined}
            />
            {!isEdit && (
              <Button size="sm" variant="light" className="mt-1" onPress={() => setField("key", slugifyModuleKey(draft.name?.en || draft.name?.ar || ""))}>
                slug from name
              </Button>
            )}
            {errors.key && <p className="text-xs text-danger">{errors.key.map((r) => t(`errors.${r}`)).join(", ")}</p>}
          </div>
          <Select
            {...selectFieldProps()}
            label={t("config.icon")}
            selectedKeys={[draft.icon ?? "Box"]}
            onSelectionChange={(k) => setField("icon", Array.from(k)[0] as string)}
          >
            {ICON_ALLOW_LIST.map((i) => <SelectItem key={i}>{i}</SelectItem>)}
          </Select>
          <BilingualInput label={t("config.nameAr")} label2={t("config.nameEn")} value={draft.name ?? { ar: "", en: "" }} onChange={(v) => setField("name", v)} error={errors["name"]} />
          <Textarea label={t("config.descAr")} value={draft.description?.ar ?? ""} onValueChange={(v) => setField("description", { ...(draft.description ?? { ar: "", en: "" }), ar: v } as BilingualText)} />
          <Input label={t("config.descEn")} value={draft.description?.en ?? ""} onValueChange={(v) => setField("description", { ...(draft.description ?? { ar: "", en: "" }), en: v } as BilingualText)} />
          {errors["name"] && <p className="text-xs text-danger sm:col-span-2">{errors["name"].map((r) => t(`errors.${r}`)).join(", ")}</p>}
        </CardBody>
      </Card>

      {/* Fields */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-bold">{t("config.fieldsSection")}</span>
          <Button size="sm" variant="flat" startContent={<Plus className="h-4 w-4" />} onPress={addField}>{t("config.addField")}</Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {fields.map((f, idx) => (
            <div key={idx} className="rounded-lg border border-default-200 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Input label={t("config.fieldKey")} value={f.key} onValueChange={(v) => updateField(idx, { key: v })} isInvalid={!!errors[`field:${f.key}`]} />
                <Select {...selectFieldProps()} label={t("config.fieldType")} selectedKeys={[f.type]} onSelectionChange={(k) => updateField(idx, { type: Array.from(k)[0] as ModuleFieldDefinition["type"] })}>
                  {MODULE_FIELD_TYPES.map((ty) => <SelectItem key={ty}>{t(`types.${ty}`)}</SelectItem>)}
                </Select>
                <Input label={t("config.labelAr")} value={f.label.ar} onValueChange={(v) => updateField(idx, { label: { ...f.label, ar: v } })} />
                <Input label={t("config.labelEn")} value={f.label.en} onValueChange={(v) => updateField(idx, { label: { ...f.label, en: v } })} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <Switch isSelected={f.required} onValueChange={(v: boolean) => updateField(idx, { required: v })}><span className="text-xs">{t("config.required")}</span></Switch>
                <Switch isSelected={f.showInList} onValueChange={(v: boolean) => updateField(idx, { showInList: v })}><span className="text-xs">{t("config.showInList")}</span></Switch>
                <Switch isSelected={f.searchable} onValueChange={(v: boolean) => updateField(idx, { searchable: v })}><span className="text-xs">{t("config.searchable")}</span></Switch>
                <Switch isSelected={!!f.unique} onValueChange={(v: boolean) => updateField(idx, { unique: v })}><span className="text-xs">{t("config.unique")}</span></Switch>
                <Button size="sm" variant="light" color="danger" startContent={<Trash2 className="h-4 w-4" />} onPress={() => removeField(idx)}>{t("config.remove")}</Button>
              </div>
              {(f.type === "select" || f.type === "multiselect") && (
                <OptionsEditor options={f.options ?? []} onChange={(opts) => updateField(idx, { options: opts })} lang={lang} />
              )}
              {f.type === "relation" && (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select {...selectFieldProps()} label="target" selectedKeys={[f.relation?.target ?? "contact"]} onSelectionChange={(k) => updateField(idx, { relation: { target: Array.from(k)[0] as NonNullable<typeof f.relation>["target"], moduleKey: f.relation?.moduleKey } })}>
                    {RELATION_TARGETS.map((tg) => <SelectItem key={tg}>{t(`relationTargets.${tg}`)}</SelectItem>)}
                  </Select>
                  {f.relation?.target === "module" && (
                    <Select {...selectFieldProps()} label="module" selectedKeys={f.relation?.moduleKey ? [f.relation.moduleKey] : []} onSelectionChange={(k) => updateField(idx, { relation: { target: "module", moduleKey: Array.from(k)[0] as string } })}>
                      {moduleOptions.map((m) => <SelectItem key={m.key}>{m.name}</SelectItem>)}
                    </Select>
                  )}
                </div>
              )}
              {(f.type === "text" || f.type === "textarea" || f.type === "email" || f.type === "phone" || f.type === "url") && (
                <div className="mt-2 flex gap-3">
                  <Input type="number" label={t("config.minLen")} value={f.minLen != null ? String(f.minLen) : ""} onValueChange={(v) => updateField(idx, { minLen: v === "" ? undefined : Number(v) })} className="max-w-[140px]" />
                  <Input type="number" label={t("config.maxLen")} value={f.maxLen != null ? String(f.maxLen) : ""} onValueChange={(v) => updateField(idx, { maxLen: v === "" ? undefined : Number(v) })} className="max-w-[140px]" />
                </div>
              )}
              {(f.type === "number" || f.type === "currency") && (
                <div className="mt-2 flex gap-3">
                  <Input type="number" label={t("config.minValue")} value={f.min != null ? String(f.min) : ""} onValueChange={(v) => updateField(idx, { min: v === "" ? undefined : Number(v) })} className="max-w-[140px]" />
                  <Input type="number" label={t("config.maxValue")} value={f.max != null ? String(f.max) : ""} onValueChange={(v) => updateField(idx, { max: v === "" ? undefined : Number(v) })} className="max-w-[140px]" />
                </div>
              )}
              {errors[`field:${f.key}`] && <p className="mt-1 text-xs text-danger">{errors[`field:${f.key}`].map((r) => t(`errors.${r}`)).join(", ")}</p>}
            </div>
          ))}
          {errors.noFields && <p className="text-xs text-danger">{t("errors.noFields")}</p>}
        </CardBody>
      </Card>

      {/* Stages */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-bold">{t("config.stagesSection")}</span>
          <Button size="sm" variant="flat" startContent={<Plus className="h-4 w-4" />} onPress={addStage}>{t("config.addStage")}</Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {stages.map((s, idx) => (
            <div key={idx} className="rounded-lg border border-default-200 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Input label={t("config.stageKey")} value={s.key} onValueChange={(v) => updateStage(idx, { key: v })} />
                <Input label={t("config.labelAr")} value={s.label.ar} onValueChange={(v) => updateStage(idx, { label: { ...s.label, ar: v } })} />
                <Input label={t("config.labelEn")} value={s.label.en} onValueChange={(v) => updateStage(idx, { label: { ...s.label, en: v } })} />
                <div className="flex items-end gap-2">
                  <Switch isSelected={!!s.terminal} onValueChange={(v: boolean) => updateStage(idx, { terminal: v, next: v ? [] : s.next })}><span className="text-xs">{t("config.terminal")}</span></Switch>
                  <Button size="sm" variant="light" color="danger" isIconOnly aria-label={t("config.remove")} onPress={() => removeStage(idx)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              {!s.terminal && stages.length > 1 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-default-500">{t("config.nextStages")}:</span>
                  {stages.filter((_, i) => i !== idx).map((o) => {
                    const on = (s.next ?? []).includes(o.key);
                    return (
                      <Chip key={o.key} size="sm" variant={on ? "solid" : "flat"} color={on ? "primary" : "default"} className="cursor-pointer" onClick={() => updateStage(idx, { next: on ? s.next.filter((k) => k !== o.key) : [...s.next, o.key] })}>
                        {o.label[lang]}
                      </Chip>
                    );
                  })}
                </div>
              )}
              {errors[`stage:${s.key}`] && <p className="mt-1 text-xs text-danger">{errors[`stage:${s.key}`].map((r) => t(`errors.${r}`)).join(", ")}</p>}
            </div>
          ))}
          <Select {...selectFieldProps()} label={t("config.initialStage")} selectedKeys={draft.initialStage ? [draft.initialStage] : []} onSelectionChange={(k) => setField("initialStage", Array.from(k)[0] as string)} className="max-w-xs">
            {stages.map((s) => <SelectItem key={s.key}>{s.label[lang]}</SelectItem>)}
          </Select>
        </CardBody>
      </Card>

      {/* List config */}
      <Card>
        <CardHeader className="font-bold">{t("config.listSection")}</CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select {...selectFieldProps()} label={t("config.primaryField")} selectedKeys={draft.listConfig?.primaryField ? [draft.listConfig.primaryField] : []} onSelectionChange={(k) => setField("listConfig", { ...(draft.listConfig ?? blankDraft().listConfig!), primaryField: Array.from(k)[0] as string })}>
            {fields.map((f) => <SelectItem key={f.key}>{f.label[lang]}</SelectItem>)}
          </Select>
          <Select {...selectFieldProps()} label={t("config.sortField")} selectedKeys={draft.listConfig?.sortField ? [draft.listConfig.sortField] : []} onSelectionChange={(k) => setField("listConfig", { ...(draft.listConfig ?? blankDraft().listConfig!), sortField: Array.from(k)[0] as string })}>
            {fields.map((f) => <SelectItem key={f.key}>{f.label[lang]}</SelectItem>)}
          </Select>
          <Select {...selectFieldProps()} label={t("config.sortDir")} selectedKeys={[draft.listConfig?.sortDir ?? "asc"]} onSelectionChange={(k) => setField("listConfig", { ...(draft.listConfig ?? blankDraft().listConfig!), sortDir: Array.from(k)[0] as "asc" | "desc" })}>
            <SelectItem key="asc">{t("config.asc")}</SelectItem>
            <SelectItem key="desc">{t("config.desc")}</SelectItem>
          </Select>
          <Input type="number" label={t("config.pageSize")} value={String(draft.listConfig?.pageSize ?? 15)} onValueChange={(v) => setField("listConfig", { ...(draft.listConfig ?? blankDraft().listConfig!), pageSize: Number(v) })} />
        </CardBody>
      </Card>

      {/* Role grants */}
      <Card>
        <CardHeader className="font-bold">{t("config.grantsSection")}</CardHeader>
        <CardBody className="space-y-2">
          {GRANT_ACTIONS.map((action) => (
            <div key={action} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-semibold text-default-600">{t(`config.grant${action.charAt(0).toUpperCase() + action.slice(1)}` as never)}</span>
              {ROLES.map((role) => {
                const on = ((draft.roleGrants?.[action] ?? []) as string[]).includes(role);
                return (
                  <Chip key={role} size="sm" variant={on ? "solid" : "flat"} color={on ? "primary" : "default"} className="cursor-pointer" onClick={() => toggleGrant(action, role)}>
                    {t(`roles.${role}`)}
                  </Chip>
                );
              })}
            </div>
          ))}
          {errors["roleGrants"] && <p className="text-xs text-danger">{errors["roleGrants"].map((r) => t(`errors.${r}`)).join(", ")}</p>}
          <Divider />
          <Switch isSelected={!!draft.allowPermanentDelete} onValueChange={(v: boolean) => setField("allowPermanentDelete", v)}>
            <span className="text-sm">{t("config.allowPermanentDelete")}</span>
          </Switch>
        </CardBody>
      </Card>

      {/* Preview */}
      <Card>
        <CardHeader className="font-bold">{t("config.previewSection")}</CardHeader>
        <CardBody className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10"><PreviewIcon className="h-6 w-6 text-primary" /></div>
          <div>
            <p className="font-bold">{draft.name?.[lang] || "—"}</p>
            <p className="text-sm text-default-500">{draft.description?.[lang] || "—"}</p>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-success">{t("config.savedOk")}</span>}
        <Button variant="light" onPress={() => navigate("/modules/manage")}>{t("common:actions.cancel")}</Button>
        <Button color="primary" isLoading={createDef.isPending || updateDef.isPending} onPress={onSubmit}>
          {isEdit ? t("config.saveChanges") : t("config.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ---- helpers ---- */

function groupErrors(errs: { fieldKey: string; reason: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errs) (out[e.fieldKey] ??= []).push(e.reason);
  // bare reasons (no field) also surface keyed by reason for simple checks
  return out;
}

function BilingualInput({
  label,
  label2,
  value,
  onChange,
  error,
}: {
  label: string;
  label2: string;
  value: BilingualText;
  onChange: (v: BilingualText) => void;
  error?: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
      <Input label={label} value={value.ar} isInvalid={!!error} onValueChange={(v) => onChange({ ...value, ar: v })} />
      <Input label={label2} value={value.en} isInvalid={!!error} onValueChange={(v) => onChange({ ...value, en: v })} />
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  lang,
}: {
  options: { key: string; label: { ar: string; en: string } }[];
  onChange: (opts: { key: string; label: { ar: string; en: string } }[]) => void;
  lang: "ar" | "en";
}) {
  return (
    <div className="mt-2 rounded-lg bg-default-50 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-default-500">Options</span>
        <Button size="sm" variant="light" startContent={<Plus className="h-3 w-3" />} onPress={() => onChange([...options, { key: `opt_${options.length + 1}`, label: { ar: "", en: "" } }])}>
          add
        </Button>
      </div>
      {options.map((o, i) => (
        <div key={i} className="mb-1 flex items-center gap-2">
          <Input size="sm" placeholder="key" value={o.key} onValueChange={(v) => onChange(options.map((x, xi) => (xi === i ? { ...x, key: v } : x)))} className="max-w-[140px]" />
          <Input size="sm" placeholder={lang === "ar" ? "ar" : "ع"} value={o.label.ar} onValueChange={(v) => onChange(options.map((x, xi) => (xi === i ? { ...x, label: { ...x.label, ar: v } } : x)))} className="max-w-[140px]" />
          <Input size="sm" placeholder="en" value={o.label.en} onValueChange={(v) => onChange(options.map((x, xi) => (xi === i ? { ...x, label: { ...x.label, en: v } } : x)))} className="max-w-[140px]" />
          <Button size="sm" variant="light" isIconOnly aria-label="remove" onPress={() => onChange(options.filter((_, xi) => xi !== i))}><Trash2 className="h-3 w-3" /></Button>
        </div>
      ))}
    </div>
  );
}
