# IMPLEMENTATION_ROADMAP.md

## Overview

Incremental, independently verifiable phases to enforce **One Account = One Company**. Each phase has defined scope, files, database impact, security risks, tests, acceptance criteria, and rollback approach.

**Prerequisite:** Phase 3 security hardening is complete and committed (`abd7c3b`). Do not start Phase 4 until explicit approval.

---

## Phase 4.1 — Database Schema Change: Enforce Unique Membership per User

### Scope
- Add `@@unique([userId])` to `CompanyMembership` model in `prisma/schema.prisma`
- Create and apply a Prisma migration

### Files Likely to Change
- `backend/prisma/schema.prisma` (model `CompanyMembership`)
- New migration file under `backend/prisma/migrations/`

### Database Impact
- New unique index on `CompanyMembership.userId`
- Existing data with multiple memberships per user will cause migration failure — requires data audit first

### Security Risks
- Migration fails if existing data violates uniqueness → requires data cleanup before migration
- No runtime risk after migration succeeds

### Tests Required
- Database constraint test: attempt to insert second membership for same user → expect unique violation
- Existing security tests (security.spec.ts) must still pass

### Acceptance Criteria
- `prisma validate` passes
- Migration applies cleanly to `darrow_dev`
- Unique constraint exists in PostgreSQL (`\d "CompanyMembership"`)
- No user has more than one active membership after migration

### Rollback Approach
- Revert migration (`prisma migrate resolve --rolled-back`)
- Remove `@@unique([userId])` from schema
- Re-apply without uniqueness

---

## Phase 4.2 — Existing Data Audit & Reconciliation

### Scope
- Query all users with membership count > 1
- Query all users with membership count = 0 but with Employee records
- Query all Employee records where `Employee.companyId != CompanyMembership.companyId`

### Files Likely to Change
- None (read-only audit script, not committed as application code)
- May require manual data fixups via Prisma scripts

### Database Impact
- Read-only queries; potential UPDATE/DELETE on membership/employee records for cleanup

### Security Risks
- Data cleanup could accidentally remove the wrong membership
- Must preserve the user's primary/intended company

### Tests Required
- Audit script results reviewed by engineer
- Post-cleanup: verify every user has 0 or 1 active membership

### Acceptance Criteria
- Zero users with > 1 active membership
- Zero Employee records with mismatched companyId vs membership
- Documentation of all manual fixups performed

### Rollback Approach
- Data fixups are irreversible; take database backup before cleanup

---

## Phase 4.3 — Registration & Onboarding Changes

### Scope
- `auth.service.ts:register()`: After creating user + company + membership, verify no second membership exists (defense in depth)
- `auth.service.ts:register()`: If `companyName` not provided, user has zero memberships — document onboarding flow

### Files Likely to Change
- `backend/src/auth/auth.service.ts`

### Database Impact
- None (read check only)

### Security Risks
- Registration race: two concurrent registrations with same email → blocked by email uniqueness (already enforced)

### Tests Required
- Unit test: registration with companyName creates exactly one membership
- Unit test: registration without companyName creates zero memberships

### Acceptance Criteria
- Registration never creates more than one membership
- User without company cannot access company-scoped endpoints

### Rollback Approach
- Revert `auth.service.ts` changes

---

## Phase 4.4 — Invitation Flow Changes

### Scope
- `auth.service.ts:acceptInvitation()`: Before creating membership, check if user already has an ACTIVE membership → reject with `403 Forbidden`
- On membership change (create/remove/suspend), delete all user refresh tokens to force re-authentication

### Files Likely to Change
- `backend/src/auth/auth.service.ts`

### Database Impact
- None (read check + optional DELETE on refresh tokens)

### Security Risks
- Invitation race: two concurrent acceptances for same user → DB unique constraint (Phase 4.1) prevents second membership

### Tests Required
- Unit test: acceptInvitation rejects if user already has active membership
- Unit test: acceptInvitation succeeds if user has zero memberships
- Unit test: acceptInvitation deletes all existing refresh tokens for user

### Acceptance Criteria
- No user can gain a second membership via invitation
- Refresh tokens invalidated on membership change

### Rollback Approach
- Revert `auth.service.ts` changes

---

## Phase 4.5 — Authentication & Token Changes

### Scope
- `auth.service.ts:generateTokens()`: Change `findFirst` to `findUnique({ where: { userId } })` — intent clarity now that DB enforces uniqueness
- `auth.service.ts:refresh()`: After rotation, verify new tokens reflect current membership (already does via generateTokens)
- `JwtStrategy.validate()`: Optionally re-verify membership exists and is ACTIVE (defense in depth against stale JWT)

### Files Likely to Change
- `backend/src/auth/auth.service.ts`
- `backend/src/auth/strategies/jwt.strategy.ts`

### Database Impact
- None

### Security Risks
- Stale JWT with old companyId could briefly authorize access until guard re-queries DB (guard already re-queries, so this is mitigated)

### Tests Required
- Unit test: generateTokens uses findUnique (not findFirst)
- Unit test: JWT contains role/companyId from user's single membership
- Integration test: refresh after membership removal returns no company context

