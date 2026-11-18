# WP-03 SECURITY REMEDIATION REPORT: `assignedToId` TENANT ISOLATION
## D-Arrow CRM Deals Sequential Migration
**Date:** 2026-11-15  
**Auditor & Remediation Lead:** Senior Software Architect & Security Verification Lead  
**Scope:** Remediation of `assignedToId` Tenant Isolation in Deals Service  
**Target Environment:** Local PostgreSQL `darrow_dev` (Zero Production Connection)  
**Status:** Remediated & Fully Verified (Exit Code 0 across all suites)

---

## 1. Root Cause Analysis

During the WP-03 Final Acceptance Audit, inspection of `backend/src/crm/deals.service.ts` revealed that:
1. `contactId` and `leadId` were explicitly validated against the requesting user's company membership (`companyId`) with active status.
2. In contrast, `assignedToId` was accepted from the payload (`data.assignedToId || data.assignedTo || null`) and passed directly into `prisma.deal.create` and `prisma.deal.update` without checking if the referenced user belonged to the requesting user's authenticated company.
3. This created a potential cross-tenant assignment vulnerability: an authenticated user in Company A could theoretically assign their company's deal to an employee of Company B by providing Company B's `userId`.

---

## 2. Canonical User-Company Relationship Investigation

An inspection of the schema (`backend/prisma/schema.prisma`) and identity architecture confirmed:
- In this architecture, the `User` table does NOT have a direct `companyId` scalar column.
- The authoritative canonical tenancy relationship is defined via `CompanyMembership`:
  ```prisma
  model CompanyMembership {
    id        String           @id @default(cuid())
    userId    String           @unique
    companyId String
    company   Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
    role      RoleSlug
    status    MembershipStatus @default(ACTIVE)
    ...
  }
  ```
  The `@unique` constraint on `userId` enforces the invariant that each active user account belongs to exactly one company.
- To validate that an assigned user belongs to the authenticated tenant, the canonical query must check that the user exists, is not soft-deleted (`deletedAt: null`), and possesses an `ACTIVE` `CompanyMembership` matching the authenticated `companyId`.

---

## 3. Files Changed & Exact Validation Logic

### Files Changed
1. `backend/src/crm/deals.service.ts` (Remediation of `create` and `update` methods)
2. `backend/test/crm-deals.e2e-spec.ts` (Addition of 9 new tenant isolation & assignment tests)

### Exact Validation Logic in `backend/src/crm/deals.service.ts`

#### On Deal Creation (`create`)
```typescript
// Cross-tenant validation: assignedToId
const rawAssigned = data.assignedToId !== undefined ? data.assignedToId : data.assignedTo;
let assignedToId: string | null = null;
if (rawAssigned !== undefined && rawAssigned !== null && rawAssigned.trim() !== "") {
  const trimmed = rawAssigned.trim();
  const assignedUser = await this.prisma.user.findFirst({
    where: {
      id: trimmed,
      deletedAt: null,
      memberships: {
        some: {
          companyId,
          status: "ACTIVE",
        },
      },
    },
  });
  if (!assignedUser) {
    throw new BadRequestException("Assigned user not found or does not belong to your company");
  }
  assignedToId = assignedUser.id;
}
```

#### On Deal Update (`update`)
```typescript
// Cross-tenant validation: assignedToId
let assignedToId: string | null | undefined = undefined;
const rawAssigned =
  data.assignedToId !== undefined
    ? data.assignedToId
    : data.assignedTo !== undefined
    ? data.assignedTo
    : undefined;

if (rawAssigned !== undefined) {
  if (rawAssigned === null || rawAssigned.trim() === "") {
    // Explicit unassignment
    assignedToId = null;
  } else {
    const trimmed = rawAssigned.trim();
    const assignedUser = await this.prisma.user.findFirst({
      where: {
        id: trimmed,
        deletedAt: null,
        memberships: {
          some: {
            companyId,
            status: "ACTIVE",
          },
        },
      },
    });
    if (!assignedUser) {
      throw new BadRequestException("Assigned user not found or does not belong to your company");
    }
    assignedToId = assignedUser.id;
  }
}
```

### Safety & Semantic Properties Preserved
1. **Authenticated Context Only**: `companyId` is derived exclusively from `requestingUserCompanyId` (from JWT session). Any client-supplied `companyId` in the request body is ignored.
2. **Explicit Unassignment**: Sending `assignedToId: null` or `assignedToId: ""` explicitly sets `assignedToId = null` in PostgreSQL.
3. **Assignment Preservation**: Omitting `assignedToId` and `assignedTo` leaves `assignedToId = undefined`, which is excluded from the Prisma update payload, preserving the existing assignment in the database.
4. **Pre-mutation Rejection**: Cross-company or nonexistent user references throw `BadRequestException` (HTTP 400) **prior** to invoking Prisma `create` or `update`, preventing partial updates or orphan foreign keys.

