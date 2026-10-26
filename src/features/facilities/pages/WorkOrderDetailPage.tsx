import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Textarea,
} from "@heroui/react";
import { ArrowLeft, CalendarClock, Wrench } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  useAssets,
  useFacilities,
  usePmSchedules,
  useVendors,
  useWorkOrder,
  useTransitionWorkOrderMutation,
} from "../hooks/use-facilities";
import {
  allowedNextStatuses,
  isWorkOrderOverdue,
  todayIso,
  workOrderTotalCost,
} from "../lib/work-order-rules";
import { PRIORITY_COLORS, WO_STATUS_COLORS, nameOf } from "../lib/ui-maps";
import { WorkOrderFormModal } from "../components/WorkOrderFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { WorkOrderStatus } from "../types/facilities.types";

export function WorkOrderDetailPage() {
  const { t, i18n } = useTranslation("facilities");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");

  const { data: wo, isLoading } = useWorkOrder(id);
  const { data: facilities = [] } = useFacilities();
  const { data: assets = [] } = useAssets();
  const { data: vendors = [] } = useVendors();
  const { data: schedules = [] } = usePmSchedules();
  const { data: allUsers = [] } = useAllUsers();
  const transition = useTransitionWorkOrderMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [laborCost, setLaborCost] = useState("");

  // Completion captures the final cost buckets — prefill from the working values.
  const openComplete = () => {
    if (!wo) return;
    setNote("");
    setPartsCost(wo.partsCost ? String(wo.partsCost) : "");
    setLaborCost(wo.laborCost ? String(wo.laborCost) : "");
    setCompleting(true);
  };

  if (isLoading) return <p className="py-10 text-center text-sm text-default-400">…</p>;
  if (!wo) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-sm text-default-500">{t("workOrdersPage.notFound")}</p>
        <Button
          variant="light"
          startContent={<ArrowLeft className="w-4 h-4" />}
          onPress={() => navigate("/facilities/work-orders")}
        >
          {t("buttons.back")}
        </Button>
      </div>
    );
  }

  const userName = (uid?: string | null) => {
    if (!uid) return t("misc.unassigned");
    const u = allUsers.find((x) => x.id === uid);
    return u ? localizedName(i18n.language, u) || u.name : uid;
  };

  const schedule = wo.scheduleId ? schedules.find((s) => s.id === wo.scheduleId) : undefined;
  const nextStates = allowedNextStatuses(wo.status);
  const overdue = isWorkOrderOverdue(wo.dueDate, wo.status, todayIso());
  const total = workOrderTotalCost(wo.partsCost, wo.laborCost);

  const runTransition = async (to: WorkOrderStatus, payload?: { note?: string; partsCost?: number; laborCost?: number }) => {
    await transition.mutateAsync({ id: wo.id, to, ...payload });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="flat" onPress={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-primary" />
            {wo.code}
          </h1>
          <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[wo.status]}>
            {t(`status.${wo.status}`)}
          </Chip>
          <Chip size="sm" variant="flat" color={PRIORITY_COLORS[wo.priority]}>
            {t(`priority.${wo.priority}`)}
          </Chip>
          {overdue && <Chip size="sm" variant="flat" color="danger">{t("misc.overdueBadge")}</Chip>}
          {schedule && (
            <Chip size="sm" variant="flat" color="primary" startContent={<CalendarClock className="w-3.5 h-3.5" />}>
              {t("workOrdersPage.linkedSchedule")}
            </Chip>
          )}
        </div>
        {canManage && (
          <Button color="primary" variant="flat" onPress={() => setEditOpen(true)}>
            {t("buttons.edit")}
          </Button>
        )}
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="col-span-2">
            <p className="text-xs text-default-400">{t("fields.title")}</p>
            <p className="font-medium text-default-900">{wo.title}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.assignee")}</p>
            <p className="font-medium text-default-800">{userName(wo.assigneeId)}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.requestedBy")}</p>
            <p className="font-medium text-default-800">{userName(wo.requestedBy)}</p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.facility")}</p>
            <p className="font-medium text-default-800">
              {wo.facilityId ? nameOf(facilities, wo.facilityId) ?? t("misc.removedRef") : t("misc.none")}
            </p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.asset")}</p>
            <p className="font-medium text-default-800">
              {wo.assetId ? nameOf(assets, wo.assetId) ?? t("misc.removedRef") : t("misc.none")}
            </p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.vendor")}</p>
            <p className="font-medium text-default-800">
              {wo.vendorId ? nameOf(vendors, wo.vendorId) ?? t("misc.removedRef") : t("misc.none")}
            </p>
          </div>
          <div>
            <p className="text-xs text-default-400">{t("fields.dueDate")}</p>
            <p className="font-medium text-default-800">{wo.dueDate ? formatDate(wo.dueDate) : "—"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-default-400">{t("fields.createdAt")}</p>
            <p className="font-medium text-default-800">{formatDate(wo.createdAt)}</p>
          </div>
          {wo.completedAt && (
            <div className="col-span-2">
              <p className="text-xs text-default-400">{t("fields.completedAt")}</p>
              <p className="font-medium text-default-800">{formatDate(wo.completedAt)}</p>
            </div>
          )}
          {wo.description && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-default-400">{t("fields.description")}</p>
              <p className="text-default-700 whitespace-pre-line">{wo.description}</p>
            </div>
          )}
          {wo.completionNote && (
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-default-400">{t("fields.completionNote")}</p>
              <p className="text-default-700 whitespace-pre-line">{wo.completionNote}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-base font-semibold">{t("workOrdersPage.transitionTitle")}</CardHeader>
          <CardBody className="space-y-3">
            {nextStates.length === 0 ? (
              <p className="text-sm text-default-500">
                {wo.status === "completed"
                  ? t("workOrdersPage.costsFrozen")
                  : t(`status.${wo.status}`)}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {nextStates.map((to) => (
                  <Button
                    key={to}
                    size="sm"
                    variant={to === "completed" ? "solid" : to === "cancelled" ? "bordered" : "flat"}
                    color={to === "completed" ? "success" : to === "cancelled" ? "danger" : "default"}
                    isDisabled={!canManage || transition.isPending}
                    onPress={() => {
                      if (to === "completed") openComplete();
                      else if (to === "cancelled") setCancelling(true);
                      else void runTransition(to);
                    }}
                  >
                    {t("workOrdersPage.moveTo")} {t(`status.${to}`)}
                  </Button>
                ))}
              </div>
            )}
            {!canManage && nextStates.length > 0 && (
              <p className="text-xs text-default-400">{t("workOrdersPage.editNote")}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-base font-semibold">{t("fields.totalCost")}</CardHeader>
          <CardBody className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-default-400">{t("fields.partsCost")}</p>
              <p className="font-medium tabular-nums">{formatCurrency(wo.partsCost, wo.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-default-400">{t("fields.laborCost")}</p>
              <p className="font-medium tabular-nums">{formatCurrency(wo.laborCost, wo.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-default-400">{t("fields.totalCost")}</p>
              <p className="font-semibold tabular-nums">{formatCurrency(total, wo.currency)}</p>
            </div>
            {wo.status === "completed" && (
              <p className="col-span-3 text-xs text-default-400">{t("workOrdersPage.costsFrozen")}</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="text-base font-semibold">{t("workOrdersPage.history")}</CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                <th className="px-4 py-2.5 text-start">{t("workOrdersPage.moveTo")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.assignee")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.createdAt")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {wo.statusHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-default-400">
                    {t("workOrdersPage.noHistory")}
                  </td>
                </tr>
              ) : (
                wo.statusHistory.map((h, idx) => (
                  <tr key={`${h.at}-${idx}`} className="border-b border-default-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[h.from]}>{t(`status.${h.from}`)}</Chip>
                    </td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={WO_STATUS_COLORS[h.to]}>{t(`status.${h.to}`)}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-default-600">{userName(h.by)}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{formatDate(h.at)}</td>
                    <td className="px-4 py-2.5 text-sm text-default-600 max-w-[280px]">{h.note || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <WorkOrderFormModal isOpen={editOpen} onOpenChange={setEditOpen} workOrder={wo} />

      {/* Completion: note is mandatory, final costs captured — then the schedule rolls. */}
      <ConfirmModal
        isOpen={completing}
        onOpenChange={setCompleting}
        title={t("workOrdersPage.completeConfirmTitle")}
        body={t("workOrdersPage.completeConfirmBody")}
        confirmLabel={t("workOrdersPage.completeButton")}
        cancelLabel={t("buttons.cancel")}
        isLoading={transition.isPending}
        confirmDisabled={!note.trim()}
        onConfirm={async () => {
          await runTransition("completed", {
            note: note.trim(),
            partsCost: Number(partsCost) || 0,
            laborCost: Number(laborCost) || 0,
          });
          setCompleting(false);
        }}
      >
        <div className="space-y-3">
          <Textarea
            label={t("fields.completionNote")}
            placeholder={t("workOrdersPage.notePlaceholder")}
            value={note}
            onValueChange={setNote}
            minRows={2}
            isInvalid={!note.trim()}
            errorMessage={t("workOrdersPage.noteRequired")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              min={0}
              step="0.01"
              label={t("fields.partsCost")}
              value={partsCost}
              onValueChange={setPartsCost}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              label={t("fields.laborCost")}
              value={laborCost}
              onValueChange={setLaborCost}
            />
          </div>
        </div>
      </ConfirmModal>

      {/* Cancellation is terminal — always behind an explicit confirm. */}
      <ConfirmModal
        isOpen={cancelling}
        onOpenChange={setCancelling}
        title={t("workOrdersPage.cancelConfirmTitle")}
        body={t("workOrdersPage.cancelConfirmBody")}
        confirmLabel={t("workOrdersPage.cancelButton")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={transition.isPending}
        onConfirm={async () => {
          await runTransition("cancelled");
          setCancelling(false);
        }}
      />
    </div>
  );
}
