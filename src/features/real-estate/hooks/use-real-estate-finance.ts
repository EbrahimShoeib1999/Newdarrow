/**
 * Real Estate Management — TanStack Query hooks (rent collections & deposits).
 *
 * Money events go exclusively through PaymentService/DepositService: the UI
 * never patches installment paidAmount/status or deposit balances directly —
 * those are re-derived server-side from the durable allocation ledger.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PaymentService, DepositService } from "../api/rem-leasing.service";
import { useCompany } from "@/features/companies/context/company-context";
import type { CreateRentPaymentDTO, DepositRecord, RentInstallment } from "../types/real-estate.types";

const QUERY_KEY = ["real_estate"] as const;

/** Collections desk: every schedule row across the company (single scan). */
export function useAllInstallments() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "installments-all", companyId],
    queryFn: async () => (await PaymentService.listInstallments(companyId!)).data,
    enabled: !!companyId,
  });
}

/** Every deposit liability row (deposits desk). */
export function useDeposits() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "deposits", companyId],
    queryFn: async () => (await DepositService.list(companyId!)).data,
    enabled: !!companyId,
  });
}

/** Whole-company payment read — cash-flow basis for the reports desk. */
export function useAllPayments() {
  const { companyId } = useCompany();
  return useQuery({
    queryKey: [...QUERY_KEY, "payments-all", companyId],
    queryFn: async () => (await PaymentService.listAllPayments(companyId!)).data,
    enabled: !!companyId,
  });
}

function useFinanceMutation<TData, TVars>(fn: (companyId: string, vars: TVars) => Promise<TData>) {
  const { companyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(companyId!, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useRecordPaymentMutation() {
  return useFinanceMutation(
    (companyId, vars: { dto: CreateRentPaymentDTO; by: string }) =>
      PaymentService.record(companyId, vars.dto, vars.by),
  );
}

export function useVoidPaymentMutation() {
  return useFinanceMutation(
    (companyId, vars: { paymentId: string; reason: string; by: string }) =>
      PaymentService.voidPayment(companyId, vars.paymentId, vars.reason, vars.by),
  );
}

export function useDepositReceiptMutation() {
  return useFinanceMutation(
    (companyId, vars: { leaseId: string; input: { amount: number; paymentDate: string; method: string; reference?: string | null; receiptUrl?: string | null; idempotencyKey?: string }; by: string }) =>
      DepositService.recordReceipt(companyId, vars.leaseId, vars.input, vars.by),
  );
}

export function useDepositDeductionMutation() {
  return useFinanceMutation(
    (companyId, vars: { leaseId: string; input: { amount: number; reason: string; inspectionId?: string | null; approvedBy?: string | null } }) =>
      DepositService.addDeduction(companyId, vars.leaseId, vars.input),
  );
}

export function useDepositRefundMutation() {
  return useFinanceMutation(
    (companyId, vars: { leaseId: string; input: { amount: number; reference?: string | null } }) =>
      DepositService.refund(companyId, vars.leaseId, vars.input),
  );
}

export type { DepositRecord, RentInstallment };
