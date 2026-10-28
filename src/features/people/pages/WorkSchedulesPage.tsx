/**
 * Work schedules admin screen — editable templates (Office 13:00–20:00 and
 * Online 11:00–19:00 seeded as DOCUMENTS, never constants) and employee /
 * group assignments with effective dates. Everything here mutates through
 * WorkScheduleService so snapshots, version bumps and the audit trail stay
 * authoritative; the UI never writes Firestore directly.
 */
import { useMemo, useState } from "react";
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
} from "@heroui/react";
import { CalendarClock, Plus, RotateCcw, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { NativeDateInput } from "@/components/shared/native-date-input";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useEmployeesQuery } from "../hooks/use-people";
import {
  useCreateAssignmentMutation,
  useCreateTemplateMutation,
  useDeactivateAssignmentMutation,
  useEnsureDefaultTemplatesMutation,
  useScheduleAssignmentsQuery,
  useScheduleTemplatesQuery,
  useSetTemplateActiveMutation,
  useUpdateTemplateMutation,
} from "../hooks/use-work-schedule";
import { ScheduleValuesFields } from "../components/ScheduleValuesFields";
import { ReasonModal } from "../components/ReasonModal";
import { validateScheduleValues } from "../lib/work-schedule-rules";
import {
  OFFICE_SCHEDULE_DEFAULTS,
  type ScheduleAssignment,
  type ScheduleTemplate,
  type ScheduleValues,
  type WorkMode,
} from "../types/work-schedule.types";

