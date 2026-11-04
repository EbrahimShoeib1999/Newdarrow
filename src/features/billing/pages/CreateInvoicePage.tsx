import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Autocomplete,
  AutocompleteItem,
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  Divider,
  Spinner,
  Textarea,
} from "@heroui/react";
import { Plus, Trash2, Save, Send, ChevronRight, FileText, Users, AlertTriangle, UserPlus, Edit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";

import { selectFieldProps } from "@/components/shared/select-field";
import { RiyalSymbol } from "@/components/shared/riyal-symbol";
import {
  useContactsQuery,
  useCreateContactMutation,
} from "@/features/crm/hooks/use-contacts";
import { useProducts } from "../hooks/use-products";
import { useCostCenters } from "../hooks/use-cost-centers";
import { useBillingSettings } from "../hooks/use-billing-settings";
import { useCreateInvoiceMutation, useUpdateInvoiceMutation, useInvoice } from "../hooks/use-invoices";
import { invoiceSchema, type CreateInvoiceDTO } from "../schemas/invoice";
import { ContactFormModal } from "@/features/crm/components/ContactFormModal";
import { quotationDataToInvoiceForm } from "../utils/accounting-engine";
import { BillingMoney } from "../components/BillingMoney";
import { LineTaxRateSelect } from "../components/LineTaxRateSelect";
import {
  getDefaultTax,
  getTaxRateForProduct,
} from "../utils/tax-utils";
import { DEFAULT_TAXES } from "../data/product-defaults";
import { computeInvoiceTotals, invoiceVatPercent, computeInvoiceLineValues } from "../utils/invoice-line-utils";
import {
  DEFAULT_BILLING_CURRENCY,
  getDefaultBillingCurrency,
} from "../utils/billing-currency";
import {
  findContactByCustomerInput,
  invoiceCustomerPickerLabel,
  resolveInvoiceCustomerName,
} from "../utils/invoice-customer";
import { toCreateContactDTO } from "@/features/crm/schemas/contact.schema";
import { isDocumentApproved, canApproveDocuments } from "@/lib/permissions/document-approval";
import { useAuthStore } from "@/stores/auth.store";
export default function CreateInvoicePage() {
  const { t } = useTranslation("billing");
  const { t: tCommon } = useTranslation("common");
  const navigate = useNavigate();
  const location = useLocation();
  const fromQuotation = (location.state as {
    fromQuotation?: {
      quotationId?: string;
      contactId: string;
      data: {
        currency: string;
        vatRate: number;
        pricesIncludeVat: boolean;
        notes?: string;
        validityDuration: number;
        validityUnit: "day" | "month";
        items: Array<{
          nameAr?: string;
          nameEn?: string;
          description?: string;
          quantity: number;
          unitPrice: number;
        }>;
      };
    }
  })?.fromQuotation;

  const fromContract = (location.state as {
    fromContract?: {
      contractId: string;
      contractNumber?: string;
      contactId?: string;
      customerName?: string;
      dealId?: string;
      milestoneId?: string;
      /** Delivery project reference carried through for roll-ups (never an amount). */
      projectId?: string;
      title?: string;
      currency?: string;
      amount?: number;
      vatRate?: number;
      items?: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        taxRate?: number;
        total?: number;
      }>;
    }
  })?.fromContract;

  const fromDeal = (location.state as {
    fromDeal?: {
      dealId: string;
      contactId?: string;
      amount?: number;
      currency?: string;
      title?: string;
      projectId?: string;
    }
  })?.fromDeal;

  const { data: contactsRes } = useContactsQuery();
  const contacts = contactsRes?.data || [];
  const createContact = useCreateContactMutation();
  const [customerInput, setCustomerInput] = useState("");
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editContactModalOpen, setEditContactModalOpen] = useState(false);
  const createdContactCache = useRef<Map<string, string>>(new Map());

  const { data: products = [] } = useProducts();
  const { data: costCenters = [] } = useCostCenters();
  const { data: billingSettings, isPending: isLoadingSettings, error: settingsError, refetch: refetchSettings } = useBillingSettings();
  const tenantTaxes = billingSettings?.taxes ?? [];
  /** Gate: new invoices MUST wait for settings so the first line shows the
   *  tenant default rate (15%) immediately — never a misleading 0%. Editing
   *  an existing invoice keeps its stored tax values, so settings are less
   *  critical (only for the dropdown list). */
  const settingsReady = !isLoadingSettings && !settingsError && !!billingSettings;

  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  // Timeout: if settings don't resolve within 8 s, unblock the form with a
  // fallback from DEFAULT_TAXES so the user is never stuck on a spinner.
  const [settingsTimedOut, setSettingsTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (settingsReady || isEditing) return;
    timeoutRef.current = setTimeout(() => setSettingsTimedOut(true), 8000);
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [settingsReady, isEditing]);

  /** Effective readiness: true when settings loaded OR when the timeout fired
   *  (fallback to the product default 15% so the form is never blocked). */
  const formReady = settingsReady || settingsTimedOut || isEditing;

  /** Single source of truth for tax options and default:
   *  - Settings loaded → use tenant's configured taxes.
   *  - Timeout/failure → fall back to built-in DEFAULT_TAXES (15% + 0%).
   *  - Still loading → empty (form is gated behind spinner). */
  const effectiveTaxes = tenantTaxes.length > 0 ? tenantTaxes : (settingsTimedOut ? DEFAULT_TAXES : []);
  const effectiveDefaultTax = getDefaultTax(effectiveTaxes);

  const { data: existingInvoice, isLoading: isLoadingExisting } = useInvoice(id);

  const createInvoice = useCreateInvoiceMutation();
  const updateInvoice = useUpdateInvoiceMutation();
  const role = useAuthStore((s) => s.user?.role);
  const canIssueImmediately = canApproveDocuments(role);
  const canUsePrimaryAction =
    !isEditing ||
    existingInvoice?.status === "draft" ||
    existingInvoice?.status === "pending" ||
    isDocumentApproved(existingInvoice);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateInvoiceDTO>({
    resolver: zodResolver(invoiceSchema) as any,
    defaultValues: {
      invoiceNumber: "DRAFT",
      status: "draft",
      customerId: "",
      customerName: "",
      currency: DEFAULT_BILLING_CURRENCY,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      items: [{
        description: "",
        quantity: 1,
        unitPrice: 0,
        taxRate: 0,
        taxRateId: null,
        discount: 0,
        total: 0,
      }],
      subTotal: 0,
      totalTax: 0,
      totalDiscount: 0,
      grandTotal: 0,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  useEffect(() => {
    if (!isEditing && fromQuotation?.contactId && fromQuotation.data) {
      const draft = quotationDataToInvoiceForm({
        customerId: fromQuotation.contactId,
        quotationId: fromQuotation.quotationId,
        currency: fromQuotation.data.currency,
        vatRate: fromQuotation.data.vatRate,
        pricesIncludeVat: fromQuotation.data.pricesIncludeVat,
        notes: fromQuotation.data.notes,
        validityDuration: fromQuotation.data.validityDuration,
        validityUnit: fromQuotation.data.validityUnit,
        items: fromQuotation.data.items,
      });
      const contact = contacts.find((c) => c.id === fromQuotation.contactId);
      const customerName = contact
        ? invoiceCustomerPickerLabel(contact)
        : draft.customerName ?? "";
      control._reset({ ...draft, customerName } as any);
      setCustomerInput(customerName);
    }
  }, [isEditing, fromQuotation, control, contacts]);

  useEffect(() => {
    if (!isEditing && fromContract?.contractId) {
      const contact = contacts.find((c) => c.id === fromContract.contactId);
      const customerName = fromContract.customerName || (contact ? invoiceCustomerPickerLabel(contact) : "");
      const vatRate = fromContract.vatRate ?? effectiveDefaultTax?.rate ?? 15;

      const items = fromContract.items && fromContract.items.length > 0
        ? fromContract.items.map((i) => {
          const beforeTax = i.quantity * i.unitPrice;
          const tax = beforeTax * ((i.taxRate ?? vatRate) / 100);
          return {
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            taxRate: i.taxRate ?? vatRate,
            taxRateId: effectiveDefaultTax?.id ?? null,
            discount: 0,
            total: beforeTax + tax,
          };
        })
        : [{
          description: fromContract.title || `دفعة تعاقدية - عقد #${fromContract.contractNumber || fromContract.contractId}`,
          quantity: 1,
          unitPrice: fromContract.amount || 0,
          taxRate: vatRate,
          taxRateId: effectiveDefaultTax?.id ?? null,
          discount: 0,
          total: (fromContract.amount || 0) * (1 + vatRate / 100),
        }];

      const subTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const totalTax = items.reduce((s, i) => s + (i.quantity * i.unitPrice * (i.taxRate ?? 0)) / 100, 0);
      const grandTotal = subTotal + totalTax;

      const resetData = {
        invoiceNumber: "DRAFT",
        status: "draft" as const,
        customerId: fromContract.contactId || "",
        customerName,
        contractId: fromContract.contractId,
        dealId: fromContract.dealId,
        milestoneId: fromContract.milestoneId,
        projectId: fromContract.projectId,
        currency: fromContract.currency || DEFAULT_BILLING_CURRENCY,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        items,
        subTotal,
        totalTax,
        totalDiscount: 0,
        grandTotal,
        amountPaid: 0,
        notes: `فاتورة مرحلية مرتبطة بالعقد رقم ${fromContract.contractNumber || fromContract.contractId}`,
      };

      control._reset(resetData as any);
      setCustomerInput(customerName);
    }
  }, [isEditing, fromContract, control, contacts, effectiveDefaultTax]);

  useEffect(() => {
    if (!isEditing && fromDeal?.dealId) {
      const contact = contacts.find((c) => c.id === fromDeal.contactId);
      const customerName = contact ? invoiceCustomerPickerLabel(contact) : "";
      const vatRate = effectiveDefaultTax?.rate ?? 15;

      const items = [{
        description: fromDeal.title || `خدمات مرتبطة بالصفقة #${fromDeal.dealId}`,
        quantity: 1,
        unitPrice: fromDeal.amount || 0,
        taxRate: vatRate,
        taxRateId: effectiveDefaultTax?.id ?? null,
        discount: 0,
        total: (fromDeal.amount || 0) * (1 + vatRate / 100),
      }];

      const subTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
      const totalTax = items.reduce((s, i) => s + (i.quantity * i.unitPrice * (i.taxRate ?? 0)) / 100, 0);
      const grandTotal = subTotal + totalTax;

      const resetData = {
        invoiceNumber: "DRAFT",
        status: "draft" as const,
        customerId: fromDeal.contactId || "",
        customerName,
        dealId: fromDeal.dealId,
        projectId: fromDeal.projectId,
        currency: fromDeal.currency || DEFAULT_BILLING_CURRENCY,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        items,
        subTotal,
        totalTax,
        totalDiscount: 0,
        grandTotal,
        amountPaid: 0,
        notes: `فاتورة مرتبطة بالصفقة #${fromDeal.dealId}`,
      };

      control._reset(resetData as any);
      setCustomerInput(customerName);
    }
  }, [isEditing, fromDeal, control, contacts, effectiveDefaultTax]);

  useEffect(() => {
    if (isEditing && existingInvoice) {
      const name = resolveInvoiceCustomerName(
        existingInvoice,
        contacts,
        existingInvoice.customerName ?? ""
      );
      const resetData = {
        ...existingInvoice,
        customerName: existingInvoice.customerName || name,
        issueDate: new Date(existingInvoice.issueDate),
        dueDate: new Date(existingInvoice.dueDate),
      };
      control._reset(resetData as any);
      setCustomerInput(existingInvoice.customerName || name);
    }
  }, [isEditing, existingInvoice, control, contacts]);

  useEffect(() => {
    if (!isEditing && !fromQuotation && !fromContract && !fromDeal && billingSettings) {
      setValue("currency", getDefaultBillingCurrency(billingSettings));
    }
  }, [billingSettings, fromQuotation, fromContract, fromDeal, isEditing, setValue]);

  useEffect(() => {
    if (isEditing || fromQuotation) return;
    if (!effectiveDefaultTax) return;
    const items = watch("items");
    if (
      items?.length === 1 &&
      !items[0]?.taxRateId &&
      (items[0]?.taxRate ?? 0) === 0
    ) {
      setValue("items.0.taxRateId", effectiveDefaultTax.id);
      setValue("items.0.taxRate", effectiveDefaultTax.rate);
    }
  }, [effectiveDefaultTax, fromQuotation, isEditing, setValue, watch]);

  const watchItems = watch("items");
  const currency = watch("currency") ?? DEFAULT_BILLING_CURRENCY;

  // Dynamic calculations — ONE canonical formula (never duplicated per page).
  const {
    subTotal,
    totalDiscount,
    totalTax,
    grandTotal,
  } = computeInvoiceTotals(watchItems);

  const handleProductSelect = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      setValue(`items.${index}.description`, product.name);
      setValue(`items.${index}.unitPrice`, product.price);
      setValue(`items.${index}.productId`, product.id ?? null);
      const rate = getTaxRateForProduct(effectiveTaxes, product.taxRateId);
      const tax =
        effectiveTaxes.find((tx) => tx.id === product.taxRateId) ?? effectiveDefaultTax ?? null;
      setValue(`items.${index}.taxRateId`, tax?.id ?? null);
      setValue(`items.${index}.taxRate`, rate);
    }
  };

  const appendLine = () => {
    append({
      description: "",
      quantity: 1,
      unitPrice: 0,
      taxRate: effectiveDefaultTax?.rate ?? 0,
      taxRateId: effectiveDefaultTax?.id ?? null,
      discount: 0,
      total: 0,
    });
  };

  const resolveCustomerForSave = async (
    data: CreateInvoiceDTO
  ): Promise<{ customerId: string; customerName: string }> => {
    const typedName = (data.customerName || customerInput).trim();
    let customerId = data.customerId?.trim() || "";

    if (customerId) {
      const selected = contacts.find((c) => c.id === customerId);
      return {
        customerId,
        customerName:
          typedName ||
          (selected ? invoiceCustomerPickerLabel(selected) : customerId),
      };
    }

    if (!typedName) {
      throw new Error("customer_required");
    }

    const cacheKey = typedName.toLowerCase();
    if (createdContactCache.current.has(cacheKey)) {
      const cachedId = createdContactCache.current.get(cacheKey)!;
      setValue("customerId", cachedId, { shouldValidate: true });
      return { customerId: cachedId, customerName: typedName };
    }

    const existing = findContactByCustomerInput(contacts, typedName);
    if (existing?.id) {
      createdContactCache.current.set(cacheKey, existing.id);
      setValue("customerId", existing.id, { shouldValidate: true });
      return {
        customerId: existing.id,
        customerName: typedName,
      };
    }

    const created = await createContact.mutateAsync(
      toCreateContactDTO({
        firstName: typedName,
        lastName: "",
        email: "",
        phone: "",
        accountName: typedName,
      })
    );

    const newId = created.data.id;
    createdContactCache.current.set(cacheKey, newId);
    setValue("customerId", newId, { shouldValidate: true });
    setValue("customerName", typedName, { shouldValidate: true });
    setCustomerInput(typedName);

    return {
      customerId: newId,
      customerName: typedName,
    };
  };

  const onSubmit = async (data: CreateInvoiceDTO, actionType: "draft" | "sent") => {
    // Guard: never save a new invoice when tax settings are unverified.
    if (!isEditing && !formReady) {
      toast.error(t("invoices.create.settings_error", "Tax settings not loaded — cannot save."));
      return;
    }
    try {
      if (
        actionType === "sent" &&
        isEditing &&
        existingInvoice &&
        existingInvoice.status !== "draft" &&
        existingInvoice.status !== "pending" &&
        !isDocumentApproved(existingInvoice)
      ) {
        toast.error(tCommon("documentApproval.lockedHint"));
        return;
      }
      const customer = await resolveCustomerForSave(data);
      const finalData: CreateInvoiceDTO = {
        ...data,
        ...customer,
        status: actionType,
        subTotal,
        totalTax,
        totalDiscount,
        grandTotal,
        items: watchItems.map((item, index) => {
          const line = computeInvoiceLineValues(item);
          return {
            ...data.items[index],
            ...item,
            quantity: Number(item.quantity) || 0,
            unitPrice: Number(item.unitPrice) || 0,
            discount: line.discount,
            taxRate: Number(item.taxRate) || 0,
            total: line.total,
          };
        }),
      };
      if (isEditing && id) {
        const result = await updateInvoice.mutateAsync({ id, data: finalData });
        toast.success(
          result.invoice.status === "pending"
            ? t("invoices.create.submitted_for_approval")
            : actionType === "sent"
              ? t("invoices.create.sent")
              : t("invoices.create.updated")
        );
      } else {
        const created = await createInvoice.mutateAsync(finalData);
        toast.success(
          created.status === "pending"
            ? t("invoices.create.submitted_for_approval")
            : actionType === "sent"
              ? t("invoices.create.sent")
              : t("invoices.create.draft_saved")
        );
      }
      navigate("/billing/invoices");
    } catch {
      toast.error(t("invoices.create.save_failed"));
    }
  };

  if (isEditing && isLoadingExisting) {
    return (
      <div className="p-8 text-center animate-pulse">
        {t("invoices.create.loading")}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-24 animate-in fade-in duration-300">
      {/* Page header — compact breadcrumb + inline DRAFT chip so the invoice
          status is at a glance before the user even scrolls. */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-xs text-default-500 mb-1">
            <Link to="/billing" className="hover:text-primary transition-colors">
              {t("module_name")}
            </Link>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" />
            <Link to="/billing/invoices" className="hover:text-primary transition-colors">
              {t("invoices.title")}
            </Link>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" />
            <span className="font-medium text-default-700">
              {isEditing ? t("invoices.create.edit_title") : t("invoices.create.title")}
            </span>
          </nav>
          <h1 className="text-xl md:text-2xl font-bold text-default-900 flex items-start gap-2">
            <FileText className="mt-1 shrink-0 w-5 h-5 text-primary" />
            <span className="min-w-0 break-words">
              {isEditing ? t("invoices.create.edit_title") : t("invoices.create.title")}
            </span>
          </h1>
          <p className="text-sm text-default-500 mt-0.5">{t("invoices.create.subtitle")}</p>
        </div>
        <Chip size="sm" variant="flat" color="warning" className="font-semibold shrink-0">
          {t("invoices.create.status_draft")}
        </Chip>
      </div>

      <form className="space-y-5">
        {/* Invoice information */}
        <Card className="border border-default-100 shadow-sm rounded-2xl">
          <CardBody className="p-5 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
              {/* Customer: pick existing or type a new company/client name */}
              <div className="md:col-span-2 xl:col-span-1">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <Controller
                      control={control}
                      name="customerId"
                      render={({ field }) => (
                        <Autocomplete
                          label={t("invoices.create.customer")}
                          placeholder={t("invoices.create.customer_placeholder")}
                          description={t("invoices.create.customer_hint")}
                          startContent={<Users className="w-4 h-4 text-default-400 pointer-events-none shrink-0" />}
                          variant="bordered"
                          allowsCustomValue
                          menuTrigger="focus"
                          inputValue={customerInput}
                          selectedKey={field.value || null}
                          onInputChange={(value) => {
                            setCustomerInput(value);
                            setValue("customerName", value, { shouldValidate: true });
                            const selected = contacts.find((c) => c.id === field.value);
                            if (selected) {
                              const label = invoiceCustomerPickerLabel(selected).toLowerCase();
                              const acc = (selected.accountName || "").toLowerCase();
                              const first = (selected.firstName || "").toLowerCase();
                              const val = value.trim().toLowerCase();
                              if (!val) {
                                field.onChange("");
                              } else if (val !== label && val !== acc && val !== first) {
                                const found = findContactByCustomerInput(contacts, val);
                                if (found?.id) {
                                  field.onChange(found.id);
                                }
                              }
                            }
                          }}
                          onSelectionChange={(key) => {
                            const id = key != null ? String(key) : "";
                            field.onChange(id);
                            if (!id) return;
                            const contact = contacts.find((c) => c.id === id);
                            if (!contact) return;
                            const label = invoiceCustomerPickerLabel(contact);
                            setCustomerInput(label);
                            setValue("customerName", label, { shouldValidate: true });
                          }}
                          onBlur={field.onBlur}
                          isInvalid={!!errors.customerId}
                          errorMessage={errors.customerId?.message as string | undefined}
                          listboxProps={{
                            emptyContent: t("invoices.create.customer_empty"),
                          }}
                        >
                          {contacts.map((contact) => {
                            const label = invoiceCustomerPickerLabel(contact);
                            return (
                              <AutocompleteItem key={contact.id!} textValue={label}>
                                <div className="flex flex-col">
                                  <span className="font-medium">{label}</span>
                                  {contact.email ? (
                                    <span className="text-xs text-default-400">
                                      {contact.email}
                                    </span>
                                  ) : null}
                                </div>
                              </AutocompleteItem>
                            );
                          })}
                        </Autocomplete>
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-1 pt-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                      className="h-10 text-xs font-semibold px-2.5"
                      startContent={<UserPlus className="w-3.5 h-3.5" />}
                      onPress={() => setContactModalOpen(true)}
                    >
                      {t("invoices.create.add_contact", "عميل جديد")}
                    </Button>
                    {watch("customerId") && contacts.find((c) => c.id === watch("customerId")) && (
                      <Button
                        size="sm"
                        variant="bordered"
                        isIconOnly
                        className="h-10 w-10 text-default-600"
                        title={t("invoices.create.edit_contact", "تعديل بيانات العميل")}
                        onPress={() => setEditContactModalOpen(true)}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Invoice number — read-only + a visually distinct DRAFT chip. */}
              <Input
                label={t("invoices.create.invoice_number")}
                variant="bordered"
                isReadOnly
                classNames={{
                  input: "font-mono tracking-wide",
                  mainWrapper: "[&_.input-wrapper]:bg-default-50",
                }}
                {...register("invoiceNumber")}
                endContent={
                  <Chip size="sm" variant="flat" color="warning" className="pointer-events-none h-5 text-[10px] font-bold">
                    {t("invoices.create.status_draft")}
                  </Chip>
                }
                description={t("invoices.create.number_assigned_on_post")}
              />

              <Controller
                name="costCenterId"
                control={control}
                render={({ field }) => (
                  <Select
                    label={t("cost_centers.title", "مركز التكلفة (Cost Center)")}
                    placeholder={t("cost_centers.pick_optional", "اختر مركز التكلفة (اختياري)...")}
                    variant="bordered"
                    selectedKeys={field.value ? [field.value] : []}
                    onSelectionChange={(keys) => field.onChange(Array.from(keys)[0] as string || "")}
                  >
                    {costCenters.map((cc) => (
                      <SelectItem key={cc.id!} textValue={`${cc.code} - ${cc.name}`}>
                        {cc.code} - {cc.name}
                      </SelectItem>
                    ))}
                  </Select>
                )}
              />
            </div>
          </CardBody>
        </Card>

        {/* --- Settings loading / error gate --------------------------------
            New invoices MUST NOT render line items until billing settings
            resolve, preventing a misleading "VAT (0%)" flash. Editing existing
            invoices is fine because tax values are already stored per-line. */}
        {!formReady && !settingsError && (
          <Card className="border border-default-100 shadow-sm rounded-2xl">
            <CardBody className="p-10 flex flex-col items-center gap-3">
              <Spinner size="lg" color="primary" />
              <p className="text-sm text-default-500">{t("invoices.create.loading_tax_settings", "Loading tax settings…")}</p>
            </CardBody>
          </Card>
        )}

        {settingsError && (
          <Card className="border border-danger-200 shadow-sm rounded-2xl">
            <CardBody className="p-6 flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-8 h-8 text-danger" />
              <p className="text-sm font-medium text-danger">
                {t("invoices.create.settings_error", "Could not load billing tax settings. Invoice cannot be saved until rates are verified.")}
              </p>
              <Button
                size="sm"
                variant="bordered"
                color="primary"
                onPress={() => refetchSettings()}
              >
                {t("invoices.create.retry", "Retry")}
              </Button>
            </CardBody>
          </Card>
        )}

        {settingsTimedOut && !settingsReady && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-warning-50 border border-warning-200 text-warning-700 text-sm" role="alert">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{t("invoices.create.settings_timeout_warning", "Billing settings could not be verified. Using default VAT 15%. Retry to load tenant configuration.")}</span>
            <Button size="sm" variant="light" color="warning" onPress={() => { setSettingsTimedOut(false); refetchSettings(); }}>
              {t("invoices.create.retry", "Retry")}
            </Button>
          </div>
        )}

        {formReady && (
          <>
            {/* Items Table */}
            <Card className="border border-default-100 shadow-sm rounded-2xl">
              <CardHeader className="px-5 md:px-6 py-4 flex justify-between items-center bg-default-50/60 rounded-t-2xl">
                <h3 className="font-bold text-base md:text-lg text-default-800 flex items-center gap-2">
                  {t("invoices.create.item_details")}
                  <Chip size="sm" variant="flat" className="h-5 text-[10px] font-bold">
                    {fields.length}
                  </Chip>
                </h3>
                <span className="hidden md:inline text-xs text-default-500">
                  {t("invoices.create.sub_total_hint")}
                </span>
              </CardHeader>
              <Divider />
              <CardBody className="p-0 overflow-x-auto">
                <table className="w-full min-w-[820px] text-start table-fixed">
                  <thead className="bg-default-50/70 text-xs md:text-sm font-semibold text-default-600 uppercase tracking-wide">
                    <tr>
                      <th className="p-3 md:p-4 w-[34%] text-start">{t("invoices.create.product_item")}</th>
                      <th className="p-3 md:p-4 w-[12%] text-center">{t("invoices.create.quantity")}</th>
                      <th className="p-3 md:p-4 w-[16%] text-end">{t("invoices.create.rate")}</th>
                      <th className="p-3 md:p-4 w-[18%] text-start">{t("invoices.create.tax")}</th>
                      <th className="p-3 md:p-4 w-[14%] text-end">{t("invoices.create.amount")}</th>
                      <th className="p-3 md:p-4 w-[6%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field, index) => {
                      const line = computeInvoiceLineValues(watch(`items.${index}`));
                      const tx = Number(watch(`items.${index}.taxRate`)) || 0;
                      const amtBeforeTax = line.beforeTax;
                      const lineVat = line.vat;
                      const lineTotal = line.total;

                      return (
                        <tr key={field.id} className="border-b border-default-100/70 last:border-b-0 group hover:bg-default-50/40 transition-colors">
                          <td className="p-3 md:p-4 align-top min-w-0 max-w-[280px]">
                            <div className="flex flex-col gap-1.5 min-w-0">
                              <Select
                                {...selectFieldProps({ compact: true })}
                                size="sm"
                                aria-label={t("invoices.create.product_item")}
                                placeholder={t("invoices.create.select_product")}
                                variant="flat"
                                classNames={{
                                  value: "whitespace-normal [overflow-wrap:anywhere] break-normal text-xs leading-relaxed text-start min-w-0 py-1",
                                  trigger: "h-auto min-h-10 py-1.5",
                                  popoverContent: "max-w-[420px] w-full",
                                }}
                                onChange={(e) => handleProductSelect(index, e.target.value)}
                              >
                                {products.map((p) => (
                                  <SelectItem
                                    key={p.id}
                                    textValue={p.name}
                                    className="whitespace-normal [overflow-wrap:anywhere] break-normal py-2"
                                  >
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-medium whitespace-normal [overflow-wrap:anywhere] break-normal text-xs">{p.name}</span>
                                      {p.description && (
                                        <span className="text-[10px] text-default-400 whitespace-normal [overflow-wrap:anywhere] break-normal line-clamp-2 mt-0.5">
                                          {p.description}
                                        </span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </Select>
                              <Input
                                size="sm"
                                placeholder={t("invoices.create.item_description")}
                                variant="flat"
                                classNames={{ input: "text-sm" }}
                                {...register(`items.${index}.description` as const)}
                                isInvalid={!!errors.items?.[index]?.description}
                              />
                            </div>
                          </td>
                          <td className="p-3 md:p-4 align-top">
                            <Input
                              size="sm"
                              type="number"
                              variant="flat"
                              className="w-full"
                              classNames={{ input: "text-center" }}
                              {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                            />
                          </td>
                          <td className="p-3 md:p-4 align-top">
                            <Input
                              size="sm"
                              type="number"
                              variant="flat"
                              dir="ltr"
                              classNames={{ input: "text-end tabular-nums" }}
                              startContent={<RiyalSymbol size={12} className="text-default-400" />}
                              {...register(`items.${index}.unitPrice` as const, { valueAsNumber: true })}
                            />
                          </td>
                          <td className="p-3 md:p-4 align-top">
                            <div className="flex flex-col gap-1">
                              <LineTaxRateSelect
                                taxes={effectiveTaxes}
                                taxRateId={watch(`items.${index}.taxRateId`)}
                                onChange={(tax) => {
                                  setValue(`items.${index}.taxRateId`, tax?.id ?? null);
                                  setValue(`items.${index}.taxRate`, tax?.rate ?? 0);
                                }}
                              />
                              {tx > 0 && amtBeforeTax > 0 ? (
                                <span className="text-[11px] text-default-500 rtl:text-start ltr:text-end">
                                  {t("invoices.create.line_tax_amount", { amount: lineVat.toFixed(2) })}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-3 md:p-4 align-top text-end">
                            <div className="flex flex-col items-end gap-0.5">
                              <BillingMoney
                                amount={lineTotal}
                                currency={currency}
                                className="font-semibold text-default-800 tabular-nums"
                              />
                              {tx > 0 && amtBeforeTax > 0 ? (
                                <span className="text-[11px] text-default-400 tabular-nums">
                                  {t("invoices.create.line_amount_before_tax")}: {amtBeforeTax.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-3 md:p-4 align-top text-end">
                            <Button
                              isIconOnly
                              variant="light"
                              color="danger"
                              size="sm"
                              onPress={() => remove(index)}
                              className={fields.length <= 1 ? "opacity-30 pointer-events-none" : "opacity-60 group-hover:opacity-100 transition-opacity"}
                              aria-label={t("invoices.create.remove_line", "Remove line")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="p-3 md:p-4 border-t border-default-100">
                  <Button
                    variant="bordered"
                    color="primary"
                    size="sm"
                    startContent={<Plus className="w-4 h-4" />}
                    onPress={appendLine}
                    className="rounded-lg"
                  >
                    {t("invoices.create.add_line")}
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Notes / terms on the left, summary card on the right (stacked on mobile). */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 space-y-4">
                <Textarea
                  label={t("invoices.create.notes")}
                  placeholder={t("invoices.create.notes_placeholder")}
                  variant="bordered"
                  minRows={2}
                  className="[&_.inner-wrapper]:!min-h-[80px]"
                  {...register("notes")}
                />
                <Textarea
                  label={t("invoices.create.terms")}
                  placeholder={t("invoices.create.terms_placeholder")}
                  variant="bordered"
                  minRows={2}
                  className="[&_.inner-wrapper]:!min-h-[80px]"
                  {...register("termsAndConditions")}
                />
              </div>

              <Card className="lg:col-span-1 lg:sticky lg:top-4 border border-default-200 shadow-sm rounded-2xl bg-content1 overflow-hidden">
                <div className="px-5 py-3 bg-default-50/70 border-b border-default-100">
                  <h3 className="text-sm font-bold text-default-800">{t("invoices.create.summary_title")}</h3>
                </div>
                <CardBody className="p-5 space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-default-700">{t("invoices.create.sub_total")}</div>
                      <div className="text-[11px] text-default-400">{t("invoices.create.sub_total_hint")}</div>
                    </div>
                    <BillingMoney amount={subTotal} currency={currency} className="font-medium tabular-nums" />
                  </div>
                  {totalDiscount > 0 && (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-danger">{t("invoices.create.discount")}</span>
                      <BillingMoney amount={-totalDiscount} currency={currency} className="tabular-nums text-danger" />
                    </div>
                  )}
                  {/* VAT row: percentage beside the label + monetary amount beside
                  it — critical for the requirement. The rate is derived from
                  the stored amounts, so mixed-rate invoices show the true
                  effective percentage, never a hardcoded 15. */}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-default-700">
                      {t("invoices.create.vat_row_label", {
                        rate: invoiceVatPercent(subTotal, totalTax, effectiveDefaultTax?.rate ?? 0),
                      })}
                    </span>
                    <BillingMoney amount={totalTax} currency={currency} className="font-medium tabular-nums" />
                  </div>
                  <Divider className="my-1" />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-bold text-default-900">{t("invoices.create.total")}</span>
                    <BillingMoney
                      amount={grandTotal}
                      currency={currency}
                      className="text-xl md:text-2xl font-extrabold text-primary tabular-nums"
                    />
                  </div>
                </CardBody>
              </Card>
            </div>

            {/* Sticky action bar */}
            <div className="fixed bottom-0 inset-x-0 sm:static sm:bottom-auto z-10 bg-background/85 backdrop-blur-md border-t sm:border sm:rounded-2xl sm:shadow-md sm:mt-2 px-4 py-3">
              {isEditing && existingInvoice?.status === "pending" && !canIssueImmediately && (
                <p className="w-full text-xs text-warning mb-2">
                  {tCommon("documentApproval.lockedHint")}
                </p>
              )}
              <div className="flex justify-end gap-2 md:gap-3 w-full max-w-6xl mx-auto">
                <Button
                  variant="flat"
                  color="default"
                  onPress={() => handleSubmit((data) => onSubmit(data as any, "draft"))()}
                  isLoading={isSubmitting || updateInvoice.isPending || createInvoice.isPending || createContact.isPending}
                  isDisabled={!formReady}
                  startContent={<Save className="w-4 h-4" />}
                  className="min-w-[130px] md:min-w-[150px]"
                >
                  {isEditing ? t("invoices.create.update_draft") : t("invoices.create.save_draft")}
                </Button>
                <Button
                  color="primary"
                  onPress={() => handleSubmit((data) => onSubmit(data as any, "sent"))()}
                  isLoading={isSubmitting || updateInvoice.isPending || createInvoice.isPending || createContact.isPending}
                  isDisabled={!canUsePrimaryAction || !formReady}
                  startContent={<Send className="w-4 h-4" />}
                  className="min-w-[150px] md:min-w-[170px] font-semibold"
                >
                  {isEditing
                    ? t("invoices.create.update_send")
                    : canIssueImmediately
                      ? t("invoices.create.save_send")
                      : t("invoices.create.save_submit")}
                </Button>
              </div>
            </div>
          </>
        )}
      </form>
      {/* Quick Contact Create/Edit Modals */}
      <ContactFormModal
        isOpen={contactModalOpen}
        onOpenChange={setContactModalOpen}
        onSuccess={(created) => {
          setValue("customerId", created.id, { shouldValidate: true });
          const label = invoiceCustomerPickerLabel(created);
          setValue("customerName", label, { shouldValidate: true });
          setCustomerInput(label);
          toast.success(t("invoices.create.customer_created", "تمت إضافة العميل بنجاح"));
        }}
      />
      {watch("customerId") && contacts.find((c) => c.id === watch("customerId")) && (
        <ContactFormModal
          isOpen={editContactModalOpen}
          onOpenChange={setEditContactModalOpen}
          contact={contacts.find((c) => c.id === watch("customerId"))}
          onSuccess={(updated) => {
            const label = invoiceCustomerPickerLabel(updated);
            setValue("customerName", label, { shouldValidate: true });
            setCustomerInput(label);
            toast.success(t("invoices.create.customer_updated", "تم تحديث بيانات العميل بنجاح"));
          }}
        />
      )}
    </div>
  );
}
