import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Progress,
  Select,
  SelectItem,
  Spinner,
  Tab,
  Tabs,
  Textarea,
} from "@heroui/react";
import {
  ArrowLeft,
  Ban,
  Building2,
  CheckCircle2,
  CircleSlash,
  Edit2,
  FileText,
  Link2,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import { useInvoices } from "@/features/billing/hooks/use-invoices";
import { useBills, useUpdateBillMutation } from "@/features/billing/hooks/use-bills";
import { useAccounts } from "@/features/billing/hooks/use-accounts";
import { useCreditNotes } from "@/features/billing/hooks/use-credit-notes";
import { useContractsQuery } from "@/features/crm/hooks/use-contracts";
import { useDealsQuery } from "@/features/crm/hooks/use-deals";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { selectFieldProps } from "@/components/shared/select-field";
import { useProjectT } from "../hooks/use-project-terminology";
import {
  useMilestones,
  useCreateMilestoneMutation,
  useUpdateMilestoneMutation,
  useDeleteMilestoneMutation,
  useProject,
  useTransitionProjectMutation,
  useUpdateProjectMutation,
  useUnits,
  useDeleteUnitMutation,
  useChangeUnitStatusMutation,
} from "../hooks/use-projects";
import { PROJECT_STATUS_TRANSITIONS, requiredReasonField } from "../constants/project-lifecycle";
import { supportsUnitInventory } from "../constants/activity-presets";
import {
  computeUnitRollup,
  canTransitionUnit,
  UNIT_STATUS_TRANSITIONS,
  type ProjectUnit,
  type UnitStatus,
} from "../types/unit.types";
import { UnitFormModal } from "../components/UnitFormModal";
import { computeProjectFinancials } from "../utils/project-financials";
import { canApproveDocuments } from "@/lib/permissions/document-approval";
import { ProjectFormModal } from "../components/ProjectFormModal";
import type { Project, ProjectDelivery, ProjectStatus } from "../types/projects.types";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  planning: "bg-primary/5 text-primary/80",
  active: "bg-success/10 text-success",
  completed: "bg-primary/10 text-primary",
  on_hold: "bg-warning/10 text-warning",
  cancelled: "bg-danger/10 text-danger",
  archived: "bg-default-200 text-default-600",
};

/** Verb label per transition target. */
const TRANSITION_LABEL_KEY: Partial<Record<ProjectStatus, string>> = {
  active: "actions.start",
  on_hold: "actions.pause",
  completed: "actions.complete",
  cancelled: "actions.cancel",
  archived: "actions.archive",
};

/**
 * Source-aware verb: moving back INTO active reads differently depending on
 * where the project is coming from (resume a hold, reopen a finished/cancelled
 * one, restore from archive). "actions.resume/reopened/unarchive" were localized
 * but previously never rendered — this wires them to their real transitions.
 */
