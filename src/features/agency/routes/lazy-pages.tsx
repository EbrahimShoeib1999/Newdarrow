/**
 * Route-level lazy bindings for the MARKETING_AGENCY activity domain pages.
 *
 * Same contract as the facilities module: these components only ever load for
 * tenants whose active activity is MARKETING_AGENCY, so they stay out of every
 * other tenant's initial bundle. Kept in a components-only module so
 * router.tsx remains pure configuration (Fast Refresh friendly).
 */

import { lazy } from "react";

export const AgencyLayout = lazy(() =>
  import("../components/AgencyLayout").then((m) => ({ default: m.AgencyLayout })),
);

export const AgencyDashboardPage = lazy(() =>
  import("../pages/AgencyDashboardPage").then((m) => ({ default: m.AgencyDashboardPage })),
);

export const CampaignsListPage = lazy(() =>
  import("../pages/CampaignsListPage").then((m) => ({ default: m.CampaignsListPage })),
);

export const CampaignDetailPage = lazy(() =>
  import("../pages/CampaignDetailPage").then((m) => ({ default: m.CampaignDetailPage })),
);

export const DeliverablesListPage = lazy(() =>
  import("../pages/DeliverablesListPage").then((m) => ({ default: m.DeliverablesListPage })),
);

export const ContentCalendarPage = lazy(() =>
  import("../pages/ContentCalendarPage").then((m) => ({ default: m.ContentCalendarPage })),
);

export const BriefsPage = lazy(() =>
  import("../pages/BriefsPage").then((m) => ({ default: m.BriefsPage })),
);

export const AgencyReportsPage = lazy(() =>
  import("../pages/ReportsPage").then((m) => ({ default: m.AgencyReportsPage })),
);
