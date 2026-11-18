# D-ARROW — WP-04 CRM ACTIVITIES & NOTIFICATIONS
## READ-ONLY DISCOVERY, ARCHITECTURE AUDIT & MIGRATION PLANNING

**Date:** 2026-11-15  
**Auditor:** Senior Software Architect, NestJS/PostgreSQL Migration Lead, Firebase Migration Auditor & Application Security Engineer  
**Phase:** WP-04 Discovery ONLY  
**Mode:** STRICT READ-ONLY  
**Target:** Local development environment ONLY (`darrow_dev`)  
**Production Access:** ZERO — STRICTLY PROHIBITED  
**Status:** DISCOVERY COMPLETE — READY FOR IMPLEMENTATION REVIEW

---

## 1. Executive Summary

This read-only architectural audit examines the **CRM Activities** and **CRM Notifications** subsystems in the D-Arrow Business Platform. The objective is to prepare the technical, data, security, and interface specifications required to migrate these capabilities from Firebase/Firestore to NestJS + Prisma + PostgreSQL (`darrow_dev`) as sequential Work Package 04 (WP-04).

### Key Architectural Discoveries
1. **Two Distinct Notification Domains:** The application maintains two separate notification mechanisms:
   - **CRM Notifications (`CrmNotificationsService`):** Scoped to CRM domain alerts (`assignment`, `deal_stage`, `lead_assigned`, `reminder`, `general`), stored in Firestore at `companies/{companyId}/crm_notifications`, and presented via `CrmNotificationCenter` in the CRM portal toolbar.
   - **Global App Notifications (`NotificationsService`):** Scoped to cross-portal alerts (`attendance_*`, `task_*`, `chat_*`, `document_approval`), stored in `companies/{companyId}/notifications`, and presented via `NotificationsDropdown` in the global app header.
2. **Critical Security & Data Leak in Legacy CRM Notifications:** In `src/features/crm/hooks/use-crm-notifications.ts` (line 13–14), the client calls `CrmNotificationsService.getNotifications(companyId)` which fetches **all** notifications for the entire company over the network and then filters by `n.userId === userId` in-memory in the browser. Any authenticated user in a company can view all other users' notifications in the browser Network tab.
3. **Client-Side Heavy Activities Overhead:** In `src/features/crm/hooks/use-crm-entity-data.ts` (line 29–33), `useCrmEntityActivities` queries the entire company's activities collection (`companies/{companyId}/activities`) without an entity filter, performing client-side array filtering by `entityType` and `entityId`.
4. **Complete Backend Vacuum:** Neither `Activity` nor `Notification` models exist in PostgreSQL (`schema.prisma`). No backend controller, service, or route currently exists for either domain in NestJS.
5. **Zero Test Coverage:** No backend or frontend automated tests currently exist for Activities or CRM Notifications.
6. **Decoupled Producers from WP-01/02/03:** As part of the accepted WP-01, WP-02, and WP-03 migrations, automated Firestore activity/notification writes during Contact, Lead, and Deal CRUD were safely decoupled, avoiding hybrid data corruption.

---

## 2. Repository Baseline

A strict audit of Git status was performed on branch `main` at `E:\real projects\DArrow\NewDArrow\d-arrow-business`:

- **Branch:** `main`
- **Cleanliness:** No uncommitted changes were reset, discarded, or stashed.
- **WP-01, WP-02, WP-03 Status:** Accepted and intact. All regression suites continue to pass (95/95 full backend E2E, 70/70 unit tests, 0 TypeScript errors).
- **Target Database:** Local PostgreSQL `darrow_dev` on `localhost:5432`. No production credentials configured or used.

---

## 3. Activities Architecture

### 3.1 Domain Definition
In D-Arrow CRM, an "Activity" represents a timestamped event or interaction logged against a CRM entity (`lead`, `contact`, or `deal`). 

### 3.2 Data Structure
Defined in `src/features/crm/types/activities.types.ts`:
```typescript
export type ActivityType = "call" | "email" | "meeting" | "note" | "other";

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  description?: string;
  entityType: CrmEntityType; // "lead" | "contact" | "deal"
  entityId: string;
  occurredAt: string;        // ISO timestamp
  durationMinutes?: number;
  userId: string;
  createdAt: string;
}
```