function transitionVerbLabel(from: ProjectStatus, to: ProjectStatus): string {
  if (to === "active") {
    if (from === "on_hold") return "actions.resume";
    if (from === "completed" || from === "cancelled") return "actions.reopened";
    if (from === "archived") return "actions.unarchive";
    return "actions.start";
  }
  return TRANSITION_LABEL_KEY[to] ?? `status.${to}`;
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t, terms } = useProjectT();
  const { can } = useAppPermissions();
  const canManage = can("projects.manage");

  const { data: project, isLoading } = useProject(projectId);
  const transitionProject = useTransitionProjectMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [activeTabKey, setActiveTabKey] = useState("overview");
  const [pendingTransition, setPendingTransition] = useState<ProjectStatus | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const { data: contactsRes } = useContactsQuery();
  const customerName = useMemo(() => {
    if (!project?.contactId) return null;
    const c = (contactsRes?.data ?? []).find((x) => x.id === project.contactId);
    return c ? contactDisplayName(c) : null;
  }, [contactsRes, project?.contactId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner color="primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-16 text-center">
        <p className="text-default-500">{t("detail.notFound")}</p>
        <Button className="mt-4" variant="flat" startContent={<ArrowLeft className="h-4 w-4" />} as={Link} to="/projects">
          {t("title")}
        </Button>
      </div>
    );
  }

  const allowedTargets = PROJECT_STATUS_TRANSITIONS[project.status] ?? [];

  const runTransition = async () => {
    if (!pendingTransition) return;
    setTransitionError(null);
    try {
      await transitionProject.mutateAsync({
        id: project.id,
        to: pendingTransition,
        reason: reasonInput.trim() || undefined,
      });
      setPendingTransition(null);
      setReasonInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.startsWith("invalid_transition")) setTransitionError(t("transition.invalid"));
      else if (msg.startsWith("reason_required")) setTransitionError(t("transition.reasonRequired"));
      else setTransitionError(msg || t("transition.invalid"));
    }
  };

  const reasonField = pendingTransition
    ? requiredReasonField(project.status, pendingTransition)
    : null;

  return (
    <div className="pb-20 animate-in fade-in duration-300">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight truncate">{project.name}</h1>
            {project.code && (
              <span className="rounded-md bg-default-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-default-500">
                {project.code}
              </span>
            )}
            <Chip
              size="sm"
              variant="flat"
              className={cn("border-none font-bold text-[10px]", STATUS_STYLES[project.status])}
            >
              {t(`status.${project.status}`)}
            </Chip>
          </div>
          <p className="mt-1 text-sm text-default-500">
            {terms.singular} · {project.category || t("form.category")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage &&
            allowedTargets.map((to) => (
              <Button
                key={to}
                size="sm"
                variant={to === "cancelled" ? "flat" : "flat"}
                color={
                  to === "completed" || to === "active"
                    ? "primary"
                    : to === "cancelled"
                      ? "danger"
                      : "default"
                }
                startContent={
                  to === "active" ? (
                    <Play className="h-3.5 w-3.5" />
                  ) : to === "on_hold" ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : to === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : to === "cancelled" ? (
                    <Ban className="h-3.5 w-3.5" />
                  ) : (
                    <CircleSlash className="h-3.5 w-3.5" />
                  )
                }
                onPress={() => {
                  if (to === "active" && (project.status === "cancelled" || project.status === "completed")) {
                    // Reopen transitions carry no reason requirement.
                  }
                  setPendingTransition(to);
                  setReasonInput("");
                  setTransitionError(null);
                }}
              >
                {t(transitionVerbLabel(project.status, to))}
              </Button>
            ))}
          {canManage && (
            <Button
              size="sm"
              variant="bordered"
              startContent={<Edit2 className="h-3.5 w-3.5" />}
              onPress={() => setEditOpen(true)}
            >
              {t("actions.edit")}
            </Button>
          )}
        </div>
      </div>

      {/* Related-record navigation through verified references */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        {project.contactId && (
          <Button
            as={Link}
            to={`/crm/contacts/${project.contactId}`}
            size="sm"
            variant="flat"
            startContent={<Users className="h-3.5 w-3.5" />}
          >
            {t("detail.customer")}
            {customerName ? `: ${customerName}` : ""}
          </Button>
        )}
        {project.dealId && (
          <Button
            as={Link}
            to={`/crm/deals/${project.dealId}`}
            size="sm"
            variant="flat"
            startContent={<Link2 className="h-3.5 w-3.5" />}
          >
            {t("detail.deal")}
          </Button>
        )}
        {project.contractId && (
          <Button
            as={Link}
            to={`/crm/contracts?contractId=${project.contractId}`}
            size="sm"
            variant="flat"
            startContent={<FileText className="h-3.5 w-3.5" />}
          >
            {t("detail.contract")}
          </Button>
        )}
      </div>

      <Tabs
        aria-label={t("title")}
        variant="underlined"
        classNames={{ tab: "text-sm font-bold" }}
        selectedKey={activeTabKey}
        onSelectionChange={(key: string | number) => setActiveTabKey(String(key))}
      >
        <Tab key="overview" title={t("detail.overview")}>
          <OverviewTab
            project={project}
            canManage={canManage}
            customerName={customerName}
            onJumpToTab={setActiveTabKey}
          />
        </Tab>
        <Tab key="tasks" title={t("detail.tasks")}>
          <TasksTab project={project} />
        </Tab>
        <Tab key="milestones" title={t("detail.milestones")}>
          <MilestonesTab project={project} canManage={canManage} />
        </Tab>
        <Tab key="financials" title={t("detail.financials")}>
          <FinancialsTab project={project} />
        </Tab>
        <Tab key="timeline" title={t("detail.timeline")}>
          <TimelineTab project={project} />
        </Tab>
        <Tab key="delivery" title={t("detail.delivery")}>
          <DeliveryTab project={project} canManage={canManage} />
        </Tab>
        {supportsUnitInventory(project.activityType) && (
          <Tab key="units" title={t("units.tabTitle")}>
            <UnitsTab project={project} canManage={canManage} />
          </Tab>
        )}
      </Tabs>

      {/* Transition confirmation / reason modal */}
      <Modal isOpen={!!pendingTransition} onOpenChange={(o) => !o && setPendingTransition(null)}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t("transition.confirmTitle")}</ModalHeader>
              <ModalBody className="gap-3">
                <p className="text-sm">
                  {t("timeline.statusChanged", {
                    from: t(`status.${project.status}`),
                    to: t(`status.${pendingTransition ?? ""}`),
                  })}
                </p>
                {reasonField && (
                  <Textarea
                    label={
                      reasonField === "pauseReason"
                        ? t("transition.reasonPause")
                        : t("transition.reasonCancel")
                    }
                    value={reasonInput}
                    onValueChange={setReasonInput}
                    minRows={2}
                    isRequired
                  />
                )}
                {transitionError && (
                  <p className="text-xs font-semibold text-danger">{transitionError}</p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("form.cancel")}
                </Button>
                <Button
                  color={pendingTransition === "cancelled" ? "danger" : "primary"}
                  isLoading={transitionProject.isPending}
                  isDisabled={!!reasonField && !reasonInput.trim()}
                  onPress={runTransition}
                >
                  {t("form.save")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ProjectFormModal isOpen={editOpen} onOpenChange={setEditOpen} project={project} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

function OverviewTab({
  project,
  canManage,
  customerName,
  onJumpToTab,
}: {
  project: Project;
  canManage: boolean;
  customerName: string | null;
  onJumpToTab: (key: string) => void;
}) {
  const { t, rawT, i18n } = useProjectT();
  const updateProject = useUpdateProjectMutation();
  const [newBlocker, setNewBlocker] = useState("");
  const [newRisk, setNewRisk] = useState("");

  // Person records for name resolution (owner/team are stored as raw user ids).
  const { data: users = [] } = useAllUsers();
  const nameOf = (id?: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? localizedName(i18n.language, { name: u.name, nameAr: u.nameAr }) || u.email : null;
  };

  // Task progress + overdue follow-ups (tasks are the system's follow-up mechanism).
  const { data: allTasksRes } = useAllTasksQuery();
  const projectTasks = projectScopedTasks(allTasksRes?.data ?? [], project);
  const tasksDone = projectTasks.filter((tk) => tk.status === "done").length;
  const taskPct = projectTasks.length > 0 ? Math.round((tasksDone / projectTasks.length) * 100) : 0;

  const { data: milestones = [] } = useMilestones(project.id);
  const msDone = milestones.filter((m) => m.status === "completed").length;

  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueTasks = projectTasks.filter(
    (tk) => tk.status !== "done" && tk.dueDate && tk.dueDate < todayIso
  ).length;
  const overdueMilestones = milestones.filter(
    (m) => m.status === "planned" && m.dueDate && m.dueDate < todayIso
  ).length;
  const alerts = [
    ...(overdueTasks > 0 ? [{ key: "tasks", label: t("detail.alertOverdueTasks", { count: overdueTasks }) }] : []),
    ...(overdueMilestones > 0
      ? [{ key: "milestones", label: t("detail.alertOverdueMilestones", { count: overdueMilestones }) }]
      : []),
  ];

  // Commercial chain context from the authoritative CRM records (read-only).
  const { data: dealsRes } = useDealsQuery();
  const { data: contractsRes } = useContractsQuery();
  const deal = project.dealId
    ? (dealsRes?.data ?? []).find((d) => d.id === project.dealId) ?? null
    : null;
  const contract = project.contractId
    ? (contractsRes?.data ?? []).find((c) => c.id === project.contractId) ?? null
    : null;
  const dealStageLabel = deal
    ? rawT(`deals.stage.${deal.stage}`, { ns: "crm", defaultValue: deal.stage })
    : "—";
  const contractApprovalLabel = contract
    ? contract.approvalStatus === "approved"
      ? t("detail.contractApproved")
      : t("detail.contractPendingApproval")
    : "—";

  const listEditor = (
    field: "blockers" | "risks",
    label: string,
    emptyLabel: string,
    placeholderLabel: string,
    addButtonLabel: string
  ) => {
    const items = project[field] ?? [];
    const value = field === "blockers" ? newBlocker : newRisk;
    const setValue = field === "blockers" ? setNewBlocker : setNewRisk;
    return (
      <div className="rounded-xl border border-default-200/70 p-4 space-y-2">
        <p className="text-xs font-extrabold uppercase text-default-400">{label}</p>
        {items.length === 0 ? (
          <p className="text-sm text-default-400">{emptyLabel}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((item, idx) => (
              <li key={idx} className="flex items-start justify-between gap-2">
                <span>{item}</span>
                {canManage && (
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    aria-label={`${label} ${idx + 1}`}
                    onPress={() =>
                      updateProject.mutateAsync({
                        id: project.id,
                        data: { [field]: items.filter((_, i) => i !== idx) } as never,
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-default-400" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="flex gap-2">
            <Input
              size="sm"
              className="flex-1"
              placeholder={placeholderLabel}
              value={value}
              onValueChange={setValue}
            />
            <Button
              size="sm"
              variant="flat"
              color="primary"
              isDisabled={!value.trim()}
              onPress={async () => {
                await updateProject.mutateAsync({
                  id: project.id,
                  data: { [field]: [...items, value.trim()] } as never,
                });
                setValue("");
              }}
            >
              {addButtonLabel}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 pt-4">
      {alerts.length > 0 && (
        <div className="lg:col-span-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
          <p className="text-xs font-extrabold uppercase text-warning mb-1.5">
            {t("detail.needsAttention")}
          </p>
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <Button
                key={a.key}
                size="sm"
                variant="flat"
                color="warning"
                className="text-[11px]"
                onPress={() => onJumpToTab(a.key)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Card className="border border-default-100">
        <CardBody className="gap-3">
          {project.description && (
            <p className="text-sm text-default-600">{project.description}</p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Field label={t("detail.owner")} value={nameOf(project.ownerId) ?? "—"} />
            <Field
              label={t("detail.customer")}
              value={customerName || (project.contactId ? "✓" : "—")}
            />
            <Field
              label={t("detail.priority")}
              value={project.priority ? t(`priority.${project.priority}`) : "—"}
            />
            <Field
              label={t("detail.created")}
              value={project.createdAt ? formatDate(project.createdAt) : "—"}
            />
            <Field
              label={t("detail.updated")}
              value={project.updatedAt ? formatDate(project.updatedAt) : "—"}
            />
            <Field label={t("detail.dealStage")} value={dealStageLabel} />
            <Field
              label={t("detail.plannedDates")}
              value={
                project.startDate || project.endDate
                  ? `${project.startDate ? formatDate(project.startDate) : "—"} → ${
                      project.endDate ? formatDate(project.endDate) : "—"
                    }`
                  : "—"
              }
            />
            <Field
              label={t("detail.actualDates")}
              value={
                project.actualStartDate || project.actualEndDate
                  ? `${project.actualStartDate ? formatDate(project.actualStartDate) : "—"} → ${
                      project.actualEndDate ? formatDate(project.actualEndDate) : "—"
                    }`
                  : "—"
              }
            />
            <Field label={t("financials.budget")} value={project.budget != null ? formatCurrency(project.budget, project.currency) : "—"} />
            <Field label={t("form.activityType")} value={project.activityType ?? "—"} />
            <Field label={t("detail.contractApproval")} value={contractApprovalLabel} />
          </div>
          {project.tags && project.tags.length > 0 && (
            <div>
              <p className="text-xs font-extrabold uppercase text-default-400 mb-1">
                {t("detail.tags")}
              </p>
              <div className="flex flex-wrap gap-1">
                {project.tags.map((tag) => (
                  <Chip key={tag} size="sm" variant="flat" className="text-[10px]">
                    {tag}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {project.customFields && Object.keys(project.customFields).length > 0 && (
            <div>
              <p className="text-xs font-extrabold uppercase text-default-400 mb-1">
                {t("detail.customFields")}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {Object.entries(project.customFields).map(([k, v]) => (
                  <Field key={k} label={k} value={String(v ?? "—") || "—"} />
                ))}
              </div>
            </div>
          )}
          {project.members?.length > 0 && (
            <div>
              <p className="text-xs font-extrabold uppercase text-default-400 mb-1">
                {t("detail.team")}
              </p>
              <div className="flex flex-wrap gap-1">
                {project.members.map((m) => (
                  <Chip key={m} size="sm" variant="flat" className="text-[10px] font-semibold">
                    {nameOf(m) ?? m}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <Divider />
          <div>
            <p className="text-xs font-extrabold uppercase text-default-400 mb-1.5">
              {t("progress")}
            </p>
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between text-[11px] text-default-500 mb-1">
                  <span>
                    {projectTasks.length > 0
                      ? t("tasksTab.completed", { done: tasksDone, total: projectTasks.length })
                      : t("tasksTab.empty")}
                  </span>
                  <span className="font-bold tabular-nums">{taskPct}%</span>
                </div>
                <Progress value={taskPct} color="primary" size="sm" aria-label={t("progress")} />
              </div>
              {milestones.length > 0 && (
                <p className="text-[11px] text-default-500">
                  {t("detail.milestoneProgress", { done: msDone, total: milestones.length })}
                </p>
              )}
            </div>
          </div>
          {(project.pauseReason || project.cancellationReason || project.delayReason) && (
            <div className="rounded-lg bg-warning/5 border border-warning/20 p-2.5 text-xs space-y-1">
              {project.pauseReason && (
                <p>
                  <span className="font-bold">{t("transition.reasonPause")}: </span>
                  {project.pauseReason}
                </p>
              )}
              {project.cancellationReason && (
                <p>
                  <span className="font-bold">{t("transition.reasonCancel")}: </span>
                  {project.cancellationReason}
                </p>
              )}
              {project.delayReason && (
                <p>
                  <span className="font-bold">{t("detail.delayReason")}: </span>
                  {project.delayReason}
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="space-y-4">
        {listEditor(
          "blockers",
          t("detail.blockers"),
          t("detail.noBlockers"),
          t("detail.addBlocker"),
          t("detail.addBlocker")
        )}
        {listEditor(
          "risks",
          t("detail.risks"),
          t("detail.noRisks"),
          t("detail.addRisk"),
          t("detail.addRisk")
        )}
        <Card className="border border-default-100">
          <CardBody className="gap-2">
            <p className="text-xs font-extrabold uppercase text-default-400">{t("detail.history")}</p>
            {!project.statusHistory || project.statusHistory.length === 0 ? (
              <p className="text-sm text-default-400">{t("detail.noHistory")}</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {project.statusHistory.map((h, idx) => (
                  <li key={idx} className="flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" variant="flat" className={STATUS_STYLES[h.to]}>
                      {t(`status.${h.to}`)}
                    </Chip>
                    <span className="text-default-400">
                      {t("detail.from")} {t(`status.${h.from}`)} · {formatDate(h.at)}
                    </span>
                    {h.note && <span className="text-default-500">— {h.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-extrabold uppercase text-default-400">{label}</p>
      <p className={cn("truncate font-semibold text-default-700", mono && "font-mono text-xs")}>
        {value}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Execution scope of a project: its own tasks plus the tasks generated from
 * its linked contract (contract conversions carry contractId, not projectId —
 * the forward links stay authoritative).
 */
function projectScopedTasks<T extends { projectId?: string | null; contractId?: string | null }>(
  all: T[],
  project: Project
): T[] {
  const seen = new Set<string>();
  return all.filter((tk) => {
    const hit =
      tk.projectId === project.id || (!!project.contractId && tk.contractId === project.contractId);
    if (!hit) return false;
    const key = (tk as { id?: string }).id ?? "";
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

function TasksTab({ project }: { project: Project }) {
  const { t, i18n } = useProjectT();
  const { data: allTasksRes } = useAllTasksQuery();
  const { data: allUsers = [] } = useAllUsers();
  const nameOfTask = (id?: string | null) => {
    if (!id) return null;
    const u = allUsers.find((x) => x.id === id);
    return u ? localizedName(i18n.language, u) || u.name : id;
  };
  const tasks = projectScopedTasks(allTasksRes?.data ?? [], project);
  const done = tasks.filter((tk) => tk.status === "done").length;
  const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="pt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-default-600">
          {tasks.length > 0
            ? t("tasksTab.completed", { done, total: tasks.length })
            : t("tasksTab.empty")}
        </p>
        <div className="flex gap-2">
          <Button
            as={Link}
            to={`/tasks/new?projectId=${project.id}`}
            size="sm"
            variant="flat"
            color="primary"
            startContent={<Plus className="h-3.5 w-3.5" />}
          >
            {t("tasksTab.newTask")}
          </Button>
          <Button as={Link} to={`/tasks/work?projectId=${project.id}`} size="sm" variant="bordered">
            {t("detail.openTasks")}
          </Button>
        </div>
      </div>
      {tasks.length > 0 && (
        <>
          <Progress value={pct} color="primary" aria-label={t("progress")} />
          <Card className="border border-default-100">
            <CardBody className="gap-1 p-0">
              {tasks.map((tk) => (
                <Link
                  key={tk.id}
                  to={`/tasks/${tk.id}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-default-50 transition-colors"
                >
                  <span className={cn("truncate", tk.status === "done" && "line-through text-default-400")}>
                    {tk.title}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {tk.dueDate && (
                      <span className="text-[11px] text-default-400">{formatDate(tk.dueDate)}</span>
                    )}
                    {/* Accountability is visible on every row: either the
                        canonical assignee or an explicit unassigned flag. */}
                    {tk.assigneeId ? (
                      <Chip size="sm" variant="flat" color="default" className="text-[10px]">
                        {nameOfTask(tk.assigneeId)}
                      </Chip>
                    ) : (
                      <Chip size="sm" variant="flat" color="warning" className="text-[10px]">
                        {t("tasksTab.unassigned")}
                      </Chip>
                    )}
                    <Chip size="sm" variant="flat" className="text-[10px]">
                      {tk.status}
                    </Chip>
                  </span>
                </Link>
              ))}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Milestones                                                                 */
/* -------------------------------------------------------------------------- */

function MilestonesTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const { t } = useProjectT();
  const { data: milestones = [], isLoading } = useMilestones(project.id);
  const createMilestone = useCreateMilestoneMutation(project.id);
  const updateMilestone = useUpdateMilestoneMutation(project.id);
  const deleteMilestone = useDeleteMilestoneMutation(project.id);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  return (
    <div className="pt-4 space-y-3">
      <p className="text-[11px] text-default-400">{t("milestones.progressHint")}</p>
      {isLoading ? (
        <Spinner size="sm" />
      ) : milestones.length === 0 ? (
        <p className="text-sm text-default-400">{t("milestones.empty")}</p>
      ) : (
        <Card className="border border-default-100">
          <CardBody className="p-0 gap-0">
            {milestones.map((ms) => (
              <div
                key={ms.id}
                className="flex items-center justify-between gap-2 border-b border-default-100 px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-semibold",
                      ms.status === "completed" && "line-through text-default-400"
                    )}
                  >
                    {ms.title}
                  </p>
                  {ms.dueDate && (
                    <p className="text-[11px] text-default-400">
                      {t("milestones.dueDate")}: {formatDate(ms.dueDate)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Chip
                    size="sm"
                    variant="flat"
                    className={cn(
                      "text-[10px]",
                      ms.status === "completed"
                        ? "bg-primary/10 text-primary"
                        : ms.status === "cancelled"
                          ? "bg-danger/10 text-danger"
                          : "bg-default-100 text-default-500"
                    )}
                  >
                    {t(
                      ms.status === "completed"
                        ? "milestones.statusCompleted"
                        : ms.status === "cancelled"
                          ? "milestones.statusCancelled"
                          : "milestones.statusPlanned"
                    )}
                  </Chip>
                  {canManage && ms.status === "planned" && (
                    <Button
                      size="sm"
                      variant="light"
                      color="primary"
                      onPress={() =>
                        updateMilestone.mutateAsync({
                          milestoneId: ms.id,
                          data: { status: "completed", completedAt: new Date().toISOString() },
                        })
                      }
                    >
                      {t("milestones.markComplete")}
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      aria-label={t("milestones.delete")}
                      onPress={() => deleteMilestone.mutateAsync(ms.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-default-400" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Input
            size="sm"
            className="min-w-[200px] flex-1"
            placeholder={t("milestones.titlePlaceholder")}
            value={title}
            onValueChange={setTitle}
          />
          <Input type="date" size="sm" className="w-44" value={dueDate} onValueChange={setDueDate} />
          <Button
            size="sm"
            color="primary"
            variant="flat"
            isDisabled={!title.trim()}
            isLoading={createMilestone.isPending}
            startContent={<Plus className="h-3.5 w-3.5" />}
            onPress={async () => {
              await createMilestone.mutateAsync({
                title: title.trim(),
                status: "planned",
                dueDate: dueDate || null,
                sequenceOrder: milestones.length,
              });
              setTitle("");
              setDueDate("");
            }}
          >
            {t("milestones.add")}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Financials — derived only, never editable here                             */
/* -------------------------------------------------------------------------- */

function FinancialsTab({ project }: { project: Project }) {
  const { t } = useProjectT();
  const { t: tb } = useTranslation("billing");
  const { data: invoicesRes } = useInvoices();
  const { data: bills = [] } = useBills();
  const { data: accounts = [] } = useAccounts();
  const { data: creditNotes = [] } = useCreditNotes();
  const { data: contractsRes } = useContractsQuery();
  const updateBill = useUpdateBillMutation();
  const userId = useAuthStore((s) => s.user?.id);
  const userRole = useAuthStore((s) => s.user?.role);
  const canReview = canApproveDocuments(userRole);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const invoices = (invoicesRes as { data?: unknown[] } | undefined)?.data ?? invoicesRes ?? [];
  const contracts = contractsRes?.data ?? [];

  const fin = useMemo(
    () =>
      computeProjectFinancials({
        project,
        contracts,
        invoices: invoices as never,
        bills: bills as never,
        creditNotes: creditNotes as never,
        accounts: accounts as never,
      }),
    [project, contracts, invoices, bills, creditNotes, accounts]
  );

  const row = (label: string, value: number, opts?: { accent?: string; hint?: string }) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-default-500">{label}</span>
      <span className={cn("font-bold tabular-nums", opts?.accent)}>{formatCurrency(value, fin.currency)}</span>
    </div>
  );

  return (
    <div className="pt-4 space-y-4">
      <p className="text-[11px] text-default-400">{t("financials.note")}</p>
      {fin.foreignCurrencyExcluded > 0 && (
        <p className="text-[11px] font-semibold text-warning">
          {t("financials.currencyExcluded", { count: fin.foreignCurrencyExcluded })}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border border-default-100">
          <CardBody>
            <p className="mb-1 text-xs font-extrabold uppercase text-default-400">
              {t("financials.contractedValue")}
            </p>
            {row(t("financials.contractedValue"), fin.contractedValue)}
            {row(t("financials.contractVat"), fin.contractVat)}
            {row(t("financials.contractGrand"), fin.contractGrandTotal)}
            <Divider className="my-2" />
            {row(t("financials.invoiced"), fin.invoicedAmount)}
            {row(t("financials.collected"), fin.collectedAmount, { accent: "text-success" })}
            {row(t("financials.creditNotes"), -fin.creditNotesAmount)}
            {row(t("financials.outstanding"), fin.outstandingReceivables, {
              accent: fin.outstandingReceivables > 0 ? "text-warning" : undefined,
            })}
            {row(t("financials.overdue"), fin.overdueReceivables, {
              accent: fin.overdueReceivables > 0 ? "text-danger" : undefined,
            })}
          </CardBody>
        </Card>
        <Card className="border border-default-100">
          <CardBody>
            <p className="mb-1 text-xs font-extrabold uppercase text-default-400">
              {t("financials.expenses")}
            </p>
            {/* Three distinct cost numbers — recorded / approved actual / paid.
                Rejected bills are excluded from every total but stay visible
                in the review table below. */}
            {row(t("financials.costRecorded"), fin.expensesActual)}
            {row(t("financials.costApproved"), fin.costsApproved, {
              accent: fin.costsPendingReview > 0 ? undefined : "text-success",
            })}
            {fin.costsPendingReview > 0 &&
              row(
                t("financials.costPending", { count: fin.pendingReviewCount }),
                fin.costsPendingReview,
                { accent: "text-warning" }
              )}
            {fin.costsRejected > 0 &&
              row(
                t("financials.costRejected", { count: fin.rejectedBillCount }),
                fin.costsRejected,
                { accent: "text-danger" }
              )}
            {row(t("financials.costPaid"), fin.paidCosts)}
            <Divider className="my-2" />
            {row(t("financials.unpaidObligations"), fin.unpaidObligations, {
              accent: fin.unpaidObligations > 0 ? "text-warning" : undefined,
            })}
            {row(t("financials.forecastCost"), fin.forecastCost)}
            <Divider className="my-2" />
            {row(t("financials.budget"), fin.budget ?? 0)}
            {row(t("financials.budgetVariance"), fin.budgetVariance ?? 0, {
              accent:
                fin.budgetVariance == null
                  ? undefined
                  : fin.budgetVariance < 0
                    ? "text-danger"
                    : "text-success",
            })}
            <Divider className="my-2" />
            {row(t("financials.cashIn"), fin.cashIn, { accent: "text-success" })}
            {row(t("financials.cashOut"), -fin.cashOut)}
            {row(t("financials.estimatedMargin"), fin.estimatedMargin ?? 0)}
            {row(t("financials.actualMargin"), fin.actualMargin)}
            {row(t("financials.approvedActualMargin"), fin.approvedActualMargin, {
              accent: fin.approvedActualMargin >= 0 ? "text-success" : "text-danger",
            })}
            <p className="mt-2 text-[10px] text-default-400">{t("financials.notProfit")}</p>
          </CardBody>
        </Card>
      </div>

      {/* Costs by category — the tenant's chart of accounts IS the configurable
          category list (add/rename/deactivate in Billing → Chart of Accounts);
          each bill line's recorded cost is allocated to its account here. */}
      {fin.expenseByCategory.length > 0 && (
        <Card className="border border-default-100">
          <CardBody className="gap-2">
            <p className="text-xs font-extrabold uppercase text-default-400">
              {t("financials.byCategoryTitle")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-start text-default-400">
                    <th className="py-1.5 text-start font-bold">{t("financials.byCategoryAccount")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.costRecorded")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.costApproved")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.costPaid")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fin.expenseByCategory.map((c) => (
                    <tr key={c.accountId || "__unclassified__"} className="border-t border-default-100">
                      <td className="py-1.5">
                        <span className="font-semibold">
                          {c.accountId
                            ? tb(`accounts.names.${c.label}`, { defaultValue: c.label })
                            : t("financials.uncategorized")}
                        </span>
                        {c.code && <span className="ms-1.5 text-default-400">({c.code})</span>}
                      </td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(c.recorded, fin.currency)}</td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(c.approved, fin.currency)}</td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(c.paid, fin.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-default-400">{t("financials.byCategoryHint")}</p>
          </CardBody>
        </Card>
      )}

      <Card className="border border-default-100">
        <CardBody className="gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase text-default-400">
              {t("financials.schedule")}
            </p>
            <div className="flex gap-2">
              <Button as={Link} to="/billing/invoices/new" size="sm" variant="flat" color="primary">
                {t("financials.newInvoice")}
              </Button>
              <Button
                as={Link}
                to={`/billing/bills/new?projectId=${project.id}`}
                size="sm"
                variant="bordered"
              >
                {t("financials.newExpense")}
              </Button>
            </div>
          </div>
          {fin.schedule.length === 0 ? (
            <p className="text-sm text-default-400">{t("financials.scheduleEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-start text-default-400">
                    <th className="py-1.5 text-start font-bold">{t("financials.invoice")}</th>
                    <th className="py-1.5 text-start font-bold">{t("financials.dueDate")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.invoiced")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.collected")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.open")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fin.schedule.map((s) => (
                    <tr key={s.invoiceId} className="border-t border-default-100">
                      <td className="py-1.5">
                        <Link to={`/billing/invoices/${s.invoiceId}`} className="font-semibold text-primary">
                          {s.invoiceNumber}
                        </Link>
                      </td>
                      <td className="py-1.5">
                        {s.dueDate ? formatDate(s.dueDate) : "—"}
                        {s.overdue && (
                          <Chip size="sm" variant="flat" color="danger" className="ms-1.5 text-[9px]">
                            {t("financials.overdueFlag")}
                          </Chip>
                        )}
                      </td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(s.grandTotal, fin.currency)}</td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(s.amountPaid, fin.currency)}</td>
                      <td className="py-1.5 text-end tabular-nums font-bold">{formatCurrency(s.open, fin.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Bills drill-down — the official expense source rows, with the
          accountant review queue inline. Approve/reject updates the BILL
          itself (no parallel system); totals above re-derive from it. */}
      {fin.billRows.length > 0 && (
        <Card className="border border-default-100">
          <CardBody className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-extrabold uppercase text-default-400">
                {t("financials.billsTitle")}
              </p>
              {fin.pendingReviewCount > 0 && (
                <Chip size="sm" variant="flat" color="warning">
                  {t("financials.pendingReview", { count: fin.pendingReviewCount })}
                </Chip>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-start text-default-400">
                    <th className="py-1.5 text-start font-bold">{t("financials.bill")}</th>
                    <th className="py-1.5 text-start font-bold">{t("financials.vendor")}</th>
                    <th className="py-1.5 text-start font-bold">{t("financials.dueDate")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.total")}</th>
                    <th className="py-1.5 text-end font-bold">{t("financials.collected")}</th>
                    <th className="py-1.5 text-start font-bold">{t("financials.review")}</th>
                    {canReview && <th className="py-1.5 text-end font-bold">{t("financials.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {fin.billRows.map((b) => (
                    <tr key={b.billId} className="border-t border-default-100">
                      <td className="py-1.5">
                        <Link to={`/billing/bills/${b.billId}`} className="font-semibold text-primary">
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="py-1.5">{b.vendorName}</td>
                      <td className="py-1.5">
                        {b.dueDate ? formatDate(b.dueDate) : "—"}
                        {b.overdue && (
                          <Chip size="sm" variant="flat" color="danger" className="ms-1.5 text-[9px]">
                            {t("financials.overdueFlag")}
                          </Chip>
                        )}
                      </td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(b.grandTotal, fin.currency)}</td>
                      <td className="py-1.5 text-end tabular-nums">{formatCurrency(b.amountPaid, fin.currency)}</td>
                      <td className="py-1.5">
                        {b.approvalStatus === "approved" && (
                          <Chip size="sm" variant="flat" color="success" className="text-[9px]">
                            {t("financials.approvedChip")}
                          </Chip>
                        )}
                        {b.approvalStatus === "rejected" && (
                          <Chip size="sm" variant="flat" color="danger" className="text-[9px]">
                            {t("financials.rejectedChip")}
                          </Chip>
                        )}
                        {(b.approvalStatus === "pending" || !b.approvalStatus) && (
                          <Chip size="sm" variant="flat" color="warning" className="text-[9px]">
                            {t("financials.pendingChip")}
                          </Chip>
                        )}
                        {b.reviewNote && (
                          <span className="ms-1.5 text-[10px] text-default-400">{b.reviewNote}</span>
                        )}
                      </td>
                      {canReview && (
                        <td className="py-1.5 text-end">
                          <div className="flex justify-end gap-1.5">
                            {b.approvalStatus !== "approved" && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="success"
                                isLoading={updateBill.isPending && updateBill.variables?.id === b.billId}
                                onPress={async () => {
                                  if (!userId) return;
                                  await updateBill.mutateAsync({
                                    id: b.billId,
                                    data: {
                                      approvalStatus: "approved",
                                      approvedBy: userId,
                                      approvedAt: new Date().toISOString(),
                                    },
                                  });
                                }}
                              >
                                {t("financials.approve")}
                              </Button>
                            )}
                            {b.approvalStatus !== "rejected" && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="danger"
                                onPress={() => {
                                  setRejectTarget(b.billId)
                                  setRejectNote(b.reviewNote ?? "")
                                }}
                              >
                                {t("financials.reject")}
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canReview && (
              <p className="text-[10px] text-default-400">{t("financials.reviewGateHint")}</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Closeout review — informational checks derived from the same
          figures above; nothing here is stored or blocks transitions. */}
      <Card className="border border-default-100">
        <CardBody className="gap-2">
          <p className="text-xs font-extrabold uppercase text-default-400">
            {t("financials.closeoutTitle")}
          </p>
          <ul className="space-y-1.5 text-xs">
            <CloseoutItem
              ok={fin.pendingReviewCount === 0}
              label={t("financials.closeoutReview", { count: fin.pendingReviewCount })}
            />
            <CloseoutItem
              ok={fin.outstandingReceivables <= 0.005}
              label={t("financials.closeoutReceivables", { value: formatCurrency(fin.outstandingReceivables, fin.currency) })}
            />
            <CloseoutItem
              ok={fin.unpaidObligations <= 0.005}
              label={t("financials.closeoutPayables", { value: formatCurrency(fin.unpaidObligations, fin.currency) })}
            />
            <CloseoutItem
              ok={fin.rejectedBillCount === 0}
              label={t("financials.closeoutRejected", { count: fin.rejectedBillCount })}
            />
            <CloseoutItem
              ok={fin.budget == null || (fin.budgetVariance ?? 0) >= 0}
              label={
                fin.budget == null
                  ? t("financials.closeoutNoBudget")
                  : t("financials.closeoutBudget", { value: formatCurrency(Math.abs(fin.budgetVariance ?? 0), fin.currency) })
              }
            />
          </ul>
          <p className="text-[10px] text-default-400">{t("financials.closeoutHint")}</p>
        </CardBody>
      </Card>

      <Modal isOpen={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t("financials.rejectTitle")}</ModalHeader>
              <ModalBody>
                <Textarea
                  size="sm"
                  label={t("financials.rejectReason")}
                  placeholder={t("financials.rejectReasonPlaceholder")}
                  value={rejectNote}
                  onValueChange={setRejectNote}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("financials.cancelBtn")}
                </Button>
                <Button
                  color="danger"
                  isDisabled={!rejectNote.trim()}
                  isLoading={updateBill.isPending}
                  onPress={async () => {
                    if (!rejectTarget || !userId) return;
                    await updateBill.mutateAsync({
                      id: rejectTarget,
                      data: {
                        approvalStatus: "rejected",
                        approvedBy: userId,
                        approvedAt: new Date().toISOString(),
                        reviewNote: rejectNote.trim(),
                      },
                    });
                    setRejectTarget(null)
                    setRejectNote("")
                    onClose()
                  }}
                >
                  {t("financials.reject")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

function CloseoutItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      )}
      <span className={cn(ok ? "text-default-500" : "font-semibold text-default-700")}>{label}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline (project-local audit view; customer timeline covers cross-record)  */
/* -------------------------------------------------------------------------- */

function TimelineTab({ project }: { project: Project }) {
  const { t } = useProjectT();
  const { data: milestones = [] } = useMilestones(project.id);

  const events = useMemo(() => {
    const list: Array<{ at: string; label: string; detail?: string }> = [];
    if (project.createdAt) list.push({ at: project.createdAt, label: t("timeline.created") });
    if (project.conversionKey?.startsWith("contract:") && project.createdAt) {
      list.push({
        at: project.createdAt,
        label: t("timeline.convertedFrom", { title: project.contractId ?? "" }),
      });
    }
    for (const h of project.statusHistory ?? []) {
      list.push({
        at: h.at,
        label: t("timeline.statusChanged", { from: t(`status.${h.from}`), to: t(`status.${h.to}`) }),
        detail: h.note,
      });
    }
    for (const ms of milestones) {
      if (ms.createdAt) list.push({ at: ms.createdAt, label: t("timeline.milestoneAdded", { title: ms.title }) });
      if (ms.completedAt)
        list.push({ at: ms.completedAt, label: t("timeline.milestoneCompleted", { title: ms.title }) });
    }
    if (project.delivery?.submittedAt)
      list.push({ at: project.delivery.submittedAt, label: t("timeline.deliverySubmitted") });
    if (project.delivery?.acceptedAt)
      list.push({ at: project.delivery.acceptedAt, label: t("timeline.deliveryAccepted") });
    return list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [project, milestones, t]);

  if (events.length === 0) {
    return <p className="pt-4 text-sm text-default-400">{t("timeline.empty")}</p>;
  }

  return (
    <Card className="mt-4 border border-default-100">
      <CardBody className="gap-0 p-0">
        {events.map((e, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 border-b border-default-100 px-4 py-2.5 text-sm last:border-b-0"
          >
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{e.label}</p>
              {e.detail && <p className="text-xs text-default-500">{e.detail}</p>}
            </div>
            <span className="shrink-0 text-[11px] text-default-400">{formatDate(e.at)}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

const DELIVERY_FLOW: Array<{ stage: ProjectDelivery["stage"]; actionKey?: string; from: ProjectDelivery["stage"][] }> = [
  { stage: "pending_review", actionKey: "delivery.submit", from: ["not_started", "changes_requested"] },
  { stage: "accepted", actionKey: "delivery.accept", from: ["pending_review"] },
  { stage: "changes_requested", actionKey: "delivery.requestChanges", from: ["pending_review"] },
  { stage: "support", actionKey: "delivery.startSupport", from: ["accepted"] },
];

function DeliveryTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const { t } = useProjectT();
  const updateProject = useUpdateProjectMutation();
  const userId = useAuthStore((s) => s.user?.id);
  const delivery = project.delivery ?? { stage: "not_started" as const };
  const [requirements, setRequirements] = useState(delivery.requirements ?? "");
  const [notes, setNotes] = useState(delivery.notes ?? "");
  const [supportUntil, setSupportUntil] = useState(delivery.supportUntil ?? "");

  const setStage = async (stage: ProjectDelivery["stage"]) => {
    const now = new Date().toISOString();
    await updateProject.mutateAsync({
      id: project.id,
      data: {
        delivery: {
          ...delivery,
          requirements: requirements.trim() || delivery.requirements,
          notes: notes.trim() || delivery.notes,
          stage,
          submittedAt: stage === "pending_review" ? now : delivery.submittedAt,
          acceptedAt: stage === "accepted" ? now : delivery.acceptedAt,
          acceptedBy: stage === "accepted" ? (userId ?? null) : delivery.acceptedBy,
          supportUntil: stage === "support" ? supportUntil || delivery.supportUntil : delivery.supportUntil,
        },
      },
    });
  };

  return (
    <div className="grid gap-4 pt-4 lg:grid-cols-2">
      <Card className="border border-default-100">
        <CardBody className="gap-3">
          <p className="text-xs font-extrabold uppercase text-default-400">{t("delivery.stage")}</p>
          <Chip
            size="sm"
            variant="flat"
            className={cn(
              "w-fit font-bold",
              delivery.stage === "accepted" || delivery.stage === "support"
                ? "bg-success/10 text-success"
                : delivery.stage === "changes_requested"
                  ? "bg-warning/10 text-warning"
                  : "bg-default-100 text-default-600"
            )}
          >
            {t(`delivery.stages.${delivery.stage}`)}
          </Chip>
          {delivery.submittedAt && (
            <p className="text-xs text-default-500">
              {t("delivery.submittedAt")}: {formatDate(delivery.submittedAt)}
            </p>
          )}
          {delivery.acceptedAt && (
            <p className="text-xs text-default-500">
              {t("delivery.acceptedAt")}: {formatDate(delivery.acceptedAt)} · {t("delivery.acceptedBy")}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2 pt-1">
              {DELIVERY_FLOW.filter((f) => f.from.includes(delivery.stage)).map((f) => (
                <Button
                  key={f.stage}
                  size="sm"
                  variant="flat"
                  color={f.stage === "accepted" ? "success" : f.stage === "changes_requested" ? "warning" : "primary"}
                  startContent={f.stage === "pending_review" ? <Send className="h-3.5 w-3.5" /> : undefined}
                  isLoading={updateProject.isPending}
                  onPress={() => setStage(f.stage)}
                >
                  {t(f.actionKey ?? "form.save")}
                </Button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="border border-default-100">
        <CardBody className="gap-3">
          <Textarea
            label={t("delivery.requirements")}
            placeholder={t("delivery.requirementsPlaceholder")}
            value={requirements}
            onValueChange={setRequirements}
            isDisabled={!canManage}
            minRows={2}
          />
          <Textarea
            label={t("delivery.notes")}
            value={notes}
            onValueChange={setNotes}
            isDisabled={!canManage}
            minRows={2}
          />
          {delivery.stage === "accepted" || delivery.stage === "support" ? (
            <Input
              type="date"
              label={t("delivery.supportUntil")}
              value={supportUntil}
              onValueChange={setSupportUntil}
              isDisabled={!canManage}
            />
          ) : null}
          {canManage && (requirements !== (delivery.requirements ?? "") || notes !== (delivery.notes ?? "")) && (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              onPress={() =>
                updateProject.mutateAsync({
                  id: project.id,
                  data: { delivery: { ...delivery, requirements: requirements.trim(), notes: notes.trim() } },
                })
              }
            >
              {t("form.save")}
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Units — integrated real-estate inventory (only for unit-bearing types)      */
/* -------------------------------------------------------------------------- */

const UNIT_STATUS_STYLES: Record<UnitStatus, string> = {
  available: "bg-success/10 text-success",
  reserved: "bg-warning/10 text-warning",
  sold: "bg-primary/10 text-primary",
  maintenance: "bg-default-100 text-default-600",
  withdrawn: "bg-danger/10 text-danger",
};

function UnitsTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const { t } = useProjectT();
  const { data: units = [] } = useUnits(project.id);
  const deleteUnit = useDeleteUnitMutation(project.id);
  const changeStatus = useChangeUnitStatusMutation(project.id);
  const { data: contactsRes } = useContactsQuery();
  const contacts = contactsRes?.data ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectUnit | null>(null);
  // A commitment (reserve/sell) needs a buyer reference → collect it in a modal.
  const [commitTarget, setCommitTarget] = useState<{ unit: ProjectUnit; to: UnitStatus } | null>(
    null
  );
  const [commitBuyer, setCommitBuyer] = useState("");
  const [commitNote, setCommitNote] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);

  const rollup = useMemo(() => computeUnitRollup(units), [units]);
  const buyerName = (id?: string | null) => {
    if (!id) return null;
    const c = contacts.find((x) => x.id === id);
    return c ? contactDisplayName(c) : id;
  };

  const nextStatuses = (u: ProjectUnit) =>
    (UNIT_STATUS_TRANSITIONS[u.status] ?? []).filter((to) => canTransitionUnit(u.status, to));

  const openCommit = (unit: ProjectUnit, to: UnitStatus) => {
    setCommitTarget({ unit, to });
    setCommitBuyer(unit.buyerContactId ?? "");
    setCommitNote("");
    setCommitError(null);
  };

  const applyTransition = async (u: ProjectUnit, to: UnitStatus) => {
    setCommitError(null);
    // Reserve / sell route through the commitment modal to capture the buyer.
    if (to === "reserved" || to === "sold") {
      openCommit(u, to);
      return;
    }
    try {
      await changeStatus.mutateAsync({ unitId: u.id, to });
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : "error");
    }
  };

  const submitCommit = async () => {
    if (!commitTarget) return;
    try {
      await changeStatus.mutateAsync({
        unitId: commitTarget.unit.id,
        to: commitTarget.to,
        buyerContactId: commitBuyer || null,
        note: commitNote.trim() || undefined,
      });
      setCommitTarget(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setCommitError(
        msg.startsWith("unit_already_committed")
          ? t("units.errAlreadyCommitted")
          : msg.startsWith("invalid_transition")
            ? t("units.errInvalidTransition")
            : msg || t("units.errInvalidTransition")
      );
    }
  };

  return (
    <div className="pt-4 space-y-4">
      <p className="text-[11px] text-default-400">{t("units.note")}</p>

      {/* Inventory rollup — asking-price valuation, distinct from collected revenue. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            { k: "available", v: rollup.available, tone: "text-success" },
            { k: "reserved", v: rollup.reserved, tone: "text-warning" },
            { k: "sold", v: rollup.sold, tone: "text-primary" },
            { k: "total", v: rollup.total, tone: "" },
          ] as const
        ).map((s) => (
          <Card key={s.k} className="border border-default-100">
            <CardBody className="gap-0.5">
              <p className="text-[11px] font-bold uppercase text-default-400">{t(`units.${s.k}`)}</p>
              <p className={cn("text-2xl font-extrabold tabular-nums", s.tone)}>{s.v}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border border-default-100">
          <CardBody className="gap-0.5">
            <p className="text-[11px] font-bold uppercase text-default-400">{t("units.inventoryValue")}</p>
            <p className="text-lg font-extrabold tabular-nums">{formatCurrency(rollup.inventoryValue, rollup.currency)}</p>
          </CardBody>
        </Card>
        <Card className="border border-default-100">
          <CardBody className="gap-0.5">
            <p className="text-[11px] font-bold uppercase text-default-400">{t("units.soldValue")}</p>
            <p className="text-lg font-extrabold tabular-nums">{formatCurrency(rollup.soldValue, rollup.currency)}</p>
          </CardBody>
        </Card>
        <Card className="border border-default-100">
          <CardBody className="gap-0.5">
            <p className="text-[11px] font-bold uppercase text-default-400">{t("units.unsoldValue")}</p>
            <p className="text-lg font-extrabold tabular-nums">{formatCurrency(rollup.unsoldValue, rollup.currency)}</p>
          </CardBody>
        </Card>
      </div>

      {canManage && (
        <div className="flex justify-end">
          <Button
            size="sm"
            color="primary"
            variant="flat"
            startContent={<Plus className="h-3.5 w-3.5" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("units.add")}
          </Button>
        </div>
      )}

      {units.length === 0 ? (
        <Card className="border border-default-100">
          <CardBody className="items-center gap-2 py-8 text-center">
            <Building2 className="h-8 w-8 text-default-300" />
            <p className="text-sm text-default-500">{t("units.empty")}</p>
          </CardBody>
        </Card>
      ) : (
        <Card className="border border-default-100">
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-[11px] text-default-400">
                  <th className="px-4 py-2 text-start font-bold">{t("units.code")}</th>
                  <th className="px-4 py-2 text-start font-bold">{t("units.unitType")}</th>
                  <th className="px-4 py-2 text-end font-bold">{t("units.area")}</th>
                  <th className="px-4 py-2 text-end font-bold">{t("units.price")}</th>
                  <th className="px-4 py-2 text-start font-bold">{t("units.status")}</th>
                  <th className="px-4 py-2 text-start font-bold">{t("units.buyer")}</th>
                  {canManage && <th className="px-4 py-2 text-end font-bold">{t("units.actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} className="border-t border-default-100">
                    <td className="px-4 py-2">
                      <span className="font-semibold">{u.code}</span>
                      {(u.building || u.floor) && (
                        <span className="block text-[11px] text-default-400">
                          {[u.building, u.floor].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{t(`units.types.${u.unitType}`)}</td>
                    <td className="px-4 py-2 text-end tabular-nums">
                      {u.area != null ? `${u.area} ${t("units.areaUnit")}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums font-semibold">
                      {formatCurrency(u.price, u.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <Chip size="sm" variant="flat" className={cn("border-none font-bold text-[10px]", UNIT_STATUS_STYLES[u.status])}>
                        {t(`units.statuses.${u.status}`)}
                      </Chip>
                    </td>
                    <td className="px-4 py-2 text-xs text-default-500">{buyerName(u.buyerContactId) || "—"}</td>
                    {canManage && (
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {nextStatuses(u).map((to) => (
                            <Button
                              key={to}
                              size="sm"
                              variant="light"
                              color={to === "sold" ? "success" : to === "reserved" ? "warning" : to === "withdrawn" ? "danger" : "default"}
                              isLoading={changeStatus.isPending}
                              onPress={() => applyTransition(u, to)}
                            >
                              {t(`units.actions2.${to}`)}
                            </Button>
                          ))}
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            aria-label={t("units.edit")}
                            onPress={() => {
                              setEditing(u);
                              setFormOpen(true);
                            }}
                          >
                            <Edit2 className="h-3.5 w-3.5 text-default-400" />
                          </Button>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            aria-label={t("units.delete")}
                            onPress={() => deleteUnit.mutateAsync(u.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-default-400" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {commitError && !commitTarget && (
        <p className="text-xs font-semibold text-danger">{commitError}</p>
      )}

      <UnitFormModal
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        projectId={project.id}
        unit={editing}
      />

      {/* Commitment modal: record the buyer when reserving / selling a unit. */}
      <Modal isOpen={!!commitTarget} onOpenChange={(o) => !o && setCommitTarget(null)}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {commitTarget
                  ? t(
                      commitTarget.to === "sold"
                        ? "units.commitSellTitle"
                        : "units.commitReserveTitle"
                    )
                  : ""}
              </ModalHeader>
              <ModalBody className="gap-3">
                {commitTarget && (
                  <p className="text-sm text-default-500">
                    {t("units.commitFor", { code: commitTarget.unit.code })}
                  </p>
                )}
                <Select
                  {...selectFieldProps()}
                  label={t("units.buyer")}
                  placeholder={t("units.noBuyer")}
                  selectedKeys={commitBuyer ? [commitBuyer] : []}
                  onSelectionChange={(keys) => {
                    const v = Array.from(keys)[0] as string | undefined;
                    setCommitBuyer(v ?? "");
                  }}
                >
                  {[
                    { id: "", label: t("units.noBuyer") },
                    ...contacts.map((c) => ({ id: c.id, label: contactDisplayName(c) })),
                  ].map((o) => (
                    <SelectItem key={o.id} textValue={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </Select>
                <Textarea
                  label={t("units.commitNote")}
                  value={commitNote}
                  onValueChange={setCommitNote}
                  minRows={2}
                />
                {commitError && (
                  <p className="text-xs font-semibold text-danger">{commitError}</p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("form.cancel")}
                </Button>
                <Button
                  color={commitTarget?.to === "sold" ? "success" : "warning"}
                  isLoading={changeStatus.isPending}
                  onPress={submitCommit}
                >
                  {t("form.save")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
