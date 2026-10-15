/**
 * Categories a client can choose to cooperate on. Mirrors the contract-template
 * families so a won lead can flow straight into the matching contract/services.
 */
export type LeadServiceCategory =
  | "marketing"
  | "ecommerce"
  | "web_development"
  | "social_media"
  | "video_production";

export interface LeadServiceCategoryDef {
  id: LeadServiceCategory;
  labelEn: string;
  labelAr: string;
  /** Suggested note templates shown in the lead chatter, keyed by language. */
  suggestions: { en: string[]; ar: string[] };
}

export const LEAD_SERVICE_CATEGORIES: LeadServiceCategoryDef[] = [
  {
    id: "marketing",
    labelEn: "Marketing & Ad Campaigns",
    labelAr: "التسويق والحملات الإعلانية",
    suggestions: {
      en: [
        "Kickoff call scheduled to align on campaign goals and target audience.",
        "Requested brand assets and access to ad accounts.",
      ],
      ar: [
        "تم تحديد موعد اجتماع انطلاق لمزامنة أهداف الحملة والجمهور المستهدف.",
        "تم طلب هوية العلامة والوصول إلى حسابات الإعلانات.",
      ],
    },
  },
  {
    id: "ecommerce",
    labelEn: "E-commerce Store Management",
    labelAr: "إدارة المتجر الإلكتروني",
    suggestions: {
      en: [
        "Collecting product list, images and pricing for store upload.",
        "Confirmed store platform and shipping/payment integrations.",
      ],
      ar: [
        "جارٍ تجميع قائمة المنتجات والصور والأسعار لرفعها على المتجر.",
        "تم تأكيد منصة المتجر وتكاملات الشحن والدفع.",
      ],
    },
  },
  {
    id: "web_development",
    labelEn: "Website / Store Development",
    labelAr: "تصميم وتطوير المواقع",
    suggestions: {
      en: [
        "Collected requirements and sitemap for the new website.",
        "Agreed on UI/UX wireframes review before development starts.",
      ],
      ar: [
        "تم جمع المتطلبات وخريطة الموقع الجديد.",
        "تم الاتفاق على مراجعة واجهات UI/UX قبل بدء التطوير.",
      ],
    },
  },
  {
    id: "social_media",
    labelEn: "Social Media & Content",
    labelAr: "التواصل الاجتماعي وصناعة المحتوى",
    suggestions: {
      en: [
        "Monthly content plan drafted and awaiting client approval.",
        "Agreed on posting frequency and brand tone of voice.",
      ],
      ar: [
        "تم إعداد خطة المحتوى الشهرية بانتظار موافقة العميل.",
        "تم الاتفاق على وتيرة النشر ونبرة العلامة التجارية.",
      ],
    },
  },
  {
    id: "video_production",
    labelEn: "Video & Photo Production",
    labelAr: "الإنتاج المرئي والتصوير",
    suggestions: {
      en: [
        "Shoot date and location confirmed with the client.",
        "Shared first draft cut for review and revisions.",
      ],
      ar: [
        "تم تأكيد موعد ومكان التصوير مع العميل.",
        "تمت مشاركة النسخة الأولى للمونتاج للمراجعة والتعديلات.",
      ],
    },
  },
];

export function getLeadServiceCategory(id?: string | null): LeadServiceCategoryDef | undefined {
  if (!id) return undefined;
  return LEAD_SERVICE_CATEGORIES.find((c) => c.id === id);
}

export function getCategoryNoteSuggestions(
  id: string | null | undefined,
  locale: string
): string[] {
  const category = getLeadServiceCategory(id);
  if (!category) return [];
  return locale === "ar" ? category.suggestions.ar : category.suggestions.en;
}

export function getCategoryLabel(id: string | null | undefined, locale: string): string {
  const category = getLeadServiceCategory(id);
  if (!category) return "";
  return locale === "ar" ? category.labelAr : category.labelEn;
}
