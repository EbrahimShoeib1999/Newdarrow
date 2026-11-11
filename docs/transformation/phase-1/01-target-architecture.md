# Phase 1 — 01 · Target Architecture (NestJS Modular Monolith)

> **Status:** Design for approval — no code has been changed in this phase.
> Marks: **[V]** = verified fact (observed in source this session or in committed Phase One evidence); **[D]** = design decision with rationale.

## 1. System context

**Today [V]:** a React 18 / Vite SPA (`src/app/router.tsx`, `createBrowserRouter`) talks **directly** to Firebase from feature services (`src/features/*/api/*.service.ts`): Firebase Auth (client SDK: email/password, Google popup, `getIdToken`, custom claims, `otpResets`), and Firestore (29 named collections + wildcard rules). Authorization runs in two places that must stay in agreement: TypeScript policy in `src/lib/permissions/**` and the 73 KB `firestore.rules`.

**Target (Directive §2):**

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│ React / Vite SPA (unchanged)│──REST──▶│ NestJS API (modular monolith) │
│ src/features/* pages & UI   │◀──WS───│ /api/v1 + WebSocket gateways │
│ feature services swap       │        └──────────────┬───────────────┘
│ Firebase SDK → REST client  │                       │ Prisma ORM
└──────────────┬──────────────┘                       ▼
               │ (legacy, per-domain, temporary) ┌────────────────┐
               ▼                                 │ PostgreSQL     │
        Firebase (Auth + Firestore)              │ (system of     │
        read-only archive after each             │  record)       │
        domain is migrated & accepted             └────────────────┘
```

- The frontend application, UI/design system, and route structure are **preserved** (Directive §1). The only frontend change per domain is swapping that feature's service implementation from Firestore calls to REST/WS calls (Phase 6).
- Firebase is retired **per-domain, only after acceptance** (see `05-migration-plan.md`). No global removal.
- PostgreSQL becomes the final system of record (Directive §6).

## 2. Repository layout **[D1]**

**Decision:** the NestJS backend lives in the **same repository** at `backend/` with its own `package.json`, `tsconfig`, and test setup. The frontend stays at the repo root, untouched.

| Consideration | Same-repo `backend/` (chosen) | Separate backend repo | Full monorepo workspaces now |
|---|---|---|---|
| Cross-stack atomic changes (DTO ↔ service swap) | ✅ one commit | ❌ two repos, version skew | ✅ |
| Git history / WIP continuity | ✅ single history | ❌ split | ✅ |
| Tooling churn in this phase | ✅ none | ✅ none | ❌ workspace migration risk |
| Contract sharing (`shared/types`) | ✅ folder later | ❌ package publishing | ✅ |

The frontend integration seam already exists **[V]**: `src/lib/api-client.ts` with `baseURL = API_BASE_URL` (`VITE_API_BASE_URL` || `"/api"`) and the `ApiResponse` envelope type (`src/types/api.types.ts`). In development, Vite proxies `/api` to the NestJS server; the SPA keeps working whether `VITE_API_BASE_URL` is set or default.

## 3. NestJS module map

### 3.1 Platform Core (Directive §3A)

| NestJS module | Responsibility | Absorbs (current, verified) |
|---|---|---|
| `AuthModule` | Login/register/refresh/logout, password hashing (argon2id), session & refresh-token rotation, Firebase ID-token verification bridge | `src/features/auth/api/auth.service.ts`, `otp.service.ts` **[V]** |
| `UsersModule` | User profiles, self-service settings, avatar | `users` Firestore docs **[V]** |
| `CompaniesModule` | Companies, branches, departments, company settings | `companies`, `settings` collections **[V]** |
| `MembershipsModule` | Memberships, role assignment, **invitations** (INVITABLE_ROLES policy), onboarding status | `invites` collection, `src/lib/permissions/role-assignment.ts` **[V]** |
| `RbacModule` | Roles, permission atoms, portal sub-roles, per-user custom permissions, portal access | `src/lib/permissions/**` **[V]** |
| `SubscriptionsModule` | Plans, entitlements, company subscriptions, trial lifecycle | new (SaaS layer; Project B concepts **[V]**: `Subscription`, plans) |
| `ModuleCatalogModule` | Module definitions + versions + publishing + dependency metadata | `module_definitions` collection **[V]** |
| `CompanyModulesModule` | Per-company module activation, configuration, dependency validation | new (Project B's `OrganizationModule` concept **[V]**) |
| `CustomModulesRuntimeModule` | Engine-backed record CRUD/list/stage-move APIs — the **single runtime** | `src/features/custom-modules/lib/module-engine.ts` **[V]** |
| `NotificationsModule` | Notification persistence + WebSocket push | `notifications` feature **[V]** |
| `AuditModule` | Audit log writes (interceptor-driven) | `audit_logs` collection **[V]** |
| `PlatformAdminModule` | Platform administration, company oversight | `src/features/admin` (SeedPage, PlatformAdminDashboardPage) **[V]** |

### 3.2 Business modules (Directive §3B — all preserved)

One NestJS module per existing feature domain, mirroring `src/features/` **[V: 23 domains]**: `Tasks`, `Crm`, `People` (HR: employees, attendance, work schedules, lateness policies, deduction cases, payroll), `Projects` (core activity), `Meetings`, `Chat`, `Billing`/`Accounting` (invoices, bills, vouchers, journals, payments, chart of accounts, zakat, VAT, fixed assets, reconciliation, fiscal closing), `Marketing`/`Agency`, `RealEstate` (`rem_*` collections **[V]**), `School`, `Facilities`, `Automation`, `Assistant`, plus the activity-registry services (`activities`).

### 3.3 Dependency rules (Directive §5 — DDD)

- Business modules may import **Platform Core only** (and shared infrastructure). No business-module ↔ business-module imports.
- Cross-domain reads go through the owning module's service API (e.g., Billing reads People employee data through `PeopleModule`'s exported service, never its tables directly).
- The custom-modules runtime is the **only** dynamic-definition runtime (Directive §4). Verticals never re-implement it.

## 4. Layering and request pipeline

```
HTTP / WS
  → GlobalPipes (DTO validation: class-validator, forbidNonWhitelisted)
  → JwtAuthGuard          (verified token; Firebase-bridge or native JWT in Phase 3)
  → TenantGuard           (resolves companyId from the authenticated membership — never from the body)
  → PermissionsGuard      (@RequirePermissions('tasks.create') — DB-backed grants)
  → [module routes] EntitlementGuard (company module active + plan entitlement)
  → Controller (thin: map DTO ⇄ service)
  → Service (domain logic, Prisma transactions, stable error codes)
  → Prisma (tenant-scoped repositories)
  → PostgreSQL
  → AuditInterceptor (writes AuditLog for sensitive operations)
```

- **Controllers contain no business logic** (Directive §5).
- **Never trust client `companyId`/`userId`/`role`/permission values**: the TenantGuard derives company context from the authenticated principal's membership and rejects mismatches (Directive §6). Body-supplied company ids are validated against that membership.
- Frontend route guards (`ActivityRouteGuard`, nav filtering **[V]**) remain as UX affordances only — **not** security boundaries.

## 5. API conventions

| Concern | Convention |
|---|---|
| Base path | `/api/v1` (matches `API_BASE_URL = "/api"` seam **[V]**; version in path) |
| Envelope | `ApiResponse` shape **[V]** (`src/types/api.types.ts`): `{ success, data | error: { code, message, details } }` |
| Error codes | Preserve existing stable codes **[V]** (`INVITE_ROLE_NOT_ALLOWED`, `INVITE_ROLE_NOT_ASSIGNABLE`, `permission-denied` equivalents) so locale files (`public/locales/{ar,en}`) keep working unchanged |
| IDs | Text primary keys; **preserve Firestore document ids during migration** **[D2 — critical for data reconciliation and shared links]**; new rows use `cuid()` |
| Lists | Pagination + sort + search contract mirroring the engine's `queryRecords` **[V: search/status/archived/sort/pagination]** |
| i18n | Server returns stable codes + English message; frontend maps codes to ar/en strings (current pattern **[V]**) |
| Time | UTC `timestamptz`; Firestore `Timestamp` values converted during migration |

## 6. WebSocket strategy **[D3]**

- One `NotificationGateway` (per-user room) and one `ChatGateway` (per-conversation rooms, membership-checked at subscribe time).
- Handshake authenticates with the same JWT; company scoping enforced server-side on every emit.
- **REST remains the source of truth for writes**; WS is push-only (optimistic UI + notification). This keeps the migration auditable and avoids duplicate write paths.

## 7. Configuration, health, observability

- `ConfigModule` with Zod-validated env (`DATABASE_URL`, `JWT_*`, `FIREBASE_*` bridge credentials during transition only).
- `GET /api/v1/health` → DB round-trip check.
- Structured request logging with `requestId`; audit interceptor on sensitive ops (role changes, invites, module activation, subscription changes, deletions).
- No production credentials in the repo; `.env` files stay gitignored **[V: current practice]**.

## 8. Testing architecture (Directive §10)

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Jest (backend), tsx scripts (frontend policy ports) | services, engine, policy |
| API | Supetest | endpoint contracts incl. authz negatives |
| Integration | Test DB (docker compose profile) | Prisma repositories, transactions, tenant scoping |
| E2E | Ported emulator scenarios as API/browser tests | the existing suites (`test-invites-rules`, `test-invites-admin-browser`, attendance suites **[V]**) become the conformance baseline |
| Security | Automated matrix | cross-tenant, privilege escalation, token tampering |

## 9. Decision register

| # | Decision | Status |
|---|---|---|
| D1 | Backend at `backend/` in same repo | Proposed — owner approval |
| D2 | Text PKs preserving Firestore ids during migration | Proposed |
| D3 | WS push-only; REST writes | Proposed |
| D4 | Argon2id password hashing | Proposed |
| D5 | Module record storage = JSONB generic table | Proposed (see `02-database-schema.md`) |
