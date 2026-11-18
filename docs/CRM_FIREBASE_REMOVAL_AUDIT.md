# D-ARROW — CRM FIREBASE REMOVAL AUDIT REPORT

## 1. Executive Summary

- **Target Domain**: CRM (`src/features/crm/`)
- **Status**: **100% COMPLETE — ZERO FIREBASE DEPENDENCIES**
- **Verification Command**:
  ```powershell
  Get-ChildItem -Recurse -Include *.ts,*.tsx src\features\crm | Select-String -Pattern 'firebase'
  ```
- **Result**: **0 occurrences found across all CRM files**.

---

## 2. Exhaustive File-by-File Migration Audit

| CRM File / Component | Previous State | Migrated State | Backend Controller / Service | Primary Database Table |
|---|---|---|---|---|
| `src/features/crm/api/contacts.service.ts` | Firestore (`customers` / `companies/{id}/customers`) | NestJS `apiClient.get/post/put/delete('/crm/customers')` | `CustomersController` / `CustomersService` | `Customer` |
| `src/features/crm/api/leads.service.ts` | Firestore (`leads` / `companies/{id}/leads`) | NestJS `apiClient.get/post/put/delete('/crm/leads')` | `LeadsController` / `LeadsService` | `Lead` |
| `src/features/crm/api/deals.service.ts` | Firestore (`deals` / `companies/{id}/deals`) | NestJS `apiClient.get/post/put/delete('/crm/deals')` | `DealsController` / `DealsService` | `Deal` |
| `src/features/crm/api/activities.service.ts` | Firestore (`activities` / `companies/{id}/activities`) | NestJS `apiClient.get/post/put/delete('/crm/activities')` | `ActivitiesController` / `ActivitiesService` | `CrmActivity` |
| `src/features/crm/api/notifications.service.ts` | Firestore (`notifications`) | NestJS `apiClient.get/post/put/delete('/crm/notifications')` | `NotificationsController` / `NotificationsService` | `CrmNotification` |
| `src/features/crm/api/contracts.service.ts` | Firestore via `crm-base.service` (`companies/{id}/contracts`) | NestJS `apiClient.get/post/put/delete('/crm/contracts')` | `ContractsController` / `ContractsService` | `CrmContract` |
| `src/features/crm/api/quotations.service.ts` | Firestore via `crm-base.service` (`companies/{id}/quotations`) | NestJS `apiClient.get/post/put/delete('/crm/quotations')` | `QuotationsController` / `QuotationsService` | `CrmQuotation` |
| `src/features/crm/api/crm-tasks.service.ts` | Firestore via `crm-base.service` (`companies/{id}/crm_tasks`) | NestJS `apiClient.get/post/put/delete('/crm/tasks')` | `CrmTasksController` / `CrmTasksService` | `CrmTask` |
| `src/features/crm/api/notes.service.ts` | Firestore via `crm-base.service` (`companies/{id}/crm_notes`) | NestJS `apiClient.get/post/put/delete('/crm/notes')` | `NotesController` / `NotesService` | `CrmNote` |
| `src/features/crm/api/attachments.service.ts` | Firestore via `crm-base.service` (`companies/{id}/crm_attachments`) | NestJS `apiClient.get/post/put/delete('/crm/attachments')` | `AttachmentsController` / `AttachmentsService` | `CrmAttachment` |
| `src/features/crm/api/client-reports.service.ts` | Direct Firestore (`companies/{id}/client_reports`) | NestJS `apiClient.get/post/put/delete('/crm/client-reports')` | `ClientReportsController` / `ClientReportsService` | `CrmClientReport` |
| `src/features/crm/api/contact-classification.service.ts` | Direct Firestore (`companies/{id}/contact_classifications`) | NestJS `apiClient.get/post/put/delete('/crm/contact-classifications')` | `ContactClassificationsController` / `ContactClassificationsService` | `CrmContactClassification` |
| `src/features/crm/pages/PublicClientReportPage.tsx` | Direct Firestore `getDoc(companies/{id}/client_reports/{id})` | Public NestJS endpoint: `GET /crm/public/client-reports/view/:companyId/:reportId` | `PublicClientReportsController` | `CrmClientReport` |
| `src/features/crm/api/crm-base.service.ts` | Firestore collection helper (`collection`, `getDocs`, etc.) | **Deprecated stub** with zero Firebase imports | N/A | N/A |
| `src/features/crm/utils/firestore-mappers.ts` | Imported `Timestamp` from `firebase/firestore` | Migrated to **duck-typing** (`toDate()` / `Date`) with zero Firebase imports | N/A | N/A |

---

## 3. Security & Architecture Audit

1. **Strict Tenant Isolation**:
   - Every CRM request passes through `JwtAuthGuard` & `PermissionsGuard`.
   - `companyId` is extracted server-side from `req.user.companyId` (derived from validated JWT session).
   - Foreign-key lookups enforce tenant boundaries (`customer.findFirst({ where: { id, companyId } })`).
   - Cross-company access returns `404 Not Found` or `400 Bad Request`.

2. **Public Client Report Hardening (WP-12)**:
   - Rate-limited using `@RateLimit({ max: 30, windowSeconds: 60 })`.
   - Public view endpoint explicitly strips `internalNotes`, `publicToken`, `deletedAt`, and company internal metadata.
   - Revocation flag `isPublicRevoked` immediately cuts off public viewing with `403 Forbidden`.
   - Token expiration (`publicTokenExpiresAt`) enforced automatically.

3. **Soft-Delete Invariant**:
   - All models implement `deletedAt DateTime?`.
   - All `findMany` and `findFirst` queries enforce `deletedAt: null`.
