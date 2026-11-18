# WP-01 BLOCKER REMEDIATION REPORT

**Work Package**: WP-01 — CRM Customers / Contacts: Firebase → NestJS + PostgreSQL  
**Audit & Remediation Date**: 2026-11-15  
**Auditor & Remediation Engineer**: Senior Principal Software Architect & QA/Security Engineer  
**Workspace**: `E:\real projects\DArrow\NewDArrow\d-arrow-business`  
**Target Database**: PostgreSQL `darrow_dev` (`localhost:5432`, User: `darrow`)  
**Production Access Status**: Strictly Forbidden / Verified NOT Accessed  

---

## 1. MIGRATION CONTEXT

Production Firebase remains fully operational and untouched.

This repository is an independent local migration copy. The transformation from Firebase to NestJS + PostgreSQL is strictly incremental and executed feature-by-feature.

Each Work Package completely decouples its assigned feature from Firebase, while unmigrated features (e.g. Leads, Deals, Activities, HR, Billing, Facilities, Marketing) intentionally continue using their existing Firebase integration until their dedicated Work Packages are authorized and executed.

Under this architectural invariant:
> **A feature is not considered migrated until all of its functional and side-effect dependencies on Firebase have been removed.**

---

## 2. BLOCKER 1 REMEDIATION — COMPLETE FIREBASE DECOUPLING FROM CONTACTS

### 2.1 Original Dependency & Exact Chain
During the read-only audit, a hidden side effect was identified in the Contacts React Query hooks:
```text
src/features/crm/hooks/use-contacts.ts
  ├─ useCreateContactMutation (line 43)
  └─ useUpdateContactMutation (line 72)
       │
       ▼
src/features/crm/api/activities.service.ts (ActivitiesService.createActivity)
       │
       ▼
src/features/crm/api/crm-base.service.ts (createCrmCollectionService)
       │
       ▼
src/lib/firebase.ts (db = getFirestore(app) -> projectId: "d-arrow-buisiness")
       │
       ▼
Firestore Production (collection: companies/{companyId}/crm_activities)
```

### 2.2 Why It Prevented Complete Contacts Migration
Although Contacts CRUD had been directed to NestJS (`/api/v1/crm/customers`) and PostgreSQL, any contact creation or update in the browser during local testing with an authenticated user triggered `ActivitiesService.createActivity()`. Because Firebase Emulators are disabled by default in `.env` and `.env.local` (`VITE_USE_FIREBASE_EMULATORS=false`), this fired live Firestore `addDoc` write calls directly to the Production Firebase project (`d-arrow-buisiness`). This meant Contacts was still coupled to Firebase and posed a critical data contamination risk to Production.

### 2.3 Remediation Implemented
Following the sanctioned temporary migration-safe approach (without touching or prematurely migrating unmigrated Activities or other CRM domains):
1. Removed `import { ActivitiesService } from "../api/activities.service";` from `src/features/crm/hooks/use-contacts.ts`.
2. Refactored `useCreateContactMutation` to invoke `ContactsService.createContact(companyId!, data)` purely through NestJS REST API without any Activity side-effects.
3. Refactored `useUpdateContactMutation` to invoke `ContactsService.updateContact(companyId!, id, data)` purely through NestJS REST API without any Activity side-effects.
4. Left `ActivitiesService` and `crm-base.service.ts` completely functional for unmigrated domains (e.g., Leads, Deals, Tasks) so unmigrated features remain stable.

### 2.4 Final Contacts Dependency Graph
```text
Browser UI (ContactsListPage / ContactDetailPage / ContactFormModal)
       │
       ▼
useContactsQuery / useContactQuery / useCreateContactMutation / useUpdateContactMutation / useDeleteContactMutation
       │
       ▼
ContactsService (src/features/crm/api/contacts.service.ts)
       │
       ▼
apiClient (src/lib/api-client.ts) [Axios with Bearer JWT]
       │
       ▼
Vite Dev Proxy (/api -> http://localhost:3005/api/v1)
       │
       ▼
CustomersController (backend/src/crm/customers.controller.ts)
       │
       ▼
CustomersService (backend/src/crm/customers.service.ts)
       │
       ▼
Prisma ORM (backend/src/common/prisma.service.ts)
       │
       ▼
PostgreSQL Database (darrow_dev, table: "Customer")
```

