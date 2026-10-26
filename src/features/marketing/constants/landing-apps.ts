import {
  ListTodo,
  Handshake,
  Users,
  CreditCard,
  FileText,
  BarChart3,
  Settings,
  FolderKanban,
  Building2,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import type { PortalId } from "@/lib/portal-permissions";

export type LandingApp = {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  gradient: string;
  /**
   * Real route the tile navigates to — no placeholder links. Must stay a
   * mounted route (see app/router.tsx): every destination here is covered by
   * the activity route registry tests.
   */
  path: string;
  /** Portal whose access (role permissions AND active activity) gates the tile. */
  portal?: PortalId;
};

export const LANDING_APPS: LandingApp[] = [
  {
    id: "tasks",
    labelKey: "modules.tasks",
    icon: ListTodo,
    gradient: "from-violet-500 to-indigo-600",
    path: "/tasks",
    portal: "tasks",
  },
  {
    id: "crm",
    labelKey: "modules.crm",
    icon: Handshake,
    gradient: "from-emerald-500 to-teal-600",
    path: "/crm",
    portal: "crm",
  },
  {
    id: "people",
    labelKey: "modules.people",
    icon: Users,
    gradient: "from-orange-500 to-amber-600",
    path: "/people",
    portal: "people",
  },
  {
    id: "billing",
    labelKey: "modules.billing",
    icon: CreditCard,
    gradient: "from-fuchsia-500 to-purple-600",
    path: "/billing",
    portal: "billing",
  },
  {
    id: "invoices",
    labelKey: "modules.invoices",
    icon: FileText,
    gradient: "from-sky-500 to-blue-600",
    path: "/billing/invoices",
    portal: "billing",
  },
  {
    id: "reports",
    labelKey: "modules.reports",
    icon: BarChart3,
    gradient: "from-rose-500 to-pink-600",
    path: "/billing/reports",
    portal: "billing",
  },
  {
    // Activity-owned app: only opens while the PROJECTS activity is active;
    // otherwise the tile is inert and the route itself is guarded.
    id: "projects",
    labelKey: "modules.projects",
    icon: FolderKanban,
    gradient: "from-blue-500 to-indigo-600",
    path: "/projects",
    portal: "projects",
  },
  {
    // Activity-owned app: only opens while the FACILITIES_MANAGEMENT activity
    // is active; otherwise the tile is inert and the route is guarded.
    id: "facilities",
    labelKey: "modules.facilities",
    icon: Building2,
    gradient: "from-cyan-500 to-teal-600",
    path: "/facilities",
    portal: "facilities",
  },
  {
    // Activity-owned app: only opens while the MARKETING_AGENCY activity
    // is active; otherwise the tile is inert and the route is guarded.
    id: "agency",
    labelKey: "modules.agency",
    icon: Megaphone,
    gradient: "from-pink-500 to-rose-600",
    path: "/agency",
    portal: "agency",
  },
  {
    id: "settings",
    labelKey: "modules.settings",
    icon: Settings,
    gradient: "from-slate-500 to-zinc-600",
    path: "/settings/company",
  },
];
