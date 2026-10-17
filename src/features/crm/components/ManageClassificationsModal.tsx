import { useState } from "react";
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
  Tooltip,
} from "@heroui/react";
import { Plus, Edit2, Archive, ArchiveRestore, Trash2, Tag, Check, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useContactClassifications,
  useCreateClassificationMutation,
  useUpdateClassificationMutation,
  useDeleteClassificationMutation,
} from "../hooks/use-contact-classifications";
import type {
  ClassificationColor,
  ContactClassificationItem,
} from "../types/classification.types";

interface ManageClassificationsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLOR_OPTIONS: { key: ClassificationColor; label: string }[] = [
  { key: "primary", label: "Blue / أزرق" },
  { key: "success", label: "Green / أخضر" },
  { key: "warning", label: "Amber / برتقالي" },
  { key: "secondary", label: "Purple / بنفسجي" },
  { key: "danger", label: "Red / أحمر" },
  { key: "default", label: "Gray / رمادي" },
];

export function ManageClassificationsModal({
  isOpen,
  onOpenChange,
}: ManageClassificationsModalProps) {
  const { t, i18n } = useTranslation("crm");
  const isAr = i18n.language === "ar";
  const { data: classifications = [] } = useContactClassifications();
  const createMutation = useCreateClassificationMutation();
  const updateMutation = useUpdateClassificationMutation();
  const deleteMutation = useDeleteClassificationMutation();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [color, setColor] = useState<ClassificationColor>("primary");

  const resetForm = () => {
    setEditingId(null);
    setNameAr("");
    setNameEn("");
    setColor("primary");
  };

  const startEdit = (item: ContactClassificationItem) => {
    setEditingId(item.id);
    setNameAr(item.nameAr);
    setNameEn(item.nameEn);
    setColor(item.color || "primary");
  };

  const handleSave = async () => {
    if (!nameAr.trim() && !nameEn.trim()) return;

    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        data: {
          nameAr: nameAr.trim() || nameEn.trim(),
          nameEn: nameEn.trim() || nameAr.trim(),
          color,
        },
      });
    } else {
      await createMutation.mutateAsync({
        key: (nameEn || nameAr).toLowerCase().trim().replace(/\s+/g, "_"),
        nameAr: nameAr.trim() || nameEn.trim(),
        nameEn: nameEn.trim() || nameAr.trim(),
        color,
        isDefault: false,
        isArchived: false,
      });
    }

    resetForm();
  };

  const handleToggleArchive = async (item: ContactClassificationItem) => {
    await updateMutation.mutateAsync({
      id: item.id,
      data: { isArchived: !item.isArchived },
    });
  };

  const handleDelete = async (item: ContactClassificationItem) => {
    if (item.isDefault) return;
    await deleteMutation.mutateAsync(item.id);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) resetForm();
        onOpenChange(open);
      }}
      size="2xl"
      scrollBehavior="inside"
      classNames={{
        base: "max-h-[90vh] rounded-3xl overflow-hidden shadow-2xl bg-background",
        header: "border-b border-default-100 p-5",
        body: "p-6 space-y-6",
        footer: "border-t border-default-100 p-4",
      }}
    >
      <ModalContent dir={isAr ? "rtl" : "ltr"}>
        {(onClose) => (
          <>
            <ModalHeader className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <div className="flex flex-col">
                <span className="text-lg font-black text-foreground">
                  {isAr ? "إدارة تصنيفات العملاء" : "Manage Contact Classifications"}
                </span>
                <span className="text-xs text-default-500 font-normal">
                  {isAr
                    ? "تخصيص وتعديل وإضافة تصنيفات مخصصة للعملاء مع الحفاظ على سلامة البيانات"
                    : "Add, edit, and organize custom contact classifications with full data integrity"}
                </span>
              </div>
            </ModalHeader>

            <ModalBody>
              {/* Inline Create / Edit Box */}
              <div className="rounded-2xl border border-primary/30 bg-primary-50/30 dark:bg-primary-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-primary">
                  <Tag className="h-4 w-4" />
                  <span>
                    {editingId
                      ? isAr
                        ? "تعديل التصنيف المحدد"
                        : "Edit Selected Classification"
                      : isAr
                      ? "إضافة تصنيف عملاء جديد"
                      : "Add New Classification"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Input
                    size="sm"
                    label={isAr ? "الاسم بالعربية" : "Arabic Name"}
                    placeholder={isAr ? "مثال: شريك استراتيجي" : "e.g. عميل VIP"}
                    value={nameAr}
                    onValueChange={setNameAr}
                    variant="bordered"
                    classNames={{ inputWrapper: "rounded-xl" }}
                  />

                  <Input
                    size="sm"
                    label={isAr ? "الاسم بالإنجليزية" : "English Name"}
                    placeholder="e.g. VIP Partner"
                    value={nameEn}
                    onValueChange={setNameEn}
                    variant="bordered"
                    classNames={{ inputWrapper: "rounded-xl" }}
                  />

                  <Select
                    size="sm"
                    label={isAr ? "لون الشارة" : "Badge Color"}
                    selectedKeys={[color]}
                    onChange={(e) =>
                      setColor((e.target.value as ClassificationColor) || "primary")
                    }
                    variant="bordered"
                    classNames={{ trigger: "rounded-xl" }}
                  >
                    {COLOR_OPTIONS.map((c) => (
                      <SelectItem key={c.key}>{c.label}</SelectItem>
                    ))}
                  </Select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  {editingId && (
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={resetForm}
                      className="rounded-xl font-bold"
                    >
                      {isAr ? "إلغاء التعديل" : "Cancel Edit"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    color="primary"
                    startContent={editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    onPress={handleSave}
                    isLoading={createMutation.isPending || updateMutation.isPending}
                    isDisabled={!nameAr.trim() && !nameEn.trim()}
                    className="rounded-xl font-bold"
                  >
                    {editingId
                      ? isAr
                        ? "حفظ التعديلات"
                        : "Save Changes"
                      : isAr
                      ? "إضافة التصنيف"
                      : "Create Classification"}
                  </Button>
                </div>
              </div>

              {/* Classifications List */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-default-500 uppercase tracking-wider">
                  {isAr ? "التصنيفات الحالية" : "Current Classifications"}
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto pe-1">
                  {classifications.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-default-100 bg-default-50/50 hover:bg-default-100/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Chip
                          size="sm"
                          color={item.color || "primary"}
                          variant="flat"
                          className="font-bold shrink-0"
                        >
                          {isAr ? item.nameAr || item.nameEn : item.nameEn || item.nameAr}
                        </Chip>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-foreground truncate">
                            {item.nameAr} / {item.nameEn}
                          </span>
                          <span className="text-[10px] font-mono text-default-400 truncate">
                            Key: {item.key} {item.isDefault && "• (افتراضي)"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Tooltip content={isAr ? "تعديل" : "Edit"}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            onPress={() => startEdit(item)}
                          >
                            <Edit2 className="h-3.5 w-3.5 text-default-600" />
                          </Button>
                        </Tooltip>

                        <Tooltip
                          content={
                            item.isArchived
                              ? isAr
                                ? "استعادة من الأرشيف"
                                : "Unarchive"
                              : isAr
                              ? "أرشفة"
                              : "Archive"
                          }
                        >
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            color={item.isArchived ? "warning" : "default"}
                            onPress={() => handleToggleArchive(item)}
                          >
                            {item.isArchived ? (
                              <ArchiveRestore className="h-3.5 w-3.5 text-warning" />
                            ) : (
                              <Archive className="h-3.5 w-3.5 text-default-400" />
                            )}
                          </Button>
                        </Tooltip>

                        {!item.isDefault && (
                          <Tooltip content={isAr ? "حذف" : "Delete"}>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              color="danger"
                              onPress={() => handleDelete(item)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button
                variant="flat"
                onPress={onClose}
                className="rounded-xl font-bold"
              >
                {t("contacts.form.close", "إغلاق")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
