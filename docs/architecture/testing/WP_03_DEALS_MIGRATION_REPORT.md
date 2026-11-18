# D-ARROW — WP-03 CRM DEALS MIGRATION REPORT
## Firebase Firestore → NestJS + Prisma + PostgreSQL

**Report Date**: 2026-11-15  
**Author**: Senior Principal Software Architect + Security & QA Engineer  
**Workspace**: `E:\real projects\DArrow\NewDArrow\d-arrow-business`  
**Target Database**: Local PostgreSQL `darrow_dev`  
**Status**: COMPLETED & VERIFIED

---

## 1. Executive Summary

Work Package 03 (**CRM Deals Migration**) successfully transitioned CRM Deals CRUD and stage management from Firebase Firestore to local NestJS REST APIs backed by Prisma and PostgreSQL (`darrow_dev`). 

All Deal operations (Create, List, Detail, Update, Stage Transition, and Soft-Deletion) are now 100% PostgreSQL-native, strictly tenant-isolated, guarded with NestJS RBAC (`PermissionsGuard` with `crm.delete`), and enveloped with clean single-response payloads. Automated client-side writes to Firestore activities and notifications have been decoupled during the Deals lifecycle, while preserving unmigrated subcollections (Notes, Tasks, Attachments) on legacy services.

All automated and browser verification gates passed with zero regressions against WP-01 (Customers/Contacts) and WP-02 (Leads).

---

## 2. Actual Scope Completed

- [x] **NestJS Deals Controller Hardening**: Fixed `@IsNumber()` validation for `amount`, removed manual double-envelope wrapping, added `@ResponseMessage` decorators, added `@UseGuards(JwtAuthGuard, PermissionsGuard)`, and added `@RequirePermission("crm.delete")` on deletion.
- [x] **NestJS Deals Service Implementation**: Derives `companyId` strictly from authenticated user; validates that `contactId` and `leadId` belong to the same company (preventing IDOR and cross-tenant foreign key linking); implements bidirectional enum translation between frontend stage slugs and PostgreSQL `DealStage` enum; enforces soft-deletion (`deletedAt = new Date()`) and filters `deletedAt: null` across all queries.
- [x] **Frontend Deals API Service**: Replaced `createCrmCollectionService` (Firestore) with `apiClient` (`/crm/deals`), implementing typed DTO and backend payload mappers.
- [x] **Frontend Hooks & Decoupling**: Updated `src/features/crm/hooks/use-deals.ts` to consume the NestJS API and decoupled automated client-side Firestore writes (`ActivitiesService.createActivity` and `CrmNotificationsService.createNotification`); added `useDeleteDealMutation`.
- [x] **Deal Detail UI Hardening**: Integrated deletion action button in `DealDetailPage.tsx` gated by `canDeleteCrm`.
- [x] **E2E & Regression Suites**: Authored 17-test NestJS E2E integration suite (`crm-deals.e2e-spec.ts`); validated full backend E2E suite (86/86 tests passing); verified zero regressions in WP-01 (12/12 passing) and WP-02 (15/15 passing).
- [x] **Browser E2E & Network Audit**: Created and passed 10-step Chromium browser E2E test with CDP network monitoring, confirming **0 Firestore write requests** during the entire Deals CRUD lifecycle.

---

## 3. Files Changed

### Backend Files
1. `backend/src/crm/deals.controller.ts`: Added guards, response message decorators, unified DTOs, and RBAC delete guard.
2. `backend/src/crm/deals.service.ts`: Implemented tenant-scoped Prisma queries, stage enum translation, cross-tenant FK verification, and soft-delete.
3. `backend/package.json`: Added `--forceExit` to `test:e2e` for clean test harness teardown.
4. `backend/test/crm-deals.e2e-spec.ts`: 17 comprehensive E2E tests for Auth, CRUD, Anti-Tampering, Cross-Tenant Relations, Tenant Isolation, and RBAC.

### Frontend Files
1. `src/features/crm/api/deals.service.ts`: Rewritten to use `apiClient` with `mapBackendDealToDeal` and `mapDealDTOToBackendPayload`.
2. `src/features/crm/hooks/use-deals.ts`: Decoupled automated Firestore writes; added `useDeleteDealMutation`.
3. `src/features/crm/pages/DealDetailPage.tsx`: Added delete button gated by `canDeleteCrm` and wired to `useDeleteDealMutation`.

### Test & Artifact Files
1. `scripts/test-crm-deals-browser.ts`: Playwright Chromium browser E2E script with CDP network request interception.
2. `screenshots-deals/`: 9 captured visual screenshots verifying UI states from login to pipeline, modal, detail, edit, and deletion.
3. `docs/architecture/testing/WP_03_DEALS_DISCOVERY_AUDIT.md`: Phase A discovery report.
4. `docs/architecture/testing/WP_03_DEALS_MIGRATION_REPORT.md`: Phase B execution report.

