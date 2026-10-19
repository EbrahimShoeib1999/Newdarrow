import { useQuery } from "@tanstack/react-query";
import { useContactsQuery } from "./use-contacts";
import { useDealsQuery } from "./use-deals";
import { useContractsQuery } from "./use-contracts";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { useInvoices } from "@/features/billing/hooks/use-invoices";
import { useCompany } from "@/features/companies/context/company-context";
import { getInvoiceAmountDue } from "@/features/billing/utils/accounting-engine";
import type { Invoice } from "@/features/billing/schemas/invoice";

export interface CustomerOperations {
  customerId: string;
  customerName: string;
  entityType?: string;
  classification?: string;
  status?: string;
  dealsCount: number;
  dealsValue: number;
  activeDealsCount: number;
  wonDealsCount: number;
  contractsCount: number;
  pendingContractsCount: number;
  contractsWithoutTasksCount: number;
  tasksCount: number;
  completedTasksCount: number;
  overdueTasksCount: number;
  unassignedTasksCount: number;
  invoicesCount: number;
  totalInvoiced: number;
  totalCollected: number;
  totalDue: number;
  overdueInvoicesCount: number;
  lastActivityDate?: string;
  attentionRequired: boolean;
  attentionReasons: string[];
}

export function useCustomerOperations() {
  const { companyId } = useCompany();
  const { data: contactsRes } = useContactsQuery();
  const { data: dealsRes } = useDealsQuery();
  const { data: contractsRes } = useContractsQuery();
  const { data: tasksRes } = useAllTasksQuery();
  // useInvoices() already unwraps the query result to Invoice[] (no nested `.data`).
  const { data: invoicesData } = useInvoices();

  const contacts = contactsRes?.data || [];
  const deals = dealsRes?.data || [];
  const contracts = contractsRes?.data || [];
  const tasks = tasksRes?.data || [];
  const invoices = invoicesData || [];

  return useQuery({
    queryKey: ["customer-operations", companyId],
    queryFn: () => {
      const operations: CustomerOperations[] = contacts.map((contact) => {
        const contactId = contact.id;
        const customerName = contact.accountName || contact.fullName || contact.firstName;

        // Deals
        const contactDeals = deals.filter((d) => d.contactId === contactId);
        const dealsCount = contactDeals.length;
        const dealsValue = contactDeals.reduce((sum, d) => sum + d.amount, 0);
        const activeDealsCount = contactDeals.filter(
          (d) => d.stage !== "won" && d.stage !== "lost"
        ).length;
        const wonDealsCount = contactDeals.filter((d) => d.stage === "won").length;

        // Contracts
        const contactContracts = contracts.filter((c) => c.contactId === contactId);
        const contractsCount = contactContracts.length;
        const pendingContractsCount = contactContracts.filter(
          (c) => c.approvalStatus === "pending"
        ).length;
        const contractsWithoutTasksCount = contactContracts.filter(
          (c) => !c.convertedToTasks
        ).length;

        // Tasks (direct contact link or via contract/deal)
        const contractIds = new Set(contactContracts.map((c) => c.id));
        const dealIds = new Set(contactDeals.map((d) => d.id));
        const contactTasks = tasks.filter(
          (t) =>
            t.contactId === contactId ||
            (t.contractId && contractIds.has(t.contractId)) ||
            (t.dealId && dealIds.has(t.dealId))
        );
        const tasksCount = contactTasks.length;
        const completedTasksCount = contactTasks.filter((t) => t.status === "done").length;
        const overdueTasksCount = contactTasks.filter(
          (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done"
        ).length;
        const unassignedTasksCount = contactTasks.filter((t) => !t.assigneeId).length;

        // Invoices
        const contactInvoices = invoices.filter((inv: Invoice) => inv.customerId === contactId);
        const invoicesCount = contactInvoices.length;
        const totalInvoiced = contactInvoices.reduce((sum: number, inv: Invoice) => sum + inv.grandTotal, 0);
        const totalCollected = contactInvoices.reduce((sum: number, inv: Invoice) => sum + (inv.amountPaid || 0), 0);
        const totalDue = contactInvoices.reduce((sum: number, inv: Invoice) => sum + getInvoiceAmountDue(inv), 0);
        const overdueInvoicesCount = contactInvoices.filter(
          (inv: Invoice) => inv.status === "overdue"
        ).length;

        // Last activity
        const allDates = [
          contact.updatedAt,
          ...contactDeals.map((d) => d.updatedAt),
          ...contactContracts.map((c) => c.updatedAt),
          ...contactTasks.map((t) => t.updatedAt),
          ...contactInvoices.map((inv: Invoice) => inv.updatedAt || inv.createdAt),
        ].filter((d): d is string | Date => Boolean(d));
        const lastActivityDate = allDates.length > 0
          ? new Date(
              Math.max(...allDates.map((d) => (d instanceof Date ? d.getTime() : new Date(d).getTime())))
            ).toISOString()
          : undefined;

        // Attention required
        const attentionReasons: string[] = [];
        if (overdueInvoicesCount > 0) attentionReasons.push("overdue_invoices");
        if (overdueTasksCount > 0) attentionReasons.push("overdue_tasks");
        if (pendingContractsCount > 0) attentionReasons.push("pending_contracts");
        if (contractsWithoutTasksCount > 0) attentionReasons.push("contracts_without_tasks");
        if (unassignedTasksCount > 0) attentionReasons.push("unassigned_tasks");
        if (activeDealsCount > 0 && wonDealsCount === 0) attentionReasons.push("no_won_deals");
        if (totalDue > 0) attentionReasons.push("outstanding_balance");

        return {
          customerId: contactId,
          customerName,
          entityType: contact.entityType,
          classification: contact.classification,
          status: contact.status,
          dealsCount,
          dealsValue,
          activeDealsCount,
          wonDealsCount,
          contractsCount,
          pendingContractsCount,
          contractsWithoutTasksCount,
          tasksCount,
          completedTasksCount,
          overdueTasksCount,
          unassignedTasksCount,
          invoicesCount,
          totalInvoiced,
          totalCollected,
          totalDue,
          overdueInvoicesCount,
          lastActivityDate,
          attentionRequired: attentionReasons.length > 0,
          attentionReasons,
        };
      });

      // Sort by attention required first, then by last activity date
      return operations.sort((a, b) => {
        if (a.attentionRequired && !b.attentionRequired) return -1;
        if (!a.attentionRequired && b.attentionRequired) return 1;
        if (a.lastActivityDate && b.lastActivityDate) {
          return new Date(b.lastActivityDate).getTime() - new Date(a.lastActivityDate).getTime();
        }
        return 0;
      });
    },
    enabled: !!companyId && !!contactsRes && !!dealsRes && !!contractsRes && !!tasksRes,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
