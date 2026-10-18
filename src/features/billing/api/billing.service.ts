import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ApiResponse } from "@/types/api.types";
import { withLogging } from "@/lib/service-utils";
import { mapDocWithTimestamps, stripUndefined, deepStripUndefined } from "@/features/crm/utils/firestore-mappers";

// Import Schemas
import type { Invoice, CreateInvoiceDTO, UpdateInvoiceDTO } from "../schemas/invoice";
import type { Bill, CreateBillDTO, UpdateBillDTO } from "../schemas/bill";
import type { Account, CreateAccountDTO, UpdateAccountDTO } from "../schemas/account";
import type { JournalEntry, CreateJournalEntryDTO, UpdateJournalEntryDTO } from "../schemas/journal";
import type { Product, CreateProductDTO, UpdateProductDTO, ProductCategory, ProductUnit } from "../schemas/product";
import type { Payment, CreatePaymentDTO } from "../schemas/payment";
import type { Voucher, CreateVoucherDTO, VoucherType } from "../schemas/voucher";
import type { ZakatRecord, CreateZakatRecordDTO, UpdateZakatRecordDTO } from "../schemas/zakat";
import type { CostCenter, CreateCostCenterDTO, UpdateCostCenterDTO } from "../schemas/cost-center";
import type { CreditNote, CreateCreditNoteDTO, UpdateCreditNoteDTO } from "../schemas/credit-note";
import type { BillingSettings } from "../schemas/settings";
import { DEFAULT_BILLING_CURRENCY_ENTRY } from "../utils/billing-currency";
import { DEFAULT_TAXES } from "../data/product-defaults";
import { normalizeBillingSettingsFromFirestore } from "../utils/settings-payload";
import {
  mergeDocumentSequence,
  reserveNextSequenceNumber,
  ensureSequenceNotBehindUsage,
} from "../utils/invoice-sequence";
import type { DocumentSequence } from "../schemas/settings";

// Import Generic Document System
import { GenericDocumentService } from "./generic-document.service";

export interface BillingListOptions {
  orderByField?: string;
  orderDirection?: "asc" | "desc";
  limitCount?: number;
}

const DEFAULT_INVOICE_SEQUENCE: DocumentSequence = {
  prefix: "INV-",
  nextNumber: 1,
  padding: 4,
};

function mergeBillingSettingsPatch(
  existing: BillingSettings,
  patch: Partial<BillingSettings>
): BillingSettings {
  const merged: BillingSettings = {
    ...existing,
    ...patch,
    companyProfile: patch.companyProfile
      ? { ...existing.companyProfile, ...patch.companyProfile }
      : existing.companyProfile,
    currencies: patch.currencies ?? existing.currencies,
    taxes: patch.taxes ?? existing.taxes,
    paymentMethods: patch.paymentMethods ?? existing.paymentMethods,
  };

  if (patch.invoiceSequence || existing.invoiceSequence) {
    merged.invoiceSequence = mergeDocumentSequence(
      existing.invoiceSequence,
      patch.invoiceSequence ?? existing.invoiceSequence ?? DEFAULT_INVOICE_SEQUENCE
    );
  }

  for (const key of ["quotationSequence", "estimateSequence", "proposalSequence"] as const) {
    if (patch[key] || existing[key]) {
      merged[key] = mergeDocumentSequence(
        existing[key],
        patch[key] ?? existing[key]!
      );
    }
  }

  return merged;
}

async function listUsedInvoiceNumbers(companyId: string): Promise<string[]> {
  const ref = collection(db, "companies", companyId, "invoices");
  const snapshot = await getDocs(query(ref, limit(500)));
  return snapshot.docs
    .map((d) => (d.data() as Invoice).invoiceNumber)
    .filter((n): n is string => !!n && n !== "DRAFT");
}

const RECEIPT_VOUCHER_SEQUENCE: DocumentSequence = {
  prefix: "REC-",
  nextNumber: 1,
  padding: 4,
};

const PAYMENT_VOUCHER_SEQUENCE: DocumentSequence = {
  prefix: "PAY-",
  nextNumber: 1,
  padding: 4,
};