### 3.3 Storage & Retrieval Mechanism
- **Storage Location:** Firestore subcollection at `companies/{companyId}/activities/{activityId}`.
- **Service Abstraction:** `src/features/crm/api/activities.service.ts` uses `createCrmCollectionService` from `crm-base.service.ts`.
- **Retrieval Pattern:** Fetches up to 200 activity documents for the whole company ordered by `createdAt desc`.
- **Filtering:** Client-side in `src/features/crm/hooks/use-crm-entity-data.ts`:
  ```typescript
  export function useCrmEntityActivities(entityType: CrmEntityType, entityId: string) {
    const { companyId } = useCompany();
    return useQuery({
      queryKey: [...QUERY_KEYS.crm.activities(companyId!), entityType, entityId],
      queryFn: async () => {
        const res = await ActivitiesService.getActivities(companyId!);
        return filterByEntity(res.data, entityType, entityId).sort(
          (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
        );
      },
      enabled: !!companyId && !!entityId,
    });
  }
  ```

### 3.4 Immutability & Lifecycle
- Activities are designed as an append-only audit/interaction trail.
- The UI exposes manual creation (`onLogActivity`) for `call`, `email`, `meeting`, and `note`.
- No UI component exposes activity editing or deletion; however, the underlying legacy service (`ActivitiesService.updateActivity`, `ActivitiesService.deleteActivity`) contains unused update/delete methods.

---

## 4. Notifications Architecture

### 4.1 Distinction Between CRM and Global Notifications
Inspection confirmed two independent notification systems in the frontend:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND APPLICATION                            │
├───────────────────────────────────┬────────────────────────────────────┤
│         CRM NOTIFICATIONS         │       GLOBAL APP NOTIFICATIONS     │
├───────────────────────────────────┼────────────────────────────────────┤
│ Collection:                       │ Collection:                        │
│ companies/{id}/crm_notifications  │ companies/{id}/notifications       │
│                                   │                                    │
│ Service:                          │ Service:                           │
│ CrmNotificationsService           │ NotificationsService               │
│                                   │                                    │
│ Hook:                             │ Hook:                              │
│ useCrmNotificationsQuery          │ useNotifications                   │
│                                   │                                    │
│ UI Mount:                         │ UI Mount:                          │
│ CrmNotificationCenter             │ NotificationsDropdown              │
│ (Toolbar inside CrmLayout)        │ (Main navigation header)           │
│                                   │                                    │
│ Target Domain:                    │ Target Domain:                     │
│ CRM entity alerts (lead/deal)     │ Tasks, Attendance, Chat, HR        │
└───────────────────────────────────┴────────────────────────────────────┘
```

### 4.2 CRM Notification Data Structure
Defined in `src/features/crm/types/notifications.types.ts`:
```typescript
export type CrmNotificationType =
  | "assignment"
  | "deal_stage"
  | "lead_assigned"
  | "reminder"
  | "general";

