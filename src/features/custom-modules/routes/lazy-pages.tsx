/**
 * Route-level lazy bindings for the Custom Business Modules Engine pages.
 *
 * The engine is a shared surface (present for every activity), but its screens
 * are still code-split out of the initial bundle: a tenant that never opens
 * `/modules` never downloads the configuration editor. Kept in a components-only
 * module so router.tsx stays pure configuration (Fast Refresh friendly).
 */

import { lazy } from "react";

export const ModulesLayout = lazy(() =>
  import("../components/ModulesLayout").then((m) => ({ default: m.ModulesLayout })),
);

export const ModulesWorkspacePage = lazy(() =>
  import("../pages/ModulesWorkspacePage").then((m) => ({ default: m.ModulesWorkspacePage })),
);

export const ModuleRecordsListPage = lazy(() =>
  import("../pages/ModuleRecordsListPage").then((m) => ({ default: m.ModuleRecordsListPage })),
);

export const ModuleRecordDetailPage = lazy(() =>
  import("../pages/ModuleRecordDetailPage").then((m) => ({ default: m.ModuleRecordDetailPage })),
);

export const ModuleRecordFormPage = lazy(() =>
  import("../pages/ModuleRecordFormPage").then((m) => ({ default: m.ModuleRecordFormPage })),
);

export const ModuleConfigListPage = lazy(() =>
  import("../pages/ModuleConfigListPage").then((m) => ({ default: m.ModuleConfigListPage })),
);

export const ModuleConfigEditorPage = lazy(() =>
  import("../pages/ModuleConfigEditorPage").then((m) => ({ default: m.ModuleConfigEditorPage })),
);
