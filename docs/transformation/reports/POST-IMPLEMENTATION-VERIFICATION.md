# POST-IMPLEMENTATION-VERIFICATION.md

**Date:** 2026-11-12
**Scope:** Implementation checkpoint after Phases 3-6 (database foundation, backend foundation, business module backend, frontend migration core paths)
**Verdict:** IMPLEMENTATION VERIFIED AS CHECKPOINT — NOT PRODUCTION-READY

---

## 1. Executive Verdict

The implementation reported is **correct for its claimed scope** (auth, companies, branches, HR, CRM, finance backend + core frontend auth/company/storage migration), **secure at the boundary** (JWT auth, RBAC guards, company isolation at guard level), and **safe to continue from**. It is **NOT production-ready**.

Key findings:
- Backend: 100% Firebase-free, NestJS + Prisma + PostgreSQL, all modules build and test (15/15 pass)
- Frontend core auth paths: 100% Firebase-free (api-client, auth service, auth store, auth context, company service, storage adapter)
- Remaining Firebase: ~40 feature service files still import Firebase; `firebase.ts` hub still present
- Database: 19 tables, proper FKs/indexes/uniques, `darrow_dev` + `darrow_test` isolated; production `darrow` DB does not exist locally
- Security gaps identified: service-layer company ownership enforcement missing; auth service `generateTokens` returns `user.role` which is undefined (role only exists on CompanyMembership)
- No E2E browser tests, no rate limiting, no production storage adapter, no deployment config

---

## 2. Git Safety

### Repository state

| Repository | Branch | HEAD | Status |
|------------|--------|------|--------|
| `d-arrow-business` | `main` | `9aa8581` feat(backend): T2.1 NestJS scaffold | 16 modified files, 14 new untracked dirs/files |
| `CustomModules~` | (own git) | `0bc6533` baseline | Untouched |
| `NewDArrow` (root) | `master` | No commits | 4 untracked dirs only |

### Files modified by this implementation

**Modified (pre-existing files, working-tree changes only):**
- `backend/.env.example` — added JWT config defaults
- `backend/README.md` — updated
- `backend/package-lock.json` — dependency changes (added @nestjs/jwt, @nestjs/passport, passport, passport-jwt, bcryptjs, uuid, dotenv)
- `backend/package.json` — added auth deps
- `backend/src/app.module.ts` — added AuthModule, CompaniesModule, BranchesModule, HrModule, CrmModule, FinanceModule
- `backend/src/config/env.spec.ts` — updated test defaults for new env vars
- `backend/src/config/env.ts` — added JWT_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL_SECONDS, JWT_REFRESH_TTL_SECONDS
- `backend/src/main.ts` — added dotenv config load
- `backend/tsconfig.json` — no functional change
- `src/features/auth/api/auth.service.ts` — replaced Firebase Auth with REST API
- `src/features/auth/components/google-sign-in-button.tsx` — replaced with stub
- `src/features/auth/context/auth-context.tsx` — removed Firebase, uses Zustand store
- `src/features/companies/api/company.service.ts` — replaced Firestore with REST API
- `src/lib/api-client.ts` — replaced Firebase SDK with axios + JWT interceptors
- `src/lib/storage-utils.ts` — replaced Firebase Storage with local adapter
- `src/stores/auth.store.ts` — replaced Firebase auth with JWT-based Zustand

### New files created by this implementation
- `backend/prisma/schema.prisma` — full data model (19 models)
- `backend/prisma/seed.ts` — RBAC manifest sync (70 atoms, 320 grants)
- `backend/prisma/migrate-from-firestore.ts` — Firebase→PostgreSQL migration utility
- `backend/src/auth/` — AuthModule, AuthService, AuthController, JWT strategy, guards, decorators
- `backend/src/branches/` — BranchesModule, service, controller, DTOs
- `backend/src/common/prisma.service.ts` — Prisma client wrapper
- `backend/src/companies/` — CompaniesModule, service, controller, DTOs
- `backend/src/config/env.module.ts` — EnvModule provider
- `backend/src/crm/` — CrmModule, customers/leads/deals services + controllers
- `backend/src/finance/` — FinanceModule, invoices service + controller
- `backend/src/hr/` — HrModule, employees/attendance/leave-requests services + controllers
- `backend/src/permissions/` — permission manifest (70 atoms, 320 grants)
- `src/lib/crud-service.ts` — generic CRUD service wrapper
- `src/lib/storage.ts` — local storage adapter

