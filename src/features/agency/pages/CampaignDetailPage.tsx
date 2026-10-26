import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Textarea,
} from "@heroui/react";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Link2,
  Megaphone,
  Pencil,
  Plus,
  ReceiptText,
} from "lucide-react";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { localizedName } from "@/lib/localized-name";
import { useContactsQuery } from "@/features/crm/hooks/use-contacts";
import { useContractsQuery } from "@/features/crm/hooks/use-contracts";
import { contactDisplayName } from "@/features/crm/utils/contacts-list.utils";
import { useInvoices } from "@/features/billing/hooks/use-invoices";
import { formatDate } from "@/lib/utils";
import {
  useCampaign,
  useDecideRevisionMutation,
  useDeleteExpenseMutation,
  useLinkInvoiceMutation,
  useProposeRevisionMutation,
  useTransitionCampaignMutation,
  useUnlinkInvoiceMutation,
} from "../hooks/use-marketing";
import { useDeliverables, useExpenses } from "../hooks/use-marketing";
import {
  allowedNextCampaignStatuses,
  canActivateCampaign,
  canDecideRevision,
  canProposeRevision,
  computeBudgetVsActual,
  hasPendingRevision,
  normalizeMoney,
  validateRevisionDraft,
} from "../lib/campaign-rules";
import { CAMPAIGN_STATUS_COLORS, DELIVERABLE_STATUS_COLORS, REVISION_STATE_COLORS } from "../lib/ui-maps";
import { CampaignFormModal } from "../components/CampaignFormModal";
import { ExpenseFormModal } from "../components/ExpenseFormModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { SingleSelectField } from "../components/SingleSelectField";
import type { CampaignStatus, InvoiceRevenueLike } from "../types/marketing.types";

/**
 * Campaign workspace: guarded status transitions, the revision-governed
 * budget, actual spend (mkt_expenses), the billing link (invoice.campaignId
 * pure reference) and the delivery records — all derived from persisted data.
 */
