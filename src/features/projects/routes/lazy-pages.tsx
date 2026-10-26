/**
 * Route-level lazy bindings for the PROJECTS activity domain pages.
 *
 * The projects module is the PROJECTS activity's dedicated pages: they are
 * the only components loaded for that namespace, so they lazy-load at route
 * level and never enter the initial bundle of a tenant running a different
 * activity. Kept in a components-only module so router.tsx stays a pure
 * configuration file (Fast Refresh friendly).
 */

import { lazy } from "react";

export const ProjectsLayout = lazy(() =>
  import("../components/ProjectsLayout").then((m) => ({ default: m.ProjectsLayout })),
);

export const ProjectsListPage = lazy(() =>
  import("../pages/ProjectsListPage").then((m) => ({ default: m.ProjectsListPage })),
);

export const ProjectDetailPage = lazy(() =>
  import("../pages/ProjectDetailPage").then((m) => ({ default: m.ProjectDetailPage })),
);

export const ProjectSettingsPage = lazy(() =>
  import("../pages/ProjectSettingsPage").then((m) => ({ default: m.ProjectSettingsPage })),
);
