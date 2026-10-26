import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from "@heroui/react";
import { Plus, Search, Send } from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { selectFieldProps } from "@/components/shared/select-field";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import {
  useCampaigns,
  useDeleteDeliverableMutation,
  useDeliverables,
  useSetClientApprovalMutation,
  useTransitionDeliverableMutation,
} from "../hooks/use-marketing";
import {
  allowedNextDeliverableStatuses,
  canPublishDeliverable,
  canSetClientApproval,
} from "../lib/deliverable-rules";
import { isDeliverableOverdue } from "../lib/campaign-rules";
import { CLIENT_APPROVAL_COLORS, DELIVERABLE_STATUS_COLORS } from "../lib/ui-maps";
import { DeliverableFormModal } from "../components/DeliverableFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import type {
  ClientApprovalState,
  Deliverable,
  DeliverableStatus,
} from "../types/marketing.types";

const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "not_started",
  "in_progress",
  "in_review",
  "revision_requested",
  "approved",
  "published",
  "cancelled",
];

/** Approval moves legal for the current internal state, derived from the rules lib. */
const APPROVAL_TARGETS: ClientApprovalState[] = ["pending", "approved", "rejected"];

export function DeliverablesListPage() {
  const { t, i18n } = useTranslation("marketing");
  const { can } = useAppPermissions();
  const canManage = can("marketing.manage");
  const canDelete = can("marketing.delete");

  const { data: deliverables = [], isLoading } = useDeliverables();
  const { data: campaigns = [] } = useCampaigns();
  const { data: allUsers = [] } = useAllUsers();

  const transitionDeliverable = useTransitionDeliverableMutation();
  const setClientApproval = useSetClientApprovalMutation();
  const deleteDeliverable = useDeleteDeliverableMutation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeliverableStatus | "">("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deliverable | null>(null);
  const [deleting, setDeleting] = useState<Deliverable | null>(null);
  const [transitioning, setTransitioning] = useState<Deliverable | null>(null);
  const [moveTo, setMoveTo] = useState<DeliverableStatus | "">("");
  const [moveNote, setMoveNote] = useState("");
  const [approving, setApproving] = useState<Deliverable | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const campaignLabel = (cid: string) => {
    const c = campaigns.find((x) => x.id === cid);
    return c ? `${c.code} — ${c.name}` : t("misc.removedRef");
  };
  const userName = (uid?: string | null) => {
    if (!uid) return t("misc.unassigned");
    const u = allUsers.find((x) => x.id === uid);
    return u ? localizedName(i18n.language, u) || u.name : uid;
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return deliverables.filter(
      (d) =>
        (!statusFilter || d.status === statusFilter) &&
        (!campaignFilter || d.campaignId === campaignFilter) &&
        (!term || d.title.toLowerCase().includes(term) || campaignLabel(d.campaignId).toLowerCase().includes(term)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverables, search, statusFilter, campaignFilter, campaigns]);

  const nextFor = transitioning ? allowedNextDeliverableStatuses(transitioning.status) : [];
  const publishBlocked =
    !!transitioning &&
    nextFor.includes("published") &&
    !canPublishDeliverable(transitioning);

  const approvalOptionsFor = (d: Deliverable) =>
    APPROVAL_TARGETS.filter((to) => canSetClientApproval(d.status, d.clientApprovalState, to));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2">
            <Send className="w-6 h-6 text-primary" />
            {t("deliverables.title")}
          </h1>
          <p className="text-sm text-default-500 mt-1">{t("deliverables.subtitle")}</p>
        </div>
        {canManage && campaigns.length > 0 && (
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("buttons.newDeliverable")}
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder={t("buttons.search")}
          value={search}
          onValueChange={setSearch}
          startContent={<Search className="w-4 h-4 text-default-400" />}
          className="max-w-sm"
        />
        <Select
          {...selectFieldProps({ compact: true })}
          placeholder={t("filters.allStatuses")}
          selectedKeys={statusFilter ? [statusFilter] : []}
          onSelectionChange={(keys) =>
            setStatusFilter((Array.from(keys)[0] as DeliverableStatus) ?? "")
          }
          className="max-w-[180px]"
        >
          {DELIVERABLE_STATUSES.map((s) => (
            <SelectItem key={s} textValue={t(`deliverableStatus.${s}`)}>
              {t(`deliverableStatus.${s}`)}
            </SelectItem>
          ))}
        </Select>
        <Select
          {...selectFieldProps({ compact: true })}
          placeholder={t("filters.allCampaigns")}
          selectedKeys={campaignFilter ? [campaignFilter] : []}
          onSelectionChange={(keys) => setCampaignFilter((Array.from(keys)[0] as string) ?? "")}
          className="max-w-[220px]"
        >
          {campaigns.map((c) => (
            <SelectItem key={c.id} textValue={`${c.code} — ${c.name}`}>
              {`${c.code} — ${c.name}`}
            </SelectItem>
          ))}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-default-200 bg-default-50/80 text-xs font-semibold uppercase tracking-wide text-default-500">
                <th className="px-4 py-2.5 text-start">{t("fields.title")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.campaign")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.assignee")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.dueDate")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.status")}</th>
                <th className="px-4 py-2.5 text-start">{t("fields.clientApproval")}</th>
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
                    {t("deliverables.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((d) => {
                  const overdue = isDeliverableOverdue(d);
                  return (
                    <tr key={d.id} className="border-b border-default-100 last:border-0 hover:bg-default-50/60">
                      <td className="px-4 py-2.5 font-medium">{d.title}</td>
                      <td className="px-4 py-2.5 text-default-600">{campaignLabel(d.campaignId)}</td>
                      <td className="px-4 py-2.5 text-default-500">{userName(d.assigneeId)}</td>
                      <td className="px-4 py-2.5">
                        <span className={overdue ? "text-danger font-medium tabular-nums" : "tabular-nums"}>
                          {d.dueDate || "—"}
                        </span>
                        {overdue && (
                          <Chip size="sm" variant="flat" color="danger" className="ms-2">
                            {t("misc.overdue")}
                          </Chip>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={DELIVERABLE_STATUS_COLORS[d.status]}>
                          {t(`deliverableStatus.${d.status}`)}
                        </Chip>
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip size="sm" variant="flat" color={CLIENT_APPROVAL_COLORS[d.clientApprovalState]}>
                          {t(`clientApproval.${d.clientApprovalState}`)}
                        </Chip>
                      </td>
                      {(canManage || canDelete) && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-end">
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                variant="light"
                                isDisabled={allowedNextDeliverableStatuses(d.status).length === 0}
                                onPress={() => {
                                  setTransitioning(d);
                                  setMoveTo("");
                                  setMoveNote("");
                                }}
                              >
                                {t("buttons.changeStatus")}
                              </Button>
                              <Button
                                size="sm"
                                variant="light"
                                isDisabled={approvalOptionsFor(d).length === 0}
                                onPress={() => {
                                  setApproving(d);
                                  setApprovalNote("");
                                }}
                              >
                                {t("buttons.clientApproval")}
                              </Button>
                              <Button
                                size="sm"
                                variant="light"
                                onPress={() => {
                                  setEditing(d);
                                  setFormOpen(true);
                                }}
                              >
                                {t("buttons.edit")}
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button size="sm" variant="light" color="danger" onPress={() => setDeleting(d)}>
                              {t("buttons.delete")}
                            </Button>
                          )}
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

      <DeliverableFormModal
        isOpen={formOpen}
        onOpenChange={setFormOpen}
        campaigns={campaigns}
        deliverable={editing}
      />

      {/* Guarded transition modal — legal edges come from the rules lib, and
          publishing stays disabled until the client sign-off gate passes. */}
      <Modal isOpen={!!transitioning} onOpenChange={(o) => !o && setTransitioning(null)} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t("deliverables.transitionTitle")} — {transitioning?.title}</ModalHeader>
              <ModalBody className="gap-4">
                <Select
                  {...selectFieldProps()}
                  label={t("deliverables.moveTo")}
                  placeholder={t("filters.allStatuses")}
                  selectedKeys={moveTo ? [moveTo] : []}
                  onSelectionChange={(keys) => setMoveTo((Array.from(keys)[0] as DeliverableStatus) ?? "")}
                >
                  {nextFor.map((s) => (
                    <SelectItem key={s} textValue={t(`deliverableStatus.${s}`)}>
                      {t(`deliverableStatus.${s}`)}
                    </SelectItem>
                  ))}
                </Select>
                {moveTo === "published" && publishBlocked && (
                  <p className="text-xs text-danger">{t("deliverables.publishNeedsClientApproval")}</p>
                )}
                <Textarea
                  label={t("fields.note")}
                  value={moveNote}
                  onValueChange={setMoveNote}
                  minRows={2}
                  placeholder={t("deliverables.noteOptional")}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t("buttons.cancel")}
                </Button>
                <Button
                  color="primary"
                  isDisabled={!moveTo || (moveTo === "published" && publishBlocked)}
                  isLoading={transitionDeliverable.isPending}
                  onPress={async () => {
                    if (!transitioning || !moveTo) return;
                    await transitionDeliverable.mutateAsync({
                      id: transitioning.id,
                      to: moveTo,
                      note: moveNote.trim() || undefined,
                    });
                    setTransitioning(null);
                  }}
                >
                  {t("buttons.confirm")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Client sign-off logging — options derived from canSetClientApproval. */}
      <Modal isOpen={!!approving} onOpenChange={(o) => !o && setApproving(null)} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t("deliverables.clientApprovalTitle")} — {approving?.title}</ModalHeader>
              <ModalBody className="gap-4">
                <p className="text-sm text-default-500">
                  {t("deliverables.currentApproval", {
                    state: t(`clientApproval.${approving?.clientApprovalState ?? "not_required"}`),
                  })}
                </p>
                <Textarea
                  label={t("fields.note")}
                  value={approvalNote}
                  onValueChange={setApprovalNote}
                  minRows={2}
                  placeholder={t("deliverables.approvalNotePlaceholder")}
                />
              </ModalBody>
              <ModalFooter className="gap-2">
                <Button variant="light" onPress={onClose}>
                  {t("buttons.cancel")}
                </Button>
                {approving &&
                  approvalOptionsFor(approving).map((to) => (
                    <Button
                      key={to}
                      size="sm"
                      color={to === "rejected" ? "danger" : to === "approved" ? "success" : "primary"}
                      variant="flat"
                      isLoading={setClientApproval.isPending}
                      onPress={async () => {
                        await setClientApproval.mutateAsync({
                          id: approving.id,
                          to,
                          note: approvalNote.trim() || undefined,
                        });
                        setApproving(null);
                      }}
                    >
                      {t(`actions.approval.${to}`)}
                    </Button>
                  ))}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("deliverables.title")}
        body={deleting ? `${deleting.title} — ${t("deliverables.deleteConfirm")}` : ""}
        confirmLabel={t("buttons.delete")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={deleteDeliverable.isPending}
        onConfirm={async () => {
          if (deleting) {
            await deleteDeliverable.mutateAsync(deleting.id);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}
