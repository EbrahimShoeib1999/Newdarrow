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
];

export function getActivityPreset(key?: string | null): ActivityPreset | undefined {
  if (!key) return undefined;
  return ACTIVITY_PRESETS.find((p) => p.key === key);
}
