# 06 — Domain & Concept Mapping

> Maps Project B's concepts onto Project A's canonical equivalents. Rule: **A's names and storage are canonical**; B concepts map in, never the reverse. Similar-looking features with different business meaning are called out explicitly.

## 1. Tenancy & Identity

| Project B concept | Project A equivalent | Mapping notes |
|---|---|---|
| `Organization` | `companies/{companyId}` doc | Same business meaning (tenant). A doc becomes the owner of all subcollections; B row has `slug`, `status`, `activityId` fields worth adopting (`slug` for URLs, `status` for lifecycle) |
| `OrganizationMember` | Company membership docs under `companies/{id}/members` (via invites/role-assignment) | Same meaning. B adds `joinedAt`, `isDefault` (org switching) — adopt |
| `User` (Prisma, own table) | Firebase Auth user + `users` feature profile | **Different meaning**: B's User is an account row with password hash; A's is an Auth principal + profile. A stays; B's multi-org-membership UX (`switch-organization`) is the importable idea |
| `OrganizationSettings` | Company settings docs (billing settings, HR settings hub) | Same meaning; merge into A's settings features |
| `Branch` | **No A equivalent** | New capability (import as design) |

## 2. RBAC

| Project B | Project A | Notes |
|---|---|---|
| `Role` / `Permission` / `RolePermission` rows | `src/lib/permissions/index.ts` typed atoms + `ROLE_PERMISSIONS` matrix | **Different mechanics, same business meaning.** A's model stays runtime-canonical. B's *per-activity role templates* (owner/manager/staff with preset permission sets) become **seed data** for A's role-assignment onboarding |
| `TENANT_OWNER` system role | `super_admin`/`admin` | B's owner ≈ A's super_admin within one company |
| `PLATFORM_ADMIN` | `platform_admin` | Same meaning — direct map |
| `TENANT_USER` | `employee` | Same meaning — direct map |
| Per-activity default roles | A per-company role assignment | B's concept imports as "activity starter roles" template |

## 3. Activity / Vertical Model

| Project B | Project A | Notes |
|---|---|---|
| `Activity` (code, name, nameAr, icon, description) | `activity.types.ts` registry (id, routeBase, moduleLive) | Same business meaning (vertical). A adds routing; B adds marketing metadata — union |
| `ActivityModule` (activity → default modules) | Implicit via activity route trees | **B's explicit data-driven bundling is the import** |
| `BusinessTemplate` / `BusinessTemplateModule` | `company-defaults.ts` (implicit per-company provisioning) | Same intent (starter kit for a new tenant). B's model is richer (named templates per activity) — import shape |
| `dashboardWidgets` per activity | Hand-built dashboard pages | Different mechanics; B's config-driven widget list is a roadmap idea, not an immediate port |
| `terminology` per activity | i18n namespaces | Same business meaning (vertical-specific vocabulary). Map to **per-activity namespace overlays** on A's i18n |
| `workflows` per activity (step lists) | A feature-level workflows (lead-workflow, deal-workflow) | **Different meaning**: B's are metadata step lists; A's are implemented state machines. B's metadata kept as template docs only |

## 4. Module System

| Project B | Project A | Notes |
|---|---|---|
| `Module` catalog row | `module_definitions` doc (per company) | **Subtly different meaning**: B's Module = *catalog entry* (what can exist); A's module_definition = *instantiated config* (what exists for this company, with field schemas). Target keeps both layers: catalog (new) → definitions (existing) |
| `OrganizationModule` (enablement) | Presence/absence of `module_definitions` doc | Same business meaning (tenant has module on/off). A gains an explicit `enabled` flag semantics from B |
| Module dependencies + `module-guard` | Not present | **New capability** — import logic into A's provisioning |
| `module-view-renderer` demo views | `module-engine.ts` runtime + real record UI | **Different meaning entirely**: B renders fake data; A executes real records. B's renderer is rejected; A's engine is the runtime |

## 5. Business Domains (name-collision traps — verified meanings)

| Same-ish name | Actual business meaning | Decision |
|---|---|---|
| B `accounting` module | Demo table of fake ledger rows | Reject; A's accounting engine is canonical |
| B `invoices` / `expenses` | Demo lists | Reject; A billing canonical |
| B `crm` / `customers` | Demo lists | Reject; A CRM canonical |
| B `employees` / `hr` | Demo lists | Reject; A people canonical |
| B `pos`, `orders`, `kitchen`, `tables`, `menu` | Demo (restaurant) | Rebuild on A engine as restaurant template modules |
| B `vehicles`, `work_orders` (car wash) | Demo | Rebuild on A engine |
| B `loyalty`, `discounts` | Demo | Roadmap custom modules |
| B `appointments` (salon/clinic/gym) | Demo | Roadmap custom modules; note A has `meetings` — **different meaning** (internal meetings ≠ customer appointments) — keep names distinct |
| B `inventory`, `purchasing`, `suppliers` | Demo | Partial overlap with A billing purchase workflow — design mapping before building |
| B `notifications` | Demo | A's notifications feature canonical |
| B `settings` | Real (Prisma-backed org settings) | Merge into A company settings |

## 6. Platform Ops

| Project B | Project A | Notes |
|---|---|---|
| `platform/tenants` transactional creation | PlatformAdminDashboard (read-mostly oversight) | B's flow is the import (re-created with Firestore batch/transactions) |
| `Subscription` | None | New capability — Firestore-first redesign |
| `AuditLog` | Feature-level logs only | New capability — platform audit collection design |
| `platform/activities/[code]/preview` | None | Import concept: template preview before provisioning |

## 7. Naming Rules for the Unified Platform

1. **Tenant** = A's `company` (doc path `companies/{id}`). Do not introduce "organization".
2. **Activity** = A's `ActivityId` registry. New verticals get new `ActivityId`s.
3. **Module catalog** (new, from B) = `module_catalog` (platform-level); **module definition** (A, existing) = `companies/{id}/module_definitions`. Two layers, distinct names.
4. **Branch** (new, from B) = `companies/{id}/branches`.
5. **Subscription** (new, from B) = `companies/{id}/subscription` + platform `plans`.
6. **Audit** (new, from B) = `platform_audit` platform-level collection.
7. Customer "appointments" (future salon/clinic) must not reuse the `meetings` feature.
