import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Payment, CreatePaymentDTO } from "../schemas/payment";
import type { Invoice } from "../schemas/invoice";
import type { Bill } from "../schemas/bill";
import { BillingService } from "../api/billing.service";
import { createLinkedVoucher } from "../api/create-voucher";
import { useCompany } from "@/features/companies/context/company-context";
import { convertTimestampsToDates } from "../utils/timestamp";
import type { Voucher } from "../schemas/voucher";

export type RecordPaymentResult = {
  payment: Payment;
  voucher: Voucher | null;
};

type PaymentFilter =
  | string
  | {
      invoiceId?: string;
      billId?: string;
    };

function resolvePaymentFilter(filter?: PaymentFilter) {
  if (typeof filter === "string") {
    return { invoiceId: filter, billId: undefined };
  }
  return {
    invoiceId: filter?.invoiceId,
    billId: filter?.billId,
  };
}

export function usePayments(filter?: PaymentFilter) {
  const { companyId } = useCompany();
  const { invoiceId, billId } = resolvePaymentFilter(filter);

  return useQuery({
    queryKey: ["billing", "payments", companyId, invoiceId, billId],
    queryFn: async () => {
      const res = await BillingService.payments.getAll(companyId!);
      const data = convertTimestampsToDates(res.data) as Payment[];
      if (invoiceId) return data.filter((p) => p.invoiceId === invoiceId);
      if (billId) return data.filter((p) => p.billId === billId);
      return data;
    },
    enabled: !!companyId,
  });
}

export function useRecordPaymentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({
      invoice,
      payment,
    }: {
      invoice: Invoice;
      payment: Omit<CreatePaymentDTO, "invoiceId" | "type" | "currency"> & { id?: string };
    }) => {
      const result = await BillingService.executeCustomerPaymentTransaction(companyId!, {
        invoiceId: invoice.id!,
        payment,
      });

      const voucher = await createLinkedVoucher({
        companyId: companyId!,
        type: "receipt",
        payment: result.payment,
        partyName: invoice.customerName?.trim() || invoice.customerId || "—",
        partyId: invoice.customerId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      });

      return { payment: result.payment, voucher } satisfies RecordPaymentResult;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["billing", "payments"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "invoices"] });
      queryClient.invalidateQueries({
        queryKey: ["billing", "invoices", variables.invoice.id],
      });
      queryClient.invalidateQueries({ queryKey: ["billing", "journals"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "accounts"] });
    },
  });
}

export function useRecordVendorPaymentMutation() {
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  return useMutation({
    mutationFn: async ({
      bill,
      payment,
    }: {
      bill: Bill;
      payment: Omit<CreatePaymentDTO, "billId" | "type" | "currency"> & { id?: string };
    }) => {
      const result = await BillingService.executeVendorPaymentTransaction(companyId!, {
        billId: bill.id!,
        payment,
      });

      const voucher = await createLinkedVoucher({
        companyId: companyId!,
        type: "disbursement",
        payment: result.payment,
        partyName: bill.vendorName?.trim() || bill.vendorId || "—",
        partyId: bill.vendorId,
        billId: bill.id,
        billNumber: bill.billNumber,
      });

      return { payment: result.payment, voucher } satisfies RecordPaymentResult;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["billing", "payments"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "bills"] });
      queryClient.invalidateQueries({
        queryKey: ["billing", "bills", variables.bill.id],
      });
      queryClient.invalidateQueries({ queryKey: ["billing", "journals"] });
      queryClient.invalidateQueries({ queryKey: ["billing", "accounts"] });
    },
  });
}
