/**
 * Reusable module templates — the "start from a template" presets of the
 * configuration editor. A template is just a VALID definition draft: it goes
 * through the exact same validateDefinition() path as a hand-built module, so
 * nothing about the security or integrity contract changes.
 *
 * Templates exist because whole activity domains (clinic, school, …) reached
 * production as shells: their day-to-day entities are ordinary configurable
 * CRUD, which the engine can now deliver without a code change per tenant.
 */

import type { ActivityId } from "@/features/activities/types/activity.types";
import type { CustomModuleDefinition } from "../types/custom-module.types";

export interface ModuleTemplate {
  key: string;
  /** null = offered under every activity. */
  activity: ActivityId | null;
  nameAr: string;
  nameEn: string;
  /** Definition draft WITHOUT the fields the service stamps on creation. */
  build(): Omit<CustomModuleDefinition, "revision" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy">;
}

const GRANTS_ALL = {
  view: ["super_admin", "admin", "manager", "employee"] as const,
  create: ["super_admin", "admin", "manager", "employee"] as const,
  update: ["super_admin", "admin", "manager", "employee"] as const,
  archive: ["super_admin", "admin", "manager"] as const,
};

const PERMISSIONS_DEFAULT = {
  view: "custom_modules.view",
  create: "custom_modules.create",
  update: "custom_modules.update",
  archive: "custom_modules.archive",
} as const;

const BASE_STAGES = [
  { key: "open", label: { ar: "مفتوح", en: "Open" }, color: "primary", next: ["in_progress", "done", "cancelled"] },
  { key: "in_progress", label: { ar: "قيد المعالجة", en: "In progress" }, color: "warning", next: ["done", "cancelled"] },
  { key: "done", label: { ar: "مغلق", en: "Done" }, color: "success", terminal: true, next: [] },
  { key: "cancelled", label: { ar: "ملغي", en: "Cancelled" }, color: "danger", terminal: true, next: [] },
];

