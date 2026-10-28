import type { PortalId } from "@/lib/portal-permissions";
import {
  LayoutDashboard,
  ListTodo,
  Clock,
  UserPlus,
  Users,
  Handshake,
  BarChart3,
  FileText,
  ScrollText,
  Calendar,
  CheckSquare,
  Timer,
  TrendingUp,
  MapPin,
  Settings,
  Package,
  BookCopy,
  BookA,
  FileSpreadsheet,
  ReceiptText,
  PieChart,
  LayoutGrid,
  HandCoins,
  Banknote,
  Wallet,
  Inbox,
  Layers,
  Landmark,
  HardDrive,
  Lock,
  ClipboardCheck,
  ShieldCheck,
  Building2,
  Building,
  Wrench,
  CalendarClock,
  FolderKanban,
  FolderOpen,
  CheckCircle2,
  Activity,
  Megaphone,
  Send,
  GraduationCap,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface PortalNavItem {
  labelKey: string;
  path: string;
  icon: LucideIcon;
  end?: boolean;
  namespace?: "common" | "crm" | "billing" | "chat" | "projects" | "facilities" | "marketing" | "real_estate" | "school";
  /** If set, item is shown only when the user has this permission. */
  permission?: import("@/lib/permissions").Permission;
}

export interface PortalNavTreeGroup {
  id: string;
  labelKey: string;
  icon?: LucideIcon;
  namespace?: "common" | "crm" | "billing" | "chat" | "projects" | "facilities" | "marketing" | "real_estate" | "school";
  items: PortalNavItem[];
}

/** Match a navigation item without letting an index route highlight every child page. */
export function isPortalNavItemActive(item: PortalNavItem, pathname: string): boolean {
  const currentPath = pathname.replace(/\/+$/, "") || "/";
  return currentPath === item.path || (!item.end && currentPath.startsWith(`${item.path}/`));
}

export const TASKS_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "general",
    labelKey: "nav.general",
    icon: LayoutDashboard,
    items: [
      { labelKey: "nav.dashboard", path: "/tasks", icon: LayoutDashboard, end: true },
    ],
  },
  {
    id: "work_sprints",
    labelKey: "nav.work_management",
    icon: ListTodo,
    items: [
      { labelKey: "nav.tasks", path: "/tasks/work", icon: ListTodo },
      { labelKey: "nav.sprints", path: "/tasks/sprints", icon: Clock },
      { labelKey: "nav.daily_reports", path: "/tasks/daily-reports", icon: ClipboardCheck },
      { labelKey: "nav.meetings", path: "/meetings", icon: Calendar },
    ],
  },
];

export const CRM_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "general",
    labelKey: "nav.general",
    icon: LayoutDashboard,
    namespace: "crm",
    items: [
      { labelKey: "nav.dashboard", path: "/crm", icon: LayoutDashboard, end: true, namespace: "crm" },
      { labelKey: "nav.operations", path: "/crm/operations", icon: Activity, namespace: "crm" },
    ],
  },
  {
    id: "deals_leads",
    labelKey: "nav.pipeline_management",
    icon: Handshake,
    namespace: "crm",
    items: [
      { labelKey: "nav.leads", path: "/crm/leads", icon: UserPlus, namespace: "crm" },
      { labelKey: "nav.contacts", path: "/crm/contacts", icon: Users, namespace: "crm" },
      { labelKey: "nav.deals", path: "/crm/deals", icon: Handshake, namespace: "crm" },
      { labelKey: "nav.crmTasks", path: "/crm/tasks", icon: ListTodo, namespace: "crm" },
    ],
  },
  {
    id: "contracts_reports",
    labelKey: "nav.documents_reports",
    icon: FileText,
    namespace: "crm",
    items: [
      { labelKey: "nav.quotations", path: "/crm/quotations", icon: FileText, namespace: "crm" },
      {
        labelKey: "nav.contracts",
        path: "/crm/contracts",
        icon: ScrollText,
        namespace: "crm",
        permission: "crm.manage_contracts",
      },
      { labelKey: "nav.client_reports", path: "/crm/client-reports", icon: ClipboardCheck, namespace: "crm" },
      { labelKey: "nav.reports", path: "/crm/reports", icon: BarChart3, namespace: "crm" },

    ],
  },
];