### 2.5 Proof of Zero Firebase Dependency for Contacts
1. **Static Analysis**: Zero imports of `ActivitiesService`, `firebase`, or `firestore` exist across `src/features/crm/api/contacts.service.ts`, `src/features/crm/hooks/use-contacts.ts`, `src/features/crm/types/contacts.types.ts`.
2. **Browser Network Telemetry**: During the end-to-end browser test (`scripts/test-crm-contacts-browser.ts`), full network interception over Chrome DevTools Protocol verified:
   - Total Firestore write requests (`Write`, `commit`, `addDoc`) during the entire Contacts lifecycle: **0**.
   - All Contact operations (List, Create, View, Update, Delete) produced strictly local requests to `http://127.0.0.1:5173/api/crm/customers*` -> `http://localhost:3005/api/v1/crm/customers*`.

---

## 3. BLOCKER 2 REMEDIATION — BACKEND DELETE AUTHORIZATION

### 3.1 Authorization Defect Identified
In `backend/src/crm/customers.controller.ts`, the controller only possessed `@UseGuards(JwtAuthGuard)` at the class level. The `@Delete(":id")` handler had no permission checks. Consequently, any authenticated user belonging to the company (such as an employee or viewer who has no delete privileges in the business rules) could bypass the frontend UI and issue an HTTP `DELETE /api/v1/crm/customers/:id` to soft-delete any customer in their company.

### 3.2 Canonical Permission Selected
- Inspected `backend/src/permissions/manifest.ts` and `src/lib/permissions/index.ts`.
- The canonical permission atom defined for customer deletion is:
  ```typescript
  "crm.delete"
  ```
- In the manifest and PostgreSQL database (`RolePermission` table):
  - `PLATFORM_ADMIN`: Has `crm.delete`
  - `SUPER_ADMIN`: Has `crm.delete`
  - `ADMIN`: Has `crm.delete`
  - `MANAGER`: Does **NOT** have `crm.delete`
  - `GLOBAL_HR_MANAGER`: Does **NOT** have `crm.delete`
  - `EMPLOYEE`: Does **NOT** have `crm.delete`
  - `VIEWER`: Does **NOT** have `crm.delete`

### 3.3 Guard Implementation
1. Updated `backend/src/crm/customers.controller.ts`:
   - Added `PermissionsGuard` to `@UseGuards(JwtAuthGuard, PermissionsGuard)` at the class level.
   - Decorated `@Delete(":id")` with `@RequirePermission("crm.delete")`.
2. Updated `backend/src/crm/crm.module.ts`:
   - Registered `PermissionsGuard` in the module's `providers` array for NestJS dependency injection.
3. Behavior:
   - For handlers without `@RequirePermission`, `PermissionsGuard` passes immediately.
   - For `@Delete(":id")`, `PermissionsGuard` verifies the caller's unique active company membership in `CompanyMembership`, checks `RolePermission` for `"crm.delete"`, and throws `ForbiddenException("Missing permissions: crm.delete")` (HTTP 403) if absent.

### 3.4 Automated Security Tests Added (`backend/test/crm-customers.e2e-spec.ts`)
1. **Unauthorized User Test**:
   - Registered an `EMPLOYEE` in Company A (`crm-test-emp-*@darrow.test`).
   - Attempted `DELETE /api/v1/crm/customers/:id` with the employee's Bearer token.
   - Result: **HTTP 403 Forbidden** (`Missing permissions: crm.delete`).
   - Database verification: Customer in PostgreSQL remained active (`deletedAt === null`).
2. **Authorized User Test**:
   - Executed `DELETE /api/v1/crm/customers/:id` with Company A's `ADMIN` token.
   - Result: **HTTP 200 OK** (`{ removed: true }`, message: `"Customer deleted"`).
   - Database verification: Customer in PostgreSQL was soft-deleted (`deletedAt !== null`).
3. **Cross-Tenant Test**:
   - Company B user (`ADMIN` in Company B) attempted to delete Company A's customer.
   - Result: **HTTP 404 Not Found**. Company A's customer remained untouched.

---

## 4. CURRENT MIGRATION MATRIX

| Feature Domain | Backend Target | Database Target | Firebase Dependency | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CRM Customers / Contacts** | NestJS (`/api/v1/crm/customers`) | PostgreSQL (`Customer`) | **NONE (0%)** | **MIGRATED (WP-01 COMPLETE)** | Full CRUD, soft delete, RBAC (`crm.delete`), tenant isolation verified. |
| **CRM Leads** | Existing / Firebase | Firestore | Yes | PENDING (WP-02) | Unmigrated; operational on Firebase. |
| **CRM Deals** | Existing / Firebase | Firestore | Yes | PENDING (WP-03) | Unmigrated; operational on Firebase. |
| **CRM Activities** | Existing / Firebase | Firestore | Yes | PENDING | Unmigrated; operational on Firebase. |
| **CRM Tasks** | Existing / Firebase | Firestore | Yes | PENDING | Unmigrated; operational on Firebase. |
| **HR Employees** | NestJS Foundation | PostgreSQL | Partial / Hybrid | IN PROGRESS | Core models in Postgres; UI partially hybrid. |
| **Finance / Invoices** | Existing / Firebase | Firestore | Yes | PENDING | Unmigrated; operational on Firebase. |

