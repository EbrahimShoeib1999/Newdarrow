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
} from "lucide-react";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { FieldBox } from "@/components/shared/field-box";
import { useDealQuery, useUpdateDealMutation } from "../hooks/use-deals";
import { useContactQuery } from "../hooks/use-contacts";
import { useContractsQuery } from "../hooks/use-contracts";
import { useCrmPermissions } from "../hooks/use-crm-permissions";
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
  const { t } = useTranslation("crm");
  const navigate = useNavigate();
  const { canManageDeals } = useCrmPermissions();
  const { data: dealRes, isLoading } = useDealQuery(dealId);
  const contactId = dealRes?.data.contactId ?? "";
  const { data: contactRes } = useContactQuery(contactId);
  const { data: users } = useAllUsers();
  const updateDeal = useUpdateDealMutation();
  const [editOpen, setEditOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");

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
  const primaryContactPerson = contact?.associatedContacts?.find((cp) => cp.isPrimary);

  const handleOpenSmartAssignment = (task: Task) => {
    setSelectedTaskForAssignment(task);
    setAssignmentModalOpen(true);
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
              <Chip color={DEAL_STAGE_COLORS[deal.stage]} variant="flat" size="md">
                {t(`deals.stage.${deal.stage}`)}
              </Chip>
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  color="primary"
                  variant="solid"
                  startContent={<FileSignature className="h-4 w-4" />}
                  className="rounded-full font-bold shadow-sm shadow-primary/20"
                  onPress={() =>
                    navigate(
                      `/crm/contracts?dealId=${deal.id}&contactId=${deal.contactId || ""}&amount=${
                        deal.amount
                      }&title=${encodeURIComponent(deal.title)}`
                    )
                  }
                >
                  {dealContracts.length > 0 ? "إنشاء عقد إضافي" : "صياغة عقد للصفقة"}
                </Button>
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
                  onStageClick={(s: DealStage) =>
                    updateDeal.mutate({ id: deal.id, data: { stage: s } })
                  }
                />
              ) : undefined
            }
            smartButtons={
              <CrmSmartButtons
                items={[
                  {
                    key: "contracts",
                    label: "العقود المرتبطة",
                    count: dealContracts.length,
                    icon: FileSignature,
                  },
                  {
                    key: "delivery",
                    label: "مهام التسليم",
                    count: totalDeliveryTasks,
                    icon: Workflow,
                  },
                  {
                    key: "tasks",
                    label: t("dealDetail.tabs.tasks"),
                    count: crmTasks.length,
                    icon: ListTodo,
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
            {/* Commercial Overview Card */}
            <Card className="border border-default-200 shadow-sm rounded-3xl">
              <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5">
                <FieldBox label={t("deals.form.title")} icon={<Briefcase className="h-3.5 w-3.5" />}>
                  {deal.title}
                </FieldBox>
                <FieldBox label={t("deals.form.amount")} icon={<DollarSign className="h-3.5 w-3.5" />}>
                  <MoneyAmount amount={deal.amount} />
                </FieldBox>
                <FieldBox label={t("deals.form.contact")} icon={<User className="h-3.5 w-3.5" />}>
                  {contact ? (
                    <div className="flex flex-col gap-1">
                      <Link
                        to={`/crm/contacts/${contact.id}`}
                        className="text-primary font-bold hover:underline flex items-center gap-1.5"
                      >
                        {contactDisplayName(contact)}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      {contact.phone && (
                        <span className="text-xs text-default-400 font-mono">{contact.phone}</span>
                      )}
                    </div>
                  ) : (
                    "—"
                  )}
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
                    label={t("deals.form.lead") || "العميل المحتمل"}
                    icon={<Workflow className="h-3.5 w-3.5" />}
                  >
                    <Link
                      to={`/crm/leads/${deal.leadId}`}
                      className="text-primary font-bold hover:underline flex items-center gap-1"
                    >
                      عرض العميل المحتمل المرتبط
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </FieldBox>
                )}
                {primaryContactPerson && (
                  <FieldBox label="جهة التواصل الرئيسية" icon={<User className="h-3.5 w-3.5" />}>
                    <div className="text-xs space-y-1">
                      <span className="font-semibold text-foreground">
                        {primaryContactPerson.name} ({primaryContactPerson.jobTitle || "مسؤول"})
                      </span>
                      {primaryContactPerson.phone && (
                        <div className="flex items-center gap-1 text-default-400">
                          <Phone className="h-3 w-3" />
                          <span className="font-mono">{primaryContactPerson.phone}</span>
                        </div>
                      )}
                      {primaryContactPerson.email && (
                        <div className="flex items-center gap-1 text-default-400">
                          <Mail className="h-3 w-3" />
                          <span>{primaryContactPerson.email}</span>
                        </div>
                      )}
                    </div>
                  </FieldBox>
                )}
              </CardBody>
            </Card>

            {/* Contracts & Approval Lifecycle Card */}
            <Card className="border border-default-200 shadow-sm rounded-3xl">
              <CardBody className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSignature className="h-5 w-5 text-primary" />
                    <div>
                      <h3 className="font-bold text-sm text-foreground">
                        العقود المبرمة وحالة الاعتماد ({dealContracts.length})
                      </h3>
                      <p className="text-xs text-default-400">
                        سجل العقود القانونية والتجارية المرتبطة بهذه الصفقة
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="font-bold rounded-xl"
                    onPress={() =>
                      navigate(
                        `/crm/contracts?dealId=${deal.id}&contactId=${deal.contactId || ""}&amount=${
                          deal.amount
                        }&title=${encodeURIComponent(deal.title)}`
                      )
                    }
                  >
                    + إنشاء عقد جديد
                  </Button>
                </div>

                {dealContracts.length === 0 ? (
                  <div className="p-6 text-center bg-default-50/60 border border-dashed border-default-200 rounded-2xl">
                    <FileSignature className="h-8 w-8 text-default-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-default-600">
                      لا يوجد عقد مسجل لهذه الصفقة حتى الآن
                    </p>
                    <p className="text-xs text-default-400 mt-1">
                      يمكنك صياغة عقد جديد من بيانات الصفقة وتحويل بنود خدماته مباشرة إلى مهام
                      تنفيذية للأقسام
                    </p>
                    <Button
                      size="sm"
                      color="primary"
                      className="mt-3 font-bold rounded-xl"
                      onPress={() =>
                        navigate(
                          `/crm/contracts?dealId=${deal.id}&contactId=${
                            deal.contactId || ""
                          }&amount=${deal.amount}&title=${encodeURIComponent(deal.title)}`
                        )
                      }
                    >
                      صياغة العقد الآن
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {dealContracts.map((c) => (
                      <div
                        key={c.id}
                        className="p-4 bg-default-50 rounded-2xl border border-default-200 hover:border-primary/40 transition-all flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-mono text-xs font-bold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                              #{c.form?.contractNumber || "مسودة"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <Chip
                                size="sm"
                                color={c.status === "final" ? "success" : "warning"}
                                variant="flat"
                                className="font-bold text-[10px]"
                              >
                                {c.status === "final" ? "معتمد" : "مسودة / قيد المراجعة"}
                              </Chip>
                              {c.convertedToTasks && (
                                <Chip
                                  size="sm"
                                  color="secondary"
                                  variant="flat"
                                  className="font-bold text-[10px]"
                                >
                                  مرحّل لمهام الأقسام
                                </Chip>
                              )}
                            </div>
                          </div>
                          <h4 className="font-bold text-sm text-foreground line-clamp-1">{c.title}</h4>
                          <p className="text-xs text-default-500 mt-1">
                            تاريخ العقد: {c.form?.contractDateIso || "—"} • بنود الخدمات:{" "}
                            {c.form?.services?.length || 0}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-default-200/70 flex items-center justify-between">
                          <span className="text-xs font-mono font-bold text-default-700">
                            {c.form?.fields?.find((f) => f.key === "amountInclVat")?.value
                              ? `${c.form.fields.find((f) => f.key === "amountInclVat")?.value} ر.س`
                              : "—"}
                          </span>
                          <Button
                            size="sm"
                            variant="light"
                            color="primary"
                            className="font-bold text-xs h-7"
                            onPress={() => navigate(`/crm/contracts?id=${c.id}&dealId=${deal.id}`)}
                          >
                            فتح في محرر العقود ←
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Operational Delivery Tasks Workspace Card */}
            <Card className="border border-default-200 shadow-sm rounded-3xl">
              <CardBody className="p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-5 w-5 text-emerald-600" />
                    <div>
                      <h3 className="font-bold text-sm text-foreground">
                        مهام التنفيذ والتسليمات للأقسام ({totalDeliveryTasks})
                      </h3>
                      <p className="text-xs text-default-400">
                        المهام التشغيلية المتولدة من بنود العقد والموزعة على أقسام الشركة
                      </p>
                    </div>
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
                      فتح لوحة كانبان والمهام العامة ←
                    </Button>
                  )}
                </div>

                {/* Progress & Metrics Dashboard */}
                {totalDeliveryTasks > 0 && (
                  <div className="space-y-3 p-4 bg-default-50/70 rounded-2xl border border-default-100">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-default-600">نسبة الإنجاز الكلية للتسليم:</span>
                      <span className="text-primary font-mono">{progressPercentage}%</span>
                    </div>
                    <Progress
                      value={progressPercentage}
                      color="primary"
                      size="sm"
                      className="rounded-full"
                    />

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                      <div className="p-2.5 rounded-xl bg-background border border-default-200">
                        <span className="text-default-400 block text-[11px]">الإجمالي</span>
                        <span className="font-bold text-sm text-foreground">{totalDeliveryTasks} مهام</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-background border border-default-200">
                        <span className="text-default-400 block text-[11px]">قيد التنفيذ</span>
                        <span className="font-bold text-sm text-warning-600">{inProgressTasks}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-background border border-default-200">
                        <span className="text-default-400 block text-[11px]">مكتملة</span>
                        <span className="font-bold text-sm text-emerald-600">{completedTasks}</span>
                      </div>
                      <div
                        className={`p-2.5 rounded-xl bg-background border ${
                          unassignedTasks > 0 ? "border-amber-300 dark:border-amber-800" : "border-default-200"
                        }`}
                      >
                        <span className="text-default-400 block text-[11px]">بانتظار التعيين</span>
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
                  <div className="p-6 text-center bg-default-50/40 border border-dashed border-default-200 rounded-2xl">
                    <Workflow className="h-8 w-8 text-default-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-default-600">
                      لم يتم إنشاء مهام تسليم تشغيلية لهذه الصفقة بعد
                    </p>
                    <p className="text-xs text-default-400 mt-1">
                      عند اعتماد العقد، يمكنك الضغط على زر &quot;ترحيل بنود الخدمات إلى مهام
                      الأقسام&quot; في محرر العقد لتوليد مهام الأقسام تلقائياً.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deliveryTasks.map((tItem) => {
                      const assigneeUser = users?.find((u) => u.id === tItem.assigneeId);
                      const isUnassigned = !tItem.assigneeId;

                      return (
                        <div
                          key={tItem.id}
                          className="p-3.5 rounded-2xl border border-default-200 bg-background hover:bg-default-50/60 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground">{tItem.title}</span>
                              {tItem.type === "subtask" && (
                                <Chip size="sm" variant="flat" className="h-5 text-[10px]">
                                  فرعية
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
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-default-400">
                              {tItem.department && (
                                <span className="text-primary font-semibold">
                                  القسم: {tItem.department}
                                </span>
                              )}
                              {tItem.estimatedHours ? (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {tItem.estimatedHours} س
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

                          <div className="flex items-center gap-2.5 self-end md:self-auto">
                            {/* Assignee status or smart assign trigger */}
                            {isUnassigned ? (
                              <Button
                                size="sm"
                                color="warning"
                                variant="flat"
                                startContent={<Sparkles className="h-3.5 w-3.5" />}
                                className="font-bold text-xs rounded-xl h-8"
                                onPress={() => handleOpenSmartAssignment(tItem)}
                              >
                                تعيين ذكي
                              </Button>
                            ) : (
                              <div
                                className="flex items-center gap-2 cursor-pointer p-1 rounded-xl hover:bg-default-100"
                                onClick={() => handleOpenSmartAssignment(tItem)}
                                title="اضغط لإعادة التعيين"
                              >
                                <Avatar
                                  size="sm"
                                  src={assigneeUser?.avatar}
                                  name={assigneeUser?.name}
                                  className="h-6 w-6 text-xs"
                                />
                                <span className="text-xs font-semibold text-foreground">
                                  {assigneeUser?.name || "موظف"}
                                </span>
                              </div>
                            )}

                            <Button
                              size="sm"
                              variant="light"
                              color="primary"
                              className="font-bold text-xs h-8"
                              as={Link}
                              to={`/tasks?selected=${tItem.id}`}
                            >
                              عرض المهمة ←
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Quick Follow-up CRM Tasks Card */}
            <Card className="border border-default-200 shadow-sm rounded-3xl">
              <CardBody className="p-5 space-y-3">
                <h3 className="font-bold text-sm flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-primary" />
                  ملاحظات ومتابعات الـ CRM السريعة ({crmTasks.length})
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
                      className="rounded-full font-bold"
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
                  <p className="text-xs text-default-400">{t("dealDetail.tasks.empty")}</p>
                ) : (
                  <ul className="space-y-2">
                    {crmTasks.map((t) => (
                      <li
                        key={t.id}
                        className="flex justify-between items-center p-2.5 rounded-xl bg-default-50 text-sm border border-default-100"
                      >
                        <span className="font-medium text-xs">{t.title}</span>
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