export const PEOPLE_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "general",
    labelKey: "nav.general",
    icon: LayoutDashboard,
    items: [
      { labelKey: "nav.dashboard", path: "/people", icon: LayoutDashboard, end: true },
    ],
  },
  {
    id: "attendance_leave",
    labelKey: "nav.time_attendance",
    icon: Calendar,
    items: [
      { labelKey: "nav.leave", path: "/people/leave", icon: Calendar },
      { labelKey: "nav.approvals", path: "/people/approvals", icon: CheckSquare },
      { labelKey: "nav.timesheets", path: "/people/timesheets", icon: Timer },
      { labelKey: "nav.daily_reports", path: "/people/daily-reports", icon: ClipboardCheck },
    ],
  },
  {
    id: "schedules_lateness",
    labelKey: "nav.schedules_lateness",
    icon: CalendarClock,
    items: [
      {
        labelKey: "nav.work_schedules",
        path: "/people/schedules",
        icon: CalendarClock,
        permission: "people.view_schedules",
      },
      {
        labelKey: "nav.lateness_policies",
        path: "/people/lateness-policies",
        icon: Activity,
        permission: "people.view_lateness",
      },
      // Unpermissioned on purpose: every user may open their OWN cases (the
      // page self-gates to the privileged full list only for view_lateness).
      { labelKey: "nav.deduction_cases", path: "/people/deduction-cases", icon: ClipboardCheck },
      {
        labelKey: "nav.lateness_report",
        path: "/people/lateness-report",
        icon: BarChart3,
        permission: "people.view_lateness",
      },
    ],
  },
  {
    id: "performance",
    labelKey: "nav.performance_management",
    icon: TrendingUp,
    items: [
      { labelKey: "nav.performance", path: "/people/performance", icon: TrendingUp },
    ],
  },
  {
    id: "team_settings",
    labelKey: "nav.team_and_roles",
    icon: Settings,
    items: [
      {
        labelKey: "nav.team_members",
        path: "/people/team",
        icon: Users,
        permission: "users.manage_roles",
      },
      {
        labelKey: "nav.roles_permissions",
        path: "/people/roles",
        icon: ShieldCheck,
        permission: "users.manage_roles",
      },
      {
        labelKey: "nav.attendance_settings",
        path: "/people/attendance-settings",
        icon: MapPin,
        permission: "people.manage_employees",
      },
      {
        labelKey: "nav.company_settings",
        path: "/people/company-settings",
        icon: Building2,
        permission: "company.manage",
      },
    ],
  },
];