export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation("marketing");
  const { can } = useAppPermissions();
  const canManage = can("marketing.manage");

  const { data: campaign, isLoading } = useCampaign(id);
  const { data: expenses = [] } = useExpenses();
  const { data: deliverables = [] } = useDeliverables();
  const { data: invoices = [] } = useInvoices();
  const { data: contactsRes } = useContactsQuery();
  const { data: contractsRes } = useContractsQuery();
  const { data: allUsers = [] } = useAllUsers();

  const transitionCampaign = useTransitionCampaignMutation();
  const proposeRevision = useProposeRevisionMutation();
  const decideRevision = useDecideRevisionMutation();
  const linkInvoice = useLinkInvoiceMutation();
  const unlinkInvoice = useUnlinkInvoiceMutation();
  const deleteExpense = useDeleteExpenseMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [target, setTarget] = useState<CampaignStatus | null>(null);
  const [transitionNote, setTransitionNote] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionAmount, setRevisionAmount] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionErrors, setRevisionErrors] = useState<Record<string, string>>({});
  const [linkInvoiceId, setLinkInvoiceId] = useState("");

  const campaignExpenses = useMemo(
    () => expenses.filter((e) => e.campaignId === id),
    [expenses, id],
  );
  const campaignDeliverables = useMemo(
    () => deliverables.filter((d) => d.campaignId === id),
    [deliverables, id],
  );
  const campaignInvoices = useMemo(
    () => invoices.filter((inv) => inv.campaignId === id),
    [invoices, id],
  );
  const unlinkedInvoices = useMemo(
    () => invoices.filter((inv) => !inv.campaignId && inv.status !== "cancelled"),
    [invoices],
  );
  // Report input keeps the shape it declares (billing rows have optional id).
  const revenueInvoices: InvoiceRevenueLike[] = invoices.map((inv) => ({
    id: inv.id ?? "",
    campaignId: inv.campaignId ?? null,
    status: inv.status,
    grandTotal: inv.grandTotal,
    amountPaid: inv.amountPaid ?? 0,
    currency: inv.currency,
  }));

  if (isLoading) {
    return <div className="py-16 text-center text-default-400">…</div>;
  }
  if (!campaign) {
    return (
      <div className="py-16 text-center space-y-3">
        <p className="text-default-500">{t("campaignDetail.notFound")}</p>
        <Button
          variant="light"
          startContent={<ArrowLeft className="w-4 h-4" />}
          onPress={() => navigate("/agency/campaigns")}
        >
          {t("buttons.backToCampaigns")}
        </Button>
      </div>
    );
  }

  const report = computeBudgetVsActual(campaign, expenses, revenueInvoices);
  const client = (contactsRes?.data ?? []).find((c) => c.id === campaign.clientId);
  const contract = (contractsRes?.data ?? []).find((c) => c.id === campaign.contractId);
  const owner = allUsers.find((u) => u.id === campaign.ownerUserId);
  const nextStatuses = allowedNextCampaignStatuses(campaign.status);
  const pendingRevision = campaign.budgetRevisions.find((r) => r.state === "pending") ?? null;

  const doTransition = async () => {
    if (!target) return;
    await transitionCampaign.mutateAsync({
      id: campaign.id,
      to: target,
      note: transitionNote.trim() || undefined,
    });
    setTarget(null);
    setTransitionNote("");
  };

  const submitRevision = async () => {
    const found = validateRevisionDraft({
      newAmount: revisionAmount.trim() ? Number(revisionAmount) : null,
      reason: revisionReason.trim(),
    });
    if (Object.keys(found).length) {
      setRevisionErrors(Object.fromEntries(Object.entries(found).map(([f, k]) => [f, t(k)])));
      return;
    }
    await proposeRevision.mutateAsync({
      id: campaign.id,
      newAmount: Number(revisionAmount),
      reason: revisionReason.trim(),
    });
    setRevisionOpen(false);
    setRevisionAmount("");
    setRevisionReason("");
    setRevisionErrors({});
  };

  const targetNeedsBudget = target === "active" && !canActivateCampaign(campaign);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold text-default-900">{campaign.name}</h1>
            <Chip size="sm" variant="flat" color={CAMPAIGN_STATUS_COLORS[campaign.status]}>
              {t(`campaignStatus.${campaign.status}`)}
            </Chip>
          </div>
          <p className="text-xs text-default-500 mt-1 tabular-nums">{campaign.code}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Button
            size="sm"
            variant="light"
            startContent={<ArrowLeft className="w-4 h-4" />}
            onPress={() => navigate("/agency/campaigns")}
          >
            {t("buttons.back")}
          </Button>
          {canManage && nextStatuses.length > 0 && (
            <>
              {nextStatuses.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  color={s === "cancelled" ? "danger" : "primary"}
                  variant={s === "cancelled" ? "flat" : "solid"}
                  onPress={() => {
                    setTarget(s);
                    setTransitionNote("");
                  }}
                >
                  {t(`actions.moveTo.${s}`)}
                </Button>
              ))}
            </>
          )}
          {canManage && (
            <Button size="sm" variant="bordered" startContent={<Pencil className="w-4 h-4" />} onPress={() => setEditOpen(true)}>
              {t("buttons.edit")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs uppercase text-default-400">{t("fields.client")}</p>
            <p className="font-medium mt-1">{client ? contactDisplayName(client) : t("misc.removedRef")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-default-400">{t("fields.contract")}</p>
            <p className="font-medium mt-1">{contract ? contract.title : t("misc.none")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-default-400">{t("fields.owner")}</p>
            <p className="font-medium mt-1">
              {owner ? localizedName(i18n.language, owner) || owner.name : t("misc.unassigned")}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-default-400">{t("fields.period")}</p>
            <p className="font-medium mt-1 tabular-nums">
              {campaign.startDate || "—"} → {campaign.endDate || "—"}
            </p>
          </div>
          {campaign.objective && (
            <div className="col-span-2 lg:col-span-4">
              <p className="text-xs uppercase text-default-400">{t("fields.objective")}</p>
              <p className="mt-1">{campaign.objective}</p>
            </div>
          )}
          <div className="col-span-2 lg:col-span-4">
            <p className="text-xs uppercase text-default-400 mb-1">{t("fields.channels")}</p>
            <div className="flex flex-wrap gap-1">
              {campaign.channels.map((ch) => (
                <Chip key={ch} size="sm" variant="flat">{t(`channel.${ch}`)}</Chip>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="text-sm font-semibold">
            <Banknote className="w-4 h-4 me-2 text-primary" />
            {t("campaignDetail.budgetVsActual")}
          </CardHeader>
          <CardBody className="gap-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-default-400">{t("fields.budgetAmount")}</p>
                <p className="font-bold tabular-nums">{report.budget.toLocaleString()} {campaign.currency}</p>
              </div>
              <div>
                <p className="text-xs text-default-400">{t("fields.spent")}</p>
                <p className={`font-bold tabular-nums ${report.overBudget ? "text-danger" : ""}`}>
                  {report.spent.toLocaleString()} {campaign.currency}
                </p>
              </div>
              <div>
                <p className="text-xs text-default-400">{t("fields.remaining")}</p>
                <p className={`font-semibold tabular-nums ${report.remaining < 0 ? "text-danger" : ""}`}>
                  {report.remaining.toLocaleString()} {campaign.currency}
                </p>
              </div>
              <div>
                <p className="text-xs text-default-400">{t("fields.utilization")}</p>
                <p className="font-semibold tabular-nums">{Math.round(report.utilization * 100)}%</p>
              </div>
              <div>
                <p className="text-xs text-default-400">{t("fields.invoiced")}</p>
                <p className="font-semibold tabular-nums">{report.invoiced.toLocaleString()} {campaign.currency}</p>
              </div>
              <div>
                <p className="text-xs text-default-400">{t("fields.collected")}</p>
                <p className="font-semibold tabular-nums">{report.collected.toLocaleString()} {campaign.currency}</p>
              </div>
            </div>
            {report.overBudget && (
              <p className="text-xs text-danger">{t("campaignDetail.overBudgetWarning")}</p>
            )}
            <Divider />
            <div className="flex items-center justify-between">
              <p className="text-xs text-default-500">
                {t("campaignDetail.budgetHistory")} ({campaign.budgetRevisions.length})
              </p>
              {canManage && canProposeRevision(campaign.status) && !hasPendingRevision(campaign.budgetRevisions) && (
                <Button size="sm" variant="bordered" onPress={() => setRevisionOpen(true)}>
                  {t("campaigns.proposeRevision")}
                </Button>
              )}
            </div>
            {campaign.budgetRevisions.length > 0 && (
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {campaign.budgetRevisions.map((r) => (
                  <li key={r.id} className="text-xs border border-default-200 rounded-md p-2 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular-nums">
                        {r.previousAmount.toLocaleString()} → {r.newAmount.toLocaleString()} {campaign.currency}
                      </span>
                      <Chip size="sm" variant="flat" color={REVISION_STATE_COLORS[r.state]}>
                        {t(`revisionState.${r.state}`)}
                      </Chip>
                    </div>
                    <p className="text-default-500">{r.reason}</p>
                    {canDecideRevision(r) && canManage && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          color="success"
                          variant="flat"
                          isLoading={decideRevision.isPending}
                          onPress={() => decideRevision.mutateAsync({ id: campaign.id, revisionId: r.id, approve: true })}
                        >
                          {t("campaigns.approveRevision")}
                        </Button>
                        <Button
                          size="sm"
                          color="danger"
                          variant="flat"
                          isLoading={decideRevision.isPending}
                          onPress={() => decideRevision.mutateAsync({ id: campaign.id, revisionId: r.id, approve: false })}
                        >
                          {t("campaigns.rejectRevision")}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {pendingRevision && (
              <p className="text-xs text-warning">{t("campaigns.revisionPendingHint")}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="text-sm font-semibold">
            <ReceiptText className="w-4 h-4 me-2 text-primary" />
            {t("campaignDetail.linkedInvoices")}
          </CardHeader>
          <CardBody className="gap-3">
            {campaignInvoices.length === 0 ? (
              <p className="text-sm text-default-400">{t("campaignDetail.noInvoices")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {campaignInvoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-2">
                    <Link to={`/billing/invoices/${inv.id}`} className="text-primary hover:underline truncate">
                      {inv.invoiceNumber} — {inv.customerName ?? ""}
                    </Link>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums text-xs text-default-500">
                        {inv.grandTotal.toLocaleString()} {inv.currency}
                      </span>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="light"
                          isLoading={unlinkInvoice.isPending}
                          onPress={() => unlinkInvoice.mutateAsync(inv.id!)}
                        >
                          {t("buttons.unlink")}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && unlinkedInvoices.length > 0 && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <SingleSelectField
                    label={t("campaignDetail.pickInvoice")}
                    value={linkInvoiceId}
                    onChange={setLinkInvoiceId}
                    options={unlinkedInvoices.map((inv) => ({
                      id: inv.id!,
                      label: `${inv.invoiceNumber} — ${inv.customerName ?? ""}`,
                    }))}
                    placeholder={t("campaignDetail.pickInvoice")}
                  />
                </div>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  startContent={<Link2 className="w-4 h-4" />}
                  isDisabled={!linkInvoiceId}
                  isLoading={linkInvoice.isPending}
                  onPress={async () => {
                    if (linkInvoiceId) {
                      await linkInvoice.mutateAsync({ invoiceId: linkInvoiceId, campaignId: campaign.id });
                      setLinkInvoiceId("");
                    }
                  }}
                >
                  {t("buttons.link")}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="text-sm font-semibold justify-between">
          <span>{t("campaignDetail.expenses")}</span>
          {canManage && (
            <Button size="sm" variant="bordered" startContent={<Plus className="w-4 h-4" />} onPress={() => setExpenseOpen(true)}>
              {t("expenses.add")}
            </Button>
          )}
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <tbody>
              {campaignExpenses.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-default-400">{t("expenses.empty")}</td>
                </tr>
              ) : (
                campaignExpenses.map((e) => (
                  <tr key={e.id} className="border-b border-default-100 last:border-0">
                    <td className="px-4 py-2.5">{e.title}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{t(`expenseCategory.${e.category}`)}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{e.spentAt}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{e.vendorName || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{normalizeMoney(e.amount).toLocaleString()} {e.currency}</td>
                    {can("marketing.delete") && (
                      <td className="px-4 py-2.5 text-end">
                        <Button
                          size="sm"
                          variant="light"
                          color="danger"
                          isLoading={deleteExpense.isPending}
                          onPress={() => deleteExpense.mutateAsync(e.id)}
                        >
                          {t("buttons.delete")}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="text-sm font-semibold">
          <CalendarDays className="w-4 h-4 me-2 text-primary" />
          {t("campaignDetail.deliverables")}
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <tbody>
              {campaignDeliverables.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-default-400">{t("deliverables.empty")}</td>
                </tr>
              ) : (
                campaignDeliverables.map((d) => (
                  <tr key={d.id} className="border-b border-default-100 last:border-0">
                    <td className="px-4 py-2.5">{d.title}</td>
                    <td className="px-4 py-2.5 text-xs text-default-500">{d.dueDate || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Chip size="sm" variant="flat" color={DELIVERABLE_STATUS_COLORS[d.status]}>
                        {t(`deliverableStatus.${d.status}`)}
                      </Chip>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-4 pb-3">
            <Link to="/agency/deliverables" className="text-xs text-primary hover:underline">
              {t("campaigns.viewAllDeliverables")}
            </Link>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="text-sm font-semibold">{t("campaignDetail.statusHistory")}</CardHeader>
        <CardBody className="p-0">
          {campaign.statusHistory.length === 0 ? (
            <p className="px-4 py-6 text-sm text-default-400">{t("campaignDetail.noHistory")}</p>
          ) : (
            <ul className="divide-y divide-default-100">
              {[...campaign.statusHistory].reverse().map((h, idx) => (
                <li key={`${h.at}-${idx}`} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="flat">{t(`campaignStatus.${h.from}`)}</Chip>
                  <span className="text-default-400">→</span>
                  <Chip size="sm" variant="flat" color={CAMPAIGN_STATUS_COLORS[h.to]}>{t(`campaignStatus.${h.to}`)}</Chip>
                  <span className="text-xs text-default-500 ms-auto tabular-nums">{formatDate(h.at)}</span>
                  {h.note && <span className="basis-full text-xs text-default-500">{h.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <CampaignFormModal isOpen={editOpen} onOpenChange={setEditOpen} campaign={campaign} />
      <ExpenseFormModal
        isOpen={expenseOpen}
        onOpenChange={setExpenseOpen}
        campaign={campaign}
        campaigns={[campaign]}
      />

      <ConfirmModal
        isOpen={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t("campaigns.transitionTitle")}
        body={target ? t(`actions.moveTo.${target}`) : ""}
        confirmLabel={t("buttons.confirm")}
        cancelLabel={t("buttons.cancel")}
        danger={target === "cancelled"}
        isLoading={transitionCampaign.isPending}
        confirmDisabled={targetNeedsBudget}
        onConfirm={doTransition}
      >
        <Textarea
          label={t("fields.note")}
          value={transitionNote}
          onValueChange={setTransitionNote}
          minRows={2}
          placeholder={targetNeedsBudget ? t("campaigns.activateNeedsBudget") : t("campaigns.noteOptional")}
        />
        {targetNeedsBudget && (
          <p className="text-xs text-danger">{t("campaigns.activateNeedsBudget")}</p>
        )}
      </ConfirmModal>

      <ConfirmModal
        isOpen={revisionOpen}
        onOpenChange={(o) => !o && setRevisionErrors({})}
        title={t("campaigns.proposeRevision")}
        body={t("campaigns.revisionExplain")}
        confirmLabel={t("buttons.save")}
        cancelLabel={t("buttons.cancel")}
        isLoading={proposeRevision.isPending}
        onConfirm={submitRevision}
      >
        <Input
          type="number"
          min="0"
          step="0.01"
          label={t("fields.newAmount")}
          value={revisionAmount}
          onValueChange={setRevisionAmount}
          isInvalid={!!revisionErrors.newAmount}
          errorMessage={revisionErrors.newAmount}
        />
        <Textarea
          label={t("fields.reason")}
          value={revisionReason}
          onValueChange={setRevisionReason}
          minRows={2}
          isInvalid={!!revisionErrors.reason}
          errorMessage={revisionErrors.reason}
        />
      </ConfirmModal>
    </div>
  );
}
