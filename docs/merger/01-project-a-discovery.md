# 01 — Project A Discovery: D-Arrow Business Platform

> **Status:** Discovery complete — no code changes made.
> **Canonical repository:** `E:\real projects\DArrow\NewDArrow\d-arrow-business`
> **Evidence basis:** Direct source inspection of `src/`, `firestore.rules`, `package.json`, `docs/implementation/`.

---

## 1. Identity & Purpose

D-Arrow is a **multi-tenant, multi-activity business management SaaS platform**. A single deployment serves many companies (`companies` collection in Firestore), each company selects one or more **Activities** (business verticals), and users operate inside activity-gated domains backed by a shared cross-activity foundation (CRM, Billing/Accounting, People/HR, Tasks, Chat, Meetings, Notifications).

It is a **production system**: it has a live Firebase project (id `d-arrow-buisiness` — the typo is the actual project id), a 73 KB `firestore.rules` tenant-security model, 104 emulator-based test scripts, bilingual AR/EN UI with RTL support, and ZATCA/Zakat/VAT compliance features for Saudi Arabia.

## 2. Technology Stack

| Layer | Technology | Evidence |
|---|---|---|
| Build | Vite | `package.json`, `vite.config.ts` |
| UI framework | React 19 + TypeScript | `package.json` |
| Component kit | HeroUI (+ Tailwind) | imports throughout `src/components`, `src/features` |
| Routing | React Router v7 | `src/app/router.tsx` |
| State | zustand (UI stores) + TanStack Query (server state) | `src/lib/query-client.ts`, `*.store.ts` |
| Backend | Firebase Auth + Firestore + Storage (client SDK, thin service layer) | `src/lib/firebase.ts`, `src/features/*/api/*.service.ts` |
| Validation | Zod schemas per domain | `src/features/billing/schemas/*`, `src/features/crm/schemas/*` |
| i18n | i18next, 19 namespaces, `en`/`ar`, RTL via `document.dir` | `src/lib/i18n.ts`, `public/locales/` |
| Testing | Vitest + Firebase Emulator suites (104 scripts) | `package.json` scripts |

**Scale:** ~690 source files under `src/`, ~137K LOC. 24 feature directories. This is the larger and more mature system by roughly 6× (Project B is ~23K LOC excluding UI kit).

## 3. Multi-Tenancy & Activity Architecture (the core contract)

### 3.1 Activities

`src/features/activities/types/activity.types.ts` defines **8 activities**:

| Activity id | Route base | Live modules? |
|---|---|---|
| `PROJECTS` (default) | `/projects` | ✅ |
| `REAL_ESTATE_MANAGEMENT` | `/real-estate` | ✅ |
| `REAL_ESTATE_BROKERAGE` | `/brokerage` | ❌ placeholder |
| `FACILITIES_MANAGEMENT` | `/facilities` | ✅ |
| `REAL_ESTATE_DEVELOPMENT` | `/development` | ❌ placeholder |
| `MARKETING_AGENCY` | `/agency` | ✅ |
| `MEDICAL_CLINIC` | `/clinic` | ❌ placeholder |
| `SCHOOL_MANAGEMENT` | `/school` | ✅ |

Each activity gets its own route tree (`src/features/activities/config/activity-routes.ts`), loaded lazily and gated by company activity selection (`router.tsx`).

### 3.2 Collection-prefix domain isolation

`src/features/activities/types/activity-domain.ts` maps every activity to a Firestore **collection prefix**:

- `rem_` → real-estate management, `fm_` → facilities, `mkt_` → marketing agency, `cln_` → clinic, `sch_` → school
- Custom module records: `mod_<activity>_rec_<key>`
- Shared/cross-activity domains (CRM, billing, people) live under `companies/{companyId}/...` scoped paths

This contract is **mirrored in `firestore.rules`** (73 KB): every match block enforces `request.auth` membership of the owning company. Prefix-based ownership means the security model and the domain model cannot drift apart silently.

## 4. RBAC / Security

`src/lib/permissions/index.ts`:

- **181 permission atoms** (e.g., `crm.contacts.view`, `billing.invoices.manage`) declared as a typed union.
- **7 roles:** `platform_admin`, `super_admin`, `admin`, `manager`, `global_hr_manager`, `employee`, `viewer` — static TypeScript `ROLE_PERMISSIONS` matrix (compile-time checked, no drift, no DB reads for permission checks).
- `effective-permissions.ts` computes per-user effective grants (role matrix + company/activity scoping).
- `role-assignment.ts` governs who may assign which roles (prevents privilege escalation).
- `invitation-onboarding.ts` implements invite → accept → role onboarding. **Note:** invite/HR work is currently **in progress in the working tree** (uncommitted changes to `invites.service.ts`, `InviteUserModal.tsx`, `use-invites.ts`, `TeamMembersPage.tsx`, `HireEmployeeModal.tsx`, `attendance.store.ts`, plus untracked test scripts). The merger must not disturb this work.
- Platform admin console: `src/features/admin` (`PlatformAdminDashboardPage.tsx`) for cross-company oversight.

## 5. Business Feature Inventory (summary — full table in doc 03)

24 feature domains under `src/features/`:

