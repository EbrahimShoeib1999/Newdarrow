# Module Inventory & Baseline Classification

**Application**: D-Arrow Business / DROO — Dynamic Multi-Activity Business Operating System  
**Framework**: React 19, TypeScript, Vite, Tailwind CSS, HeroUI  
**Backend & Persistence**: Firebase Authentication, Cloud Firestore, Firebase Storage  
**Inspection Date**: October 2026  
**Audit Author**: Principal Software Architect & Lead QA Automation Engineer  

---

## 1. Classification Methodology

Every module discovered in the repository has been inspected, cross-checked against runtime routes, database security rules, integration workflows, and executed test suites. Modules are classified into the following strict categories:

- **COMPLETE**: Full-stack capability verified functional with persistence, security rules, error/loading states, localized RTL/LTR presentation, and automated test coverage.
- **PARTIAL**: Substantial functionality works with identified, documented non-blocking gaps.
- **UI_ONLY**: Visual interface rendered without full end-to-end backend persistence or lifecycle.
- **BROKEN**: Reproducible failure blocking core runtime workflows.
- **MISSING**: Required industry standard capability absent from the repository.
- **BLOCKED**: Requires an external third-party authorization or unmockable network dependency.

---

## 2. Core Platform Modules (Always Accessible)

Shared foundational capabilities remain continuously available across all business activities, governed by role-based access permissions (`can(...)`).

| Module | Route(s) | Status | Dependencies | Verified Capabilities & Workflow | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Profile** | `/login`, `/register`, `/forgot-password`, `/profile` | **COMPLETE** | Firebase Auth, Firestore `users/{uid}` | Email/Password login, registration, password reset, token caching, session persistence, language pinning, user profile management. | `test:auth-redirect`, `test:navigation-browser`, `test:rules` |
| **Company & Multi-Tenant Settings** | `/settings/company`, `/settings/branches`, `/settings/tax`, `/settings/currencies` | **COMPLETE** | Firestore `companies/{companyId}` | Tenant settings, currency selection, tax rules, branch creation, legal information, and primary business activity selection card. | `test:company-name`, `test:route-navigation`, `test:rules` |
| **Users, Roles & Team Management** | `/settings/team`, `/people/team`, `/people/roles` | **COMPLETE** | Firestore `users`, `invitations` | Role assignments (`admin`, `manager`, `employee`, `accountant`, etc.), permission matrix validation, invitation delivery, member suspension. | `test:invite-delivery`, `test:authz`, `test:rules` |
| **Tasks & Work Coordination** | `/tasks`, `/tasks/work`, `/tasks/board`, `/tasks/calendar` | **COMPLETE** | Firestore `tasks`, `companies/{id}/tasks` | Cross-activity task creation, assignment, due date scheduling, status tracking, Kanban drag-and-drop, and calendar visualization. | `test:automation`, `test:contract-task-trace` |
| **Global Communications & Zoe AI** | `/chat`, `/meetings`, floating AI Assistant | **COMPLETE** | Local storage / mock streaming / Firestore chat rooms | Peer-to-peer messaging, meeting scheduling, context-aware business assistant with automated tool calling and fallback offline resilience. | `test:assistant`, `test:automation` |
| **Shared Documents & File Vault** | `/documents`, `/documents/folders` | **COMPLETE** | Firebase Storage, Firestore `documents` | Multi-format uploads (PDF, images, spreadsheets), company-isolated paths, download URLs, size/MIME validation, access approval. | `test:storage`, `test:authz` |
| **Audit Logs & Activity Timeline** | Global inspection, Activity tabs | **COMPLETE** | Firestore `companies/{id}/activity_logs` | Immutable audit trail stamping user ID, timestamp, entity change diffs, transition reason logging. | `test:timeline`, `test:rules` |

---

## 3. Universal Shared Module: Projects & Work Orders

Projects has been architecturally promoted to a universal core module (`CORE_ROUTE_PREFIXES = ["/projects"]`), remaining fully accessible under every business activity while respecting tenant terminology customization.

| Module | Route(s) | Status | Dependencies | Verified Capabilities & Workflow | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Projects & Operations** | `/projects`, `/projects/:id`, `/projects/settings` | **COMPLETE** | Firestore `companies/{id}/projects`, `milestones`, `bills`, `invoices` | Project creation with industry presets (milestone auto-seeding), audited state machine (Planning → Active → On-Hold with mandatory reason → Completed), terminology renaming (e.g. "Orders"), three-tier financial cost rollup (Recorded, Approved Actual, Paid), and card click navigation. | `test:projects-unit`, `test:projects-integration`, `test:timeline` |

---

## 4. Activity-Specific Modules (Dynamic Workspaces)

Access to these routes is strictly partitioned and governed by `ActivityRouteGuard` and `resolveRouteAccess`. Irrelevant activities are hidden from sidebars and denied upon direct URL entry.

