/**
 * Route-level lazy bindings for the REAL_ESTATE_MANAGEMENT activity domain pages.
 *
 * The REM module is the real-estate activity's dedicated pages: they
 * lazy-load at route level and never enter the initial bundle of a tenant
 * running a different activity. Kept in a components-only module so
 * router.tsx stays a pure configuration file (Fast Refresh friendly).
 */

import { lazy } from "react";

export const RealEstateLayout = lazy(() =>
  import("../components/RealEstateLayout").then((m) => ({ default: m.RealEstateLayout })),
);

export const RemDashboardPage = lazy(() =>
  import("../pages/RemDashboardPage").then((m) => ({ default: m.RemDashboardPage })),
);

export const RemReportsPage = lazy(() =>
  import("../pages/RemReportsPage").then((m) => ({ default: m.RemReportsPage })),
);

export const PropertiesListPage = lazy(() =>
  import("../pages/PropertiesListPage").then((m) => ({ default: m.PropertiesListPage })),
);

export const PropertyDetailPage = lazy(() =>
  import("../pages/PropertyDetailPage").then((m) => ({ default: m.PropertyDetailPage })),
);

export const UnitsListPage = lazy(() =>
  import("../pages/UnitsListPage").then((m) => ({ default: m.UnitsListPage })),
);

export const UnitDetailPage = lazy(() =>
  import("../pages/UnitDetailPage").then((m) => ({ default: m.UnitDetailPage })),
);

export const LeasesListPage = lazy(() =>
  import("../pages/LeasesListPage").then((m) => ({ default: m.LeasesListPage })),
);

export const LeaseDetailPage = lazy(() =>
  import("../pages/LeaseDetailPage").then((m) => ({ default: m.LeaseDetailPage })),
);

export const RentCollectionsPage = lazy(() =>
  import("../pages/RentCollectionsPage").then((m) => ({ default: m.RentCollectionsPage })),
);

export const DepositsListPage = lazy(() =>
  import("../pages/DepositsListPage").then((m) => ({ default: m.DepositsListPage })),
);

export const ExpensesListPage = lazy(() =>
  import("../pages/ExpensesListPage").then((m) => ({ default: m.ExpensesListPage })),
);

export const InspectionsListPage = lazy(() =>
  import("../pages/InspectionsListPage").then((m) => ({ default: m.InspectionsListPage })),
);
