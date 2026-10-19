import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/features/companies/context/company-context";
import { ActivitiesService } from "../api/activities.service";
import { useContactsQuery } from "./use-contacts";
import { useDealsQuery } from "./use-deals";
import { useContractsQuery } from "./use-contracts";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { useInvoices } from "@/features/billing/hooks/use-invoices";
import { usePayments } from "@/features/billing/hooks/use-payments";
import {
  buildCustomerTimeline,
  scopeCustomerRecords,
  type TimelineEvent,
} from "../utils/lifecycle-timeline";

/**
 * Unified customer lifecycle timeline for a single canonical customer (contact id).
 *
 * All source hooks already enforce tenant + role access filtering; this hook only
 * resolves relationships by persisted IDs and aggregates real, retained events.
 */
export function useCustomerTimeline(contactId: string) {
  const { companyId } = useCompany();

  const { data: contactsRes } = useContactsQuery();
  const { data: dealsRes } = useDealsQuery();
  const { data: contractsRes } = useContractsQuery();
  const { data: tasksRes } = useAllTasksQuery();
  const { data: invoicesData } = useInvoices();
  const { data: paymentsData } = usePayments();

  const { data: activitiesRes } = useQuery({
    queryKey: ["crm", "activities", companyId],
    queryFn: () => ActivitiesService.getActivities(companyId!),
    enabled: !!companyId,
  });

  return useQuery<TimelineEvent[]>({
    queryKey: ["customer-timeline", companyId, contactId],
    enabled: !!companyId && !!contactId,
    staleTime: 30 * 1000,
    queryFn: () => {
      const scoped = scopeCustomerRecords(contactId, {
        contacts: contactsRes?.data ?? [],
        deals: dealsRes?.data ?? [],
        contracts: contractsRes?.data ?? [],
        tasks: tasksRes?.data ?? [],
        invoices: invoicesData ?? [],
        payments: paymentsData ?? [],
        activities: activitiesRes?.data ?? [],
      });
      return buildCustomerTimeline(scoped);
    },
  });
}