---

## 5. VERIFICATION EVIDENCE SUMMARY

### 5.1 Typecheck & Unit Tests
- **Backend Typecheck (`npx tsc --noEmit`)**: **PASS** (0 errors).
- **Frontend Typecheck (`npx tsc --noEmit`)**: **PASS** (0 errors).
- **Backend Unit Tests (`npm test`)**: **PASS** (3 test suites passed, 70/70 tests passed).
- **Frontend Production Build (`npm run build`)**: **PASS** (Built in 59.73s, 0 errors).

### 5.2 CRM Customers E2E Tests (`npm run test:e2e` / `crm-customers.e2e-spec.ts`)
- **Suite**: `CRM Customers (e2e) — Tenant Isolation & CRUD`
- **Total Tests**: 12 passed, 0 failed.
  - √ rejects unauthenticated GET /api/v1/crm/customers with 401
  - √ rejects unauthenticated POST /api/v1/crm/customers with 401
  - √ creates a customer in Company A with single response envelope
  - √ prevents client companyId tampering on creation
  - √ retrieves the created customer for Company A
  - √ updates the customer for Company A
  - √ Company B user cannot view Company A customer list
  - √ Company B user cannot retrieve Company A customer by ID (404)
  - √ Company B user cannot update Company A customer (404)
  - √ Company B user cannot delete Company A customer (404)
  - √ rejects DELETE from authenticated employee without crm.delete permission with 403 Forbidden
  - √ allows DELETE from authenticated admin with crm.delete permission with 200 OK and soft-deletes

### 5.3 Autonomous Browser E2E Verification (`test-crm-contacts-browser.ts`)
Full lifecycle executed in Chromium via CDP against local backend (`:3005`) and frontend (`:5173`):
```text
┌─────────┬──────────────────────────────────────────────────────────────────┬────────┬───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ (index) │ step                                                             │ status │ details                                                                                                           │
├─────────┼──────────────────────────────────────────────────────────────────┼────────┼───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 0       │ '1. Login through React UI'                                      │ 'PASS' │ 'tokenStored=true, url=/apps'                                                                                     │
│ 1       │ '2. Navigate to CRM Contacts page'                               │ 'PASS' │ 'Current Path: /crm/contacts'                                                                                     │
│ 2       │ '3. Open Add Contact Modal'                                      │ 'PASS' │ 'Modal opened: true'                                                                                              │
│ 3       │ '4 & 5. Create Contact and Verify API (201 Created)'             │ 'PASS' │ 'Network: POST http://127.0.0.1:5173/api/crm/customers -> 201, DB Customer ID: cmwhq2wnw000fvynk9x7o7nt0'         │
│ 4       │ '6. Open Contact Detail Page'                                    │ 'PASS' │ 'Rendered name "سعود الشهري": true'                                                                               │
│ 5       │ '7. Edit Contact and Verify API (200 OK)'                        │ 'PASS' │ 'Network: PUT http://127.0.0.1:5173/api/crm/customers/cmwhq2wnw000fvynk9x7o7nt0 -> 200'                           │
│ 6       │ '8. Reload and Verify Persistence in UI & DB'                    │ 'PASS' │ 'DB city updated to "جدة - حي الشاطئ" (expected: "جدة - حي الشاطئ")'                                              │
│ 7       │ '9. Delete Contact via UI and Verify Soft Delete'                │ 'PASS' │ 'Network: DELETE http://127.0.0.1:5173/api/crm/customers/cmwhq2wnw000fvynk9x7o7nt0 -> 200, DB deletedAt: [...]' │
│ 8       │ '10. Verify Zero Firebase/Firestore Writes During Contacts CRUD' │ 'PASS' │ 'Detected 0 Firestore write requests during Contacts lifecycle.'                                                  │
└─────────┴──────────────────────────────────────────────────────────────────┴────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. FINAL CONCLUSION & READ-ONLY RE-AUDIT READINESS

Both blockers identified in the acceptance audit have been systematically resolved:
1. **Blocker 1**: Contacts CRUD is completely decoupled from Firebase. Zero Firestore write calls occur.
2. **Blocker 2**: Backend DELETE endpoint strictly enforces `PermissionsGuard` with `@RequirePermission("crm.delete")`, returning `403 Forbidden` for unauthorized roles while preserving tenant isolation and soft deletion.
3. **Unmigrated Features**: Unmigrated domains (Leads, Deals, Activities, HR) remain untouched and operational on Firebase.
4. **Production**: Verified untouched.

**WP-01 is complete, hardened, and ready for final read-only re-audit.**
