# CURRENT_STATE_AUDIT.md

## Repository Snapshot

| Item | Value |
|------|-------|
| Repository root | `E:\real projects\DArrow\NewDArrow\d-arrow-business` |
| Current branch | `main` |
| Current HEAD | `abd7c3b` — `feat(backend): Phase 3 security hardening — tenant isolation, JWT/membership model, rate limiting, CORS` |
| Working tree | One uncommitted change: `backend/package-lock.json` (generated artifact, not committed) |
| Pre-existing uncommitted work | None beyond `package-lock.json` |

## Previous Reports Referenced

- `docs/transformation/phase-1/03-rbac-and-tenancy.md` — RBAC & tenancy design (approved 2026-11-11)
- `docs/transformation/reports/PHASE-3-CHECKPOINT.md` — Phase 3 completion checkpoint
- `docs/transformation/reports/PHASE-3-SECURITY-HARDENING-REPORT.md` — Phase 3 security report
- `docs/transformation/reports/POST-IMPLEMENTATION-VERIFICATION.md` — Post-implementation verification gate

## Database Schema Audit (Prisma)

**File:** `backend/prisma/schema.prisma`

### Model Cardinality Findings

| Model | User→Company Cardinality | Enforcement |
|-------|-------------------------|-------------|
| `User.memberships` | One-to-many (`CompanyMembership[]`) | **NOT ENFORCED** — no unique constraint on `userId` alone |
| `CompanyMembership` | Junction table | `@@unique([userId, companyId])` only — permits multiple companies per user |
| `CompanyMembership.userId` | FK → User.id, Cascade | Indexed but not unique |
| `Employee.userId` | One-to-one | `@unique` — one employee record per user |
| `Employee.companyId` | FK → Company.id | Independent of `CompanyMembership.companyId` |

### Violations of One Account = One Company

**V1 — Multiple memberships permitted at schema level** (`schema.prisma:150`):
```prisma
@@unique([userId, companyId])
```
Only the pair is unique. A user can have memberships in Company A and Company B simultaneously. **NOT VERIFIED at runtime but structurally permitted.**

**V2 — No `User.companyId` direct field** (`schema.prisma:68-92`):
The `User` model has no `companyId` field. Company relationship exists only transitively through `CompanyMembership`. This means any code path that reads `user.companyId` (frontend expects it per `auth.types.ts:20`) must resolve it through a membership query.

**V3 — `Employee.companyId` independent of membership** (`schema.prisma:279-280`):
`Employee` has its own `companyId` field and FK to Company. There is no constraint ensuring `Employee.companyId == CompanyMembership.companyId` for the linked user. A user could be a member of Company A but have an Employee record in Company B.

**V4 — `findFirst`-based membership resolution** (non-deterministic):
- `auth.service.ts:203-206` — `generateTokens()` uses `findFirst({ where: { userId, status: "ACTIVE" } })` with no `orderBy`. If a user has multiple memberships, the JWT receives whichever Prisma returns first.
- `permissions.guard.ts:50-52` — Same `findFirst` pattern for tenant context resolution.

## Authentication & Authorization Audit

### AuthService (`backend/src/auth/auth.service.ts`)

| Method | Line(s) | Finding | Severity |
|--------|---------|---------|----------|
| `register()` | 42-103 | Creates user; if `companyName` provided, creates company + membership. Does NOT check if user already has a membership before creating one. However, duplicate registration is blocked by `user.email` uniqueness at line 50-53. | MEDIUM |
| `acceptInvitation()` | 139-200 | **CRITICAL GAP:** Creates membership at line 182-191 without checking if user already has an active membership. An existing user in Company A can accept an invitation to Company B and get a second membership. | HIGH |
| `generateTokens()` | 202-240 | Uses `findFirst` without `orderBy`. Returns role/companyId from whichever active membership is found first. Non-deterministic if multiple memberships exist. | HIGH |
| `refresh()` | 119-133 | Calls `generateTokens(stored.user)` — re-resolves membership from DB. Old refresh tokens issued before a membership change will still work and may return a different company context. | MEDIUM |
| `login()` | 105-117 | Returns `generateTokens(user)` — same membership resolution as register. | MEDIUM |

### PermissionsGuard (`backend/src/auth/guards/permissions.guard.ts`)

| Line(s) | Finding | Severity |
|---------|---------|----------|
| 50-52 | `findFirst({ where: { userId, status: "ACTIVE" } })` — no `orderBy`, picks arbitrary membership if multiple exist. | HIGH |
| 45-47 | `isPlatformAdmin` short-circuits all company-scoped checks — correct for platform admin model. | OK |
| 59-60 | Attaches `request.companyId` and `request.role` from the single resolved membership. Downstream services trust this value. | OK (if membership is unique) |

