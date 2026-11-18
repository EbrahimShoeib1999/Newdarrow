# WP-01 FINAL ACCEPTANCE AUDIT (READ-ONLY)

**Work Package**: WP-01 — CRM Customers / Contacts: Firebase → NestJS + PostgreSQL  
**Audit Date**: 2026-11-15  
**Auditor**: Senior Principal Software Architect & QA/Security Engineer  
**Audit Target Repository**: `E:\real projects\DArrow\NewDArrow\d-arrow-business`  
**Target Local Database**: PostgreSQL `darrow_dev` (Host: `localhost:5432`, User: `darrow`)  
**Production Access Status**: Strictly Forbidden / Verified Not Accessed  

---

## EXECUTIVE SUMMARY & AUDIT VERDICT

| Category | Status | Details |
| :--- | :--- | :--- |
| **WP-01 CRUD Functionality** | **VERIFIED** | Customer & Contact CRUD works against PostgreSQL via NestJS REST API. |
| **Tenant Isolation (Database)** | **VERIFIED** | Queries enforce `user.companyId`; cross-tenant access returns `404 Not Found`. |
| **One Account = One Company** | **VERIFIED** | 0 duplicate memberships in `darrow_dev`; unique DB constraint intact. |
| **API Routing & Wire Envelope** | **VERIFIED** | Single `{ data, message }` envelope; Vite proxy `/api` -> `/api/v1` verified. |
| **Backend Delete Authorization** | **BLOCKER** | `CustomersController.remove` lacks `PermissionsGuard` & `@RequirePermission("crm.delete")`. |
| **Firebase Production Leak** | **BLOCKER** | `use-contacts.ts` calls `ActivitiesService` which writes to **Firebase Production Firestore**. |

### FINAL VERDICT: **REJECTED (WP-02 AUTHORIZATION DENIED)**
WP-01 cannot be signed off, and WP-02 must NOT start, until both identified **BLOCKER** items are resolved.

---

## 1. AUDIT OF GIT CHANGES

### 1.1 Complete File Status Classification
Inspection of `git status --short` against `master`:

#### A. WP-01 Required Changes
1. `backend/src/crm/customers.controller.ts` (Modified):
   - Adds REST endpoints for `POST /`, `GET /`, `GET /:id`, `PUT /:id`, `DELETE /:id`.
   - Adopts `@ResponseMessage()` decorator for global envelope formatting.
2. `backend/src/crm/customers.service.ts` (Modified):
   - Implements soft delete (`deletedAt`), tenant scoping via `companyId`, and field mappings (`fullName`, `entityType`).
3. `src/features/crm/api/contacts.service.ts` (Modified):
   - Directs all Contact CRUD calls to NestJS `/crm/customers` via `apiClient`.
   - Maps between frontend `Contact` model and backend `Customer` entity.
4. `src/features/crm/hooks/use-contacts.ts` (Modified):
   - React Query hooks (`useContacts`, `useContactQuery`, `useCreateContactMutation`, `useUpdateContactMutation`, `useDeleteContactMutation`).
5. `src/features/crm/pages/ContactDetailPage.tsx` (Modified):
   - Implements UI delete action button with confirmation dialog and query invalidation.
6. `src/features/crm/types/contacts.types.ts` (Modified):
   - Added DTO definitions and entity mappings.
7. `vite.config.ts` (Modified):
   - Added `/api` proxy target `http://localhost:3005/api/v1` with path rewrite `path.replace(/^\/api/, "")`.
   - Added watcher ignore for `**/tmp/**` and `**/.e2e-temp/**` to prevent HMR loops during browser tests.
8. `backend/test/crm-customers.e2e-spec.ts` (Untracked / Added):
   - Targeted e2e test suite covering authentication guards, tenant isolation, anti-tampering, soft deletion, and response contracts.
9. `scripts/test-crm-contacts-browser.ts` (Untracked / Added):
   - Browser automation script for end-to-end CRM verification.

