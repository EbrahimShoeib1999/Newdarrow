import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input, Select, SelectItem } from "@heroui/react";
import { Plus, Search, Wrench } from "lucide-react";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { useWorkOrders, useDeleteWorkOrderMutation } from "../hooks/use-facilities";
import { isWorkOrderOverdue, todayIso } from "../lib/work-order-rules";
import { PRIORITY_COLORS, WO_STATUS_COLORS } from "../lib/ui-maps";
import { WorkOrderFormModal } from "../components/WorkOrderFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { formatDate } from "@/lib/utils";
import type { WorkOrder, WorkOrderPriority, WorkOrderStatus } from "../types/facilities.types";

const STATUSES: WorkOrderStatus[] = [
  "requested",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];
const PRIORITIES: WorkOrderPriority[] = ["low", "medium", "high", "urgent"];

export function WorkOrdersListPage() {
  const { t, i18n } = useTranslation("facilities");
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");
  const canDelete = can("facilities.delete");

  const { data: workOrders = [], isLoading } = useWorkOrders();
  const { data: allUsers = [] } = useAllUsers();
  const deleteWo = useDeleteWorkOrderMutation();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<WorkOrderStatus | "all">("all");
  const [priority, setPriority] = useState<WorkOrderPriority | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkOrder | null>(null);

  const today = todayIso();

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return workOrders.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (priority !== "all" && w.priority !== priority) return false;
      if (!term) return true;
      return (
        w.title.toLowerCase().includes(term) ||
        w.code.toLowerCase().includes(term) ||
        (w.description ?? "").toLowerCase().includes(term)
      );
    });
  }, [workOrders, search, status, priority]);

  const assigneeName = (id?: string | null) => {
    if (!id) return t("misc.unassigned");
    const u = allUsers.find((x) => x.id === id);
    return u ? localizedName(i18n.language, u) || u.name : id;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-primary" />
            {t("workOrdersPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("workOrdersPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => setFormOpen(true)}
          >
            {t("buttons.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-xs"
        />
        <Select
          {...selectFieldProps()}
          placeholder={t("filters.allStatuses")}
          selectedKeys={[status]}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as WorkOrderStatus | "all" | undefined;
            if (v) setStatus(v);
          }}
          className="max-w-[180px]"
        >
          {["all", ...STATUSES].map((s) => (
            <SelectItem key={s}>{s === "all" ? t("filters.allStatuses") : t(`status.${s}`)}</SelectItem>
          ))}
        </Select>
        <Select
          {...selectFieldProps()}
          placeholder={t("filters.allPriorities")}
          selectedKeys={[priority]}
          onSelectionChange={(keys) => {
            const v = Array.from(keys)[0] as WorkOrderPriority | "all" | undefined;
            if (v) setPriority(v);
          }}
          className="max-w-[160px]"
        >
          {["all", ...PRIORITIES].map((p) => (
            <SelectItem key={p}>{p === "all" ? t("filters.allPriorities") : t(`priority.${p}`)}</SelectItem>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.code")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.priority")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.assignee")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.dueDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.createdAt")}</th>
                {canDelete && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("workOrdersPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((w) => {
                  const overdue = isWorkOrderOverdue(w.dueDate, w.status, today);
                  return (
                    <tr key={w.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                      <td className="px-4 py-2.5">
                        <Link to={`/facilities/work-orders/${w.id}`} className="text-primary font-medium text-sm">
                          {w.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-sm max-w-[260px] truncate">{w.title}</td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[w.status]}>
                          {t(`status.${w.status}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={PRIORITY_COLORS[w.priority]}>
                          {t(`priority.${w.priority}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-default-600">{assigneeName(w.assigneeId)}</td>
                      <td className="px-4 py-2.5 text-xs text-default-500">
                        <span className="flex items-center gap-2">
                          {formatDate(w.dueDate)}
                          {overdue && (
                            <Chip size="sm" variant="flat" color="danger">{t("misc.overdueBadge")}</Chip>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(w.createdAt)}</td>
                      {canDelete && (
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(w)}>
                            {t("buttons.delete")}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <WorkOrderFormModal isOpen={formOpen} onOpenChange={setFormOpen} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("workOrdersPage.title")}
        body={deleting ? `${deleting.code} — ${t("workOrdersPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteWo.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteWo.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