### Acceptance Criteria
- JWT role/companyId always matches user's single active membership
- Stale JWT claims do not bypass DB-verified membership check

### Rollback Approach
- Revert service/strategy changes

---

## Phase 4.6 — Authorization Guard Changes

### Scope
- `permissions.guard.ts`: Change `findFirst({ where: { userId, status: "ACTIVE" } })` to `findUnique({ where: { userId } })` — status check still needed since membership may be SUSPENDED/REMOVED

### Files Likely to Change
- `backend/src/auth/guards/permissions.guard.ts`

### Database Impact
- None

### Security Risks
- None beyond existing pattern

### Tests Required
- Unit test: guard rejects user with no membership
- Unit test: guard rejects user with SUSPENDED/REMOVED membership
- Unit test: guard accepts user with ACTIVE single membership

### Acceptance Criteria
- Guard resolves company from single membership deterministically
- Non-ACTIVE memberships rejected

### Rollback Approach
- Revert guard changes

---

## Phase 4.7 — Employee ↔ Membership Consistency

### Scope
- `hr/employees.service.ts:create()`: After verifying user exists, cross-check that user's active membership `companyId` matches `data.companyId`
- Option: derive `companyId` from user's membership instead of accepting as input

### Files Likely to Change
- `backend/src/hr/employees.service.ts`

### Database Impact
- None

### Security Risks
- Employee record in wrong company → data isolation breach

### Tests Required
- Unit test: employee creation rejects if user's membership company != data.companyId
- Unit test: employee creation succeeds when companies match

### Acceptance Criteria
- Employee.companyId always matches user's membership.companyId

### Rollback Approach
- Revert service changes

---

## Phase 4.8 — Frontend Changes

### Scope
- Verify `auth.types.ts` User interface matches backend response (companyId, companyName — already present)
- Verify no company switching UI exists (already confirmed — none found)
- Verify auth store handles null companyId (user with zero memberships)

### Files Likely to Change
- `src/features/auth/types/auth.types.ts` (if needed)
- `src/stores/auth.store.ts` (if needed)

### Database Impact
- None

### Security Risks
- Frontend assumes companyId exists; user with zero memberships could cause UI errors

### Tests Required
- Frontend typecheck passes
- Unit test: auth store handles user with null companyId gracefully

### Acceptance Criteria
- Frontend compiles and handles zero-membership users

### Rollback Approach
- Revert frontend changes

---

## Phase 4.9 — Legacy Firebase Considerations

### Scope
- Data import from Firebase must map each Firebase user to exactly one company
- If a Firebase user has documents in multiple companies, flag for manual review — do not auto-create multiple memberships

### Files Likely to Change
- `backend/prisma/migrate-from-firestore.ts` (import logic)

### Database Impact
- Write during import; must respect `@@unique([userId])`

### Security Risks
- Import violating uniqueness → import failure
- Import creating mismatched Employee.companyId → isolation breach

### Tests Required
- Import script dry-run on sample data
- Verify imported users have 0 or 1 membership

### Acceptance Criteria
- All imported users comply with one-account-one-company
- No import-time unique constraint violations

### Rollback Approach
- Import is incremental; failed imports can be rolled back by deleting imported records

---

## Phase 4.10 — Automated Tests & Regression

### Scope
- Add all test cases from `TEST_STRATEGY.md`
- Run full backend test suite
- Run frontend typecheck

### Files Likely to Change
- `backend/src/security/security.spec.ts` (add one-account-one-company tests)
- New test files as needed

### Database Impact
- Test database (`darrow_test`) only

### Security Risks
- None

### Tests Required
- All test cases from TEST_STRATEGY.md

### Acceptance Criteria
- All tests pass
- Build clean
- Typecheck clean

### Rollback Approach
- Revert test file changes

---

## Phase Summary Table

| Phase | Scope | DB Change | Risk | Depends On |
|-------|-------|-----------|------|------------|
| 4.1 | Schema uniqueness | ✅ Yes | Migration failure if dirty data | Phase 3 complete |
| 4.2 | Data audit | Read + potential cleanup | Data loss if wrong fixup | 4.1 |
| 4.3 | Registration | No | Low | 4.1 |
| 4.4 | Invitation flow | No | Low | 4.1, 4.3 |
| 4.5 | Auth/tokens | No | Low | 4.1 |
| 4.6 | Authorization guard | No | Low | 4.1 |
| 4.7 | Employee consistency | No | Low | 4.1 |
| 4.8 | Frontend | No | Low | 4.1 |
| 4.9 | Firebase import | Write during import | Medium | 4.1, 4.2 |
| 4.10 | Tests | Test DB only | None | All above |

## Rollback Strategy (Entire Phase 4)

1. Revert all application code changes (git revert commits)
2. Revert Prisma schema (remove `@@unique([userId])`)
3. Rollback database migration (`prisma migrate resolve --rolled-back`)
4. Data fixups from 4.2 are irreversible — database backup required before

## Go/No-Go Criteria

**GO:** All phases 4.1–4.10 complete, all tests pass, zero users with > 1 membership, build clean, typecheck clean.

**NO-GO:** Any user with > 1 membership unresolved, migration fails, security tests fail, build/typecheck fails.
