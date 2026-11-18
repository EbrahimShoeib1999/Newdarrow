# TEST_STRATEGY.md

## Test Matrix

### Unit Tests (service layer, mocked Prisma)

| # | Test | Expected Result | File |
|---|------|-----------------|------|
| U1 | `acceptInvitation` rejects when user already has active membership | `403 Forbidden` | `security.spec.ts` |
| U2 | `acceptInvitation` succeeds when user has zero memberships | Membership created, JWT returned | `security.spec.ts` |
| U3 | `generateTokens` uses `findUnique({ where: { userId } })` | Deterministic, single membership | `security.spec.ts` |
| U4 | `PermissionsGuard` resolves company from single membership | `request.companyId` set correctly | `security.spec.ts` |
| U5 | `PermissionsGuard` rejects user with no active membership | `403 Forbidden` | `security.spec.ts` |
| U6 | `PermissionsGuard` rejects SUSPENDED/REMOVED membership | `403 Forbidden` | `security.spec.ts` |
| U7 | `EmployeesService.create` rejects if user's membership company != data.companyId | `403 Forbidden` | `security.spec.ts` |
| U8 | `EmployeesService.create` succeeds when companies match | Employee created | `security.spec.ts` |
| U9 | `register` with companyName creates exactly one membership | Membership count = 1 | `security.spec.ts` |
| U10 | `register` without companyName creates zero memberships | Membership count = 0 | `security.spec.ts` |

### Integration Tests (real database, `darrow_test`)

| # | Test | Expected Result | File |
|---|------|-----------------|------|
| I1 | Create two memberships for same user → second fails | Unique constraint violation (`409` or Prisma `P2002`) | `test/integration/membership.spec.ts` |
| I2 | User with membership in Company A cannot access Company B resource | `404 NotFound` | `test/integration/isolation.spec.ts` |
| I3 | Invitation acceptance by user with existing membership rejected | `403 Forbidden` | `test/integration/invitation.spec.ts` |
| I4 | Refresh token rotation after membership removal returns no company | `companyId: null`, `role: null` | `test/integration/auth.spec.ts` |
| I5 | Employee creation with mismatched companyId rejected | `403 Forbidden` | `test/integration/employee.spec.ts` |

### Database Constraint Tests

| # | Test | Expected Result | File |
|---|------|-----------------|------|
| D1 | Insert second `CompanyMembership` row with same `userId` | PostgreSQL unique violation | `test/db/constraints.spec.ts` |
| D2 | `Employee.userId` uniqueness — second employee for same user fails | Unique violation | `test/db/constraints.spec.ts` |

### Security Regression Tests

| # | Test | Expected Result | File |
|---|------|-----------------|------|
| S1 | User A cannot read Company B employee | `404 NotFound` | `security.spec.ts` |
| S2 | User A cannot update Company B invoice | `404 NotFound` | `security.spec.ts` |
| S3 | User A cannot delete Company B customer | `404 NotFound` | `security.spec.ts` |
| S4 | User A cannot attach Company B branch to Company A employee | `403 Forbidden` | `security.spec.ts` |
| S5 | Client-supplied `companyId` cannot override authenticated tenant context | `403 Forbidden` or `404 NotFound` | `security.spec.ts` |
| S6 | Invitation acceptance cannot move existing account between companies | `403 Forbidden` | `security.spec.ts` |
| S7 | Revoked/suspended membership invalidates access | `403 Forbidden` | `security.spec.ts` |
| S8 | Refresh tokens cannot restore access after membership removal | `401 Unauthorized` | `security.spec.ts` |
| S9 | Platform admin behavior separately authorized | `200 OK` for platform endpoints | `security.spec.ts` |
| S10 | Legitimate single-company flows remain functional | `200 OK` | `security.spec.ts` |

### Browser E2E Tests

| # | Test | Expected Result | File |
|---|------|-----------------|------|
| B1 | Login → dashboard shows user's company only | Company name displayed, no company selector | `test/e2e/auth.e2e-spec.ts` |
| B2 | Register with company → auto-assigned to that company | Dashboard loads with company context | `test/e2e/auth.e2e-spec.ts` |
| B3 | Accept invitation → joined inviting company | Dashboard loads with inviting company | `test/e2e/invitation.e2e-spec.ts` |
| B4 | Logout → refresh token cleared, cannot refresh | `401 Unauthorized` on refresh attempt | `test/e2e/auth.e2e-spec.ts` |

## Test Classification

| Type | Location | Database | Mock Prisma | Purpose |
|------|----------|----------|-------------|---------|
| Unit | `backend/src/security/security.spec.ts` | No | Yes | Fast feedback on service logic |
| Integration | `backend/test/integration/` | `darrow_test` | No | Verify DB queries and cross-service behavior |
| Database constraint | `backend/test/db/constraints.spec.ts` | `darrow_test` | No | Verify schema constraints enforced |
| Security regression | `backend/src/security/security.spec.ts` | No | Yes | Verify no regressions in tenant isolation |
| Browser E2E | `backend/test/e2e/` | `darrow_dev` (or test) | No | Verify real user flows in browser |

## Acceptance Criteria for Test Suite

- All unit tests pass with mocked Prisma
- All integration tests pass against `darrow_test`
- Database constraint tests confirm `@@unique([userId])` enforced
- All security regression tests pass (no new violations)
- Browser E2E tests pass for core auth flows
- Backend build: clean
- TypeScript typecheck: clean

## Test Data Requirements

| Dataset | Description | Source |
|---------|-------------|--------|
| Company A | `id: "company-a"`, active, not deleted | Seed script |
| Company B | `id: "company-b"`, active, not deleted | Seed script |
| User A | Member of Company A, role ADMIN | Seed script |
| User B | Member of Company B, role EMPLOYEE | Seed script |
| User C | Zero memberships (pending onboarding) | Seed script |
| Refresh tokens | Valid + expired + revoked for each user | Seed script |