---

## 4. Backend Implementation

### Final API Routes
- `GET /api/v1/crm/deals` — Lists deals scoped to `user.companyId` (`deletedAt: null`).
- `POST /api/v1/crm/deals` — Creates deal in `user.companyId` with validated `contactId`/`leadId`.
- `GET /api/v1/crm/deals/:id` — Retrieves deal; returns 404 if not found or belongs to another company.
- `PATCH /api/v1/crm/deals/:id` / `PUT /api/v1/crm/deals/:id` — Updates deal fields / stage transition.
- `DELETE /api/v1/crm/deals/:id` — Enforces `@RequirePermission("crm.delete")`; sets `deletedAt: new Date()`.

### Stage Enum Mapping
A bidirectional mapper cleanly translates between the frontend's lowercase kebab strings and PostgreSQL's Prisma `DealStage` enum:

| Frontend Stage | Prisma / PostgreSQL Enum | Stage Probability Default |
| :--- | :--- | :---: |
| `lead` / `prospecting` | `PROSPECTING` | 1 (10%) |
| `contacted` / `needs_analysis` | `NEEDS_ANALYSIS` | 2 (20%) |
| `qualified` / `qualification` | `QUALIFICATION` | 4 (40%) |
| `proposal_sent` / `value_proposal` | `VALUE_PROPOSAL` | 6 (60%) |
| `negotiation` | `NEGOTIATION` | 8 (80%) |
| `won` / `closed_won` | `CLOSED_WON` | 10 (100%) |
| `lost` / `closed_lost` | `CLOSED_LOST` | 0 (0%) |

### Cross-Tenant Foreign Key Prevention
In `deals.service.ts`, before linking a `contactId` or `leadId`, the service verifies company ownership:
```typescript
if (contactId) {
  const contact = await this.prisma.customer.findFirst({
    where: { id: contactId, companyId, deletedAt: null },
  });
  if (!contact) throw new BadRequestException("Contact not found or does not belong to your company");
}
```
Attempting to link Company B's customer to Company A's deal returns `400 Bad Request`.

---

## 5. Frontend Implementation

- `DealsService` uses `apiClient` with base URL `/api`, proxied by Vite to `/api/v1` on port 3005.
- Single response envelope format `{ success: true, data: [...], timestamp: "..." }` unwrapped smoothly by `apiClient`.
- Kanban Board (`DealKanbanBoard.tsx`) drag-and-drop triggers `useUpdateDealStageMutation`, sending `PATCH /crm/deals/:id` with new stage and updated probability.
- All loading, empty, and error states preserved.

---

## 6. Database and Schema Changes

- **Migrations Applied**: None required.
- **Existing Schema**: The Prisma `Deal` model and `DealStage` enum were verified in PostgreSQL `darrow_dev`.
- **Soft Deletion**: `deletedAt DateTime?` field is used across all queries (`where: { deletedAt: null }`).

---

## 7. Firebase Dependency Status

| Module / Feature | Current Storage | Status in WP-03 |
| :--- | :--- | :--- |
| **CRM Deals Core CRUD** | PostgreSQL (`darrow_dev`) | **100% Migrated** (0 Firestore writes) |
| **CRM Contacts / Customers** | PostgreSQL (`darrow_dev`) | **100% Migrated** (WP-01) |
| **CRM Leads** | PostgreSQL (`darrow_dev`) | **100% Migrated** (WP-02) |
| **Deal Notes Subcollection** | Firebase Firestore (`notes`) | Unmigrated (Deferred to Notes WP) |
| **Deal Tasks Subcollection** | Firebase Firestore (`tasks`) | Unmigrated (Deferred to Tasks WP) |
| **Deal Activities Subcollection** | Firebase Firestore (`activities`) | Unmigrated (Deferred to Activities WP) |
| **Deal Attachments Subcollection** | Firebase Storage / Firestore | Unmigrated (Deferred to Attachments WP) |

---

## 8. Tenant Isolation Evidence

- Derived exclusively from `req.user.companyId`.
- Verified in `backend/test/crm-deals.e2e-spec.ts`:
  - `Company B user cannot view Company A deals list` -> PASS.
  - `Company B user cannot retrieve Company A deal by ID (404)` -> PASS.
  - `Company B user cannot update Company A deal (404)` -> PASS.
  - `Company B user cannot delete Company A deal (404)` -> PASS.
  - `prevents client companyId tampering on creation` -> PASS.
  - `rejects linking a deal to a contact belonging to another company (400)` -> PASS.

