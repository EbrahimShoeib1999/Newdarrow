import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useContactsQuery } from "../hooks/use-contacts";
import { useCrmPermissions } from "../hooks/use-crm-permissions";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { Pagination } from "@/components/shared/pagination";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  User as UserAvatar,
  Button,
  Card,
  CardBody,
  Input,
  Select,
  SelectItem,
  Chip,
  Tabs,
  Tab,
  Tooltip,
} from "@heroui/react";
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Search,
  Phone,
  PhoneCall,
  MessageSquare,
  Copy,
  Check,
  Smile,
  Frown,
  Meh,
  UserCheck,
  Building2,
  BookUser,
  List,
  Tag,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAllUsers } from "@/features/users/hooks/use-users";
import {
  applyContactsListPipeline,
  contactDisplayName,
  type ContactsListParams,
  type ContactSortField,
} from "../utils/contacts-list.utils";
import { ContactFormModal } from "../components/ContactFormModal";
import { ManageClassificationsModal } from "../components/ManageClassificationsModal";
import { useContactClassifications } from "../hooks/use-contact-classifications";
import { formatDate, formatNumber } from "@/lib/utils";
import type { ContactClassificationItem } from "../types/classification.types";
import type {
  ContactSource,
  ContactStatus,
  CustomerSatisfaction,
  EntityType,
  ContactRelationship,
} from "../types/contacts.types";

const DEFAULT_PARAMS: ContactsListParams = {
  page: 1,
  pageSize: 10,
  sortField: "createdAt",
  sortOrder: "desc",
  entityType: "all",
  relationship: "all",
  classification: "all",
  source: "all",
  status: "all",
  satisfaction: "all",
};

