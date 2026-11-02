/**
 * Lateness & deduction policy screen — thresholds are CONFIGURATION, never
 * hardcoded law: the "24 accumulated hours ≈ 3 days" example from the spec is
 * offered as a pre-fill the admin can edit, and "three days" refuses to save
 * without an explicit wage basis (the service validates this too — the UI is
 * not the only guard).
 */
import { useState } from "react";
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
} from "@heroui/react";
import { Copy, Gauge, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { NativeDateInput } from "@/components/shared/native-date-input";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import {
  useCreatePolicyMutation,
  useDeletePolicyMutation,
  useLatenessPoliciesQuery,
  useSetPolicyActiveMutation,
  useUpdatePolicyMutation,
} from "../hooks/use-work-schedule";
import { validatePolicyDraft } from "../lib/work-schedule-rules";
import type {
  CreateLatenessPolicyDTO,
  DayWageBasis,
  LatenessPolicy,
  LatenessThreshold,
  ThresholdActionKind,
  ThresholdMode,
} from "../types/work-schedule.types";

function emptyDraft(): CreateLatenessPolicyDTO {
  return {
    name: "",
    description: null,
    appliesTo: {},
    period: "calendar_month",
    thresholds: [{ id: "t1", afterMinutes: 480, action: { kind: "warning" }, automatic: true }],
    thresholdMode: "cumulative",
    workingDaysPerMonth: 26,
    hoursPerDeductionDay: null,
    maxMonthlyDeductionAmount: 0,
    maxMonthlyDeductionGrossFraction: 0,
    legalBasis: null,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    createdBy: "",
  };
}

/** The approved example — as an EDITABLE DRAFT, seeded only on explicit click. */
function exampleDraft(): CreateLatenessPolicyDTO {
  const d = emptyDraft();
  return {
    ...d,
    name: "24h → 3 days (approved 8h rule)",
    description: "Experimental internal policy — requires legal review before posting.",
    // The approved conversion drives the days from the canonical accumulation;
    // t2 fires at 24 accumulated late hours → 24h / 8h = 3 deduction days.
    hoursPerDeductionDay: 8,
    thresholds: [
      { id: "t1", afterMinutes: 480, action: { kind: "warning" }, automatic: true },
      {
        id: "t2",
        afterMinutes: 1440,
        action: { kind: "propose_deduction", deductionDays: null, basis: "calendar_30" },
        automatic: false,
      },
    ],
  };
}

export default function LatenessPoliciesPage() {
  const { t } = useTranslation("people");
  const { can } = useAppPermissions();
  const canManage = can("people.manage_lateness_policies");
  const { data: policies, isLoading } = useLatenessPoliciesQuery();
  const setActive = useSetPolicyActiveMutation();
  const del = useDeletePolicyMutation();
  const [editing, setEditing] = useState<LatenessPolicy | CreateLatenessPolicyDTO | null>(null);

  if (isLoading) return <Spinner className="m-8" />;
  const rows = policies ?? [];

  return (
    <div className="w-full min-w-0 space-y-6 pb-12 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl border border-primary/20 shadow-sm">
          <Gauge size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-black tracking-tight text-foreground">{t("policy.title")}</h1>
          <p className="text-xs text-default-500 font-medium mt-0.5">{t("policy.subtitle")}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="bordered" startContent={<Copy size={16} />} onPress={() => setEditing(exampleDraft())}>
              {t("policy.btn_example")}
            </Button>
            <Button color="primary" startContent={<Plus size={16} />} onPress={() => setEditing(emptyDraft())}>
              {t("policy.btn_new")}
            </Button>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="text-xs text-default-500 bg-default-100 rounded-xl px-3 py-2">{t("policy.readonly_note")}</p>
      )}

      <div className="w-full overflow-x-auto rounded-2xl border border-default-200/80 bg-content1 shadow-sm">
        <Table aria-label="Lateness policies" className="min-w-[820px]" removeWrapper>
          <TableHeader>
            {[
              t("policy.col_name"),
              t("policy.col_mode"),
              t("policy.col_thresholds"),
              t("policy.col_caps"),
              t("policy.col_legal_basis"),
              t("policy.col_effective"),
              t("policy.col_status"),
              t("schedules.col_actions"),
            ].map((label, i) => (
              <TableColumn key={`c${i}`} className="bg-default-50 text-default-500 font-bold text-xs py-4">
                {label}
              </TableColumn>
            ))}
          </TableHeader>
          <TableBody items={rows} emptyContent={t("policy.empty")}>
            {(p) => (
              <TableRow key={p.id} className="border-b border-default-50 last:border-0 hover:bg-default-50/50">
                <TableCell className="py-4 font-bold text-sm">
                  {p.name} <span className="text-default-400 font-semibold">v{p.version}</span>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat">{t(`policy.mode_${p.thresholdMode}`)}</Chip>
                </TableCell>
                <TableCell className="text-xs tabular-nums text-default-500">
                  {p.thresholds.map((th) => `${Math.round(th.afterMinutes / 60)}h ${t(`policy.action_${th.action.kind}`)}`).join(" · ")}
                  {p.hoursPerDeductionDay != null && p.hoursPerDeductionDay > 0 && (
                    <div className="mt-0.5 text-primary font-semibold">
                      {t("policy.conversion_suffix", { hours: p.hoursPerDeductionDay })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {p.maxMonthlyDeductionAmount > 0 ? `${p.maxMonthlyDeductionAmount}/mo` : "—"}
                  {p.maxMonthlyDeductionGrossFraction > 0 && ` · ${(p.maxMonthlyDeductionGrossFraction * 100).toFixed(0)}%`}
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={p.legalBasis ? "success" : "warning"}>
                    {p.legalBasis ? t("policy.legal_present") : t("policy.legal_missing")}
                  </Chip>
                </TableCell>
                <TableCell className="text-xs tabular-nums text-default-500">{p.effectiveFrom}</TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color={p.isActive ? "success" : "default"}>
                    {p.isActive ? t("common.active") : t("common.inactive")}
                  </Chip>
                </TableCell>
                <TableCell>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="flat" startContent={<Pencil size={14} />} onPress={() => setEditing(p)}>
                        {t("common.edit")}
                      </Button>
                      <Button size="sm" variant="flat" onPress={() => setActive.mutate({ policyId: p.id, isActive: !p.isActive })}>
                        {p.isActive ? t("policy.btn_deactivate") : t("policy.btn_activate")}
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        isDisabled={rows.length <= 1}
                        onPress={() => del.mutate(p.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-default-400 font-medium">{t("policy.no_automatic_note")}</p>

      {editing && <PolicyEditorModal draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PolicyEditorModal({ draft, onClose }: { draft: LatenessPolicy | CreateLatenessPolicyDTO; onClose: () => void }) {
  const { t } = useTranslation("people");
  const isEdit = "id" in draft;
  const create = useCreatePolicyMutation();
  const update = useUpdatePolicyMutation();
  const [form, setForm] = useState<CreateLatenessPolicyDTO>({ ...draft });
  const [errors, setErrors] = useState<string[]>([]);

  const setThreshold = (idx: number, next: LatenessThreshold) => {
    const thresholds = form.thresholds.map((x, i) => (i === idx ? next : x));
    setForm({ ...form, thresholds });
  };

  const save = async () => {
    const validation = validatePolicyDraft(form);
    if (validation.length > 0) {
      setErrors(validation.map((e) => t(e.messageKey)));
      return;
    }
    if (isEdit) {
      const { createdBy: _c, ...patch } = form;
      await update.mutateAsync({ policyId: draft.id, patch });
    } else {
      await create.mutateAsync(form);
    }
    onClose();
  };

  return (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="font-black">{isEdit ? t("policy.edit_title") : t("policy.new_title")}</ModalHeader>
            <ModalBody className="space-y-4">
              {isEdit && (
                <p className="text-xs text-warning-600 font-semibold bg-warning-50 border border-warning-200 rounded-xl px-3 py-2">
                  {t("policy.edit_history_note")}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("policy.col_name")} value={form.name} onValueChange={(v) => setForm({ ...form, name: v })} />
                <NativeDateInput
                  label={t("policy.col_effective")}
                  value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                />
              </div>
              <Input label={t("policy.col_description")} value={form.description ?? ""} onValueChange={(v) => setForm({ ...form, description: v || null })} />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("policy.field_threshold_mode")}
                  selectedKeys={[form.thresholdMode]}
                  onSelectionChange={(k) => setForm({ ...form, thresholdMode: String(k) as ThresholdMode })}
                >
                  {(["cumulative", "stepped", "reset_after_action"] as ThresholdMode[]).map((m) => (
                    <SelectItem key={m}>{t(`policy.mode_${m}`)}</SelectItem>
                  ))}
                </Select>
                <Input
                  type="number"
                  label={t("policy.field_working_days_per_month")}
                  value={String(form.workingDaysPerMonth)}
                  onValueChange={(v) => setForm({ ...form, workingDaysPerMonth: Number(v) || 0 })}
                />
                <Input
                  type="number"
                  label={t("policy.field_cap_amount")}
                  value={String(form.maxMonthlyDeductionAmount)}
                  onValueChange={(v) => setForm({ ...form, maxMonthlyDeductionAmount: Number(v) || 0 })}
                />
              </div>
              <Input
                type="number"
                step="0.05"
                label={t("policy.field_cap_fraction")}
                value={String(form.maxMonthlyDeductionGrossFraction)}
                onValueChange={(v) => setForm({ ...form, maxMonthlyDeductionGrossFraction: Number(v) || 0 })}
                className="max-w-[320px]"
              />
              <div className="max-w-[420px]">
                <Input
                  type="number"
                  label={t("policy.field_hours_per_deduction_day")}
                  value={form.hoursPerDeductionDay == null ? "" : String(form.hoursPerDeductionDay)}
                  onValueChange={(v) => setForm({ ...form, hoursPerDeductionDay: v === "" ? null : Number(v) || 0 })}
                />
                <p className="text-[11px] text-default-400 font-medium mt-1">{t("policy.conversion_note")}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-default-500">{t("policy.field_thresholds")}</p>
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Plus size={14} />}
                    onPress={() =>
                      setForm({
                        ...form,
                        thresholds: [
                          ...form.thresholds,
                          {
                            id: `t${form.thresholds.length + 1}`,
                            afterMinutes: 60,
                            action: { kind: "warning" },
                            automatic: true,
                          },
                        ],
                      })
                    }
                  >
                    {t("policy.btn_add_threshold")}
                  </Button>
                </div>
                <div className="space-y-2">
                  {form.thresholds.map((th, idx) => (
                    <ThresholdRow
                      key={`${th.id}-${idx}`}
                      threshold={th}
                      onChange={(next) => setThreshold(idx, next)}
                      onRemove={
                        form.thresholds.length > 1
                          ? () => setForm({ ...form, thresholds: form.thresholds.filter((_, i) => i !== idx) })
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>

              <Textarea
                label={t("policy.field_legal_basis")}
                placeholder={t("policy.field_legal_basis_hint")}
                value={form.legalBasis ?? ""}
                onValueChange={(v) => setForm({ ...form, legalBasis: v.trim() ? v : null })}
              />
              {!form.legalBasis && (
                <p className="text-xs text-warning-600 font-semibold">{t("policy.legal_missing_warning")}</p>
              )}

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

function ThresholdRow({
  threshold,
  onChange,
  onRemove,
}: {
  threshold: LatenessThreshold;
  onChange: (t: LatenessThreshold) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation("people");
  const a = threshold.action;
  return (
    <div className="flex flex-wrap items-end gap-2 border border-default-100 rounded-2xl px-3 py-2 bg-default-50/50">
      <Input
        size="sm"
        label={t("policy.th_id")}
        value={threshold.id}
        onValueChange={(v) => onChange({ ...threshold, id: v })}
        className="w-20"
      />
      <Input
        size="sm"
        type="number"
        label={`${t("policy.th_after_minutes")} (${Math.round(threshold.afterMinutes / 60)}h)`}
        value={String(threshold.afterMinutes)}
        onValueChange={(v) => onChange({ ...threshold, afterMinutes: Number(v) || 0 })}
        className="w-36"
      />
      <Select
        {...selectFieldProps()}
        size="sm"
        label={t("policy.th_kind")}
        selectedKeys={[a.kind]}
        onSelectionChange={(k) => {
          const kind = String(k) as ThresholdActionKind;
          onChange({
            ...threshold,
            action:
              kind === "propose_deduction"
                ? { kind, deductionDays: a.deductionDays ?? null, basis: a.basis ?? null, fraction: a.fraction ?? null }
                : { kind },
          });
        }}
        className="w-40"
      >
        {(["warning", "review", "propose_deduction"] as ThresholdActionKind[]).map((k) => (
          <SelectItem key={k}>{t(`policy.action_${k}`)}</SelectItem>
        ))}
      </Select>

      {a.kind === "propose_deduction" && (
        <>
          <Input
            size="sm"
            type="number"
            label={t("policy.th_days")}
            value={a.deductionDays == null ? "" : String(a.deductionDays)}
            onValueChange={(v) => onChange({ ...threshold, action: { ...a, deductionDays: v === "" ? null : Number(v) } })}
            className="w-24"
          />
          <Select
            {...selectFieldProps()}
            size="sm"
            label={t("policy.th_basis")}
            selectedKeys={a.basis ? [a.basis] : ["none"]}
            onSelectionChange={(k) => {
              const sel = String(k);
              onChange({ ...threshold, action: { ...a, basis: sel === "none" ? null : (sel as DayWageBasis) } });
            }}
            className="w-40"
          >
            {([null, "calendar_30", "working_days", "salary_fraction"] as (DayWageBasis | null)[]).map((b) => (
              <SelectItem key={b ?? "none"}>{b ? t(`policy.basis_${b}`) : "—"}</SelectItem>
            ))}
          </Select>
          {a.basis === "salary_fraction" && (
            <Input
              size="sm"
              type="number"
              step="0.05"
              label={t("policy.th_fraction")}
              value={a.fraction == null ? "" : String(a.fraction)}
              onValueChange={(v) => onChange({ ...threshold, action: { ...a, fraction: v === "" ? null : Number(v) } })}
              className="w-28"
            />
          )}
        </>
      )}

      <Switch isSelected={threshold.automatic} onValueChange={(v: boolean) => onChange({ ...threshold, automatic: v })}>
        <span className="text-xs font-semibold">{t("policy.th_automatic")}</span>
      </Switch>

      {onRemove && (
        <Button size="sm" variant="light" color="danger" onPress={onRemove} isIconOnly>
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  );
}
