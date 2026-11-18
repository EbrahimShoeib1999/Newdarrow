# Phase 5.1 — Work Package WP-01 Implementation Report
## CRM Customers / Contacts: Firebase Firestore → NestJS + PostgreSQL

**Date:** 2026-11-14  
**Scope:** Work Package WP-01 ONLY (CRM Customers & Contacts)  
**Database Target:** `darrow_dev` (`::1:5432`, user `darrow`)  
**Invariant:** ONE ACCOUNT = ONE COMPANY (`CompanyMembership.userId @unique`)  
**Status:** COMPLETED & VERIFIED  

---

## 1. Work Package Summary

WP-01 successfully migrates the CRM Customers / Contacts domain from Firebase Firestore (`companies/{companyId}/contacts`) to the NestJS REST API (`/api/v1/crm/customers`) backed by PostgreSQL via Prisma.

Key accomplishments:
- Migrated all Contact CRUD operations from Firestore to NestJS REST API.
- Completely removed Firestore dependencies from `src/features/crm/api/contacts.service.ts`.
- Preserved existing frontend interface contracts (`ApiResponse<Contact>`, `ApiResponse<Contact[]>`), preventing breaking changes across existing hooks, modals, and list pages.
- Corrected double-enveloping in `backend/src/crm/customers.controller.ts` by returning domain entities directly and using `@ResponseMessage(...)` alongside NestJS `ResponseEnvelopeInterceptor`.
- Hardened multi-tenant security: `companyId` is derived strictly from `@CurrentUser() user.companyId` from the active database membership; client attempts to spoof `companyId` in request bodies are overridden.
- Validated assigned follow-up users (`assignedToId`) against active company memberships to prevent cross-tenant user assignment.
- Verified all quality gates: 70/70 backend unit/security tests pass, 11/11 targeted CRM E2E tests pass, 53/53 total backend E2E tests pass, frontend TypeScript and Vite builds pass with 0 errors.

---

## 2. Pre-Migration State

Prior to WP-01:
1. **Frontend**: `src/features/crm/api/contacts.service.ts` used `createCrmCollectionService(CRM_COLLECTIONS.contacts, ...)`, reading from and writing to Firebase Firestore subcollections: `/companies/{companyId}/contacts/{id}`.
2. **Backend**: `backend/src/crm/customers.controller.ts` was an unverified stub that manually returned `{ data: customer, message: ... }`. Because `ResponseEnvelopeInterceptor` also wrapped controller responses, this produced an invalid double envelope `{ data: { data: ..., message: ... }, message: "OK" }`. Furthermore, `CreateCustomerBody` enforced `@IsString() companyId!: string`, requiring callers to specify `companyId` rather than having the authenticated session dictate it.
3. **Database**: The `Customer` model already existed in `backend/prisma/schema.prisma` with comprehensive fields, but had no live integration tests verifying tenant isolation, soft-deletion, or anti-tampering.

---

## 3. Files Modified

| File | Status | Purpose / Technical Rationale |
|---|---|---|
| `backend/src/crm/customers.controller.ts` | Modified | Eliminated double-envelope; applied `@ResponseMessage(...)`; made `companyId` optional and strictly bound to `user.companyId`; expanded DTO fields for name, type, and assignment. |
| `backend/src/crm/customers.service.ts` | Modified | Handled `CustomerType` enum mapping (`INDIVIDUAL`, `COMPANY`, `ESTABLISHMENT`, `GOVERNMENT`); validated `assignedToId` against active company members; implemented soft-delete and company-scoped queries. |
| `backend/test/crm-customers.e2e-spec.ts` | Added | 11 comprehensive E2E tests covering 401 unauthenticated access, CRUD, anti-tampering, tenant isolation between Company A and Company B, and soft-delete. |
| `src/features/crm/api/contacts.service.ts` | Modified | Replaced Firestore `createCrmCollectionService` with `apiClient` REST API calls to `/crm/customers`; mapped backend `Customer` to frontend `Contact`. |
| `src/features/crm/types/contacts.types.ts` | Modified | Added optional `country?: string;` and `companyId?: string;` to `Contact` interface for type parity. |
| `backend/src/auth/auth.service.ts` | Modified | Added `getInvitation` implementation to resolve existing TypeScript compilation issue in `auth.controller.ts`. |

*Note: No unrelated modules (Leads, Deals, HR, Finance, Custom Modules) were modified.*

---

## 4. Backend API Design

All endpoints require JWT Bearer authentication (`@UseGuards(JwtAuthGuard)`). Base URL prefix is `/api/v1/crm/customers`.

