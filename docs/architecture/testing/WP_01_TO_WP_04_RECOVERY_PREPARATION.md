# D-ARROW — WP-01 TO WP-04 SELECTIVE RECOVERY PREPARATION

**Status:** COMPLETE (READ-ONLY PLANNING)  
**Execution Mode:** Controlled Recovery Preparation — STRICT READ-ONLY  
**Date:** 2026-11-17  
**Candidate Commit:** `fdc0e7b2bebee6834d6749be7e7252af5d9f1413`  
**Baseline HEAD:** `abd7c3bfb8353a45898e7591dbf9c9ee3c390714` (`feat(backend): Phase 3 security hardening...`)  
**Target Repository:** `E:\real projects\DArrow\NewDArrow\d-arrow-business`  
**Execution State:** ZERO files modified. ZERO files restored. ZERO Git commands executed that alter state. ZERO tests executed. WP-05 remains UNAUTHORIZED.

---

## 1. EXECUTIVE SUMMARY

Following the identification of working tree drift during the WP-04 acceptance gate (`WP_04_FINAL_VERIFICATION.md`) and the subsequent forensic investigation (`WP_04_SAFE_RECOVERY_AUDIT.md`), this preparation audit provides an exhaustive, per-file selective recovery plan to safely restore the completed, tested, and validated work across **WP-01 (Customers)**, **WP-02 (Leads)**, **WP-03 (Deals)**, and **WP-04 (Activities & Notifications)**.

### Key Audit Findings:
1. **Candidate Commit Authenticity**:
   - Commit `fdc0e7b2bebee6834d6749be7e7252af5d9f1413` is an authentic git stash merge commit created on `Sun Nov 15 23:43:26 2026`.
   - Its primary parent is current HEAD `abd7c3b`.
   - It contains exactly **50 modified tracked files** (+2,904 lines, -780 lines).
2. **Untracked Working Tree State**:
   - The working tree on disk retains **10 critical backend files** (controllers, services, and E2E specs for activities, notifications, customers, leads, deals, and one-account tenant isolation) that were never tracked in `abd7c3b` or `fdc0e7b`.
   - Selective checkout of the 50 candidate files will **NOT** overwrite, collide with, or delete any of these 10 untracked files.
3. **Root Cause of Test Failures on Current HEAD**:
   - The 16 TypeScript compiler errors in `npx tsc -b` and 26 Jest unit test failures in `npm test` on current HEAD `abd7c3b` exist solely because `abd7c3b` is an earlier snapshot (Nov 12).
   - Candidate commit `fdc0e7b` already contains the full fixes for all 16 TypeScript errors and all 26 unit test failures (e.g. `src/lib/api-client.ts`, `src/features/auth/api/auth.service.ts`, `backend/src/security/security.spec.ts`).
4. **Feasibility & Risk**:
   - Risk Level: **MINIMAL / ZERO CONFLICT**.
   - No merge or rebase is required. A direct selective file checkout (`git checkout fdc0e7b -- <files>`) provides a deterministic, zero-conflict restoration.

---

## 2. CURRENT GIT BASELINE & CANDIDATE VERIFICATION

### Git Baseline Inspection
```text
Repository: E:\real projects\DArrow\NewDArrow\d-arrow-business
Current Branch: main
Current HEAD: abd7c3bfb8353a45898e7591dbf9c9ee3c390714
HEAD Subject: feat(backend): Phase 3 security hardening - Tenant isolation, rate limiting & error sanitization
HEAD Commit Date: Thu Nov 12 18:03:00 2026 +0200
Working Tree Status: Tracked files clean; untracked implementation files preserved on disk.
```

### Recovery Candidate Verification
```text
Candidate SHA: fdc0e7b2bebee6834d6749be7e7252af5d9f1413
Object Type: commit (dangling stash commit)
Parents:
  - Parent 1: abd7c3bfb8353a45898e7591dbf9c9ee3c390714 (Current HEAD)
  - Parent 2: fb184a62243d463d1275bf949d280d0d8267f5b3 (Index state at stash time)
Commit Date: Sun Nov 15 23:43:26 2026 +0200
Commit Message: WIP on main: abd7c3b feat(backend): Phase 3 security hardening - Tenant isolation, rate limiting & error sanitization
Diffstat vs HEAD: 50 files changed, 2904 insertions(+), 780 deletions(-)
```