#### B. Pre-Existing Phase 4.1–4.3 Work (One Account = One Company & Security Hardening)
- `backend/prisma/schema.prisma` & `backend/prisma/migrations/*`: Added `@unique` constraint to `CompanyMembership.userId`.
- `backend/src/auth/auth.controller.ts`: Endpoints for register, login, refresh, logout, accept-invite, get-invite.
- `backend/src/auth/auth.service.ts`: Enforces 1:1 account-to-company membership; refresh token rotation inside `$transaction`; `getInvitation`.
- `backend/src/auth/guards/permissions.guard.ts`: Enforces 1:1 membership resolution and DB-backed role permissions.
- `backend/src/auth/strategies/jwt.strategy.ts`: Validates single active membership on every request.
- `backend/src/common/guards/rate-limit.guard.ts`: Rate-limiting security hardening.
- `backend/src/companies/*` & `backend/src/hr/*`: Tenant enforcement across companies and employees.
- `backend/src/config/env.spec.ts` & `backend/src/security/security.spec.ts`: Security test suites.
- `backend/test/jest-e2e.json` & `backend/test/one-account-one-company.e2e-spec.ts`: Phase 4.2 e2e test suite.
- `src/features/auth/*`, `src/features/companies/*`, `src/lib/api-client.ts`, `src/lib/permissions/*`: Auth migration and permissions normalization.
- `docs/architecture/*`: Architecture decision records and implementation reports.

#### C. Out-of-Scope Files
- `backend/package-lock.json`: Dependency lockfile touched during previous phase package installations.

---

### 1.2 Deep Inspection of `backend/src/auth/auth.service.ts` (`getInvitation`)

- **Location**: `backend/src/auth/auth.service.ts`, lines 151–180.
- **Implementation**:
  ```typescript
  async getInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: token },
    });

    if (!invitation) {
      throw new NotFoundException("Invalid invitation token");
    }
    if (invitation.status !== "PENDING") {
      throw new BadRequestException("Invitation already used or revoked");
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException("Invitation has expired");
    }

    return {
      id: invitation.id,
      token: invitation.id,
      email: invitation.email,
      role: invitation.role,
      companyId: invitation.companyId,
      companyName: invitation.companyName,
      invitedBy: invitation.invitedByUserId,
      invitedByName: invitation.invitedByName,
      status: invitation.status.toLowerCase(),
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }
  ```
- **Why it was added**:
  In Phase 4.2/4.3, accepting an invite is handled by the frontend route `/accept-invite?token=...` (`src/features/auth/pages/accept-invite-page.tsx`). Before submitting the form to set a password and accept the invite, the UI must fetch and display the invite details (company name, invited email, role). Previously, this read Firestore directly. Migrating invites from Firebase required a backend REST endpoint (`GET /api/v1/auth/invitations/:token`).
- **Behavioral & Security Analysis**:
  - **Does it change existing invite acceptance behavior?** No. `acceptInvitation()` remains the only mutation path, fully wrapped in `prisma.$transaction`, enforcing the unique `CompanyMembership.userId` constraint.
  - **Does it expose sensitive information?** No. It does not return password hashes, internal secrets, or other tenants' data. It only returns metadata for the specific invitation matching the unguessable UUID token.
  - **Is there any regression or security risk?** No. The method is strictly read-only, checks expiration and status, and throws appropriate HTTP exceptions (`NotFoundException`, `BadRequestException`).
- **Classification**: **VERIFIED** (Safe, strictly read-only, and required for Phase 4 invite flow).

---

## 2. API ROUTING & PROXY VERIFICATION

### 2.1 Trace from React to NestJS
```text
React ContactsService (contacts.service.ts)
  └─ apiClient.get("/crm/customers")           [Base URL: /api]
       └─ Browser Network Request: GET http://localhost:5173/api/crm/customers
            └─ Vite Dev Proxy (vite.config.ts lines 99-105)
                 ├─ Target: http://localhost:3005/api/v1
                 ├─ Rewrite: path.replace(/^\/api/, "")  => /crm/customers
                 └─ Transformed URL: http://localhost:3005/api/v1/crm/customers
                      └─ NestJS Global Prefix: api/v1 (app-setup.ts line 32)
                           └─ CustomersController: @Controller("crm/customers")
                                └─ Handler: findAll(@CurrentUser() user: any)
```