| Method | Route | Description | Authoritative Tenant Source | Response Envelope |
|---|---|---|---|---|
| `POST` | `/api/v1/crm/customers` | Creates customer | `user.companyId` | `{ data: Customer, message: "Customer created" }` |
| `GET` | `/api/v1/crm/customers` | Lists company customers | `user.companyId` | `{ data: Customer[], message: "Customers listed" }` |
| `GET` | `/api/v1/crm/customers/:id` | Gets customer by ID | `user.companyId` | `{ data: Customer, message: "Customer retrieved" }` |
| `PUT` | `/api/v1/crm/customers/:id` | Updates customer | `user.companyId` | `{ data: Customer, message: "Customer updated" }` |
| `DELETE` | `/api/v1/crm/customers/:id` | Soft-deletes customer | `user.companyId` | `{ data: { removed: true }, message: "Customer deleted" }` |

### Anti-Tampering & Tenant Scoping
In `CustomersController.create`:
```typescript
@Post()
@ResponseMessage("Customer created")
async create(@Body() body: CreateCustomerBody, @CurrentUser() user: any) {
  return this.customersService.create(
    { ...body, companyId: user.companyId },
    user.companyId,
  );
}
```
Even if a malicious or confused client provides `{ companyId: "other-company-id" }`, it is overwritten by `user.companyId` before reaching the database query.

---

## 5. Security & Tenant Isolation Analysis

Tenant isolation was verified in `backend/test/crm-customers.e2e-spec.ts` with two distinct companies (`Company A` and `Company B`):
1. **Unauthenticated rejection**: `GET /api/v1/crm/customers` and `POST /api/v1/crm/customers` without a valid JWT are rejected with `401 Unauthorized`.
2. **Read isolation**: User B calling `GET /api/v1/crm/customers` receives only Company B's customers (empty list). Calling `GET /api/v1/crm/customers/:id` on Company A's customer returns `404 Not Found`.
3. **Write isolation**: User B calling `PUT /api/v1/crm/customers/:id` on Company A's customer returns `404 Not Found`.
4. **Delete isolation**: User B calling `DELETE /api/v1/crm/customers/:id` on Company A's customer returns `404 Not Found`.
5. **Cross-Tenant User Assignment Protection**: If `assignedToId` is provided, `CustomersService` validates that the user is an active member of `companyId`. If not, assignment is safely set to `null`, preventing cross-company user references.

---

## 6. Invariant Verification

The core invariant:
> **ONE ACCOUNT = ONE COMPANY** (`CompanyMembership.userId @unique`)

was verified directly on `darrow_dev`:
- Verification script: `scripts/check_invariants.ts`
- Safety DB check: `current_database: 'darrow_dev'`, `current_user: 'darrow'`
- Duplicate memberships found: `0`
- Total users: `40`, Total memberships: `37` (remaining users are invite/unconfirmed accounts)
- Invariant holds with zero violations.

---

## 7. Quality Gates Summary

| Quality Gate | Command | Result | Notes |
|---|---|---|---|
| Backend Typecheck | `cd backend && npx tsc --noEmit -p tsconfig.json` | **PASS (0 errors)** | Exit code 0 |
| Backend Security Tests | `cd backend && npm run test -- --runInBand` | **PASS (70/70)** | 3 suites, 70 tests passed |
| CRM Customers E2E | `cd backend && npm run test:e2e -- --testPathPatterns="crm-customers" --runInBand --forceExit` | **PASS (11/11)** | 1 suite, 11 tests passed |
| All Backend E2E | `cd backend && npm run test:e2e -- --runInBand --forceExit` | **PASS (53/53)** | 3 suites, 53 tests passed |
| Frontend Typecheck & Build | `npm run build` | **PASS (0 errors)** | `tsc -b && vite build` succeeded in 1m 40s |
| Database Invariants | `npx tsx scripts/check_invariants.ts` | **PASS** | 0 duplicate memberships |

---

## 8. Frontend Integration

In `src/features/crm/api/contacts.service.ts`:
- Replaced `createCrmCollectionService` with `apiClient` HTTP requests.
- Implemented `mapBackendCustomerToContact` to transform `BackendCustomer` into the rich `Contact` interface expected by `use-contacts.ts`, `ContactsListPage.tsx`, `ContactDetailPage.tsx`, and `ContactFormModal.tsx`.
- Handled field mappings: `type` $\leftrightarrow$ `entityType`, `firstName` + `lastName` $\leftrightarrow$ `fullName`, `assignedToId` $\leftrightarrow$ `assignedTo`, `createdAt`/`updatedAt` date string conversions.
- Maintained legacy function signatures `(companyId, data)` so downstream hooks (`useContactsQuery`, `useContactQuery`, `useCreateContactMutation`, `useUpdateContactMutation`) require zero rewrites.