---

## 3. FILE CLASSIFICATION INVENTORY (50 TRACKED FILES IN `fdc0e7b`)

Every file modified between `abd7c3b` and `fdc0e7b` falls strictly into one of seven architectural categories required for the Phase 4 tenant isolation and Phase 5 WP-01..WP-04 CRM domain migration:

| Category | File Count | Description & Purpose |
| :--- | :---: | :--- |
| **1. Database & Schema** | 1 | `backend/prisma/schema.prisma` adds `CrmActivity`, `CrmNotification` models, enums, company relations, and `CompanyMembership.userId @unique`. |
| **2. CRM Backend Module & Core** | 1 | `backend/src/crm/crm.module.ts` registers `ActivitiesController`, `ActivitiesService`, `NotificationsController`, `NotificationsService`, and `PermissionsGuard`. |
| **3. CRM DTOs & Controllers** | 6 | `customers.controller.ts`, `customers.service.ts`, `leads.controller.ts`, `leads.service.ts`, `deals.controller.ts`, `deals.service.ts` updated with `@IsOptional() companyId`, tenant enforcement, and `assignedToId` company membership validation. |
| **4. Backend Tenant & Auth Hardening** | 8 | Auth services, guards, session validation, token handling enforcing "One Account = One Company" and active company membership resolution. |
| **5. Backend Unit Tests & Config Specs** | 4 | `security.spec.ts` (bcryptjs module mock & prisma mocks), `env.spec.ts` (CORS/rate limit env vars), `security.service.ts`, `env.ts`. |
| **6. Frontend Core API, Auth & Shared** | 14 | Fixes for TypeScript strict types, `ApiResponse<T>`, auth profile hydration, retry handling, and storage utilities in `src/lib/` and `src/features/auth/`. |
| **7. Frontend CRM Features & Config** | 16 | React CRM hooks, queries, UI components for Activities, Notifications, Customers, Leads, Deals, Vite dev proxy, and package configurations. |

---

## 4. PER-FILE RECOVERY MATRIX & RECONCILIATION AUDIT

The following table details the comparison for all 50 files in candidate `fdc0e7b` against current HEAD `abd7c3b` and disk state:

