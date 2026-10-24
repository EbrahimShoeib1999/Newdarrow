import type { SupportLang } from "../utils/support-whatsapp";

/**
 * Deterministic, in-app help knowledge base. This is the assistant's SAFE fallback:
 * it answers "how do I use the app" questions without any AI provider, without
 * touching record data, and without ever inventing business facts. Every entry is
 * authored product knowledge — not derived from the tenant — so it is always safe.
 */
export interface HelpArticle {
  id: string;
  /** Localized title, body, and a route the user can jump to. */
  title: Record<SupportLang, string>;
  body: Record<SupportLang, string>;
  /** Safe in-app route to navigate to (path only, no ids/params). */
  link?: string;
  /** Keywords for local search matching (both languages). */
  keywords: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "sales-lifecycle",
    title: { en: "Sales lifecycle: lead to payment", ar: "دورة المبيعات: من العميل حتى الدفع" },
    body: {
      en: "Create a contact, add a lead, convert it to a deal, then generate a contract from the won deal. Approve the contract, convert it into a project, deliver the tasks, raise invoices and register payments. Each step keeps an auditable link to the previous record.",
      ar: "أنشئ جهة اتصال، ثم عميلًا محتملًا، وحوّله إلى فرصة، ثم أنشئ العقد من الفرصة المكسوبة. اعتمد العقد وحوّله إلى مشروع، ونفّذ المهام، وأصدر الفواتير وسجّل المدفوعات. كل خطوة تحتفظ بمرتبط تدقيقي إلى السجل السابق.",
    },
    link: "/crm",
    keywords: ["lead", "deal", "contract", "invoice", "payment", "عميل", "فرصة", "عقد", "فاتورة", "دفعة"],
  },
  {
    id: "projects-tasks",
    title: { en: "Projects and tasks", ar: "المشاريع والمهام" },
    body: {
      en: "Open a project to see its tasks, milestones, expenses and financials in tabs. Assign a task to one accountable person (the assignee) — it then appears in that person's task list and updates the project's progress. Use the task page to jump back to its project.",
      ar: "افتح المشروع لعرض مهامه ومعالمه ونفقاته ومالياته في تبويبات. اسند المهمة إلى مسؤول واحد (المُسند إليه) فتظهر في قائمة مهامه وتحدّث تقدّم المشروع. استخدم صفحة للعودة إلى المشروع المرتبط.",
    },
    link: "/projects",
    keywords: ["project", "task", "assignee", "milestone", "مشروع", "مهمة", "مسؤول", "معلم"],
  },
  {
    id: "expense-categories",
    title: { en: "Project expense categories", ar: "فئات مصروفات المشروع" },
    body: {
      en: "Expense categories are fully configurable — you do not need code changes. Manage them as Chart of Accounts and Cost Centers under Billing. When you record a bill line against an account, the project's financials break costs down by that category automatically.",
      ar: "فئات المصروفات قابلة للتهيئة بالكامل دون تعديل شيفرة. أدرِها كدليل حسابات ومراكز تكلفة داخل الفوترة. عند تسجيل سطر فاتورة على حساب، تتوزع التكاليف في ماليات المشروع حسب تلك الفئة تلقائيًا.",
    },
    link: "/billing",
    keywords: ["expense", "category", "account", "cost center", "bill", "مصروف", "فئة", "حساب", "مركز تكلفة", "فاتورة مورد"],
  },
  {
    id: "cost-tiers",
    title: { en: "Recorded vs approved vs paid cost", ar: "التكلفة المُسجَّلة مقابل المعتمدة مقابل المدفوعة" },
    body: {
      en: "A recorded bill is an entry only. Once an accountant approves it, it becomes an approved actual. It is paid only when a payment is registered. The project financials show all three separately — a recorded or approved bill is never counted as paid.",
      ar: "فاتورة المورد المُسجَّلة مجرد قيد. عندما يعتمدها المحاسب تصبح تكلفة فعلية معتمدة، ولا تُعد مدفوعة إلا عند تسجيل دفعة. تعرض ماليات المشروع الثلاث منفصلة — فلا تُحتسب الفاتورة المُسجَّلة أو المعتمدة كمدفوعة أبدًا.",
    },
    link: "/projects",
    keywords: ["recorded", "approved", "paid", "cost", "approval", "مسجلة", "معتمدة", "مدفوعة", "تكلفة", "اعتماد"],
  },
  {
    id: "real-estate",
    title: { en: "Real-estate units", ar: "وحدات العقارات" },
    body: {
      en: "Set a project's activity type to Real Estate Development or Property Management to unlock the Units tab. Add units with a code, type, area and asking price, then move them through their lifecycle: available → reserved → sold. Reserving or selling records the buyer and prevents a second commitment on the same unit.",
      ar: "اضبط نوع نشاط المشروع على «تطوير عقاري» أو «إدارة عقارات» لفتح تبويب الوحدات. أضف الوحدات برمز ونوع ومساحة وسعر عرض، ثم حرّكها عبر دورة الحياة: متاحة ← محجوزة ← مباعة. الحجز أو البيع يسجّل المشتري ويمنع التزامًا ثانيًا على الوحدة نفسها.",
    },
    link: "/projects",
    keywords: ["real estate", "unit", "property", "reserve", "sell", "عقار", "وحدة", "حجز", "بيع"],
  },
  {
    id: "support",
    title: { en: "Getting human support", ar: "الحصول على دعم بشري" },
    body: {
      en: "Use the Support tab to open a WhatsApp chat with your company's configured support number, or raise a support ticket. A ticket becomes a tracked task so your team can follow it to resolution.",
      ar: "استخدم تبويب الدعم لفتح محادثة واتساب على رقم الدعم المهيّأ لشركتك، أو أنشئ تذكرة دعم. تتحول التذكرة إلى مهمة متتبعة ليتابعها فريقك حتى الحل.",
    },
    keywords: ["support", "help", "whatsapp", "ticket", "دعم", "مساعدة", "واتساب", "تذكرة"],
  },
];

/** Simple keyword + title search across both languages. Returns best matches. */
export function searchHelp(query: string, limit = 5): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_ARTICLES.slice(0, limit);
  const score = (a: HelpArticle) => {
    const hay = [
      a.title.en.toLowerCase(),
      a.title.ar,
      a.body.en.toLowerCase(),
      a.body.ar,
      ...a.keywords.map((k) => k.toLowerCase()),
    ].join(" ");
    return hay.includes(q) ? 1 : 0;
  };
  const matched = HELP_ARTICLES.filter(score);
  return (matched.length ? matched : HELP_ARTICLES).slice(0, limit);
}
