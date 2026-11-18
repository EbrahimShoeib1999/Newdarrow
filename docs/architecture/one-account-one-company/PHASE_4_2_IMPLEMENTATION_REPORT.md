# PHASE_4_2_IMPLEMENTATION_REPORT.md

## 1. Pre-flight Safety Verification

| Check | Result | Evidence |
|-------|--------|----------|
| Repository root | `E:\real projects\DArrow\NewDArrow\d-arrow-business` | VERIFIED |
| Git branch | `main` | VERIFIED |
| Git HEAD | `abd7c3b` — Phase 3 security hardening | VERIFIED |
| Phase 4.1 schema change | `@unique` on `CompanyMembership.userId` | VERIFIED — present in schema.prisma |
| Phase 4.1 migration | `20261112135100_enforce_one_membership_per_user` | VERIFIED — migration directory exists |
| Unique index in DB | `CompanyMembership_userId_key` on `darrow_dev` | VERIFIED — queried via psql |
| Connected database | `darrow_dev` as `darrow` on `::1:5432` | VERIFIED — `current_database() = darrow_dev` |
| Production database | `darrow` does NOT exist locally | VERIFIED — not accessed |

---

## 2. Files Changed and Why

### Modified backend source (7 files)

| File | Change | Reason |
|------|--------|--------|
| `backend/src/auth/auth.service.ts` | `generateTokens()` uses `findUnique({ where: { userId } })` instead of `findFirst`; validates membership status, company status, user deletedAt; rejects token issuance if any check fails | Deterministic membership resolution; no stale JWT role claims |
| `backend/src/auth/auth.service.ts` | `acceptInvitation()` wrapped in `prisma.$transaction`; checks for existing active membership before creating; rejects with ForbiddenException if user already belongs to a company | Prevents account being attached to a second company; atomic transaction prevents partial state |
| `backend/src/auth/guards/permissions.guard.ts` | Uses `findUnique({ where: { userId } })` instead of `findFirst({ where: { userId, status: "ACTIVE" } })`; validates membership ACTIVE status, company not deleted, account not deactivated | Deterministic tenant context; no stale role claims |
| `backend/src/hr/employees.service.ts` | `create()` checks that user's active membership `companyId` matches `data.companyId` before creating employee record | Employee/account company consistency enforcement |
| `backend/src/config/env.spec.ts` | Updated expected defaults to include Phase 3 env vars (CORS_ALLOWED_ORIGINS, CORS_CREDENTIALS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS) | Test infrastructure fix |
| `backend/src/security/security.spec.ts` | Fixed mock infrastructure (where-clause-aware implementations, bcryptjs module mock, $transaction mock); added tests for suspended membership, deleted company, employee consistency, existing-membership rejection | Test infrastructure fix + new security regression tests |

### Modified test files (2 files)

| File | Change | Reason |
|------|--------|--------|
| `backend/src/config/env.spec.ts` | Added 4 new env var defaults to expected object | Match actual Phase 3 env contract |
| `backend/src/security/security.spec.ts` | Rewrote mocks with where-clause-aware `mockImplementation`; added `$transaction` mock; added 3 new test cases | Fix mock infrastructure bugs; test new security behaviors |

---

## 3. Authentication Changes

### `generateTokens()` — deterministic membership resolution

**Before:** Used `findFirst({ where: { userId, status: "ACTIVE" } })` — non-deterministic if multiple memberships existed; returned `membership?.role` which could be `undefined`.

**After:** Uses `findUnique({ where: { userId } })` — deterministic thanks to `@unique` constraint. Validates:
- Membership exists → throws `ForbiddenException("Account has no active company membership")`
- Membership status is ACTIVE → throws `ForbiddenException("Membership is <status>")`
- Company exists and not deleted → throws `ForbiddenException("Company is inactive or deleted")`
- Account not deactivated (`user.deletedAt`) → throws `ForbiddenException("Account is deactivated")`

Platform admins bypass membership checks via `isPlatformAdmin` flag in PermissionsGuard.

### `login()` — unchanged call flow, benefits from `generateTokens` hardening