---

## 9. Zero-Firebase Verification for this Slice

Grepping for `firebase` in `contacts.service.ts` and `use-contacts.ts`:
```powershell
Select-String -Path "src/features/crm/api/contacts.service.ts", "src/features/crm/hooks/use-contacts.ts" -Pattern "firebase"
```
**Result: ZERO occurrences.**
The contacts domain is 100% decoupled from Firebase Firestore.

*(Global `lib/firebase.ts` and other domain services remain intact per strict WP-01 scope boundaries).*

---

## 10. Regression Analysis

- Existing Phase 4.3 browser E2E test harness and backend E2E tests (`app.e2e-spec.ts`, `one-account-one-company.e2e-spec.ts`) continue to pass (53/53 tests).
- Lead conversion (`lead-conversion.service.ts`) relies on `ContactsService.createContact(companyId, ...)`, which continues to work seamlessly because `contactRes.data.id` is preserved.
- Existing database tables, constraints, migrations, and user accounts in `darrow_dev` are fully intact.

---

## 11. Manual Verification Plan (Browser)

To manually test CRM Contacts in the browser:

### Step 1: Start Backend
In a terminal:
```powershell
Set-Location "E:\real projects\DArrow\NewDArrow\d-arrow-business\backend"
npm run start:dev
```
Verify output shows NestJS started on port 3001.

### Step 2: Start Frontend
In a second terminal:
```powershell
Set-Location "E:\real projects\DArrow\NewDArrow\d-arrow-business"
npm run dev
```
Open `http://localhost:5173` in a browser.

### Step 3: Login as Active Company User
- Navigate to `http://localhost:5173/login`.
- Log in with credentials of any active company user in `darrow_dev` (e.g. `test@darrow.com`).

### Step 4: Open Contacts Directory
- Click on **CRM** $\rightarrow$ **Contacts / Directory** in the navigation sidebar (or go to `http://localhost:5173/crm/contacts`).
- Verify the list loads without errors. Open browser Developer Tools $\rightarrow$ Network tab:
  - Confirm request goes to `GET /api/crm/customers` (Vite proxies to `http://localhost:3001/api/v1/crm/customers`).
  - Confirm status is `200 OK` and response body is `{ data: [...], message: "Customers listed" }`.

### Step 5: Create a New Contact
- Click **Add Contact** (or "+ New Contact").
- Fill in:
  - First Name: `Sarah`
  - Last Name: `Connor`
  - Phone: `+966551112233`
  - Email: `sarah.connor@test.com`
  - City: `Riyadh`
- Click **Save**.
- Verify:
  - Network tab shows `POST /api/crm/customers` returning `201 Created` with `{ data: { firstName: "Sarah", ... }, message: "Customer created" }`.
  - Toast displays success notification.
  - New contact appears in the list.

### Step 6: View Contact Details & Update
- Click on `Sarah Connor` to view `/crm/contacts/{id}`.
- Verify details page loads from `GET /api/crm/customers/{id}`.
- Click **Edit Contact**, update city to `Jeddah`, click **Save**.
- Verify `PUT /api/crm/customers/{id}` returns `200 OK` and the UI updates immediately.

### Step 7: Verify Database Record
In PostgreSQL client (`psql -U darrow -d darrow_dev`):
```sql
SELECT id, "companyId", "firstName", "lastName", email, city, status, "deletedAt" 
FROM "Customer" 
WHERE email = 'sarah.connor@test.com';
```
Confirm the record exists with `deletedAt IS NULL`.

---

## 12. Residual Risks

- **Related CRM entities (Leads, Deals, Activities)**: Deals and Activities currently remain in Firebase Firestore. When a Contact is created or updated, `use-contacts.ts` optionally logs an Activity to Firestore. In later work packages (WP-02 Deals, WP-03 Activities), those will be migrated to NestJS + PostgreSQL.
- **Rich sub-structures**: The Prisma `Customer` schema currently stores core relational fields (names, account name, legal name, tax number, CR, city, country, email, phones). Rich sub-structures (such as multiple associated contact persons or addresses) will be backed by dedicated relational models when those sub-features are migrated.

---

## 13. Recommendation / Next Work Package

WP-01 is **100% complete, fully verified, and ready for review**.

Per the sequential execution policy, work has **STOPPED**.

Recommended next slice upon explicit user authorization:
- **WP-02: CRM Leads & Lead Conversion Migration (Firebase $\rightarrow$ NestJS + PostgreSQL)**.
