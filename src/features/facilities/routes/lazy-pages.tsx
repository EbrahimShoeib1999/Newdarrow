/**
 * Route-level lazy bindings for the FACILITIES_MANAGEMENT activity domain pages.
 *
 * The facilities module is the FACILITIES_MANAGEMENT activity's dedicated
 * pages: they are the only components loaded for that namespace, so they
 * lazy-load at route level and never enter the initial bundle of a tenant
 * running a different activity. Kept in a components-only module so
 * router.tsx stays a pure configuration file (Fast Refresh friendly).
 */

import { lazy } from "react";

export const FacilitiesLayout = lazy(() =>
  import("../components/FacilitiesLayout").then((m) => ({ default: m.FacilitiesLayout })),
);

export const FacilitiesDashboardPage = lazy(() =>
  import("../pages/FacilitiesDashboardPage").then((m) => ({ default: m.FacilitiesDashboardPage })),
);

export const FacilitiesListPage = lazy(() =>
  import("../pages/FacilitiesListPage").then((m) => ({ default: m.FacilitiesListPage })),
);

export const FacilityDetailPage = lazy(() =>
  import("../pages/FacilityDetailPage").then((m) => ({ default: m.FacilityDetailPage })),
);

export const AssetsListPage = lazy(() =>
  import("../pages/AssetsListPage").then((m) => ({ default: m.AssetsListPage })),
);

export const AssetDetailPage = lazy(() =>
  import("../pages/AssetDetailPage").then((m) => ({ default: m.AssetDetailPage })),
);

export const WorkOrdersListPage = lazy(() =>
  import("../pages/WorkOrdersListPage").then((m) => ({ default: m.WorkOrdersListPage })),
);

export const WorkOrderDetailPage = lazy(() =>
  import("../pages/WorkOrderDetailPage").then((m) => ({ default: m.WorkOrderDetailPage })),
);

export const SchedulesPage = lazy(() =>
  import("../pages/SchedulesPage").then((m) => ({ default: m.SchedulesPage })),
);

export const VendorsPage = lazy(() =>
  import("../pages/VendorsPage").then((m) => ({ default: m.VendorsPage })),
);

export const ReportsPage = lazy(() =>
  import("../pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