export interface CrmNotification {
  id: string;
  userId: string;
  type: CrmNotificationType;
  title: string;
  body: string;
  entityType?: CrmEntityType;
  entityId?: string;
  read: boolean;
  createdAt: string;
}
```

### 4.3 Push Notifications & FCM Status
Inspection of `src/lib/browser-notifications.ts` and `src/lib/firebase.ts` proved:
- **No Firebase Cloud Messaging (FCM):** FCM is not initialized (`getMessaging` is absent).
- **No Background Push / Service Workers:** No service worker push registrations exist.
- **Pure Web Notifications API:** Browser notifications rely strictly on the standard client-side `window.Notification` API (`showBrowserNotification`) triggered during user interaction.

---

## 5. Activity Event Sources Matrix

| Business Event | Current Code Trigger | Current Storage | Target Entity | Trigger Mode | Firebase Dependency |
|:---|:---|:---|:---|:---|:---|
| **Manual Activity Log** (Call, Meeting, Email) | `useCreateCrmActivityMutation` (`use-crm-entity-data.ts:144`) | Firestore `activities` | Lead, Deal | Manual UI submission | Direct Firestore write |
| **Note Created on Entity** | `useCreateCrmNoteMutation` (`use-crm-entity-data.ts:92`) | Firestore `activities` | Lead, Deal | Automated side-effect | Direct Firestore write |
| **CRM Task Created** | `useCreateCrmTaskMutation` (`use-crm-tasks.ts:40`) | Firestore `activities` | Lead, Deal | Automated side-effect | Direct Firestore write |
| **CRM Task Completed** | `useUpdateCrmTaskMutation` (`use-crm-tasks.ts:80`) | Firestore `activities` | Lead, Deal | Automated side-effect | Direct Firestore write |
| **Attachment Uploaded** | `useUploadCrmAttachmentMutation` (`use-crm-entity-data.ts:228`) | Firestore `activities` | Lead, Deal | Automated side-effect | Direct Firestore write |
| **Lead Converted to Contact** | `LeadConversionService.convertToContact` (`lead-conversion.service.ts:54, 63`) | Firestore `activities` | Lead & Contact | Automated (2 records) | Direct Firestore write |
| **Entity Reassignment** | `reassignCrmEntities` (`crm-entity-reassign.service.ts:46`) | Firestore `activities` | Reassigned target | Automated batch rewrite | Direct Firestore write |
| **Contact Created/Updated** | *Removed in WP-01* | N/A | Contact | Decoupled | None |
| **Lead Created/Updated** | *Removed in WP-02* | N/A | Lead | Decoupled | None |
| **Deal Created/Updated** | *Removed in WP-03* | N/A | Deal | Decoupled | None |

---

## 6. Notification Event Sources Matrix

| Business Event | Current Code Trigger | Recipient Logic | Target Storage | Trigger Mode | Firebase Dependency |
|:---|:---|:---|:---|:---|:---|
| **CRM Task Assigned** | `useCreateCrmTaskMutation` (`use-crm-tasks.ts:51`) | `data.assigneeId` | Firestore `crm_notifications` | Automated | Direct Firestore write |
| **Lead Reassignment** | Legacy `use-leads.ts` (removed in WP-02) | Assignee user | Firestore `crm_notifications` | Previously automated | Decoupled in WP-02 |
| **Deal Stage / Assignment** | Legacy `use-deals.ts` (removed in WP-03) | Assignee user | Firestore `crm_notifications` | Previously automated | Decoupled in WP-03 |
| **Global Task Assigned** | `task-notifications.service.ts:89` | Task assignee | Firestore `notifications` | Automated | Global Firestore write |
| **Attendance Clock In/Out** | `attendance-notifications.service.ts:51` | HR Manager | Firestore `notifications` | Automated | Global Firestore write |
| **Chat Mention** | `chat-notifications.ts:75` | Mentioned user | Firestore `notifications` | Automated | Global Firestore write |
| **Document Approval** | `document-approval-notifications.ts:44` | Approver user | Firestore `notifications` | Automated | Global Firestore write |

---

## 7. Firebase Dependency Map

The following files contain direct Firebase dependencies for Activities and Notifications:

| File Path | Function / Method | Firebase Operation | Firebase Service | Classification |
|:---|:---|:---|:---|:---|
| `src/features/crm/api/activities.service.ts` | `getActivities`, `createActivity` | `getDocs`, `addDoc` | Firestore `activities` | `LEGACY_FIREBASE` |
| `src/features/crm/api/notifications.service.ts` | `getNotifications`, `createNotification` | `getDocs`, `addDoc`, `updateDoc` | Firestore `crm_notifications` | `LEGACY_FIREBASE` |
| `src/features/crm/api/crm-base.service.ts` | `createCrmCollectionService` | `getDocs`, `addDoc`, `updateDoc`, `deleteDoc` | Firestore generic | `LEGACY_FIREBASE` |
| `src/features/crm/api/crm-entity-reassign.service.ts` | `reassignCrmEntities` | `updateDoc` on activities | Firestore `activities` | `LEGACY_FIREBASE` |
| `src/features/crm/api/lead-conversion.service.ts` | `convertToContact` | `addDoc` on activities | Firestore `activities` | `LEGACY_FIREBASE` |
| `src/features/crm/hooks/use-crm-entity-data.ts` | `useCrmEntityActivities` | Calls `ActivitiesService` | Firestore `activities` | `LEGACY_FIREBASE` |
| `src/features/crm/hooks/use-crm-notifications.ts` | `useCrmNotificationsQuery` | Calls `CrmNotificationsService` | Firestore `crm_notifications` | `LEGACY_FIREBASE` |
| `src/features/crm/hooks/use-customer-timeline.ts` | `useCustomerTimeline` | Calls `ActivitiesService.getActivities` | Firestore `activities` | `LEGACY_FIREBASE` |
| `src/features/notifications/api/notifications.service.ts` | `subscribeToNotifications` | `onSnapshot`, `getDocs`, `addDoc` | Firestore `notifications` | `SHARED_DEPENDENCY` |

---

## 8. Prisma and Database Assessment

### Current Schema Status (`backend/prisma/schema.prisma`)
Inspection confirmed:
- **No `CrmActivity` or `Activity` model** exists.
- **No `CrmNotification` or `Notification` model** exists.
- The `AuditLog` table (lines 235–249) is designed solely for backend infrastructure HTTP request tracing, not business CRM activity feeds.

### Recommended Prisma Data Models for Migration

#### 1. `CrmActivity` Model
```prisma
enum ActivityType {
  CALL
  EMAIL
  MEETING
  NOTE
  OTHER
}

