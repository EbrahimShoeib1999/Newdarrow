import { Suspense } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";

function DArrowRedirect() {
  const location = useLocation();
  const target = location.pathname.replace(/^\/darrow/, "") || "/";
  return <Navigate to={`${target}${location.search}${location.hash}`} replace />;
}
import { LoginPage } from "@/features/auth/pages/login-page";
import { RegisterPage } from "@/features/auth/pages/register-page";
import { ProfilePage } from "@/features/auth/pages/profile-page";
import { ForgotPasswordPage } from "@/features/auth/pages/forgot-password-page";
import { ResetPasswordPage } from "@/features/auth/pages/reset-password-page";
import { AcceptInvitePage } from "@/features/auth/pages/accept-invite-page";
import { ProtectedRoute } from "@/features/auth/components/protected-route";
import PublicInvoicePdfPage from "@/features/billing/pages/PublicInvoicePdfPage";
import PublicClientReportPage from "@/features/crm/pages/PublicClientReportPage";
import { AppLayout } from "@/components/layout/app-layout";
import { ActivityRouteGuard } from "@/features/activities/components/activity-route-guard";
import { ACTIVITY_ID_LIST } from "@/features/activities/types/activity.types";
import { TasksLayout } from "@/features/tasks/components/TasksLayout";
import { TasksDashboardPage } from "@/features/tasks/pages/tasks-dashboard-page";
import { TasksWorkspacePage } from "@/features/tasks/pages/tasks-workspace-page";
import { TaskCreatePage } from "@/features/tasks/pages/task-create-page";
import { TaskDetailPage } from "@/features/tasks/pages/task-detail-page";
import { SprintsPage } from "@/features/tasks/pages/sprints-page";
import { MeetingsPage } from "@/features/meetings/pages/MeetingsPage";
import { CrmLayout } from "@/features/crm/components/CrmLayout";
import { CrmDashboardPage } from "@/features/crm/pages/CrmDashboardPage";
import { LeadsListPage } from "@/features/crm/pages/LeadsListPage";
import { LeadDetailPage } from "@/features/crm/pages/LeadDetailPage";
import { ContactsListPage } from "@/features/crm/pages/ContactsListPage";
import { ContactDetailPage } from "@/features/crm/pages/ContactDetailPage";
import { DealsPipelinePage } from "@/features/crm/pages/DealsPipelinePage";
import { DealDetailPage } from "@/features/crm/pages/DealDetailPage";
import { CrmTasksPage } from "@/features/crm/pages/CrmTasksPage";
import { CrmReportsPage } from "@/features/crm/pages/CrmReportsPage";
import { ClientReportsPage } from "@/features/crm/pages/ClientReportsPage";
import { QuotationPage } from "@/features/crm/pages/QuotationPage";
import { CustomerOperationsDashboard } from "@/features/crm/pages/CustomerOperationsDashboard";

import { ContractPage } from "@/features/crm/pages/ContractPage";
import { PeopleLayout } from "@/features/people/components/PeopleLayout";
import { SeedPage } from "@/features/admin/pages/SeedPage";
import PeopleDashboardPage from "@/features/people/pages/PeopleDashboardPage";
import LeaveTrackerPage from "@/features/people/pages/LeaveTrackerPage";
import EmployeeProfilePage from "@/features/people/pages/EmployeeProfilePage";
import { ApprovalsPage } from "@/features/people/pages/ApprovalsPage";
import PerformancePage from "@/features/people/pages/PerformancePage";
import AttendanceSettingsPage from "@/features/people/pages/AttendanceSettingsPage";
import HrSettingsHubPage from "@/features/people/pages/HrSettingsHubPage";
import TimesheetsPage from "@/features/people/pages/TimesheetsPage";
import DailyReportsPage from "@/features/people/pages/DailyReportsPage";
import TaskDailyReportsPage from "@/features/tasks/pages/TaskDailyReportsPage";
import NotificationsPage from "@/features/notifications/pages/NotificationsPage";
import { SettingsLayout } from "@/features/companies/components/SettingsLayout";
import { CompanySettingsPage } from "@/features/companies/pages/CompanySettingsPage";
import { PricingPage } from "@/features/companies/pages/PricingPage";
import { RolesPermissionsPage } from "@/features/companies/pages/RolesPermissionsPage";
import { TeamMembersPage } from "@/features/companies/pages/TeamMembersPage";
import { NotFoundPage } from "@/components/shared/not-found-page";
import { ErrorPage } from "@/components/shared/error-page";
import { HomePage } from "@/features/marketing/pages/home-page";
import { PortalPickerPage } from "@/features/portals/pages/PortalPickerPage";
// The PROJECTS activity domain pages load lazily at route level (see the
// lazy-pages module) so they never ship to tenants on another activity.
import {
  ProjectsLayout,
  ProjectsListPage,
  ProjectDetailPage,
  ProjectSettingsPage,
} from "@/features/projects/routes/lazy-pages";
// The FACILITIES_MANAGEMENT activity domain pages load lazily the same way.
import {
  FacilitiesLayout,
  FacilitiesDashboardPage,
  FacilitiesListPage,
  FacilityDetailPage,
  AssetsListPage,
  AssetDetailPage,
  WorkOrdersListPage,
  WorkOrderDetailPage,
  SchedulesPage,
  VendorsPage,
  ReportsPage as FacilitiesReportsPage,
} from "@/features/facilities/routes/lazy-pages";
// The MARKETING_AGENCY activity domain pages load lazily the same way.
import {
  AgencyLayout,
  AgencyDashboardPage,
  CampaignsListPage,
  CampaignDetailPage,
  DeliverablesListPage,
  ContentCalendarPage,
  BriefsPage,
  AgencyReportsPage,
} from "@/features/agency/routes/lazy-pages";