export const BILLING_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "general",
    labelKey: "nav.home",
    icon: LayoutGrid,
    namespace: "billing",
    items: [
      { labelKey: "nav.home", path: "/billing", icon: LayoutGrid, end: true, namespace: "billing" },
      { labelKey: "nav.overview", path: "/billing/overview", icon: LayoutDashboard, namespace: "billing" },
    ],
  },
  {
    id: "sales",
    labelKey: "nav.sales_revenue",
    icon: FileSpreadsheet,
    namespace: "billing",
    items: [
      { labelKey: "nav.invoices", path: "/billing/invoices", icon: FileSpreadsheet, namespace: "billing" },
      { labelKey: "nav.receipt_vouchers", path: "/billing/receipt-vouchers", icon: Banknote, namespace: "billing" },
      { labelKey: "nav.credit_notes", path: "/billing/credit-notes", icon: ScrollText, namespace: "billing" },
    ],
  },
  {
    id: "purchases",
    labelKey: "nav.purchases_expenses",
    icon: ReceiptText,
    namespace: "billing",
    items: [
      { labelKey: "nav.bills", path: "/billing/bills", icon: ReceiptText, namespace: "billing" },
      { labelKey: "nav.payment_vouchers", path: "/billing/payment-vouchers", icon: Wallet, namespace: "billing" },
    ],
  },
  {
    id: "reports_tax",
    labelKey: "nav.reports_tax_centers",
    icon: PieChart,
    namespace: "billing",
    items: [
      { labelKey: "nav.reports", path: "/billing/reports", icon: PieChart, namespace: "billing" },
      { labelKey: "nav.vat_return", path: "/billing/vat-return", icon: FileText, namespace: "billing" },
      { labelKey: "nav.bank_reconciliation", path: "/billing/bank-reconciliation", icon: Landmark, namespace: "billing" },
      { labelKey: "nav.statement_of_account", path: "/billing/statement-of-account", icon: BarChart3, namespace: "billing" },
      { labelKey: "nav.cost_centers", path: "/billing/cost-centers", icon: Layers, namespace: "billing" },
      { labelKey: "nav.zakat", path: "/billing/zakat", icon: HandCoins, namespace: "billing" },
    ],
  },
  {
    id: "chart_accounts",
    labelKey: "nav.chart_products_settings",
    icon: BookCopy,
    namespace: "billing",
    items: [
      { labelKey: "nav.products", path: "/billing/products", icon: Package, namespace: "billing" },
      { labelKey: "nav.fixed_assets", path: "/billing/fixed-assets", icon: HardDrive, namespace: "billing" },
      { labelKey: "nav.fiscal_closing", path: "/billing/fiscal-closing", icon: Lock, namespace: "billing" },
      { labelKey: "nav.journals", path: "/billing/journals", icon: BookA, namespace: "billing" },
      { labelKey: "nav.accounts", path: "/billing/accounts", icon: BookCopy, namespace: "billing" },
      { labelKey: "nav.settings", path: "/billing/settings", icon: Settings, namespace: "billing" },
    ],
  },
];

export const CHAT_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "general",
    labelKey: "nav.messages",
    icon: Inbox,
    namespace: "chat",
    items: [
      { labelKey: "nav.inbox", path: "/chat", icon: Inbox, end: true, namespace: "chat" },
    ],
  },
];

export const PROJECTS_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "projects_general",
    labelKey: "nav.projects_overview",
    icon: FolderKanban,
    namespace: "projects",
    items: [
      {
        labelKey: "nav.all_projects",
        path: "/projects",
        icon: FolderKanban,
        end: true,
        namespace: "projects",
        permission: "projects.view",
      },
      {
        labelKey: "nav.my_projects",
        path: "/projects/mine",
        icon: FolderOpen,
        namespace: "projects",
        permission: "projects.view",
      },
      {
        labelKey: "nav.completed_projects",
        path: "/projects/completed",
        icon: CheckCircle2,
        namespace: "projects",
        permission: "projects.view",
      },
      {
        labelKey: "nav.project_settings",
        path: "/projects/settings",
        icon: Settings,
        namespace: "projects",
        permission: "projects.manage",
      },
    ],
  },
];

export const FACILITIES_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "fm_overview",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    namespace: "facilities",
    items: [
      {
        labelKey: "nav.dashboard",
        path: "/facilities",
        icon: LayoutDashboard,
        end: true,
        namespace: "facilities",
        permission: "facilities.view",
      },
      {
        labelKey: "nav.reports",
        path: "/facilities/reports",
        icon: BarChart3,
        namespace: "facilities",
        permission: "facilities.view",
      },
    ],
  },
  {
    id: "fm_operations",
    labelKey: "nav.operations",
    icon: Wrench,
    namespace: "facilities",
    items: [
      {
        labelKey: "nav.work_orders",
        path: "/facilities/work-orders",
        icon: Wrench,
        namespace: "facilities",
        permission: "facilities.view",
      },
      {
        labelKey: "nav.schedules",
        path: "/facilities/schedules",
        icon: CalendarClock,
        namespace: "facilities",
        permission: "facilities.view",
      },
    ],
  },
  {
    id: "fm_inventory",
    labelKey: "nav.inventory",
    icon: Building,
    namespace: "facilities",
    items: [
      {
        labelKey: "nav.facilities",
        path: "/facilities/facilities",
        icon: Building,
        namespace: "facilities",
        permission: "facilities.view",
      },
      {
        labelKey: "nav.assets",
        path: "/facilities/assets",
        icon: Package,
        namespace: "facilities",
        permission: "facilities.view",
      },
      {
        labelKey: "nav.vendors",
        path: "/facilities/vendors",
        icon: Users,
        namespace: "facilities",
        permission: "facilities.view",
      },
    ],
  },
];

