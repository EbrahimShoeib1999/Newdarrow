# 03 — Feature Inventory & Overlap Analysis

> Side-by-side inventory of every capability area, with overlap classification.
> Overlap flags: 🟢 A-only · 🔵 B-only · 🟡 Overlap (see doc 07 for the decision) · ⚪ Neither

## 1. Platform Foundation

| Capability | Project A (D-Arrow) | Project B (CustomModules~) | Overlap |
|---|---|---|---|
| Multi-tenancy | `companies/{companyId}` Firestore hierarchy, rules-enforced | `Organization` + `OrganizationMember` Prisma models, app-level only | 🟡 |
| Tenant isolation enforcement | **Server-side** (`firestore.rules`, 73 KB, prefix contract) | None (no rules engine) | 🟢 |
| Auth | Firebase Auth (email/password, invites) | Custom JWT (login/register/me/logout/refresh/switch-org) | 🟡 |
| RBAC model | 181 typed permission atoms, 7 static roles, `ROLE_PERMISSIONS` matrix, effective-permissions, role-assignment guard | DB-driven `Role`/`Permission`/`RolePermission` rows; 3 system roles + per-tenant roles; per-activity default roles | 🟡 |
| Invitations / onboarding | `invitation-onboarding.ts` (in-progress work in tree) | `onboarding-flow.tsx` wizard (activity→modules→owner) | 🟡 |
| Platform admin console | `PlatformAdminDashboardPage.tsx` | `platform/*` API suite (dashboard, tenants, users, templates, audit) | 🟡 |
| Subscription / plans | **None** | `Subscription` model (plan, status per org) | 🔵 |
| Branches | **None** | `Branch` model | 🔵 |
| Audit trail | Feature-level activity logs (CRM lead log, etc.) | `AuditLog` model + `platform/audit-logs` API | 🔵 (partial) |
| i18n | i18next, 19 namespaces, en/ar, RTL | Hardcoded en/ar strings; per-activity `terminology` maps | 🟡 |
| File storage | Firebase Storage + utils | None | 🟢 |
| Notifications | `features/notifications` | `notifications` module (demo) | 🟡 |
| Background jobs / automation | `features/automation`, `assistant` | None | 🟢 |

## 2. Module / Extensibility Systems

| Capability | Project A | Project B | Overlap |
|---|---|---|---|
| Module runtime | **Custom Business Modules Engine**: field-schema → records, transactions, optimistic revisions (`module-engine.ts`, `custom-modules.service.ts`) | Generic view renderer over demo data | 🟡 **(critical)** |
| Module catalog | Per-company `module_definitions` in Firestore | Declarative catalog: 24 module dirs, ~41 module codes with metadata | 🟡 |
| Dependency resolution | Not present | `module-guard` — dependency-aware enablement | 🔵 |
| Module enablement per tenant | Per-company module definitions | `OrganizationModule` rows + enable/disable APIs | 🟡 |
| Activity → module bundling | Implicit via route gating per activity | `BusinessTemplate` + `ActivityModule` (explicit, data-driven) | 🟡 |
| Config-driven dashboards | Per-domain dashboard pages (hand-built) | `dashboardWidgets` metadata per activity | 🔵 |
| Terminology per activity | Namespace-based i18n (generic) | Per-activity term overrides | 🔵 |

## 3. Business Domains

| Domain | Project A | Project B | Overlap |
|---|---|---|---|
| **Accounting/Billing** | Full double-entry engine: journals, CoA, invoices, bills, vouchers, credit notes, payments, reconciliation, cost centers, fiscal closing, fixed assets, VAT, Zakat, ZATCA, sales/purchase workflows, generic documents, public PDFs | `accounting`, `expenses`, `invoices` modules — demo views only | 🟡 |
| **CRM** | Leads, deals, contacts, quotations (PDF), contracts, client reports, tasks, chatter, timeline, analytics, conversion | `crm`, `customers` modules — demo views | 🟡 |
| **HR / People** | Hire/terminate, org chart, attendance + geo, lateness, leave, timesheets, schedules, performance, deductions, approvals | `employees`, `hr` modules — demo views | 🟡 |
| **Projects** | Live default activity domain | — | 🟢 |
| **Real estate (mgmt/brokerage/dev)** | mgmt live; brokerage/dev placeholders | `real_estate` template (activity not even in registry) | 🟡 |
| **Facilities management** | Live domain | — | 🟢 |
| **Marketing agency** | Live domain | — | 🟢 |
| **Medical clinic** | Placeholder (moduleLive: false) | `clinic` template (activity not in registry) | 🟡 |
| **School** | Live domain | — | 🟢 |
| **Restaurant / POS / kitchen / tables** | — | `restaurant` activity (POS, orders, kitchen, menu, tables, delivery, discounts) — all demo | 🔵 |
| **Car wash** (vehicles, work orders, services) | — | `car_wash` activity — demo | 🔵 |
| **Retail** (loyalty, categories) | — | `retail` activity — demo | 🔵 |
| **Salon** (appointments) | — | `salon` activity — demo | 🔵 |
| Inventory / purchasing / suppliers | Partial (via billing products/purchase workflow) | Demo modules | 🟡 |
| Tasks | `features/tasks` cross-activity | Demo module | 🟡 |
| Chat | `features/chat` | — | 🟢 |
| Meetings | `features/meetings` | — | 🟢 |
| Portals (external) | `features/portals` | — | 🟢 |

## 4. Frontend & DX

| Capability | Project A | Project B |
|---|---|---|
| Framework | Vite + React 19 SPA, React Router v7 | Next.js 16 App Router (used as SPA anti-pattern) |
| Component kit | HeroUI | shadcn/ui |
| Route architecture | Activity-gated lazy route trees | Client-state-driven view switching |
| Theming | Invoice/quotation themes, day-tone | Basic |
| Print/PDF | Invoice/quotation/contract/voucher print docs, PDF generation | None |

## 5. Key Overlap Verdicts (preview — full decisions in doc 07)

1. **Custom module engine** — A's engine is the runtime winner; B's registry/dependency/terminology metadata model is the catalog winner. → **MERGE_AND_REFACTOR**.
2. **Auth/RBAC** — A's Firebase + typed static RBAC wins; B's DB-driven roles are more flexible but unverifiable and unguarded. → **KEEP_D_ARROW** (with a data-driven role *catalog* idea deferred).
3. **Activity catalogs** — A: 8 code-defined activities (5 live); B: 4 data-defined activities (0 live modules). → **MERGE_AND_REFACTOR** (A's activity registry + B's template data model).
4. **Business functionality** — A is real, B is demo. Every B "business module" → **REBUILD_WITH_EXISTING_CORE** on A's engine, or **REJECT**.
5. **Subscription, Branch, AuditLog, onboarding wizard** — A lacks all four; B's *designs* (not code) → **IMPORT_FROM_PROJECT_B** as Firestore-first designs.
