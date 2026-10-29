/**
 * Deduction cases review screen — the mandated approval chain made visible:
 * evaluation only PROPOSES (pending_review / proposed); nothing touches the
 * salary until an authorized decider approves, and only the post permission
 * pushes ONE balanced journal through BillingService. Employees see only
 * their OWN cases (readable by design — people may inspect what judges them).
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
import { Calculator, ClipboardCheck, FileClock, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAuthStore } from "@/stores/auth.store";
import { useEmployeesQuery } from "../hooks/use-people";
import {
  useDecideCaseMutation,
  useDeductionCasesQuery,
  useEvaluateMonthMutation,
  useMyDeductionCasesQuery,
  usePostCaseMutation,
  useReverseCaseMutation,
} from "../hooks/use-work-schedule";
import { formatDurationHM } from "../lib/work-schedule-rules";
import type { DeductionCase, DeductionCaseStatus } from "../types/work-schedule.types";

const STATUS_COLORS: Record<DeductionCaseStatus, "default" | "warning" | "primary" | "success" | "danger"> = {
  pending_review: "warning",
  proposed: "warning",
  approved: "primary",
  posted: "success",
  rejected: "danger",
  reversed: "default",
};

export default function DeductionCasesPage() {
  const { t } = useTranslation("people");
  const { can } = useAppPermissions();
  const { user } = useAuthStore();
  const canViewAll = can("people.view_lateness");
  const { data: employees } = useEmployeesQuery();

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    (employees?.data ?? []).forEach((e: any) =>
      map.set(e.id, [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name || e.id)
    );
    return map;
  }, [employees]);

  // Own employee record for the self view (claimed account or e-mail match).
  const myEmployee = useMemo(
    () =>
      (employees?.data ?? []).find(
        (e) => (e as any).userId === user?.id || (!!e.email && e.email === user?.email)
      ) ?? null,
    [employees, user]
  );

  const privileged = useDeductionCasesQuery(canViewAll);
  const mine = useMyDeductionCasesQuery(!canViewAll && myEmployee ? myEmployee.id : null);

  const [filter, setFilter] = useState<string>("all");
  const [deciding, setDeciding] = useState<{ kase: DeductionCase; decision: "approved" | "rejected" } | null>(null);
  const [reversing, setReversing] = useState<DeductionCase | null>(null);

  const canDecide = can("people.decide_deductions");
  const canPost = can("people.post_deductions");
  const canReverse = can("people.reverse_deductions");

  const cases = useMemo(() => {
    const src = canViewAll ? (privileged.data ?? []) : (mine.data ?? []);
    return [...src]
      .filter((c) => filter === "all" || c.status === filter)
      .sort((a, b) => b.periodKey.localeCompare(a.periodKey) || b.updatedAt.localeCompare(a.updatedAt));
  }, [canViewAll, privileged.data, mine.data, filter]);

  if ((canViewAll && privileged.isLoading) || (!canViewAll && myEmployee && mine.isLoading)) {
    return <Spinner className="m-8" />;
  }

  return (
    <div className="w-full min-w-0 space-y-6 pb-12 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 sm:items-center">
        <div className="p-3 bg-primary/10 text-primary rounded-2xl border border-primary/20 shadow-sm">
          <FileClock size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-foreground">{t("cases.title")}</h1>
          <p className="text-xs text-default-500 font-medium mt-0.5">
            {canViewAll ? t("cases.subtitle") : t("cases.subtitle_mine")}
          </p>
        </div>
      </div>

      {canViewAll && <EvaluatePanel />}

      <Tabs
        selectedKey={filter}
        onSelectionChange={(key: any) => setFilter(String(key))}
        size="sm"
        variant="underlined"
        color="primary"
      >
        {["all", "pending_review", "proposed", "approved", "posted", "rejected", "reversed"].map((s) => (
          <Tab key={s} title={t(`cases.status_${s}`)} />
        ))}
      </Tabs>

      <div className="w-full overflow-x-auto rounded-2xl border border-default-200/80 bg-content1 shadow-sm">
        <Table aria-label="Deduction cases" className="min-w-[900px]" removeWrapper>
          <TableHeader>
            {[
              t("cases.col_employee"),
              t("cases.col_period"),
              t("cases.col_accumulated"),
              t("cases.col_action"),
              t("cases.col_amount"),
              t("cases.col_status"),
              t("cases.col_journal"),
              t("cases.col_actions"),
            ].map((label, i) => (
              <TableColumn key={`c${i}`} className="bg-default-50 text-default-500 font-bold text-xs py-4">
                {label}
              </TableColumn>
            ))}
          </TableHeader>
          <TableBody items={cases} emptyContent={t("cases.empty")}>
            {(c) => {
              const empName = employeeNameById.get(c.employeeId) ?? c.employeeId;
              return (
                <TableRow key={c.id} className="border-b border-default-50 last:border-0 hover:bg-default-50/50">
                  <TableCell className="py-4 font-bold text-sm">
                    {empName}
                    {!c.policySnapshot.legalBasisPresent && c.kind === "propose_deduction" && (
                      <Chip size="sm" variant="flat" color="warning" className="ms-2">
                        {t("cases.chip_no_legal_basis")}
                      </Chip>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{c.periodKey}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDurationHM(c.accumulatedMinutes)}</TableCell>
                  <TableCell className="text-xs">
                    {t(`policy.action_${c.kind}`)}
                    {c.deductionDays != null && ` · ${c.deductionDays} × ${c.policySnapshot.action.basis === "calendar_30" ? t("policy.basis_calendar_30") : t("policy.basis_working_days")}`}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums font-bold">
                    {c.amount != null && c.amount > 0 ? `${c.amount} ${c.currency ?? ""}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={STATUS_COLORS[c.status]}>
                      {t(`cases.status_${c.status}`)}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums text-default-500">{c.journalId ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-2 flex-wrap">
                      {canDecide && (c.status === "pending_review" || c.status === "proposed") && (
                        <>
                          <Button size="sm" variant="flat" color="success" startContent={<ClipboardCheck size={14} />} onPress={() => setDeciding({ kase: c, decision: "approved" })}>
                            {t("cases.btn_approve")}
                          </Button>
                          <Button size="sm" variant="flat" color="danger" onPress={() => setDeciding({ kase: c, decision: "rejected" })}>
                            {t("cases.btn_reject")}
                          </Button>
                        </>
                      )}
                      {canPost && c.status === "approved" && c.kind === "propose_deduction" && c.amount != null && c.amount > 0 && (
                        <PostButton kase={c} />
                      )}
                      {canReverse && c.status === "posted" && (
                        <Button size="sm" variant="flat" color="warning" startContent={<Undo2 size={14} />} onPress={() => setReversing(c)}>
                          {t("cases.btn_reverse")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            }}
          </TableBody>
        </Table>
      </div>

      <DecideModal target={deciding} onClose={() => setDeciding(null)} />
      <ReverseModal target={reversing} onClose={() => setReversing(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EvaluatePanel() {
  const { t } = useTranslation("people");
  const { can } = useAppPermissions();
  const { data: employees } = useEmployeesQuery();
  const evaluate = useEvaluateMonthMutation();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [periodKey, setPeriodKey] = useState<string>(new Date().toISOString().slice(0, 7));

  if (!can("people.evaluate_lateness")) return null;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-default-200/80 bg-content1 p-4">
      <p className="w-full text-xs font-bold text-default-500 flex items-center gap-2">
        <Calculator size={14} /> {t("cases.evaluate_title")}
      </p>
      <Select
        {...selectFieldProps()}
        size="sm"
        label={t("cases.col_employee")}
        placeholder={t("schedules.select_employee")}
        selectedKeys={employeeId ? [employeeId] : []}
        onSelectionChange={(k) => setEmployeeId(String(k))}
        className="min-w-[220px]"
      >
        {(employees?.data ?? [])
          .filter((e) => e.status === "active")
          .map((e) => (
            <SelectItem key={e.id} textValue={[e.firstName, e.lastName].join(" ")}>
              {[e.firstName, e.lastName].filter(Boolean).join(" ") || e.id}
            </SelectItem>
          ))}
      </Select>
      <Input
        size="sm"
        label={t("cases.col_period")}
        type="month"
        value={periodKey}
        onValueChange={setPeriodKey}
        className="w-44"
      />
      <Button
        size="sm"
        color="primary"
        isDisabled={!employeeId}
        isLoading={evaluate.isPending}
        onPress={() => evaluate.mutateAsync({ employeeId, periodKey })}
      >
        {t("cases.btn_evaluate")}
      </Button>
      <p className="text-xs text-default-400 w-full">{t("cases.evaluate_note")}</p>
    </div>
  );
}

function PostButton({ kase }: { kase: DeductionCase }) {
  const { t } = useTranslation("people");
  const post = usePostCaseMutation();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button size="sm" variant="flat" color="primary" onPress={() => setConfirming(true)}>
        {t("cases.btn_post")}
      </Button>
      <Modal isOpen={confirming} onOpenChange={setConfirming} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="font-black">{t("cases.post_confirm_title")}</ModalHeader>
              <ModalBody>
                <p className="text-sm">{t("cases.post_confirm_body")}</p>
                <p className="text-xs tabular-nums text-default-500 mt-2">
                  {t("cases.impact")}: −{kase.amount} {kase.currency ?? ""} · {t("policy.col_thresholds")} {formatDurationHM(kase.policySnapshot.thresholdMinutes)} → {kase.deductionDays} {t("common.days")}
                  {kase.dailyRate != null && ` × ${kase.dailyRate}`}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>{t("common.cancel")}</Button>
                <Button
                  color="primary"
                  isLoading={post.isPending}
                  onPress={async () => {
                    await post.mutateAsync(kase.id);
                    onClose();
                  }}
                >
                  {t("cases.btn_post_confirm")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

function DecideModal({
  target,
  onClose,
}: {
  target: { kase: DeductionCase; decision: "approved" | "rejected" } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("people");
  const decide = useDecideCaseMutation();
  const [note, setNote] = useState("");
  return (
    <Modal isOpen={!!target} onOpenChange={(o) => !o && onClose()} size="md" scrollBehavior="inside">
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="font-black">
              {target?.decision === "approved" ? t("cases.approve_title") : t("cases.reject_title")}
            </ModalHeader>
            <ModalBody>
              <Textarea
                label={t("cases.decision_note")}
                placeholder={t("cases.decision_note_hint")}
                value={note}
                onValueChange={setNote}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onCloseFn}>{t("common.cancel")}</Button>
              <Button
                color={target?.decision === "approved" ? "success" : "danger"}
                isDisabled={!note.trim()}
                isLoading={decide.isPending}
                onPress={async () => {
                  if (!target) return;
                  await decide.mutateAsync({ caseId: target.kase.id, decision: target.decision, note: note.trim() });
                  setNote("");
                  onClose();
                }}
              >
                {t("common.confirm")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function ReverseModal({ target, onClose }: { target: DeductionCase | null; onClose: () => void }) {
  const { t } = useTranslation("people");
  const reverse = useReverseCaseMutation();
  const [note, setNote] = useState("");
  return (
    <Modal isOpen={!!target} onOpenChange={(o) => !o && onClose()} size="md" scrollBehavior="inside">
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="font-black">{t("cases.reverse_title")}</ModalHeader>
            <ModalBody>
              <p className="text-xs text-default-500 mb-2">{t("cases.reverse_note_safety")}</p>
              <Textarea label={t("cases.decision_note")} value={note} onValueChange={setNote} />
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onCloseFn}>{t("common.cancel")}</Button>
              <Button
                color="warning"
                isDisabled={!note.trim()}
                isLoading={reverse.isPending}
                onPress={async () => {
                  if (!target) return;
                  await reverse.mutateAsync({ caseId: target.id, note: note.trim() });
                  setNote("");
                  onClose();
                }}
              >
                {t("cases.btn_reverse")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
