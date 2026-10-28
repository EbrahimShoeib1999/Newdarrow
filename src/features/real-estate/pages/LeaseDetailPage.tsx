import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, CardBody, Chip, Divider, Textarea } from "@heroui/react";
import { ArrowLeft, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { useAppPermissions } from "@/features/companies/hooks/use-app-permissions";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  useActivateLeaseMutation,
  useCancelLeaseMutation,
  useLease,
  useLeaseDeposit,
  useLeaseInstallments,
  useLeasePayments,
  useSubmitLeaseMutation,
  useTerminateLeaseMutation,
} from "../hooks/use-real-estate-leases";
import { useVoidPaymentMutation } from "../hooks/use-real-estate-finance";
import { useCompleteHandoverMutation, useLeaseHandovers } from "../hooks/use-real-estate-ops";
import { useRemActor, useUnit } from "../hooks/use-real-estate";
import {
  DEPOSIT_STATUS_COLORS,
  INSTALLMENT_STATUS_COLORS,
  LEASE_STATUS_COLORS,
  remErrorText,
} from "../lib/ui-maps";
import { LeaseFormModal } from "../components/LeaseFormModal";
import { RenewLeaseModal } from "../components/RenewLeaseModal";
import { AmendLeaseModal } from "../components/AmendLeaseModal";
import { RecordPaymentModal } from "../components/RecordPaymentModal";
import { DepositActionModal, type DepositAction } from "../components/DepositActionModal";
import { HandoverFormModal } from "../components/HandoverFormModal";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { ConfirmModal } from "../components/ConfirmModal";
import { installmentTotal } from "../types/real-estate.types";

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-default-400">{label}</p>
      <p className="text-sm text-default-800 mt-0.5">{value ?? "—"}</p>
    </div>
  );
}

