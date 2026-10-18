import type { PortalId } from "@/lib/portal-permissions";
import { useAllTasksQuery } from "@/features/tasks/hooks/use-tasks";
import { useLeadsQuery } from "@/features/crm/hooks/use-leads";
import { useLeaveRequestsQuery } from "@/features/people/hooks/use-people";
import { useProjects } from "@/features/projects/hooks/use-projects";
import { useInvoices } from "@/features/billing/hooks/use-invoices";

export function usePortalStat(portal: PortalId): number | null {
  const { data: tasks } = useAllTasksQuery();
  const { data: leads } = useLeadsQuery();
  const { data: leaveRequests } = useLeaveRequestsQuery();
  const { data: projects } = useProjects();
  const { data: invoices } = useInvoices();

  switch (portal) {
    case "tasks":
      return (tasks?.data ?? []).filter((t) => t.status !== "done").length;
    case "crm":
      return leads?.data?.length ?? 0;
    case "people":
      return (leaveRequests?.data ?? []).filter((r) => r.status === "pending")
        .length;
    case "billing":
      return (invoices ?? []).filter((inv) => inv.status === "pending" || inv.status === "sent" || inv.status === "draft").length;
    case "projects":
      return (projects ?? []).filter((p) => p.status === "active").length;
    case "chat":
      return null;
    default:
      return null;
  }
}