export const MODULE_TEMPLATES: ModuleTemplate[] = [
  {
    key: "appointments",
    activity: "MEDICAL_CLINIC",
    nameAr: "المواعيد",
    nameEn: "Appointments",
    build: () => ({
      key: "appointments",
      name: { ar: "المواعيد", en: "Appointments" },
      description: { ar: "جدولة مواعيد العيادة و متابعتها", en: "Clinic visit scheduling and follow-up" },
      icon: "Calendar",
      activity: "MEDICAL_CLINIC",
      templateKey: "appointments",
      lifecycle: "draft",
      fields: [
        { key: "patient_name", type: "text", label: { ar: "اسم المريض", en: "Patient name" }, required: true, searchable: true, showInList: true, minLen: 2, maxLen: 120, unique: false },
        { key: "phone", type: "phone", label: { ar: "هاتف التواصل", en: "Contact phone" }, required: true, searchable: true, showInList: true },
        { key: "doctor_employee", type: "relation", label: { ar: "الطبيب / الموظف", en: "Doctor / staff" }, required: true, showInList: true, searchable: false, relation: { target: "employee" } },
        { key: "visit_date", type: "date", label: { ar: "تاريخ الموعد", en: "Visit date" }, required: true, showInList: true, searchable: false },
        { key: "service_type", type: "select", label: { ar: "نوع الخدمة", en: "Service type" }, required: false, showInList: true, searchable: true, options: [
          { key: "consultation", label: { ar: "استشارة", en: "Consultation" } },
          { key: "followup", label: { ar: "متابعة", en: "Follow-up" } },
          { key: "procedure", label: { ar: "إجراء", en: "Procedure" } },
        ] },
        { key: "fee", type: "currency", label: { ar: "رسوم الزيارة", en: "Visit fee" }, required: false, showInList: true, searchable: false, min: 0 },
        { key: "notes", type: "textarea", label: { ar: "ملاحظات", en: "Notes" }, required: false, showInList: false, searchable: true, maxLen: 2000 },
      ],
      stages: BASE_STAGES,
      initialStage: "open",
      listConfig: { primaryField: "patient_name", columns: ["phone", "doctor_employee", "visit_date", "service_type", "fee"], sortField: "visit_date", sortDir: "asc", pageSize: 20 },
      roleGrants: { view: [...GRANTS_ALL.view], create: [...GRANTS_ALL.create], update: [...GRANTS_ALL.update], archive: [...GRANTS_ALL.archive] },
      allowPermanentDelete: false,
      permissions: { ...PERMISSIONS_DEFAULT },
    }),
  },
  {
    key: "students",
    activity: "SCHOOL_MANAGEMENT",
    nameAr: "الطلاب",
    nameEn: "Students",
    build: () => ({
      key: "students",
      name: { ar: "الطلاب", en: "Students" },
      description: { ar: "ملفات الطلاب والتسجيل", en: "Student files and enrollment" },
      icon: "GraduationCap",
      activity: "SCHOOL_MANAGEMENT",
      templateKey: "students",
      lifecycle: "draft",
      fields: [
        { key: "student_name", type: "text", label: { ar: "اسم الطالب", en: "Student name" }, required: true, searchable: true, showInList: true, minLen: 2, maxLen: 120 },
        { key: "guardian_phone", type: "phone", label: { ar: "هاتف ولي الأمر", en: "Guardian phone" }, required: true, searchable: true, showInList: true },
        { key: "grade_level", type: "select", label: { ar: "الصف الدراسي", en: "Grade level" }, required: true, showInList: true, searchable: true, options: [
          { key: "k1", label: { ar: "الأول", en: "Grade 1" } },
          { key: "k2", label: { ar: "الثاني", en: "Grade 2" } },
          { key: "k3", label: { ar: "الثالث", en: "Grade 3" } },
          { key: "k4", label: { ar: "الرابع", en: "Grade 4" } },
          { key: "k5", label: { ar: "الخامس", en: "Grade 5" } },
          { key: "k6", label: { ar: "السادس", en: "Grade 6" } },
        ] },
        { key: "enrolled", type: "boolean", label: { ar: "مسجّل حالياً", en: "Currently enrolled" }, required: false, showInList: true, searchable: false },
        { key: "tuition", type: "currency", label: { ar: "الرسوم الدراسية", en: "Annual tuition" }, required: false, showInList: true, searchable: false, min: 0 },
        { key: "notes", type: "textarea", label: { ar: "ملاحظات", en: "Notes" }, required: false, showInList: false, searchable: true, maxLen: 2000 },
      ],
      stages: [
        { key: "applying", label: { ar: "طلب التحاق", en: "Applying" }, color: "default", next: ["enrolled", "rejected"] },
        { key: "enrolled", label: { ar: "مسجّل", en: "Enrolled" }, color: "primary", next: ["graduated", "withdrawn"] },
        { key: "graduated", label: { ar: "متخرج", en: "Graduated" }, color: "success", terminal: true, next: [] },
        { key: "withdrawn", label: { ar: "منسحب", en: "Withdrawn" }, color: "warning", terminal: true, next: [] },
        { key: "rejected", label: { ar: "مرفوض", en: "Rejected" }, color: "danger", terminal: true, next: [] },
      ],
      initialStage: "applying",
      listConfig: { primaryField: "student_name", columns: ["guardian_phone", "grade_level", "enrolled", "tuition"], sortField: "student_name", sortDir: "asc", pageSize: 20 },
      roleGrants: { view: [...GRANTS_ALL.view], create: [...GRANTS_ALL.create], update: [...GRANTS_ALL.update], archive: [...GRANTS_ALL.archive] },
      allowPermanentDelete: false,
      permissions: { ...PERMISSIONS_DEFAULT },
    }),
  },
  {
    key: "vendors",
    activity: null,
    nameAr: "الموردون",
    nameEn: "Vendors",
    build: () => ({
      key: "vendors",
      name: { ar: "الموردون", en: "Vendors" },
      description: { ar: "سجل الموردين وعقودهم", en: "Vendor register and contracts" },
      icon: "Truck",
      activity: "PROJECTS", // overwritten by the service with the tenant activity
      templateKey: "vendors",
      lifecycle: "draft",
      fields: [
        { key: "vendor_name", type: "text", label: { ar: "اسم المورد", en: "Vendor name" }, required: true, searchable: true, showInList: true, minLen: 2, maxLen: 150, unique: true },
        { key: "contact_email", type: "email", label: { ar: "البريد الإلكتروني", en: "Email" }, required: false, searchable: true, showInList: true },
        { key: "phone", type: "phone", label: { ar: "الهاتف", en: "Phone" }, required: false, searchable: true, showInList: true },
        { key: "category", type: "select", label: { ar: "الفئة", en: "Category" }, required: false, showInList: true, searchable: true, options: [
          { key: "supplies", label: { ar: "مستلزمات", en: "Supplies" } },
          { key: "services", label: { ar: "خدمات", en: "Services" } },
          { key: "maintenance", label: { ar: "صيانة", en: "Maintenance" } },
        ] },
        { key: "contract_value", type: "currency", label: { ar: "قيمة العقد", en: "Contract value" }, required: false, showInList: true, searchable: false, min: 0 },
        { key: "notes", type: "textarea", label: { ar: "ملاحظات", en: "Notes" }, required: false, showInList: false, searchable: true, maxLen: 2000 },
      ],
      stages: BASE_STAGES,
      initialStage: "open",
      listConfig: { primaryField: "vendor_name", columns: ["category", "phone", "contact_email", "contract_value"], sortField: "vendor_name", sortDir: "asc", pageSize: 20 },
      roleGrants: { view: [...GRANTS_ALL.view], create: [...GRANTS_ALL.create], update: [...GRANTS_ALL.update], archive: [...GRANTS_ALL.archive] },
      allowPermanentDelete: false,
      permissions: { ...PERMISSIONS_DEFAULT },
    }),
  },
  {
    key: "equipment",
    activity: null,
    nameAr: "المعدات",
    nameEn: "Equipment",
    build: () => ({
      key: "equipment",
      name: { ar: "المعدات", en: "Equipment" },
      description: { ar: "أصول ومعدات قابلة للتتبع", en: "Trackable assets and equipment" },
      icon: "Wrench",
      activity: "PROJECTS",
      templateKey: "equipment",
      lifecycle: "draft",
      fields: [
        { key: "item_name", type: "text", label: { ar: "اسم المعدة", en: "Equipment name" }, required: true, searchable: true, showInList: true, minLen: 2, maxLen: 150, unique: true },
        { key: "serial_number", type: "text", label: { ar: "الرقم التسلسلي", en: "Serial number" }, required: false, searchable: true, showInList: true, maxLen: 80 },
        { key: "purchase_date", type: "date", label: { ar: "تاريخ الشراء", en: "Purchase date" }, required: false, showInList: true, searchable: false },
        { key: "purchase_cost", type: "currency", label: { ar: "تكلفة الشراء", en: "Purchase cost" }, required: false, showInList: true, searchable: false, min: 0 },
        { key: "in_service", type: "boolean", label: { ar: "في الخدمة", en: "In service" }, required: false, showInList: true, searchable: false },
        { key: "assigned_contact", type: "relation", label: { ar: "جهة التواصل", en: "Responsible contact" }, required: false, showInList: false, searchable: false, relation: { target: "contact" } },
      ],
      stages: [
        { key: "active", label: { ar: "نشطة", en: "Active" }, color: "success", next: ["under_maintenance", "retired"] },
        { key: "under_maintenance", label: { ar: "تحت الصيانة", en: "Under maintenance" }, color: "warning", next: ["active", "retired"] },
        { key: "retired", label: { ar: "خارج الخدمة", en: "Retired" }, color: "danger", terminal: true, next: [] },
      ],
      initialStage: "active",
      listConfig: { primaryField: "item_name", columns: ["serial_number", "purchase_date", "purchase_cost", "in_service"], sortField: "item_name", sortDir: "asc", pageSize: 20 },
      roleGrants: { view: [...GRANTS_ALL.view], create: [...GRANTS_ALL.create], update: [...GRANTS_ALL.update], archive: [...GRANTS_ALL.archive] },
      allowPermanentDelete: false,
      permissions: { ...PERMISSIONS_DEFAULT },
    }),
  },
];

export function templatesForActivity(activity: ActivityId | null): ModuleTemplate[] {
  if (!activity) return [];
  return MODULE_TEMPLATES.filter((t) => t.activity === null || t.activity === activity);
}