export function LeaseDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("real_estate");
  const { can } = useAppPermissions();
  const canCreate = can("real_estate.create");
  const canApprove = can("real_estate.approve");
  const canCollect = can("real_estate.collect");
  const canDeposits = can("real_estate.deposits");
  const actor = useRemActor();

  const { data: lease, isLoading } = useLease(id);
  const { data: unit } = useUnit(lease?.unitId);
  const { data: installments = [] } = useLeaseInstallments(id);
  const { data: deposit } = useLeaseDeposit(id);
  const { data: payments = [] } = useLeasePayments(id);
  const { data: handovers = [] } = useLeaseHandovers(id);

  const submit = useSubmitLeaseMutation();
  const activate = useActivateLeaseMutation();
  const terminate = useTerminateLeaseMutation();
  const cancel = useCancelLeaseMutation();
  const voidPayment = useVoidPaymentMutation();
  const completeHandover = useCompleteHandoverMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmTerminate, setConfirmTerminate] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [depositAction, setDepositAction] = useState<DepositAction | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!lease) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-default-500">{t("validation.notFound")}</p>
        <Button as={Link} to="/real-estate/leases" variant="flat">
          {t("leasesPage.backToLeases")}
        </Button>
      </div>
    );
  }

  const isDraftLike = lease.status === "draft" || lease.status === "pending_approval";
  const isActiveLike = lease.status === "active" || lease.status === "expiring";
  const canRenewLike = isActiveLike || lease.status === "expired";
  // Mirrors PaymentService.record: collections only on executed contracts.
  const isCollectable = !isDraftLike && lease.status !== "cancelled";
  // Deposit-receipt rows are liability events, not rent money — shown in the
  // deposit card's ledger instead of the rent payments table.
  const rentPayments = payments.filter((p) => !(p as { isDepositReceipt?: boolean }).isDepositReceipt);

  const runAction = (p: Promise<unknown>) =>
    p.catch((e) => toast.error(remErrorText(t, e)));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <Button as={Link} to="/real-estate/leases" size="sm" variant="light" startContent={<ArrowLeft className="w-4 h-4" />}>
            {t("leasesPage.backToLeases")}
          </Button>
          <h1 className="text-2xl font-bold text-default-900 flex items-center gap-2 mt-2">
            <ScrollText className="w-6 h-6 text-primary" />
            <span className="font-mono">{lease.contractNumber}</span>
            <Chip size="sm" variant="flat" color={LEASE_STATUS_COLORS[lease.status]}>
              {t(`leaseStatus.${lease.status}`)}
            </Chip>
          </h1>
        </div>

        {/* Lifecycle actions — every button mirrors a service transition and
            the same permission the Firestore rules enforce server-side. */}
        <div className="flex flex-wrap gap-2">
          {canCreate && isDraftLike && (
            <Button size="sm" variant="flat" onPress={() => setEditOpen(true)}>
              {t("buttons.edit")}
            </Button>
          )}
          {canCreate && lease.status === "draft" && (
            <Button size="sm" variant="flat" isLoading={submit.isPending} onPress={() => runAction(submit.mutateAsync(lease.id))}>
              {t("leasesPage.submit")}
            </Button>
          )}
          {canApprove && isDraftLike && (
            <Button size="sm" color="primary" onPress={() => setConfirmActivate(true)}>
              {t("leasesPage.activate")}
            </Button>
          )}
          {canCreate && isDraftLike && (
            <Button size="sm" variant="flat" color="danger" onPress={() => setConfirmCancel(true)}>
              {t("leasesPage.cancelLease")}
            </Button>
          )}
          {canApprove && canRenewLike && (
            <Button size="sm" variant="flat" color="secondary" onPress={() => setRenewOpen(true)}>
              {t("leasesPage.renew")}
            </Button>
          )}
          {canApprove && isActiveLike && (
            <>
              <Button size="sm" variant="flat" onPress={() => setAmendOpen(true)}>
                {t("leasesPage.amend")}
              </Button>
              <Button size="sm" variant="flat" color="danger" onPress={() => setConfirmTerminate(true)}>
                {t("leasesPage.terminate")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Contract facts */}
      <Card>
        <CardBody className="gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Info
              label={t("fields.property")}
              value={
                <Link to={`/real-estate/properties/${lease.propertyId}`} className="text-primary text-sm">
                  {t("propertyProfile.details")}
                </Link>
              }
            />
            <Info
              label={t("fields.unit")}
              value={
                unit ? (
                  <Link to={`/real-estate/units/${unit.id}`} className="text-primary text-sm">
                    {unit.code} — {unit.name}
                  </Link>
                ) : (
                  "—"
                )
              }
            />
            <Info label={t("fields.tenant")} value={lease.tenantDisplayNameSnapshot || lease.tenantContactId} />
            <Info label={t("fields.date")} value={`${formatDate(lease.startDate)} → ${formatDate(lease.endDate)}`} />
            <Info label={t("fields.rentAmount")} value={formatCurrency(lease.rentAmount, lease.currency)} />
            <Info label={t("fields.frequency")} value={t(`frequency.${lease.frequency}`)} />
            <Info label={t("fields.dueDay")} value={lease.dueDay} />
            <Info label={t("fields.timing")} value={t(`timing.${lease.timing}`)} />
            <Info label={t("fields.gracePeriodDays")} value={lease.gracePeriodDays} />
            <Info label={t("fields.depositAmount")} value={formatCurrency(lease.depositAmount, lease.currency)} />
            <Info
              label={t("fields.status")}
              value={
                <Chip size="sm" variant="flat" color={DEPOSIT_STATUS_COLORS[lease.depositStatus]}>
                  {t(`depositStatus.${lease.depositStatus}`)}
                </Chip>
              }
            />
            <Info label={t("fields.responsibleUser")} value={lease.responsibleUserId ?? "—"} />
          </div>

          {(lease.feesAmount > 0 || lease.taxAmount > 0 || lease.discountAmount > 0 || lease.taxPercent > 0) && (
            <>
              <Divider />
              <h3 className="text-sm font-semibold text-default-700">{t("leasesPage.termsSection")}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Info label={t("fields.feesAmount")} value={formatCurrency(lease.feesAmount, lease.currency)} />
                <Info label={t("fields.taxPercent")} value={`${lease.taxPercent}%`} />
                <Info label={t("fields.taxAmount")} value={formatCurrency(lease.taxAmount, lease.currency)} />
                <Info label={t("fields.discountAmount")} value={formatCurrency(lease.discountAmount, lease.currency)} />
              </div>
            </>
          )}

          {lease.escalations.length > 0 && (
            <div className="text-sm text-default-600">
              {t("fields.escalations")}:{" "}
              {lease.escalations.map((e) => `${e.effectiveDate} +${e.percent}%`).join(" · ")}
            </div>
          )}
          {lease.includedServices && (
            <p className="text-sm text-default-600">{t("fields.includedServices")}: {lease.includedServices}</p>
          )}
          {lease.chargeableUtilities && (
            <p className="text-sm text-default-600">{t("fields.chargeableUtilities")}: {lease.chargeableUtilities}</p>
          )}
          {lease.terminationReason && (
            <p className="text-sm text-danger-600">{t("leasesPage.terminationReason")}: {lease.terminationReason}</p>
          )}
        </CardBody>
      </Card>

      {/* Rent schedule (read projection; collection actions below) */}
      <Card>
        <CardBody className="gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-default-800">{t("leasesPage.scheduleSection")}</h2>
            {canCollect && isCollectable && (
              <Button size="sm" color="primary" variant="flat" onPress={() => setPayOpen(true)}>
                {t("leasesPage.recordPayment")}
              </Button>
            )}
          </div>
          {installments.length === 0 ? (
            <p className="text-sm text-default-400">{t("misc.noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("fields.period")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.dueDate")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.amount")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.paid")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...installments]
                    .sort((a, b) => a.periodIndex - b.periodIndex)
                    .map((i) => (
                      <tr key={i.id} className="border-b border-default-100 last:border-0">
                        <td className="px-2 py-2 text-xs">
                          {formatDate(i.periodStart)} → {formatDate(i.periodEnd)}
                        </td>
                        <td className="px-2 py-2 text-xs">{formatDate(i.dueDate)}</td>
                        <td className="px-2 py-2 tabular-nums">{formatCurrency(installmentTotal(i), i.currency)}</td>
                        <td className="px-2 py-2 tabular-nums">{formatCurrency(i.paidAmount, i.currency)}</td>
                        <td className="px-2 py-2">
                          <Chip size="sm" variant="flat" color={INSTALLMENT_STATUS_COLORS[i.status]}>
                            {t(`installmentStatus.${i.status}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Recorded rent payments — corrections are voids with an audit trail,
          never deletions (mirrors PaymentService.voidPayment). */}
      <Card>
        <CardBody className="gap-2">
          <h2 className="text-base font-semibold text-default-800">{t("leasesPage.paymentsSection")}</h2>
          {rentPayments.length === 0 ? (
            <p className="text-sm text-default-400">{t("misc.noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-wide text-default-500 border-b border-default-200">
                    <th className="px-2 py-2 text-start">{t("fields.paymentDate")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.method")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.reference")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.amount")}</th>
                    <th className="px-2 py-2 text-start">{t("fields.status")}</th>
                    <th className="px-2 py-2 text-end">{t("fields.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rentPayments]
                    .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))
                    .map((p) => (
                      <tr key={p.id} className="border-b border-default-100 last:border-0">
                        <td className="px-2 py-2 text-xs">{formatDate(p.paymentDate)}</td>
                        <td className="px-2 py-2 text-xs">{t(`paymentMethod.${p.method}`, { defaultValue: p.method })}</td>
                        <td className="px-2 py-2 text-xs">{p.reference ?? "—"}</td>
                        <td className="px-2 py-2 tabular-nums">{formatCurrency(p.amount, p.currency)}</td>
                        <td className="px-2 py-2">
                          <Chip size="sm" variant="flat" color={p.voided ? "danger" : "success"}>
                            {p.voided ? t("collectionsPage.voided") : t("collectionsPage.recorded")}
                          </Chip>
                          {p.voided && p.voidReason && (
                            <div className="text-xs text-default-400 mt-0.5">{p.voidReason}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-end">
                          {canCollect && !p.voided && (
                            <Button size="sm" variant="light" color="danger" onPress={() => { setVoidTarget(p.id); setVoidReason(""); }}>
                              {t("leasesPage.voidPayment")}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Deposit ledger: receipts increase held funds, deductions/refunds are
          appended entries — every balance on screen is server-derived. */}
      {deposit && (
        <Card>
          <CardBody className="gap-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-default-800">{t("leasesPage.depositSection")}</h2>
              {canDeposits && (
                <div className="flex gap-2">
                  <Button size="sm" variant="flat" color="primary" onPress={() => setDepositAction("receipt")}>
                    {t("leasesPage.depositReceipt")}
                  </Button>
                  <Button size="sm" variant="flat" color="warning" onPress={() => setDepositAction("deduction")}>
                    {t("leasesPage.depositDeduction")}
                  </Button>
                  <Button size="sm" variant="flat" color="secondary" onPress={() => setDepositAction("refund")}>
                    {t("leasesPage.depositRefund")}
                  </Button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Info label={t("fields.amount")} value={formatCurrency(deposit.expectedAmount, deposit.currency)} />
              <Info label={t("fields.paid")} value={formatCurrency(deposit.receivedAmount, deposit.currency)} />
              <Info label={t("fields.outstandingLiability")} value={formatCurrency(deposit.outstandingLiability, deposit.currency)} />
              <Info
                label={t("fields.status")}
                value={
                  <Chip size="sm" variant="flat" color={DEPOSIT_STATUS_COLORS[deposit.status]}>
                    {t(`depositStatus.${deposit.status}`)}
                  </Chip>
                }
              />
            </div>

            {(deposit.deductions.length > 0 || deposit.refunds.length > 0) && (
              <>
                <Divider />
                <ul className="text-sm text-default-600 space-y-1">
                  {deposit.deductions.map((d) => (
                    <li key={d.id} className="flex gap-2">
                      <Chip size="sm" variant="flat" color="warning">{t("leasesPage.depositDeduction")}</Chip>
                      <span className="tabular-nums">{formatCurrency(d.amount, deposit.currency)}</span>
                      <span className="text-xs text-default-400">{d.reason} · {formatDate(d.at)}</span>
                    </li>
                  ))}
                  {deposit.refunds.map((r) => (
                    <li key={r.id} className="flex gap-2">
                      <Chip size="sm" variant="flat" color="secondary">{t("leasesPage.depositRefund")}</Chip>
                      <span className="tabular-nums">{formatCurrency(r.amount, deposit.currency)}</span>
                      <span className="text-xs text-default-400">{r.reference ?? ""} · {formatDate(r.at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {/* Handover events — factual move-in/out log tied to inspections */}
      <Card>
        <CardBody className="gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-default-800">{t("handoversSection.title")}</h2>
            {canCreate && (
              <Button size="sm" variant="flat" color="primary" onPress={() => setHandoverOpen(true)}>
                {t("handoversSection.record")}
              </Button>
            )}
          </div>
          {handovers.length === 0 ? (
            <p className="text-sm text-default-400">{t("handoversSection.empty")}</p>
          ) : (
            <ul className="text-sm text-default-600 space-y-1">
              {handovers.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" variant="flat" color={h.kind === "move_in" ? "success" : "warning"}>
                    {t(`handoverKind.${h.kind}`)}
                  </Chip>
                  <span className="text-xs">{formatDate(h.handoverDate)}</span>
                  {h.inspectionId && <span className="text-xs text-default-400">{t("handoversSection.inspection")}</span>}
                  {h.note && <span className="text-xs text-default-400">{h.note}</span>}
                  <Chip size="sm" variant="flat" color={h.completed ? "success" : "default"}>
                    {h.completed ? t("misc.completed") : t("misc.pending")}
                  </Chip>
                  {canCreate && !h.completed && (
                    <Button
                      size="sm"
                      variant="light"
                      isLoading={completeHandover.isPending}
                      onPress={() => runAction(completeHandover.mutateAsync({ id: h.id, by: actor }))}
                    >
                      {t("handoversSection.complete")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Approvals + amendment audit history */}
      <Card>
        <CardBody className="gap-3">
          <h2 className="text-base font-semibold text-default-800">{t("leasesPage.approvals")}</h2>
          {lease.approvals.length === 0 ? (
            <p className="text-sm text-default-400">{t("misc.noData")}</p>
          ) : (
            <ul className="text-sm text-default-600 list-disc ps-4">
              {lease.approvals.map((a, idx) => (
                <li key={idx}>
                  {a.userId} · {formatDate(a.at)}
                </li>
              ))}
            </ul>
          )}

          <Divider />
          <h2 className="text-base font-semibold text-default-800">{t("leasesPage.amendments")}</h2>
          {lease.amendments.length === 0 ? (
            <p className="text-sm text-default-400">{t("misc.noData")}</p>
          ) : (
            <ul className="text-sm text-default-600 space-y-1">
              {lease.amendments.map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.summary}</span> — {formatDate(a.at)}
                  {a.changes && (
                    <span className="text-xs text-default-400">
                      {" (" +
                        Object.entries(a.changes)
                          .map(([k, v]) => k + ": " + String(v.from) + " \u2192 " + String(v.to))
                          .join(", ") +
                        ")"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <LeaseFormModal isOpen={editOpen} onOpenChange={setEditOpen} lease={lease} />
      <RenewLeaseModal isOpen={renewOpen} onOpenChange={setRenewOpen} lease={lease} />
      <AmendLeaseModal isOpen={amendOpen} onOpenChange={setAmendOpen} lease={lease} />
      <RecordPaymentModal isOpen={payOpen} onOpenChange={setPayOpen} lease={lease} installments={installments} />
      <DepositActionModal
        isOpen={depositAction !== null}
        onOpenChange={(o) => !o && setDepositAction(null)}
        leaseId={lease.id}
        deposit={deposit ?? null}
        action={depositAction ?? "receipt"}
      />
      <HandoverFormModal isOpen={handoverOpen} onOpenChange={setHandoverOpen} lease={lease} />

      <DocumentsPanel entityType="lease" entityId={lease.id} />

      <ConfirmModal
        isOpen={voidTarget !== null}
        onOpenChange={(o) => !o && setVoidTarget(null)}
        title={t("leasesPage.voidPayment")}
        body={t("leasesPage.voidPaymentConfirm")}
        confirmLabel={t("leasesPage.voidPayment")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={voidPayment.isPending}
        confirmDisabled={voidReason.trim().length < 3}
        onConfirm={async () => {
          if (!voidTarget) return;
          await runAction(voidPayment.mutateAsync({ paymentId: voidTarget, reason: voidReason.trim(), by: actor }));
          setVoidTarget(null);
        }}
      >
        <Textarea label={t("fields.reason")} value={voidReason} onValueChange={setVoidReason} minRows={2} />
      </ConfirmModal>

      <ConfirmModal
        isOpen={confirmActivate}
        onOpenChange={(o) => !o && setConfirmActivate(false)}
        title={t("leasesPage.activate")}
        body={`${lease.contractNumber} — ${t("leasesPage.activateConfirm")}`}
        confirmLabel={t("leasesPage.activate")}
        cancelLabel={t("buttons.cancel")}
        isLoading={activate.isPending}
        onConfirm={async () => {
          await runAction(activate.mutateAsync({ id: lease.id, by: actor }));
          setConfirmActivate(false);
        }}
      />

      <ConfirmModal
        isOpen={confirmTerminate}
        onOpenChange={(o) => !o && setConfirmTerminate(false)}
        title={t("leasesPage.terminate")}
        body={`${lease.contractNumber} — ${t("leasesPage.terminateConfirm")}`}
        confirmLabel={t("leasesPage.terminate")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={terminate.isPending}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={async () => {
          await runAction(terminate.mutateAsync({ id: lease.id, reason: reason.trim(), by: actor }));
          setReason("");
          setConfirmTerminate(false);
        }}
      >
        <Textarea label={t("leasesPage.terminationReason")} value={reason} onValueChange={setReason} minRows={2} />
      </ConfirmModal>

      <ConfirmModal
        isOpen={confirmCancel}
        onOpenChange={(o) => !o && setConfirmCancel(false)}
        title={t("leasesPage.cancelLease")}
        body={`${lease.contractNumber} — ${t("leasesPage.cancelConfirm")}`}
        confirmLabel={t("leasesPage.cancelLease")}
        cancelLabel={t("buttons.cancel")}
        danger
        isLoading={cancel.isPending}
        onConfirm={async () => {
          await runAction(cancel.mutateAsync({ id: lease.id, reason: "" }));
          setConfirmCancel(false);
        }}
      />
    </div>
  );
}
