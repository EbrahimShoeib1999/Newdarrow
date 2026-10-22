import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Progress,
  Avatar,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  Briefcase,
  Calendar,
  DollarSign,
  Pencil,
  ListTodo,
  StickyNote,
  Paperclip,
  User,
  FileSignature,
  Workflow,
  ArrowUpRight,
  Sparkles,
  Phone,
  Mail,
  Clock,
  MessageSquare,
  Plus,
  ReceiptText,
  FolderKanban,
} from "lucide-react";
import { toast } from "sonner";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { FieldBox } from "@/components/shared/field-box";
import { useDealQuery, useUpdateDealMutation } from "../hooks/use-deals";
import { useContactQuery } from "../hooks/use-contacts";
import { useContractsQuery } from "../hooks/use-contracts";
import { useCrmPermissions } from "../hooks/use-crm-permissions";
import { useCreateProjectFromContractMutation, useProjects } from "@/features/projects/hooks/use-projects";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useProjectT } from "@/features/projects/hooks/use-project-terminology";
import {
  useCrmEntityActivities,
  useCrmEntityAttachments,
  useCrmEntityNotes,
  useCrmEntityTasks,
  useCreateCrmNoteMutation,
  useCreateCrmActivityMutation,
  useCreateCrmTaskMutation,
  useUploadCrmAttachmentMutation,
  useDeleteCrmAttachmentMutation,
} from "../hooks/use-crm-entity-data";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { SmartTaskAssignmentModal } from "@/features/tasks/components/SmartTaskAssignmentModal";
import type { Task } from "@/features/tasks/types/task.types";
import { DealFormModal } from "../components/DealFormModal";
import { CrmChatter } from "../components/shared/CrmChatter";
import { DEAL_STAGES, DEAL_STAGE_COLORS, normalizeDealProbability } from "../constants/deal-workflow";
import { contactDisplayName } from "../utils/contacts-list.utils";
import { CrmRecordLayout, CrmRecordHeader } from "../components/CrmRecordLayout";
import { CrmStageBar } from "../components/CrmStageBar";
import { CrmSmartButtons } from "../components/CrmSmartButtons";
import { formatDate } from "@/lib/utils";
import { MoneyAmount } from "@/components/shared/riyal-symbol";
import { normalizeCrmTaskStatus } from "../constants/crm-task.constants";
import type { DealStage } from "../types/deals.types";
import type { ActivityType } from "../types/activities.types";

