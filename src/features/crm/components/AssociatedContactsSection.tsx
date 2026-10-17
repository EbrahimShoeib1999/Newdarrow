import { useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectItem,
  Checkbox,
  Card,
  CardBody,
  Chip,
  Tooltip,
} from "@heroui/react";
import { Plus, Trash2, Edit2, Star, User, Phone, Mail, ShieldCheck, Briefcase } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AssociatedContactPerson, ContactPersonType } from "../types/contacts.types";

interface AssociatedContactsSectionProps {
  contacts: AssociatedContactPerson[];
  onChange: (contacts: AssociatedContactPerson[]) => void;
  isAr: boolean;
}

const CONTACT_PERSON_TYPES: { key: ContactPersonType; labelAr: string; labelEn: string }[] = [
  { key: "owner", labelAr: "صاحب المنشأة / المالك", labelEn: "Owner / Founder" },
  { key: "gm", labelAr: "مدير عام / تنفيذي", labelEn: "General Manager / CEO" },
  { key: "marketing_dir", labelAr: "مدير التسويق", labelEn: "Marketing Director" },
  { key: "marketing_rep", labelAr: "مسؤول / أخصائي تسويق", labelEn: "Marketing Specialist" },
  { key: "purchasing", labelAr: "مسؤول المشتريات", labelEn: "Procurement / Purchasing" },
  { key: "finance", labelAr: "المالية / المحاسبة", labelEn: "Finance / Accounting" },
  { key: "pr", labelAr: "العلاقات العامة", labelEn: "Public Relations" },
  { key: "content", labelAr: "مسؤول المحتوى", labelEn: "Content Manager" },
  { key: "employee", labelAr: "موظف / جهة تنسيق", labelEn: "Employee / Coordinator" },
  { key: "other", labelAr: "أخرى", labelEn: "Other" },
];

