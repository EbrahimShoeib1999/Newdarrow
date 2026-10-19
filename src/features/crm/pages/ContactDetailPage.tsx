import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Tab,
  Tabs,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Progress,
  Avatar,
} from "@heroui/react";
import {
  ArrowLeft,
  Building2,
  Briefcase,
  Mail,
  Phone,
  Pencil,
  StickyNote,
  ListTodo,
  Paperclip,
  User,
  Users,
  Clock,
  CreditCard,
  FileText,
  Plus,
  FileSignature,
  Workflow,
  Globe,
  Share2,
  MapPin,
  ExternalLink,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { FieldBox } from "@/components/shared/field-box";
import { useContactQuery } from "../hooks/use-contacts";
import { useContractsQuery } from "../hooks/use-contracts";
import { useDealsQuery } from "../hooks/use-deals";
import { useCrmPermissions } from "../hooks/use-crm-permissions";
import { useContactClassifications } from "../hooks/use-contact-classifications";
import { useClientReportsQuery } from "../hooks/use-client-reports";
import { ClientReportEditorModal } from "../components/ClientReportEditorModal";
import { ClientReportDetailModal } from "../components/ClientReportDetailModal";
import type { ClientReport } from "../types/client-reports.types";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { SmartTaskAssignmentModal } from "@/features/tasks/components/SmartTaskAssignmentModal";
import type { Task } from "@/features/tasks/types/task.types";

import {
  useCrmEntityAttachments,
  useCrmEntityNotes,
  useCrmEntityTasks,
  useCreateCrmNoteMutation,
  useUpdateCrmNoteMutation,
  useDeleteCrmNoteMutation,
  useUploadCrmAttachmentMutation,
  useDeleteCrmAttachmentMutation,
} from "../hooks/use-crm-entity-data";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { ContactFormModal } from "../components/ContactFormModal";
import { CrmNotesSection } from "../components/shared/CrmNotesSection";
import { CrmAttachmentsSection } from "../components/shared/CrmAttachmentsSection";
import { UnifiedCustomerTimeline } from "../components/shared/UnifiedCustomerTimeline";
import { contactDisplayName } from "../utils/contacts-list.utils";
import { formatDate } from "@/lib/utils";
import { MoneyAmount } from "@/components/shared/riyal-symbol";
import { useInvoicesByCustomer } from "@/features/billing/hooks/use-invoices";
import { getInvoiceAmountDue } from "@/features/billing/utils/accounting-engine";
import { normalizeCrmTaskStatus } from "../constants/crm-task.constants";

export function ContactDetailPage() {
  const { contactId = "" } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { canManageContacts } = useCrmPermissions();
  const { classificationsMap } = useContactClassifications();
  const { data: contactRes, isLoading } = useContactQuery(contactId);
  const { data: dealsRes } = useDealsQuery();
  const { data: users } = useAllUsers();
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState("overview");

  const { data: notes = [], isLoading: notesLoading } = useCrmEntityNotes("contact", contactId);
  const { data: tasks = [], isLoading: tasksLoading } = useCrmEntityTasks("contact", contactId);
  const { data: attachments = [], isLoading: attachmentsLoading } = useCrmEntityAttachments(
    "contact",
    contactId
  );

  const createNote = useCreateCrmNoteMutation("contact", contactId);
  const updateNote = useUpdateCrmNoteMutation();
  const deleteNote = useDeleteCrmNoteMutation();
  const uploadAttachment = useUploadCrmAttachmentMutation("contact", contactId);
  const deleteAttachment = useDeleteCrmAttachmentMutation("contact", contactId);

  const { data: customerInvoices = [], isLoading: invoicesLoading } =
    useInvoicesByCustomer(contactId);

  const { data: clientReports = [], isLoading: reportsLoading } = useClientReportsQuery({ contactId });
  const [reportEditorOpen, setReportEditorOpen] = useState(false);
  const [selectedReportForView, setSelectedReportForView] = useState<ClientReport | null>(null);
  const [reportDetailOpen, setReportDetailOpen] = useState(false);

  const contactDeals = useMemo(
    () => (dealsRes?.data ?? []).filter((d) => d.contactId === contactId),
    [dealsRes?.data, contactId]
  );

  const { data: contractsRes, isLoading: contractsLoading } = useContractsQuery();
  const contactContracts = useMemo(
    () => (contractsRes?.data ?? []).filter((c) => c.contactId === contactId),
    [contractsRes?.data, contactId]
  );

  const [selectedTaskForAssignment, setSelectedTaskForAssignment] = useState<Task | null>(null);
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);

  const contactContractIds = useMemo(
    () => new Set(contactContracts.map((c) => c.id)),
    [contactContracts]
  );
  const contactDealIds = useMemo(
    () => new Set(contactDeals.map((d) => d.id)),
    [contactDeals]
  );

  const { data: allTasksData, isLoading: deliveryTasksLoading } = useAllTasksQuery();
  const deliveryTasks = useMemo(() => {
    return (allTasksData?.data || []).filter(
      (t) =>
        t.contactId === contactId ||
        (t.contractId && contactContractIds.has(t.contractId)) ||
        (t.dealId && contactDealIds.has(t.dealId))
    );
  }, [allTasksData?.data, contactId, contactContractIds, contactDealIds]);

  const totalDeliveryTasks = deliveryTasks.length;
  const completedDeliveryTasks = deliveryTasks.filter((t) => t.status === "done").length;
  const inProgressDeliveryTasks = deliveryTasks.filter((t) => t.status === "in_progress").length;
  const unassignedDeliveryTasks = deliveryTasks.filter((t) => !t.assigneeId).length;
  const deliveryProgress =
    totalDeliveryTasks > 0 ? Math.round((completedDeliveryTasks / totalDeliveryTasks) * 100) : 0;


  if (isLoading || !contactRes) return <LoadingSpinner />;
  const contact = contactRes.data;
  const name = contactDisplayName(contact);
  const assignee = users?.find((u) => u.id === contact.assignedTo);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-2">
        <Button
          isIconOnly
          variant="light"
          onPress={() => navigate("/crm/contacts")}
          aria-label={t("contactDetail.back")}
        >
          <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
        </Button>
        <PageHeader
          title={name}
          description={contact.accountName || contact.jobTitle || contact.email || t("contactDetail.noAccount")}
          actions={
            canManageContacts ? (
              <Button
                color="primary"
                variant="flat"
                startContent={<Pencil className="h-4 w-4" />}
                className="rounded-full font-bold"
                onPress={() => setEditOpen(true)}
              >
                {t("contactDetail.edit")}
              </Button>
            ) : undefined
          }
        />
      </div>

      <Card className="border border-default-100 shadow-sm rounded-3xl bg-default-50/50">
        <CardBody className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Entity Type */}
            {contact.entityType && (
              <Chip color="primary" variant="solid" size="sm" className="font-bold">
                {contact.entityType === "company" && "🏢 "}
                {contact.entityType === "establishment" && "🏬 "}
                {contact.entityType === "government" && "🏛️ "}
                {contact.entityType === "non_profit" && "🤝 "}
                {contact.entityType === "bank" && "🏦 "}
                {contact.entityType === "media" && "📻 "}
                {contact.entityType === "influencer" && "✨ "}
                {contact.entityType === "individual" && "👤 "}
                {t(`contacts.entityTypes.${contact.entityType}`, { defaultValue: contact.entityType })}
              </Chip>
            )}

            {/* Relationships */}
            {contact.relationships && contact.relationships.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {contact.relationships.map((rel) => (
                  <Chip key={rel} color="secondary" variant="flat" size="sm" className="font-bold">
                    {t(`contacts.relationships.${rel}`, { defaultValue: rel })}
                  </Chip>
                ))}
              </div>
            )}

            {/* Dynamic Classification */}
            {contact.classification && (() => {
              const def = classificationsMap[contact.classification];
              if (def) {
                const label = isAr ? def.nameAr : def.nameEn;
                const emoji = def.emoji || "🏷️";
                const color = (def.color as any) || "primary";
                return (
                  <Chip color={color} variant="flat" size="sm" className="font-bold border border-default-200">
                    {emoji} {label}
                  </Chip>
                );
              }
              const label = t(`contacts.classification.${contact.classification}`, { defaultValue: contact.classification });
              return (
                <Chip color="primary" variant="flat" size="sm" className="font-bold border border-primary-200">
                  🏷️ {label}
                </Chip>
              );
            })()}

            {/* Source */}
            {contact.source && (
              <Chip variant="bordered" size="sm" className="font-medium">
                <Globe className="h-3 w-3 inline me-1 text-default-400" />
                {t(`contacts.source.${contact.source}`, { defaultValue: contact.source })}
              </Chip>
            )}

            {/* Status */}
            {contact.status && (
              <Chip
                color={contact.status === "active" ? "success" : contact.status === "archived" ? "default" : "warning"}
                variant="dot"
                size="sm"
                className="font-bold"
              >
                {t(`contacts.status.${contact.status}`, { defaultValue: contact.status })}
              </Chip>
            )}

            {/* Satisfaction */}
            {contact.satisfaction === "satisfied" && (
              <Chip color="success" variant="dot" size="sm" className="font-bold">
                😊 {t("contacts.satisfaction.satisfied")}
              </Chip>
            )}
            {contact.satisfaction === "neutral" && (
              <Chip color="warning" variant="dot" size="sm" className="font-bold">
                😐 {t("contacts.satisfaction.neutral")}
              </Chip>
            )}
            {contact.satisfaction === "unsatisfied" && (
              <Chip color="danger" variant="dot" size="sm" className="font-bold">
                😞 {t("contacts.satisfaction.unsatisfied")}
              </Chip>
            )}

            {contact.jobTitle && (
              <Chip variant="flat" size="sm">
                {contact.jobTitle}
              </Chip>
            )}
            {contact.department && (
              <Chip variant="bordered" size="sm">
                {contact.department}
              </Chip>
            )}
            {contact.accountName && (
              <Chip variant="bordered" size="sm" startContent={<Building2 className="h-3 w-3" />}>
                {contact.accountName}
              </Chip>
            )}
            {contact.commercialRegister && (
              <Chip variant="flat" size="sm" color="primary">
                {t("contacts.form.commercialRegister")}: {contact.commercialRegister}
              </Chip>
            )}
            {contact.taxNumber && (
              <Chip variant="flat" size="sm" color="secondary">
                {t("contacts.form.taxNumber") || "Tax No"}: {contact.taxNumber}
              </Chip>
            )}
          </div>

          {/* Follow-up Employee Box */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-primary-50/70 dark:bg-primary-950/30 rounded-2xl border border-primary-200/50">
            <span className="text-xs text-default-500 font-medium">{t("contacts.columns.assigned")}:</span>
            {assignee ? (
              <span className="text-xs font-bold text-primary">{assignee.name}</span>
            ) : (
              <span className="text-xs text-default-400 italic">{t("contacts.filters.unassigned")}</span>
            )}
          </div>
        </CardBody>
      </Card>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(k: any) => setTab(k as string)}
        variant="underlined"
        classNames={{ tabList: "gap-4" }}
      >
        <Tab
          key="overview"
          title={
            <span className="flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {t("contactDetail.tabs.overview")}
            </span>
          }
        >
          <div className="space-y-4 pt-4">
            {/* Quick Contact Bar */}
            <div className="p-4 bg-default-50 rounded-3xl border border-default-200/70 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                {contact.phone && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-default-500 font-bold">{t("contacts.columns.phone")}:</span>
                    <span className="font-mono text-sm font-bold text-default-800">{contact.phone}</span>
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                      className="rounded-xl h-7"
                      as="a"
                      href={`tel:${contact.phone}`}
                    >
                      {t("contacts.directory.callNow")}
                    </Button>
                  </div>
                )}
                {contact.secondaryPhone && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-default-500 font-bold">{t("contacts.directory.secondaryPhone")}:</span>
                    <span className="font-mono text-sm font-semibold text-default-700">{contact.secondaryPhone}</span>
                    <Button
                      size="sm"
                      variant="light"
                      className="rounded-xl h-7 text-primary"
                      as="a"
                      href={`tel:${contact.secondaryPhone}`}
                    >
                      {t("contacts.directory.callNow")}
                    </Button>
                  </div>
                )}
                {(contact.whatsappPhone || contact.phone) && (
                  <Button
                    size="sm"
                    variant="flat"
                    color="success"
                    className="rounded-xl font-bold h-7"
                    as="a"
                    href={`https://wa.me/${(contact.whatsappPhone || contact.phone).replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("contacts.directory.whatsapp")}
                  </Button>
                )}
              </div>
            </div>

            {/* Client Interests */}
            {contact.interests && contact.interests.length > 0 && (
              <div className="p-4 bg-default-50/60 rounded-3xl border border-default-100 space-y-2">
                <span className="text-xs font-bold text-default-600 block">{t("contacts.form.interests")}:</span>
                <div className="flex flex-wrap gap-1.5">
                  {contact.interests.map((interest) => (
                    <Chip key={interest} size="sm" color="primary" variant="flat" className="font-medium">
                      ✦ {interest}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {/* Satisfaction notes */}
            {contact.satisfactionNotes && (
              <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-3xl border border-amber-200/50 space-y-1">
                <span className="text-xs font-bold text-amber-800 dark:text-amber-200">
                  {t("contacts.satisfaction.notes")}:
                </span>
                <p className="text-sm text-default-700">{contact.satisfactionNotes}</p>
              </div>
            )}

            {/* Entity-specific Information Grid */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-default-700 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                {isAr ? "البيانات الأساسية وتفاصيل الجهة" : "Entity Details & Identity"}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {contact.entityType === "individual" ? (
                  <>
                    <FieldBox label={t("contacts.form.firstName")}>{contact.firstName || "—"}</FieldBox>
                    <FieldBox label={t("contacts.form.fatherName")}>{contact.fatherName || "—"}</FieldBox>
                    <FieldBox label={t("contacts.form.lastName")}>{contact.lastName || "—"}</FieldBox>
                    <FieldBox label={t("contacts.form.nationalId")}>{contact.nationalId || "—"}</FieldBox>
                    <FieldBox label={t("contacts.form.nationality")}>{contact.nationality || "—"}</FieldBox>
                  </>
                ) : (
                  <>
                    <FieldBox label={t("contacts.form.accountName")} icon={<Building2 className="h-3.5 w-3.5" />}>
                      {contact.accountName || "—"}
                    </FieldBox>
                    {contact.legalName && (
                      <FieldBox label={t("contacts.form.legalName")}>{contact.legalName}</FieldBox>
                    )}
                    {contact.establishmentType && (
                      <FieldBox label={t("contacts.form.establishmentType")}>
                        {t(`contacts.establishmentTypes.${contact.establishmentType}`, { defaultValue: contact.establishmentType })}
                      </FieldBox>
                    )}
                    <FieldBox label={t("contacts.form.commercialRegister")}>
                      {contact.commercialRegister || "—"}
                    </FieldBox>
                    {(contact.crExpiryDate || contact.commercialRegisterExpiry) && (
                      <FieldBox label={t("contacts.form.crExpiryDate")}>{contact.crExpiryDate || contact.commercialRegisterExpiry}</FieldBox>
                    )}
                    {contact.unifiedNumber && (
                      <FieldBox label={t("contacts.form.unifiedNumber")}>{contact.unifiedNumber}</FieldBox>
                    )}
                    <FieldBox label={t("contacts.form.taxNumber") || "Tax Number"}>
                      {contact.taxNumber || "—"}
                    </FieldBox>
                    {contact.mainActivity && (
                      <FieldBox label={t("contacts.form.mainActivity")}>{contact.mainActivity}</FieldBox>
                    )}
                    {contact.branchesCount !== undefined && contact.branchesCount > 0 && (
                      <FieldBox label={t("contacts.form.branchesCount")}>{contact.branchesCount}</FieldBox>
                    )}
                  </>
                )}
                <FieldBox label={t("contacts.form.city")}>{contact.city || "—"}</FieldBox>
                {contact.region && <FieldBox label={t("contacts.form.region")}>{contact.region}</FieldBox>}
                <FieldBox label="الموظف المسؤول">
                  {assignee?.name ? (
                    <span className="font-bold text-primary">{assignee.name}</span>
                  ) : (
                    t("contacts.filters.unassigned")
                  )}
                </FieldBox>
                <FieldBox label={t("contacts.columns.created")}>{formatDate(contact.createdAt)}</FieldBox>
              </div>
            </div>

            {/* Social Accounts Section */}
            {contact.socialAccounts && contact.socialAccounts.length > 0 && (
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-bold text-default-700 flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-primary" />
                  {t("contacts.form.socialAccounts")}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {contact.socialAccounts.map((account, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-3 py-2 bg-default-100/70 border border-default-200 rounded-2xl text-xs font-semibold"
                    >
                      <span className="text-primary font-bold">{account.platform}:</span>
                      {account.url ? (
                        <a
                          href={account.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-default-700 hover:text-primary flex items-center gap-1 font-mono"
                        >
                          {account.username || account.url}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-default-700">{account.username || "—"}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Addresses Section */}
            {((contact.addresses && contact.addresses.length > 0) || contact.billingAddress) && (
              <div className="space-y-3 pt-2">
                <h4 className="text-sm font-bold text-default-700 flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  {t("contacts.form.addresses")}
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {contact.addresses?.map((addr, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-default-50 border border-default-200/80 rounded-2xl text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <Chip size="sm" variant="flat" color="primary" className="font-bold text-[10px]">
                          {t(`contacts.addressTypes.${addr.addressType || addr.type}`, { defaultValue: addr.addressType || addr.type })}
                        </Chip>
                        {addr.country && <span className="text-default-500 font-medium">{addr.country}</span>}
                      </div>
                      <div className="font-semibold text-default-800 text-sm">
                        {[addr.buildingNumber, addr.streetName || addr.street, addr.district].filter(Boolean).join("، ") || addr.shortAddress || "—"}
                      </div>
                      <div className="text-default-500 flex items-center gap-3">
                        <span>{addr.city}{addr.region ? ` - ${addr.region}` : ""}</span>
                        {addr.postalCode && <span>الرمز: {addr.postalCode}</span>}
                        {addr.additionalNumber && <span>الإضافي: {addr.additionalNumber}</span>}
                      </div>
                      {addr.notes && <p className="text-default-400 italic text-[11px] pt-1">{addr.notes}</p>}
                    </div>
                  ))}
                  {contact.billingAddress && (!contact.addresses || contact.addresses.length === 0) && (
                    <div className="p-3 bg-default-50 border border-default-200 rounded-2xl text-xs">
                      <span className="text-default-400 block font-medium mb-1">العنوان المسجل:</span>
                      <p className="font-semibold text-default-800">{contact.billingAddress}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Financial & CRM Sales Details */}
            {(contact.financialInfo || contact.crmSalesInfo) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {contact.financialInfo && (
                  <div className="p-4 bg-default-50/70 border border-default-200/80 rounded-3xl space-y-3">
                    <h4 className="text-sm font-bold text-default-800 flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-emerald-600" />
                      {t("contacts.form.financialInfo")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-default-400 block">التسجيل الضريبي:</span>
                        <span className="font-semibold">{contact.financialInfo.vatRegistered ? "مسجل بالضريبة" : "غير مسجل"}</span>
                      </div>
                      {contact.financialInfo.preferredPaymentMethod && (
                        <div>
                          <span className="text-default-400 block">طريقة الدفع:</span>
                          <span className="font-semibold">{contact.financialInfo.preferredPaymentMethod}</span>
                        </div>
                      )}
                      {contact.financialInfo.paymentTerms && (
                        <div>
                          <span className="text-default-400 block">شروط الدفع:</span>
                          <span className="font-semibold">{contact.financialInfo.paymentTerms}</span>
                        </div>
                      )}
                      {contact.financialInfo.paymentPeriod && (
                        <div>
                          <span className="text-default-400 block">مدة السداد:</span>
                          <span className="font-semibold">{contact.financialInfo.paymentPeriod}</span>
                        </div>
                      )}
                      {contact.financialInfo.creditLimit && (
                        <div>
                          <span className="text-default-400 block">الحد الائتماني:</span>
                          <span className="font-semibold font-mono">{contact.financialInfo.creditLimit} ر.س</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {contact.crmSalesInfo && (
                  <div className="p-4 bg-default-50/70 border border-default-200/80 rounded-3xl space-y-3">
                    <h4 className="text-sm font-bold text-default-800 flex items-center gap-2">
                      <Briefcase className="h-4 w-4 text-primary" />
                      {t("contacts.form.crmSalesInfo")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {contact.crmSalesInfo.sector && (
                        <div>
                          <span className="text-default-400 block">القطاع التجاري:</span>
                          <span className="font-semibold">{contact.crmSalesInfo.sector}</span>
                        </div>
                      )}
                      {contact.crmSalesInfo.expectedBudget && (
                        <div>
                          <span className="text-default-400 block">الميزانية المتوقعة:</span>
                          <span className="font-semibold font-mono">{contact.crmSalesInfo.expectedBudget}</span>
                        </div>
                      )}
                      {contact.crmSalesInfo.expectedStartDate && (
                        <div>
                          <span className="text-default-400 block">موعد البدء المتوقع:</span>
                          <span className="font-semibold">{contact.crmSalesInfo.expectedStartDate}</span>
                        </div>
                      )}
                      {contact.crmSalesInfo.hasMarketingTeam !== undefined && (
                        <div>
                          <span className="text-default-400 block">فريق تسويق داخلي:</span>
                          <span className="font-semibold">{contact.crmSalesInfo.hasMarketingTeam ? "نعم" : "لا"}</span>
                        </div>
                      )}
                    </div>
                    {(() => {
                      const services = contact.crmSalesInfo.servicesInterested || contact.crmSalesInfo.interestedServices;
                      if (!services || services.length === 0) return null;
                      return (
                        <div className="pt-2 border-t border-default-200">
                          <span className="text-[11px] text-default-400 block mb-1">الخدمات المهتم بها:</span>
                          <div className="flex flex-wrap gap-1">
                            {services.map((svc: string) => (
                              <Chip key={svc} size="sm" variant="flat" color="primary" className="text-[10px]">
                                {svc}
                              </Chip>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </Tab>

        {/* Tab 2: Associated Contacts (جهات الاتصال التابعة) */}
        {(contact.entityType !== "individual" || (contact.associatedContacts && contact.associatedContacts.length > 0)) && (
          <Tab
            key="associated_contacts"
            title={
              <span className="flex items-center gap-1.5 font-bold">
                <Users className="h-4 w-4" />
                {isAr ? "جهات الاتصال التابعة" : "Associated Contacts"} ({contact.associatedContacts?.length || 0})
              </span>
            }
          >
            <div className="pt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-default-50 p-4 rounded-3xl border border-default-100">
                <div>
                  <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    {isAr ? "فريق عمل وجهات التواصل بالمنشأة" : "Organization Contact Persons"}
                  </h4>
                  <p className="text-xs text-default-500 mt-0.5">
                    {isAr
                      ? "الأشخاص والمسؤولون المخولون بالتواصل واتخاذ القرار في هذه المنشأة"
                      : "Authorized contact persons and decision makers for this organization"}
                  </p>
                </div>
                {canManageContacts && (
                  <Button
                    color="primary"
                    size="sm"
                    className="font-bold rounded-xl"
                    startContent={<Pencil className="w-3.5 h-3.5" />}
                    onPress={() => setEditOpen(true)}
                  >
                    {isAr ? "إدارة جهات الاتصال" : "Manage Contacts"}
                  </Button>
                )}
              </div>

              {!contact.associatedContacts || contact.associatedContacts.length === 0 ? (
                <div className="text-center py-10 bg-default-50/50 border border-default-100 rounded-3xl">
                  <Users className="w-10 h-10 text-default-400 mx-auto mb-2" />
                  <p className="text-default-500 text-sm font-medium">
                    {isAr ? "لا توجد جهات اتصال تابعة مضافة لهذه المنشأة حالياً." : "No associated contacts added for this entity yet."}
                  </p>
                  {canManageContacts && (
                    <Button
                      color="primary"
                      variant="flat"
                      size="sm"
                      className="mt-3 font-bold rounded-xl"
                      startContent={<Plus className="h-4 w-4" />}
                      onPress={() => setEditOpen(true)}
                    >
                      {isAr ? "إضافة جهة اتصال للمنشأة" : "Add Contact Person"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {contact.associatedContacts.map((person) => (
                    <Card
                      key={person.id}
                      className={`glass-card border rounded-3xl transition-all hover:shadow-md ${
                        person.isPrimary
                          ? "border-warning-300 dark:border-warning-700 bg-warning-50/20 shadow-sm"
                          : "border-default-200"
                      }`}
                    >
                      <CardBody className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-sm text-default-900">{person.name}</h4>
                            </div>
                            <p className="text-xs text-default-500 font-medium">
                              {[person.jobTitle, person.department].filter(Boolean).join(" - ") || (isAr ? "جهة تواصل" : "Contact")}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {person.isPrimary && (
                              <Chip size="sm" color="warning" variant="flat" className="font-bold text-[10px] h-5">
                                ⭐ {isAr ? "رئيسي" : "Primary"}
                              </Chip>
                            )}
                            {person.isDecisionMaker && (
                              <Chip size="sm" color="secondary" variant="flat" className="font-bold text-[10px] h-5">
                                🎯 {isAr ? "صاحب قرار" : "Decision Maker"}
                              </Chip>
                            )}
                          </div>
                        </div>

                        {(person.contactRole || person.type) && (
                          <Chip size="sm" variant="bordered" className="text-[10px] h-5 border-default-300">
                            {t(`contacts.contactPersonRoles.${person.contactRole || person.type}`, { defaultValue: person.contactRole || person.type })}
                          </Chip>
                        )}

                        <div className="space-y-1.5 pt-2 border-t border-default-100 text-xs">
                          {person.phone && (
                            <div className="flex items-center justify-between bg-default-100/40 p-1.5 rounded-xl">
                              <span className="font-mono font-bold text-default-700">{person.phone}</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  className="h-6 w-6 min-w-6 text-primary"
                                  as="a"
                                  href={`tel:${person.phone}`}
                                >
                                  <Phone className="h-3 w-3" />
                                </Button>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  className="h-6 w-6 min-w-6 text-emerald-600"
                                  as="a"
                                  href={`https://wa.me/${person.phone.replace(/\D/g, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <MessageSquare className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          )}

                          {person.email && (
                            <div className="flex items-center gap-1.5 text-default-600 truncate">
                              <Mail className="h-3 w-3 text-default-400 shrink-0" />
                              <a href={`mailto:${person.email}`} className="hover:text-primary truncate">
                                {person.email}
                              </a>
                            </div>
                          )}

                          {person.notes && (
                            <p className="text-default-400 text-[11px] italic pt-1">{person.notes}</p>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </Tab>
        )}

        <Tab
          key="deals"
          title={
            <span className="flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" />
              {t("contactDetail.tabs.deals")}
            </span>
          }
        >
          <div className="pt-4">
            {contactDeals.length === 0 ? (
              <p className="text-default-500 text-sm">{t("contactDetail.deals.empty")}</p>
            ) : (
              <Table aria-label={t("contactDetail.tabs.deals")} removeWrapper>
                <TableHeader>
                  <TableColumn>{t("deals.form.title")}</TableColumn>
                  <TableColumn>{t("deals.form.stage")}</TableColumn>
                  <TableColumn>{t("deals.form.amount")}</TableColumn>
                  <TableColumn>{t("contacts.columns.actions")}</TableColumn>
                </TableHeader>
                <TableBody>
                  {contactDeals.map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell>{deal.title}</TableCell>
                      <TableCell>{t(`deals.stage.${deal.stage}`)}</TableCell>
                      <TableCell>
                        <MoneyAmount amount={deal.amount} />
                      </TableCell>
                      <TableCell>
                        <Button
                          as={Link}
                          to={`/crm/deals/${deal.id}`}
                          size="sm"
                          variant="light"
                          color="primary"
                        >
                          {t("contacts.details")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Tab>

        <Tab
          key="tasks"
          title={
            <span className="flex items-center gap-1.5">
              <ListTodo className="h-4 w-4" />
              {t("contactDetail.tabs.tasks")} ({totalDeliveryTasks + tasks.length})
            </span>
          }
        >
          <div className="pt-4 space-y-6">
            {/* Operational Delivery Tasks Section */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-default-50 p-4 rounded-2xl border border-default-200">
                <div className="flex items-center gap-2">
                  <Workflow className="h-5 w-5 text-emerald-600" />
                  <div>
                    <h4 className="font-bold text-sm text-foreground">
                      مهام التنفيذ والتسليمات التشغيلية ({totalDeliveryTasks})
                    </h4>
                    <p className="text-xs text-default-500">
                      المهام المولدة من عقود وصفقات العميل الموزعة على أقسام الشركة
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
                    لوحة المهام العامة ←
                  </Button>
                )}
              </div>

              {totalDeliveryTasks > 0 && (
                <div className="p-4 bg-default-50/70 rounded-2xl border border-default-100 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-default-600">نسبة إنجاز خدمات العميل:</span>
                    <span className="text-primary font-mono">{deliveryProgress}%</span>
                  </div>
                  <Progress
                    value={deliveryProgress}
                    color="primary"
                    size="sm"
                    className="rounded-full"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                    <div className="p-2.5 rounded-xl bg-background border border-default-200">
                      <span className="text-default-400 block text-[11px]">الإجمالي</span>
                      <span className="font-bold text-sm text-foreground">{totalDeliveryTasks}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-background border border-default-200">
                      <span className="text-default-400 block text-[11px]">قيد التنفيذ</span>
                      <span className="font-bold text-sm text-warning-600">{inProgressDeliveryTasks}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-background border border-default-200">
                      <span className="text-default-400 block text-[11px]">مكتملة</span>
                      <span className="font-bold text-sm text-emerald-600">{completedDeliveryTasks}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-background border border-default-200">
                      <span className="text-default-400 block text-[11px]">بانتظار التعيين</span>
                      <span className={`font-bold text-sm ${unassignedDeliveryTasks > 0 ? "text-amber-600 font-bold" : "text-default-700"}`}>
                        {unassignedDeliveryTasks}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {deliveryTasksLoading ? (
                <LoadingSpinner />
              ) : deliveryTasks.length === 0 ? (
                <p className="text-xs text-default-400 p-4 text-center bg-default-50/50 rounded-2xl border border-dashed border-default-200">
                  لا توجد مهام تسليم تشغيلية مسجلة لهذا العميل حتى الآن. يتم توليد المهام تلقائياً عند ترحيل بنود العقود.
                </p>
              ) : (
                <div className="space-y-2">
                  {deliveryTasks.map((tItem) => {
                    const assigneeUser = users?.find((u) => u.id === tItem.assigneeId);
                    const isUnassigned = !tItem.assigneeId;

                    return (
                      <div
                        key={tItem.id}
                        className="p-3.5 rounded-2xl border border-default-200 bg-background hover:bg-default-50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">{tItem.title}</span>
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
                              className="text-[10px] font-bold h-5"
                            >
                              {tItem.status}
                            </Chip>
                            {tItem.department && (
                              <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-5">
                                {tItem.department}
                              </Chip>
                            )}
                          </div>
                          {tItem.dueDate && (
                            <p className="text-xs text-default-400 mt-1 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              تاريخ الاستحقاق: {formatDate(tItem.dueDate)}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {isUnassigned ? (
                            <Button
                              size="sm"
                              color="warning"
                              variant="flat"
                              startContent={<Sparkles className="h-3.5 w-3.5" />}
                              className="font-bold text-xs rounded-xl h-8"
                              onPress={() => {
                                setSelectedTaskForAssignment(tItem);
                                setAssignmentModalOpen(true);
                              }}
                            >
                              تعيين ذكي
                            </Button>
                          ) : (
                            <div
                              className="flex items-center gap-1.5 cursor-pointer p-1 rounded-xl hover:bg-default-100"
                              onClick={() => {
                                setSelectedTaskForAssignment(tItem);
                                setAssignmentModalOpen(true);
                              }}
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
            </div>

            {/* CRM Follow-up Tasks Section */}
            <div className="space-y-3 pt-4 border-t border-default-200">
              <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-primary" />
                ملاحظات ومتابعات الـ CRM ({tasks.length})
              </h4>
              {tasksLoading ? (
                <LoadingSpinner />
              ) : tasks.length === 0 ? (
                <p className="text-default-500 text-xs">{t("contactDetail.tasks.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-default-50 border border-default-100"
                    >
                      <span className="font-medium text-xs text-foreground">{task.title}</span>
                      <Chip size="sm" variant="flat">
                        {t(`crmTasks.status.${normalizeCrmTaskStatus(task.status)}`)}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Tab>

        <Tab
          key="notes"
          title={
            <span className="flex items-center gap-1.5">
              <StickyNote className="h-4 w-4" />
              {t("contactDetail.tabs.notes")}
            </span>
          }
        >
          <div className="pt-4">
            <CrmNotesSection
              notes={notes}
              canManage={canManageContacts}
              isLoading={notesLoading || createNote.isPending}
              onAdd={async (content) => {
                await createNote.mutateAsync(content);
              }}
              onUpdate={
                canManageContacts
                  ? async (id, content) => {
                      await updateNote.mutateAsync({ id, content });
                    }
                  : undefined
              }
              onDelete={
                canManageContacts
                  ? async (id) => {
                      await deleteNote.mutateAsync(id);
                    }
                  : undefined
              }
            />
          </div>
        </Tab>

        <Tab
          key="attachments"
          title={
            <span className="flex items-center gap-1.5">
              <Paperclip className="h-4 w-4" />
              {t("contactDetail.tabs.attachments")}
            </span>
          }
        >
          <div className="pt-4">
            <CrmAttachmentsSection
              attachments={attachments}
              canManage={canManageContacts}
              isLoading={attachmentsLoading || uploadAttachment.isPending}
              onUpload={async (file) => {
                await uploadAttachment.mutateAsync(file);
              }}
              onDelete={
                canManageContacts
                  ? async (id) => {
                      await deleteAttachment.mutateAsync(id);
                    }
                  : undefined
              }
            />
          </div>
        </Tab>

        <Tab
          key="timeline"
          title={
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {t("contactDetail.tabs.timeline")}
            </span>
          }
        >
          <div className="pt-4">
            <UnifiedCustomerTimeline contactId={contactId} />
          </div>
        </Tab>
        <Tab
          key="billing"
          title={
            <span className="flex items-center gap-1.5">
              <CreditCard className="h-4 w-4" />
              {t("contactDetail.tabs.billing") || "Billing & Invoices"}
            </span>
          }
        >
          <div className="pt-4">
            {invoicesLoading ? (
              <LoadingSpinner />
            ) : customerInvoices.length === 0 ? (
              <p className="text-default-500 text-sm">
                {t("contactDetail.billing.empty") || "No invoices or payments found for this customer."}
              </p>
            ) : (
              <Table aria-label="Customer invoices">
                <TableHeader>
                  <TableColumn>Invoice</TableColumn>
                  <TableColumn>Date</TableColumn>
                  <TableColumn>Due</TableColumn>
                  <TableColumn>Status</TableColumn>
                  <TableColumn align="end">Amount</TableColumn>
                  <TableColumn align="end">Balance Due</TableColumn>
                </TableHeader>
                <TableBody>
                  {customerInvoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer hover:bg-default-50"
                      onClick={() => navigate(`/billing/invoices/${inv.id}`)}
                    >
                      <TableCell className="font-semibold text-primary">
                        {inv.invoiceNumber}
                      </TableCell>
                      <TableCell>{formatDate(inv.issueDate)}</TableCell>
                      <TableCell>{formatDate(inv.dueDate)}</TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat">
                          {inv.status}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <MoneyAmount amount={inv.grandTotal} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyAmount amount={getInvoiceAmountDue(inv)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Tab>
        <Tab
          key="reports"
          title={
            <span className="flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-blue-500" />
              {t("contactDetail.tabs.reports") || "تقارير العملاء المستندية"}
            </span>
          }
        >
          <div className="pt-4 space-y-4">
            <div className="flex justify-between items-center bg-default-50 p-4 rounded-xl border border-default-100">
              <div>
                <h4 className="font-bold text-sm text-foreground">
                  تقارير العميل المستندية (Word)
                </h4>
                <p className="text-xs text-default-500 mt-0.5">
                  توثيق التقارير الرسمية وملخصات الاجتماعات وكتابة الملاحظات الهامة
                </p>
              </div>
              <Button
                color="primary"
                size="sm"
                className="font-bold rounded-xl"
                startContent={<Plus className="w-4 h-4" />}
                onPress={() => setReportEditorOpen(true)}
              >
                تقرير مستندي جديد
              </Button>
            </div>

            {reportsLoading ? (
              <LoadingSpinner />
            ) : clientReports.length === 0 ? (
              <div className="text-center py-10 bg-default-50/50 border border-default-100 rounded-xl">
                <FileText className="w-10 h-10 text-default-400 mx-auto mb-2" />
                <p className="text-default-500 text-sm font-medium">لا توجد تقارير مكتوبة لهذا العميل حتى الآن.</p>
                <p className="text-xs text-default-400 mt-1">اضغط على زر تقرير مستندي جديد بالأعلى لإنشاء أول تقرير.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {clientReports.map((report) => (
                  <div
                    key={report.id}
                    onClick={() => {
                      setSelectedReportForView(report);
                      setReportDetailOpen(true);
                    }}
                    className="p-4 rounded-xl border border-default-200 bg-background hover:bg-default-50 cursor-pointer transition-all hover:shadow-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-center gap-2 mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20">
                          {report.reportType}
                        </span>
                        <span className="text-xs text-default-400">
                          {new Date(report.createdAt).toLocaleDateString("ar-SA")}
                        </span>
                      </div>
                      <h4 className="font-bold text-sm text-foreground line-clamp-1 mb-1">
                        {report.title}
                      </h4>
                      <p className="text-xs text-default-500 line-clamp-2 leading-relaxed">
                        {report.content.replace(/[#*>]/g, "")}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-default-100 flex justify-between items-center text-xs text-default-400">
                      <span>الموظف: <strong className="text-foreground font-semibold">{report.authorName}</strong></span>
                      <span className="text-blue-600 font-semibold hover:underline">عرض المستند ←</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Tab>
        <Tab
          key="contracts"
          title={
            <span className="flex items-center gap-1.5">
              <FileSignature className="h-4 w-4 text-primary" />
              العقود ({contactContracts.length})
            </span>
          }
        >
          <div className="pt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-default-50 p-4 rounded-xl border border-default-100">
              <div>
                <h4 className="font-bold text-sm text-foreground">
                  عقود العميل ونماذج الخدمات
                </h4>
                <p className="text-xs text-default-500 mt-0.5">
                  العقود المبرمة وبنود الخدمات المرتبطة بمهام الأقسام التنفيذية
                </p>
              </div>
              <Button
                color="primary"
                size="sm"
                className="font-bold rounded-xl"
                startContent={<Plus className="w-4 h-4" />}
                onPress={() =>
                  navigate(
                    `/crm/contracts?contactId=${contact.id}` +
                      (contactDeals.length > 0 ? `&dealId=${contactDeals[0].id}` : "")
                  )
                }
              >
                إنشاء عقد جديد
              </Button>
            </div>

            {contractsLoading ? (
              <LoadingSpinner />
            ) : contactContracts.length === 0 ? (
              <div className="text-center py-10 bg-default-50/50 border border-default-100 rounded-xl">
                <FileSignature className="w-10 h-10 text-default-400 mx-auto mb-2" />
                <p className="text-default-500 text-sm font-medium">لا توجد عقود مسجلة لهذا العميل حتى الآن.</p>
                <p className="text-xs text-default-400 mt-1">اضغط على زر إنشاء عقد جديد لصياغة عقد وتحويل خدماته إلى مهام الأقسام.</p>
                <Button
                  color="primary"
                  variant="flat"
                  size="sm"
                  className="mt-4 font-bold"
                  startContent={<Plus className="h-4 w-4" />}
                  onPress={() =>
                    navigate(
                      `/crm/contracts?contactId=${contact.id}` +
                        (contactDeals.length > 0 ? `&dealId=${contactDeals[0].id}` : "")
                    )
                  }
                >
                  إنشاء عقد الآن
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contactContracts.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-xl border border-default-200 bg-background hover:bg-default-50 transition-all hover:shadow-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-center gap-2 mb-2">
                        <span className="text-xs font-mono font-bold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                          #{c.form.contractNumber}
                        </span>
                        <Chip
                          size="sm"
                          variant="flat"
                          color={c.convertedToTasks ? "success" : "default"}
                          startContent={c.convertedToTasks ? <Workflow className="h-3 w-3" /> : undefined}
                          className="text-[10px] font-bold"
                        >
                          {c.convertedToTasks ? "مرحّل لمهام الأقسام" : "مسودة"}
                        </Chip>
                      </div>
                      <h4 className="font-bold text-sm text-foreground line-clamp-1 mb-1">
                        {c.title}
                      </h4>
                      <p className="text-xs text-default-500">
                        تاريخ العقد: {c.form.contractDateIso} · بنود الخدمات: {c.form.services?.length || 0}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-default-100 flex justify-between items-center text-xs">
                      <span className="text-default-400 font-mono">
                        {c.form.fields.find((f) => f.key === "amountInclVat")?.value
                          ? `${c.form.fields.find((f) => f.key === "amountInclVat")?.value} ر.س`
                          : "—"}
                      </span>
                      <Button
                        size="sm"
                        variant="light"
                        color="primary"
                        className="font-bold h-7"
                        onPress={() => navigate(`/crm/contracts?id=${c.id}&contactId=${contact.id}`)}
                      >
                        عرض العقد ←
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Tab>
      </Tabs>

      <ContactFormModal isOpen={editOpen} onOpenChange={setEditOpen} contact={contact} />

      {reportEditorOpen && (
        <ClientReportEditorModal
          isOpen={reportEditorOpen}
          onClose={() => setReportEditorOpen(false)}
          initialContactId={contact.id}
        />
      )}

      {reportDetailOpen && (
        <ClientReportDetailModal
          isOpen={reportDetailOpen}
          onClose={() => setReportDetailOpen(false)}
          report={selectedReportForView}
        />
      )}

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
    </div>
  );
}