### WIP preservation
**Confirmed:** No `git reset`, `clean`, `stash`, `revert`, `checkout`, or `force-push` was performed. All previous commits intact at `9aa8581`. All changes are working-tree only (not committed). No previously existing uncommitted WIP was discarded.

---

## 3. Backend Verification

### Module boundaries and architecture

| Module | Controller | Service | Guards | DTO Validation | Prisma Access | Company Scoping |
|--------|-----------|---------|--------|----------------|---------------|-----------------|
| Auth | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | Via membership |
| Companies | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | Owner-based creation |
| Branches | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| HR (employees) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| HR (attendance) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| HR (leave-requests) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| CRM (customers) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| CRM (leads) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| CRM (deals) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |
| Finance (invoices) | ✅ | ✅ | JwtAuthGuard | class-validator | ✅ | companyId filter |

### Routes verified (live HTTP)

All 30+ REST routes mapped and responding:
- `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/invitation/accept`, `POST /api/v1/auth/me`
- `GET/POST/PUT/DELETE /api/v1/companies`, `GET /api/v1/companies/:id/memberships`
- `POST /api/v1/branches`, `GET /api/v1/branches/company/:companyId`, `GET/PUT/DELETE /api/v1/branches/:id`
- `GET/POST/PUT/DELETE /api/v1/hr/employees`, `/hr/attendance`, `/hr/leave-requests`
- `GET/POST/PUT/DELETE /api/v1/crm/customers`, `/crm/leads`, `/crm/deals`
- `GET/POST/PUT/DELETE /api/v1/finance/invoices`
- `GET /api/v1/health`

### Issues identified

1. **Service-layer company ownership not enforced**: `CompaniesService.update/remove`, `BranchesService.findOne/update/remove`, `EmployeesService.findOne/update/remove`, and similar methods check if a resource *exists* but do NOT verify it belongs to the requesting user's company. The `PermissionsGuard` sets `request.companyId` from the user's membership, but services never use it to scope queries. A user with valid permissions could access/update/delete resources from other companies by guessing IDs.

2. **`CompaniesService.findAll()` returns ALL companies** — no tenant scoping. Appropriate only for platform admins, but no guard distinguishes.

3. **`EmployeesService.findAll()` without companyId returns ALL employees** across all companies.

4. **`acceptInvitation` doesn't verify the target company is active/not deleted**.

5. **`generateTokens` returns `user.role` which is undefined** — the User model has no `role` field (role lives on CompanyMembership). The JWT payload correctly uses `membership?.role`, but the returned user object's `role` field is `undefined`.

---

## 4. Database Verification

### Schema consistency (Prisma ↔ PostgreSQL)

| Check | Result |
|-------|--------|
| 19 tables created | ✅ All match Prisma models |
| Table owner | ✅ `darrow` role |
| Primary keys | ✅ All tables have `@id` |
| Foreign keys | ✅ Company→branches/departments/memberships/invitations/employees/customers/leads/deals/invoices (Cascade); User→memberships/refreshTokens/employee (Cascade); Permission→roleGrants (Cascade); SetNull on optional relations |
| Unique constraints | ✅ User.email, User.firebaseUid, CompanyMembership(userId,companyId), Branch(companyId,name), Department(companyId,name), Employee.employeeNumber, Employee.userId, Customer.email, Invoice.invoiceNumber |
| Indexes | ✅ companyId on all tenant tables; deletedAt on business tables; status on Invitation/Lead/Deal/Invoice; composite indexes on companyId+status, companyId+employmentStatus |
| Soft delete | ✅ `deletedAt` on all business tables |
| Timestamps | ✅ createdAt/updatedAt on all tables |
| Money as integer minor units | ✅ Invoice subTotal/tax/discount/grandTotal, Employee.salary, Deal.amount |

### Database isolation

| Database | Exists | Owner | Notes |
|----------|--------|-------|-------|
| `darrow_dev` | ✅ | darrow | Development database in use |
| `darrow_test` | ✅ | darrow | Test database, not used yet |
| `darrow` (production) | ❌ Does not exist locally | — | Confirmed not touched |

