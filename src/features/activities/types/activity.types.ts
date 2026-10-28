/**
 * Business Activity Engine — stable activity identifiers.
 *
 * These ids are the machine contract of the whole platform. They are
 * deliberately independent from any Arabic/English display name: renaming a
 * label in the settings UI can never re-interpret stored data or flip which
 * routes, navigation groups or permissions are active.
 *
 * The tenant's chosen id is persisted on `companies/{companyId}.primaryActivity`
 * and re-resolved from Firestore on every load — the browser's localStorage or
 * the rendered navigation are never treated as proof of authorization.
 */

export const ACTIVITY_IDS = [
  "PROJECTS",
  "REAL_ESTATE_MANAGEMENT",
  "REAL_ESTATE_BROKERAGE",
  "FACILITIES_MANAGEMENT",
  "REAL_ESTATE_DEVELOPMENT",
  "MARKETING_AGENCY",
  "MEDICAL_CLINIC",
  "SCHOOL_MANAGEMENT",
] as const;

export type ActivityId = (typeof ACTIVITY_IDS)[number];

export interface ActivityMeta {
  id: ActivityId;
  /** Bilingual display labels. Display-only: logic always keys off `id`. */
  labels: { en: string; ar: string };
  description: { en: string; ar: string };
  /** Route prefix that owns this activity's domain pages (see lib/activity-routes). */
  routeBase: string;
  /** True when the domain pages for this activity are mounted in the router. */
  moduleLive: boolean;
}

/**
 * The activity whose module is actually implemented today. Every other entry
 * keeps a reserved route prefix so its namespace is claimed (and gated) even
 * before its pages ship — direct URLs never fall through to unrelated modules.
 */
export const DEFAULT_ACTIVITY: ActivityId = "PROJECTS";

export const ACTIVITY_REGISTRY: Record<ActivityId, ActivityMeta> = {
  PROJECTS: {
    id: "PROJECTS",
    labels: { en: "General Projects", ar: "المشاريع العامة" },
    description: {
      en: "Deliverable-based project management with milestones, tasks and client contracts.",
      ar: "إدارة المشاريع القائمة على المخرجات مع المراحل والمهام وعقود العملاء.",
    },
    routeBase: "/projects",
    moduleLive: true,
  },
  REAL_ESTATE_MANAGEMENT: {
    id: "REAL_ESTATE_MANAGEMENT",
    labels: { en: "Real Estate Management & Leasing", ar: "إدارة العقارات والتأجير" },
    description: {
      en: "Properties, units, tenants, lease contracts, collections and property reports.",
      ar: "العقارات والوحدات والمستأجرون وعقود الإيجار والتحصيلات وتقارير الأملاك.",
    },
    routeBase: "/real-estate",
    moduleLive: true,
  },
  REAL_ESTATE_BROKERAGE: {
    id: "REAL_ESTATE_BROKERAGE",
    labels: { en: "Real Estate Brokerage", ar: "الوساطة العقارية" },
    description: {
      en: "Listings, viewings, offers, brokerage agreements and commissions.",
      ar: "الإعلانات والزيارات والعروض واتفاقيات الوساطة والعمولات.",
    },
    routeBase: "/brokerage",
    moduleLive: false,
  },
  FACILITIES_MANAGEMENT: {
    id: "FACILITIES_MANAGEMENT",
    labels: { en: "Facilities Management", ar: "إدارة المرافق والصيانة" },
    description: {
      en: "Facilities, assets, maintenance requests and work orders.",
      ar: "المرافق والأصول وطلبات الصيانة وأوامر العمل.",
    },
    routeBase: "/facilities",
    moduleLive: true,
  },
  REAL_ESTATE_DEVELOPMENT: {
    id: "REAL_ESTATE_DEVELOPMENT",
    labels: { en: "Real Estate Development", ar: "التطوير العقاري" },
    description: {
      en: "Development projects, construction phases, contractor claims and handovers.",
      ar: "مشاريع التطوير والمراحل الإنشائية ومطالبات المقاولين والتسليمات.",
    },
    routeBase: "/development",
    moduleLive: false,
  },
  MARKETING_AGENCY: {
    id: "MARKETING_AGENCY",
    labels: { en: "Marketing Agency", ar: "وكالة تسويق" },
    description: {
      en: "Clients, campaigns, content, deliverables and campaign reports.",
      ar: "العملاء والحملات والمحتوى والمخرجات وتقارير الحملات.",
    },
    routeBase: "/agency",
    // Marketing pages, permissions and data boundary are all implemented and
    // mounted in router.tsx, so the namespace is now live (same gate as
    // FACILITIES_MANAGEMENT: live only when the real routes exist).
    moduleLive: true,
  },
  MEDICAL_CLINIC: {
    id: "MEDICAL_CLINIC",
    labels: { en: "Medical Clinic", ar: "عيادة طبية" },
    description: {
      en: "Patients, appointments, practitioners and authorized clinical records.",
      ar: "المرضى والمواعيد والأطباء والسجلات السريرية المصرّح بها.",
    },
    routeBase: "/clinic",
    moduleLive: false,
  },
  SCHOOL_MANAGEMENT: {
    id: "SCHOOL_MANAGEMENT",
    labels: { en: "School Management", ar: "إدارة مدرسة" },
    description: {
      en: "Students, guardians, enrollments, classes, attendance and academic records.",
      ar: "الطلاب وأولياء الأمر والتسجيلات والفصول والحضور والسجلات الأكاديمية.",
    },
    routeBase: "/school",
    moduleLive: true,
  },
};

export const ACTIVITY_ID_LIST: ActivityMeta[] = ACTIVITY_IDS.map((id) => ACTIVITY_REGISTRY[id]);

/** Type guard for values coming from Firestore / user input. */
export function isActivityId(value: unknown): value is ActivityId {
  return typeof value === "string" && (ACTIVITY_IDS as readonly string[]).includes(value);
}

/**
 * Normalize whatever the company doc holds into a valid activity id.
 * Unknown, missing or legacy values fall back to PROJECTS — the behavior every
 * tenant had before the activity engine existed. The check is by stable id
 * only, never by display name.
 */
export function resolveStoredActivity(value: unknown): ActivityId {
  return isActivityId(value) ? value : DEFAULT_ACTIVITY;
}

/** Bilingual label picker used by every surface that renders an activity name. */
export function activityLabel(id: ActivityId, lang: "ar" | "en"): string {
  return ACTIVITY_REGISTRY[id].labels[lang === "ar" ? "ar" : "en"];
}