---

## 4. Tests Added & Execution Results

### Tests Added in `backend/test/crm-deals.e2e-spec.ts`

| Test # | Test Name | Assertion / Objective |
|:---|:---|:---|
| 1 | Same-company assigned user | Creates deal with `assignedToId: userEmpId`; verifies 201 Created and persisted DB foreign key. |
| 2 | Cross-company assigned user rejection | Attempts create with `assignedToId: userBId`; verifies 400 Bad Request and zero DB writes. |
| 3 | Nonexistent assigned user rejection | Attempts create with random UUID; verifies 400 Bad Request and zero DB writes. |
| 4 | Forged `companyId` bypass prevention | Attempts create passing forged `companyId: companyBId` and `assignedToId: userBId`; verifies 400 Bad Request. |
| 5 | Cross-company assignment on update | Attempts PATCH with `assignedToId: userBId`; verifies 400 Bad Request and proves deal in DB remains completely unchanged. |
| 6 | Preserving existing assignment on update | Updates deal title without assignment field; verifies 200 OK and confirms `assignedToId` remains intact in DB. |
| 7 | Explicit unassignment | Updates deal with `{ assignedToId: null }`; verifies 200 OK and confirms `assignedToId = null` in DB. |
| 8 | Cross-company `leadId` rejection on create | Attempts create with `leadId` from Company B; verifies 400 Bad Request. |
| 9 | Cross-company `leadId` rejection on update | Attempts PATCH with `leadId` from Company B; verifies 400 Bad Request. |

### Verification Evidence: Proof of Non-Mutation on Rejected Requests
In Test #5, the Deal state was captured immediately before sending the malicious PATCH request:
```typescript
const preUpdateDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
// PATCH with cross-company user -> 400 Bad Request
const postUpdateDeal = await prisma.deal.findUnique({ where: { id: dealWithAssigneeId } });
expect(postUpdateDeal!.assignedToId).toBe(userEmpId); // Unchanged
expect(postUpdateDeal!.title).toBe(preUpdateDeal!.title); // Unchanged
expect(postUpdateDeal!.amount).toBe(preUpdateDeal!.amount); // Unchanged
```
This proves that rejected cross-company assignments abort before the database layer, leaving no partial state or dirty records.

---

## 5. Sequential Verification Protocol & Exit Codes

All verification steps were executed sequentially against local `darrow_dev`:

| Step | Command | Exit Code | Outcome |
|:---|:---|:---|:---|
| **1. Backend TypeScript Check** | `npx tsc --noEmit` | **0** | Clean pass, zero type errors. |
| **2. Deals E2E Suite** | `jest test/crm-deals.e2e-spec.ts` | **0** | **26/26 passed** (100%). |
| **3. Customers Regression (WP-01)** | `jest test/crm-customers.e2e-spec.ts` | **0** | **12/12 passed** (100%). |
| **4. Leads Regression (WP-02)** | `jest test/crm-leads.e2e-spec.ts` | **0** | **15/15 passed** (100%). |
| **5. Full Backend E2E Suite** | `npm run test:e2e` | **0** | **95/95 passed** across all 5 suites. |
| **6. Backend Unit Tests** | `npm test` | **0** | **70/70 passed** across 3 suites. |
| **7. Frontend TypeScript Check** | `npx tsc -b` | **0** | Clean pass, zero errors. |

---

## 6. Safety & Environment Attestation

- **Local Infrastructure Exclusively:** All tests connected only to local PostgreSQL `darrow_dev`.
- **Production Isolation:** No writes, reads, or connections were made to production Firebase or production PostgreSQL.
- **Git State:** All working tree changes have been preserved. No commits, resets, or stashes were performed.
- **Scope Compliance:** No changes were made to Customers, Leads, Frontend contracts, or global auth architecture.

---

## 7. Remaining Limitations (Documented)

With `assignedToId` fully remediated and verified, the only remaining limitations for WP-03 are:
1. Deal subcollections on the detail page (Notes, Tasks, Attachments) remain linked to legacy unmigrated subcollections as scheduled for future WPs.
2. Server-side full-text search and server-side cursor pagination remain deferred to subsequent optimization phases.

---

## 8. Conclusion

The `assignedToId` tenant isolation gap has been closed with the minimal safe correction. Full tenant isolation is now enforced and verified across all Deal relational keys: `companyId`, `contactId`, `leadId`, and `assignedToId`.