---

## 9. RBAC Evidence

- Enforced at controller layer: `@UseGuards(JwtAuthGuard, PermissionsGuard)`.
- Verified in `backend/test/crm-deals.e2e-spec.ts`:
  - Authenticated employee without `crm.delete` permission: `403 Forbidden` (`res.body.message` contains `"crm.delete"`).
  - Authenticated admin with `crm.delete` permission: `200 OK` (record soft-deleted).

---

## 10. Business Rules Verification

- Minimum amount validated (>= 0).
- Currency formatted with Saudi Riyal symbol and 3-letter currency code.
- Stage progression mapped to 0–10 scale probabilities.
- Soft-deleted deals excluded from pipeline, list view, and global search.

---

## 11. Test Results with Exact Counts

| Test Suite | Scope | Result | Test Count |
| :--- | :--- | :---: | :---: |
| `backend` TypeScript Check | `npx tsc --noEmit` | **PASS** | 0 errors |
| `backend` Unit Tests | `npm test` | **PASS** | 70/70 passed (3 suites) |
| `crm-deals.e2e-spec.ts` | Deals E2E Suite | **PASS** | **17/17 passed** |
| `crm-customers.e2e-spec.ts` | WP-01 Regression | **PASS** | 12/12 passed |
| `crm-leads.e2e-spec.ts` | WP-02 Regression | **PASS** | 15/15 passed |
| Full Backend E2E Suite | `npm run test:e2e` | **PASS** | **86/86 passed** (5 suites) |
| Frontend TypeScript Check | `npx tsc -b` | **PASS** | 0 errors |
| Frontend Production Build | `npm run build` | **PASS** | Built in 1m 1s |
| Browser E2E Lifecycle | `test-crm-deals-browser.ts` | **PASS** | **10/10 passed** |

---

## 12. Browser E2E Evidence

Executed via `scripts/test-crm-deals-browser.ts` in Chromium via CDP against `http://127.0.0.1:5173`:
```text
===============================================================================
                        BROWSER E2E TEST SUMMARY
===============================================================================
✓ [PASS] 1. Login through React UI
    tokenStored=true, url=/apps
✓ [PASS] 2. Navigate to CRM Deals page
    Current Path: /crm/deals
✓ [PASS] 3. Open Add Deal Modal
    Modal opened: true
✓ [PASS] 4 & 5. Create Deal and Verify API (201 Created)
    Network: POST http://127.0.0.1:5173/api/crm/deals -> 201, DB Deal ID: cmwhujq23000jvyk85pzex3nu
✓ [PASS] 6. Open Deal Detail Page
    Rendered title "مشروع توريد وتجهيز أنظمة ذكية لبرج الأعمال": true
✓ [PASS] 7. Edit Deal and Verify API (200 OK)
    Network: PATCH http://127.0.0.1:5173/api/crm/deals/cmwhujq23000jvyk85pzex3nu -> 200
✓ [PASS] 8. Reload and Verify Persistence in UI & DB
    DB amount updated to 250000
✓ [PASS] 9. Delete Deal via UI and Verify Soft Delete
    Network: DELETE http://127.0.0.1:5173/api/crm/deals/cmwhujq23000jvyk85pzex3nu -> 200, DB deletedAt: Sun Nov 15 2026 15:04:59 GMT+0200
✓ [PASS] 10. Verify Zero Firebase/Firestore Writes During Deals CRUD
    Detected 0 Firestore write requests during Deals lifecycle.
===============================================================================
```

Visual screenshot artifacts saved in `screenshots-deals/`:
- `01-login-success.png`
- `02-deals-pipeline.png`
- `03-add-deal-modal.png`
- `04-deal-form-filled.png`
- `05-deal-saved-in-pipeline.png`
- `06-deal-detail.png`
- `07-deal-edited.png`
- `08-reloaded-persisted.png`
- `09-deal-deleted.png`

---

## 13. Firestore Network Evidence

During the entire 10-step browser lifecycle of Deals CRUD, CDP network request interception recorded:
- **Total Firestore write requests**: **`0`** (`/google.firestore.v1.Firestore/Write`, `commit`, etc.).
- All Deal operations went through `http://127.0.0.1:5173/api/crm/deals` -> `http://localhost:3005/api/v1/crm/deals` -> PostgreSQL `darrow_dev`.

---

## 14. WP-01 & WP-02 Regression Results

- **WP-01 Customers E2E**: 12/12 passing (`test/crm-customers.e2e-spec.ts`).
- **WP-02 Leads E2E**: 15/15 passing (`test/crm-leads.e2e-spec.ts`).
- **Zero regressions detected across previously accepted modules.**

---

## 15. Known Limitations & Deferred Dependencies