async function listUsedVoucherNumbers(
  companyId: string,
  type: VoucherType
): Promise<string[]> {
  const ref = collection(db, "companies", companyId, "vouchers");
  const snapshot = await getDocs(query(ref, limit(2000)));
  return snapshot.docs
    .map((d) => d.data() as Voucher)
    .filter((v) => v.voucherType === type)
    .map((v) => v.voucherNumber)
    .filter((n): n is string => !!n);
}

export function createBillingCollectionService<T extends { id?: string }, CreateDTO, UpdateDTO>(
  collectionName: string,
  serviceName: string,
  defaults?: Partial<CreateDTO>
) {
  const collPath = (companyId: string, customDb?: any) =>
    collection(customDb || db, "companies", companyId, collectionName);

  return {
    async getAll(
      companyId: string,
      options?: BillingListOptions,
      customDb?: any
    ): Promise<ApiResponse<T[]>> {
      return withLogging(serviceName, "getAll", (async () => {
        const ref = collPath(companyId, customDb);
        const q = query(
          ref,
          orderBy(options?.orderByField ?? "createdAt", options?.orderDirection ?? "desc"),
          limit(options?.limitCount ?? 500)
        );
        const snapshot = await getDocs(q);
        const items = snapshot.docs.map((docSnap) =>
          mapDocWithTimestamps<T>(docSnap.id, docSnap.data() as Record<string, unknown>)
        );
        return { data: items, message: "Success" };
      })());
    },

    async getById(companyId: string, id: string, customDb?: any): Promise<ApiResponse<T>> {
      return withLogging(serviceName, "getById", (async () => {
        const docSnap = await getDoc(doc(customDb || db, "companies", companyId, collectionName, id));
        if (!docSnap.exists()) throw new Error(`${serviceName}: not found`);
        return {
          data: mapDocWithTimestamps<T>(docSnap.id, docSnap.data() as Record<string, unknown>),
          message: "Success",
        };
      })());
    },

    async create(companyId: string, data: CreateDTO, customDb?: any): Promise<ApiResponse<T>> {
      return withLogging(serviceName, "create", (async () => {
        const payload = stripUndefined({
          ...defaults,
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>);
        const docRef = await addDoc(collPath(companyId, customDb), payload);
        const newDoc = await getDoc(docRef);
        return {
          data: mapDocWithTimestamps<T>(newDoc.id, newDoc.data() as Record<string, unknown>),
          message: "Created successfully",
        };
      })());
    },

    async update(companyId: string, id: string, data: UpdateDTO, customDb?: any): Promise<ApiResponse<T>> {
      return withLogging(serviceName, "update", (async () => {
        const docRef = doc(customDb || db, "companies", companyId, collectionName, id);
        const clean = stripUndefined({ ...data, updatedAt: serverTimestamp() } as Record<string, unknown>);
        await updateDoc(docRef, clean);
        const updated = await getDoc(docRef);
        return {
          data: mapDocWithTimestamps<T>(updated.id, updated.data() as Record<string, unknown>),
          message: "Updated successfully",
        };
      })());
    },

    async delete(companyId: string, id: string, customDb?: any): Promise<void> {
      return withLogging(serviceName, "delete", (async () => {
        await deleteDoc(doc(customDb || db, "companies", companyId, collectionName, id));
      })());
    },
  };
}

export const BillingService = {
  invoices: createBillingCollectionService<Invoice, CreateInvoiceDTO, UpdateInvoiceDTO>("invoices", "InvoiceService"),
  bills: createBillingCollectionService<Bill, CreateBillDTO, UpdateBillDTO>("bills", "BillService"),
  accounts: createBillingCollectionService<Account, CreateAccountDTO, UpdateAccountDTO>("accounts", "AccountService"),
  journals: createBillingCollectionService<JournalEntry, CreateJournalEntryDTO, UpdateJournalEntryDTO>("journals", "JournalService"),
  products: createBillingCollectionService<Product, CreateProductDTO, UpdateProductDTO>("products", "ProductService"),
  productCategories: createBillingCollectionService<ProductCategory, Partial<ProductCategory>, Partial<ProductCategory>>("product_categories", "ProductCategoryService"),
  productUnits: createBillingCollectionService<ProductUnit, Partial<ProductUnit>, Partial<ProductUnit>>("product_units", "ProductUnitService"),
  payments: createBillingCollectionService<Payment, CreatePaymentDTO, Partial<CreatePaymentDTO>>("payments", "PaymentService"),
  vouchers: createBillingCollectionService<Voucher, CreateVoucherDTO, Partial<CreateVoucherDTO>>("vouchers", "VoucherService"),
  zakatRecords: createBillingCollectionService<ZakatRecord, CreateZakatRecordDTO, UpdateZakatRecordDTO>("zakatRecords", "ZakatRecordService"),
  costCenters: createBillingCollectionService<CostCenter, CreateCostCenterDTO, UpdateCostCenterDTO>("costCenters", "CostCenterService"),
  creditNotes: createBillingCollectionService<CreditNote, CreateCreditNoteDTO, UpdateCreditNoteDTO>("creditNotes", "CreditNoteService"),
  
  // Generic Document System
  documents: GenericDocumentService,

  async reserveInvoiceNumber(companyId: string): Promise<string> {
    const usedNumbers = await listUsedInvoiceNumbers(companyId);
    const docRef = doc(db, "companies", companyId, "settings", "billing");

    return runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      const settings = snap.exists()
        ? (snap.data() as BillingSettings)
        : null;
      const seq =
        settings?.invoiceSequence ?? { ...DEFAULT_INVOICE_SEQUENCE };

      const { number, nextSequence } = reserveNextSequenceNumber(seq, usedNumbers);

      tx.set(
        docRef,
        {
          invoiceSequence: nextSequence,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return number;
    });
  },

  async reserveDocumentNumber(companyId: string, documentType: "invoice" | "quotation" | "estimate" | "proposal" | "zakat"): Promise<string> {
    const sequenceKey = `${documentType}Sequence` as keyof BillingSettings;
    const docRef = doc(db, "companies", companyId, "settings", "billing");

    return runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      const settings = snap.exists()
        ? (snap.data() as BillingSettings)
        : null;
      const defaultSeq = {
        prefix: `${documentType.toUpperCase().slice(0, 3)}-`,
        nextNumber: 1,
        padding: 4,
      };
      const seq = (settings?.[sequenceKey] as DocumentSequence | undefined) ?? defaultSeq;

      const { formatSequenceNumber } = await import("../utils/invoice-sequence");
      const nextNum = Math.max(1, Number(seq.nextNumber) || 1);
      const documentNumber = formatSequenceNumber({ ...seq, nextNumber: nextNum });

      tx.set(
        docRef,
        {
          [sequenceKey]: { ...seq, nextNumber: nextNum + 1 },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return documentNumber;
    });
  },

  async reserveVoucherNumber(
    companyId: string,
    type: VoucherType
  ): Promise<string> {
    const sequenceKey =
      type === "receipt" ? "receiptVoucherSequence" : "paymentVoucherSequence";
    const defaultSeq =
      type === "receipt" ? RECEIPT_VOUCHER_SEQUENCE : PAYMENT_VOUCHER_SEQUENCE;
    const usedNumbers = await listUsedVoucherNumbers(companyId, type);
    const docRef = doc(db, "companies", companyId, "settings", "billing");

    return runTransaction(db, async (tx) => {
      const snap = await tx.get(docRef);
      const settings = snap.exists()
        ? (snap.data() as BillingSettings & Record<string, unknown>)
        : null;
      const seq =
        (settings?.[sequenceKey] as DocumentSequence | undefined) ?? {
          ...defaultSeq,
        };

      const { number, nextSequence } = reserveNextSequenceNumber(
        seq,
        usedNumbers
      );

      tx.set(
        docRef,
        {
          [sequenceKey]: nextSequence,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return number;
    });
  },

  async postJournalWithBalances(
    companyId: string,
    journal: CreateJournalEntryDTO
  ): Promise<JournalEntry> {
    const { aggregateBalanceDeltas } = await import("../utils/accounting-engine");
    const accountsRes = await BillingService.accounts.getAll(companyId);
    const deltas = aggregateBalanceDeltas(accountsRes.data, journal.lines);

    const isReversal =
      journal.sourceType === "refund" ||
      !!journal.reversalOfId ||
      Boolean(journal.reference?.startsWith("REV-"));

    const deterministicId =
      isReversal && journal.sourceId
        ? `je_rev_${journal.sourceType}_${journal.sourceId}`
        : (journal.sourceType && journal.sourceId
          ? `je_${journal.sourceType}_${journal.sourceId}`
          : doc(collection(db, "companies", companyId, "journals")).id);

    const journalRef = doc(db, "companies", companyId, "journals", deterministicId);

    return runTransaction(db, async (tx) => {
      const snap = await tx.get(journalRef);
      if (snap.exists()) {
        const existingData = snap.data() as Record<string, unknown>;
        // Idempotency Conflict Guard: If amounts differ from the previously posted entry, throw explicit conflict
        const existingDebit = Number(existingData.totalDebit ?? 0);
        if (Math.abs(existingDebit - journal.totalDebit) > 0.01) {
          throw new Error(
            `Idempotency conflict: journal ${deterministicId} already exists with debit ${existingDebit}, but requested amount is ${journal.totalDebit}`
          );
        }
        return mapDocWithTimestamps<JournalEntry>(snap.id, existingData);
      }

      const payload = stripUndefined({
        ...journal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as Record<string, unknown>);

      tx.set(journalRef, payload);

      for (const [accountId, delta] of deltas.entries()) {
        const accRef = doc(db, "companies", companyId, "accounts", accountId);
        tx.update(accRef, {
          currentBalance: increment(delta),
          updatedAt: serverTimestamp(),
        });
      }

      if (journal.sourceType === "invoice" && journal.sourceId) {
        const invRef = doc(db, "companies", companyId, "invoices", journal.sourceId);
        tx.update(invRef, {
          journalEntryId: deterministicId,
          postedAt: serverTimestamp(),
        });
      }

      return {
        id: deterministicId,
        ...journal,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as JournalEntry;
    });
  },

  async executeCustomerPaymentTransaction(
    companyId: string,
    params: {
      invoiceId: string;
      payment: Omit<CreatePaymentDTO, "invoiceId" | "type" | "currency"> & { id?: string };
    },
    customDb?: any
  ): Promise<{ payment: Payment; invoice: Invoice; journal: JournalEntry }> {
    return withLogging("BillingService", "executeCustomerPaymentTransaction", (async () => {
      const targetDb = customDb || db;
      const { buildPaymentJournalEntry, aggregateBalanceDeltas } = await import("../utils/accounting-engine");
      
      const accountsRes = await BillingService.accounts.getAll(companyId, undefined, targetDb);
      let accounts = accountsRes.data;
      if (accounts.length === 0) {
        const { DEFAULT_CHART_OF_ACCOUNTS } = await import("../schemas/account");
        const seeded = await Promise.all(
          DEFAULT_CHART_OF_ACCOUNTS.map((acc) =>
            BillingService.accounts.create(companyId, { ...acc, isActive: true }, targetDb)
          )
        );
        accounts = seeded.map((s) => s.data);
      }

      const invoiceRef = doc(targetDb, "companies", companyId, "invoices", params.invoiceId);
      const paymentId = params.payment.id || doc(collection(targetDb, "companies", companyId, "payments")).id;
      const paymentRef = doc(targetDb, "companies", companyId, "payments", paymentId);
      const journalId = `je_payment_${paymentId}`;
      const journalRef = doc(targetDb, "companies", companyId, "journals", journalId);

      return runTransaction(targetDb, async (tx) => {
        // 1. Transaction Reads (all reads strictly before any writes)
        const invoiceSnap = await tx.get(invoiceRef);
        if (!invoiceSnap.exists()) {
          throw new Error(`Invoice ${params.invoiceId} not found`);
        }
        const invoiceData = mapDocWithTimestamps<Invoice>(invoiceSnap.id, invoiceSnap.data() as Record<string, unknown>);

        // Idempotency check with full field validation
        const existingPaymentSnap = await tx.get(paymentRef);
        if (existingPaymentSnap.exists()) {
          const existingPayment = mapDocWithTimestamps<Payment>(existingPaymentSnap.id, existingPaymentSnap.data() as Record<string, unknown>);
          
          const isMatchingInvoice = existingPayment.invoiceId === params.invoiceId;
          const isMatchingAmount = Math.abs(Number(existingPayment.amount) - Number(params.payment.amount)) < 0.0001;
          const isMatchingCurrency = (existingPayment.currency || "SAR") === (invoiceData.currency || "SAR");
          const isMatchingType = existingPayment.type === "customer";

          if (isMatchingInvoice && isMatchingAmount && isMatchingCurrency && isMatchingType) {
            const journalSnap = await tx.get(journalRef);
            return {
              payment: existingPayment,
              invoice: invoiceData,
              journal: journalSnap.exists()
                ? mapDocWithTimestamps<JournalEntry>(journalSnap.id, journalSnap.data() as Record<string, unknown>)
                : ({} as JournalEntry),
            };
          }

          throw new Error(
            `Payment ${paymentId} already exists with conflicting details: ` +
            (!isMatchingInvoice ? `invoiceId mismatch (${existingPayment.invoiceId} vs ${params.invoiceId}); ` : "") +
            (!isMatchingAmount ? `amount mismatch (${existingPayment.amount} vs ${params.payment.amount}); ` : "") +
            (!isMatchingCurrency ? `currency mismatch (${existingPayment.currency} vs ${invoiceData.currency}); ` : "")
          );
        }

        // 2. Concurrency & Balance Validation in Integer Cents (prevents floating-point tolerance overpayments)
        const grandTotalCents = Math.round(Number(invoiceData.grandTotal ?? 0) * 100);
        const currentPaidCents = Math.round(Number(invoiceData.amountPaid ?? 0) * 100);
        const remainingDueCents = Math.max(0, grandTotalCents - currentPaidCents);
        const paymentCents = Math.round(Number(params.payment.amount) * 100);

        if (paymentCents <= 0) {
          throw new Error(`Payment amount must be greater than zero`);
        }

        if (paymentCents > remainingDueCents) {
          const remainingFormatted = (remainingDueCents / 100).toFixed(2);
          throw new Error(`Payment exceeds amount due (${remainingFormatted})`);
        }

        const newAmountPaidCents = currentPaidCents + paymentCents;
        const newAmountPaid = Number((newAmountPaidCents / 100).toFixed(2));
        const newStatus = newAmountPaidCents >= grandTotalCents
          ? "paid"
          : (invoiceData.status === "draft" ? "sent" : invoiceData.status);

        // 3. Prepare Double-Entry Journal
        const paymentRecord: Payment = {
          id: paymentId,
          invoiceId: params.invoiceId,
          type: "customer",
          amount: params.payment.amount,
          currency: invoiceData.currency || "SAR",
          date: params.payment.date ? new Date(params.payment.date) : new Date(),
          methodId: params.payment.methodId,
          methodName: params.payment.methodName,
          reference: params.payment.reference,
          notes: params.payment.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const journalDTO = buildPaymentJournalEntry(paymentRecord, invoiceData, accounts);
        const deltas = aggregateBalanceDeltas(accounts, journalDTO.lines);

        // 4. Atomic Transaction Writes
        tx.set(paymentRef, deepStripUndefined({
          ...paymentRecord,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>));

        tx.set(journalRef, deepStripUndefined({
          ...journalDTO,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>));

        for (const [accountId, delta] of deltas.entries()) {
          const accRef = doc(targetDb, "companies", companyId, "accounts", accountId);
          tx.update(accRef, {
            currentBalance: increment(delta),
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(invoiceRef, {
          amountPaid: newAmountPaid,
          status: newStatus,
          updatedAt: serverTimestamp(),
        });

        return {
          payment: paymentRecord,
          invoice: { ...invoiceData, amountPaid: newAmountPaid, status: newStatus },
          journal: { id: journalId, ...journalDTO } as JournalEntry,
        };
      });
    })());
  },

  async executeVendorPaymentTransaction(
    companyId: string,
    params: {
      billId: string;
      payment: Omit<CreatePaymentDTO, "billId" | "type" | "currency"> & { id?: string };
    },
    customDb?: any
  ): Promise<{ payment: Payment; bill: Bill; journal: JournalEntry }> {
    return withLogging("BillingService", "executeVendorPaymentTransaction", (async () => {
      const targetDb = customDb || db;
      const { buildVendorPaymentJournalEntry, aggregateBalanceDeltas } = await import("../utils/accounting-engine");
      
      const accountsRes = await BillingService.accounts.getAll(companyId, undefined, targetDb);
      const accounts = accountsRes.data;

      const billRef = doc(targetDb, "companies", companyId, "bills", params.billId);
      const paymentId = params.payment.id || doc(collection(targetDb, "companies", companyId, "payments")).id;
      const paymentRef = doc(targetDb, "companies", companyId, "payments", paymentId);
      const journalId = `je_vendor_payment_${paymentId}`;
      const journalRef = doc(targetDb, "companies", companyId, "journals", journalId);

      return runTransaction(targetDb, async (tx) => {
        // Reads
        const billSnap = await tx.get(billRef);
        if (!billSnap.exists()) {
          throw new Error(`Bill ${params.billId} not found`);
        }
        const billData = mapDocWithTimestamps<Bill>(billSnap.id, billSnap.data() as Record<string, unknown>);

        // Idempotency check with full field validation
        const existingPaymentSnap = await tx.get(paymentRef);
        if (existingPaymentSnap.exists()) {
          const existingPayment = mapDocWithTimestamps<Payment>(existingPaymentSnap.id, existingPaymentSnap.data() as Record<string, unknown>);
          
          const isMatchingBill = existingPayment.billId === params.billId;
          const isMatchingAmount = Math.abs(Number(existingPayment.amount) - Number(params.payment.amount)) < 0.0001;
          const isMatchingCurrency = (existingPayment.currency || "SAR") === (billData.currency || "SAR");
          const isMatchingType = existingPayment.type === "vendor";

          if (isMatchingBill && isMatchingAmount && isMatchingCurrency && isMatchingType) {
            const journalSnap = await tx.get(journalRef);
            return {
              payment: existingPayment,
              bill: billData,
              journal: journalSnap.exists()
                ? mapDocWithTimestamps<JournalEntry>(journalSnap.id, journalSnap.data() as Record<string, unknown>)
                : ({} as JournalEntry),
            };
          }

          throw new Error(
            `Payment ${paymentId} already exists with conflicting details: ` +
            (!isMatchingBill ? `billId mismatch (${existingPayment.billId} vs ${params.billId}); ` : "") +
            (!isMatchingAmount ? `amount mismatch (${existingPayment.amount} vs ${params.payment.amount}); ` : "") +
            (!isMatchingCurrency ? `currency mismatch (${existingPayment.currency} vs ${billData.currency}); ` : "")
          );
        }

        // Concurrency & Balance Validation in Integer Cents
        const grandTotalCents = Math.round(Number(billData.grandTotal ?? 0) * 100);
        const currentPaidCents = Math.round(Number(billData.amountPaid ?? 0) * 100);
        const remainingDueCents = Math.max(0, grandTotalCents - currentPaidCents);
        const paymentCents = Math.round(Number(params.payment.amount) * 100);

        if (paymentCents <= 0) {
          throw new Error(`Payment amount must be greater than zero`);
        }

        if (paymentCents > remainingDueCents) {
          const remainingFormatted = (remainingDueCents / 100).toFixed(2);
          throw new Error(`Payment exceeds amount due (${remainingFormatted})`);
        }

        const newAmountPaidCents = currentPaidCents + paymentCents;
        const newAmountPaid = Number((newAmountPaidCents / 100).toFixed(2));
        const newStatus = newAmountPaidCents >= grandTotalCents
          ? "paid"
          : (billData.status === "draft" ? "open" : billData.status);

        const paymentRecord: Payment = {
          id: paymentId,
          billId: params.billId,
          type: "vendor",
          amount: params.payment.amount,
          currency: billData.currency || "SAR",
          date: params.payment.date ? new Date(params.payment.date) : new Date(),
          methodId: params.payment.methodId,
          methodName: params.payment.methodName,
          reference: params.payment.reference,
          notes: params.payment.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const journalDTO = buildVendorPaymentJournalEntry(paymentRecord, billData, accounts);
        const deltas = aggregateBalanceDeltas(accounts, journalDTO.lines);

        // Writes
        tx.set(paymentRef, deepStripUndefined({
          ...paymentRecord,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>));

        tx.set(journalRef, deepStripUndefined({
          ...journalDTO,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>));

        for (const [accountId, delta] of deltas.entries()) {
          const accRef = doc(targetDb, "companies", companyId, "accounts", accountId);
          tx.update(accRef, {
            currentBalance: increment(delta),
            updatedAt: serverTimestamp(),
          });
        }

        tx.update(billRef, {
          amountPaid: newAmountPaid,
          status: newStatus,
          updatedAt: serverTimestamp(),
        });

        return {
          payment: paymentRecord,
          bill: { ...billData, amountPaid: newAmountPaid, status: newStatus },
          journal: { id: journalId, ...journalDTO } as JournalEntry,
        };
      });
    })());
  },
  
  settings: {
    async get(companyId: string): Promise<ApiResponse<BillingSettings>> {
      return withLogging("BillingSettingsService", "get", (async () => {
        const docSnap = await getDoc(doc(db, "companies", companyId, "settings", "billing"));
        if (!docSnap.exists()) {
          // Return some defaults if not set
          return {
            data: normalizeBillingSettingsFromFirestore({
              companyProfile: { name: "", address: "", email: "" },
              currencies: [{ ...DEFAULT_BILLING_CURRENCY_ENTRY }],
              taxes: DEFAULT_TAXES,
              paymentMethods: [],
              invoiceSequence: { prefix: "INV-", nextNumber: 1, padding: 4 },
              quotationSequence: { prefix: "QUO-", nextNumber: 1, padding: 4 },
              estimateSequence: { prefix: "EST-", nextNumber: 1, padding: 4 },
              proposalSequence: { prefix: "PRP-", nextNumber: 1, padding: 4 },
              zakatSequence: { prefix: "ZKT-", nextNumber: 1, padding: 4 },
              zakatRate: 2.5,
            } as BillingSettings),
            message: "Defaults returned"
          };
        }
        const data = docSnap.data() as BillingSettings;
        let normalized = normalizeBillingSettingsFromFirestore({
          ...data,
          taxes: data.taxes?.length ? data.taxes : DEFAULT_TAXES,
        });
        const usedNumbers = await listUsedInvoiceNumbers(companyId);
        const syncedSeq = ensureSequenceNotBehindUsage(
          normalized.invoiceSequence ?? DEFAULT_INVOICE_SEQUENCE,
          usedNumbers
        );
        if (syncedSeq.nextNumber !== normalized.invoiceSequence?.nextNumber) {
          const docRef = doc(db, "companies", companyId, "settings", "billing");
          const { setDoc } = await import("firebase/firestore");
          await setDoc(
            docRef,
            { invoiceSequence: syncedSeq, updatedAt: serverTimestamp() },
            { merge: true }
          );
          normalized = { ...normalized, invoiceSequence: syncedSeq };
        }
        return {
          data: normalized,
          message: "Success",
        };
      })());
    },
    async update(companyId: string, data: Partial<BillingSettings>): Promise<ApiResponse<BillingSettings>> {
      return withLogging("BillingSettingsService", "update", (async () => {
        const docRef = doc(db, "companies", companyId, "settings", "billing");
        const existing = (await BillingService.settings.get(companyId)).data;
        const merged = mergeBillingSettingsPatch(existing, data);
        const normalized = normalizeBillingSettingsFromFirestore(merged);
        const clean = deepStripUndefined({
          ...normalized,
          updatedAt: serverTimestamp(),
        } as Record<string, unknown>);
        const { setDoc } = await import("firebase/firestore");
        await setDoc(docRef, clean, { merge: true });
        const updated = await getDoc(docRef);
        return {
          data: normalizeBillingSettingsFromFirestore(updated.data() as BillingSettings),
          message: "Updated successfully",
        };
      })());
    }
  }
};
