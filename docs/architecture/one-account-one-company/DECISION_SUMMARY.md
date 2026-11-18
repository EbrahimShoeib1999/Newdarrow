# DECISION_SUMMARY.md

## Executive Summary

**Decision:** One Account = One Company — every user account belongs to exactly one company, enforced at the database level via `@@unique([userId])` on `CompanyMembership`, with application-layer enforcement in registration, invitation acceptance, token generation, and authorization guards.

**Recommended Architecture:** Option B — `CompanyMembership` as the authoritative relationship with `@@unique([userId])`. Platform admins remain separate via `User.isPlatformAdmin` flag.

**Current State:** NOT ENFORCED. The database permits multiple memberships per user (`@@unique([userId, companyId])` only). The invitation acceptance flow (`acceptInvitation`) creates memberships without checking for existing memberships. Token generation uses non-deterministic `findFirst`.

**Risk Level:** HIGH — without enforcement, a user could hold memberships in multiple companies, bypassing tenant isolation.

---

## Recommended Target Data Model

### `User` model (unchanged except relationship)
- No `companyId` field on User (company relationship via membership)
- `membership` relation changed from `CompanyMembership[]` to `CompanyMembership?` (one or none)
- `isPlatformAdmin` remains the platform-level access flag

### `CompanyMembership` model (key change)
- `@@unique([userId])` — **the critical constraint**
- `@@unique([userId, companyId])` — retained for backward compatibility
- All existing fields (role, branchId, portalAccess, etc.) unchanged

### Invariant
```
SELECT count(*) FROM "CompanyMembership" WHERE "userId" = ? AND status = 'ACTIVE'
-- Returns 0 or 1, never 2+
```

---

## Critical Findings

| # | Finding | Location | Severity |
|---|---------|----------|----------|
| F1 | No DB uniqueness on `CompanyMembership.userId` — multiple memberships per user permitted | `prisma/schema.prisma:150` | HIGH |
| F2 | `acceptInvitation()` creates membership without checking existing memberships | `backend/src/auth/auth.service.ts:182-191` | HIGH |
| F3 | `generateTokens()` uses non-deterministic `findFirst` without `orderBy` | `backend/src/auth/auth.service.ts:203-206` | HIGH |
| F4 | `PermissionsGuard` uses non-deterministic `findFirst` | `backend/src/auth/guards/permissions.guard.ts:50-52` | HIGH |
| F5 | `Employee.companyId` independent of `CompanyMembership.companyId` — no consistency check | `backend/src/hr/employees.service.ts:61-64` | MEDIUM |
| F6 | Stale refresh tokens not deleted on membership change | `backend/src/auth/auth.service.ts:119-133` | MEDIUM |

## What Is Safe to Implement Next

The following Phase 4 sub-phases can proceed in order without product-owner input:

| Phase | Safe to implement? | Reason |
|-------|-------------------|--------|
| 4.1 Schema uniqueness | ✅ Yes | Purely additive constraint; data audit required first |
| 4.2 Data audit | ✅ Yes | Read-only; fixups require manual review |
| 4.3 Registration changes | ✅ Yes | Defense-in-depth; no behavior change for valid flows |
| 4.4 Invitation flow changes | ✅ Yes | Closes security gap F2 |
| 4.5 Auth/token changes | ✅ Yes | Intent clarification (findFirst → findUnique) |
| 4.6 Authorization guard changes | ✅ Yes | Intent clarification (findFirst → findUnique) |
| 4.7 Employee consistency | ✅ Yes | Closes security gap F5 |
| 4.8 Frontend changes | ✅ Yes | Verification only; no changes expected |
| 4.9 Firebase import | ⚠️ Conditional | Requires data audit results first |
| 4.10 Tests | ✅ Yes | All test cases are new additions |

## Questions Requiring Product-Owner Input

| # | Question | Why It Matters |
|---|----------|----------------|
| Q1 | What happens to a user's data when they are removed from their only company? | Data retention / deletion policy |
| Q2 | Can a user re-join the same company after removal? | Re-onboarding flow |
| Q3 | Should company deletion cascade to remove all memberships, or should memberships remain with deletedAt on company? | Referential integrity policy |
| Q4 | What is the company owner transfer process? | `Company.ownerId` may reference a removed member |
| Q5 | Should suspended users retain their membership (non-ACTIVE) or have it removed? | Access policy during suspension |
| Q6 | Is there a "company owner" concept separate from ADMIN role membership? | `Company.ownerId` field semantics |

---

## Superseded Historical Decisions

| Decision | Status | Replacement |
|----------|--------|-------------|
| Schema comment "Multi-membership-ready [D7]" (`schema.prisma:129-131`) | SUPERSEDED | `@@unique([userId])` enforces one membership per user |
| `findFirst({ where: { userId, status: "ACTIVE" } })` non-deterministic resolution | SUPERSEDED | `findUnique({ where: { userId } })` with status check in application logic |

---

## Next Safe Implementation Phase

**Phase 4.1 — Database Schema Change: Enforce Unique Membership per User**

1. Run data audit (Phase 4.2) to identify users with > 1 membership
2. Resolve any multi-membership users (keep one, remove others)
3. Add `@@unique([userId])` to `CompanyMembership` in `prisma/schema.prisma`
4. Create and apply Prisma migration
5. Verify constraint in PostgreSQL

**Do not proceed without explicit approval.**
