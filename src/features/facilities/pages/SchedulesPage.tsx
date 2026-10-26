import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Input } from "@heroui/react";
import { CalendarClock, Plus, Search } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { formatDate } from "@/lib/utils";
import {
  useAssets,
  useDeleteScheduleMutation,
  useGenerateWorkOrderMutation,
  usePmSchedules,
} from "../hooks/use-facilities";
import { scheduleDueState, scheduleNeedsWorkOrder, todayIso } from "../lib/work-order-rules";
import { DUE_STATE_COLORS } from "../lib/ui-maps";
import { ScheduleFormModal } from "../components/ScheduleFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type { PmSchedule } from "../types/facilities.types";

export function SchedulesPage() {
  const { t, i18n } = useTranslation("facilities");
  const { can } = useAppPermissions();
  const canManage = can("facilities.manage");
  const canDelete = can("facilities.delete");

  const { data: schedules = [], isLoading } = usePmSchedules();
  const { data: assets = [] } = useAssets();
  const { data: allUsers = [] } = useAllUsers();
  const deleteSchedule = useDeleteScheduleMutation();
  const generateWo = useGenerateWorkOrderMutation();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PmSchedule | null>(null);
  const [deleting, setDeleting] = useState<PmSchedule | null>(null);
  /** Row id → last generate outcome, shown inline until the next action. */
  const [feedback, setFeedback] = useState<{ id: string; text: string } | null>(null);

  const today = todayIso();

  const rows = useMemo(
    () => schedules.filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase())),
    [schedules, search],
  );

  const assetLabel = (id?: string | null) => {
    if (!id) return t("misc.none");
    const a = assets.find((x) => x.id === id);
    return a ? `${a.tag} — ${a.name}` : t("misc.removedRef");
  };

  const assigneeLabel = (id?: string | null) => {
    if (!id) return t("misc.unassigned");
    const u = allUsers.find((x) => x.id === id);
    return u ? localizedName(i18n.language, u) || u.name : id;
  };

  const onGenerate = async (s: PmSchedule) => {
    const res = await generateWo.mutateAsync(s.id);
    // Service is idempotent per business day: "already raised" means a duplicate was avoided.
    const existed = (res.message ?? "").includes("already");
    setFeedback({
      id: s.id,
      text: existed ? t("schedulesPage.generateExists") : t("schedulesPage.generateDone", { code: res.data?.code ?? "" }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            {t("schedulesPage.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("schedulesPage.subtitle")}</p>
        </div>
        {canManage && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("buttons.new")}
          </Button>
        )}
      </div>

      <Input
        placeholder={t("buttons.search")}
        value={search}
        onValueChange={setSearch}
        startContent={<Search className="w-4 h-4 text-default-400" />}
        className="max-w-xs"
      />

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.asset")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.intervalDays")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.lastDone")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.nextDue")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.assignee")}</th>
                {(canManage || canDelete) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-default-400">
                    {t("schedulesPage.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((s) => {
                  const state = scheduleDueState(s.nextDueDate, today);
                  const dueNow = scheduleNeedsWorkOrder({ nextDueDate: s.nextDueDate, active: s.active }, today);
                  return (
                    <tr key={s.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-default-800">{s.title}</p>
                        {feedback?.id === s.id && (
                          <p className="text-xs text-primary mt-0.5">{feedback.text}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-default-600">{assetLabel(s.assetId)}</td>
                      <td className="px-4 py-2.5 text-xs text-default-500">
                        {t("schedulesPage.everyNDays", { days: s.intervalDays })}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-default-500">
                        {s.lastDoneDate ? formatDate(s.lastDoneDate) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2 text-xs text-default-500">
                          {formatDate(s.nextDueDate)}
                          <Chip size="sm" variant="flat" color={s.active ? DUE_STATE_COLORS[state] : "default"}>
                            {s.active ? t(`dueState.${state}`) : t("misc.paused")}
                          </Chip>
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-default-600">{assigneeLabel(s.assigneeId)}</td>
                      {(canManage || canDelete) && (
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {canManage && dueNow && (
                              <Button
                                size="sm"
                                variant="flat"
                                color="primary"
                                isLoading={generateWo.isPending && generateWo.variables === s.id}
                                onPress={() => void onGenerate(s)}
                              >
                                {t("buttons.generate")}
                              </Button>
                            )}
                            {canManage && (
                              <Button
                                size="sm"
                                variant="light"
                                onPress={() => {
                                  setEditing(s);
                                  setFormOpen(true);
                                }}
                              >
                                {t("buttons.edit")}
                              </Button>
                            )}
                            {canDelete && (
                              <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(s)}>
                                {t("buttons.delete")}
                              </Button>
                            )}
                          </div>
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

      <ScheduleFormModal isOpen={formOpen} onOpenChange={setFormOpen} schedule={editing} />

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("schedulesPage.title")}
        body={deleting ? `${deleting.title} — ${t("schedulesPage.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteSchedule.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteSchedule.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
