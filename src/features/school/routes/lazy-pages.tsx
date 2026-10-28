/**
 * Route-level lazy bindings for the SCHOOL_MANAGEMENT activity domain pages.
 *
 * Kept in a components-only module so router.tsx stays a pure configuration
 * file (Fast Refresh friendly) and the school bundle is never shipped to
 * tenants on a different activity.
 */

import { lazy } from "react";

export const SchoolLayout = lazy(() =>
  import("../components/SchoolLayout").then((m) => ({ default: m.SchoolLayout })),
);

export const SchoolDashboardPage = lazy(() =>
  import("../pages/SchoolDashboardPage").then((m) => ({ default: m.SchoolDashboardPage })),
);

export const AcademicYearsPage = lazy(() =>
  import("../pages/AcademicYearsPage").then((m) => ({ default: m.AcademicYearsPage })),
);

export const TermsPage = lazy(() =>
  import("../pages/TermsPage").then((m) => ({ default: m.TermsPage })),
);

export const GradesPage = lazy(() =>
  import("../pages/GradesPage").then((m) => ({ default: m.GradesPage })),
);

export const SectionsPage = lazy(() =>
  import("../pages/SectionsPage").then((m) => ({ default: m.SectionsPage })),
);

export const SubjectsPage = lazy(() =>
  import("../pages/SubjectsPage").then((m) => ({ default: m.SubjectsPage })),
);

export const GuardiansPage = lazy(() =>
  import("../pages/GuardiansPage").then((m) => ({ default: m.GuardiansPage })),
);

export const StudentsPage = lazy(() =>
  import("../pages/StudentsPage").then((m) => ({ default: m.StudentsPage })),
);

export const AttendancePage = lazy(() =>
  import("../pages/AttendancePage").then((m) => ({ default: m.AttendancePage })),
);
