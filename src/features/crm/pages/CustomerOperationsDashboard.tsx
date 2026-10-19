import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardBody,
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Tab,
  Tabs,
} from "@heroui/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Briefcase,
  ListTodo,
  Users,
  Search,
  ArrowUpRight,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { useCustomerOperations, type CustomerOperations } from "../hooks/use-customer-operations";
import { formatDate } from "@/lib/utils";
import { MoneyAmount } from "@/components/shared/riyal-symbol";

export function CustomerOperationsDashboard() {
  const { i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { data: operations, isLoading } = useCustomerOperations();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("all");

  const filteredOperations = operations?.filter((op) => {
    const matchesSearch =
      !searchQuery ||
      op.customerName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter =
      filterType === "all" ||
      (filterType === "attention" && op.attentionRequired) ||
      (filterType === "overdue_invoices" && op.overdueInvoicesCount > 0) ||
      (filterType === "pending_contracts" && op.pendingContractsCount > 0) ||
      (filterType === "overdue_tasks" && op.overdueTasksCount > 0) ||
      (filterType === "outstanding_balance" && op.totalDue > 0);

    const matchesTab =
      activeTab === "all" ||
      (activeTab === "attention" && op.attentionRequired) ||
      (activeTab === "active" && op.activeDealsCount > 0) ||
      (activeTab === "completed" && op.wonDealsCount > 0 && op.activeDealsCount === 0);

    return matchesSearch && matchesFilter && matchesTab;
  }) || [];

  const totalCustomers = operations?.length || 0;
  const totalAttentionRequired = operations?.filter((o) => o.attentionRequired).length || 0;
  const totalOverdueInvoices = operations?.reduce((sum, o) => sum + o.overdueInvoicesCount, 0) || 0;
  const totalOutstanding = operations?.reduce((sum, o) => sum + o.totalDue, 0) || 0;
  const totalInvoiced = operations?.reduce((sum, o) => sum + o.totalInvoiced, 0) || 0;
  const totalCollected = operations?.reduce((sum, o) => sum + o.totalCollected, 0) || 0;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={isAr ? "لوحة عمليات العملاء" : "Customer Operations Dashboard"}
        description={
          isAr
            ? "نظرة شاملة على حالة جميع العملاء عبر دورة حياتهم الكاملة"
            : "Comprehensive view of all customers across their entire lifecycle"
        }
      />

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="border border-default-200 bg-default-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-default-500">
              <Users className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "إجمالي العملاء" : "Total Customers"}
              </span>
            </div>
            <div className="text-2xl font-black text-foreground">{totalCustomers}</div>
          </CardBody>
        </Card>

        <Card className="border border-warning-200 bg-warning-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-warning-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "يحتاج انتباه" : "Attention Required"}
              </span>
            </div>
            <div className="text-2xl font-black text-warning-600">
              {totalAttentionRequired}
            </div>
          </CardBody>
        </Card>

        <Card className="border border-danger-200 bg-danger-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-danger-600">
              <FileText className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "فواتير متأخرة" : "Overdue Invoices"}
              </span>
            </div>
            <div className="text-2xl font-black text-danger-600">
              {totalOverdueInvoices}
            </div>
          </CardBody>
        </Card>

        <Card className="border border-primary-200 bg-primary-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-primary-600">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "مستحقات" : "Outstanding"}
              </span>
            </div>
            <div className="text-lg font-black text-primary-600">
              <MoneyAmount amount={totalOutstanding} />
            </div>
          </CardBody>
        </Card>

        <Card className="border border-success-200 bg-success-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-success-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "إجمالي الفوترة" : "Total Invoiced"}
              </span>
            </div>
            <div className="text-lg font-black text-success-600">
              <MoneyAmount amount={totalInvoiced} />
            </div>
          </CardBody>
        </Card>

        <Card className="border border-secondary-200 bg-secondary-50/50">
          <CardBody className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-secondary-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-bold uppercase">
                {isAr ? "تم التحصيل" : "Collected"}
              </span>
            </div>
            <div className="text-lg font-black text-secondary-600">
              <MoneyAmount amount={totalCollected} />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={isAr ? "بحث عن عميل..." : "Search customers..."}
          startContent={<Search className="h-4 w-4 text-default-400" />}
          value={searchQuery}
          onValueChange={setSearchQuery}
          className="max-w-xs"
          variant="bordered"
        />
        <Select
          placeholder={isAr ? "تصفية حسب الحالة" : "Filter by status"}
          selectedKeys={[filterType]}
          onSelectionChange={(keys) => setFilterType(Array.from(keys)[0] as string)}
          className="max-w-xs"
          variant="bordered"
          disallowEmptySelection
        >
          <SelectItem key="all">{isAr ? "الكل" : "All"}</SelectItem>
          <SelectItem key="attention">
            {isAr ? "يحتاج انتباه" : "Attention Required"}
          </SelectItem>
          <SelectItem key="overdue_invoices">
            {isAr ? "فواتير متأخرة" : "Overdue Invoices"}
          </SelectItem>
          <SelectItem key="pending_contracts">
            {isAr ? "عقود معلقة" : "Pending Contracts"}
          </SelectItem>
          <SelectItem key="overdue_tasks">
            {isAr ? "مهام متأخرة" : "Overdue Tasks"}
          </SelectItem>
          <SelectItem key="outstanding_balance">
            {isAr ? "رصيد مستحق" : "Outstanding Balance"}
          </SelectItem>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(k: string | number) => setActiveTab(String(k))}
        variant="underlined"
      >
        <Tab key="all" title={isAr ? "الكل" : "All"} />
        <Tab
          key="attention"
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              {isAr ? "يحتاج انتباه" : "Attention Required"}
            </span>
          }
        />
        <Tab key="active" title={isAr ? "نشط" : "Active"} />
        <Tab key="completed" title={isAr ? "مكتمل" : "Completed"} />
      </Tabs>

      {/* Customer Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOperations.map((op) => (
          <CustomerCard key={op.customerId} operation={op} isAr={isAr} />
        ))}
      </div>

      {filteredOperations.length === 0 && (
        <div className="text-center py-12 text-default-500">
          <Users className="h-12 w-12 mx-auto mb-4 text-default-300" />
          <p className="font-medium">
            {isAr ? "لا توجد نتائج مطابقة" : "No matching results"}
          </p>
        </div>
      )}
    </div>
  );
}

function CustomerCard({
  operation,
  isAr,
}: {
  operation: CustomerOperations;
  isAr: boolean;
}) {
  return (
    <Card
      className={`border transition-all hover:shadow-md ${
        operation.attentionRequired
          ? "border-warning-300 bg-warning-50/30"
          : "border-default-200 bg-default-50/50"
      }`}
    >
      <CardBody className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-sm text-foreground line-clamp-1">
              {operation.customerName}
            </h4>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {operation.entityType && (
                <Chip size="sm" variant="flat" className="text-[10px] h-5">
                  {operation.entityType}
                </Chip>
              )}
              {operation.classification && (
                <Chip size="sm" variant="flat" color="primary" className="text-[10px] h-5">
                  {operation.classification}
                </Chip>
              )}
            </div>
          </div>
          {operation.attentionRequired && (
            <AlertTriangle className="h-5 w-5 text-warning-500 shrink-0" />
          )}
        </div>

        {/* Attention Reasons */}
        {operation.attentionRequired && operation.attentionReasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {operation.attentionReasons.map((reason) => (
              <Chip
                key={reason}
                size="sm"
                variant="flat"
                color="warning"
                className="text-[10px] h-5"
              >
                {isAr ? getAttentionReasonAr(reason) : getAttentionReasonEn(reason)}
              </Chip>
            ))}
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-background border border-default-200">
            <div className="flex items-center gap-1 text-default-500 mb-1">
              <Briefcase className="h-3 w-3" />
              <span>{isAr ? "الصفقات" : "Deals"}</span>
            </div>
            <div className="font-bold text-foreground">
              {operation.activeDealsCount}/{operation.dealsCount}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-default-200">
            <div className="flex items-center gap-1 text-default-500 mb-1">
              <FileText className="h-3 w-3" />
              <span>{isAr ? "العقود" : "Contracts"}</span>
            </div>
            <div className="font-bold text-foreground">
              {operation.contractsCount}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-default-200">
            <div className="flex items-center gap-1 text-default-500 mb-1">
              <ListTodo className="h-3 w-3" />
              <span>{isAr ? "المهام" : "Tasks"}</span>
            </div>
            <div className="font-bold text-foreground">
              {operation.completedTasksCount}/{operation.tasksCount}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-background border border-default-200">
            <div className="flex items-center gap-1 text-default-500 mb-1">
              <DollarSign className="h-3 w-3" />
              <span>{isAr ? "المستحق" : "Due"}</span>
            </div>
            <div className="font-bold text-foreground">
              <MoneyAmount amount={operation.totalDue} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-default-200">
          {operation.lastActivityDate && (
            <div className="flex items-center gap-1 text-[10px] text-default-500">
              <Clock className="h-3 w-3" />
              <span>{formatDate(operation.lastActivityDate)}</span>
            </div>
          )}
          <Button
            as={Link}
            to={`/crm/contacts/${operation.customerId}`}
            size="sm"
            variant="flat"
            color="primary"
            className="text-xs font-bold"
            endContent={<ArrowUpRight className="h-3 w-3" />}
          >
            {isAr ? "الملف 360" : "Customer 360"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function getAttentionReasonAr(reason: string): string {
  const map: Record<string, string> = {
    overdue_invoices: "فواتير متأخرة",
    overdue_tasks: "مهام متأخرة",
    pending_contracts: "عقود معلقة",
    contracts_without_tasks: "عقود بدون مهام",
    unassigned_tasks: "مهام غير معينة",
    no_won_deals: "لا توجد صفقات مكتسبة",
    outstanding_balance: "رصيد مستحق",
  };
  return map[reason] || reason;
}

function getAttentionReasonEn(reason: string): string {
  const map: Record<string, string> = {
    overdue_invoices: "Overdue Invoices",
    overdue_tasks: "Overdue Tasks",
    pending_contracts: "Pending Contracts",
    contracts_without_tasks: "Contracts Without Tasks",
    unassigned_tasks: "Unassigned Tasks",
    no_won_deals: "No Won Deals",
    outstanding_balance: "Outstanding Balance",
  };
  return map[reason] || reason;
}