export const AGENCY_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "agency_overview",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    namespace: "marketing",
    items: [
      {
        labelKey: "nav.dashboard",
        path: "/agency",
        icon: LayoutDashboard,
        end: true,
        namespace: "marketing",
        permission: "marketing.view",
      },
      {
        labelKey: "nav.reports",
        path: "/agency/reports",
        icon: BarChart3,
        namespace: "marketing",
        permission: "marketing.view",
      },
    ],
  },
  {
    id: "agency_campaigns",
    labelKey: "nav.campaigns",
    icon: Megaphone,
    namespace: "marketing",
    items: [
      {
        labelKey: "nav.campaigns",
        path: "/agency/campaigns",
        icon: Megaphone,
        namespace: "marketing",
        permission: "marketing.view",
      },
      {
        labelKey: "nav.briefs",
        path: "/agency/briefs",
        icon: FileText,
        namespace: "marketing",
        permission: "marketing.view",
      },
    ],
  },
  {
    id: "agency_delivery",
    labelKey: "nav.delivery",
    icon: Send,
    namespace: "marketing",
    items: [
      {
        labelKey: "nav.deliverables",
        path: "/agency/deliverables",
        icon: Send,
        namespace: "marketing",
        permission: "marketing.view",
      },
      {
        labelKey: "nav.content",
        path: "/agency/content",
        icon: Calendar,
        namespace: "marketing",
        permission: "marketing.view",
      },
    ],
  },
];

export const TASKS_NAV = TASKS_NAV_TREE.flatMap((g) => g.items);
export const CRM_NAV = CRM_NAV_TREE.flatMap((g) => g.items);
export const PEOPLE_NAV = PEOPLE_NAV_TREE.flatMap((g) => g.items);
export const BILLING_NAV = BILLING_NAV_TREE.flatMap((g) => g.items);
export const CHAT_NAV = CHAT_NAV_TREE.flatMap((g) => g.items);
export const PROJECTS_NAV = PROJECTS_NAV_TREE.flatMap((g) => g.items);
export const FACILITIES_NAV = FACILITIES_NAV_TREE.flatMap((g) => g.items);
export const AGENCY_NAV = AGENCY_NAV_TREE.flatMap((g) => g.items);