export function AssociatedContactsSection({
  contacts,
  onChange,
  isAr,
}: AssociatedContactsSectionProps) {
  const { t } = useTranslation("crm");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form draft state
  const [draftName, setDraftName] = useState("");
  const [draftJobTitle, setDraftJobTitle] = useState("");
  const [draftDepartment, setDraftDepartment] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftWhatsapp, setDraftWhatsapp] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftType, setDraftType] = useState<ContactPersonType>("owner");
  const [draftDecisionMaker, setDraftDecisionMaker] = useState(false);
  const [draftPrimary, setDraftPrimary] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const resetDraft = () => {
    setDraftName("");
    setDraftJobTitle("");
    setDraftDepartment("");
    setDraftPhone("");
    setDraftWhatsapp("");
    setDraftEmail("");
    setDraftType("owner");
    setDraftDecisionMaker(false);
    setDraftPrimary(false);
    setDraftNotes("");
    setEditingId(null);
    setIsAdding(false);
  };

  const startEdit = (person: AssociatedContactPerson) => {
    setEditingId(person.id);
    setDraftName(person.name);
    setDraftJobTitle(person.jobTitle || "");
    setDraftDepartment(person.department || "");
    setDraftPhone(person.phone || "");
    setDraftWhatsapp(person.whatsapp || "");
    setDraftEmail(person.email || "");
    setDraftType(person.type || "owner");
    setDraftDecisionMaker(!!person.isDecisionMaker);
    setDraftPrimary(!!person.isPrimary);
    setDraftNotes(person.notes || "");
    setIsAdding(true);
  };

  const handleSavePerson = () => {
    if (!draftName.trim()) return;

    let updatedList: AssociatedContactPerson[];

    const newPerson: AssociatedContactPerson = {
      id: editingId || crypto.randomUUID(),
      name: draftName.trim(),
      jobTitle: draftJobTitle.trim() || undefined,
      department: draftDepartment.trim() || undefined,
      phone: draftPhone.trim() || undefined,
      whatsapp: draftWhatsapp.trim() || undefined,
      email: draftEmail.trim() || undefined,
      type: draftType,
      isDecisionMaker: draftDecisionMaker,
      isPrimary: draftPrimary,
      notes: draftNotes.trim() || undefined,
    };

    // If marked primary, ensure all other persons have isPrimary = false
    if (draftPrimary) {
      const resetList = contacts.map((p) => ({ ...p, isPrimary: false }));
      if (editingId) {
        updatedList = resetList.map((p) => (p.id === editingId ? newPerson : p));
      } else {
        updatedList = [...resetList, newPerson];
      }
    } else {
      // If list is empty, make first person primary by default
      if (contacts.length === 0) {
        newPerson.isPrimary = true;
      }
      if (editingId) {
        updatedList = contacts.map((p) => (p.id === editingId ? newPerson : p));
      } else {
        updatedList = [...contacts, newPerson];
      }
    }

    onChange(updatedList);
    resetDraft();
  };

  const handleDeletePerson = (id: string) => {
    const filtered = contacts.filter((p) => p.id !== id);
    // If deleted person was primary and other persons exist, promote first
    if (filtered.length > 0 && !filtered.some((p) => p.isPrimary)) {
      filtered[0].isPrimary = true;
    }
    onChange(filtered);
  };

  const handleSetPrimary = (id: string) => {
    const updated = contacts.map((p) => ({
      ...p,
      isPrimary: p.id === id,
    }));
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-default-800">
            {t("contacts.contactPersons.title")}
          </h4>
          <p className="text-xs text-default-500">
            {t("contacts.contactPersons.subtitle")}
          </p>
        </div>
        {!isAdding && (
          <Button
            size="sm"
            color="primary"
            variant="flat"
            onPress={() => {
              resetDraft();
              setIsAdding(true);
            }}
            startContent={<Plus className="h-4 w-4" />}
          >
            {t("contacts.contactPersons.add")}
          </Button>
        )}
      </div>

      {/* Editor Box */}
      {isAdding && (
        <Card className="border border-primary-200/70 bg-primary-50/20 dark:bg-primary-950/20 p-4 shadow-sm">
          <CardBody className="gap-3.5 p-0">
            <div className="flex items-center justify-between border-b border-default-200/60 pb-2">
              <span className="text-xs font-bold text-primary">
                {editingId
                  ? t("contacts.contactPersons.edit")
                  : t("contacts.contactPersons.add")}
              </span>
              <Button size="sm" variant="light" onPress={resetDraft}>
                {t("contacts.form.cancel")}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                size="sm"
                label={t("contacts.contactPersons.name")}
                placeholder="مثال: فهد الدوسري"
                value={draftName}
                onValueChange={setDraftName}
                isRequired
              />
              <Select
                size="sm"
                label={t("contacts.contactPersons.type")}
                selectedKeys={[draftType]}
                onSelectionChange={(keys) => {
                  const k = Array.from(keys)[0] as ContactPersonType;
                  if (k) setDraftType(k);
                }}
              >
                {CONTACT_PERSON_TYPES.map((tItem) => (
                  <SelectItem key={tItem.key} textValue={isAr ? tItem.labelAr : tItem.labelEn}>
                    {isAr ? tItem.labelAr : tItem.labelEn}
                  </SelectItem>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                size="sm"
                label={t("contacts.contactPersons.jobTitle")}
                placeholder="مثال: مدير التسويق الإقليمي"
                value={draftJobTitle}
                onValueChange={setDraftJobTitle}
              />
              <Input
                size="sm"
                label={t("contacts.contactPersons.department")}
                placeholder="مثال: إدارة التسويق والنمو"
                value={draftDepartment}
                onValueChange={setDraftDepartment}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                size="sm"
                label={t("contacts.contactPersons.phone")}
                placeholder="05xxxxxxx"
                value={draftPhone}
                onValueChange={setDraftPhone}
                startContent={<Phone className="h-3.5 w-3.5 text-default-400" />}
              />
              <Input
                size="sm"
                label={t("contacts.contactPersons.whatsapp")}
                placeholder="9665xxxxxxx"
                value={draftWhatsapp}
                onValueChange={setDraftWhatsapp}
              />
              <Input
                size="sm"
                type="email"
                label={t("contacts.contactPersons.email")}
                placeholder="name@company.com"
                value={draftEmail}
                onValueChange={setDraftEmail}
                startContent={<Mail className="h-3.5 w-3.5 text-default-400" />}
              />
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-1">
              <Checkbox
                size="sm"
                isSelected={draftDecisionMaker}
                onValueChange={setDraftDecisionMaker}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-default-700">
                  <ShieldCheck className="h-4 w-4 text-warning" />
                  <span>{t("contacts.contactPersons.decisionMaker")}</span>
                </div>
              </Checkbox>

              <Checkbox
                size="sm"
                isSelected={draftPrimary}
                onValueChange={setDraftPrimary}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-default-700">
                  <Star className="h-4 w-4 text-primary fill-primary" />
                  <span>{t("contacts.contactPersons.setPrimary")}</span>
                </div>
              </Checkbox>
            </div>

            <Input
              size="sm"
              label={t("contacts.contactPersons.notes")}
              placeholder="ملاحظات التواصل وساعات الاتصال المفضلة..."
              value={draftNotes}
              onValueChange={setDraftNotes}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="flat" onPress={resetDraft}>
                {t("contacts.form.cancel")}
              </Button>
              <Button
                size="sm"
                color="primary"
                onPress={handleSavePerson}
                isDisabled={!draftName.trim()}
              >
                {editingId ? t("contacts.form.save") : t("contacts.contactPersons.add")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* List of Persons */}
      {contacts.length === 0 && !isAdding ? (
        <div className="rounded-2xl border border-dashed border-default-200 p-6 text-center text-xs text-default-400">
          {t("contacts.contactPersons.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((person) => {
            const typeLabel =
              CONTACT_PERSON_TYPES.find((tItem) => tItem.key === person.type)
                ? isAr
                  ? CONTACT_PERSON_TYPES.find((tItem) => tItem.key === person.type)!.labelAr
                  : CONTACT_PERSON_TYPES.find((tItem) => tItem.key === person.type)!.labelEn
                : person.type || "—";

            return (
              <div
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-default-200/80 bg-default-50/50 p-3 transition-colors hover:border-default-300"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-default-900 truncate">
                        {person.name}
                      </span>
                      {person.isPrimary && (
                        <Chip size="sm" color="primary" variant="solid" className="text-[10px] h-5">
                          ⭐ {t("contacts.contactPersons.primaryBadge")}
                        </Chip>
                      )}
                      {person.isDecisionMaker && (
                        <Chip size="sm" color="warning" variant="flat" className="text-[10px] h-5">
                          ⚖️ {t("contacts.contactPersons.decisionMaker")}
                        </Chip>
                      )}
                      <Chip size="sm" variant="bordered" className="text-[10px] h-5">
                        {typeLabel}
                      </Chip>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-default-500 pt-1 flex-wrap">
                      {person.jobTitle && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3" />
                          {person.jobTitle}
                        </span>
                      )}
                      {person.phone && (
                        <span className="flex items-center gap-1" dir="ltr">
                          <Phone className="h-3 w-3" />
                          {person.phone}
                        </span>
                      )}
                      {person.email && (
                        <span className="flex items-center gap-1 truncate max-w-[180px]">
                          <Mail className="h-3 w-3" />
                          {person.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!person.isPrimary && (
                    <Tooltip content={t("contacts.contactPersons.setPrimary")}>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => handleSetPrimary(person.id)}
                      >
                        <Star className="h-4 w-4 text-default-400 hover:text-primary" />
                      </Button>
                    </Tooltip>
                  )}
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    onPress={() => startEdit(person)}
                  >
                    <Edit2 className="h-3.5 w-3.5 text-default-600" />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    onPress={() => handleDeletePerson(person.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
