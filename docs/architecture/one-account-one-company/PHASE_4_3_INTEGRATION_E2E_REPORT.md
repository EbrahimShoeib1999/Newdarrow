# PHASE 4.3 — INTEGRATION & BROWSER E2E REPORT
## ONE ACCOUNT = ONE COMPANY INVARIANT VERIFICATION

- **Target Repository**: `E:\real projects\DArrow\NewDArrow\d-arrow-business`
- **Active Database**: `darrow_dev` (PostgreSQL `::1:5432`, User `darrow`)
- **Execution Date**: 2026-11-14
- **Invariant**: **ONE ACCOUNT = ONE COMPANY**
  $$\forall u \in \text{User}, \quad \text{count}(\text{CompanyMembership}(u)) \le 1$$

---

## 1. Scope

This verification proves that the approved architectural invariant:

> **ONE ACCOUNT = ONE COMPANY**

is rigorously and deterministically enforced across the entire technology stack:
```text
PostgreSQL Database ("CompanyMembership_userId_key" UNIQUE)
    ↓
Prisma ORM (findUnique({ where: { userId } }))
    ↓
NestJS Auth & Strategies (JwtStrategy DB verification)
    ↓
CompanyMembership Service (Atomic transactions & uniqueness)
    ↓
PermissionsGuard (Server-derived tenant context)
    ↓
Tenant-Scoped Domain Services (Companies, Branches, Employees, CRM, Finance)
    ↓
REST API (Clean enveloped responses, tamper resistance)
    ↓
React 19 Frontend (AuthContext, Store, Forms, Protected Routes)
    ↓
Microsoft Edge Browser (Real CDP headless automation)
```

### Safety & Boundary Guarantees
- **Local Target Only**: Verified strictly against `darrow_dev` running on `localhost:5432`.
- **Zero Production Access**: No access to production databases, production Firebase, production APIs, or `darrow_test`.
- **Non-Destructive Operations**: Strictly zero `DROP`, `TRUNCATE`, `migrate reset`, or destructive schema alterations.
- **Git State Preserved**: All modifications kept in working tree; no commits created.

---

## 2. Safety Verification

Before running integration suites, the active database connection was verified via PostgreSQL native queries:

```sql
SELECT current_database(), current_user;
```

**Output**:
```json
{
  "current_database": "darrow_dev",
  "current_user": "darrow"
}
```

The database safety invariant check was executed against all records:

```sql
SELECT "userId", COUNT(*) AS membership_count 
FROM "CompanyMembership" 
GROUP BY "userId" 
HAVING COUNT(*) > 1;
```

**Result**: **0 rows returned** (0 duplicate memberships across the entire database).

---

## 3. Code Audit

### 3.1 `generateTokens()` (`backend/src/auth/auth.service.ts`)
- **Deterministic Lookup**: Uses `findUnique({ where: { userId } })`.
- **Zero Fallback**: Strictly avoids `findFirst()`, `user.role`, or client-provided `companyId`.
- **Status Guards**:
  - Rejects if membership does not exist (`ForbiddenException("Account has no active company membership")`).
  - Rejects if membership status is not `ACTIVE` (`ForbiddenException("Membership is SUSPENDED")`).
  - Rejects if company is soft-deleted (`ForbiddenException("Company is inactive or deleted")`).
  - Rejects if user account is deactivated (`ForbiddenException("Account is deactivated")`).
- **Claim Authority**: JWT payload `companyId` and `role` are extracted directly from the verified database membership.

### 3.2 `JwtStrategy` & `PermissionsGuard` (`backend/src/auth/guards/permissions.guard.ts`)
- On every request, the authenticated identity is re-queried from PostgreSQL:
  ```typescript
  const membership = await this.prisma.companyMembership.findUnique({
    where: { userId: user.id },
    include: { company: true },
  });
  ```
- Any attempt to use a stale token with a deleted company or suspended membership is immediately rejected with HTTP 403.
- `req.companyId` and `req.role` are derived directly from the database record, guaranteeing that client headers or query parameters cannot alter the tenant scope.