// REAL_ESTATE_MANAGEMENT nav grows with the shipped pages only — links for
// sections that are not implemented yet stay out of the sidebar so the nav
// never exposes an unfinished or denied route.
export const REAL_ESTATE_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "rem_overview",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    namespace: "real_estate",
    items: [
      {
        labelKey: "nav.dashboard",
        path: "/real-estate",
        icon: LayoutDashboard,
        end: true,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
      {
        labelKey: "nav.reports",
        path: "/real-estate/reports",
        icon: BarChart3,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
    ],
  },
  {
    id: "rem_registry",
    labelKey: "nav.registry",
    icon: Building,
    namespace: "real_estate",
    items: [
      {
        labelKey: "nav.properties",
        path: "/real-estate/properties",
        icon: Building,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
      {
        labelKey: "nav.units",
        path: "/real-estate/units",
        icon: Layers,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
    ],
  },
  {
    id: "rem_leasing",
    labelKey: "nav.leasing",
    icon: ScrollText,
    namespace: "real_estate",
    items: [
      {
        labelKey: "nav.leases",
        path: "/real-estate/leases",
        icon: ScrollText,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
    ],
  },
  {
    id: "rem_finance",
    labelKey: "nav.finance",
    icon: Banknote,
    namespace: "real_estate",
    items: [
      {
        labelKey: "nav.collections",
        path: "/real-estate/collections",
        icon: Banknote,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
      {
        labelKey: "nav.deposits",
        path: "/real-estate/deposits",
        icon: HandCoins,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
    ],
  },
  {
    id: "rem_ops",
    labelKey: "nav.operations",
    icon: Wrench,
    namespace: "real_estate",
    items: [
      {
        labelKey: "nav.expenses",
        path: "/real-estate/expenses",
        icon: Wallet,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
      {
        labelKey: "nav.inspections",
        path: "/real-estate/inspections",
        icon: ClipboardCheck,
        namespace: "real_estate",
        permission: "real_estate.view",
      },
    ],
  },
];

export const REAL_ESTATE_NAV = REAL_ESTATE_NAV_TREE.flatMap((g) => g.items);

// SCHOOL_MANAGEMENT nav: only the v1 workflows that are actually shipped are
// linked. Exams/results, timetables and fee collection have no routes yet, so
// they stay out of the sidebar instead of exposing an unfinished page (the same
// rule the REM tree follows).
export const SCHOOL_NAV_TREE: PortalNavTreeGroup[] = [
  {
    id: "school_overview",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    namespace: "school",
    items: [
      {
        labelKey: "nav.dashboard",
        path: "/school",
        icon: LayoutDashboard,
        end: true,
        namespace: "school",
        permission: "school.view",
      },
    ],
  },
  {
    id: "school_academic",
    labelKey: "nav.academic_setup",
    icon: CalendarClock,
    namespace: "school",
    items: [
      {
        labelKey: "nav.academic_years",
        path: "/school/academic-years",
        icon: CalendarClock,
        namespace: "school",
        permission: "school.view",
      },
      {
        labelKey: "nav.terms",
        path: "/school/terms",
        icon: Calendar,
        namespace: "school",
        permission: "school.view",
      },
      {
        labelKey: "nav.grades",
        path: "/school/grades",
        icon: Layers,
        namespace: "school",
        permission: "school.view",
      },
      {
        labelKey: "nav.sections",
        path: "/school/sections",
        icon: FolderOpen,
        namespace: "school",
        permission: "school.view",
      },
      {
        labelKey: "nav.subjects",
        path: "/school/subjects",
        icon: BookA,
        namespace: "school",
        permission: "school.view",
      },
    ],
  },
  {
    id: "school_roster",
    labelKey: "nav.roster",
    icon: Users,
    namespace: "school",
    items: [
      {
        labelKey: "nav.guardians",
        path: "/school/guardians",
        icon: UserRound,
        namespace: "school",
        permission: "school.view",
      },
      {
        labelKey: "nav.students",
        path: "/school/students",
        icon: GraduationCap,
        namespace: "school",
        permission: "school.view",
      },
    ],
  },
  {
    id: "school_daily",
    labelKey: "nav.daily_operations",
    icon: ClipboardCheck,
    namespace: "school",
    items: [
      {
        labelKey: "nav.attendance",
        path: "/school/attendance",
        icon: ClipboardCheck,
        namespace: "school",
        permission: "school.view",
      },
    ],
  },
];

export const SCHOOL_NAV = SCHOOL_NAV_TREE.flatMap((g) => g.items);

export function getNavForPortal(portal: PortalId): PortalNavItem[] {
  switch (portal) {
    case "tasks":
      return TASKS_NAV;
    case "crm":
      return CRM_NAV;
    case "people":
      return PEOPLE_NAV;
    case "billing":
      return BILLING_NAV;
    case "chat":
      return CHAT_NAV;
    case "projects":
      return PROJECTS_NAV;
    case "facilities":
      return FACILITIES_NAV;
    case "agency":
      return AGENCY_NAV;
    case "real_estate":
      return REAL_ESTATE_NAV;
    case "school":
      return SCHOOL_NAV;
    default:
      return [];
  }
}

export function getNavTreeForPortal(portal: PortalId): PortalNavTreeGroup[] {
  switch (portal) {
    case "tasks":
      return TASKS_NAV_TREE;
    case "crm":
      return CRM_NAV_TREE;
    case "people":
      return PEOPLE_NAV_TREE;
    case "billing":
      return BILLING_NAV_TREE;
    case "chat":
      return CHAT_NAV_TREE;
    case "projects":
      return PROJECTS_NAV_TREE;
    case "facilities":
      return FACILITIES_NAV_TREE;
    case "agency":
      return AGENCY_NAV_TREE;
    case "real_estate":
      return REAL_ESTATE_NAV_TREE;
    case "school":
      return SCHOOL_NAV_TREE;
    default:
      return [];
  }
}