export function ContactsListPage() {
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { canManageContacts } = useCrmPermissions();
  const { data, isLoading } = useContactsQuery();
  const { data: users } = useAllUsers();
  const { activeClassifications, classificationsMap } = useContactClassifications();
  const [params, setParams] = useState<ContactsListParams>(DEFAULT_PARAMS);
  const [formOpen, setFormOpen] = useState(false);
  const [manageClassificationsOpen, setManageClassificationsOpen] = useState(false);
  const [viewTab, setViewTab] = useState<string>("table");
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  const pipeline = useMemo(() => {
    const all = data?.data ?? [];
    return applyContactsListPipeline(all, params);
  }, [data?.data, params]);

  const assigneeUser = (id: string | null | undefined) => {
    if (!id) return null;
    return users?.find((u) => u.id === id) ?? null;
  };

  const copyToClipboard = (phone: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    toast.success(t("contacts.directory.copied"));
    setTimeout(() => setCopiedPhone(null), 2500);
  };

  const formatWhatsappLink = (phone: string) => {
    const cleaned = phone.replace(/\D/g, "");
    const formatted = cleaned.startsWith("05") ? `966${cleaned.slice(1)}` : cleaned;
    return `https://wa.me/${formatted}`;
  };

  const toggleSort = (field: ContactSortField) => {
    setParams((p) => ({
      ...p,
      sortField: field,
      sortOrder: p.sortField === field && p.sortOrder === "asc" ? "desc" : "asc",
      page: 1,
    }));
  };

  const SortIcon = ({ field }: { field: ContactSortField }) => {
    if (params.sortField !== field) return null;
    return params.sortOrder === "asc" ? (
      <ChevronUp className="h-3 w-3 inline ms-1" />
    ) : (
      <ChevronDown className="h-3 w-3 inline ms-1" />
    );
  };

  const renderClassificationChip = (classification?: string) => {
    if (!classification) {
      return (
        <Chip size="sm" color="default" variant="flat" className="font-medium text-xs">
          —
        </Chip>
      );
    }
    const def = classificationsMap[classification];
    if (def) {
      const label = isAr ? def.nameAr : def.nameEn;
      const emoji = def.emoji || "🏷️";
      const color = (def.color as any) || "primary";
      return (
        <Chip size="sm" color={color} variant="flat" className="font-bold border border-default-200">
          {emoji} {label}
        </Chip>
      );
    }
    switch (classification) {
      case "actual_client":
        return (
          <Chip size="sm" color="success" variant="flat" className="font-bold border border-success-200">
            🟢 {t("contacts.classification.actual_client")}
          </Chip>
        );
      case "potential_lead":
        return (
          <Chip size="sm" color="warning" variant="flat" className="font-bold border border-warning-200">
            🟡 {t("contacts.classification.potential_lead")}
          </Chip>
        );
      case "callback":
        return (
          <Chip size="sm" color="primary" variant="flat" className="font-bold border border-primary-200">
            🔵 {t("contacts.classification.callback")}
          </Chip>
        );
      default:
        return (
          <Chip size="sm" color="secondary" variant="flat" className="font-bold">
            🏷️ {classification}
          </Chip>
        );
    }
  };

  const renderSourceChip = (source?: ContactSource) => {
    if (!source) return null;
    return (
      <Chip size="sm" variant="bordered" className="text-[11px] font-medium border-default-200">
        <Globe className="h-2.5 w-2.5 inline me-1 text-default-400" />
        {t(`contacts.source.${source}`, { defaultValue: source })}
      </Chip>
    );
  };

  const renderStatusChip = (status?: ContactStatus) => {
    const s = status || "active";
    const color = s === "active" ? "success" : s === "archived" ? "default" : "warning";
    return (
      <Chip size="sm" color={color} variant="dot" className="text-[11px] font-bold">
        {t(`contacts.status.${s}`, { defaultValue: s })}
      </Chip>
    );
  };

  const renderSatisfactionChip = (satisfaction?: CustomerSatisfaction) => {
    switch (satisfaction) {
      case "satisfied":
        return (
          <Chip
            size="sm"
            color="success"
            variant="dot"
            startContent={<Smile className="h-3.5 w-3.5 text-success ms-1" />}
            className="font-bold"
          >
            {t("contacts.satisfaction.satisfied")}
          </Chip>
        );
      case "unsatisfied":
        return (
          <Chip
            size="sm"
            color="danger"
            variant="dot"
            startContent={<Frown className="h-3.5 w-3.5 text-danger ms-1" />}
            className="font-bold"
          >
            {t("contacts.satisfaction.unsatisfied")}
          </Chip>
        );
      case "neutral":
      default:
        return (
          <Chip
            size="sm"
            color="warning"
            variant="dot"
            startContent={<Meh className="h-3.5 w-3.5 text-warning ms-1" />}
            className="font-bold"
          >
            {t("contacts.satisfaction.neutral")}
          </Chip>
        );
    }
  };

  const renderEntityTypeBadge = (entityType?: EntityType) => {
    switch (entityType) {
      case "company":
        return <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-5 font-bold">🏢 {isAr ? "شركة" : "Company"}</Chip>;
      case "establishment":
        return <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-5 font-bold">🏬 {isAr ? "مؤسسة" : "Establishment"}</Chip>;
      case "government":
        return <Chip size="sm" variant="flat" color="warning" className="text-[10px] h-5 font-bold">🏛️ {isAr ? "حكومية" : "Gov"}</Chip>;
      case "non_profit":
        return <Chip size="sm" variant="flat" color="success" className="text-[10px] h-5 font-bold">🤝 {isAr ? "غير ربحية" : "NGO"}</Chip>;
      case "bank":
        return <Chip size="sm" variant="flat" color="secondary" className="text-[10px] h-5 font-bold">🏦 {isAr ? "بنك" : "Bank"}</Chip>;
      case "media":
        return <Chip size="sm" variant="flat" color="warning" className="text-[10px] h-5 font-bold">📻 {isAr ? "إعلامية" : "Media"}</Chip>;
      case "influencer":
        return <Chip size="sm" variant="flat" color="secondary" className="text-[10px] h-5 font-bold">✨ {isAr ? "مؤثر" : "Creator"}</Chip>;
      case "individual":
      default:
        return <Chip size="sm" variant="flat" color="default" className="text-[10px] h-5">👤 {isAr ? "فرد" : "Individual"}</Chip>;
    }
  };

  const renderRelationshipsChips = (relationships?: ContactRelationship[]) => {
    if (!relationships || relationships.length === 0) return null;
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        {relationships.map((rel) => {
          const label = t(`contacts.relationships.${rel}`, { defaultValue: rel });
          return (
            <Chip key={rel} size="sm" variant="bordered" className="text-[10px] h-4.5 px-1.5 font-medium border-default-300">
              {label}
            </Chip>
          );
        })}
      </div>
    );
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t("contacts.title")}
        description={t("contacts.description")}
        actions={
          <div className="flex items-center gap-2">
            {canManageContacts && (
              <>
                <Button
                  variant="bordered"
                  startContent={<Tag className="h-4 w-4 text-primary" />}
                  className="rounded-full font-bold border-default-300"
                  onPress={() => setManageClassificationsOpen(true)}
                >
                  {t("contacts.classification.manage")}
                </Button>
                <Button
                  color="primary"
                  startContent={<Plus className="h-4 w-4" />}
                  className="rounded-full font-bold shadow-md shadow-primary/20"
                  onPress={() => setFormOpen(true)}
                >
                  {t("contacts.addContact")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* View Switcher: Table View vs Unified Phone Directory */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <Tabs
          selectedKey={viewTab}
          onSelectionChange={(k: any) => setViewTab(k as string)}
          color="primary"
          variant="bordered"
          classNames={{
            base: "w-fit",
            tabList: "p-1 rounded-2xl bg-default-100/60 border border-default-200",
            tab: "rounded-xl font-bold px-4 py-2",
          }}
        >
          <Tab
            key="table"
            title={
              <div className="flex items-center gap-2">
                <List className="h-4 w-4" />
                <span>{t("contacts.directory.tableTab")}</span>
              </div>
            }
          />
          <Tab
            key="directory"
            title={
              <div className="flex items-center gap-2">
                <BookUser className="h-4 w-4" />
                <span>{t("contacts.directory.tab")}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                  {formatNumber(pipeline.total)}
                </span>
              </div>
            }
          />
        </Tabs>
      </div>

      {/* Filters Bar: Full Filtering Suite (Classification, Source, Status, Satisfaction, Assignee, Search) */}
      <div className="flex flex-wrap items-center gap-3 bg-default-50 p-4 rounded-3xl border border-default-100">
        <Input
          isClearable
          size="sm"
          variant="bordered"
          placeholder={t("contacts.searchPlaceholder")}
          value={params.search ?? ""}
          onValueChange={(v) => setParams((p) => ({ ...p, search: v, page: 1 }))}
          startContent={<Search className="h-4 w-4 text-default-400" />}
          className="w-full sm:w-60"
        />

        {/* Assigned Follow-Up Employee Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.assignedTo")}
          className="w-full sm:w-44"
          selectedKeys={params.assignedTo ? [params.assignedTo] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as string | undefined;
            setParams((p) => ({ ...p, assignedTo: v, page: 1 }));
          }}
          items={[
            { id: "__unassigned__", name: t("contacts.filters.unassigned") },
            ...(users ?? []).map((u) => ({ id: u.id, name: u.name })),
          ]}
        >
          {(item) => <SelectItem key={item.id} textValue={item.name}>{item.name}</SelectItem>}
        </Select>

        {/* Entity Type Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.entityType")}
          className="w-full sm:w-36"
          selectedKeys={params.entityType && params.entityType !== "all" ? [params.entityType] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as EntityType | undefined;
            setParams((p) => ({ ...p, entityType: v || "all", page: 1 }));
          }}
        >
          <SelectItem key="all" textValue={t("contacts.entityType.all")}>{t("contacts.entityType.all")}</SelectItem>
          <SelectItem key="individual" textValue={t("contacts.entityType.individual")}>👤 {t("contacts.entityType.individual")}</SelectItem>
          <SelectItem key="company" textValue={t("contacts.entityType.company")}>🏢 {t("contacts.entityType.company")}</SelectItem>
          <SelectItem key="establishment" textValue={t("contacts.entityType.establishment")}>🏬 {t("contacts.entityType.establishment")}</SelectItem>
          <SelectItem key="government" textValue={t("contacts.entityType.government")}>🏛️ {t("contacts.entityType.government")}</SelectItem>
          <SelectItem key="non_profit" textValue={t("contacts.entityType.non_profit")}>🤝 {t("contacts.entityType.non_profit")}</SelectItem>
          <SelectItem key="bank" textValue={t("contacts.entityType.bank")}>🏦 {t("contacts.entityType.bank")}</SelectItem>
          <SelectItem key="media" textValue={t("contacts.entityType.media")}>📻 {t("contacts.entityType.media")}</SelectItem>
          <SelectItem key="influencer" textValue={t("contacts.entityType.influencer")}>✨ {t("contacts.entityType.influencer")}</SelectItem>
          <SelectItem key="other" textValue={t("contacts.entityType.other")}>❓ {t("contacts.entityType.other")}</SelectItem>
        </Select>

        {/* Relationship Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.relationships")}
          className="w-full sm:w-40"
          selectedKeys={params.relationship && params.relationship !== "all" ? [params.relationship] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as ContactRelationship | undefined;
            setParams((p) => ({ ...p, relationship: v || "all", page: 1 }));
          }}
        >
          <SelectItem key="all" textValue={t("contacts.relationships.all")}>{t("contacts.relationships.all")}</SelectItem>
          <SelectItem key="lead" textValue={t("contacts.relationships.lead")}>🎯 {t("contacts.relationships.lead")}</SelectItem>
          <SelectItem key="new_client" textValue={t("contacts.relationships.new_client")}>✨ {t("contacts.relationships.new_client")}</SelectItem>
          <SelectItem key="active_client" textValue={t("contacts.relationships.active_client")}>🟢 {t("contacts.relationships.active_client")}</SelectItem>
          <SelectItem key="vip_client" textValue={t("contacts.relationships.vip_client")}>💎 {t("contacts.relationships.vip_client")}</SelectItem>
          <SelectItem key="vendor" textValue={t("contacts.relationships.vendor")}>📦 {t("contacts.relationships.vendor")}</SelectItem>
          <SelectItem key="partner" textValue={t("contacts.relationships.partner")}>🤝 {t("contacts.relationships.partner")}</SelectItem>
          <SelectItem key="contractor" textValue={t("contacts.relationships.contractor")}>📝 {t("contacts.relationships.contractor")}</SelectItem>
          <SelectItem key="referral" textValue={t("contacts.relationships.referral")}>📣 {t("contacts.relationships.referral")}</SelectItem>
          <SelectItem key="media" textValue={t("contacts.relationships.media")}>📻 {t("contacts.relationships.media")}</SelectItem>
          <SelectItem key="influencer" textValue={t("contacts.relationships.influencer")}>🌟 {t("contacts.relationships.influencer")}</SelectItem>
        </Select>

        {/* Dynamic Classification Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.classification")}
          className="w-full sm:w-44"
          selectedKeys={params.classification && params.classification !== "all" ? [params.classification] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as string | undefined;
            setParams((p) => ({ ...p, classification: v || "all", page: 1 }));
          }}
        >
          {activeClassifications.map((c: ContactClassificationItem) => {
            const label = isAr ? c.nameAr : c.nameEn;
            return (
              <SelectItem key={c.key} textValue={label}>
                <div className="flex items-center gap-1.5">
                  <span>{c.emoji || "🏷️"}</span>
                  <span>{label}</span>
                </div>
              </SelectItem>
            );
          })}
        </Select>

        {/* Sender / Source Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.source")}
          className="w-full sm:w-36"
          selectedKeys={params.source && params.source !== "all" ? [params.source] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as ContactSource | undefined;
            setParams((p) => ({ ...p, source: v || "all", page: 1 }));
          }}
        >
          <SelectItem key="website" textValue={t("contacts.source.website")}>{t("contacts.source.website")}</SelectItem>
          <SelectItem key="referral" textValue={t("contacts.source.referral")}>{t("contacts.source.referral")}</SelectItem>
          <SelectItem key="social_media" textValue={t("contacts.source.social_media")}>{t("contacts.source.social_media")}</SelectItem>
          <SelectItem key="cold_call" textValue={t("contacts.source.cold_call")}>{t("contacts.source.cold_call")}</SelectItem>
          <SelectItem key="event" textValue={t("contacts.source.event")}>{t("contacts.source.event")}</SelectItem>
          <SelectItem key="whatsapp" textValue={t("contacts.source.whatsapp")}>{t("contacts.source.whatsapp")}</SelectItem>
          <SelectItem key="other" textValue={t("contacts.source.other")}>{t("contacts.source.other")}</SelectItem>
        </Select>

        {/* Status Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.status")}
          className="w-full sm:w-32"
          selectedKeys={params.status && params.status !== "all" ? [params.status] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as ContactStatus | undefined;
            setParams((p) => ({ ...p, status: v || "all", page: 1 }));
          }}
        >
          <SelectItem key="active" textValue={t("contacts.status.active")}>{t("contacts.status.active")}</SelectItem>
          <SelectItem key="inactive" textValue={t("contacts.status.inactive")}>{t("contacts.status.inactive")}</SelectItem>
          <SelectItem key="archived" textValue={t("contacts.status.archived")}>{t("contacts.status.archived")}</SelectItem>
        </Select>

        {/* Satisfaction Filter */}
        <Select
          {...selectFieldProps({ compact: true })}
          size="sm"
          variant="bordered"
          label={t("contacts.filters.satisfaction")}
          className="w-full sm:w-36"
          selectedKeys={params.satisfaction && params.satisfaction !== "all" ? [params.satisfaction] : []}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as CustomerSatisfaction | undefined;
            setParams((p) => ({ ...p, satisfaction: v || "all", page: 1 }));
          }}
        >
          <SelectItem key="satisfied" textValue={t("contacts.satisfaction.satisfied")}>
            😊 {t("contacts.satisfaction.satisfied")}
          </SelectItem>
          <SelectItem key="neutral" textValue={t("contacts.satisfaction.neutral")}>
            😐 {t("contacts.satisfaction.neutral")}
          </SelectItem>
          <SelectItem key="unsatisfied" textValue={t("contacts.satisfaction.unsatisfied")}>
            😞 {t("contacts.satisfaction.unsatisfied")}
          </SelectItem>
        </Select>

        {(params.search ||
          params.assignedTo ||
          (params.entityType && params.entityType !== "all") ||
          (params.relationship && params.relationship !== "all") ||
          (params.classification && params.classification !== "all") ||
          (params.source && params.source !== "all") ||
          (params.status && params.status !== "all") ||
          (params.satisfaction && params.satisfaction !== "all")) && (
          <Button
            size="sm"
            variant="light"
            color="danger"
            onPress={() => setParams(DEFAULT_PARAMS)}
          >
            {t("contacts.filters.clear")}
          </Button>
        )}
      </div>

      {/* VIEW 1: Contacts Table View */}
      {viewTab === "table" ? (
        <Card className="glass-card border-none p-2">
          <Table aria-label={t("contacts.title")} removeWrapper className="bg-transparent">
            <TableHeader>
              <TableColumn>
                <button type="button" className="font-bold" onClick={() => toggleSort("name")}>
                  {t("contacts.columns.name")}
                  <SortIcon field="name" />
                </button>
              </TableColumn>
              <TableColumn>
                <button type="button" className="font-bold" onClick={() => toggleSort("classification")}>
                  {t("contacts.columns.classification")}
                  <SortIcon field="classification" />
                </button>
              </TableColumn>
              <TableColumn>
                <button type="button" className="font-bold" onClick={() => toggleSort("satisfaction")}>
                  {t("contacts.columns.satisfaction")}
                  <SortIcon field="satisfaction" />
                </button>
              </TableColumn>
              <TableColumn>{t("contacts.columns.phone")}</TableColumn>
              <TableColumn>{t("contacts.columns.interests")}</TableColumn>
              <TableColumn>{t("contacts.columns.assigned")}</TableColumn>
              <TableColumn>
                <button type="button" className="font-bold" onClick={() => toggleSort("createdAt")}>
                  {t("contacts.columns.created")}
                  <SortIcon field="createdAt" />
                </button>
              </TableColumn>
              <TableColumn>{t("contacts.columns.actions")}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t("contacts.empty")}>
              {pipeline.items.map((contact) => {
                const assignee = assigneeUser(contact.assignedTo);
                return (
                  <TableRow
                    key={contact.id}
                    className="hover:bg-default-100/50 transition-colors cursor-pointer group"
                  >
                    <TableCell>
                      <UserAvatar
                        name={contactDisplayName(contact)}
                        description={contact.accountName || contact.jobTitle || contact.email}
                        avatarProps={{
                          src: contact.email ? `https://avatar.vercel.sh/${contact.email}` : undefined,
                          size: "sm",
                        }}
                        className="font-bold"
                      />
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {renderEntityTypeBadge(contact.entityType)}
                        {renderRelationshipsChips(contact.relationships)}
                      </div>
                      {contact.associatedContacts && contact.associatedContacts.length > 0 && (
                        <div className="text-[11px] text-default-500 mt-1 flex items-center gap-1 font-medium">
                          <span className="text-warning-500 font-bold">👤</span>
                          <span>
                            {contact.associatedContacts.find((c) => c.isPrimary)?.name || contact.associatedContacts[0]?.name}
                          </span>
                          <span className="text-default-400">
                            ({contact.associatedContacts.find((c) => c.isPrimary)?.jobTitle || contact.associatedContacts[0]?.jobTitle || (isAr ? "جهة تواصل" : "Contact")})
                          </span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {renderClassificationChip(contact.classification)}
                        {(contact.source || contact.status) && (
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            {contact.source && renderSourceChip(contact.source)}
                            {contact.status && renderStatusChip(contact.status)}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {renderSatisfactionChip(contact.satisfaction)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="text-default-700 font-semibold">{contact.phone || "—"}</span>
                        {contact.phone && (
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            <Tooltip content={t("contacts.directory.callNow")}>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                className="h-6 w-6 min-w-6 text-primary"
                                as="a"
                                href={`tel:${contact.phone}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <PhoneCall className="h-3 w-3" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("contacts.directory.whatsapp")}>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                className="h-6 w-6 min-w-6 text-emerald-600"
                                as="a"
                                href={formatWhatsappLink(contact.whatsappPhone || contact.phone)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageSquare className="h-3 w-3" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t("contacts.directory.copy")}>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                className="h-6 w-6 min-w-6 text-default-400"
                                onClick={(e) => copyToClipboard(contact.phone, e)}
                              >
                                {copiedPhone === contact.phone ? (
                                  <Check className="h-3 w-3 text-success" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </Button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {contact.interests && contact.interests.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {contact.interests.slice(0, 2).map((item) => (
                            <Chip key={item} size="sm" variant="flat" color="default" className="text-[11px] py-0">
                              {item}
                            </Chip>
                          ))}
                          {contact.interests.length > 2 && (
                            <Chip size="sm" variant="bordered" className="text-[10px] py-0">
                              +{contact.interests.length - 2}
                            </Chip>
                          )}
                        </div>
                      ) : (
                        <span className="text-default-400 text-xs">—</span>
                      )}
                    </TableCell>
                    {/* Follow-up Employee (الموظف المتابع) prominently displayed */}
                    <TableCell>
                      {assignee ? (
                        <div className="flex items-center gap-2">
                          <UserAvatar
                            name={assignee.name}
                            avatarProps={{
                              src: assignee.avatar,
                              size: "sm",
                            }}
                            className="text-xs font-semibold"
                          />
                          <span className="text-xs font-bold text-primary">
                            {assignee.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-default-400 italic">
                          {t("contacts.filters.unassigned")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-default-500 text-xs">{formatDate(contact.createdAt)}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        as={Link}
                        to={`/crm/contacts/${contact.id}`}
                        size="sm"
                        variant="light"
                        color="primary"
                        className="font-bold rounded-xl"
                      >
                        {t("contacts.details")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        /* VIEW 2: Unified Phone Directory (دليل الأرقام الموحد - جميع الأرقام في موقع واحد) */
        <div className="space-y-4">
          <div className="p-4 bg-gradient-to-r from-primary-500/10 via-emerald-500/10 to-transparent rounded-3xl border border-primary-200/40 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary text-white rounded-2xl shadow-md shadow-primary/30">
                <BookUser className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-black text-lg text-default-900">{t("contacts.directory.title")}</h3>
                <p className="text-xs text-default-500">{t("contacts.directory.subtitle")}</p>
              </div>
            </div>
            <div className="text-sm font-bold bg-white dark:bg-default-100 px-4 py-2 rounded-2xl border border-default-200">
              {isAr ? `${formatNumber(pipeline.total)} جهة اتصال` : `${formatNumber(pipeline.total)} contacts`}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pipeline.items.map((contact) => {
              const assignee = assigneeUser(contact.assignedTo);
              const mainPhone = contact.phone;
              const secondaryPhone = contact.secondaryPhone;
              const whatsapp = contact.whatsappPhone || contact.phone;

              return (
                <Card
                  key={contact.id}
                  className="glass-card hover:shadow-lg hover:border-primary-300 transition-all border border-default-200/80 rounded-3xl"
                >
                  <CardBody className="p-5 space-y-4">
                    {/* Header info */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          name={contactDisplayName(contact)}
                          avatarProps={{
                            src: contact.email ? `https://avatar.vercel.sh/${contact.email}` : undefined,
                            size: "md",
                          }}
                          className="font-bold"
                        />
                        <div>
                          <Link
                            to={`/crm/contacts/${contact.id}`}
                            className="font-bold text-base hover:text-primary transition-colors block"
                          >
                            {contactDisplayName(contact)}
                          </Link>
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {renderEntityTypeBadge(contact.entityType)}
                            {renderRelationshipsChips(contact.relationships)}
                          </div>
                          {contact.accountName ? (
                            <span className="text-xs text-default-500 flex items-center gap-1 font-medium mt-1">
                              <Building2 className="h-3 w-3 text-default-400" />
                              {contact.accountName}
                            </span>
                          ) : (
                            <span className="text-xs text-default-400 block mt-1">{contact.jobTitle || "—"}</span>
                          )}
                          {contact.associatedContacts && contact.associatedContacts.length > 0 && (
                            <div className="text-[11px] text-default-600 mt-1 flex items-center gap-1 bg-default-100/50 px-2 py-0.5 rounded-md">
                              <span className="text-warning-500 font-bold">⭐</span>
                              <span className="font-semibold">
                                {contact.associatedContacts.find((c) => c.isPrimary)?.name || contact.associatedContacts[0]?.name}
                              </span>
                              <span className="text-default-400 text-[10px]">
                                ({contact.associatedContacts.find((c) => c.isPrimary)?.jobTitle || contact.associatedContacts[0]?.jobTitle || (isAr ? "المسؤول" : "Primary")})
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {renderClassificationChip(contact.classification)}
                        {renderSatisfactionChip(contact.satisfaction)}
                      </div>
                    </div>

                    {/* Follow-up Employee (الموظف المتابع) */}
                    <div className="p-2.5 bg-default-100/60 rounded-2xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-default-500 font-medium">
                        <UserCheck className="h-3.5 w-3.5 text-primary" />
                        <span>{t("contacts.columns.assigned")}:</span>
                      </div>
                      {assignee ? (
                        <span className="font-bold text-primary flex items-center gap-1">
                          {assignee.name}
                        </span>
                      ) : (
                        <span className="text-default-400 italic">
                          {t("contacts.filters.unassigned")}
                        </span>
                      )}
                    </div>

                    {/* Client Interests */}
                    {contact.interests && contact.interests.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {contact.interests.map((tag) => (
                          <Chip key={tag} size="sm" variant="flat" color="default" className="text-[11px]">
                            {tag}
                          </Chip>
                        ))}
                      </div>
                    )}

                    {/* All Numbers Section */}
                    <div className="space-y-2 pt-1 border-t border-default-100">
                      {mainPhone ? (
                        <div className="flex items-center justify-between bg-primary-50/50 dark:bg-primary-950/20 p-2.5 rounded-2xl border border-primary-100">
                          <div className="flex items-center gap-2 font-mono text-sm font-bold text-default-800">
                            <Phone className="h-4 w-4 text-primary" />
                            <span>{mainPhone}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              isIconOnly
                              size="sm"
                              color="primary"
                              variant="flat"
                              className="rounded-xl h-8 w-8 min-w-8"
                              as="a"
                              href={`tel:${mainPhone}`}
                            >
                              <PhoneCall className="h-4 w-4" />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              className="rounded-xl h-8 w-8 min-w-8 text-default-500"
                              onClick={() => copyToClipboard(mainPhone)}
                            >
                              {copiedPhone === mainPhone ? (
                                <Check className="h-4 w-4 text-success" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-default-400 italic text-center py-2">
                          {t("contacts.directory.noPhone")}
                        </div>
                      )}

                      {/* Secondary Phone if available */}
                      {secondaryPhone && (
                        <div className="flex items-center justify-between bg-default-100/40 p-2 rounded-2xl">
                          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-default-600">
                            <span className="text-[10px] text-default-400">إضافي:</span>
                            <span>{secondaryPhone}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              className="rounded-xl h-7 w-7 min-w-7 text-primary"
                              as="a"
                              href={`tel:${secondaryPhone}`}
                            >
                              <PhoneCall className="h-3 w-3" />
                            </Button>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              className="rounded-xl h-7 w-7 min-w-7 text-default-500"
                              onClick={() => copyToClipboard(secondaryPhone)}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* WhatsApp Fast Action Button */}
                      {whatsapp && (
                        <Button
                          fullWidth
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<MessageSquare className="h-4 w-4 text-emerald-600" />}
                          className="font-bold rounded-2xl mt-2 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200"
                          as="a"
                          href={formatWhatsappLink(whatsapp)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("contacts.directory.whatsapp")}: {whatsapp}
                        </Button>
                      )}
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="flex justify-center pt-2">
        <Pagination
          total={pipeline.totalPages}
          page={pipeline.page}
          onChange={(page) => setParams((p) => ({ ...p, page }))}
        />
      </div>

      <ContactFormModal isOpen={formOpen} onOpenChange={setFormOpen} />
      <ManageClassificationsModal
        isOpen={manageClassificationsOpen}
        onOpenChange={setManageClassificationsOpen}
      />
    </div>
  );
}
