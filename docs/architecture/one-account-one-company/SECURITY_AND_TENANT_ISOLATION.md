# SECURITY_AND_TENANT_ISOLATION.md

## Threat Model

| Threat | Description | Current Status | Required Control |
|--------|-------------|----------------|------------------|
| T1 | User A accesses Company B resource by guessing ID | ✅ Mitigated — all services scope by `companyId` from authenticated context | Maintain `findFirst({ where: { id, companyId } })` pattern |
| T2 | User A creates resource in Company B by supplying `companyId` in request body | ✅ Mitigated — services compare `data.companyId !== requestingUserCompanyId` | Maintain ownership check on create |
| T3 | User has memberships in two companies, JWT returns Company B context | ❌ NOT MITIGATED — `findFirst` non-deterministic, no DB uniqueness | Enforce `@@unique([userId])` on CompanyMembership |
| T4 | User accepts invitation to Company B while already member of Company A | ❌ NOT MITIGATED — `acceptInvitation()` creates membership without checking existing memberships | Add pre-check for existing active membership |
| T5 | Stale refresh token restores access after membership removal | ⚠️ PARTIAL — `generateTokens` re-resolves from DB on refresh, but old token may return different company | Delete all refresh tokens on membership change/removal |
| T6 | Client-supplied `companyId` overrides authenticated tenant context | ✅ Mitigated — guard derives companyId from DB, ignores client input | Maintain current pattern |
| T7 | Employee record in different company than user's membership | ❌ NOT MITIGATED — `Employee.companyId` independent of `CompanyMembership.companyId` | Add consistency check on employee creation/update |
| T8 | Stale JWT role claim authorizes after role change | ⚠️ PARTIAL — JWT contains role claim, PermissionsGuard re-queries DB permissions | Consider re-verifying role in PermissionsGuard |
| T9 | Platform admin accesses any company | ✅ INTENTIONAL — `isPlatformAdmin` bypasses company scoping | Document as separate platform-level access model |

## Attack Surfaces

### AS1 — Invitation Acceptance Flow (`auth.service.ts:139-200`)

The `acceptInvitation` method creates a `CompanyMembership` without checking if the user already has an active membership. This is the primary vector for violating One Account = One Company.

**Attack:** User A is a member of Company A. User A receives (or guesses) an invitation token for Company B. User A accepts the invitation. User A now has memberships in both Company A and Company B.

**Required fix:** Before creating membership, query `CompanyMembership.findFirst({ where: { userId: user.id, status: "ACTIVE" } })`. If a membership exists, reject with `403 Forbidden`.

### AS2 — Registration Flow (`auth.service.ts:42-103`)

Registration with `companyName` creates a company + membership. If registration is called twice with the same email (blocked by email uniqueness) — safe. But if registration is called without `companyName` (no company created), then `acceptInvitation` adds a membership — this creates the one-company scenario correctly, but only if invite accept enforces uniqueness.

**Required fix:** If `companyName` is provided, the user's single membership is created. If not, the user has zero memberships until they accept an invitation. Both paths must end with exactly one active membership.

### AS3 — Token Generation (`auth.service.ts:202-240`)

`generateTokens` uses `findFirst` without `orderBy`. If multiple memberships exist (due to T4), the JWT company context is non-deterministic.

**Required fix:** With `@@unique([userId])` enforced at DB level, `findFirst` returns at most one row. Change to `findUnique({ where: { userId } })` for clarity and intent.

### AS4 — PermissionsGuard (`permissions.guard.ts:50-52`)

Same `findFirst` pattern. Resolves tenant context from whichever active membership is found first.

**Required fix:** Change to `findUnique({ where: { userId } })` once DB uniqueness is enforced.

### AS5 — Employee ↔ Membership Consistency (`hr/employees.service.ts:43-86`)

Employee creation accepts `companyId` and `userId` independently. No check that the user's membership company matches the employee's company.

**Required fix:** After checking the user exists, verify that the user's active membership `companyId` matches `data.companyId`. Or, derive `companyId` from the user's membership rather than accepting it as input.

## Required Authorization Rules

| Rule | Statement | Enforcement Point |
|------|-----------|-------------------|
| AR1 | Every authenticated request resolves exactly one company from the user's active membership. | `PermissionsGuard` → `findUnique({ where: { userId } })` |
| AR2 | No request may access resources outside `request.companyId`. | All services: `findFirst({ where: { id, companyId } })` |
| AR3 | Create operations reject `data.companyId != request.companyId`. | All service `create()` methods |
| AR4 | Invitation acceptance rejects if user already has active membership. | `auth.service.ts:acceptInvitation()` |
| AR5 | Refresh token rotation re-resolves membership from DB. | `auth.service.ts:refresh()` → `generateTokens()` |
| AR6 | Platform admin (`isPlatformAdmin`) bypasses company scoping but is not a company member. | `PermissionsGuard` line 45-47 |
| AR7 | Employee record must belong to same company as user's membership. | `EmployeesService.create()` — cross-check |

## Current Gaps vs Required Controls

| Gap | File | Line | Required Fix |
|-----|------|------|--------------|
| No DB uniqueness on userId in CompanyMembership | `prisma/schema.prisma` | 150 | Add `@@unique([userId])` |
| Invite accept doesn't check existing membership | `backend/src/auth/auth.service.ts` | 182-191 | Pre-check `findUnique({ where: { userId } })` |
| `generateTokens` uses non-deterministic `findFirst` | `backend/src/auth/auth.service.ts` | 203-206 | Change to `findUnique({ where: { userId } })` |
| `PermissionsGuard` uses non-deterministic `findFirst` | `backend/src/auth/guards/permissions.guard.ts` | 50-52 | Change to `findUnique({ where: { userId } })` |
| Employee companyId not checked against membership | `backend/src/hr/employees.service.ts` | 61-64 | Cross-check user's membership companyId |
| Stale refresh tokens after membership change | `backend/src/auth/auth.service.ts` | 119-133 | Delete all user refresh tokens on membership change/removal |

## JWT Claim Trust Model

The JWT contains `role` and `companyId` claims derived from membership at token issuance time. These claims are:

- **Trusted for:** UX gating, initial request routing
- **NOT trusted for:** Authorization decisions — `PermissionsGuard` re-queries `CompanyMembership` from DB on every request
- **NOT trusted for:** Tenant context — guard resolves companyId from DB, not from JWT claim

This is correct and should be maintained. The JWT role/companyId claims are efficiency hints only; the DB is the source of truth.
