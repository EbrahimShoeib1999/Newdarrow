import type { ProjectActivityType } from "../types/projects.types";

/**
 * Activity presets — industry-shaped DEFAULTS offered at creation time only.
 * They never specialize the shared domain model: a preset only pre-fills
 * milestone titles/tags, all of which stay fully editable afterwards.
 */
export interface ActivityPreset {
  key: ProjectActivityType;
  /** Bilingual display labels (settings-terminology independent). */
  labels: { en: string; ar: string };
  /** Default milestone titles, in execution order. */
  milestones: { en: string[]; ar: string[] };
  /** Suggested tags applied on creation. */
  suggestedTags: string[];
}

export const ACTIVITY_PRESETS: ActivityPreset[] = [
  {
    key: "software",
    labels: { en: "Software Development", ar: "تطوير برمجيات" },
    milestones: {
      en: [
        "Requirements & specification",
        "Design & architecture",
        "Development",
        "QA & testing",
        "Deployment & handover",
      ],
      ar: [
        "المتطلبات والمواصفات",
        "التصميم والبنية",
        "التطوير",
        "الجودة والاختبار",
        "النشر والتسليم",
      ],
    },
    suggestedTags: ["software"],
  },
  {
    key: "marketing",
    labels: { en: "Marketing Campaign", ar: "حملة تسويقية" },
    milestones: {
      en: [
        "Brief & strategy",
        "Creative production",
        "Launch",
        "Mid-campaign review",
        "Results report",
      ],
      ar: [
        "الملخص والاستراتيجية",
        "الإنتاج الإبداعي",
        "الإطلاق",
        "مراجعة منتصف الحملة",
        "تقرير النتائج",
      ],
    },
    suggestedTags: ["marketing"],
  },
  {
    key: "consulting",
    labels: { en: "Consulting Engagement", ar: "استشارات" },
    milestones: {
      en: ["Discovery", "Analysis & recommendations", "Workshop / handover", "Follow-up"],
      ar: ["الاستكشاف", "التحليل والتوصيات", "الورشة والتسليم", "المتابعة"],
    },
    suggestedTags: ["consulting"],
  },
  {
    key: "construction",
    labels: { en: "Construction / Fit-out", ar: "إنشاءات وتشييد" },
    milestones: {
      en: [
        "Permits & mobilization",
        "Foundation / shell",
        "Finishing works",
        "Snag & inspection",
        "Handover",
      ],
      ar: [
        "التراخيص والتجهيز",
        "الأساسات والهيكل",
        "أعمال التشطيبات",
        "المعاينة والفحص",
        "التسليم",
      ],
    },
    suggestedTags: ["construction"],
  },
  {
    key: "general",
    labels: { en: "General Services", ar: "خدمات عامة" },
    milestones: {
      en: ["Kick-off", "Execution", "Review", "Closure"],
      ar: ["الانطلاق", "التنفيذ", "المراجعة", "الإغلاق"],
    },
    suggestedTags: [],
  },
  {
    key: "real_estate",
    labels: { en: "Real Estate Development", ar: "تطوير عقاري" },
    milestones: {
      en: [
        "Land acquisition & permits",
        "Masterplan & unit design",
        "Construction",
        "Sales & handover",
        "Post-sale service",
      ],
      ar: [
        "استملاك الأرض والتراخيص",
        "المخطط العام وتصميم الوحدات",
        "التنفيذ الإنشائي",
        "البيع والتسليم",
        "خدمة ما بعد البيع",
      ],
    },
    suggestedTags: ["real-estate"],
  },
  {
    key: "property_management",
    labels: { en: "Property Management", ar: "إدارة عقارات" },
    milestones: {
      en: [
        "Inventory onboarding",
        "Tenant setup",
        "Operations & maintenance",
        "Renewals",
        "Periodic reporting",
      ],
      ar: [
        "تسجيل المحفظة",
        "تجهيز المستأجرين",
        "التشغيل والصيانة",
        "التجديدات",
        "التقرير الدوري",
      ],
    },
    suggestedTags: ["property-management"],
  },
];

export function getActivityPreset(key?: string | null): ActivityPreset | undefined {
  if (!key) return undefined;
  return ACTIVITY_PRESETS.find((p) => p.key === key);
}

/**
 * The project types whose model is unit-based: they unlock the integrated
 * unit-inventory tab. Kept as data (not a scattered condition) so new
 * unit-bearing types are added in one place.
 */
export const UNIT_BEARING_ACTIVITY: readonly ProjectActivityType[] = [
  "real_estate",
  "property_management",
];

export function supportsUnitInventory(activityType?: string | null): boolean {
  return !!activityType && (UNIT_BEARING_ACTIVITY as readonly string[]).includes(activityType);
}