model CrmActivity {
  id              String       @id @default(cuid())
  companyId       String
  company         Company      @relation(fields: [companyId], references: [id], onDelete: Cascade)
  userId          String
  user            User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  type            ActivityType @default(NOTE)
  subject         String
  description     String?
  entityType      String       // "lead" | "contact" | "deal" | "customer"
  entityId        String
  occurredAt      DateTime     @default(now())
  durationMinutes Int?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  deletedAt       DateTime?

  @@index([companyId, entityType, entityId])
  @@index([companyId, occurredAt])
  @@index([userId])
}
```

#### 2. `CrmNotification` Model
```prisma
enum CrmNotificationType {
  ASSIGNMENT
  DEAL_STAGE
  LEAD_ASSIGNED
  REMINDER
  GENERAL
}

model CrmNotification {
  id         String              @id @default(cuid())
  companyId  String
  company    Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  userId     String
  user       User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       CrmNotificationType @default(GENERAL)
  title      String
  body       String
  entityType String?             // "lead" | "contact" | "deal"
  entityId   String?
  read       Boolean             @default(false)
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt

  @@index([companyId, userId, read])
  @@index([userId, createdAt])
}
```

---

## 9. Backend API Assessment

Currently, NestJS has no endpoints for activities or CRM notifications. The proposed REST endpoints should mirror standard platform conventions (`JwtAuthGuard`, `PermissionsGuard`, `@CurrentUser()`, `ResponseEnvelopeInterceptor`):

### Proposed Endpoints

#### Activities
- `GET /api/v1/crm/activities?entityType=...&entityId=...`: Lists activities for a specific entity within the authenticated user's company (database indexed).
- `POST /api/v1/crm/activities`: Creates an activity. Validates that `userId` is set to `@CurrentUser()`, `companyId` is derived from session, and `entityId` exists and belongs to the company.
- `DELETE /api/v1/crm/activities/:id`: Soft-deletes an activity. Guarded by `@RequirePermission("crm.delete")`.

#### CRM Notifications
- `GET /api/v1/crm/notifications`: Lists notifications exclusively for `@CurrentUser() userId` in `user.companyId`.
- `GET /api/v1/crm/notifications/unread-count`: Returns integer count of unread notifications for the user.
- `PATCH /api/v1/crm/notifications/:id/read`: Marks a single notification as read, ensuring ownership validation (`userId === @CurrentUser().userId`).
- `POST /api/v1/crm/notifications/mark-all-read`: Marks all unread notifications for the authenticated user as read.
- `POST /api/v1/crm/notifications`: Internal/administrative creation of notifications (tenant-isolated).

---

## 10. Frontend Consumer Map

| Frontend Component | Hook / Service | Current Data Source | User Actions | Migration Path |
|:---|:---|:---|:---|:---|
| `CrmChatter` (`CrmChatter.tsx`) | `useCrmEntityActivities`, `useCreateCrmActivityMutation` | Firestore `activities` | Log call, email, meeting, note | Switch hook to REST `apiClient` |
| `CrmTimeline` (`CrmTimeline.tsx`) | Receives `activities: Activity[]` as prop | Firestore `activities` | View timeline items | Unchanged (pure presentational) |
| `UnifiedCustomerTimeline` (`UnifiedCustomerTimeline.tsx`) | `useCustomerTimeline` (`use-customer-timeline.ts`) | Firestore `activities` | Filter and view customer timeline | Switch hook to REST `apiClient` |
| `DealDetailPage` (`DealDetailPage.tsx`) | `useCrmEntityActivities`, `useCreateCrmActivityMutation` | Firestore `activities` | Chatter tab feed & activity logging | Point to migrated hook |
| `LeadDetailPage` (`LeadDetailPage.tsx`) | `useLeadActivities`, `useCreateLeadActivityMutation` | Firestore `activities` | Chatter tab feed & activity logging | Point to migrated hook |
| `CrmNotificationCenter` (`CrmNotificationCenter.tsx`) | `useCrmNotificationsQuery`, `useMarkNotificationReadMutation` | Firestore `crm_notifications` | Bell dropdown, unread count, click link, mark all read | Switch hooks to REST `apiClient` |
| `CrmLayout` (`CrmLayout.tsx`) | Mounts `CrmNotificationCenter` | Layout wrapper | Displays notification bell | Unchanged |

---

## 11. Tenant Isolation and Security Assessment

### Security Risk Matrix (Current vs. Target)

| Operation | Current Legacy Implementation | Target NestJS Implementation | Risk Severity |
|:---|:---|:---|:---:|
| **Read CRM Notifications** | Fetches all company notifications; filters `userId` client-side | `SELECT ... WHERE companyId = :cid AND userId = :uid` on backend | **HIGH (Data Leak)** |
| **Mark Notification Read** | `updateDoc` from client without verifying caller owns the doc | Validates `notification.userId === requestingUser.userId` | **MEDIUM** |
| **Create Activity** | Client sends arbitrary `userId` and arbitrary `entityId` | Backend sets `userId = session.userId`, validates `entityId` in company | **MEDIUM** |
| **Read Activities** | Fetches up to 200 company activities; filters in browser | Database query filtered by `companyId`, `entityType`, and `entityId` | **LOW (Over-fetching)** |
| **Cross-Company Tampering** | Client supplies `companyId` | Derived strictly from authenticated JWT (`user.companyId`) | **HIGH** |

---

## 12. Existing Test Coverage

Inspection of `backend/test/` and `src/` revealed:
- **Deals E2E:** 26 passing tests (covering Deal CRUD, isolation, `assignedToId`).
- **Customers E2E:** 12 passing tests.
- **Leads E2E:** 15 passing tests.
- **One Account = One Company:** 17 passing tests.
- **Activities & Notifications Coverage:** **0 tests** exist in either unit or E2E suites.

---

## 13. Missing Test Coverage to be Built in WP-04

The following test suites must be developed during WP-04 implementation:
1. **Activities Tenant Isolation:**
   - User in Company A cannot query Activities of Company B.
   - User in Company A cannot create an Activity associated with an entity in Company B.
   - User cannot spoof `userId` on created activities.
2. **CRM Notifications User & Tenant Isolation:**
   - User in Company A receives only their own notifications.
   - User in Company B cannot read or mark as read notifications of Company A.
   - User cannot mark another user's notifications as read within the same company.
3. **Cross-Entity Relational Integrity:**
   - Activities tied to deleted entities or cross-tenant IDs are rejected with 400 Bad Request.
4. **Browser E2E Lifecycle:**
   - Logging a call/meeting/note in `CrmChatter` updates the feed with zero Firestore writes.
   - Receiving and clicking a notification in `CrmNotificationCenter` updates read state with zero Firestore writes.

---

## 14. Legacy Compatibility Analysis

### Gradual Migration Safety
1. **Global App Notifications Remain on Firebase Temporarily:** Tasks, HR attendance, and chat notifications write to `companies/{companyId}/notifications`. These modules remain unmigrated. Scoping WP-04 strictly to **CRM Notifications** (`crm_notifications`) avoids touching unmigrated modules.
2. **Lead Conversion Compatibility:** `lead-conversion.service.ts` currently calls `ActivitiesService.createActivity`. When Activities is migrated to REST, `lead-conversion.service.ts` will simply call the new REST-backed `ActivitiesService`.
3. **Zero Impact on Production:** The local workspace continues to connect only to `darrow_dev`. Production Firebase is untouched.

---

## 15. Proposed Migration Boundaries

### Recommended Boundary: WP-04 Unified CRM Package (or WP-04A & WP-04B)
Activities and CRM Notifications are both tightly coupled to CRM entity workflows and share common patterns.

- **In Scope for WP-04:**
  1. `CrmActivity` Prisma schema model, migration, and NestJS controller/service (`/api/v1/crm/activities`).
  2. `CrmNotification` Prisma schema model, migration, and NestJS controller/service (`/api/v1/crm/notifications`).
  3. Frontend REST client updates for `src/features/crm/api/activities.service.ts` and `src/features/crm/api/notifications.service.ts`.
  4. Updating `use-crm-entity-data.ts` and `use-crm-notifications.ts` to consume REST endpoints.
  5. Decoupling Firestore subcollections `activities` and `crm_notifications` completely from CRM workflows.
  6. Automated backend unit tests, E2E suites, and Playwright browser verification with Firestore network monitoring.

- **Explicitly Out of Scope:**
  1. Global App Notifications (`src/features/notifications/` - Tasks, HR, Chat, Document Approval).
  2. Push notifications, Service Workers, or Firebase Cloud Messaging.
  3. Notes (`dealNotes`, `leadNotes`) — deferred to dedicated Notes WP.
  4. Attachments & Cloud Storage — deferred to dedicated Attachments WP.
  5. Reopening accepted Contacts, Leads, or Deals CRUD.

---

## 16. Recommended Implementation Sequence

```text
Phase 1: Database & Prisma Layer
  ├── Define CrmActivity and CrmNotification in schema.prisma
  ├── Generate migration: npx prisma migrate dev --name crm_activities_notifications
  └── Verify models in local PostgreSQL darrow_dev