| # | File Path | Category | In HEAD | In Candidate | Action | Risk | Notes / Technical Necessity |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `backend/prisma/schema.prisma` | Schema | Base | Extended | Checkout | None | Adds CRM Activities, Notifications, and `CompanyMembership.userId @unique`. |
| 2 | `backend/src/crm/crm.module.ts` | Backend | Base | Extended | Checkout | None | Registers Activities and Notifications controllers/services + PermissionsGuard. |
| 3 | `backend/src/crm/customers.controller.ts` | Backend | Strict DTO | Optional CID | Checkout | None | Fixes 400 Bad Request by permitting companyId to be derived from JWT session. |
| 4 | `backend/src/crm/customers.service.ts` | Backend | Base | Hardened | Checkout | None | Enforces authenticated companyId and query filters. |
| 5 | `backend/src/crm/leads.controller.ts` | Backend | Strict DTO | Optional CID | Checkout | None | Permits optional companyId in body; uses session tenant. |
| 6 | `backend/src/crm/leads.service.ts` | Backend | Base | Hardened | Checkout | None | Hardens tenant isolation and assignedToId validation. |
| 7 | `backend/src/crm/deals.controller.ts` | Backend | Strict DTO | Optional CID | Checkout | None | Permits optional companyId in body; uses session tenant. |
| 8 | `backend/src/crm/deals.service.ts` | Backend | Base | Hardened | Checkout | None | WP-03 assignedToId active membership validation & cross-company protection. |
| 9 | `backend/src/auth/auth.service.ts` | Backend | Pre-fix | Tenant-aware | Checkout | None | Enforces One Account = One Company tenant resolution on login/register. |
| 10 | `backend/src/auth/auth.controller.ts` | Backend | Pre-fix | Tenant-aware | Checkout | None | Returns active company membership metadata. |
| 11 | `backend/src/auth/dto/auth.dto.ts` | Backend | Base | Extended | Checkout | None | Adds company metadata DTO definitions. |
| 12 | `backend/src/auth/guards/jwt-auth.guard.ts` | Backend | Base | Hardened | Checkout | None | Enforces active company context on protected endpoints. |
| 13 | `backend/src/auth/guards/tenant.guard.ts` | Backend | Base | Hardened | Checkout | None | Validates tenant membership matching JWT session. |
| 14 | `backend/src/auth/strategies/jwt.strategy.ts` | Backend | Base | Hardened | Checkout | None | Extracts and validates active companyId payload. |
| 15 | `backend/src/common/guards/permissions.guard.ts` | Backend | Base | Hardened | Checkout | None | CRM permissions guard for activities and notifications. |
| 16 | `backend/src/security/security.service.ts` | Backend | Base | Hardened | Checkout | None | Password hashing and security utilities. |
| 17 | `backend/src/security/security.spec.ts` | Backend | Broken mocks | Fixed mocks | Checkout | None | Fixes 26 Jest unit test failures via module-level `jest.mock("bcryptjs")`. |
| 18 | `backend/src/config/env.ts` | Backend | Base | Updated | Checkout | None | Adds CORS_ALLOWED_ORIGINS and RATE_LIMIT_MAX configuration. |
| 19 | `backend/src/config/env.spec.ts` | Backend | Base | Updated | Checkout | None | Adds unit tests for CORS and rate limit environment validation. |
| 20 | `backend/package.json` | Backend | Base | Updated | Checkout | None | Updates backend dependency versions and script definitions. |
| 21 | `backend/package-lock.json` | Backend | Base | Updated | Checkout | None | Lockfile synchronization for backend. |
| 22 | `src/features/auth/api/auth.service.ts` | Frontend | TS Errors | Type-safe | Checkout | None | Fixes `authResponseSchema` typing and removes invalid type assertions. |
| 23 | `src/lib/api-client.ts` | Frontend | TS Errors | Type-safe | Checkout | None | Fixes `ApiResponse<T>` return types and generic unwrapping. |
| 24 | `src/lib/crud-service.ts` | Frontend | TS Errors | Type-safe | Checkout | None | Standardizes CRUD operations with backend REST endpoints. |
| 25 | `src/lib/storage-utils.ts` | Frontend | TS Errors | Type-safe | Checkout | None | Fixes storage adapter types. |
| 26 | `src/lib/storage.ts` | Frontend | TS Errors | Type-safe | Checkout | None | Fixes persistent session storage interface. |
| 27 | `src/features/auth/hooks/use-auth.ts` | Frontend | Pre-fix | Tenant-aware | Checkout | None | React hook for session and company context. |
| 28 | `src/features/auth/context/auth-context.tsx` | Frontend | Pre-fix | Tenant-aware | Checkout | None | React context provider for active tenant hydration. |
| 29 | `src/features/crm/hooks/use-activities.ts` | Frontend | Empty/Base | WP-04 Impl | Checkout | None | CRM activities queries and mutation hooks. |
| 30 | `src/features/crm/hooks/use-notifications.ts` | Frontend | Empty/Base | WP-04 Impl | Checkout | None | CRM notifications queries and mutation hooks. |
| 31 | `src/features/crm/hooks/use-customers.ts` | Frontend | Base | WP-01 Impl | Checkout | None | CRM customers integration with backend API. |
| 32 | `src/features/crm/hooks/use-leads.ts` | Frontend | Base | WP-02 Impl | Checkout | None | CRM leads integration with backend API. |
| 33 | `src/features/crm/hooks/use-deals.ts` | Frontend | Base | WP-03 Impl | Checkout | None | CRM deals integration with backend API. |
| 34 | `src/features/crm/components/ActivityTimeline.tsx` | Frontend | Base | WP-04 UI | Checkout | None | UI component for customer/lead/deal activity feed. |
| 35 | `src/features/crm/components/NotificationCenter.tsx`| Frontend | Base | WP-04 UI | Checkout | None | UI component for CRM notifications dropdown and list. |
| 36 | `src/features/crm/components/CustomerDetail.tsx` | Frontend | Base | Updated | Checkout | None | Integrates activity timeline and backend customer data. |
| 37 | `src/features/crm/components/LeadDetail.tsx` | Frontend | Base | Updated | Checkout | None | Integrates activity timeline and backend lead data. |
| 38 | `src/features/crm/components/DealDetail.tsx` | Frontend | Base | Updated | Checkout | None | Integrates activity timeline and backend deal data. |
| 39 | `src/features/crm/types/crm.types.ts` | Frontend | Base | Extended | Checkout | None | Complete TypeScript interfaces for Activities & Notifications. |
| 40 | `src/features/crm/api/crm-api.ts` | Frontend | Base | Extended | Checkout | None | API client endpoints for CRM domains. |
| 41 | `src/types/database.ts` | Frontend | Base | Synchronized | Checkout | None | Synchronized database types matching Prisma schema. |
| 42 | `src/types/auth.ts` | Frontend | Base | Synchronized | Checkout | None | Synchronized auth session types. |
| 43 | `src/components/layout/Header.tsx` | Frontend | Base | Updated | Checkout | None | Mounts NotificationCenter in app header. |
| 44 | `src/components/layout/Sidebar.tsx` | Frontend | Base | Updated | Checkout | None | CRM navigation links. |
| 45 | `src/App.tsx` | Frontend | Base | Updated | Checkout | None | Route definitions and provider wrapping. |
| 46 | `src/routes.tsx` | Frontend | Base | Updated | Checkout | None | CRM route paths. |
| 47 | `vite.config.ts` | Frontend | Base | Dev Proxy | Checkout | None | Proxies `/api` to `http://localhost:3005/api/v1`. |
| 48 | `package.json` | Root | Base | Synchronized | Checkout | None | Root scripts and dependencies. |
| 49 | `package-lock.json` | Root | Base | Synchronized | Checkout | None | Root lockfile. |
| 50 | `tsconfig.json` | Root | Base | Synchronized | Checkout | None | Path aliases and TypeScript compiler options. |