### 2.2 Route Resolution Table
| Action | Frontend Call | Browser Request URL | Rewritten Backend URL | Controller Handler | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **List** | `apiClient.get("/crm/customers")` | `http://localhost:5173/api/crm/customers` | `http://localhost:3005/api/v1/crm/customers` | `findAll` (GET) | **VERIFIED** |
| **Get** | `apiClient.get("/crm/customers/:id")` | `http://localhost:5173/api/crm/customers/:id` | `http://localhost:3005/api/v1/crm/customers/:id` | `findOne` (GET) | **VERIFIED** |
| **Create** | `apiClient.post("/crm/customers", payload)` | `http://localhost:5173/api/crm/customers` | `http://localhost:3005/api/v1/crm/customers` | `create` (POST) | **VERIFIED** |
| **Update** | `apiClient.put("/crm/customers/:id", payload)` | `http://localhost:5173/api/crm/customers/:id` | `http://localhost:3005/api/v1/crm/customers/:id` | `update` (PUT) | **VERIFIED** |
| **Delete** | `apiClient.delete("/crm/customers/:id")` | `http://localhost:5173/api/crm/customers/:id` | `http://localhost:3005/api/v1/crm/customers/:id` | `remove` (DELETE) | **VERIFIED** |

---

## 3. RESPONSE CONTRACT & ENVELOPE INTEGRITY

### 3.1 Trace of Envelope Flow
1. **Controller Layer** (`backend/src/crm/customers.controller.ts`):
   - Handlers return raw domain entities or plain result objects:
     - `create`: `return this.customersService.create(...)`
     - `findAll`: `return this.customersService.findAll(...)`
     - `findOne`: `return this.customersService.findOne(...)`
     - `update`: `return this.customersService.update(...)`
     - `remove`: `return { removed: true }`
   - Decorated with `@ResponseMessage("<message>")`.
2. **NestJS Interceptor** (`backend/src/common/interceptors/response-envelope.interceptor.ts`):
   - Maps handler result:
     ```typescript
     map((data) => ({
       data: data === undefined ? null : data,
       message,
     }))
     ```
3. **Wire Response**:
   `{ "data": <entity_or_list>, "message": "<message>" }`
4. **Axios Client** (`src/lib/api-client.ts`):
   - Delivers standard `AxiosResponse` where `res.data` is `{ data: ..., message: ... }`.
5. **Frontend Service** (`src/features/crm/api/contacts.service.ts`):
   - `getContacts`: Reads `res.data?.data`, maps to `Contact[]`, returns `{ data: Contact[], message: ... }`.
   - `createContact`: Reads `res.data.data`, maps to `Contact`, returns `{ data: Contact, message: ... }`.
6. **React Query Hooks** (`src/features/crm/hooks/use-contacts.ts`):
   - Uses `select: (res) => res.data` to extract the final unwrapped model for components.
- **Double-wrapping / Double-unwrapping check**: Zero double-wrapping detected. All legacy manual `{ data: customer, message }` wrappings in `CustomersController` have been cleanly removed.
- **Classification**: **VERIFIED**.

---

## 4. DATABASE & TENANT INVARIANTS AUDIT

### 4.1 Database Safety & Identity
Executed against local PostgreSQL service (Read-Only):
- `current_database()`: `darrow_dev`
- `current_user`: `darrow`
- Host: `localhost:5432`
- Production database connection: **NEVER ACCESSED**

### 4.2 Membership & Invariant Verification
Query:
```sql
SELECT "userId", COUNT(*) AS membership_count 
FROM "CompanyMembership" 
GROUP BY "userId" 
HAVING COUNT(*) > 1;
```
- **Duplicate Memberships Found**: **0**
- **Total Users in Database**: 42
- **Total Memberships in Database**: 39
- **Breakdown**:
  - Exactly 1 Membership: 39 users
  - Exactly 0 Memberships: 3 users (Platform Admins / unassigned registrations)
  - More than 1 Membership: 0 users
- **Unique Constraint**: The PostgreSQL unique index on `CompanyMembership("userId")` guarantees the invariant is structurally impossible to violate.
- **Classification**: **VERIFIED**.

---