Phase 2: NestJS Backend Module
  ├── Create CrmActivitiesController & CrmActivitiesService
  ├── Create CrmNotificationsController & CrmNotificationsService
  ├── Implement DTOs with class-validator & single response envelope
  ├── Register in CrmModule
  └── Enforce JwtAuthGuard, PermissionsGuard, and @CurrentUser() tenancy

Phase 3: Automated Backend Testing
  ├── Author crm-activities.e2e-spec.ts (tenant isolation, entity checks)
  ├── Author crm-notifications.e2e-spec.ts (user isolation, read state)
  └── Run full regression suite (customers, leads, deals, unit tests)

Phase 4: Frontend Service & Hook Adaptation
  ├── Update src/features/crm/api/activities.service.ts to use apiClient
  ├── Update src/features/crm/api/notifications.service.ts to use apiClient
  ├── Adapt use-crm-entity-data.ts and use-crm-notifications.ts
  └── Verify TypeScript compilation (npx tsc -b)

Phase 5: Autonomous Browser E2E & Firestore Decoupling Audit
  ├── Execute Playwright browser test logging activities and reading notifications
  └── Assert zero network requests to firestore.googleapis.com
```

---

## 17. Risks and Blockers

| Risk / Dependency | Impact | Mitigation Strategy |
|:---|:---|:---|
| **`lead-conversion.service.ts` dependency** | High | Ensure REST `ActivitiesService` maintains identical method signatures (`createActivity`) so lead conversion continues working without modification. |
| **`use-customer-timeline.ts` aggregation** | Medium | Ensure `ActivitiesService.getActivities` returns data matching the existing `Activity` interface so customer timeline aggregation continues working seamlessly. |
| **Missing composite index in PostgreSQL** | Low | Add composite indexes `[companyId, entityType, entityId]` and `[companyId, userId, read]` directly in Prisma schema. |

---

## 18. Explicit Out-of-Scope Items

1. **Global App Notifications (`companies/{companyId}/notifications`):** Belongs to general portal infrastructure (Tasks, Attendance, HR).
2. **FCM / Web Push:** No push infrastructure exists today.
3. **CRM Notes (`dealNotes`):** Notes remain on legacy Firestore until a future WP.
4. **CRM Attachments:** File uploads rely on Firebase Storage; will be migrated in a storage WP.
5. **Modification of WP-01, WP-02, or WP-03:** All previous work packages remain locked.

---

## 19. Evidence Appendix (Exact File Paths & Line Numbers)

- `src/features/crm/types/activities.types.ts`: lines 1–25 (Activity, ActivityType, DTOs).
- `src/features/crm/api/activities.service.ts`: lines 1–23 (`ActivitiesService` wrapping `CRM_COLLECTIONS.activities`).
- `src/features/crm/constants/crm-collections.ts`: lines 7, 10 (`activities: "activities"`, `notifications: "crm_notifications"`).
- `src/features/crm/api/crm-base.service.ts`: lines 26–100 (`createCrmCollectionService` using Firestore SDK).
- `src/features/crm/types/notifications.types.ts`: lines 1–31 (`CrmNotification`, `CrmNotificationType`, DTOs).
- `src/features/crm/api/notifications.service.ts`: lines 1–24 (`CrmNotificationsService` wrapping `CRM_COLLECTIONS.notifications`).
- `src/features/crm/hooks/use-crm-notifications.ts`: lines 7–19 (`useCrmNotificationsQuery` with client-side user filter on line 14).
- `src/features/crm/components/CrmNotificationCenter.tsx`: lines 21–97 (UI dropdown, badge, links, mark all read).
- `src/features/crm/components/CrmLayout.tsx`: lines 3, 18 (Mounting of `CrmNotificationCenter`).
- `src/features/crm/hooks/use-crm-entity-data.ts`: lines 24–36 (`useCrmEntityActivities`), lines 136–158 (`useCreateCrmActivityMutation`).
- `src/features/crm/components/shared/CrmChatter.tsx`: lines 23–29 (`mergeChatterFeed`), lines 84–94 (`submitActivity`).
- `src/features/crm/api/lead-conversion.service.ts`: lines 54–71 (`ActivitiesService.createActivity` calls).
- `src/features/crm/api/crm-entity-reassign.service.ts`: lines 43–47 (Activities reassignment).
- `src/features/crm/hooks/use-crm-tasks.ts`: line 40, 51, 80 (`ActivitiesService` and `CrmNotificationsService` calls).
- `src/lib/browser-notifications.ts`: lines 8–45 (Web Notifications API wrapper).
- `src/lib/firebase.ts`: lines 32–50 (Firebase initialization showing no FCM/messaging).
- `backend/prisma/schema.prisma`: lines 235–249 (Proof that only `AuditLog` exists; no activity/notification models).
- `backend/src/permissions/manifest.ts`: lines 50–56 (Proof that CRM permissions cover `crm.view`, `crm.delete`, etc.).

---

## 20. Final Discovery Verdict

### **`DISCOVERY COMPLETE — READY FOR IMPLEMENTATION REVIEW`**

The architectural discovery for WP-04 has mapped all Activity and Notification producers, consumers, data shapes, legacy Firebase dependencies, and security vulnerabilities. A safe, minimal, and fully decoupled migration boundary has been established.

**WP-04 implementation has NOT started. No code changes have been made. Awaiting explicit approval.**