### JwtStrategy (`backend/src/auth/strategies/jwt.strategy.ts`)

| Line(s) | Finding | Severity |
|---------|---------|----------|
| 26-52 | Validates user exists and is not deleted. Returns `payload.role` and `payload.companyId` from JWT claims without re-verifying against current DB membership. Stale JWT claims could authorize access after membership change. | MEDIUM |

## Backend Tenant Isolation Audit

All migrated services enforce company scoping on read/update/delete operations. Verified:

| Service | File | findAll scoped | findOne scoped | update scoped | remove scoped | create ownership-verified |
|---------|------|---------------|----------------|---------------|---------------|--------------------------|
| Companies | `src/companies/companies.service.ts` | ✅ (line 55-61) | ✅ (line 63-72) | ✅ (line 74-91) | ✅ (line 93-105) | ✅ (line 28-53) |
| Branches | `src/branches/branches.service.ts` | ✅ (line 51-55) | ✅ (line 57-65) | ✅ (line 67-79) | ✅ (line 81-93) | ✅ (line 22-49) |
| Employees | `src/hr/employees.service.ts` | ✅ (line 88-93) | ✅ (line 95-104) | ✅ (line 106-128) | ✅ (line 130-142) | ✅ (line 43-86) |
| Attendance | `src/hr/attendance.service.ts` | ✅ (line 75-84) | ✅ (line 86-95) | ✅ (line 97-113) | N/A | ✅ (line 30-73) |
| LeaveRequests | `src/hr/leave-requests.service.ts` | ✅ (line 57-67) | ✅ (line 69-78) | ✅ (line 80-95) | N/A | ✅ (line 26-55) |
| Customers | `src/crm/customers.service.ts` | ✅ (line 68-74) | ✅ (line 76-85) | ✅ (line 87-115) | ✅ (line 117-129) | ✅ (line 32-66) |
| Leads | `src/crm/leads.service.ts` | ✅ (line 61-70) | ✅ (line 72-84) | ✅ (line 86-109) | ✅ (line 111-123) | ✅ (line 28-59) |
| Deals | `src/crm/deals.service.ts` | ✅ (line 59-68) | ✅ (line 70-82) | ✅ (line 84-106) | ✅ (line 108-120) | ✅ (line 26-57) |
| Invoices | `src/finance/invoices.service.ts` | ✅ (line 92-98) | ✅ (line 100-109) | ✅ (line 111-137) | ✅ (line 139-151) | ✅ (line 38-90) |

**All services correctly scope by `companyId` derived from `@CurrentUser() user` (set by PermissionsGuard from DB-verified membership).**

**However:** Since the membership is not database-enforced as unique per user, `request.companyId` could theoretically be non-deterministic if multiple memberships exist.

## Frontend Audit

| File | Finding | Severity |
|------|---------|----------|
| `src/features/auth/types/auth.types.ts:20` | `User.companyId: string` — required field, assumes exactly one company. | OK (matches one-company model) |
| `src/features/auth/types/auth.types.ts:21` | `User.companyName: string` — required field. | OK |
| `src/stores/auth.store.ts:30` | Stores `userData` from login/register response, includes `companyId`. | OK |
| `src/features/auth/context/auth-context.tsx:33-36` | Checks for existing session via localStorage `d-arrow-refresh-token`. | OK |
| `src/lib/api-client.ts:70-78` | Refresh token rotation — new tokens from `/auth/refresh` include current company context. | OK |
| No company switching UI found. | No company selector or multi-company UI in auth context. | OK |

## Summary of Current Enforcement Status

| Enforcement Layer | One Account = One Company | Evidence |
|-------------------|---------------------------|----------|
| Database schema | ❌ NOT ENFORCED | `@@unique([userId, companyId])` permits multiple companies per user |
| Backend auth (register) | ⚠️ PARTIAL | Duplicate email blocked, but no membership-existence check |
| Backend auth (invite accept) | ❌ NOT ENFORCED | No check for existing membership before creating new one |
| Backend auth (token generation) | ⚠️ PARTIAL | `findFirst` non-deterministic if multiple memberships |
| Backend authorization guard | ⚠️ PARTIAL | `findFirst` non-deterministic if multiple memberships |
| Backend service layer | ✅ ENFORCED | All services scope by `companyId` from guard |
| Frontend | ✅ CONSISTENT | User type assumes one company, no switching UI |

**Conclusion:** The current implementation does NOT enforce One Account = One Company. The database permits multiple memberships, and the invitation acceptance flow explicitly allows creating a second membership. All service-layer isolation works correctly IF the membership is unique, but that uniqueness is not guaranteed.

## Pre-existing Uncommitted Changes

| File | Status |
|------|--------|
| `backend/package-lock.json` | Modified (generated artifact, not committed) |