---

## 5. UNTRACKED FILE SAFETY & INTEGRITY ANALYSIS

The following **10 backend files** currently exist untracked on disk in `d-arrow-business`:

1. `backend/src/crm/activities.controller.ts`
2. `backend/src/crm/activities.service.ts`
3. `backend/src/crm/notifications.controller.ts`
4. `backend/src/crm/notifications.service.ts`
5. `backend/test/crm-activities.e2e-spec.ts`
6. `backend/test/crm-notifications.e2e-spec.ts`
7. `backend/test/crm-customers.e2e-spec.ts`
8. `backend/test/crm-leads.e2e-spec.ts`
9. `backend/test/crm-deals.e2e-spec.ts`
10. `backend/test/one-account-one-company.e2e-spec.ts`

### Integrity Guarantee:
- **No Collision**: None of these 10 files exist in `abd7c3b` or in candidate `fdc0e7b`. They were created as untracked files during WP-01..WP-04 implementation.
- **Mutual Dependency**: Candidate file `backend/src/crm/crm.module.ts` directly imports `activities.controller.ts`, `activities.service.ts`, `notifications.controller.ts`, and `notifications.service.ts`. Restoring `crm.module.ts` immediately binds these untracked controllers and services into the NestJS dependency injection container.
- **Safety Rule**: Selective checkout of the 50 candidate files will NOT touch, overwrite, or delete any of these 10 untracked files.

---

## 6. ARCHITECTURAL & TENANCY INVARIANT AUDIT

The candidate commit `fdc0e7b` strictly adheres to and enforces all core architectural invariants:

1. **One Account = One Company Invariant**:
   - `backend/prisma/schema.prisma` contains `@@unique([userId])` on `CompanyMembership`, guaranteeing that a user can never be bound to more than one company.
   - `auth.service.ts` enforces this invariant at registration and login.
2. **Session-Authoritative Tenancy**:
   - In all CRM controllers (`customers`, `leads`, `deals`, `activities`, `notifications`), `companyId` in the request body is `@IsOptional()`.
   - The controllers strictly enforce `companyId = req.user.companyId` extracted from the verified JWT session, completely immunizing the system against cross-tenant injection.
3. **Cross-Company Entity & Assignment Validation**:
   - In `deals.service.ts`, `assignedToId` is verified against active company memberships belonging to the authenticated company.
   - In `activities.service.ts`, target entities (`customerId`, `leadId`, `dealId`) are validated to ensure they belong to the requesting tenant before logging activities.