### 3.3 Invitation Acceptance (`backend/src/auth/auth.service.ts`)
- Re-architected `acceptInvitation()` into a single atomic `prisma.$transaction`:
  1. Validates invitation exists, is `PENDING`, has not expired, and email matches.
  2. Checks if `User` exists. If exists, validates that `CompanyMembership` does NOT already exist (`ForbiddenException("Account already belongs to a company")`).
  3. If user does not exist, creates `User`.
  4. Creates exactly one `CompanyMembership` for the user.
  5. Updates `Invitation` status to `ACCEPTED`.
  6. Catches Prisma `P2002` uniqueness errors on `userId` and maps them to HTTP 403 `Account already belongs to a company`.

### 3.4 Refresh Token Flow (`backend/src/auth/auth.service.ts`)
- Implemented atomic rotation within a transaction:
  ```typescript
  const deleted = await tx.refreshToken.deleteMany({ where: { id: stored.id } });
  if (deleted.count === 0) {
    throw new UnauthorizedException("Invalid or expired refresh token");
  }
  ```
- Prevents concurrent reuse race conditions where two simultaneous refresh requests present the same token.

### 3.5 Employee Mutation Consistency (`backend/src/hr/employees.service.ts`)
- `create()` and `update()` enforce tenant consistency:
  - If `branchId` is provided, queries branch and asserts `branch.companyId === authenticatedCompanyId`.
  - Disallows tampering with `companyId` via DTOs.
  - Linking an employee to a user requires `User.CompanyMembership.companyId === Employee.companyId`.

### 3.6 Company Creation Limit (`backend/src/companies/companies.service.ts`)
- Rejects `createCompany()` if the requesting user already possesses an active membership in another company.

---

## 4. PostgreSQL Integration Results

Executed automated integration test suites against live `darrow_dev`:

### 4.1 Backend Unit & Security Suite
```bash
cd backend && npm run test -- --runInBand
```
- **Results**: **3 passed, 3 total**
- **Tests**: **70 passed, 70 total (100%)**
- Verifies permission manifests, environment validation, company creation limits, and atomic token deletion mocks.

### 4.2 Backend PostgreSQL E2E Suite
```bash
cd backend && npm run test:e2e -- --runInBand --forceExit
```
- **Results**: **2 passed, 2 total**
- **Tests**: **42 passed, 42 total (100%)**
- Test Coverage Matrix:
  | Test Case | Scenario | Expected | Result |
  |---|---|---|---|
  | 3.1.1 | Register with company | Exactly 1 company, 1 membership, role ADMIN | **PASS** |
  | 3.1.2 | Register without company | User created with 0 memberships | **PASS** |
  | 3.1.3 | Register duplicate email | HTTP 409 Conflict | **PASS** |
  | 3.2.1 | Login valid credentials | Token returned with verified companyId | **PASS** |
  | 3.2.2 | Refresh token rotation | Old token deleted, new token pair issued | **PASS** |
  | 3.2.3 | Replay revoked refresh token | HTTP 401 Unauthorized | **PASS** |
  | 3.3.1 | Tenant isolation (Branches) | Cross-tenant branch creation rejected | **PASS** |
  | 3.3.2 | Cross-company read | Returns HTTP 404 (non-existent in tenant) | **PASS** |
  | 3.4.1 | Accept invitation valid | Creates exactly 1 membership, marks ACCEPTED | **PASS** |
  | 3.4.2 | Accept invitation expired | HTTP 400 Invalid/Expired | **PASS** |
  | 3.4.3 | Accept already-accepted invite | HTTP 400 Already used | **PASS** |
  | 3.4.4 | Accept email mismatch | HTTP 400 Email does not match | **PASS** |
  | 3.4.5 | Accept invite for member of Company A into Company B | HTTP 403 / 400 Rejected | **PASS** |
  | 3.5.1 | Cross-company employee creation | HTTP 403 Forbidden | **PASS** |
  | 3.5.2 | Link user from different company | HTTP 403 / 404 Rejected | **PASS** |
  | 3.5.3 | Valid employee in same company | Created successfully with matching tenant ID | **PASS** |
  | 3.6.1 | Final database invariant | 0 duplicate memberships in database | **PASS** |

---

## 5. Concurrency Results

Live multi-threaded race condition tests executed against PostgreSQL `darrow_dev`:

### Scenario 1: Concurrent Same Invitation Acceptance
- Two simultaneous HTTP requests attempt to accept the same invitation token via `Promise.all`:
  - Request 1: `200 OK` (membership created, invitation marked ACCEPTED).
  - Request 2: `400 Bad Request` ("Invitation already used or revoked").
  - Database state: Exactly 1 membership created, 0 duplicates.