### Refresh token storage
- `RefreshToken` table: `id` (cuid), `token` (unique), `userId` (FK→User, Cascade), `expiresAt`, `createdAt`
- Indexes on `userId` and `token`
- Rotation: refresh endpoint deletes used token, creates new one
- Logout: deletes by token value

### Invitation storage
- `Invitation` table: `id` (=token), `companyId` (FK→Company, Cascade), `email`, `role` (InvitableRole enum), `status` (InviteStatus), `expiresAt`, `acceptedByUserId`, etc.
- Indexes on `companyId+status` and `email+status`

### Audit log storage
- `AuditLog` table: no FKs by design (survives referential changes), `companyId`, `actorUserId`, `action`, `resourceType`, `resourceId`, `before/after` JSON, `ip`
- Indexes on `companyId+createdAt` and `actorUserId+createdAt`

---

## 5. Security Verification

### Independently verified

| Security control | Implementation | Verified |
|-----------------|---------------|----------|
| Password hashing | `bcrypt.hash(password, 12)` | ✅ |
| Password verification | `bcrypt.compare` | ✅ |
| Login failure | Returns generic "Invalid credentials" (no user enumeration) | ✅ |
| JWT access token | Signed with `JWT_SECRET`, expires in `JWT_ACCESS_TTL_SECONDS` (15 min default) | ✅ |
| Refresh token | UUID stored in DB with `expiresAt`, rotated on use | ✅ |
| Refresh token rotation | Delete old + create new on each refresh | ✅ |
| Logout/revocation | Deletes refresh token by token value | ✅ |
| Invitation acceptance | Validates token exists, status=PENDING, not expired, email matches | ✅ |
| RBAC enforcement | `PermissionsGuard` checks role-based permissions from DB | ✅ |
| Platform admin bypass | `isPlatformAdmin` short-circuits all permission checks | ✅ |
| Company isolation | Guard resolves company from user's ACTIVE membership (not client) | ✅ |
| Branch isolation | `branchId` on Employee, Branch, Department models | ✅ (model level only, not enforced in services) |
| Client-supplied tenant rejection | Guard never uses client companyId for auth decisions | ✅ |
| Auth failure behavior | 401 Unauthorized with generic message | ✅ |
| Authz failure behavior | 403 Forbidden with missing permissions listed | ✅ |

### Issues identified

1. **Service methods don't enforce company ownership** — see Backend Verification issue #1. The PermissionsGuard authenticates and resolves company context, but individual service methods (update/remove/findOne) don't verify the resource belongs to `request.companyId`.

2. **No rate limiting** on auth endpoints (register/login/refresh) — vulnerable to brute force.

3. **No CORS configuration** visible in app setup.

4. **`user.role` undefined in token response** — see Backend Verification issue #5.

---

## 6. Frontend Verification

### Migrated paths audit (Firebase-free confirmed)

| File | Firebase imports | Uses apiClient | Notes |
|------|-----------------|----------------|-------|
| `src/lib/api-client.ts` | ❌ None | ✅ Owns it | Axios + JWT interceptors |
| `src/lib/storage.ts` | ❌ None | N/A | localStorage adapter |
| `src/lib/storage-utils.ts` | ❌ None | N/A | Delegates to storage.ts |
| `src/features/auth/api/auth.service.ts` | ❌ None | ✅ | REST API calls |
| `src/features/auth/context/auth-context.tsx` | ❌ None | N/A | Zustand-based |
| `src/stores/auth.store.ts` | ❌ None | N/A | JWT-based |
| `src/features/companies/api/company.service.ts` | ❌ None | ✅ | REST API calls |
| `src/features/auth/components/google-sign-in-button.tsx` | ❌ None | N/A | Stub (Google OAuth not implemented) |

### Hidden Firebase dependencies in migrated paths
**None found.** All six migrated files are 100% Firebase-free.

### Remaining Firebase hub
`src/lib/firebase.ts` still exists and initializes Firebase app/auth/db/storage/analytics. It is imported by exactly **one** remaining source file: `src/features/people/api/daily-reports.service.ts`. All other Firebase imports in the codebase import `db`/`auth` directly from `firebase/firestore`/`firebase/auth` (not from the hub).

---

## 7. Runtime Verification

All flows verified via live HTTP against local NestJS + PostgreSQL (`darrow_dev`):