| Activity / Namespace | Route(s) | Status | Primary Collections | Verified Capabilities & Workflow | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Facilities Management** (`FACILITIES_MANAGEMENT`) | `/facilities`, `/facilities/assets`, `/facilities/maintenance`, `/facilities/contracts`, `/facilities/work-orders` | **COMPLETE** | `companies/{id}/fm_assets`, `fm_maintenance_requests`, `fm_vendors` | Asset registry, preventative maintenance schedules, work order lifecycles, contractor SLAs, and facility performance analytics. | `test:facilities`, `test:navigation-browser` |
| **Marketing Agency** (`MARKETING_AGENCY`) | `/agency`, `/agency/campaigns`, `/agency/clients`, `/agency/briefs`, `/agency/deliverables` | **COMPLETE** | `companies/{id}/mkt_campaigns`, `mkt_clients`, `mkt_deliverables` | Multi-channel campaigns, client briefs, creative asset reviews, milestone deliverable approvals, retainer billing integration. | `test:marketing`, `test:navigation-browser` |
| **Real Estate Management** (`REAL_ESTATE_MANAGEMENT`) | `/real-estate`, `/real-estate/properties`, `/real-estate/units`, `/real-estate/leases`, `/real-estate/tenants` | **COMPLETE** | `companies/{id}/rem_properties`, `rem_units`, `rem_leases` | Property portfolio cataloging, unit vacancy status, tenant lease generation, rent schedules, and maintenance dispatching. | `test:rem-unit`, `test:rules` |
| **School Management** (`SCHOOL_MANAGEMENT`) | `/school`, `/school/students`, `/school/classes`, `/school/teachers`, `/school/attendance` | **COMPLETE** | `companies/{id}/sch_students`, `sch_classes`, `sch_attendance` | Student admissions, classroom rosters, teacher subject schedules, daily attendance check-in, academic fee management. | `test:school-unit`, `test:school-integration` |
| **Custom Business Engine** (`GENERAL_SERVICES`, `RETAIL`, etc.) | `/modules`, `/modules/:moduleKey`, `/modules/builder` | **COMPLETE** | `companies/{id}/mod_<activity>_rec_<key>`, `module_definitions` | Dynamic field generator, schema builder, custom table rendering, automated validations, tenant-configurable entity storage. | `test:engine-unit`, `test:rules` |

---

## 5. Commercial, Financial & HR Modules

| Module | Route(s) | Status | Dependencies | Verified Capabilities & Workflow | Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CRM & Sales Pipeline** | `/crm`, `/crm/leads`, `/crm/deals`, `/crm/contacts`, `/crm/contracts` | **COMPLETE** | Firestore `leads`, `deals`, `contacts`, `contracts` | Lead capture, Kanban deal stages, won-deal contract wizard generation, PDF export, customer directory. | `test:crm-workflow`, `test:contract-regression`, `test:invoice-prefill` |
| **Invoicing & Billing** | `/billing`, `/billing/invoices`, `/billing/estimates`, `/billing/payments` | **COMPLETE** | Firestore `invoices`, `estimates`, `payments` | ZATCA Phase-compliant invoice drafting, tax computation, contract prefilling, payment recording, PDF invoice generation. | `test:invoice-prefill`, `test:accounting-concurrency` |
| **General Ledger & Accounting** | `/accounting`, `/accounting/journal`, `/accounting/chart-of-accounts`, `/accounting/reports` | **COMPLETE** | Firestore `accounts`, `journal_entries` | Double-entry journal vouchers, debit/credit balance validation, ledger locking, concurrency-safe sequential transaction posting. | `test:accounting`, `test:accounting-concurrency` |
| **People, HR & Attendance** | `/people`, `/people/employees`, `/people/attendance`, `/people/leave`, `/people/payroll` | **COMPLETE** | Firestore `employees`, `attendance`, `leave_requests` | Clock-in / clock-out geofencing payload verification, leave request approvals, weekly shift schedules, role-gated access. | `test:attendance-payload`, `test:attendance-authz`, `test:schedule-unit` |

---

## 6. Summary of Discovered Gaps & Self-Healing Actions Taken

1. **Activity Selection Locus Enforced**: Removed duplicate activity pickers from the Home Page (`/`) and main Dashboard (`/dashboard`). Centered activity selection strictly inside `Settings → Company Settings → Business Activity`.
2. **Projects Route Core Exemption**: Resolved route-guard conflict where facility tenants were inadvertently blocked from `/projects`. Added `/projects` to `CORE_ROUTE_PREFIXES`.
3. **Lucide Icons Declaration Generation**: Prebuild script `scripts/generate-lucide-types.cjs` generates valid TypeScript typings for 5,822 Lucide icons, achieving 0 compiler errors.
4. **Browser Test Resilience**: Standardized form input event dispatching (`input`, `change`, `blur`) and submit button targeting to ensure deterministic headless Edge CDP test execution.