## 5. PERMISSIONS & DELETION AUTHORIZATION AUDIT

### 5.1 Frontend Delete Gating
- `src/features/crm/pages/ContactDetailPage.tsx` (lines 83, 213-237):
  - Delete button is rendered conditionally:
    ```tsx
    const { canManageContacts } = useCrmPermissions();
    // ...
    actions={ canManageContacts ? ( ... <Button ... onPress={handleDelete}> ... ) : undefined }
    ```
  - `useCrmPermissions()` checks: `hasEffectivePermission(ctx, "crm.manage_contacts")`.
  - In `src/lib/permissions/index.ts`:
    - `crm.manage_contacts` is granted to `admin` and `manager` roles.
    - `crm.manage_contacts` is NOT granted to `employee` or `viewer` roles.
  - Frontend UI correctly hides the delete button for non-managerial roles.

### 5.2 Backend Delete Authorization — CRITICAL DEFECT
- `backend/src/crm/customers.controller.ts` (lines 170-173, 202-207):
  ```typescript
  @UseGuards(JwtAuthGuard)
  @Controller("crm/customers")
  export class CustomersController {
    constructor(private readonly customersService: CustomersService) {}
    // ...
    @Delete(":id")
    @ResponseMessage("Customer deleted")
    async remove(@Param("id") id: string, @CurrentUser() user: any) {
      await this.customersService.remove(id, user.companyId);
      return { removed: true };
    }
  }
  ```
- **Defect Analysis**:
  1. `CustomersController` uses **ONLY** `JwtAuthGuard`.
  2. `PermissionsGuard` is **NOT** applied to the controller or the `remove` handler.
  3. `@RequirePermission("crm.delete")` is **MISSING**.
  4. While `CustomersService.remove` correctly validates tenant isolation (`where: { id, companyId }`), **ANY** authenticated employee or viewer in that company can bypass the frontend UI and send `DELETE /api/v1/crm/customers/:id` with their bearer token to soft-delete any customer!
- **Classification**: **BLOCKER**.
- **Required Fix**:
  1. Add `PermissionsGuard` to `CustomersController` or its methods.
  2. Decorate `@Delete(":id")` with `@RequirePermission("crm.delete")` (or appropriate permission atom).
  3. Add test case verifying that an authenticated `EMPLOYEE` without `crm.delete` receives `403 Forbidden` on deletion attempt.

---

## 6. FIREBASE CONFIGURATION & PRODUCTION LEAKAGE RISK AUDIT

### 6.1 Configuration Audit
- File `.env`:
  - Line 5: `VITE_USE_FIREBASE_EMULATORS=false`
  - Line 8: `VITE_FIREBASE_API_KEY=AIzaSyCldODj1s-zfGumtSM47Hbp6JRVbxAByko`
  - Line 10: `VITE_FIREBASE_PROJECT_ID=d-arrow-buisiness`
- File `.env.local`:
  - Line 1-4:
    ```ini
    # Explicitly disable Firebase Emulators for local development.
    # When false, the local frontend connects directly to Firebase Production (d-arrow-buisiness).
    VITE_USE_FIREBASE_EMULATORS=false
    VITE_USE_FIREBASE_EMULATOR=false
    ```
- File `src/lib/firebase.ts`:
  - Lines 28-30:
    ```typescript
    const isEmulator =
      env.VITE_USE_FIREBASE_EMULATORS === "true" ||
      (env.VITE_USE_FIREBASE_EMULATOR === "true" && env.VITE_USE_FIREBASE_EMULATORS !== "false");
    ```
  - When `isEmulator` evaluates to `false`:
    - Lines 32-40: `firebaseConfig.projectId` is set to `"d-arrow-buisiness"`.
    - Lines 59-75: Emulators (`connectAuthEmulator`, `connectFirestoreEmulator`, `connectStorageEmulator`) are **SKIPPED**.
    - Lines 76-80: Logs `[Firebase] Connected to Production Project: d-arrow-buisiness`.