Login verifies credentials, then calls `generateTokens()`. If the user has no active membership (e.g., registered without creating a company and hasn't accepted an invitation), `generateTokens` throws `ForbiddenException`. This prevents unauthenticated company-scoped access.

### `refresh()` — unchanged call flow, benefits from `generateTokens` hardening

Refresh validates the refresh token, rotates it (deletes old, creates new), then calls `generateTokens()`. If the user's membership was removed/suspended since the token was issued, `generateTokens` throws `ForbiddenException`. Stale refresh tokens cannot restore access after membership invalidation.

---

## 4. Invitation Changes

### `acceptInvitation()` — concurrency-safe transaction with existing membership check

**Before:** Created membership without checking if user already had one. Two concurrent acceptances for one user could create two memberships.

**After:**
1. Validates invitation token (exists, PENDING, not expired, email match) — outside transaction
2. Wraps user lookup, membership existence check, membership creation, and invitation update in `prisma.$transaction`
3. If user exists and already has an active membership → throws `ForbiddenException("Account already belongs to a company")`
4. If user doesn't exist → creates user, then creates membership (new user has no existing membership)
5. Creates membership in the invited company only
6. Marks invitation as ACCEPTED
7. Calls `generateTokens()` outside the transaction (reads committed membership)

The `@unique` constraint on `CompanyMembership.userId` (Phase 4.1) is the final database safety boundary — even if application checks fail, the database rejects a second membership.

---

## 5. Registration/Onboarding Changes

No changes to `register()` logic — registration already creates at most one membership (only when `companyName` is provided). A user registering without a company gets zero memberships and cannot obtain company-scoped tokens until they accept an invitation (which enforces the one-membership rule).

---

## 6. Token and Refresh Lifecycle Changes

- **Access token:** Contains `userId`, `email`, `role` (from membership), `companyId` (from membership). Role comes from membership, not `User.role`.
- **Refresh token:** Rotated on each use (old deleted, new created). Refresh calls `generateTokens()` which re-queries membership from DB — stale tokens cannot restore access after membership changes.
- **Logout:** Deletes refresh token by token value.
- **JWT claims:** `role` and `companyId` are efficiency hints only; `PermissionsGuard` re-queries membership from DB on every request.

---

## 7. PermissionsGuard Changes

**Before:** Used `findFirst({ where: { userId, status: "ACTIVE" } })` — non-deterministic if multiple memberships existed.

**After:** Uses `findUnique({ where: { userId } })` with `include: { company: true }`. Validates:
- Membership exists → throws `ForbiddenException("Account has no company membership")`
- Membership status is ACTIVE → throws `ForbiddenException("Membership is <status>")`
- Company exists and not deleted → throws `ForbiddenException("Company is inactive or deleted")`
- Account not deactivated → throws `ForbiddenException("Account is deactivated")`

Then attaches `request.companyId` and `request.role` from the verified membership. Platform admins bypass via `isPlatformAdmin` flag.

---

## 8. Employee Consistency Changes

### `EmployeesService.create()` — account membership company must match employee company

**Before:** Only checked that the requesting user's company matched `data.companyId`; did not verify the target user's membership company.

**After:** After finding the target user, queries `CompanyMembership.findUnique({ where: { userId: data.userId } })` and checks that `membership.companyId === data.companyId`. If the user has no membership or the membership company doesn't match, throws `ForbiddenException("Employee company must match the account's company membership")`.

---

## 9. Tenant-Isolation Regression Findings

All 9 company-scoped domains verified with scoped queries:

| Domain | findAll | findOne | update | remove | create |
|--------|---------|---------|--------|--------|--------|
| Companies | ✅ | ✅ | ✅ | ✅ | ✅ |
| Branches | ✅ | ✅ | ✅ | ✅ | ✅ |
| Employees | ✅ | ✅ | ✅ | ✅ | ✅ |
| Attendance | ✅ | ✅ | ✅ | N/A | ✅ |
| LeaveRequests | ✅ | ✅ | ✅ | N/A | ✅ |
| Customers | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leads | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deals | ✅ | ✅ | ✅ | ✅ | ✅ |
| Invoices | ✅ | ✅ | ✅ | ✅ | ✅ |

All list endpoints scope by `user.companyId` (from authenticated context). All read/update/delete operations use `findFirst({ where: { id, companyId } })` — never trusts client-supplied companyId.

---

## 10. Test Infrastructure Fixes

### `env.spec.ts`
- Updated `parseEnv({})` expected defaults to include all Phase 3 env vars: `DATABASE_URL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `CORS_ALLOWED_ORIGINS`, `CORS_CREDENTIALS`

### `security.spec.ts`
**Fixed:**
- `mockResolvedValue` overriding `mockImplementation` — replaced with default `mockImplementation` using `matchWhere()` helper that respects where-clause arguments
- `bcrypt.hash`/`bcrypt.compare` "Cannot redefine property" — moved to module-level `jest.mock("bcryptjs", ...)`
- Missing `prisma.attendance` mock property — added
- Missing `$transaction` mock — added (`jest.fn(async (callback) => callback(mockPrisma))`)
- Missing `prisma.companyMembership.upsert` mock — added

**Added (3 new tests):**
- `generateTokens rejects when membership is SUSPENDED`
- `generateTokens rejects when company is deleted`
- `EmployeesService.create rejects employee when user membership company does not match`

---

## 11. Test Commands and Actual Results

| Command | Result |
|---------|--------|
| `npm run build` | ✅ PASSED (0 errors) |
| `npx tsc -p tsconfig.json --noEmit` | ✅ PASSED (0 errors) |
| `npm run test` | ✅ PASSED (69/69 tests) |

**Test suite breakdown:**
- `src/config/env.spec.ts` — 9 tests passed
- `src/security/security.spec.ts` — 42 tests passed
- `src/permissions/manifest.spec.ts` — 18 tests passed

---

## 12. Original 26 Test Failures — Final Disposition

| Original Failure | Root Cause | Disposition |
|-----------------|------------|-------------|
| `env.spec.ts` — expected only 6 defaults, got 10 | Phase 3 added 4 new env vars not in test expectations | **FIXED** — updated test to include all 10 defaults |
| `security.spec.ts` — `mockResolvedValue` ignores where-clause args | Tests used `mockResolvedValue` which overrides `mockImplementation`, making where-clause matching impossible | **FIXED** — removed `mockResolvedValue` for findFirst/findUnique; default `mockImplementation` with `matchWhere()` handles where-clause matching |
| `security.spec.ts` — `jest.spyOn(bcrypt, "hash")` "Cannot redefine property" | bcryptjs `hash` is not writable/configurable in this environment | **FIXED** — module-level `jest.mock("bcryptjs", ...)` |
| `security.spec.ts` — missing `prisma.attendance` mock property | Attendance service tests referenced `prisma.attendance.findFirst` which was undefined | **FIXED** — added `attendance` and `leaveRequest` mock properties |

**All 26 original failures resolved.** 69/69 tests pass (was 39/65 before fixes).

---

## 13. Known Limitations

| Limitation | Severity | Mitigation |
|------------|----------|------------|
| Application-layer checks are the only enforcement for invitation acceptance race | Medium | Database `@unique(userId)` constraint (Phase 4.1) is the final safety boundary |
| `generateTokens` called outside transaction in `acceptInvitation` | Low | Transaction commits membership before `generateTokens` reads it |
| No integration tests against live database | Medium | Unit tests with mocked Prisma cover all logic paths; database integration deferred to next phase |
| Platform admin `isPlatformAdmin` bypasses all company-scoped checks | By design | Documented as separate platform-level access model |
| Employee consistency only enforced on create, not update | Medium | Employee update doesn't change companyId; documented as known gap |

---

## 14. Security Risks Remaining

| Risk | Status | Notes |
|------|--------|-------|
| User can register without company, then accept invitation — one membership total | Mitigated | Invitation acceptance checks for existing membership |
| Stale JWT with old companyId could briefly authorize | Mitigated | PermissionsGuard re-queries membership from DB on every request; JWT claims are efficiency hints only |
| Service methods trust `request.companyId` from PermissionsGuard | Mitigated | Guard derives from DB-verified membership, not client input |
| No integration tests against live `darrow_dev` | Known limitation | Unit tests cover all logic; integration deferred |

---

## 15. Recommended Next Phase

**Phase 4.3 — Data Audit & Reconciliation** (already completed as `DATA_AUDIT_REPORT.md`)

`darrow_dev` is already compliant — 1 user, 1 membership, 1 company. No reconciliation needed locally.

**Next code change:** Frontend migration (Phase 4.8 equivalent) — replace remaining Firebase services with NestJS REST API calls, starting with People/HR domain.

**STOP — awaiting explicit approval before proceeding to Phase 4.3+.**

---

## Final Safety Verification

| Check | Result |
|-------|--------|
| No Prisma schema changes beyond Phase 4.1 `@unique` | ✅ VERIFIED — only `@unique` on `userId` |
| No migrations created in Phase 4.2 | ✅ VERIFIED — no new migration files |
| `backend/package-lock.json` untouched | ✅ VERIFIED — pre-existing modification only |
| No frontend files changed | ✅ VERIFIED |
| No environment/deployment files changed | ✅ VERIFIED |
| No Firebase services modified | ✅ VERIFIED |
| Only `darrow_dev` used (read-only audits) | ✅ VERIFIED — no writes in Phase 4.2 |
| No production access | ✅ VERIFIED |
| No database reset or destructive operations | ✅ VERIFIED |
| All pre-existing uncommitted changes preserved | ✅ VERIFIED — `package-lock.json` intact |
| No commit created | ✅ VERIFIED — all changes working-tree only |