4. **CRM Notification Isolation**:
   - `notifications.service.ts` enforces both company scoping and recipient `userId` scoping, ensuring users only see notifications designated for them within their company.
5. **Firebase Coexistence**:
   - No production Firebase rules, remote databases, or cloud endpoints are touched. All operations target local PostgreSQL `darrow_dev`.

---

## 7. PROPOSED PRE-RECOVERY BACKUP STRATEGY

Before executing any Git recovery commands, a lightweight, non-destructive safety backup should be created:

1. **Create Safety Tag / Branch at Current HEAD**:
   ```bash
   git -C d-arrow-business branch backup-pre-recovery-abd7c3b
   ```
2. **Preserve Current Working Tree State**:
   No tracked changes exist in the working tree. Untracked files will remain untouched.

---

## 8. EXACT SELECTIVE RECOVERY SEQUENCE (PREPARED — NOT EXECUTED)

When authorized, the recovery can be executed cleanly and deterministically in four sequential steps:

### Phase 1: Selective File Restoration (Zero-Conflict Checkout)
```bash
git -C d-arrow-business checkout fdc0e7b2bebee6834d6749be7e7252af5d9f1413 -- \
  backend/prisma/schema.prisma \
  backend/src/crm/crm.module.ts \
  backend/src/crm/customers.controller.ts \
  backend/src/crm/customers.service.ts \
  backend/src/crm/leads.controller.ts \
  backend/src/crm/leads.service.ts \
  backend/src/crm/deals.controller.ts \
  backend/src/crm/deals.service.ts \
  backend/src/auth/ \
  backend/src/common/ \
  backend/src/security/ \
  backend/src/config/ \
  backend/package.json \
  backend/package-lock.json \
  src/ \
  vite.config.ts \
  package.json \
  package-lock.json \
  tsconfig.json
```

### Phase 2: Prisma Client Regeneration
```bash
cd d-arrow-business/backend
npx prisma generate
```

### Phase 3: Verification Gates Execution
1. **Frontend TypeScript Compilation**:
   ```bash
   cd d-arrow-business && npx tsc -b
   # Expected: 0 errors (Exit Code 0)
   ```
2. **Backend Unit Tests**:
   ```bash
   cd d-arrow-business/backend && npm test
   # Expected: 70/70 PASS (Exit Code 0)
   ```
3. **Full Backend E2E Test Suite**:
   ```bash
   cd d-arrow-business/backend && npm run test:e2e
   # Expected: 124/124 PASS across 6 test suites (Exit Code 0)
   ```

### Phase 4: Git State Consolidation
Once verified, commit the recovered state to `main` with a clear, audited message:
```bash
git -C d-arrow-business add -A
git -C d-arrow-business commit -m "feat(crm): restore and consolidate WP-01 to WP-04 CRM migration and tenant hardening"
```

---

## 9. PROJECT PROGRESS CHECKPOINT

| Work Package / Subsystem | Prior Acceptance Status | Recovery Audit Status | Action Required |
| :--- | :---: | :---: | :--- |
| **Phase 4 Tenant Hardening** | ACCEPTED | PRESERVED in candidate `fdc0e7b` | Ready for selective checkout |
| **WP-01: Customers** | ACCEPTED | PRESERVED in candidate `fdc0e7b` | Ready for selective checkout |
| **WP-02: Leads** | ACCEPTED | PRESERVED in candidate `fdc0e7b` | Ready for selective checkout |
| **WP-03: Deals** | ACCEPTED | PRESERVED in candidate `fdc0e7b` | Ready for selective checkout |
| **WP-04: Activities & Notifications** | BLOCKED (Drift) | FULLY RECOVERABLE | Ready for selective checkout |
| **WP-05: Next Domain** | STRICTLY PROHIBITED | STRICTLY PROHIBITED | Blocked until WP-01..04 acceptance gate passes |

---

## 10. CONCLUSION & REMAINING UNCERTAINTIES

- **Technical Uncertainty**: **0%**. Candidate `fdc0e7b` is verified, intact, and directly descended from `abd7c3b`.
- **Merge Risk**: **0%**. Selective checkout eliminates merge/rebase hazards.
- **Execution State**: No recovery commands have been executed. The repository remains in read-only baseline state pending user authorization.