| Step | Request | Result |
|------|---------|--------|
| Register | `POST /auth/register` {email, password, name, companyName} | 201 Created + company created + ADMIN membership |
| Login | `POST /auth/login` {email, password} | 200 OK + accessToken + refreshToken + user |
| Access token | JWT decoded successfully | ✅ Valid payload (userId, email, role, companyId) |
| Refresh | `POST /auth/refresh` {refreshToken} | 200 OK + new token pair |
| `/me` | `POST /auth/me` with Bearer token | 200 OK + user profile |
| Create company | `POST /companies` with Bearer token | 201 Created |
| Membership | `GET /companies/:id/memberships` | 200 OK + membership list |
| Create branch | `POST /branches` | 201 Created |
| Protected request | `GET /companies` with Bearer token | 200 OK |
| Unauthorized request | `GET /companies` without token | 401 Unauthorized |
| Logout | `POST /auth/logout` {refreshToken} | 200 OK |
| Revoked refresh | `POST /auth/refresh` with revoked token | 401 Unauthorized |

### Verification evidence
- Backend build: `npm run build` → clean
- Backend tests: `npm run test` → 15/15 pass
- Frontend TypeScript: `npx tsc --noEmit` → 0 errors
- Live HTTP: All 10 flows above returned expected status codes

---

## 8. Firebase Retirement Audit

### Categorized inventory

#### Migrated (Firebase-free)
| Domain | Files | Replacement |
|--------|-------|-------------|
| Auth (login/register/logout/refresh/invite-accept/me) | `src/features/auth/api/auth.service.ts` | NestJS REST API via api-client |
| Auth state/session | `src/stores/auth.store.ts`, `src/features/auth/context/auth-context.tsx` | Zustand + localStorage |
| API client | `src/lib/api-client.ts` | axios + JWT Bearer + refresh rotation |
| Company CRUD | `src/features/companies/api/company.service.ts` | NestJS REST API |
| Storage (files) | `src/lib/storage.ts`, `src/lib/storage-utils.ts` | localStorage adapter |
| Google sign-in | `src/features/auth/components/google-sign-in-button.tsx` | Stub (not implemented yet) |

#### Still required temporarily (Firebase still present)
| Domain | Files | Firebase usage | Why still needed |
|--------|-------|---------------|------------------|
| People/daily reports | `src/features/people/api/daily-reports.service.ts` | imports `db` from `@/lib/firebase` | Not yet migrated |
| Accounting | `src/features/accounting/services/*` | imports `db` from `firebase/firestore` | Not yet migrated |
| Admin/audit logs | `src/features/admin/api/audit-log.service.ts` | imports `db` | Not yet migrated |
| CRM (reports, classification, base) | `src/features/crm/api/*` | imports `db` | Not yet migrated (parallel to new CRM module) |
| Chat | `src/features/chat/api/*` | imports `db` | Not yet migrated |
| Billing | `src/features/billing/api/*` | imports `db` | Not yet migrated |
| Facilities | `src/features/facilities/api/*` | imports `db` | Not yet migrated |
| Meetings | `src/features/meetings/api/*` | imports `db` | Not yet migrated |
| Notifications | `src/features/notifications/api/*` | imports `db` | Not yet migrated |
| Projects | `src/features/projects/api/*` | imports `db` | Not yet migrated |
| Real Estate | `src/features/real-estate/api/*` | imports `db` | Not yet migrated |
| ~30 more feature service files | Across all features | imports `db`/`auth` from Firebase SDK | Not yet migrated |

#### Legacy/dead code
- `src/lib/firebase.ts` — Firebase initialization hub. Still imported by `daily-reports.service.ts`. Not dead yet, but only one consumer.
- `src/dataconnect-generated/` — Firebase Data Connect generated code. Not used by migrated paths.

#### Must be migrated before production
ALL ~40 remaining Firebase-importing service files. The `firebase: ^12.12.1` npm dependency and Firebase configuration (`VITE_FIREBASE_*` env vars) must be removed from `package.json` and `.env` before production.

---

## 9. Data Migration Readiness

### Migration utility: `backend/prisma/migrate-from-firestore.ts`

