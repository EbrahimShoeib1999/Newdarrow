import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Select,
  SelectItem,
  Chip,
  Tabs,
  Tab,
  Checkbox,
} from "@heroui/react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAllUsers } from "@/features/users/hooks/use-users";
import { selectFieldProps } from "@/components/shared/select-field";
import {
  contactFormSchema,
  toCreateContactDTO,
  type ContactFormValues,
} from "../schemas/contact.schema";
import { useCreateContactMutation, useUpdateContactMutation } from "../hooks/use-contacts";
import { useContactClassifications } from "../hooks/use-contact-classifications";
import type {
  Contact,
  ContactSource,
  ContactStatus,
  EntityType,
  EstablishmentType,
  ContactRelationship,
} from "../types/contacts.types";
import { AssociatedContactsSection } from "./AssociatedContactsSection";
import { SocialAccountsSection } from "./SocialAccountsSection";
import { AddressesSection } from "./AddressesSection";
import {
  User,
  Building2,
  Building,
  Landmark,
  HeartHandshake,
  DollarSign,
  Radio,
  Sparkles,
  HelpCircle,
  Tag,
  Globe,
  CheckCircle2,
  Phone,
  Mail,
  UserCheck,
  CreditCard,
  Briefcase,
  Plus,
  Layers,
} from "lucide-react";

interface ContactFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  onSuccess?: (contact: Contact) => void;
}

const ENTITY_TYPES: { key: EntityType; labelAr: string; labelEn: string; icon: any }[] = [
  { key: "individual", labelAr: "فرد", labelEn: "Individual", icon: User },
  { key: "company", labelAr: "شركة", labelEn: "Company", icon: Building2 },
  { key: "establishment", labelAr: "مؤسسة", labelEn: "Establishment", icon: Building },
  { key: "government", labelAr: "جهة حكومية", labelEn: "Government Entity", icon: Landmark },
  { key: "non_profit", labelAr: "جمعية / غير ربحية", labelEn: "Non-Profit / NGO", icon: HeartHandshake },
  { key: "bank", labelAr: "بنك / جهة مالية", labelEn: "Bank / Financial", icon: DollarSign },
  { key: "media", labelAr: "جهة إعلامية", labelEn: "Media Entity", icon: Radio },
  { key: "influencer", labelAr: "مؤثر / صانع محتوى", labelEn: "Influencer / Creator", icon: Sparkles },
  { key: "other", labelAr: "أخرى", labelEn: "Other", icon: HelpCircle },
];

const RELATIONSHIPS_LIST: { key: ContactRelationship; labelAr: string; labelEn: string; color: "primary" | "secondary" | "success" | "warning" | "default" }[] = [
  { key: "lead", labelAr: "عميل محتمل", labelEn: "Lead", color: "warning" },
  { key: "new_client", labelAr: "عميل جديد", labelEn: "New Client", color: "primary" },
  { key: "active_client", labelAr: "عميل حالي", labelEn: "Active Client", color: "success" },
  { key: "former_client", labelAr: "عميل سابق", labelEn: "Former Client", color: "default" },
  { key: "paused_client", labelAr: "عميل متوقف", labelEn: "Paused Client", color: "default" },
  { key: "vip_client", labelAr: "عميل VIP", labelEn: "VIP Client", color: "secondary" },
  { key: "vendor", labelAr: "مورد", labelEn: "Vendor", color: "primary" },
  { key: "partner", labelAr: "شريك", labelEn: "Partner", color: "secondary" },
  { key: "contractor", labelAr: "جهة متعاقدة", labelEn: "Contractor", color: "primary" },
  { key: "referral", labelAr: "جهة إحالة", labelEn: "Referral", color: "success" },
  { key: "media", labelAr: "جهة إعلامية", labelEn: "Media", color: "warning" },
  { key: "influencer", labelAr: "مؤثر / صانع محتوى", labelEn: "Influencer", color: "secondary" },
];

const COMMON_SERVICES = [
  "إدارة حسابات",
  "صناعة محتوى",
  "تصميم",
  "تصوير وإنتاج مرئي",
  "ريلز وفيديوهات قصيرة",
  "إعلانات ممولة",
  "سيو ومحركات بحث",
  "مؤثرون وحملات تسويقية",
  "هوية بصرية كاملة",
  "موقع إلكتروني",
  "متجر إلكتروني",
  "بروفايل شركة",
  "علاقات عامة",
];