### Scenario 2: Concurrent Different Invitations for the Same Account
- User `U` receives Invitation A (Company A) and Invitation B (Company B). Two requests fire concurrently to accept both:
  - Request A: `200 OK` (committed).
  - Request B: `403 Forbidden` ("Account already belongs to a company") caught by PostgreSQL unique constraint `CompanyMembership_userId_key`.
  - Database state: User belongs only to Company A. Total memberships = 1.

### Scenario 3: Concurrent Refresh Token Reuse
- Two parallel requests present the exact same refresh token:
  - Request 1: `200 OK` (token deleted and new pair generated).
  - Request 2: `401 Unauthorized` (`tx.refreshToken.deleteMany` count was 0).
  - Race condition eliminated.

---

## 6. Browser E2E Results

A dedicated headless browser automation suite (`scripts/test-one-account-browser-e2e.ts`) was executed using **Microsoft Edge** over the Chrome DevTools Protocol (CDP) against the compiled React 19 production build (`http://localhost:5173`) and live backend API (`http://localhost:3001/api/v1`):

```text
================================================================================
PHASE 4.3 — BROWSER E2E VERIFICATION (ONE ACCOUNT = ONE COMPANY)
Target Frontend: http://localhost:5173
Target Backend:  http://localhost:3001/api/v1
Database:        darrow_dev
================================================================================
```

### Results Summary Table

| Test | Suite Name | Browser Observation | DB Verification | Result |
|:---:|:---|:---|:---|:---:|
| **1** | **Registration with Company** | Form submitted; browser redirected to `/apps`; refresh token stored in `localStorage`. | User created; exactly 1 `CompanyMembership` with role `ADMIN`, status `ACTIVE`. | **PASS** |
| **2** | **Login Flow** | Navigated to `/login`; submitted credentials; redirected to `/apps`; session token set. | Verified user credentials and active membership lookup. | **PASS** |
| **3** | **Protected Routes Access** | Navigated to `/apps`, `/crm/leads`, and `/tasks`. All rendered properly without login redirect. | Verified JWT acceptance across route guards. | **PASS** |
| **4** | **Logout & Interception** | Triggered logout; storage cleared; direct navigation to `/apps` immediately redirected to `/login`. | Refresh token revoked in DB. | **PASS** |
| **5** | **Invitation Acceptance & Duplicate Rejection** | User accepted Invite Alpha and joined Company Alpha. User then clicked accept on Invite Beta: UI displayed explicit error banner: *"Your account already belongs to a company. An account cannot belong to more than one company."* | PostgreSQL rejected 2nd membership; membership count strictly stayed at **1**. | **PASS** |
| **6** | **Absence of Company Switcher in UI** | Evaluated DOM across all menus, headers, sidebars, and dropdowns for switcher controls (`switch company`, `تبديل الشركة`, etc.). | Zero switcher controls found (0 suspicious elements). | **PASS** |
| **7** | **Client LocalStorage Tampering Defense** | Injected `hacked-fake-company-id-999` into `localStorage`. Made `/auth/me` request from browser. | Backend returned database-authoritative companyId; fake ID ignored. | **PASS** |

**Final Browser E2E Verdict**: **ALL 7 TESTS PASSED (0 FAILURES)**.

---

## 7. Security Findings & Hardening Applied

1. **Refresh Token Race Condition (Fixed)**:
   - *Vulnerability*: Refresh token was deleted after generating new tokens, allowing two concurrent requests to both validate the existing token.
   - *Fix*: Atomic deletion inside `prisma.$transaction` via `tx.refreshToken.deleteMany` with count validation before generating replacement tokens.
2. **Invitation Acceptance Identity Enforcement (Fixed)**:
   - *Defect*: When an authenticated user accepted an invitation, the client didn't supply the email, causing a mismatch with the invitation email.
   - *Fix*: Updated `AuthService.acceptInviteForCurrentUser(token, email)` to pass the authenticated user's email, ensuring strict validation against the invitation record.
3. **Cross-Tenant Branch Injection (Fixed)**:
   - *Defect*: Employee creation validated company match but didn't verify that the optional `branchId` belonged to the authenticated company.
   - *Fix*: Added branch tenant verification in `EmployeesService.create()` and `update()`.
4. **Client Tenant Context Tampering (Immunized)**:
   - *Hardening*: Verified that client-side `localStorage` manipulations (`d-arrow-company-id`) are completely ignored by the backend, which resolves tenant identity solely from the database-verified session.