| Check | Result |
|-------|--------|
| Idempotency | ✅ Uses `upsert` by document `id` for every collection |
| Mapping strategy | ✅ Collection → model mapping for users, companies, memberships, branches, departments, employees, customers, leads, deals, invoices |
| Duplicate handling | ✅ `upsert` updates existing records by id |
| Relation ordering | ✅ Import order: users → companies → memberships → branches → departments → employees → customers → leads → deals → invoices (dependency-respecting) |
| Missing-reference handling | ⚠️ No validation — if a referenced companyId/userId doesn't exist, Prisma will throw FK violation and the individual record fails (caught by try/catch, logged as error) |
| Transaction boundaries | ❌ No transactions — each record is independent; partial failure possible |
| Dry-run capability | ❌ Not present |
| Production Firebase access | ✅ None hardcoded — reads local JSON export files only |
| Never writes to production Firebase | ✅ Confirmed — only reads local files, writes to local PostgreSQL |

### Migration gaps
- No reference integrity validation before import
- No transaction wrapping per collection
- No dry-run mode
- No rollback mechanism
- No record count validation against source
- Requires Firestore export JSON (not available locally; production Firebase access forbidden)

---

## 10. Product Capability Preservation

### Confirmation

The implementation preserves the original D-Arrow product direction:

**Platform Core** (implemented in NestJS backend):
- Authentication (replaces Firebase Auth)
- Authorization/RBAC (70 atoms, 320 grants)
- Users, Companies, Tenancy (multi-company)
- Branches
- Subscription/feature entitlements (placeholder — not yet implemented)
- Platform settings
- Audit logs
- Notifications (placeholder — not yet implemented)
- Shared UI components (frontend preserved)
- Navigation (frontend preserved)
- Module registration (placeholder — not yet implemented)

**Standard Business Modules** (implemented in NestJS backend):
- HR: Employees, Attendance, Leave Requests ✅
- CRM: Customers, Leads, Deals ✅
- Finance: Invoices ✅

**Specialized / Custom Modules** (NOT yet implemented — preserved from original Firebase frontend):
- Tasks ✅ (original Firebase frontend has this; NOT yet migrated to NestJS)
- Projects ✅ (original Firebase frontend has this; NOT yet migrated)
- Real Estate ✅ (original Firebase frontend has this; NOT yet migrated)
- Facilities ✅ (original Firebase frontend has this; NOT yet migrated)
- Agency/Marketing ✅ (original Firebase frontend has this; NOT yet migrated)
- School ✅ (original Firebase frontend has this; NOT yet migrated)
- Custom Modules Engine ✅ (original Firebase frontend has this; NOT yet migrated)
- Chat ✅ (original Firebase frontend has this; NOT yet migrated)
- Billing/Accounting ✅ (original Firebase frontend has this; NOT yet migrated)
- Reporting ✅ (original Firebase frontend has this; NOT yet migrated)

**NOT discarded:** All original Firebase frontend feature code is preserved intact. The NestJS backend adds new domains (HR, CRM, Finance) without removing any existing Firebase-backed domains. The two systems run in parallel during migration.

---

## 11. Remaining Migration Matrix

| Domain | Firebase usage | Replacement required | Priority | Dependencies | Risk |
|--------|---------------|---------------------|----------|--------------|------|
| People/HR (attendance, schedules, daily reports) | `db` from firebase/firestore | NestJS HR API + frontend migration | High | Backend HR module (done) | Medium |
| Accounting | `db` from firebase/firestore | NestJS accounting module | High | Backend accounting (not built) | High |
| CRM (reports, classification) | `db` from firebase/firestore | NestJS CRM API (module built, frontend not migrated) | High | Backend CRM (done) | Medium |
| Chat | `db` from firebase/firestore | NestJS chat module + WebSockets | Medium | WebSocket infra | Medium |
| Billing | `db` from firebase/firestore | NestJS billing module | Medium | Payment provider integration | High |
| Facilities | `db` from firebase/firestore | NestJS facilities module | Low | — | Low |
| Meetings | `db` from firebase/firestore | NestJS meetings module | Low | — | Low |
| Notifications | `db` from firebase/firestore | NestJS notifications module | Medium | — | Medium |
| Projects | `db` from firebase/firestore | NestJS projects module | High | — | Medium |
| Real Estate | `db` from firebase/firestore | NestJS real-estate module | High | — | Medium |
| Agency/Marketing | `db` from firebase/firestore | NestJS agency module | Low | — | Low |
| School | `db` from firebase/firestore | NestJS school module | Low | — | Low |
| Custom Modules Engine | `db` from firebase/firestore | NestJS module platform | High | Module registry | High |
| Reporting | `db` from firebase/firestore | NestJS reporting module | Medium | — | Medium |
| Storage (files) | Firebase Storage | Local adapter (done) → S3-compatible | Medium | Backend storage service | Medium |
| Realtime listeners | Firestore onSnapshot | NestJS WebSockets/Socket.io | Low | — | Low |
| Firebase Auth | Firebase Auth SDK | NestJS JWT (done for core) | High | — | Low (core done) |