const WEEKDAY_SHORT_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export default function WorkSchedulesPage() {
  const { t } = useTranslation("people");
  const { can } = useAppPermissions();
  const canManage = can("people.manage_schedules");
  const [tab, setTab] = useState<string>("templates");

  return (
    <div className="w-full min-w-0 space-y-6 pb-12 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl border border-primary/20 shadow-sm">
          <CalendarClock size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-foreground">{t("schedules.title")}</h1>
          <p className="text-xs text-default-500 font-medium mt-0.5">{t("schedules.subtitle")}</p>
        </div>
      </div>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(key: any) => setTab(String(key))}
        variant="solid"
        color="primary"
        radius="full"
        size="lg"
        classNames={{
          tabList: "w-full max-w-full overflow-x-auto scrollbar-hide flex-nowrap gap-2 p-1.5 bg-default-100/70 rounded-2xl border border-default-200/50",
          tab: "h-11 rounded-xl font-bold text-sm text-default-600 data-[selected=true]:text-primary-foreground shadow-none",
        }}
      >
        <Tab key="templates" title={t("schedules.tab_templates")}>
          <TemplatesTab canManage={canManage} />
        </Tab>
        <Tab key="assignments" title={t("schedules.tab_assignments")}>
          <AssignmentsTab canManage={canManage} />
        </Tab>
      </Tabs>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

function TemplatesTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation("people");
  const { data: templates, isLoading } = useScheduleTemplatesQuery();
  const seed = useEnsureDefaultTemplatesMutation();
  const setActive = useSetTemplateActiveMutation();
  const [editing, setEditing] = useState<ScheduleTemplate | "new" | null>(null);
  const [deactivating, setDeactivating] = useState<ScheduleTemplate | null>(null);

  if (isLoading) return <Spinner className="m-8" />;
  const rows = templates ?? [];

  return (
    <div className="space-y-4 pt-4">
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button color="primary" startContent={<Plus size={16} />} onPress={() => setEditing("new")}>
            {t("schedules.btn_new_template")}
          </Button>
          {rows.length === 0 && (
            <Button variant="bordered" startContent={<RotateCcw size={16} />} isLoading={seed.isPending} onPress={() => seed.mutateAsync()}>
              {t("schedules.btn_seed_defaults")}
            </Button>
          )}
        </div>
      )}

      <div className="w-full overflow-x-auto rounded-2xl border border-default-200/80 bg-content1 shadow-sm">
        <Table aria-label="Schedule templates" className="min-w-[760px]" removeWrapper>
          <TableHeader>
            {[
              t("schedules.col_name"),
              t("schedules.col_mode"),
              t("schedules.col_hours"),
              t("schedules.col_days"),
              t("schedules.col_grace"),
              t("schedules.col_version"),
              t("schedules.col_status"),
              t("schedules.col_actions"),
            ].map((label, i) => (
              <TableColumn key={`c${i}`} className="bg-default-50 text-default-500 font-bold text-xs py-4">
                {label}
              </TableColumn>
            ))}
          </TableHeader>
          <TableBody items={rows} emptyContent={t("schedules.empty_templates")}>
            {(tpl) => (
              <TableRow key={tpl.id} className="border-b border-default-50 last:border-0 hover:bg-default-50/50">
                <TableCell className="py-4 font-bold text-sm">{tpl.name}</TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat">{t(`schedules.mode_${tpl.mode}`)}</Chip>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{tpl.startTime} – {tpl.endTime}</TableCell>
                <TableCell className="text-xs text-default-500">
                  {tpl.workingDays.map((d) => t(`common.weekday_${WEEKDAY_SHORT_KEYS[d]}`)).join(" ")}
                </TableCell>
                <TableCell className="text-sm">{tpl.graceMinutes} {t("common.minutes_short")}</TableCell>
                <TableCell className="text-sm">v{tpl.version}</TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={tpl.isActive ? "success" : "default"}>
                    {tpl.isActive ? t("common.active") : t("common.inactive")}
                  </Chip>
                </TableCell>
                <TableCell>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="flat" startContent={<Pencil size={14} />} onPress={() => setEditing(tpl)}>
                        {t("common.edit")}
                      </Button>
                      {tpl.isActive ? (
                        <Button size="sm" variant="flat" color="danger" onPress={() => setDeactivating(tpl)}>
                          {t("schedules.btn_deactivate")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="flat"
                          color="success"
                          isLoading={setActive.isPending}
                          onPress={() => setActive.mutate({ templateId: tpl.id, isActive: true, reason: t("schedules.reactivate_reason") })}
                        >
                          {t("schedules.btn_reactivate")}
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editing && <TemplateEditorModal template={editing} onClose={() => setEditing(null)} />}
      <ReasonModal
        isOpen={!!deactivating}
        title={t("schedules.deactivate_template_title")}
        onOpenChange={(o) => !o && setDeactivating(null)}
        confirmColor="danger"
        confirmLabel={t("schedules.btn_deactivate")}
        onConfirm={(reason) => setActive.mutateAsync({ templateId: deactivating!.id, isActive: false, reason })}
      />
    </div>
  );
}

function TemplateEditorModal({ template, onClose }: { template: ScheduleTemplate | "new"; onClose: () => void }) {
  const { t } = useTranslation("people");
  const isNew = template === "new";
  const create = useCreateTemplateMutation();
  const update = useUpdateTemplateMutation();

  const [name, setName] = useState(isNew ? "" : template.name);
  const [description, setDescription] = useState(isNew ? "" : template.description ?? "");
  const [mode, setMode] = useState<WorkMode>(isNew ? "custom" : template.mode);
  const [values, setValues] = useState<ScheduleValues>(
    isNew ? { ...OFFICE_SCHEDULE_DEFAULTS } : valuesOfTemplate(template)
  );
  const [effectiveFrom, setEffectiveFrom] = useState(isNew ? "" : template.effectiveFrom ?? "");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const save = async () => {
    const errors = validateScheduleValues(values);
    if (errors.length > 0 || name.trim().length < 2 || (!isNew && reason.trim().length === 0)) {
      setFieldErrors([
        ...errors.map((e) => t(e.messageKey)),
        ...(name.trim().length < 2 ? [t("schedules.validation.name")] : []),
        ...(!isNew && reason.trim().length === 0 ? [t("schedules.validation.reasonRequired")] : []),
      ]);
      return;
    }
    if (isNew) {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        mode,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: null,
        isActive: true,
        createdBy: "",
        updatedBy: undefined,
        ...values,
      });
    } else {
      await update.mutateAsync({
        templateId: template.id,
        patch: { name: name.trim(), description: description.trim() || null, ...values },
        reason: reason.trim(),
      });
    }
    onClose();
  };

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="font-black">{isNew ? t("schedules.new_template_title") : t("schedules.edit_template_title")}</ModalHeader>
            <ModalBody className="space-y-4">
              {!isNew && (
                <p className="text-xs text-warning-600 font-semibold bg-warning-50 border border-warning-200 rounded-xl px-3 py-2">
                  {t("schedules.edit_template_history_note")}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("schedules.col_name")} value={name} onValueChange={setName} />
                <Select
                  {...selectFieldProps()}
                  label={t("schedules.col_mode")}
                  selectedKeys={[mode]}
                  onSelectionChange={(k) => setMode(String(k) as WorkMode)}
                >
                  {(["office", "online", "custom"] as WorkMode[]).map((m) => (
                    <SelectItem key={m}>{t(`schedules.mode_${m}`)}</SelectItem>
                  ))}
                </Select>
              </div>
              <Input label={t("schedules.col_description")} value={description} onValueChange={setDescription} />
              <ScheduleValuesFields value={values} onChange={setValues} />
              <NativeDateInput label={t("schedules.field_effective_from")} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              {!isNew && (
                <Textarea
                  label={t("schedules.field_reason")}
                  placeholder={t("schedules.reason_placeholder")}
                  value={reason}
                  onValueChange={setReason}
                />
              )}
              {fieldErrors.length > 0 && (
                <div className="text-xs text-danger font-semibold space-y-1">
                  {fieldErrors.map((e) => (
                    <p key={e}>• {e}</p>
                  ))}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onCloseFn}>{t("common.cancel")}</Button>
              <Button color="primary" onPress={save} isLoading={create.isPending || update.isPending}>
                {t("common.save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function valuesOfTemplate(tpl: ScheduleTemplate): ScheduleValues {
  return {
    startTime: tpl.startTime,
    endTime: tpl.endTime,
    workingDays: tpl.workingDays,
    breakMinutes: tpl.breakMinutes,
    breakCountsAsWork: tpl.breakCountsAsWork,
    graceMinutes: tpl.graceMinutes,
    requiredDailyMinutes: tpl.requiredDailyMinutes,
    flexibleStartWindow: tpl.flexibleStartWindow,
    timezone: tpl.timezone,
    overtime: tpl.overtime,
  };
}

/* -------------------------------------------------------------------------- */
/* Assignments                                                                 */
/* -------------------------------------------------------------------------- */

function AssignmentsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation("people");
  const { data: assignments, isLoading } = useScheduleAssignmentsQuery();
  const { data: employees } = useEmployeesQuery();
  const { data: templates } = useScheduleTemplatesQuery();
  const deactivate = useDeactivateAssignmentMutation();
  const [creating, setCreating] = useState(false);
  const [deactivatingRow, setDeactivatingRow] = useState<ScheduleAssignment | null>(null);

  const employeeName = useMemo(() => {
    const map = new Map((employees?.data ?? []).map((e) => [e.id, [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name || e.id]));
    return (id?: string | null) => (id ? map.get(id) ?? id : null);
  }, [employees]);

  if (isLoading) return <Spinner className="m-8" />;
  const rows = assignments ?? [];

  return (
    <div className="space-y-4 pt-4">
      {canManage && (
        <Button color="primary" startContent={<Plus size={16} />} onPress={() => setCreating(true)}>
          {t("schedules.btn_new_assignment")}
        </Button>
      )}

      <div className="w-full overflow-x-auto rounded-2xl border border-default-200/80 bg-content1 shadow-sm">
        <Table aria-label="Schedule assignments" className="min-w-[820px]" removeWrapper>
          <TableHeader>
            {[
              t("schedules.col_scope"),
              t("schedules.col_template"),
              t("schedules.col_hours"),
              t("schedules.col_effective"),
              t("schedules.col_overrides"),
              t("schedules.col_status"),
              t("schedules.col_actions"),
            ].map((label, i) => (
              <TableColumn key={`c${i}`} className="bg-default-50 text-default-500 font-bold text-xs py-4">
                {label}
              </TableColumn>
            ))}
          </TableHeader>
          <TableBody items={rows} emptyContent={t("schedules.empty_assignments")}>
            {(a) => (
              <TableRow key={a.id} className="border-b border-default-50 last:border-0 hover:bg-default-50/50">
                <TableCell className="py-4 text-sm font-bold">
                  {a.scope === "employee" ? employeeName(a.employeeId) : `${t("schedules.scope_group")}: ${a.department}`}
                </TableCell>
                <TableCell className="text-sm">{templates?.find((tp: ScheduleTemplate) => tp.id === a.templateId)?.name ?? a.templateId} v{a.templateVersion}</TableCell>
                <TableCell className="text-sm tabular-nums">{a.snapshot.startTime} – {a.snapshot.endTime}</TableCell>
                <TableCell className="text-xs tabular-nums text-default-500">
                  {a.effectiveFrom} → {a.effectiveTo ?? t("schedules.open_end")}
                </TableCell>
                <TableCell className="text-xs text-default-500">
                  {a.overrides ? Object.keys(a.overrides).join(", ") : "—"}
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={a.status === "active" ? "success" : "default"}>
                    {a.status === "active" ? t("common.active") : t("common.inactive")}
                  </Chip>
                </TableCell>
                <TableCell>
                  {canManage && a.status === "active" && (
                    <Button size="sm" variant="flat" color="danger" onPress={() => setDeactivatingRow(a)}>
                      {t("schedules.btn_deactivate")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-default-400 font-medium">{t("schedules.unassigned_note")}</p>

      {creating && <AssignmentCreateModal onClose={() => setCreating(false)} />}
      <ReasonModal
        isOpen={!!deactivatingRow}
        title={t("schedules.deactivate_assignment_title")}
        onOpenChange={(o) => !o && setDeactivatingRow(null)}
        confirmColor="danger"
        confirmLabel={t("schedules.btn_deactivate")}
        onConfirm={(reason) => deactivate.mutateAsync({ assignmentId: deactivatingRow!.id, reason })}
      />
    </div>
  );
}

function AssignmentCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("people");
  const { data: templates } = useScheduleTemplatesQuery();
  const { data: employees } = useEmployeesQuery();
  const create = useCreateAssignmentMutation();

  const [scope, setScope] = useState<"employee" | "group">("employee");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [department, setDepartment] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [effectiveFrom, setEffectiveFrom] = useState<string>("");
  const [effectiveTo, setEffectiveTo] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [errors, setErrors] = useState<string[]>([]);

  const departments = useMemo(() => {
    const set = new Set((employees?.data ?? []).map((e) => e.department).filter(Boolean) as string[]);
    return [...set].sort();
  }, [employees]);

  const save = async () => {
    const errs: string[] = [];
    if (!templateId) errs.push(t("schedules.validation.templateRequired"));
    if (!effectiveFrom) errs.push(t("schedules.validation.effectiveFromRequired"));
    if (scope === "employee" && !employeeId) errs.push(t("policy.validation.employeeRequired"));
    if (scope === "group" && !department) errs.push(t("policy.validation.departmentRequired"));
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    await create.mutateAsync({
      scope,
      employeeId: scope === "employee" ? employeeId : null,
      department: scope === "group" ? department : null,
      templateId,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      reason: reason || null,
    });
    onClose();
  };

  const activeTemplates = (templates ?? []).filter((tp: ScheduleTemplate) => tp.isActive);

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="lg" scrollBehavior="inside">
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="font-black">{t("schedules.new_assignment_title")}</ModalHeader>
            <ModalBody className="space-y-4">
              <Select
                {...selectFieldProps()}
                label={t("schedules.col_scope")}
                selectedKeys={[scope]}
                onSelectionChange={(k) => setScope(String(k) as "employee" | "group")}
              >
                <SelectItem key="employee">{t("schedules.scope_employee")}</SelectItem>
                <SelectItem key="group">{t("schedules.scope_group")}</SelectItem>
              </Select>

              {scope === "employee" ? (
                <Select
                  {...selectFieldProps()}
                  label={t("schedules.col_employee")}
                  placeholder={t("schedules.select_employee")}
                  selectedKeys={employeeId ? [employeeId] : []}
                  onSelectionChange={(k) => setEmployeeId(String(k))}
                >
                  {(employees?.data ?? [])
                    .filter((e) => e.status === "active")
                    .map((e) => (
                      <SelectItem key={e.id} textValue={[e.firstName, e.lastName].join(" ")}>
                        {[e.firstName, e.lastName].filter(Boolean).join(" ") || e.id}
                      </SelectItem>
                    ))}
                </Select>
              ) : (
                <Select
                  {...selectFieldProps()}
                  label={t("schedules.col_department")}
                  placeholder={t("schedules.select_department")}
                  selectedKeys={department ? [department] : []}
                  onSelectionChange={(k) => setDepartment(String(k))}
                >
                  {departments.map((d) => (
                    <SelectItem key={d}>{d}</SelectItem>
                  ))}
                </Select>
              )}

              <Select
                {...selectFieldProps()}
                label={t("schedules.col_template")}
                placeholder={t("schedules.select_template")}
                selectedKeys={templateId ? [templateId] : []}
                onSelectionChange={(k) => setTemplateId(String(k))}
              >
                {activeTemplates.map((tp) => (
                  <SelectItem key={tp.id} textValue={tp.name}>
                    {tp.name} ({tp.startTime}–{tp.endTime})
                  </SelectItem>
                ))}
              </Select>

              <div className="grid grid-cols-2 gap-4">
                <NativeDateInput label={t("schedules.field_effective_from")} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                <NativeDateInput label={t("schedules.field_effective_to")} value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
              </div>
              <Input label={t("schedules.field_reason")} value={reason} onValueChange={setReason} />

              {errors.length > 0 && (
                <div className="text-xs text-danger font-semibold space-y-1">
                  {errors.map((e) => (
                    <p key={e}>• {e}</p>
                  ))}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onCloseFn}>{t("common.cancel")}</Button>
              <Button color="primary" onPress={save} isLoading={create.isPending}>{t("common.save")}</Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