5. **Controller Envelope Normalization (Fixed)**:
   - *Fix*: Normalized `EmployeesController` and `CompaniesController` returns to prevent double-enveloping under `ResponseEnvelopeInterceptor`.

---

## 8. Files Changed

### Backend Files
- `backend/src/auth/auth.service.ts`:
  - Atomic refresh token rotation in `refresh()`.
  - Deterministic `findUnique` in `generateTokens()`.
  - Added `getInvitation(token: string)` metadata endpoint.
  - Transactional `acceptInvitation()` with P2002 conflict handling.
- `backend/src/auth/auth.controller.ts`:
  - Added `@Get("invitation/:token")` endpoint.
  - Separated `@Get("me")` and `@Post("me")` methods to preserve route metadata.
- `backend/src/auth/strategies/jwt.strategy.ts`:
  - Re-verifies `CompanyMembership` against PostgreSQL on every authenticated request.
- `backend/src/companies/companies.service.ts`:
  - Enforced single-company ownership restriction on company creation.
- `backend/src/companies/companies.controller.ts`:
  - Normalized controller returns to prevent double-enveloping.
- `backend/src/hr/employees.service.ts` & `employees.controller.ts`:
  - Added cross-company branch isolation checks.
  - Normalized controller returns to match interceptor expectations.
- `backend/src/common/guards/rate-limit.guard.ts`:
  - Enabled rate limit bypass when `DISABLE_RATE_LIMIT=true` or `NODE_ENV=test`.
- `backend/src/security/security.spec.ts`:
  - Aligned unit tests with atomic `deleteMany` rotation and company creation limits.
- `backend/test/one-account-one-company.e2e-spec.ts`:
  - Comprehensive 42-test PostgreSQL integration suite.

### Frontend Files
- `src/features/auth/api/auth.service.ts`:
  - Updated `acceptInviteForCurrentUser(token, email)` to pass the invitee's email.
- `src/features/auth/pages/accept-invite-page.tsx`:
  - Extracted backend error response `err.response?.data?.message` and surfaced explicit multi-company conflict messages.
- `src/features/companies/api/invites.service.ts`:
  - Updated `getByToken()` to query NestJS REST API `/auth/invitation/:token` before Firestore fallback.
- `src/features/auth/context/auth-context.tsx`:
  - Fixed initialization hang when no refresh token is stored.
- `src/features/auth/components/register-form.tsx`:
  - Synchronized `useAuthStore` upon registration response.
- `vite.config.ts`:
  - Configured `/api` proxy rewrites to `http://localhost:3001/api/v1` for preview and dev servers.

### Test Harness Files
- `scripts/test-one-account-browser-e2e.ts`: Permanent headless Edge CDP browser E2E test suite.
- `scripts/check_invariants.ts`: Standalone database invariant verification utility.

---

## 9. Regression Tests

All automated suites are runnable on demand:

```bash
# 1. Database Invariant Check
npx tsx scripts/check_invariants.ts

# 2. Backend Unit Tests (70 tests)
cd backend && npm run test -- --runInBand

# 3. Backend E2E Tests against darrow_dev (42 tests)
cd backend && npm run test:e2e -- --runInBand --forceExit

# 4. Backend TypeScript Check
cd backend && npx tsc --noEmit -p tsconfig.json

# 5. Full Browser E2E Suite (Headless Edge CDP)
npx tsx scripts/test-one-account-browser-e2e.ts
```

---

## 10. Known Limitations

1. **Legacy Firestore Remnants**:
   - The frontend codebase retains Firestore calls for non-auth modules (e.g. legacy chat, real estate ops). These will be decoupled in upcoming phases. The authoritative authentication, membership, and tenant context are 100% NestJS + PostgreSQL.
2. **Rate Limit Bypass Flag**:
   - Rate limiting is active by default in production. Local automation scripts pass `DISABLE_RATE_LIMIT=true` to prevent sequential test runs from encountering in-memory 429/403 throttling.

---

## 11. Final Verdict

# VERIFIED — ONE ACCOUNT = ONE COMPANY

The architectural invariant **ONE ACCOUNT = ONE COMPANY** is strictly, deterministically, and reliably enforced across the entire system from the PostgreSQL unique database constraints up through the NestJS authentication layer, service-level tenant checks, REST API, React 19 state store, and real Edge browser UI.