| Domain | Maturity | Highlights |
|---|---|---|
| `billing` + `accounting` | **Production-grade** | Double-entry engine (`billing/utils/accounting-engine.ts`): journal entries for invoices/bills/payments/credit notes, chart of accounts with system accounts by sub-type, cost centers, bank reconciliation, fiscal closing, fixed assets, VAT return, **Zakat**, **ZATCA QR code**, aged reports, statement of account, sales/purchase order workflows, generic document system, public invoice PDF page, sequence numbering |
| `crm` | **Production-grade** | Leads (kanban + workflow), deals pipeline, contacts + classifications, quotations (builder, letterhead, PDF, calculations), contracts (builder, print, invoice prefill), client reports (public link), CRM tasks, chatter/notes/attachments/timeline, notifications, analytics, lead→task conversion, entity reassignment |
| `people` (HR) | **Production-grade** | Hire/terminate modals, org chart, attendance with **geo check-in** (`attendance-geo-check.ts`), lateness policies, leave tracker & balances, daily reports, timesheets, work schedules with rules engine, performance, deduction cases, approvals, HR settings hub |
| `projects` | Live | Default activity domain |
| `real-estate`, `facilities`, `marketing`, `school` | Live (moduleLive: true) | Prefix-isolated domains |
| `brokerage`, `development`, `clinic` | Placeholder (moduleLive: false) | Route stubs only |
| `custom-modules` | **Engine, production-grade** | See §6 |
| `tasks`, `chat`, `meetings`, `notifications` | Cross-activity foundations | Shared across all activities |
| `portals` | External-facing | Client/tenant portals (see `docs/Portal-Architecture-Plan.md`) |
| `companies`, `users`, `auth`, `admin`, `assistant`, `automation`, `agency` | Platform plumbing | Company lifecycle, profiles, auth, platform admin |

## 6. Custom Business Modules Engine (key overlap with Project B)

`src/features/custom-modules/` is a **configurable-record engine already running in production**:

- `lib/module-engine.ts` — pure domain core: field schema → record CRUD semantics, validation, computed behaviors.
- `api/custom-modules.service.ts` — Firestore service with **transactions and optimistic revision checks** (concurrency-safe).
- Storage model: `companies/{companyId}/module_definitions` (per-company module definitions) + `mod_<activity>_rec_<key>` records (per-activity record collections, prefix-enforced by rules).
- Self-audited in `docs/implementation/module-inventory.md` and designed in `docs/implementation/activity-architecture.md`.

**Implication for the merger:** Project A already owns the "custom module" runtime that Project B's module system aspires to be. Any integration must treat A's engine as the single source of truth (see docs 07 and 11).

## 7. Data Layer

- **Firestore**, hierarchical: `companies/{companyId}/...` subcollections; prefix-based domain collections for activity-scoped data.
- **Storage** for attachments (`crm/crm-storage.service.ts`, `src/lib/storage-utils.ts`).
- **Seed utility:** `src/lib/seed-firestore.ts` + `src/lib/company-defaults.ts` (per-company default provisioning).
- Firestore rules inventory (73 KB) audited: tenant boundary + per-domain permission functions.

## 8. i18n

`src/lib/i18n.ts`: 19 namespaces (`common, auth, tasks, profile, people, crm, settings, landing, chat, billing, meetings, projects, facilities, marketing, real_estate, custom_modules, assistant, school`), `en`/`ar`, automatic RTL/LTR direction, localStorage persistence (`d-arrow-lang`).

## 9. Testing Infrastructure

`package.json` exposes **104 test scripts** built on the **Firebase Emulator** (auth/firestore rules suites, service tests). This is the platform's safety net for the merger: every integration change can be validated against emulator suites without touching production Firebase. **No production Firebase changes are permitted during Phase One** (constraint honored — none made).

## 10. Repository Hygiene Notes

- Canonical copy is `NewDArrow\d-arrow-business` (most recently updated, has `node_modules`).
- Duplicate clones exist at `E:\real projects\DArrow\D-Arrow-Business` and `E:\real projects\DArrow\New folder\d-arrow-business` (same GitHub origin `KhaledHassangit/d-arrow-business`). Copy equivalence unverified (hash comparison timed out; non-critical for Phase One).
- **Uncommitted in-progress work** (invite/HR) must be preserved untouched.
- The adjacent `E:\real projects\DArrow\ibrahimT\ibrahim-dates-backend` (Express/Prisma dates REST API) is an **unrelated third project — out of merger scope**.

## 11. Strengths / Weaknesses (for comparison in doc 05)

**Strengths**
1. Real, working, tenant-isolated business functionality (not demo data).
2. Security model enforced server-side in Firestore rules, mirrored with the domain contract.
3. Static, typed RBAC (181 atoms, 7 roles) — no runtime drift.
4. Mature accounting/CRM/HR feature depth with KSA compliance (ZATCA, Zakat, VAT).
5. Emulator-based test culture (104 scripts).
6. Bilingual AR/EN + RTL.

**Weaknesses / Gaps**
1. Only 5 of 8 activities are live; 3 are placeholders.
2. No POS / restaurant / retail / salon-style verticals (Project B's territory).
3. No subscription/plan/billing-for-the-platform (monetization) model.
4. No multi-branch concept within a company.
5. Activity catalog is code-defined (TS) — adding a vertical is a code change, not configuration.
6. Client-heavy Firebase architecture (no server-side API tier) — fine for now, but limits background jobs.