### 6.2 The Production Write Leak in WP-01
- File `src/features/crm/hooks/use-contacts.ts`:
  - Lines 40-52 (`useCreateContactMutation`):
    ```typescript
    mutationFn: async (data: CreateContactDTO) => {
      const res = await ContactsService.createContact(companyId!, data);
      if (userId) {
        await ActivitiesService.createActivity(companyId!, {
          type: "note",
          subject: "Contact created",
          description: `${data.firstName} ${data.lastName}`.trim(),
          entityType: "contact",
          entityId: res.data.id,
          occurredAt: new Date().toISOString(),
          userId,
        });
      }
      return res;
    }
    ```
  - Lines 69-80 (`useUpdateContactMutation`):
    ```typescript
    mutationFn: async ({ id, data }: { id: string; data: UpdateContactDTO }) => {
      const res = await ContactsService.updateContact(companyId!, id, data);
      if (userId) {
        await ActivitiesService.createActivity(companyId!, {
          type: "note",
          subject: "Contact updated",
          entityType: "contact",
          entityId: id,
          occurredAt: new Date().toISOString(),
          userId,
        });
      }
      return res;
    }
    ```
- Trace to Firestore:
  1. `ActivitiesService.createActivity` (`src/features/crm/api/activities.service.ts` line 20) calls `base.create` from `createCrmCollectionService` (`src/features/crm/api/crm-base.service.ts` line 65).
  2. Line 31-32: `collPath = (companyId: string) => collection(db, "companies", companyId, "crm_activities");`
  3. Line 73: `const docRef = await addDoc(collPath(companyId), payload);`
  4. `db` is the live Firestore instance connected to **`d-arrow-buisiness` (Firebase Production)**!
- **Consequence**:
  Whenever any developer or browser test creates or updates a contact in the local web application while authenticated, an audit note is written directly to the **Production Firebase Firestore** collection `companies/{companyId}/crm_activities`.
- **Classification**: **CRITICAL BLOCKER**.
- **Required Fix**:
  - Remove all Firebase `ActivitiesService` write calls from `use-contacts.ts` (or mock/disable them until Activities are migrated to NestJS).
  - Ensure local development environment does not allow write traffic to Firebase production projects during test runs.

---

## 7. AUDIT SCORECARD & FINAL CONCLUSIONS

| # | Inspection Item | Classification | Evidence & Notes |
| :--- | :--- | :--- | :--- |
| 1 | **Database & Tenant Invariant** | **VERIFIED** | 0 duplicate memberships; unique constraint active in `darrow_dev`. |
| 2 | **Customer CRUD & Soft Delete** | **VERIFIED** | NestJS + PostgreSQL customer CRUD working; `deletedAt` set on delete. |
| 3 | **Wire Response Envelope** | **VERIFIED** | Exactly 1 envelope `{ data, message }` via `ResponseEnvelopeInterceptor`. |
| 4 | **API Routing & Proxy** | **VERIFIED** | Vite `/api/crm/customers` -> NestJS `/api/v1/crm/customers` mapped cleanly. |
| 5 | **`auth.service.ts` getInvitation** | **VERIFIED** | Pure read-only token resolver, no privilege escalation or mutation. |
| 6 | **Frontend Permissions Gating** | **VERIFIED** | `ContactDetailPage.tsx` hides delete button when `!canManageContacts`. |
| 7 | **Backend Delete Authorization** | **BLOCKER** | `CustomersController.remove` has no `PermissionsGuard` or `@RequirePermission`. |
| 8 | **Firebase Production Leak** | **BLOCKER** | `use-contacts.ts` calls Firestore `addDoc` to production project on create/update. |

---

## 8. NEXT ACTIONS REQUIRED (BEFORE WP-02)

1. **Remediate Blocker 1 (Firebase Production Leak)**:
   - Decouple `use-contacts.ts` from Firestore `ActivitiesService.createActivity`.
2. **Remediate Blocker 2 (Backend Delete Authorization)**:
   - Secure `backend/src/crm/customers.controller.ts` with `PermissionsGuard` and `@RequirePermission("crm.delete")`.
   - Add unit/e2e test proving non-admin/non-manager roles cannot delete customers.
3. **Re-Audit & Formal Sign-off**:
   - Re-verify with read-only checks once remediation instructions are authorized.
   - Do NOT proceed to WP-02 until formal sign-off is granted.
