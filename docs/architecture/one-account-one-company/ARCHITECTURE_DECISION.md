# ARCHITECTURE_DECISION.md

## Approved Decision

**ONE ACCOUNT = ONE COMPANY**

Every user account (`User`) belongs to exactly one company (`Company`). This is a strict business and architectural constraint enforced at the database, backend, and application layers.

## Domain Rules

| Rule | Statement |
|------|-----------|
| R1 | Every active user account has exactly one active `CompanyMembership`. |
| R2 | A user cannot create, join, or become a member of a second company using the same account. |
| R3 | No company switching — there is no "active company" selector because there is only one company per account. |
| R4 | Each company's data is completely isolated: users, employees, memberships, roles, permissions, departments, branches, HR records, CRM records, financial records, projects, tasks. |
| R5 | Backend authorization derives company ownership from trusted database relationships only. Client-provided `companyId`, URL parameters, request bodies, JWT claims, or headers never independently establish tenant authorization. |
| R6 | Cross-company access is rejected consistently (`403 Forbidden` or `404 NotFound` per existing convention). |
| R7 | Platform administrators are a separate explicitly authorized platform-level access model (`User.isPlatformAdmin`), not a normal employee membership in multiple companies. |

## Recommended Data Model (Option B)

**CompanyMembership as the authoritative relationship** with a database-enforced unique constraint on `userId`.

### Prisma Model Changes (recommended, not yet applied)

```prisma
model User {
  id               String              @id
  email            String              @unique
  passwordHash     String?
  firebaseUid      String?             @unique
  name             String
  nameAr           String              @default("")
  avatar           String              @default("")
  locale           String              @default("en")
  isPlatformAdmin  Boolean             @default(false)
  onboardingStatus String              @default("pending")
  country          String?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
  deletedAt        DateTime?
  membership       CompanyMembership?  @relation("UserMembership")  // ONE OR NONE
  refreshTokens    RefreshToken[]
  employee         Employee?
  leaveApprovals   LeaveRequest[]      @relation("LeaveApprover")
  customers        Customer[]
  leads            Lead[]
  deals            Deal[]

  @@index([deletedAt])
}

model CompanyMembership {
  id                String           @id @default(cuid())
  userId            String           @unique   // <-- ENFORCES ONE MEMBERSHIP PER USER
  user              User             @relation("UserMembership", fields: [userId], references: [id], onDelete: Cascade)
  companyId         String
  company           Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  role              RoleSlug
  branchId          String?
  workLocationId    String?
  portalAccess      Json?
  portalSubRoles    Json?
  customPermissions String[]         @default([])
  invitedByUserId   String?
  joinedAt          DateTime         @default(now())
  status            MembershipStatus @default(ACTIVE)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  @@unique([userId, companyId])  // keep for backward compat
  @@unique([userId])             // <-- NEW: one account, one company
  @@index([companyId, role])
  @@index([companyId, status])
}
```

### Alternative Models Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A — `companyId` directly on User** | `User.companyId` is the authoritative company relationship with unique constraint. | **Rejected.** Loses membership metadata (role, branch, portalAccess, invitedBy, joinedAt, customPermissions) that already exists on `CompanyMembership`. Would require duplicating those fields on `User` or breaking existing HR/RBAC code. |
| **B — `CompanyMembership` authoritative (RECOMMENDED)** | `User` has at most one `CompanyMembership`, enforced by `@@unique([userId])`. Membership carries role, branch, permissions. | **Selected.** Preserves existing schema structure, enforces invariant at DB level, minimal migration complexity, platform admin stays separate via `isPlatformAdmin`. |
| **C — Separate `CompanyUser` join table** | New dedicated table between User and Company. | **Rejected.** Unnecessary duplication of `CompanyMembership`. Adds migration complexity with no functional benefit. |

## Explicit Invariants

1. **I1:** `SELECT count(*) FROM CompanyMembership WHERE userId = ? AND status = 'ACTIVE'` returns exactly 0 or 1 for every user.
2. **I2:** `Employee.companyId` == `CompanyMembership.companyId` for every linked user/employee pair.
3. **I3:** `Company.ownerId` (if set) must reference a user whose single membership is in that company with role ADMIN or SUPER_ADMIN.
4. **I4:** Invitation acceptance creates membership only if the accepting user has zero existing active memberships.
5. **I5:** Refresh tokens issued after a membership change must reflect the current single company context.
6. **I6:** Platform admins (`isPlatformAdmin = true`) bypass company-scoped authorization but are not company members.

## Alternatives Considered Summary

Option A (User.companyId) was rejected because it would require duplicating all membership metadata (role, branchId, workLocationId, portalAccess, portalSubRoles, customPermissions, invitedByUserId, joinedAt, status) onto the User model, breaking existing HR, RBAC, and invitation code that reads from CompanyMembership.

Option C was rejected as unnecessary duplication — CompanyMembership already exists and serves the join-table role.

## Superseded Historical Decisions

- The schema comment at `prisma/schema.prisma:129-131` ("Multi-membership-ready [D7]") is superseded. The table no longer permits multi-company membership; `@@unique([userId])` replaces the previous multi-membership-ready design.
- `findFirst({ where: { userId, status: "ACTIVE" } })` non-deterministic membership resolution is superseded by `findUnique({ where: { userId } })` since at most one membership can exist.