export function ContactFormModal({ isOpen, onOpenChange, contact, onSuccess }: ContactFormModalProps) {
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { data: users } = useAllUsers();
  const { activeClassifications } = useContactClassifications();
  const createContact = useCreateContactMutation();
  const updateContact = useUpdateContactMutation();
  const isEdit = !!contact;

  const [activeTab, setActiveTab] = useState<string>("details");
  const [keepOpenAfterSave, setKeepOpenAfterSave] = useState(false);
  const [customInterestInput, setCustomInterestInput] = useState("");

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema) as any,
    defaultValues: {
      entityType: "individual",
      firstName: "",
      fatherName: "",
      lastName: "",
      accountName: "",
      legalName: "",
      email: "",
      phone: "",
      secondaryPhone: "",
      whatsappPhone: "",
      landlinePhone: "",
      website: "",
      establishmentType: "llc",
      commercialRegister: "",
      unifiedNumber: "",
      taxNumber: "",
      crExpiryDate: "",
      mainActivity: "",
      companySize: "",
      city: "",
      region: "",
      branchesCount: undefined,
      govSector: "",
      administration: "",
      department: "",
      tenderNumber: "",
      contractNumber: "",
      licenseNumber: "",
      nonProfitType: "",
      financialInstitutionType: "",
      mediaPlatformType: "",
      audienceSize: "",
      contentNiche: "",
      collaborationAreas: "",
      managerName: "",
      nationalId: "",
      nationality: "سعودي",
      jobTitle: "",
      relationships: ["active_client"],
      relationshipStatuses: {},
      classification: "actual_client",
      source: "website",
      status: "active",
      satisfaction: "satisfied",
      satisfactionNotes: "",
      interests: [],
      tags: [],
      notes: "",
      associatedContacts: [],
      socialAccounts: [],
      addresses: [],
      financialInfo: {
        taxNumber: "",
        vatRegistered: "unknown",
        preferredPaymentMethod: "bank_transfer",
        paymentTerms: "as_per_contract",
        paymentPeriod: "immediate",
        creditLimit: undefined,
        financialNotes: "",
      },
      crmSalesInfo: {
        source: "website",
        assignedTo: null,
        accountManagerId: null,
        customerSuccessRepId: null,
        sector: "",
        tags: [],
        requestedService: "",
        expectedBudget: "",
        expectedStartDate: "",
        hasMarketingTeam: null,
        workingWithOtherAgency: null,
        usedPlatforms: [],
        interestedServices: [],
        lastContactDate: null,
      },
      assignedTo: null,
      billingAddress: "",
    },
  });

  const selectedEntityType = watch("entityType");
  const selectedRelationships = watch("relationships") || [];
  const selectedAssociatedContacts = watch("associatedContacts") || [];
  const selectedSocialAccounts = watch("socialAccounts") || [];
  const selectedAddresses = watch("addresses") || [];
  const selectedInterests = watch("interests") || [];

  const isIndividual = selectedEntityType === "individual";

  // Toggle relationship chip
  const toggleRelationship = (relKey: ContactRelationship) => {
    if (selectedRelationships.includes(relKey)) {
      setValue(
        "relationships",
        selectedRelationships.filter((r) => r !== relKey)
      );
    } else {
      setValue("relationships", [...selectedRelationships, relKey]);
    }
  };

  const toggleInterest = (interest: string) => {
    if (selectedInterests.includes(interest)) {
      setValue(
        "interests",
        selectedInterests.filter((i) => i !== interest)
      );
    } else {
      setValue("interests", [...selectedInterests, interest]);
    }
  };

  const addCustomInterest = () => {
    const val = customInterestInput.trim();
    if (val && !selectedInterests.includes(val)) {
      setValue("interests", [...selectedInterests, val]);
      setCustomInterestInput("");
    }
  };

  // Populate on open
  useEffect(() => {
    if (!isOpen) return;

    if (contact) {
      const eType: EntityType =
        contact.entityType ||
        (contact.commercialRegister || (contact.accountName && !contact.lastName)
          ? "company"
          : "individual");

      // Relationships fallback
      let rels = contact.relationships || [];
      if (rels.length === 0 && contact.classification) {
        rels = [contact.classification as ContactRelationship];
      }

      reset({
        entityType: eType,
        firstName: contact.firstName || "",
        fatherName: contact.fatherName || "",
        lastName: contact.lastName || "",
        accountName: contact.accountName || "",
        legalName: contact.legalName || "",
        email: contact.email || "",
        phone: contact.phone || "",
        secondaryPhone: contact.secondaryPhone || "",
        whatsappPhone: contact.whatsappPhone || "",
        landlinePhone: contact.landlinePhone || "",
        website: contact.website || "",
        establishmentType: contact.establishmentType || "llc",
        commercialRegister: contact.commercialRegister || "",
        unifiedNumber: contact.unifiedNumber || "",
        taxNumber: contact.taxNumber || "",
        crExpiryDate: contact.crExpiryDate || "",
        mainActivity: contact.mainActivity || "",
        companySize: contact.companySize || "",
        city: contact.city || "",
        region: contact.region || "",
        branchesCount: contact.branchesCount,
        govSector: contact.govSector || "",
        administration: contact.administration || "",
        department: contact.department || "",
        tenderNumber: contact.tenderNumber || "",
        contractNumber: contact.contractNumber || "",
        licenseNumber: contact.licenseNumber || "",
        nonProfitType: contact.nonProfitType || "",
        financialInstitutionType: contact.financialInstitutionType || "",
        mediaPlatformType: contact.mediaPlatformType || "",
        audienceSize: contact.audienceSize || "",
        contentNiche: contact.contentNiche || "",
        collaborationAreas: contact.collaborationAreas || "",
        managerName: contact.managerName || "",
        nationalId: contact.nationalId || "",
        nationality: contact.nationality || "سعودي",
        jobTitle: contact.jobTitle || "",
        relationships: rels,
        relationshipStatuses: contact.relationshipStatuses || {},
        classification: contact.classification || "actual_client",
        source: contact.source || "website",
        status: contact.status || "active",
        satisfaction: contact.satisfaction || "satisfied",
        satisfactionNotes: contact.satisfactionNotes || "",
        interests: contact.interests || [],
        tags: contact.tags || [],
        notes: contact.notes || "",
        associatedContacts: contact.associatedContacts || [],
        socialAccounts: contact.socialAccounts || [],
        addresses: contact.addresses || [],
        financialInfo: {
          taxNumber: contact.financialInfo?.taxNumber || contact.taxNumber || "",
          vatRegistered: contact.financialInfo?.vatRegistered || "unknown",
          preferredPaymentMethod: contact.financialInfo?.preferredPaymentMethod || "bank_transfer",
          paymentTerms: contact.financialInfo?.paymentTerms || "as_per_contract",
          paymentPeriod: contact.financialInfo?.paymentPeriod || "immediate",
          creditLimit: contact.financialInfo?.creditLimit,
          financialNotes: contact.financialInfo?.financialNotes || "",
        },
        crmSalesInfo: {
          source: contact.crmSalesInfo?.source || contact.source || "website",
          assignedTo: contact.crmSalesInfo?.assignedTo || contact.assignedTo || null,
          accountManagerId: contact.crmSalesInfo?.accountManagerId || null,
          customerSuccessRepId: contact.crmSalesInfo?.customerSuccessRepId || null,
          sector: contact.crmSalesInfo?.sector || "",
          tags: contact.crmSalesInfo?.tags || contact.tags || [],
          requestedService: contact.crmSalesInfo?.requestedService || "",
          expectedBudget: contact.crmSalesInfo?.expectedBudget || "",
          expectedStartDate: contact.crmSalesInfo?.expectedStartDate || "",
          hasMarketingTeam: contact.crmSalesInfo?.hasMarketingTeam ?? null,
          workingWithOtherAgency: contact.crmSalesInfo?.workingWithOtherAgency ?? null,
          usedPlatforms: contact.crmSalesInfo?.usedPlatforms || [],
          interestedServices: contact.crmSalesInfo?.interestedServices || [],
          lastContactDate: contact.crmSalesInfo?.lastContactDate || null,
        },
        assignedTo: contact.assignedTo ?? null,
        billingAddress: contact.billingAddress || "",
      } as any);
    } else {
      reset({
        entityType: "individual",
        firstName: "",
        fatherName: "",
        lastName: "",
        accountName: "",
        legalName: "",
        email: "",
        phone: "",
        secondaryPhone: "",
        whatsappPhone: "",
        landlinePhone: "",
        website: "",
        establishmentType: "llc",
        commercialRegister: "",
        unifiedNumber: "",
        taxNumber: "",
        crExpiryDate: "",
        mainActivity: "",
        companySize: "",
        city: "",
        region: "",
        branchesCount: undefined,
        govSector: "",
        administration: "",
        department: "",
        tenderNumber: "",
        contractNumber: "",
        licenseNumber: "",
        nonProfitType: "",
        financialInstitutionType: "",
        mediaPlatformType: "",
        audienceSize: "",
        contentNiche: "",
        collaborationAreas: "",
        managerName: "",
        nationalId: "",
        nationality: "سعودي",
        jobTitle: "",
        relationships: ["active_client"],
        relationshipStatuses: {},
        classification: activeClassifications[0]?.key || "actual_client",
        source: "website",
        status: "active",
        satisfaction: "satisfied",
        satisfactionNotes: "",
        interests: [],
        tags: [],
        notes: "",
        associatedContacts: [],
        socialAccounts: [],
        addresses: [],
        financialInfo: {
          taxNumber: "",
          vatRegistered: "unknown",
          preferredPaymentMethod: "bank_transfer",
          paymentTerms: "as_per_contract",
          paymentPeriod: "immediate",
          creditLimit: undefined,
          financialNotes: "",
        },
        crmSalesInfo: {
          source: "website",
          assignedTo: null,
          accountManagerId: null,
          customerSuccessRepId: null,
          sector: "",
          tags: [],
          requestedService: "",
          expectedBudget: "",
          expectedStartDate: "",
          hasMarketingTeam: null,
          workingWithOtherAgency: null,
          usedPlatforms: [],
          interestedServices: [],
          lastContactDate: null,
        },
        assignedTo: null,
        billingAddress: "",
      });
    }

    setActiveTab("details");
    setCustomInterestInput("");
  }, [isOpen, contact, reset, activeClassifications]);

  const onSubmit = async (values: any) => {
    const dto = toCreateContactDTO(values);

    if (isEdit && contact) {
      const res = await updateContact.mutateAsync({ id: contact.id, data: dto });
      onSuccess?.(res.data);
      onOpenChange(false);
    } else {
      const res = await createContact.mutateAsync(dto);
      onSuccess?.(res.data);
      if (keepOpenAfterSave) {
        // Reset form for new entry keeping entityType
        reset({
          ...values,
          firstName: "",
          fatherName: "",
          lastName: "",
          accountName: "",
          legalName: "",
          email: "",
          phone: "",
          secondaryPhone: "",
          whatsappPhone: "",
          associatedContacts: [],
          socialAccounts: [],
          addresses: [],
        });
        setActiveTab("details");
      } else {
        onOpenChange(false);
      }
    }
  };

  const busy = isSubmitting || createContact.isPending || updateContact.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="4xl"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[94vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl bg-background",
        header: "border-b border-default-100 px-6 py-4 text-xl font-black shrink-0",
        body: "px-6 py-5 gap-5 overflow-y-auto flex-1",
        footer: "border-t border-default-100 px-6 py-4 flex items-center justify-between gap-3 shrink-0 bg-background/95 backdrop-blur-md",
      }}
    >
      <ModalContent>
        {(onClose) => (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalHeader>
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-default-900">
                    {isEdit ? t("contacts.form.editTitle") : t("contacts.form.createTitle")}
                  </h3>
                  <p className="text-xs text-default-500 font-normal">
                    {isAr
                      ? "إدارة بيانات الجهة والعلاقات وجهات الاتصال التابعة والمبيعات"
                      : "Manage entity profile, relationships, associated personnel, and CRM details"}
                  </p>
                </div>
              </div>
            </ModalHeader>

            <ModalBody>
              {/* 1. ENTITY TYPE SELECTOR */}
              <div className="space-y-2 p-3.5 bg-default-50 dark:bg-default-100/30 rounded-2xl border border-default-200/70">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-default-800 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-primary" />
                    <span>{t("contacts.entityType.label")}</span>
                    <span className="text-danger">*</span>
                  </label>
                  <span className="text-[11px] text-default-400">
                    {isAr ? "حدد نوع الجهة لعرض الحقول المناسبة" : "Select entity type to reveal relevant fields"}
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5 pt-1">
                  {ENTITY_TYPES.map(({ key, labelAr, labelEn, icon: Icon }) => {
                    const isSelected = selectedEntityType === key;
                    const label = isAr ? labelAr : labelEn;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setValue("entityType", key)}
                        className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl text-center border transition-all ${
                          isSelected
                            ? "bg-primary text-white border-primary shadow-md shadow-primary/25 font-bold scale-[1.02]"
                            : "bg-background text-default-700 border-default-200 hover:border-primary/40 hover:bg-default-100/50"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-[11px] leading-tight line-clamp-2">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. RELATIONSHIPS MULTI-SELECT WITH D-ARROW */}
              <div className="space-y-2 p-3.5 bg-primary-50/30 dark:bg-primary-950/20 rounded-2xl border border-primary-200/50">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-default-800 flex items-center gap-1.5">
                    <Tag className="h-4 w-4 text-primary" />
                    <span>{t("contacts.relationships.label")}</span>
                    <span className="text-xs font-normal text-default-500">
                      ({isAr ? "يمكن اختيار أكثر من علاقة" : "Multi-select supported"})
                    </span>
                  </label>
                  <span className="text-[11px] text-primary font-bold">
                    {selectedRelationships.length} {isAr ? "علاقات محددة" : "selected"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {RELATIONSHIPS_LIST.map((r) => {
                    const isSelected = selectedRelationships.includes(r.key);
                    const label = isAr ? r.labelAr : r.labelEn;

                    return (
                      <Chip
                        key={r.key}
                        size="sm"
                        variant={isSelected ? "solid" : "bordered"}
                        color={isSelected ? r.color : "default"}
                        className="cursor-pointer font-medium transition-all"
                        onClick={() => toggleRelationship(r.key)}
                      >
                        {isSelected ? `✓ ${label}` : `+ ${label}`}
                      </Chip>
                    );
                  })}
                </div>
              </div>

              {/* 3. ASSIGNED REP, SOURCE, AND STATUS HEADER */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-default-50/50 rounded-2xl border border-default-200/60">
                <Controller
                  name="assignedTo"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...selectFieldProps()}
                      size="sm"
                      label={t("contacts.form.assignedTo")}
                      startContent={<UserCheck className="h-4 w-4 text-primary" />}
                      selectedKeys={field.value && (users ?? []).some((u) => u.id === field.value) ? [field.value] : []}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as string | undefined;
                        field.onChange(v ?? null);
                      }}
                      variant="bordered"
                    >
                      {(users ?? []).map((u) => (
                        <SelectItem key={u.id} textValue={u.name ?? u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                />

                <Controller
                  name="source"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...selectFieldProps()}
                      size="sm"
                      label={t("contacts.form.source")}
                      startContent={<Globe className="h-4 w-4 text-default-500" />}
                      selectedKeys={field.value ? [field.value] : ["website"]}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as ContactSource | undefined;
                        field.onChange(v ?? "website");
                      }}
                      variant="bordered"
                    >
                      <SelectItem key="website" textValue={t("contacts.source.website")}>{t("contacts.source.website")}</SelectItem>
                      <SelectItem key="referral" textValue={t("contacts.source.referral")}>{t("contacts.source.referral")}</SelectItem>
                      <SelectItem key="social_media" textValue={t("contacts.source.social_media")}>{t("contacts.source.social_media")}</SelectItem>
                      <SelectItem key="cold_call" textValue={t("contacts.source.cold_call")}>{t("contacts.source.cold_call")}</SelectItem>
                      <SelectItem key="event" textValue={t("contacts.source.event")}>{t("contacts.source.event")}</SelectItem>
                      <SelectItem key="whatsapp" textValue={t("contacts.source.whatsapp")}>{t("contacts.source.whatsapp")}</SelectItem>
                      <SelectItem key="other" textValue={t("contacts.source.other")}>{t("contacts.source.other")}</SelectItem>
                    </Select>
                  )}
                />

                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...selectFieldProps()}
                      size="sm"
                      label={t("contacts.form.status")}
                      startContent={<CheckCircle2 className="h-4 w-4 text-default-500" />}
                      selectedKeys={field.value ? [field.value] : ["active"]}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as ContactStatus | undefined;
                        field.onChange(v ?? "active");
                      }}
                      variant="bordered"
                    >
                      <SelectItem key="active" textValue={t("contacts.status.active")}>{t("contacts.status.active")}</SelectItem>
                      <SelectItem key="inactive" textValue={t("contacts.status.inactive")}>{t("contacts.status.inactive")}</SelectItem>
                      <SelectItem key="archived" textValue={t("contacts.status.archived")}>{t("contacts.status.archived")}</SelectItem>
                    </Select>
                  )}
                />
              </div>

              {/* 4. MAIN TABS NAVIGATION */}
              <Tabs
                selectedKey={activeTab}
                onSelectionChange={(k: any) => setActiveTab(String(k))}
                color="primary"
                variant="underlined"
                classNames={{
                  tabList: "gap-6 border-b border-default-200 w-full",
                  cursor: "w-full bg-primary",
                  tab: "max-w-fit px-1 h-10 font-bold text-xs sm:text-sm",
                }}
              >
                {/* TAB 1: DYNAMIC SPECIFIC FIELDS */}
                <Tab
                  key="details"
                  title={
                    <div className="flex items-center gap-1.5">
                      <Briefcase className="h-4 w-4" />
                      <span>{isAr ? "بيانات الجهة المحددة" : "Entity Details"}</span>
                    </div>
                  }
                >
                  <div className="space-y-4 pt-3">
                    {/* IF INDIVIDUAL */}
                    {isIndividual && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.firstName")}
                            placeholder="مثال: خالد"
                            {...register("firstName")}
                            isInvalid={!!errors.firstName}
                            errorMessage={errors.firstName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.fatherName")}
                            placeholder="مثال: محمد"
                            {...register("fatherName")}
                          />
                          <Input
                            label={t("contacts.form.lastName")}
                            placeholder="مثال: القحطاني"
                            {...register("lastName")}
                            isInvalid={!!errors.lastName}
                            errorMessage={errors.lastName?.message}
                            isRequired
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.phone")}
                            placeholder="05xxxxxxx"
                            {...register("phone")}
                            isInvalid={!!errors.phone}
                            errorMessage={errors.phone?.message}
                            startContent={<Phone className="h-3.5 w-3.5 text-default-400" />}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.email")}
                            type="email"
                            placeholder="name@example.com"
                            {...register("email")}
                            isInvalid={!!errors.email}
                            errorMessage={errors.email?.message}
                            startContent={<Mail className="h-3.5 w-3.5 text-default-400" />}
                          />
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="مثال: الرياض"
                            {...register("city")}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.nationalId")}
                            placeholder="10xxxxxxxx"
                            {...register("nationalId")}
                          />
                          <Input
                            label={t("contacts.form.nationality")}
                            placeholder="سعودي"
                            {...register("nationality")}
                          />
                          <Input
                            label={t("contacts.form.jobTitle")}
                            placeholder="مثال: مهندس استشاري"
                            {...register("jobTitle")}
                          />
                        </div>
                      </div>
                    )}

                    {/* IF COMPANY OR ESTABLISHMENT */}
                    {(selectedEntityType === "company" || selectedEntityType === "establishment") && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="مثال: شركة دي أرو لتقنية المعلومات"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.legalName")}
                            placeholder="الاسم القانوني كما بالسجل التجاري"
                            {...register("legalName")}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <Controller
                            name="establishmentType"
                            control={control}
                            render={({ field }) => (
                              <Select
                                {...selectFieldProps()}
                                label={t("contacts.establishmentType.label")}
                                selectedKeys={field.value ? [field.value] : ["llc"]}
                                onSelectionChange={(keys) => {
                                  const v = Array.from(keys)[0] as EstablishmentType | undefined;
                                  field.onChange(v ?? "llc");
                                }}
                              >
                                <SelectItem key="llc" textValue={t("contacts.establishmentType.llc")}>{t("contacts.establishmentType.llc")}</SelectItem>
                                <SelectItem key="sole_proprietorship" textValue={t("contacts.establishmentType.sole_proprietorship")}>{t("contacts.establishmentType.sole_proprietorship")}</SelectItem>
                                <SelectItem key="joint_stock" textValue={t("contacts.establishmentType.joint_stock")}>{t("contacts.establishmentType.joint_stock")}</SelectItem>
                                <SelectItem key="simplified_joint_stock" textValue={t("contacts.establishmentType.simplified_joint_stock")}>{t("contacts.establishmentType.simplified_joint_stock")}</SelectItem>
                                <SelectItem key="partnership" textValue={t("contacts.establishmentType.partnership")}>{t("contacts.establishmentType.partnership")}</SelectItem>
                                <SelectItem key="other" textValue={t("contacts.establishmentType.other")}>{t("contacts.establishmentType.other")}</SelectItem>
                              </Select>
                            )}
                          />

                          <Input
                            label={t("contacts.form.commercialRegister")}
                            placeholder="1010xxxxxx"
                            {...register("commercialRegister")}
                            isRequired
                          />

                          <Input
                            label={t("contacts.form.unifiedNumber")}
                            placeholder="700xxxxxxx"
                            {...register("unifiedNumber")}
                          />

                          <Input
                            label={t("contacts.form.nationalId", "الرقم الوطني")}
                            placeholder="70xxxxxxxx / 10xxxxxxxx"
                            {...register("nationalId")}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.taxNumber")}
                            placeholder="3xxxxxxxxxxxxxx"
                            {...register("taxNumber")}
                          />
                          <Input
                            label={t("contacts.form.mainActivity")}
                            placeholder="مثال: التسويق والإعلان والبرمجيات"
                            {...register("mainActivity")}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="مثال: الرياض"
                            {...register("city")}
                            isRequired
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.companySize")}
                            placeholder="مثال: 10 - 50 موظف"
                            {...register("companySize")}
                          />
                          <Input
                            label={t("contacts.form.branchesCount")}
                            type="number"
                            placeholder="1"
                            {...register("branchesCount", { valueAsNumber: true })}
                          />
                          <Input
                            label={t("contacts.form.website")}
                            placeholder="https://company.com"
                            {...register("website")}
                          />
                        </div>
                      </div>
                    )}

                    {/* IF GOVERNMENT */}
                    {selectedEntityType === "government" && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="مثال: وزارة التجارة / الهيئة الملكية"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.govSector")}
                            placeholder="مثال: القطاع الحكومي المدني"
                            {...register("govSector")}
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.administration")}
                            placeholder="مثال: الإدارة العامة للتحول الرقمي"
                            {...register("administration")}
                          />
                          <Input
                            label={t("contacts.form.department")}
                            placeholder="مثال: قسم المشتريات والمنافسات"
                            {...register("department")}
                          />
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="مثال: الرياض"
                            {...register("city")}
                            isRequired
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.tenderNumber")}
                            placeholder="رقم المنافسة أو المناقصة (اختياري)"
                            {...register("tenderNumber")}
                          />
                          <Input
                            label={t("contacts.form.contractNumber")}
                            placeholder="رقم العقد أو الاتفاقية"
                            {...register("contractNumber")}
                          />
                        </div>
                      </div>
                    )}

                    {/* IF NON-PROFIT / NGO */}
                    {selectedEntityType === "non_profit" && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="مثال: جمعية البر الخيرية"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.licenseNumber")}
                            placeholder="رقم الترخيص أو التسجيل الرسمي"
                            {...register("licenseNumber")}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.mainActivity")}
                            placeholder="نشاط وأهداف الجمعية"
                            {...register("mainActivity")}
                          />
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="المدينة"
                            {...register("city")}
                            isRequired
                          />
                        </div>
                      </div>
                    )}

                    {/* IF BANK / FINANCIAL */}
                    {selectedEntityType === "bank" && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="مثال: مصرف الراجحي / البنك الأهلي"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.financialInstitutionType")}
                            placeholder="مثال: بنك تجاري / شركة تمويل"
                            {...register("financialInstitutionType")}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="المدينة"
                            {...register("city")}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.website")}
                            placeholder="https://..."
                            {...register("website")}
                          />
                        </div>
                      </div>
                    )}

                    {/* IF MEDIA OR INFLUENCER */}
                    {(selectedEntityType === "media" || selectedEntityType === "influencer") && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="الاسم التجاري أو اسم الحساب / القناة"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.managerName")}
                            placeholder="اسم الشخص المسؤول أو مدير الأعمال"
                            {...register("managerName")}
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Input
                            label={t("contacts.form.mediaPlatformType")}
                            placeholder="مثال: سناب شات، يوتيوب، تيك توك، بودكاست"
                            {...register("mediaPlatformType")}
                          />
                          <Input
                            label={t("contacts.form.audienceSize")}
                            placeholder="مثال: 500k متابع"
                            {...register("audienceSize")}
                          />
                          <Input
                            label={t("contacts.form.contentNiche")}
                            placeholder="مثال: أعمال وتقنية، تغطيات تجارية"
                            {...register("contentNiche")}
                          />
                        </div>
                      </div>
                    )}

                    {/* IF OTHER */}
                    {selectedEntityType === "other" && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Input
                            label={t("contacts.form.accountName")}
                            placeholder="اسم الجهة"
                            {...register("accountName")}
                            isInvalid={!!errors.accountName}
                            errorMessage={errors.accountName?.message}
                            isRequired
                          />
                          <Input
                            label={t("contacts.form.city")}
                            placeholder="المدينة"
                            {...register("city")}
                            isRequired
                          />
                        </div>
                        <Input
                          label={t("contacts.form.notes")}
                          placeholder="وصف وتفاصيل طبيعة هذه الجهة..."
                          {...register("notes")}
                        />
                      </div>
                    )}
                  </div>
                </Tab>

                {/* TAB 2: ASSOCIATED CONTACT PERSONS (FOR ORGANIZATIONS) */}
                <Tab
                  key="contacts"
                  title={
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="h-4 w-4" />
                      <span>{t("contacts.contactPersons.title")}</span>
                      {selectedAssociatedContacts.length > 0 && (
                        <Chip size="sm" variant="flat" color="primary" className="h-4 px-1 text-[10px]">
                          {selectedAssociatedContacts.length}
                        </Chip>
                      )}
                    </div>
                  }
                >
                  <div className="pt-3">
                    <AssociatedContactsSection
                      contacts={selectedAssociatedContacts as any}
                      onChange={(updated) => setValue("associatedContacts", updated as any)}
                      isAr={isAr}
                    />
                  </div>
                </Tab>

                {/* TAB 3: COMMUNICATION & ADDRESSES */}
                <Tab
                  key="communication"
                  title={
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-4 w-4" />
                      <span>{isAr ? "التواصل والعناوين" : "Contact & Addresses"}</span>
                    </div>
                  }
                >
                  <div className="space-y-5 pt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Input
                        label={t("contacts.form.phone")}
                        placeholder="05xxxxxxx"
                        {...register("phone")}
                        startContent={<Phone className="h-3.5 w-3.5 text-default-400" />}
                      />
                      <Input
                        label={t("contacts.form.secondaryPhone")}
                        placeholder="05xxxxxxx"
                        {...register("secondaryPhone")}
                      />
                      <Input
                        label={t("contacts.form.whatsappPhone")}
                        placeholder="9665xxxxxxx"
                        {...register("whatsappPhone")}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Input
                        label={t("contacts.form.landlinePhone")}
                        placeholder="011xxxxxxx"
                        {...register("landlinePhone")}
                      />
                      <Input
                        label={t("contacts.form.email")}
                        type="email"
                        placeholder="info@domain.com"
                        {...register("email")}
                        startContent={<Mail className="h-3.5 w-3.5 text-default-400" />}
                      />
                      <Input
                        label={t("contacts.form.website")}
                        placeholder="https://..."
                        {...register("website")}
                        startContent={<Globe className="h-3.5 w-3.5 text-default-400" />}
                      />
                    </div>

                    <div className="border-t border-default-200/60 pt-4">
                      <SocialAccountsSection
                        accounts={selectedSocialAccounts as any}
                        onChange={(updated) => setValue("socialAccounts", updated as any)}
                        isAr={isAr}
                      />
                    </div>

                    <div className="border-t border-default-200/60 pt-4">
                      <AddressesSection
                        addresses={selectedAddresses as any}
                        onChange={(updated) => setValue("addresses", updated as any)}
                        isAr={isAr}
                      />
                    </div>
                  </div>
                </Tab>

                {/* TAB 4: FINANCIAL & CRM SALES */}
                <Tab
                  key="financial"
                  title={
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4" />
                      <span>{isAr ? "المالية والمبيعات" : "Financial & CRM Sales"}</span>
                    </div>
                  }
                >
                  <div className="space-y-5 pt-3">
                    {/* Financial Section */}
                    <div className="space-y-3 p-4 bg-default-50/60 rounded-2xl border border-default-200/60">
                      <h4 className="text-xs font-bold text-default-800">
                        {t("contacts.financial.title")}
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Input
                          label={t("contacts.financial.taxNumber")}
                          placeholder="3xxxxxxxxxxxxxx"
                          {...register("financialInfo.taxNumber")}
                        />

                        <Controller
                          name="financialInfo.vatRegistered"
                          control={control}
                          render={({ field }) => (
                            <Select
                              {...selectFieldProps()}
                              label={t("contacts.financial.vatRegistered")}
                              selectedKeys={field.value ? [field.value] : ["unknown"]}
                              onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as "yes" | "no" | "unknown";
                                field.onChange(v ?? "unknown");
                              }}
                            >
                              <SelectItem key="yes" textValue={t("contacts.financial.yes")}>{t("contacts.financial.yes")}</SelectItem>
                              <SelectItem key="no" textValue={t("contacts.financial.no")}>{t("contacts.financial.no")}</SelectItem>
                              <SelectItem key="unknown" textValue={t("contacts.financial.unknown")}>{t("contacts.financial.unknown")}</SelectItem>
                            </Select>
                          )}
                        />

                        <Controller
                          name="financialInfo.preferredPaymentMethod"
                          control={control}
                          render={({ field }) => (
                            <Select
                              {...selectFieldProps()}
                              label={t("contacts.financial.preferredPaymentMethod")}
                              selectedKeys={field.value ? [field.value] : ["bank_transfer"]}
                              onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string;
                                field.onChange(v ?? "bank_transfer");
                              }}
                            >
                              <SelectItem key="bank_transfer" textValue={t("contacts.financial.bank_transfer")}>{t("contacts.financial.bank_transfer")}</SelectItem>
                              <SelectItem key="payment_link" textValue={t("contacts.financial.payment_link")}>{t("contacts.financial.payment_link")}</SelectItem>
                              <SelectItem key="cash" textValue={t("contacts.financial.cash")}>{t("contacts.financial.cash")}</SelectItem>
                            </Select>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Controller
                          name="financialInfo.paymentTerms"
                          control={control}
                          render={({ field }) => (
                            <Select
                              {...selectFieldProps()}
                              label={t("contacts.financial.paymentTerms")}
                              selectedKeys={field.value ? [field.value] : ["as_per_contract"]}
                              onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string;
                                field.onChange(v ?? "as_per_contract");
                              }}
                            >
                              <SelectItem key="full_advance" textValue={t("contacts.financial.full_advance")}>{t("contacts.financial.full_advance")}</SelectItem>
                              <SelectItem key="50_percent_advance" textValue={t("contacts.financial.50_percent_advance")}>{t("contacts.financial.50_percent_advance")}</SelectItem>
                              <SelectItem key="credit" textValue={t("contacts.financial.credit")}>{t("contacts.financial.credit")}</SelectItem>
                              <SelectItem key="as_per_contract" textValue={t("contacts.financial.as_per_contract")}>{t("contacts.financial.as_per_contract")}</SelectItem>
                            </Select>
                          )}
                        />

                        <Controller
                          name="financialInfo.paymentPeriod"
                          control={control}
                          render={({ field }) => (
                            <Select
                              {...selectFieldProps()}
                              label={t("contacts.financial.paymentPeriod")}
                              selectedKeys={field.value ? [field.value] : ["immediate"]}
                              onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0] as string;
                                field.onChange(v ?? "immediate");
                              }}
                            >
                              <SelectItem key="immediate" textValue={t("contacts.financial.immediate")}>{t("contacts.financial.immediate")}</SelectItem>
                              <SelectItem key="7_days" textValue={t("contacts.financial.7_days")}>{t("contacts.financial.7_days")}</SelectItem>
                              <SelectItem key="15_days" textValue={t("contacts.financial.15_days")}>{t("contacts.financial.15_days")}</SelectItem>
                              <SelectItem key="30_days" textValue={t("contacts.financial.30_days")}>{t("contacts.financial.30_days")}</SelectItem>
                              <SelectItem key="60_days" textValue={t("contacts.financial.60_days")}>{t("contacts.financial.60_days")}</SelectItem>
                            </Select>
                          )}
                        />

                        <Input
                          label={t("contacts.financial.creditLimit")}
                          placeholder="مثال: 50,000"
                          type="number"
                          {...register("financialInfo.creditLimit", { valueAsNumber: true })}
                        />
                      </div>
                    </div>

                    {/* CRM Sales Section */}
                    <div className="space-y-3 p-4 bg-default-50/60 rounded-2xl border border-default-200/60">
                      <h4 className="text-xs font-bold text-default-800">
                        {t("contacts.crmSales.title")}
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <Input
                          label={t("contacts.crmSales.sector")}
                          placeholder="مثال: التجزئة، العقارات، الأغذية"
                          {...register("crmSalesInfo.sector")}
                        />
                        <Input
                          label={t("contacts.crmSales.expectedBudget")}
                          placeholder="مثال: 100,000 SAR"
                          {...register("crmSalesInfo.expectedBudget")}
                        />
                        <Input
                          label={t("contacts.crmSales.expectedStartDate")}
                          type="date"
                          {...register("crmSalesInfo.expectedStartDate")}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <Checkbox
                          size="sm"
                          isSelected={!!watch("crmSalesInfo.hasMarketingTeam")}
                          onValueChange={(val) => setValue("crmSalesInfo.hasMarketingTeam", val)}
                        >
                          <span className="text-xs font-semibold text-default-700">
                            {t("contacts.crmSales.hasMarketingTeam")}
                          </span>
                        </Checkbox>

                        <Checkbox
                          size="sm"
                          isSelected={!!watch("crmSalesInfo.workingWithOtherAgency")}
                          onValueChange={(val) => setValue("crmSalesInfo.workingWithOtherAgency", val)}
                        >
                          <span className="text-xs font-semibold text-default-700">
                            {t("contacts.crmSales.workingWithOtherAgency")}
                          </span>
                        </Checkbox>
                      </div>

                      {/* Services Interested In */}
                      <div className="space-y-2 pt-2 border-t border-default-200/60">
                        <label className="text-xs font-bold text-default-700">
                          {t("contacts.crmSales.interestedServices")}
                        </label>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {COMMON_SERVICES.map((srv) => {
                            const isSelected = selectedInterests.includes(srv);
                            return (
                              <Chip
                                key={srv}
                                size="sm"
                                variant={isSelected ? "solid" : "bordered"}
                                color={isSelected ? "primary" : "default"}
                                className="cursor-pointer font-medium transition-all"
                                onClick={() => toggleInterest(srv)}
                              >
                                {isSelected ? `✓ ${srv}` : `+ ${srv}`}
                              </Chip>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            size="sm"
                            placeholder="إضافة خدمة أو اهتمام آخر..."
                            value={customInterestInput}
                            onValueChange={setCustomInterestInput}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addCustomInterest();
                              }
                            }}
                            className="max-w-xs"
                          />
                          <Button size="sm" variant="flat" onPress={addCustomInterest} startContent={<Plus className="h-3 w-3" />}>
                            إضافة
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Tab>
              </Tabs>
            </ModalBody>

            <ModalFooter>
              <div className="flex items-center justify-between w-full">
                <Button variant="light" onPress={onClose} isDisabled={busy}>
                  {t("contacts.form.cancel")}
                </Button>

                <div className="flex items-center gap-2">
                  {!isEdit && (
                    <Button
                      variant="flat"
                      color="primary"
                      type="submit"
                      isLoading={busy}
                      onPress={() => setKeepOpenAfterSave(true)}
                    >
                      {t("contacts.form.saveAndAddAnother")}
                    </Button>
                  )}

                  <Button
                    color="primary"
                    type="submit"
                    isLoading={busy}
                    className="font-bold"
                    onPress={() => setKeepOpenAfterSave(false)}
                  >
                    {isEdit ? t("contacts.form.save") : t("contacts.form.create")}
                  </Button>
                </div>
              </div>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
