# EDGE_CASES_AND_BUSINESS_RULES.md

## Edge Case Registry

| # | Scenario | Expected Outcome | Security Behavior | Enforcement Layer |
|---|----------|-----------------|-------------------|-------------------|
| E1 | User registers without creating a company (no `companyName`) | User created with `onboardingStatus: "pending"`, zero memberships. Cannot access company-scoped endpoints until membership exists. | `PermissionsGuard` throws `403 Forbidden` "No active company membership" | Backend auth + guard |
| E2 | Company owner creates the first account (registration with `companyName`) | User + company created. User gets exactly one ACTIVE membership with role ADMIN. | `CompaniesService.create()` creates membership atomically with company | Backend service |
| E3 | Owner invites an employee | Invitation created with `status: PENDING`, email, role, companyId. No membership created yet. | Invitation row only; membership created on acceptance | Backend service |
| E4 | Employee already has an account in another company | Invitation acceptance rejected. User already has active membership in Company A. | `acceptInvitation()` checks `findUnique({ where: { userId } })` before creating membership | Backend auth |
| E5 | Invitation accepted by account already in another company | Rejected with `403 Forbidden` "Account already belongs to a company". Invitation remains PENDING. | Pre-acceptance membership check | Backend auth |
| E6 | Invitation accepted by different email/account | Rejected with `400 Bad Request` "Invitation email does not match". | Existing email match check at line 160-162 | Backend auth |
| E7 | User is removed from a company | Membership status → `REMOVED`. All user refresh tokens deleted. User loses company context. | `PermissionsGuard` finds no ACTIVE membership → `403 Forbidden` | Backend auth + guard |
| E8 | User is suspended | Membership status → `SUSPENDED`. Not ACTIVE. `PermissionsGuard` only accepts `status: "ACTIVE"`. | Guard filters by `status: "ACTIVE"` | Backend guard |
| E9 | Company is suspended or deleted | `Company.deletedAt` set. All `findUnique`/`findFirst` queries exclude deleted companies. User's membership still references deleted company. Guard finds membership but company queries return 404. | Service-layer `deletedAt` checks | Backend services |
| E10 | Employee is terminated | `Employee.employmentStatus` → `TERMINATED`, `Employee.deletedAt` set. User's membership may remain ACTIVE. | Membership and employee are independent — termination does not auto-remove membership | Backend service |
| E11 | User refreshes an old JWT | `refresh()` calls `generateTokens(stored.user)` which re-queries current active membership. New JWT reflects current company. | Token rotation with fresh DB lookup | Backend auth |
| E12 | User has an old refresh token | Old refresh token is deleted on rotation (line 130). If used after rotation, `findUnique` returns null → `401 Unauthorized`. | Refresh token rotation deletes old token | Backend auth |
| E13 | Company ownership is transferred | `Company.ownerId` updated. New owner must have ACTIVE membership in that company. | Validate `ownerId` user has membership in target company | Backend service |
| E14 | Company owner leaves the company | Owner's membership → `REMOVED` or `SUSPENDED`. Company `ownerId` may reference a non-member. | Validate `ownerId` on company queries; consider cascading ownership transfer | Backend service |
| E15 | Duplicate invitation attempts concurrently | Second invitation for same email+company creates a new invite row (no unique constraint on email+company+PENDING). First accepted invitation sets status ACCEPTED; second fails status check. | Race handled by status check at acceptance time | Backend service |
| E16 | Two requests attach one user to different companies concurrently | Without DB uniqueness, both succeed → two memberships. With `@@unique([userId])`, second fails with unique constraint violation → `409 Conflict`. | Database unique constraint + application error handling | Database + service |
| E17 | Employee records imported from legacy Firebase | Import script must map each Firebase user to exactly one company. If a Firebase user has docs in multiple companies, import must pick one (or flag for manual review). | Import validation script (Phase 4 task) | Data migration |
| E18 | Existing users have zero or multiple memberships | Zero: user cannot access company-scoped endpoints (guard throws 403). Multiple: violates invariant; migration must resolve to one. | Data audit + cleanup migration (Phase 4 task) | Data migration |

## Registration & Invitation Lifecycle

```
Registration (no companyName)
    → User created, onboardingStatus: "pending"
    → Zero memberships
    → User logs in → generateTokens returns membership=null, role=undefined, companyId=undefined
    → PermissionsGuard: no ACTIVE membership → 403 Forbidden
    → User must accept an invitation to gain company access

Registration (with companyName)
    → User + Company created
    → Membership: userId, companyId, role: ADMIN, status: ACTIVE
    → User logs in → JWT contains role: ADMIN, companyId: <company>
    → Full access to company-scoped endpoints

Invitation flow
    → Owner creates Invitation (PENDING) for email@company
    → Invitee accepts with email+password
    → If user doesn't exist: create user
    → CHECK: user has no ACTIVE membership (NEW: E4/E5)
    → Create Membership: userId, invitation.companyId, invitation.role, ACTIVE
    → Mark Invitation ACCEPTED
    → generateTokens: membership resolved, JWT contains role+companyId
```

## Termination Lifecycle

```
User removal from company
    → Membership.status → REMOVED (not ACTIVE)
    → Delete all RefreshToken rows for userId
    → Employee record: employmentStatus → TERMINATED, deletedAt set (optional)
    → User logs in → generateTokens: no ACTIVE membership → role=null, companyId=null
    → PermissionsGuard: no ACTIVE membership → 403 Forbidden

Company deletion (soft)
    → Company.deletedAt set
    → All service queries exclude deletedAt: null
    → User's membership still exists but company queries return 404
    → Consider cascading membership → REMOVED for all members
```

## Business Rules Summary

| Rule | Statement |
|------|-----------|
| BR1 | A user account is created once (email-unique). |
| BR2 | A user account can belong to zero companies (pending onboarding) or exactly one company (active membership). |
| BR3 | A user account cannot belong to more than one company at any time. |
| BR4 | Company membership is the only path to company-scoped resource access. |
| BR5 | Platform admin access is separate from company membership (`isPlatformAdmin` flag). |
| BR6 | Employee records are linked to users 1:1 (`Employee.userId` is `@unique`). |
| BR7 | Employee company must match user's membership company. |
| BR8 | Refresh tokens are scoped to the user, not the company — rotation re-resolves company context. |
