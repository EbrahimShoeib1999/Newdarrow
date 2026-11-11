# 02 — Project B Discovery: "CustomModules~"

> **Status:** Discovery complete — no code changes made.
> **Repository:** `E:\real projects\DArrow\NewDArrow\CustomModules~`
> **Evidence basis:** Direct source inspection of `prisma/`, `src/modules/`, `src/config/`, `src/app/api/v1/`, `worklog.md`, `agent-ctx/*`.

---

## 1. Identity & Purpose

Project B is a **platform-scaffolding prototype**: a multi-tenant "module marketplace" architecture demo built to prove that business verticals (restaurant, car wash, retail, salon) can be modeled as **declarative module catalogs + activity templates** provisioned per organization through an admin console.

**Critical finding (verified in source):** the tenant-facing business modules are **DEMO-ONLY**. `src/components/module-view-renderer.tsx` and the tenant module pages render `DEMO_LIST_DATA` / `generateMockData`. No real business transactions exist in Project B. Its value is **architectural**, not functional:

- Real: platform-admin console APIs, tenant provisioning (transactional), module enable/disable, role/permission seeding, activity/template catalogs, Prisma schema.
- Demo: all tenant business module views and their "data".

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Data | Prisma + **SQLite** (`prisma/dev.db`) |
| Auth | Custom JWT (login/register/me/logout/refresh/switch-organization) |
| UI | shadcn/ui component kit (~large `src/components/ui` set) |
| Validation | Zod available in stack but **not applied on API routes** |

**Scale:** ~157 source files, ~23K LOC excluding the UI kit. 24 module directories under `src/modules/`; ~41 module codes declared in `src/config/modules/registry.ts`.

## 3. Data Model (Prisma, 17 models)

`prisma/schema.prisma`:

- **Tenancy:** `Organization`, `OrganizationMember`, `OrganizationSettings`, `Branch`
- **RBAC:** `User`, `Role`, `Permission`, `RolePermission` — **DB-driven roles/permissions** (rows, not code)
- **Catalog:** `Activity`, `ActivityModule`, `Module`, `BusinessTemplate`, `BusinessTemplateModule`
- **Provisioning:** `OrganizationModule` (per-tenant module enablement)
- **Monetization:** `Subscription`
- **Compliance:** `AuditLog`

Key relationships: an `Organization` picks an `Activity`; a `BusinessTemplate` bundles default modules for an activity; `OrganizationModule` rows instantiate enabled modules per tenant; `Subscription` tracks plan/status per organization.

## 4. Module System (the architectural core)

- `src/modules/_registry/types.ts` + `loader.ts`: a **module registry** where each of the 24 modules is a metadata-only definition (`index.ts` with id, name, icon, category, dependencies, routes, permissions).
- `src/config/modules/registry.ts`: ~41 module codes (dashboard, pos, orders, menu, kitchen, tables, inventory, purchasing, suppliers, customers, crm, products, categories, services, vehicles, work_orders, appointments, prescriptions, loyalty, delivery, payments, employees, hr, accounting, expenses, invoices, reports, analytics, notifications, settings, branches, discounts, …).
- `src/lib/module-guard.ts` (or equivalent in module-view layer): **dependency resolution** — enabling a module requires its dependencies to be enabled first.
- `module-view-renderer.tsx` + `tenant-module-page.tsx`: generic renderer that maps module metadata → demo view.

## 5. Activity & Template System

- `src/config/activities/registry.ts` — `ACTIVITY_REGISTRY` contains **only 4 activities**: `restaurant`, `car_wash`, `retail`, `salon`. Each definition carries: default module list, `defaultRoles` (with per-role permission lists), `dashboardWidgets` (config-driven dashboard), **terminology** (`Record<string, {en, ar}>` — activity-specific vocabulary), `quickActions`, `settings`, and `workflows` (step sequences across modules).
- `prisma/seed.ts` seeds 9 `BusinessTemplate`s — **but 5 of them reference activity codes (`laundry`, `gym`, `clinic`, `real_estate`, `services`) that do not exist in `ACTIVITY_REGISTRY`**. The seed is therefore internally inconsistent — templates for missing activities would fail or be orphaned. This is evidence that Project B is an incomplete prototype.
- `src/app/api/v1/platform/activities/[code]/preview` — previews an activity's module set/roles/widgets before tenant creation.
- Onboarding: `onboarding-flow.tsx` — multi-step tenant creation wizard backed by the transactional platform API.

## 6. API Layer (~41 route files under `src/app/api/v1/`)

| Area | Routes | Real? |
|---|---|---|
| Auth | `auth/login, register, me, logout, refresh, switch-organization` | Real (but flawed — see §8) |
| Platform admin | `platform/auth/login, dashboard, tenants (+[id], status), users, roles, permissions, modules, activities (+preview), templates, industries, audit-logs` | **Real** — transactional tenant creation with template-based module provisioning |
| Tenant config | `tenant/config, context, dashboard, modules, navigation, terminology`, `tenants/current/modules/[moduleKey]` | **Real** (reads Prisma; renders demo data for business content) |
| Misc | `organizations/*`, `roles`, `permissions`, `users`, `settings`, `audit-logs`, `business-verticals`, `industries` | Real CRUD on catalog/config models |

## 7. Build History & Known Issues

`worklog.md` + `agent-ctx/*` document iterative AI-assisted construction, self-audits, and known issues. This is a **laboratory project** whose working value is the schema and registry patterns, not the runtime.

## 8. Security Posture (verified weaknesses)

1. **JWT secret default fallback** — if env var missing, a hardcoded default is used.
2. **Broken refresh-token flow** — refresh tokens are never stored/validated server-side.
3. **Tokens in localStorage** — XSS-exposed session storage.
4. **SQLite** — single-file DB, no concurrent-production-grade isolation.
5. **SPA-in-Next anti-pattern** — client-side state-driven "routing" instead of real Next.js routes.
6. **No Zod validation on API routes** — inputs trusted.

None of Project B's security stack is acceptable for production reuse (see doc 10).

## 9. What Project B Does *Not* Have

- No real business transactions (demo data only).
- No accounting engine, no invoices, no HR, no real CRM.
- No server-enforced tenant isolation (isolation is app-level only; no rules engine).
- No test suite of significance.
- No i18n framework (hardcoded en/ar strings in registries/terminology maps).
- No file storage, no notifications delivery, no portals.

## 10. Genuine Capabilities Worth Salvaging (for doc 07)

1. **Activity template model** — `BusinessTemplate` bundling (activity → default module set → default roles → widgets → terminology) as *provisioning data*.
2. **Declarative module catalog + dependency resolution** — registry metadata and module-guard dependency logic.
3. **Terminology concept** — per-activity vocabulary overrides (maps cleanly onto Project A's i18n namespaces).
4. **Subscription model** — plan/status per organization (Project A has no platform monetization model).
5. **Transactional tenant provisioning UX** — platform admin creates org + owner + modules + roles in one flow (A has platform admin dashboard but no self-serve tenant creation wizard).
6. **Branch concept** — `Branch` per organization (A lacks multi-branch).
7. **Onboarding wizard UX pattern** — multi-step activity selection → module confirmation → owner creation.
8. **AuditLog shape** — structured platform-level audit trail model.

## 11. Out-of-Scope Neighbor

`E:\real projects\DArrow\ibrahimT\ibrahim-dates-backend` (Express/Prisma dates REST API) is a **third, unrelated project** and is explicitly **not** a merger target in any phase.