export function DealDetailPage() {
  const { dealId = "" } = useParams();
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const navigate = useNavigate();
  const { canManageDeals } = useCrmPermissions();
  const { data: dealRes, isLoading } = useDealQuery(dealId);
  const contactId = dealRes?.data.contactId ?? "";
  const { data: contactRes } = useContactQuery(contactId);
  const { data: users } = useAllUsers();
  const updateDeal = useUpdateDealMutation();
  const [editOpen, setEditOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [activeTab, setActiveTab] = useState<string>("overview");

  // Smart Assignment modal state
  const [selectedTaskForAssignment, setSelectedTaskForAssignment] = useState<Task | null>(null);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);

  // CRM Chatter Sub-collections
  const { data: notes = [] } = useCrmEntityNotes("deal", dealId);
  const { data: activities = [] } = useCrmEntityActivities("deal", dealId);
  const { data: crmTasks = [] } = useCrmEntityTasks("deal", dealId);
  const { data: attachments = [] } = useCrmEntityAttachments("deal", dealId);

  const createNote = useCreateCrmNoteMutation("deal", dealId);
  const createActivity = useCreateCrmActivityMutation("deal", dealId);
  const createCrmTask = useCreateCrmTaskMutation("deal", dealId);
  const uploadAttachment = useUploadCrmAttachmentMutation("deal", dealId);
  const deleteAttachment = useDeleteCrmAttachmentMutation("deal", dealId);

  // Contracts linked to this deal
  const { data: contractsRes } = useContractsQuery();
  const createProjectFromContract = useCreateProjectFromContractMutation();
  const { t: tProjects } = useProjectT();
  const dealContracts = useMemo(
    () =>
      (contractsRes?.data ?? []).filter(
        (c) => c.dealId === dealId || c.form?.dealId === dealId
      ),
    [contractsRes?.data, dealId]
  );

  const dealContractIds = useMemo(
    () => new Set(dealContracts.map((c) => c.id)),
    [dealContracts]
  );

  // Projects created from this deal (reverse reference — permission-gated).
  const { can: canApp } = useAppPermissions();
  const canViewProjects = canApp("projects.view");
  const { data: allProjects = [] } = useProjects();
  const dealProjects = useMemo(
    () => allProjects.filter((p) => p.dealId === dealId),
    [allProjects, dealId]
  );

  // Operational Delivery Tasks linked to this deal or its contracts
  const { data: allTasksData, isLoading: isLoadingDeliveryTasks } = useAllTasksQuery();
  const deliveryTasks = useMemo(() => {
    return (allTasksData?.data || []).filter(
      (task) =>
        task.dealId === dealId || (task.contractId && dealContractIds.has(task.contractId))
    );
  }, [allTasksData?.data, dealId, dealContractIds]);

  // Delivery task metrics
  const totalDeliveryTasks = deliveryTasks.length;
  const completedTasks = deliveryTasks.filter((t) => t.status === "done").length;
  const inProgressTasks = deliveryTasks.filter((t) => t.status === "in_progress").length;
  const unassignedTasks = deliveryTasks.filter((t) => !t.assigneeId).length;

  const progressPercentage =
    totalDeliveryTasks > 0 ? Math.round((completedTasks / totalDeliveryTasks) * 100) : 0;

  if (isLoading || !dealRes) return <LoadingSpinner />;
  const deal = dealRes.data;
  const contact = deal.contactId && contactRes ? contactRes.data : null;
  const assignee = users?.find((u) => u.id === deal.assignedTo);

  // Primary contact person if available
  const primaryContactPerson = contact?.associatedContacts?.find((cp) => cp.isPrimary) || contact?.associatedContacts?.[0];

  const handleOpenSmartAssignment = (task: Task) => {
    setSelectedTaskForAssignment(task);
    setAssignmentModalOpen(true);
  };

  // Won-deal workflow: promote the stage, then initiate contract creation
  // automatically — the event is journaled on the deal's activity timeline.
  // Drafting itself stays one intentional click (no fabricated contract).
  const handleStageChange = (s: DealStage) => {
    updateDeal.mutate({ id: deal.id, data: { stage: s } });
    if (s === "won" && deal.stage !== "won") {
      createActivity.mutate({
        type: "note",
        subject: isAr ? "الصفقة مغلقة-ناجحة" : "Deal won",
        description: isAr
          ? "تم رصد نجاح الصفقة — يجب الآن الشروع في إعداد العقد لربط الصفقة بالعقد."
          : "Won stage recorded — initiate the contract workflow to link this deal to its contract.",
      });
    }
  };

  return (
    <>
      <CrmRecordLayout
        header={
          <CrmRecordHeader
            breadcrumbs={[
              { label: "CRM", href: "/crm" },
              { label: t("nav.deals"), href: "/crm/deals" },
              { label: deal.title },
            ]}
            title={deal.title}
            subtitle={<MoneyAmount amount={deal.amount} />}
            badge={
              <Chip color={DEAL_STAGE_COLORS[deal.stage]} variant="flat" size="md" className="font-bold">
                {t(`deals.stage.${deal.stage}`)}
              </Chip>
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  color="primary"
                  variant="solid"
                  startContent={<FileSignature className="h-4 w-4" />}
                  className="rounded-full font-bold shadow-md shadow-primary/20 transition-all hover:scale-[1.02]"
                  onPress={() =>
                    navigate(
                      `/crm/contracts?dealId=${deal.id}&contactId=${deal.contactId || ""}&amount=${
                        deal.amount
                      }&title=${encodeURIComponent(deal.title)}`
                    )
                  }
                >
                  {dealContracts.length > 0 ? (isAr ? "إنشاء عقد إضافي" : "Add Contract") : (isAr ? "صياغة عقد للصفقة" : "Draft Contract")}
                </Button>
                {deal.stage === "won" && (
                  <Button
                    color="secondary"
                    variant="solid"
                    startContent={<ReceiptText className="h-4 w-4" />}
                    className="rounded-full font-bold shadow-md shadow-secondary/20 transition-all hover:scale-[1.02]"
                    onPress={() => {
                      if (dealContracts.length > 0) {
                        // If deal has contracts, navigate to contract invoice flow
                        navigate(`/crm/contracts?id=${dealContracts[0].id}`);
                      } else {
                        // If no contract, create invoice directly from deal
                        navigate("/billing/invoices/new", {
                          state: {
                            fromDeal: {
                              dealId: deal.id,
                              contactId: deal.contactId,
                              amount: deal.amount,
                              currency: deal.currency,
                              title: deal.title,
                            },
                          },
                        });
                      }
                    }}
                  >
                    {isAr ? "إصدار فاتورة" : "Create Invoice"}
                  </Button>
                )}
                {deal.stage === "won" && dealContracts.some((c) => c.approvalStatus === "approved") && (
                  <Button
                    color="primary"
                    variant="bordered"
                    startContent={<FolderKanban className="h-4 w-4" />}
                    className="rounded-full font-bold"
                    isLoading={createProjectFromContract.isPending}
                    onPress={async () => {
                      // Lifecycle: project is created only from an approved contract of this deal.
                      const approved = dealContracts.find((c) => c.approvalStatus === "approved")!;
                      try {
                        const res = await createProjectFromContract.mutateAsync({ contract: approved });
                        const created = res as typeof res & { alreadyExisted?: boolean };
                        if (created?.id) {
                          toast.success(
                            created.alreadyExisted
                              ? tProjects("toast.alreadyConverted")
                              : tProjects("toast.converted")
                          );
                          navigate(`/projects/${created.id}`);
                        }
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : tProjects("toast.createFailed"));
                      }
                    }}
                  >
                    {tProjects("add")}
                  </Button>
                )}
                {canManageDeals && (
                  <Button
                    color="default"
                    variant="flat"
                    startContent={<Pencil className="h-4 w-4" />}
                    className="rounded-full font-bold"
                    onPress={() => setEditOpen(true)}
                  >
                    {t("dealDetail.edit")}
                  </Button>
                )}
              </div>
            }
            stageBar={
              canManageDeals ? (
                <CrmStageBar
                  stages={DEAL_STAGES}
                  current={deal.stage}
                  terminalStages={["won", "lost"]}
                  labelKey={(s) => t(`deals.stage.${s}`)}
                  onStageClick={handleStageChange}
                />
              ) : undefined
            }
            smartButtons={
              <CrmSmartButtons
                items={[
                  {
                    key: "contracts",
                    label: isAr ? "العقود" : "Contracts",
                    count: dealContracts.length,
                    icon: FileSignature,
                    onPress: () => setActiveTab("contracts"),
                  },
                  {
                    key: "delivery",
                    label: isAr ? "التسليمات" : "Delivery",
                    count: totalDeliveryTasks,
                    icon: Workflow,
                    onPress: () => setActiveTab("delivery"),
                  },
                  {
                    key: "tasks",
                    label: t("dealDetail.tabs.tasks"),
                    count: crmTasks.length,
                    icon: ListTodo,
                    onPress: () => setActiveTab("tasks"),
                  },
                  {
                    key: "notes",
                    label: t("dealDetail.tabs.notes"),
                    count: notes.length,
                    icon: StickyNote,
                  },
                  {
                    key: "files",
                    label: t("dealDetail.tabs.attachments"),
                    count: attachments.length,
                    icon: Paperclip,
                  },
                ]}
              />
            }
          />
        }
        main={
          <div className="space-y-6">
            {/* Top KPI Metrics Deck */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 rounded-3xl bg-content1 border border-default-200/80 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-bold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-primary" />
                  {isAr ? "القيمة المالية" : "Deal Value"}
                </span>
                <div className="mt-2">
                  <div className="text-xl font-black text-foreground">
                    <MoneyAmount amount={deal.amount} />
                  </div>
                  <span className="text-[11px] text-default-400 font-medium mt-0.5 block">
                    {deal.currency || "SAR"}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-content1 border border-default-200/80 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-bold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {isAr ? "احتمالية النجاح" : "Win Probability"}
                </span>
                <div className="mt-2">
                  <div className="text-xl font-black text-foreground flex items-center gap-2">
                    {normalizeDealProbability(deal.probability) * 10}%
                    <Chip size="sm" variant="flat" color="warning" className="h-5 text-[10px] font-bold">
                      {normalizeDealProbability(deal.probability)}/10
                    </Chip>
                  </div>
                  <span className="text-[11px] text-default-400 font-medium mt-0.5 block">
                    {t(`deals.stage.${deal.stage}`)}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-content1 border border-default-200/80 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-bold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-blue-500" />
                  {isAr ? "الإغلاق المتوقع" : "Expected Close"}
                </span>
                <div className="mt-2">
                  <div className="text-sm font-bold text-foreground">
                    {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}
                  </div>
                  <span className="text-[11px] text-default-400 font-medium mt-0.5 block truncate">
                    {assignee?.name || (isAr ? "غير معين" : "Unassigned")}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-3xl bg-content1 border border-default-200/80 shadow-sm flex flex-col justify-between">
                <span className="text-[11px] font-bold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Workflow className="h-3.5 w-3.5 text-emerald-500" />
                  {isAr ? "جاهزية التسليم" : "Delivery Ready"}
                </span>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-sm font-bold mb-1">
                    <span className="text-foreground">{completedTasks}/{totalDeliveryTasks}</span>
                    <span className="text-primary font-mono text-xs">{progressPercentage}%</span>
                  </div>
                  <Progress
                    value={progressPercentage}
                    color="primary"
                    size="sm"
                    className="rounded-full"
                  />
                </div>
              </div>
            </div>

            {/* Main Tabs Workspace */}
            <Tabs
              selectedKey={activeTab}
              onSelectionChange={(k: any) => setActiveTab(String(k))}
              variant="underlined"
              classNames={{
                tabList: "gap-6 border-b border-default-200/70 p-0",
                cursor: "w-full bg-primary h-[2.5px] rounded-full",
                tab: "max-w-fit px-1 h-12 text-sm font-bold",
              }}
            >
              {/* Tab 1: Overview & Scope */}
              <Tab
                key="overview"
                title={
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    {isAr ? "البيانات التجارية ونطاق العمل" : "Commercial & Overview"}
                  </span>
                }
              >
                <div className="space-y-4 pt-4">
                  {/* Won-but-no-contract prompt — the deal→contract workflow
                      stays obvious and idempotent: it disappears the moment
                      a contract is linked to this deal. */}
                  {deal.stage === "won" && dealContracts.length === 0 && (
                    <Card className="border-warning/40 bg-warning/5 rounded-2xl">
                      <CardBody className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4">
                        <div className="flex items-start gap-3">
                          <FileSignature className="h-5 w-5 text-warning mt-0.5" />
                          <div>
                            <p className="text-sm font-bold text-default-800">
                              {isAr ? "الصفقة ناجحة — لم يتم ربط أي عقد بعد" : "Deal won — no contract linked yet"}
                            </p>
                            <p className="text-xs text-default-500 mt-0.5">
                              {isAr
                                ? "ابدأ الآن بإعداد العقد المتضمن لنطاق العمل والتكلفة؛ ستظهر المهام والمراحل بعد اعتماده وتحويله لمشروع."
                                : "Draft the contract now to capture scope and value — tasks and milestones follow once it is approved and converted."}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          color="warning"
                          variant="solid"
                          className="rounded-full font-bold shrink-0"
                          startContent={<FileSignature className="h-4 w-4" />}
                          onPress={() =>
                            navigate(
                              `/crm/contracts?dealId=${deal.id}&contactId=${deal.contactId || ""}&amount=${
                                deal.amount
                              }&title=${encodeURIComponent(deal.title)}`
                            )
                          }
                        >
                          {isAr ? "إعداد العقد الآن" : "Draft contract now"}
                        </Button>
                      </CardBody>
                    </Card>
                  )}
                  {/* Customer 360 Card */}
                  {contact ? (
                    <Card className="border border-default-200/80 shadow-sm rounded-3xl bg-gradient-to-br from-default-50/50 to-background">
                      <CardBody className="p-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-start gap-3.5">
                            <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                              <User className="h-6 w-6" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link
                                  to={`/crm/contacts/${contact.id}`}
                                  className="text-base font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1"
                                >
                                  {contactDisplayName(contact)}
                                  <ArrowUpRight className="h-4 w-4 text-primary" />
                                </Link>
                                {contact.entityType && (
                                  <Chip size="sm" variant="flat" color="primary" className="font-bold text-[10px]">
                                    {contact.entityType}
                                  </Chip>
                                )}
                              </div>
                              <p className="text-xs text-default-500">
                                {contact.accountName || contact.jobTitle || contact.email || (isAr ? "جهة اتصال مسجلة" : "Registered Contact")}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {contact.phone && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="primary"
                                startContent={<Phone className="h-3.5 w-3.5" />}
                                className="rounded-xl font-bold text-xs"
                                as="a"
                                href={`tel:${contact.phone}`}
                              >
                                {isAr ? "اتصال" : "Call"}
                              </Button>
                            )}
                            {(contact.whatsappPhone || contact.phone) && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="success"
                                startContent={<MessageSquare className="h-3.5 w-3.5" />}
                                className="rounded-xl font-bold text-xs"
                                as="a"
                                href={`https://wa.me/${(contact.whatsappPhone || contact.phone).replace(/\D/g, "")}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {isAr ? "واتساب" : "WhatsApp"}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="light"
                              color="primary"
                              className="rounded-xl font-bold text-xs"
                              as={Link}
                              to={`/crm/contacts/${contact.id}`}
                            >
                              {isAr ? "عرض ملف العميل 360 ←" : "Customer 360 →"}
                            </Button>
                          </div>
                        </div>

                        {/* Primary Contact Person if exists */}
                        {primaryContactPerson && (
                          <div className="mt-4 pt-3 border-t border-default-100 flex flex-wrap items-center justify-between gap-3 text-xs bg-default-100/40 p-3 rounded-2xl">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-default-500">{isAr ? "جهة التواصل الرئيسية:" : "Primary Contact:"}</span>
                              <span className="font-bold text-foreground">{primaryContactPerson.name}</span>
                              {primaryContactPerson.jobTitle && (
                                <span className="text-default-400">({primaryContactPerson.jobTitle})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-default-500 font-mono">
                              {primaryContactPerson.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {primaryContactPerson.phone}
                                </span>
                              )}
                              {primaryContactPerson.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {primaryContactPerson.email}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  ) : null}

                  {/* Commercial Scope Card */}
                  <Card className="border border-default-200/80 shadow-sm rounded-3xl">
                    <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                      <FieldBox label={t("deals.form.title")} icon={<Briefcase className="h-3.5 w-3.5" />}>
                        {deal.title}
                      </FieldBox>
                      <FieldBox label={t("deals.form.amount")} icon={<DollarSign className="h-3.5 w-3.5" />}>
                        <MoneyAmount amount={deal.amount} />
                      </FieldBox>
                      <FieldBox label={t("deals.form.assignedTo")}>
                        {assignee?.name ?? t("contacts.filters.unassigned")}
                      </FieldBox>
                      <FieldBox label={t("dealDetail.probability")}>
                        {normalizeDealProbability(deal.probability)}/10
                      </FieldBox>
                      <FieldBox
                        label={t("deals.form.expectedCloseDate")}
                        icon={<Calendar className="h-3.5 w-3.5" />}
                      >
                        {deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}
                      </FieldBox>
                      {deal.leadId && (
                        <FieldBox
                          label={t("deals.form.lead") || (isAr ? "العميل المحتمل" : "Lead")}
                          icon={<Workflow className="h-3.5 w-3.5" />}
                        >
                          <Link
                            to={`/crm/leads/${deal.leadId}`}
                            className="text-primary font-bold hover:underline flex items-center gap-1"
                          >
                            {isAr ? "عرض العميل المحتمل الأصلي" : "View Original Lead"}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        </FieldBox>
                      )}
                    </CardBody>
                  </Card>
                </div>
              </Tab>

              {/* Tab 2: Contracts & Legal */}
              <Tab
                key="contracts"
                title={
                  <span className="flex items-center gap-2">
                    <FileSignature className="h-4 w-4" />
                    {isAr ? "العقود والاتفاقيات" : "Contracts"} ({dealContracts.length})
                  </span>
                }
              >
                <div className="space-y-4 pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-default-50 p-4 rounded-3xl border border-default-200">
                    <div>
                      <h3 className="font-bold text-sm text-foreground">
                        {isAr ? "العقود المبرمة وحالة الاعتماد القانوني" : "Contracts & Legal Approvals"} ({dealContracts.length})
                      </h3>
                      <p className="text-xs text-default-500 mt-0.5">
                        {isAr
                          ? "سجل العقود المعتمدة والمسودات ونماذج التسعير الخاصة بهذه الصفقة"
                          : "Legal agreements, approved scopes, and signed quotes for this deal"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      color="primary"
                      className="font-bold rounded-2xl shadow-sm shadow-primary/20"
                      startContent={<Plus className="h-4 w-4" />}
                      onPress={() =>
                        navigate(
                          `/crm/contracts?dealId=${deal.id}&contactId=${deal.contactId || ""}&amount=${
                            deal.amount
                          }&title=${encodeURIComponent(deal.title)}`
                        )
                      }
                    >
                      {isAr ? "صياغة عقد جديد" : "New Contract"}
                    </Button>
                  </div>

                  {dealContracts.length === 0 ? (
                    <div className="p-8 text-center bg-content1 border border-dashed border-default-200 rounded-3xl space-y-3">
                      <FileSignature className="h-10 w-10 text-default-300 mx-auto" />
                      <div>
                        <p className="text-sm font-bold text-default-700">
                          {isAr ? "لا يوجد عقد مبرم لهذه الصفقة حتى الآن" : "No contract linked to this deal yet"}
                        </p>
                        <p className="text-xs text-default-400 mt-1 max-w-md mx-auto">
                          {isAr
                            ? "اضغط على زر صياغة عقد جديد لتحميل بيانات العميل والخدمات المتفق عليها تلقائياً، وصياغة البنود القانونية وتوليد مهام الأقسام."
                            : "Click New Contract to automatically import deal information, establish commercial terms, and generate department tasks."}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        color="primary"
                        className="font-bold rounded-2xl"
                        startContent={<Plus className="h-4 w-4" />}
                        onPress={() =>
                          navigate(
                            `/crm/contracts?dealId=${deal.id}&contactId=${
                              deal.contactId || ""
                            }&amount=${deal.amount}&title=${encodeURIComponent(deal.title)}`
                          )
                        }
                      >
                        {isAr ? "صياغة العقد الآن" : "Draft Contract Now"}
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {dealContracts.map((c) => (
                        <div
                          key={c.id}
                          className="p-5 bg-content1 rounded-3xl border border-default-200 hover:border-primary/50 shadow-sm transition-all flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <span className="font-mono text-xs font-bold text-primary px-2.5 py-1 rounded-xl bg-primary/10 border border-primary/20">
                                #{c.form?.contractNumber || "مسودة"}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Chip
                                  size="sm"
                                  color={c.status === "final" ? "success" : "warning"}
                                  variant="flat"
                                  className="font-bold text-[10px]"
                                >
                                  {c.status === "final" ? (isAr ? "معتمد" : "Approved") : (isAr ? "مسودة / مراجعة" : "Draft")}
                                </Chip>
                                {c.convertedToTasks && (
                                  <Chip
                                    size="sm"
                                    color="secondary"
                                    variant="flat"
                                    className="font-bold text-[10px]"
                                  >
                                    {isAr ? "مرحّل للمهام" : "Tasks Created"}
                                  </Chip>
                                )}
                              </div>
                            </div>
                            <h4 className="font-bold text-base text-foreground line-clamp-1">{c.title}</h4>
                            <p className="text-xs text-default-400 mt-1">
                              {isAr ? "تاريخ العقد:" : "Date:"} {c.form?.contractDateIso || "—"} • {isAr ? "بنود الخدمات:" : "Services:"}{" "}
                              {c.form?.services?.length || 0}
                            </p>
                          </div>

                          <div className="mt-5 pt-3.5 border-t border-default-100 flex items-center justify-between">
                            <span className="text-sm font-mono font-bold text-foreground">
                              {c.form?.fields?.find((f) => f.key === "amountInclVat")?.value
                                ? `${c.form.fields.find((f) => f.key === "amountInclVat")?.value} ر.س`
                                : "—"}
                            </span>
                            <Button
                              size="sm"
                              variant="light"
                              color="primary"
                              className="font-bold text-xs rounded-xl"
                              onPress={() => navigate(`/crm/contracts?id=${c.id}&dealId=${deal.id}`)}
                            >
                              {isAr ? "فتح في محرر العقود ←" : "Open in Builder →"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Tab>

              {canViewProjects && (
                <Tab
                  key="projects"
                  title={
                    <span className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4" />
                      {tProjects("title")} ({dealProjects.length})
                    </span>
                  }
                >
                  <div className="space-y-4 pt-4">
                    {dealProjects.length === 0 ? (
                      <div className="p-8 text-center bg-content1 border border-dashed border-default-200 rounded-3xl space-y-3">
                        <FolderKanban className="h-10 w-10 text-default-300 mx-auto" />
                        <p className="text-sm font-bold text-default-700">
                          {isAr
                            ? "لا يوجد " + tProjects("plural").toLowerCase() + " مرتبط بهذه الصفقة حتى الآن"
                            : `No ${tProjects("plural").toLowerCase()} linked to this deal yet`}
                        </p>
                        <p className="text-xs text-default-500 max-w-md mx-auto">
                          {isAr
                            ? "يُنشأ المشروع من العقد المعتمد بعد تحويل الصفقة إلى عقد"
                            : "Projects are created from the approved contract of this deal"}
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {dealProjects.map((p) => (
                          <div
                            key={p.id}
                            className="p-5 bg-content1 rounded-3xl border border-default-200 hover:border-primary/50 shadow-sm transition-all flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <span className="font-mono text-xs font-bold text-primary px-2.5 py-1 rounded-xl bg-primary/10 border border-primary/20">
                                  {p.code || p.id.slice(0, 8)}
                                </span>
                                <Chip size="sm" variant="flat" className="font-bold text-[10px]">
                                  {tProjects(`status.${p.status}`)}
                                </Chip>
                              </div>
                              <h4 className="font-bold text-base text-foreground line-clamp-1">{p.name}</h4>
                              <p className="text-xs text-default-400 mt-1">
                                {isAr ? "التسليم المتوقع:" : "Planned end:"} {p.endDate || "—"}
                              </p>
                            </div>
                            <div className="mt-5 pt-3.5 border-t border-default-100 flex justify-end">
                              <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                className="font-bold text-xs rounded-xl"
                                as={Link}
                                to={`/projects/${p.id}`}
                              >
                                {isAr ? "فتح المشروع ←" : `Open ${tProjects("singular")} →`}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Tab>
              )}

              {/* Tab 3: Delivery Tasks & Department Distribution */}
              <Tab
                key="delivery"
                title={
                  <span className="flex items-center gap-2">
                    <Workflow className="h-4 w-4" />
                    {isAr ? "مهام التسليم التشغيلية" : "Delivery Tasks"} ({totalDeliveryTasks})
                  </span>
                }
              >
                <div className="space-y-4 pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-default-50 p-4 rounded-3xl border border-default-200">
                    <div>
                      <h3 className="font-bold text-sm text-foreground">
                        {isAr ? "مهام التنفيذ والتسليمات للأقسام" : "Operational Delivery Tasks"} ({totalDeliveryTasks})
                      </h3>
                      <p className="text-xs text-default-500 mt-0.5">
                        {isAr
                          ? "المهام التشغيلية المتولدة من بنود العقد والموزعة على أقسام الشركة للتنفيذ"
                          : "Execution tasks generated from contract service items and distributed to departments"}
                      </p>
                    </div>
                    {totalDeliveryTasks > 0 && (
                      <Button
                        size="sm"
                        variant="light"
                        color="primary"
                        className="font-bold text-xs"
                        as={Link}
                        to="/tasks"
                      >
                        {isAr ? "لوحة كانبان والمهام العامة ←" : "Global Tasks Board →"}
                      </Button>
                    )}
                  </div>

                  {/* Delivery Metrics Deck */}
                  {totalDeliveryTasks > 0 && (
                    <div className="space-y-3 p-4 bg-content1 rounded-3xl border border-default-200/80 shadow-sm">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-default-600">{isAr ? "نسبة الإنجاز الكلية للتسليم:" : "Total Completion Rate:"}</span>
                        <span className="text-primary font-mono">{progressPercentage}%</span>
                      </div>
                      <Progress
                        value={progressPercentage}
                        color="primary"
                        size="sm"
                        className="rounded-full"
                      />

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                        <div className="p-3 rounded-2xl bg-default-50 border border-default-200/60">
                          <span className="text-default-400 block text-[11px]">{isAr ? "الإجمالي" : "Total"}</span>
                          <span className="font-bold text-sm text-foreground">{totalDeliveryTasks} {isAr ? "مهام" : "tasks"}</span>
                        </div>
                        <div className="p-3 rounded-2xl bg-default-50 border border-default-200/60">
                          <span className="text-default-400 block text-[11px]">{isAr ? "قيد التنفيذ" : "In Progress"}</span>
                          <span className="font-bold text-sm text-warning-600">{inProgressTasks}</span>
                        </div>
                        <div className="p-3 rounded-2xl bg-default-50 border border-default-200/60">
                          <span className="text-default-400 block text-[11px]">{isAr ? "مكتملة" : "Completed"}</span>
                          <span className="font-bold text-sm text-emerald-600">{completedTasks}</span>
                        </div>
                        <div
                          className={`p-3 rounded-2xl bg-default-50 border ${
                            unassignedTasks > 0 ? "border-amber-300 dark:border-amber-800" : "border-default-200/60"
                          }`}
                        >
                          <span className="text-default-400 block text-[11px]">{isAr ? "بانتظار التعيين" : "Awaiting Assignee"}</span>
                          <span
                            className={`font-bold text-sm ${
                              unassignedTasks > 0 ? "text-amber-600 font-bold" : "text-default-700"
                            }`}
                          >
                            {unassignedTasks}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tasks List */}
                  {isLoadingDeliveryTasks ? (
                    <LoadingSpinner />
                  ) : deliveryTasks.length === 0 ? (
                    <div className="p-8 text-center bg-content1 border border-dashed border-default-200 rounded-3xl space-y-2">
                      <Workflow className="h-10 w-10 text-default-300 mx-auto" />
                      <p className="text-sm font-bold text-default-700">
                        {isAr ? "لم يتم توليد مهام تسليم تشغيلية لهذه الصفقة بعد" : "No delivery tasks generated yet"}
                      </p>
                      <p className="text-xs text-default-400 max-w-md mx-auto">
                        {isAr
                          ? "عند اعتماد العقد، اضغط على زر ترحيل بنود الخدمات إلى مهام الأقسام لتوليد المهام التنفيذية للأقسام المختصة تلقائياً."
                          : "When finalizing a contract, convert its services to generate departmental tasks automatically."}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {deliveryTasks.map((tItem) => {
                        const assigneeUser = users?.find((u) => u.id === tItem.assigneeId);
                        const isUnassigned = !tItem.assigneeId;

                        return (
                          <div
                            key={tItem.id}
                            className="p-4 rounded-3xl border border-default-200/80 bg-content1 hover:bg-default-50/50 shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-3.5"
                          >
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-sm text-foreground">{tItem.title}</span>
                                {tItem.type === "subtask" && (
                                  <Chip size="sm" variant="flat" className="h-5 text-[10px] font-bold">
                                    {isAr ? "فرعية" : "Subtask"}
                                  </Chip>
                                )}
                                <Chip
                                  size="sm"
                                  variant="flat"
                                  color={
                                    tItem.status === "done"
                                      ? "success"
                                      : tItem.status === "in_progress"
                                      ? "warning"
                                      : "default"
                                  }
                                  className="h-5 text-[10px] font-bold"
                                >
                                  {tItem.status}
                                </Chip>
                                {tItem.department && (
                                  <Chip size="sm" variant="flat" color="primary" className="h-5 text-[10px] font-semibold">
                                    {tItem.department}
                                  </Chip>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-default-400">
                                {tItem.estimatedHours ? (
                                  <span className="flex items-center gap-1 font-mono">
                                    <Clock className="h-3 w-3" />
                                    {tItem.estimatedHours} س مقدرة
                                  </span>
                                ) : null}
                                {tItem.dueDate && (
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(tItem.dueDate)}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                              {/* Assignee status or smart assign trigger */}
                              {isUnassigned ? (
                                <Button
                                  size="sm"
                                  color="warning"
                                  variant="flat"
                                  startContent={<Sparkles className="h-3.5 w-3.5" />}
                                  className="font-bold text-xs rounded-2xl h-8 shadow-sm"
                                  onPress={() => handleOpenSmartAssignment(tItem)}
                                >
                                  {isAr ? "تعيين ذكي" : "Smart Assign"}
                                </Button>
                              ) : (
                                <div
                                  className="flex items-center gap-2 cursor-pointer p-1.5 rounded-2xl hover:bg-default-100 transition-colors border border-default-200/60"
                                  onClick={() => handleOpenSmartAssignment(tItem)}
                                  title={isAr ? "اضغط لإعادة التعيين الذكي" : "Click to reassign"}
                                >
                                  <Avatar
                                    size="sm"
                                    src={assigneeUser?.avatar}
                                    name={assigneeUser?.name}
                                    className="h-6 w-6 text-xs"
                                  />
                                  <span className="text-xs font-semibold text-foreground">
                                    {assigneeUser?.name || (isAr ? "موظف" : "Employee")}
                                  </span>
                                </div>
                              )}

                              <Button
                                size="sm"
                                variant="light"
                                color="primary"
                                className="font-bold text-xs h-8 rounded-2xl"
                                as={Link}
                                to={`/tasks?selected=${tItem.id}`}
                              >
                                {isAr ? "تفاصيل المهمة ←" : "Details →"}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Tab>

              {/* Tab 4: CRM Quick Tasks */}
              <Tab
                key="tasks"
                title={
                  <span className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4" />
                    {isAr ? "متابعات CRM السريعة" : "CRM Tasks"} ({crmTasks.length})
                  </span>
                }
              >
                <div className="space-y-4 pt-4">
                  <Card className="border border-default-200/80 shadow-sm rounded-3xl">
                    <CardBody className="p-5 space-y-4">
                      <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                        <ListTodo className="h-4 w-4 text-primary" />
                        {isAr ? "إضافة ملاحظة ومتابعة سريعة للصفقة" : "Quick CRM Follow-up"}
                      </h3>
                      {canManageDeals && (
                        <div className="flex gap-2">
                          <Input
                            size="sm"
                            className="flex-1"
                            placeholder={t("dealDetail.tasks.placeholder")}
                            value={taskTitle}
                            onValueChange={setTaskTitle}
                          />
                          <Button
                            size="sm"
                            color="primary"
                            className="rounded-full font-bold shadow-sm"
                            isDisabled={!taskTitle.trim()}
                            onPress={async () => {
                              await createCrmTask.mutateAsync({ title: taskTitle.trim() });
                              setTaskTitle("");
                            }}
                          >
                            {t("dealDetail.tasks.add")}
                          </Button>
                        </div>
                      )}
                      {crmTasks.length === 0 ? (
                        <p className="text-xs text-default-400 py-3 text-center">{t("dealDetail.tasks.empty")}</p>
                      ) : (
                        <ul className="space-y-2">
                          {crmTasks.map((t) => (
                            <li
                              key={t.id}
                              className="flex justify-between items-center p-3 rounded-2xl bg-default-50 text-sm border border-default-100"
                            >
                              <span className="font-medium text-xs text-foreground">{t.title}</span>
                              <Chip size="sm" variant="flat">
                                {normalizeCrmTaskStatus(t.status)}
                              </Chip>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardBody>
                  </Card>
                </div>
              </Tab>
            </Tabs>
          </div>
        }
        chatter={
          <CrmChatter
            notes={notes}
            activities={activities}
            attachments={attachments}
            canManage={canManageDeals}
            onLogNote={async (c) => {
              await createNote.mutateAsync(c);
            }}
            onLogActivity={async (type: ActivityType, subject, description) => {
              await createActivity.mutateAsync({ type, subject, description });
            }}
            onUpload={async (file) => {
              await uploadAttachment.mutateAsync(file);
            }}
            onDeleteAttachment={async (id) => {
              await deleteAttachment.mutateAsync(id);
            }}
          />
        }
      />

      <DealFormModal isOpen={editOpen} onOpenChange={setEditOpen} deal={deal} />

      {/* Smart Task Assignment Modal */}
      {selectedTaskForAssignment && (
        <SmartTaskAssignmentModal
          isOpen={assignmentModalOpen}
          onClose={() => {
            setAssignmentModalOpen(false);
            setSelectedTaskForAssignment(null);
          }}
          task={selectedTaskForAssignment}
        />
      )}
    </>
  );
}
