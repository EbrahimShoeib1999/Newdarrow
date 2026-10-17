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
import type { ContactClassificationItem } from "../types/classification.types";
import type { Contact, ContactSource, ContactStatus } from "../types/contacts.types";
import { MessageSquare, Phone, Plus, Smile, UserCheck, Tag, Globe, CheckCircle2 } from "lucide-react";

interface ContactFormModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
}

const COMMON_INTERESTS = [
  "موقع إلكتروني",
  "متجر إلكتروني",
  "عروض وتسويق",
  "إدارة سوشيال ميديا",
  "هوية بصرية",
  "تصوير وإنتاج مرئي",
  "سيو ومحركات بحث",
  "إعلانات ممولة",
];

export function ContactFormModal({ isOpen, onOpenChange, contact }: ContactFormModalProps) {
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { data: users } = useAllUsers();
  const { classifications, activeClassifications } = useContactClassifications();
  const createContact = useCreateContactMutation();
  const updateContact = useUpdateContactMutation();
  const isEdit = !!contact;

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
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      secondaryPhone: "",
      whatsappPhone: "",
      jobTitle: "",
      department: "",
      accountName: "",
      classification: "actual_client",
      source: "website",
      status: "active",
      satisfaction: "satisfied",
      satisfactionNotes: "",
      interests: [],
      commercialRegister: "",
      taxNumber: "",
      billingAddress: "",
      assignedTo: null,
    },
  });

  const selectedInterests = watch("interests") || [];

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

  useEffect(() => {
    if (!isOpen) return;
    if (contact) {
      reset({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        secondaryPhone: contact.secondaryPhone ?? "",
        whatsappPhone: contact.whatsappPhone ?? "",
        jobTitle: contact.jobTitle ?? "",
        department: contact.department ?? "",
        accountName: contact.accountName ?? "",
        classification: contact.classification ?? "actual_client",
        source: contact.source ?? "website",
        status: contact.status ?? "active",
        satisfaction: contact.satisfaction ?? "satisfied",
        satisfactionNotes: contact.satisfactionNotes ?? "",
        interests: contact.interests ?? [],
        commercialRegister: contact.commercialRegister ?? "",
        taxNumber: contact.taxNumber ?? "",
        billingAddress: contact.billingAddress ?? "",
        assignedTo: contact.assignedTo ?? null,
      });
    } else {
      reset({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        secondaryPhone: "",
        whatsappPhone: "",
        jobTitle: "",
        department: "",
        accountName: "",
        classification: activeClassifications[0]?.key || "actual_client",
        source: "website",
        status: "active",
        satisfaction: "satisfied",
        satisfactionNotes: "",
        interests: [],
        commercialRegister: "",
        taxNumber: "",
        billingAddress: "",
        assignedTo: null,
      });
    }
    setCustomInterestInput("");
  }, [isOpen, contact, reset, activeClassifications]);

  const onSubmit = async (values: ContactFormValues) => {
    const dto = toCreateContactDTO(values);
    if (isEdit && contact) {
      await updateContact.mutateAsync({ id: contact.id, data: dto });
    } else {
      await createContact.mutateAsync(dto);
    }
    onOpenChange(false);
  };

  const busy = isSubmitting || createContact.isPending || updateContact.isPending;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[92vh] flex flex-col rounded-3xl overflow-hidden shadow-2xl bg-background",
        header: "border-b border-default-100 px-6 py-4 text-xl font-black shrink-0",
        body: "px-6 py-5 gap-5 overflow-y-auto flex-1",
        footer: "border-t border-default-100 px-6 py-4 flex items-center justify-end gap-3 shrink-0 bg-background/95 backdrop-blur-md",
      }}
    >
      <ModalContent>
        {(onClose) => (
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <ModalHeader>
              {isEdit ? t("contacts.form.editTitle") : t("contacts.form.createTitle")}
            </ModalHeader>
            <ModalBody>
              {/* Classification, Source, Status, and Assigned Employee Header */}
              <div className="space-y-3 p-3.5 bg-primary-50/40 dark:bg-primary-950/20 rounded-2xl border border-primary-200/50">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Controller
                    name="classification"
                    control={control}
                    render={({ field }) => (
                      <Select
                        {...selectFieldProps()}
                        label={t("contacts.form.classification")}
                        startContent={<Tag className="h-4 w-4 text-primary" />}
                        selectedKeys={field.value ? [field.value] : []}
                        onSelectionChange={(keys) => {
                          const v = Array.from(keys)[0] as string | undefined;
                          field.onChange(v ?? "actual_client");
                        }}
                        color="primary"
                        variant="bordered"
                      >
                        {classifications.map((c: ContactClassificationItem) => {
                          const label = isAr ? c.nameAr : c.nameEn;
                          return (
                            <SelectItem key={c.key} textValue={label}>
                              <div className="flex items-center gap-2">
                                <span>{c.emoji || "🏷️"}</span>
                                <span>{label}</span>
                                {c.isCustom && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
                                    {isAr ? "مخصص" : "Custom"}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </Select>
                    )}
                  />

                  <Controller
                    name="assignedTo"
                    control={control}
                    render={({ field }) => (
                      <Select
                        {...selectFieldProps()}
                        label={t("contacts.form.assignedTo")}
                        startContent={<UserCheck className="h-4 w-4 text-primary" />}
                        selectedKeys={field.value ? [field.value] : []}
                        onSelectionChange={(keys) => {
                          const v = Array.from(keys)[0] as string | undefined;
                          field.onChange(v ?? null);
                        }}
                        color="primary"
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
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Controller
                    name="source"
                    control={control}
                    render={({ field }) => (
                      <Select
                        {...selectFieldProps()}
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
              </div>

              {/* Name Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("contacts.form.firstName")}
                  {...register("firstName")}
                  isInvalid={!!errors.firstName}
                  errorMessage={errors.firstName?.message}
                  isRequired
                />
                <Input
                  label={t("contacts.form.lastName")}
                  {...register("lastName")}
                  isInvalid={!!errors.lastName}
                  errorMessage={errors.lastName?.message}
                />
              </div>

              {/* Contact Numbers: Unified in one section */}
              <div className="p-3.5 bg-default-50/70 dark:bg-default-100/30 rounded-2xl border border-default-200/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-default-600">
                  <Phone className="h-3.5 w-3.5 text-primary" />
                  <span>{t("contacts.directory.title")}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    label={t("contacts.form.phone")}
                    placeholder="05xxxxxxx"
                    {...register("phone")}
                    isInvalid={!!errors.phone}
                    errorMessage={errors.phone?.message}
                    startContent={<Phone className="h-3.5 w-3.5 text-default-400" />}
                  />
                  <Input
                    label={t("contacts.form.secondaryPhone")}
                    placeholder="05xxxxxxx"
                    {...register("secondaryPhone")}
                    startContent={<Phone className="h-3.5 w-3.5 text-default-400" />}
                  />
                  <Input
                    label={t("contacts.form.whatsappPhone")}
                    placeholder="9665xxxxxxx"
                    {...register("whatsappPhone")}
                    startContent={<MessageSquare className="h-3.5 w-3.5 text-emerald-500" />}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("contacts.form.email")}
                  type="email"
                  {...register("email")}
                  isInvalid={!!errors.email}
                  errorMessage={errors.email?.message}
                />
                <Input label={t("contacts.form.accountName")} {...register("accountName")} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t("contacts.form.jobTitle")} {...register("jobTitle")} />
                <Input label={t("contacts.form.department")} {...register("department")} />
              </div>

              {/* Client Interests */}
              <div className="space-y-2 p-3.5 bg-default-50/50 dark:bg-default-100/20 rounded-2xl border border-default-200/60">
                <label className="text-xs font-bold text-default-700">
                  {t("contacts.form.interests")}
                </label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COMMON_INTERESTS.map((interest) => {
                    const isSelected = selectedInterests.includes(interest);
                    return (
                      <Chip
                        key={interest}
                        size="sm"
                        variant={isSelected ? "solid" : "bordered"}
                        color={isSelected ? "primary" : "default"}
                        className="cursor-pointer font-medium transition-all"
                        onClick={() => toggleInterest(interest)}
                      >
                        {isSelected ? `✓ ${interest}` : `+ ${interest}`}
                      </Chip>
                    );
                  })}
                  {selectedInterests
                    .filter((item) => !COMMON_INTERESTS.includes(item))
                    .map((item) => (
                      <Chip
                        key={item}
                        size="sm"
                        variant="solid"
                        color="secondary"
                        onClose={() => toggleInterest(item)}
                      >
                        {item}
                      </Chip>
                    ))}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Input
                    size="sm"
                    placeholder="إضافة اهتمام مخصص..."
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

              {/* Customer Satisfaction */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 bg-default-50/50 dark:bg-default-100/20 rounded-2xl border border-default-200/60">
                <Controller
                  name="satisfaction"
                  control={control}
                  render={({ field }) => (
                    <Select
                      {...selectFieldProps()}
                      label={t("contacts.form.satisfaction")}
                      startContent={<Smile className="h-4 w-4 text-emerald-500" />}
                      selectedKeys={field.value ? [field.value] : ["satisfied"]}
                      onSelectionChange={(keys) => {
                        const v = Array.from(keys)[0] as "satisfied" | "neutral" | "unsatisfied";
                        field.onChange(v ?? "satisfied");
                      }}
                    >
                      <SelectItem key="satisfied" textValue={t("contacts.satisfaction.satisfied")}>
                        😊 {t("contacts.satisfaction.satisfied")}
                      </SelectItem>
                      <SelectItem key="neutral" textValue={t("contacts.satisfaction.neutral")}>
                        😐 {t("contacts.satisfaction.neutral")}
                      </SelectItem>
                      <SelectItem key="unsatisfied" textValue={t("contacts.satisfaction.unsatisfied")}>
                        😞 {t("contacts.satisfaction.unsatisfied")}
                      </SelectItem>
                    </Select>
                  )}
                />
                <Input
                  label={t("contacts.form.satisfactionNotes")}
                  placeholder="ملاحظات الرضا أو شكاوى العميل..."
                  {...register("satisfactionNotes")}
                />
              </div>

              {/* Commercial and Billing Info */}
              <Input
                label={t("contacts.form.commercialRegister")}
                placeholder={t("contacts.form.commercialRegisterPlaceholder")}
                description={t("contacts.form.commercialRegisterHint")}
                {...register("commercialRegister")}
                isInvalid={!!errors.commercialRegister}
                errorMessage={errors.commercialRegister?.message}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t("contacts.form.taxNumber") || "Tax Number"}
                  {...register("taxNumber")}
                  isInvalid={!!errors.taxNumber}
                  errorMessage={errors.taxNumber?.message}
                />
                <Input
                  label={t("contacts.form.billingAddress") || "Billing Address"}
                  {...register("billingAddress")}
                  isInvalid={!!errors.billingAddress}
                  errorMessage={errors.billingAddress?.message}
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                {t("contacts.form.cancel")}
              </Button>
              <Button color="primary" type="submit" isLoading={busy} className="font-bold">
                {isEdit ? t("contacts.form.save") : t("contacts.form.create")}
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