/** Route-level Suspense fallback — a loader, never protected content. */
function routeSuspense(node: React.ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center" role="status">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

/**
 * Reserved route namespaces for activities whose domain pages have not
 * shipped yet. They are generated from the activity registry, so a new
 * domain module automatically claims (and gates) its prefix at login time —
 * direct URLs land on the guard, never on the 404 or an unrelated module.
 */
const RESERVED_DOMAIN_ROUTES = ACTIVITY_ID_LIST.filter((m) => !m.moduleLive).map((m) => ({
  path: `${m.routeBase.replace(/^\//, "")}/*`,
  element: <ActivityRouteGuard />,
}));

// Billing Imports
import { BillingLayout } from "@/features/billing/components/BillingLayout";
import AccountingLandingPage from "@/features/billing/pages/AccountingLandingPage";
import BillingDashboardPage from "@/features/billing/pages/BillingDashboardPage";
import SettingsPage from "@/features/billing/pages/SettingsPage";
import ProductsPage from "@/features/billing/pages/ProductsPage";
import ChartOfAccountsPage from "@/features/billing/pages/ChartOfAccountsPage";
import ManualJournalsPage from "@/features/billing/pages/ManualJournalsPage";
import InvoicesPage from "@/features/billing/pages/InvoicesPage";
import CreateInvoicePage from "@/features/billing/pages/CreateInvoicePage";
import InvoiceDetailPage from "@/features/billing/pages/InvoiceDetailPage";
import BillsPage from "@/features/billing/pages/BillsPage";
import CreateBillPage from "@/features/billing/pages/CreateBillPage";
import BillDetailPage from "@/features/billing/pages/BillDetailPage";
import VouchersPage from "@/features/billing/pages/VouchersPage";
import CreateVoucherPage from "@/features/billing/pages/CreateVoucherPage";
import VoucherDetailPage from "@/features/billing/pages/VoucherDetailPage";
import ReportsPage from "@/features/billing/pages/ReportsPage";
import ZakatPage from "@/features/billing/pages/ZakatPage";
import CostCentersPage from "@/features/billing/pages/CostCentersPage";
import VatReturnPage from "@/features/billing/pages/VatReturnPage";
import CreditNotesPage from "@/features/billing/pages/CreditNotesPage";
import StatementOfAccountPage from "@/features/billing/pages/StatementOfAccountPage";
import BankReconciliationPage from "@/features/billing/pages/BankReconciliationPage";
import FixedAssetsPage from "@/features/billing/pages/FixedAssetsPage";
import FiscalClosingPage from "@/features/billing/pages/FiscalClosingPage";
import { ChatLayout } from "@/features/chat/components/ChatLayout";
import { ChatPage } from "@/features/chat/pages/ChatPage";

export const router = createBrowserRouter([
  {
    path: "/",
    errorElement: <ErrorPage />,
    children: [
      {
        path: "login",
        element: <LoginPage />,
      },
      {
        path: "register",
        element: <RegisterPage />,
      },
      {
        path: "forgot-password",
        element: <ForgotPasswordPage />,
      },
      {
        path: "reset-password",
        element: <ResetPasswordPage />,
      },
      {
        path: "invite/:token",
        element: <AcceptInvitePage />,
      },
      {
        path: "i/:token",
        element: <PublicInvoicePdfPage />,
      },
      {
        path: "public/report/:companyId/:reportId",
        element: <PublicClientReportPage />,
      },
      {
        path: "darrow/*",
        element: <DArrowRedirect />,
      },
      {
        index: true,
        element: <HomePage />,
      },
      {
        element: (
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        ),
        children: [
          {
            path: "apps",
            element: <PortalPickerPage forceChoose />,
          },
          {
            path: "tasks",
            element: <TasksLayout />,
            children: [
              { index: true, element: <TasksDashboardPage /> },
              { path: "work", element: <TasksWorkspacePage /> },
              { path: "work/list", element: <TasksWorkspacePage /> },
              { path: "work/board", element: <Navigate to="/tasks/work" replace /> },
              { path: "list", element: <Navigate to="/tasks/work/list" replace /> },
              { path: "board", element: <Navigate to="/tasks/work" replace /> },
              { path: "sprints", element: <SprintsPage /> },
              { path: "daily-reports", element: <TaskDailyReportsPage /> },
              { path: "meetings", element: <Navigate to="/meetings" replace /> },
              { path: "new", element: <TaskCreatePage /> },
              { path: ":taskId", element: <TaskDetailPage /> },
            ],
          },
          {
            path: "tasks/dashboard",
            element: <Navigate to="/tasks" replace />,
          },
          {
            path: "crm",
            element: <CrmLayout />,
            children: [
              { index: true, element: <CrmDashboardPage /> },
              { path: "leads", element: <LeadsListPage /> },
              { path: "leads/:leadId", element: <LeadDetailPage /> },
              { path: "contacts", element: <ContactsListPage /> },
              { path: "contacts/:contactId", element: <ContactDetailPage /> },
              { path: "deals", element: <DealsPipelinePage /> },
              { path: "deals/:dealId", element: <DealDetailPage /> },
              { path: "tasks", element: <CrmTasksPage /> },
              { path: "quotations", element: <QuotationPage /> },
              { path: "contracts", element: <ContractPage /> },
              { path: "reports", element: <CrmReportsPage /> },
              { path: "client-reports", element: <ClientReportsPage /> },
              { path: "operations", element: <CustomerOperationsDashboard /> },

            ],
          },
          {
            path: "people",
            element: <PeopleLayout />,
            children: [
              { index: true, element: <PeopleDashboardPage /> },
              { path: "leave", element: <LeaveTrackerPage /> },
              { path: "approvals", element: <ApprovalsPage /> },
              { path: "performance", element: <PerformancePage /> },
              { path: "timesheets", element: <TimesheetsPage /> },
              { path: "daily-reports", element: <DailyReportsPage /> },
              { path: "attendance-settings", element: <AttendanceSettingsPage /> },
              { path: "team", element: <TeamMembersPage /> },
              { path: "roles", element: <RolesPermissionsPage /> },
              { path: "company-settings", element: <CompanySettingsPage /> },
              { path: "settings", element: <HrSettingsHubPage /> },
              { path: ":id", element: <EmployeeProfilePage /> },
            ],
          },
          {
            path: "settings",
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/company" replace /> },
              { path: "company", element: <CompanySettingsPage /> },
              { path: "pricing", element: <PricingPage /> },
              { path: "team", element: <TeamMembersPage /> },
              { path: "roles", element: <RolesPermissionsPage /> },
            ],
          },
          {
            path: "billing",
            element: <BillingLayout />,
            children: [
              { index: true, element: <AccountingLandingPage /> },
              { path: "overview", element: <BillingDashboardPage /> },
              { path: "reports", element: <ReportsPage /> },
              { path: "invoices", element: <InvoicesPage /> },
              { path: "invoices/new", element: <CreateInvoicePage /> },
              { path: "invoices/:id/edit", element: <CreateInvoicePage /> },
              { path: "invoices/:id", element: <InvoiceDetailPage /> },
              { path: "receipt-vouchers", element: <VouchersPage type="receipt" /> },
              { path: "receipt-vouchers/new", element: <CreateVoucherPage type="receipt" /> },
              { path: "receipt-vouchers/:id", element: <VoucherDetailPage type="receipt" /> },
              { path: "bills", element: <BillsPage /> },
              { path: "bills/new", element: <CreateBillPage /> },
              { path: "bills/:id/edit", element: <CreateBillPage /> },
              { path: "bills/:id", element: <BillDetailPage /> },
              { path: "payment-vouchers", element: <VouchersPage type="disbursement" /> },
              { path: "payment-vouchers/new", element: <CreateVoucherPage type="disbursement" /> },
              { path: "payment-vouchers/:id", element: <VoucherDetailPage type="disbursement" /> },
              { path: "accounts", element: <ChartOfAccountsPage /> },
              { path: "journals", element: <ManualJournalsPage /> },
              { path: "zakat", element: <ZakatPage /> },
              { path: "vat-return", element: <VatReturnPage /> },
              { path: "cost-centers", element: <CostCentersPage /> },
              { path: "credit-notes", element: <CreditNotesPage /> },
              { path: "statement-of-account", element: <StatementOfAccountPage /> },
              { path: "bank-reconciliation", element: <BankReconciliationPage /> },
              { path: "fixed-assets", element: <FixedAssetsPage /> },
              { path: "fiscal-closing", element: <FiscalClosingPage /> },
              { path: "products", element: <ProductsPage /> },
              { path: "settings", element: <SettingsPage /> },
            ],
          },
          {
            path: "chat",
            element: <ChatLayout />,
            children: [
              { index: true, element: <ChatPage /> },
              { path: ":conversationId", element: <ChatPage /> },
            ],
          },
          {
            path: "projects",
            // Activity-aware mount: the guard renders a loader until the
            // tenant's activity configuration resolves, denies the module
            // outright when PROJECTS is not the active activity, and only
            // then renders the (lazy) projects pages.
            element: (
              <ActivityRouteGuard>
                {routeSuspense(<ProjectsLayout />)}
              </ActivityRouteGuard>
            ),
            children: [
              { index: true, element: routeSuspense(<ProjectsListPage scope="all" />) },
              { path: "mine", element: routeSuspense(<ProjectsListPage scope="mine" />) },
              { path: "completed", element: routeSuspense(<ProjectsListPage scope="completed" />) },
              // Stable route ids — the configured display name never changes them.
              { path: "settings", element: routeSuspense(<ProjectSettingsPage />) },
              { path: ":projectId", element: routeSuspense(<ProjectDetailPage />) },
            ],
          },
          {
            path: "facilities",
            // Activity-aware mount (same contract as projects): the guard
            // denies the namespace when FACILITIES_MANAGEMENT is not the
            // tenant's active activity, then renders the lazy facilities pages.
            element: (
              <ActivityRouteGuard>
                {routeSuspense(<FacilitiesLayout />)}
              </ActivityRouteGuard>
            ),
            children: [
              { index: true, element: routeSuspense(<FacilitiesDashboardPage />) },
              { path: "reports", element: routeSuspense(<FacilitiesReportsPage />) },
              { path: "work-orders", element: routeSuspense(<WorkOrdersListPage />) },
              { path: "work-orders/:id", element: routeSuspense(<WorkOrderDetailPage />) },
              { path: "schedules", element: routeSuspense(<SchedulesPage />) },
              { path: "facilities", element: routeSuspense(<FacilitiesListPage />) },
              { path: "facilities/:id", element: routeSuspense(<FacilityDetailPage />) },
              { path: "assets", element: routeSuspense(<AssetsListPage />) },
              { path: "assets/:id", element: routeSuspense(<AssetDetailPage />) },
              { path: "vendors", element: routeSuspense(<VendorsPage />) },
            ],
          },
          {
            path: "agency",
            // Activity-aware mount (same contract as facilities): the guard
            // denies the namespace when MARKETING_AGENCY is not the tenant's
            // active activity, then renders the lazy marketing pages.
            element: (
              <ActivityRouteGuard>
                {routeSuspense(<AgencyLayout />)}
              </ActivityRouteGuard>
            ),
            children: [
              { index: true, element: routeSuspense(<AgencyDashboardPage />) },
              { path: "reports", element: routeSuspense(<AgencyReportsPage />) },
              { path: "campaigns", element: routeSuspense(<CampaignsListPage />) },
              { path: "campaigns/:id", element: routeSuspense(<CampaignDetailPage />) },
              { path: "deliverables", element: routeSuspense(<DeliverablesListPage />) },
              { path: "content", element: routeSuspense(<ContentCalendarPage />) },
              { path: "briefs", element: routeSuspense(<BriefsPage />) },
            ],
          },
          // Inactive-activity namespaces (registry-generated).
          ...RESERVED_DOMAIN_ROUTES,
          {
            // Meetings are open to every signed-in user, so they sit outside
            // the portal guards.
            path: "meetings",
            element: <MeetingsPage />,
          },
          {
            path: "seed",
            element: <SeedPage />,
          },
          {
            path: "profile",
            element: <ProfilePage />,
          },
          {
            path: "notifications",
            element: <NotificationsPage />,
          },
          {
            path: "*",
            element: <NotFoundPage />,
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