1. **Automated Activities & Notifications Deferred**: Automated timeline entries ("Deal created", "Deal stage changed") were detached from `use-deals.ts` to prevent client-side writes to production Firestore. These will be implemented natively in PostgreSQL during the CRM Activities & Notifications Work Package.
2. **Subcollections in Deal Details Tab**: The Notes, Tasks, and Attachments tabs on `DealDetailPage` remain powered by unmigrated Firebase services and will be migrated in their respective dedicated Work Packages.

---

## 16. Git Diff Summary

```text
M backend/package.json
M backend/src/crm/deals.controller.ts
M backend/src/crm/deals.service.ts
M src/features/crm/api/deals.service.ts
M src/features/crm/hooks/use-deals.ts
M src/features/crm/pages/DealDetailPage.tsx
?? backend/test/crm-deals.e2e-spec.ts
?? scripts/test-crm-deals-browser.ts
?? screenshots-deals/
?? docs/architecture/testing/WP_03_DEALS_DISCOVERY_AUDIT.md
?? docs/architecture/testing/WP_03_DEALS_MIGRATION_REPORT.md
```

---

## 17. Production Safety Confirmation

- **Production Firebase Project**: `d-arrow-buisiness` untouched; zero write requests dispatched.
- **Production Database**: Zero connections, migrations, or writes.
- **Local Isolation**: All tests and development took place strictly on `localhost:3005`, `127.0.0.1:5173`, and local database `darrow_dev`.

---

## 18. Final Acceptance Matrix

| # | Criterion | Verification Method | Status |
| :-: | :--- | :--- | :-: |
| 1 | **Local Database Safety** | `SELECT current_database()` -> `darrow_dev` | **PASS** |
| 2 | **NestJS Deals Controller** | Guarded by `JwtAuthGuard` & `PermissionsGuard` | **PASS** |
| 3 | **NestJS Deals Service** | Derives `companyId` from JWT; soft-delete enabled | **PASS** |
| 4 | **Single Response Envelope** | Verified directly via Supertest; no double wrapping | **PASS** |
| 5 | **Validation of Amount** | Validated as number, stored as integer minor units | **PASS** |
| 6 | **Stage Enum Mapping** | Bidirectional mapping between frontend slugs & Prisma enum | **PASS** |
| 7 | **Cross-Tenant FK Prevention** | Reject linking contact/lead of other company (400) | **PASS** |
| 8 | **Tenant Isolation** | Cross-company list/get/update/delete returns 404 | **PASS** |
| 9 | **RBAC Enforcement** | Delete returns 403 without `crm.delete`, 200 with it | **PASS** |
| 10 | **Soft Deletion** | Record marked with `deletedAt`, excluded from queries | **PASS** |
| 11 | **Frontend Deals API Service** | Replaced Firestore with `apiClient` (`/crm/deals`) | **PASS** |
| 12 | **Frontend Hooks & Mutations** | React Query hooks updated; Firestore writes decoupled | **PASS** |
| 13 | **Deal Detail Page Deletion** | Delete button wired with `canDeleteCrm` permission gate | **PASS** |
| 14 | **Zero Firestore Writes (CRUD)** | Verified via CDP network monitoring (0 writes) | **PASS** |
| 15 | **Backend Unit Tests** | 70/70 passing across 3 suites | **PASS** |
| 16 | **Deals E2E Suite** | 17/17 passing in `crm-deals.e2e-spec.ts` | **PASS** |
| 17 | **WP-01 Customers Regression** | 12/12 passing in `crm-customers.e2e-spec.ts` | **PASS** |
| 18 | **WP-02 Leads Regression** | 15/15 passing in `crm-leads.e2e-spec.ts` | **PASS** |
| 19 | **Full Backend E2E Suite** | 86/86 passing across all 5 suites | **PASS** |
| 20 | **Frontend TypeScript Check** | `npx tsc -b` passed with 0 errors | **PASS** |
| 21 | **Frontend Production Build** | `npm run build` passed cleanly in 1m 1s | **PASS** |
| 22 | **Browser E2E Lifecycle** | 10/10 steps passed via Playwright Chromium | **PASS** |

---

## 19. Final Verdict

### **`WP-03 ACCEPTED WITH DOCUMENTED LIMITATIONS`**

#### Documented Limitations:
1. Automated timeline creation (`ActivitiesService.createActivity`) and notifications (`CrmNotificationsService.createNotification`) upon Deal create/stage change are deferred to the dedicated CRM Activities & Notifications Work Package to preserve zero Firestore writes in local environments.
2. Subcollection tabs on `DealDetailPage` (Notes, Tasks, Attachments) remain on legacy Firebase storage until their respective Work Packages are executed.