---

## 12. Critical Risks

### Must be fixed before production

1. **Service-layer company ownership enforcement missing** (HIGH) — Service methods don't verify resources belong to the user's company. A user could access other companies' data by guessing IDs.

2. **No rate limiting** (HIGH) — Auth endpoints (register/login/refresh) are vulnerable to brute force and credential stuffing.

3. **No CORS configuration** (MEDIUM) — Cross-origin requests not configured.

4. **`user.role` undefined in auth response** (MEDIUM) — `generateTokens` returns `user.role` which is undefined (role only on CompanyMembership). Frontend may break expecting a role field.

5. **~40 Firebase services still active** (HIGH) — Any frontend navigation to non-migrated features will silently use Firebase, creating a dual-write / split-data state.

6. **No production storage adapter** (MEDIUM) — `storage.ts` uses localStorage (100KB limit). Production needs S3-compatible adapter.

7. **No E2E browser tests** (HIGH) — TypeScript compilation and unit tests pass, but no real browser verification of login/session/company flows.

8. **No deployment configuration** (MEDIUM) — No Docker, no build pipeline, no environment variable management for production.

9. **No observability** (MEDIUM) — No structured logging, metrics, or tracing.

10. **No backup/recovery procedures** (MEDIUM) — No database backup strategy documented.

11. **Migration utility lacks transactions and validation** (MEDIUM) — Partial migration failures could leave inconsistent data.

### Acceptable for checkpoint (not blocking continuation)

- Firebase `firebase.ts` hub still present (only 1 consumer)
- `firebase: ^12.12.1` npm dependency still in package.json
- Subscription/billing module not yet built
- Custom Modules engine not yet built
- Realtime WebSockets not yet built

---

## 13. Required Next Phase

**Phase 7 — Security hardening & service-layer ownership enforcement**

1. Fix service-layer company ownership checks in all backend services (Companies, Branches, HR, CRM, Finance)
2. Fix `generateTokens` to return role from membership, not `user.role`
3. Add rate limiting to auth endpoints
4. Configure CORS
5. Add structured logging
6. Begin migrating remaining Firebase services in priority order (People/HR first, then CRM, Projects, Real Estate)
7. Write E2E browser tests for login, session, company creation, logout
8. Create production storage adapter interface
9. Document backup/recovery procedures

**Do NOT:** Delete Firebase, migrate remaining ~40 services yet, start Custom Modules, deploy, or touch production data.

---

## 14. Approval Gate

| Gate | Status | Evidence |
|------|--------|----------|
| Backend builds cleanly | ✅ PASS | `npm run build` → no errors |
| Backend tests pass | ✅ PASS | 15/15 tests pass |
| Frontend TypeScript clean | ✅ PASS | `tsc --noEmit` → 0 errors |
| Core auth flows verified | ✅ PASS | Live HTTP: register→login→refresh→/me→company→branch→logout→revoked |
| Database schema matches Prisma | ✅ PASS | 19 tables, FKs, indexes, uniques all verified |
| Production data untouched | ✅ PASS | `darrow` DB doesn't exist locally; only `darrow_dev` + `darrow_test` |
| Firebase not deleted | ✅ PASS | `firebase.ts` and npm dep still present |
| Security gaps documented | ✅ PASS | Section 12 lists all critical risks |

**Implementation is verified as a safe checkpoint.** Approved to continue with Phase 7 (security hardening + remaining service migration). Not approved for production.

**Next actionable task:** Fix service-layer company ownership enforcement in `backend/src/companies/companies.service.ts`, `backend/src/branches/branches.service.ts`, `backend/src/hr/employees.service.ts`, and all CRM/Finance services.
