# Invitation Permission Failure — Root Cause

## Executive summary

The client-side onboarding attempted to attach an employee to an authenticated
account by writing a company employee document as an ordinary employee. The
Firestore employee rules reserve employee-document writes for authorized
company roles, so this direct link operation was denied. The old acceptance
path also treated employee-linking failures as non-fatal and could continue to
mark an invite accepted, leaving inconsistent onboarding state.

The concrete denied operation reproduced against the Firestore Emulator is an
employee `update` at:

`companies/{invitation.companyId}/employees/{invitation.employeeId}`

In the canonical D-Arrow Emulator fixture (`companyId == "darrow"`), this
resolves to `companies/darrow/employees/{employeeId}`. The live invitation's
`companyId` was not read. The responsible rule is the
employee write authorization under
`match /companies/{companyId}/employees/{employeeId}` in `firestore.rules`:
ordinary employees may not directly update employee records. Emulator case P
proves that the former direct update is denied.

This is the exact failure reproduced from the old operation and rules. The
production invitation document and live request trace were not read; therefore
the exact path and first denied operation for the live token cannot be asserted
as directly observed production facts.

## Operation trace

The following is the current implementation's operation sequence. IDs and
emails are deliberately represented by placeholders. The new onboarding
diagnostic logs operation/path templates, whether a user is authenticated, and
Firebase error codes only; it does not emit invitation tokens, passwords,
emails, UIDs, or personal profile fields.

| Step | Collection/document | Operation | Auth UID / claims | `companyId` | Relevant rule / result |
|---|---|---|---|---|---|
| Invite page load | `invites/{token}` | `get` | Not required; no UID/claims before login | Read from invite after retrieval | `/invites/{token}` `allow get` permits a pending invite with matching document token and future Timestamp; passed in the Emulator |
| Existing account authentication | Firebase Auth, not Firestore | sign in | Existing UID; Auth verifies supplied credentials and issues email claim | Not set by this operation | Existing account path preserves UID; Auth Emulator sign-in passed |
| Invite revalidation | `invites/{token}` | `get` | Auth UID and email claim | Invite's company | `/invites/{token}` pending/future-expiry `get`; passed |
| Existing profile lookup | `users/{auth.uid}` | `get` | UID must equal document ID | Existing profile company, if any | `/users/{userId}` self-get; passed, including absent-profile lookup |
| Stage profile | `users/{auth.uid}` | `create` or `update` | UID equals document ID; email claim equals invite email | Set from validated invite; role from invite | `/users/{userId}` invitation-backed pending profile branch; passed |
| Resolve existing employee when invite has no `employeeId` | `companies/{invite.companyId}/employees` | `list` with exact email filter | Auth UID/email claim; profile is pending | Invite company | Employee rule allows matching pending invitee records; empty query and one-match paths passed |
| Complete employee/profile/invite link | `users/{auth.uid}`, `companies/{invite.companyId}/employees/{employeeId}`, `invites/{token}` | Atomic batch: update, create/update, update | Auth UID and email claim must match all three records | Only invite company | User `completedInvitationProfile`, employee `acceptedInvitationEmployeeLink`, invite `acceptedByInvitee`; `getAfter()` checks; passed |
| Company context load | `companies/{companyId}` | `get` | Authenticated UID; active user profile establishes tenant membership | Profile company, sourced from invite | `/companies/{companyId}` `allow get: if belongsToCompany(companyId)`; CompanyProvider now requests only that ID |
| Attendance employee resolution | `companies/{companyId}/employees` | `list` by `userId` (or verified email fallback) | Current Auth UID and active matching profile | Must equal current user company | Employee read rule; Emulator case L passed the `userId` query |
| Attendance records load | `companies/{companyId}/attendance` | `list` by `employeeId` | Same current UID/company | Must equal current user company | Tenant/employee attendance read rule; Emulator case L passed |
| Platform-wide company query | `companies` | `list` | Platform admin custom claim required | N/A | `/companies/{companyId}` `allow list: if isPlatformAdmin()`; employee denied and platform admin allowed |

The original employee write's Auth claim set and exact production employee ID
are unavailable because no production request trace or document was accessed.
The Emulator reproduces the denied direct employee update using the old
employee-link pattern; its authenticated context is an ordinary employee, not
a platform administrator.

## Separate reported errors

* `CompanyService.listAllCompanies()` issued a platform-wide companies query
  during tenant resolution. It is not required for an employee with a resolved
  `companyId`; Firestore correctly denies ordinary employees that query.
* Attendance could initialize while auth/profile/company context was changing.
  The prior sync path could also try to claim/create employee records by email.
  These are separate lifecycle and authorization errors, not the root cause of
  the employee-link write denial.

There is a second, conditional invitation failure: the unauthenticated page
read is the first Firestore operation and requires `expiresAt` to be a future
Timestamp. If the live invite still stores an ISO string, that initial
`invites/{token}` get is denied before authentication. The live document was
not inspected, so this is a compatibility risk, not a confirmed live cause.

## Repair

`acceptInvitationForUser` now validates the signed-in UID, normalized
authenticated email, invite token/document ID, pending status, future expiry,
invitation role, and invitation company. It rejects accounts already attached
to another company. A pending profile is staged without active tenant access;
then the profile activation, employee link/create, and invite acceptance are
committed in one batch. The rules authorize that final state only when the
invite, user profile, and employee record agree, including `getAfter()` checks.

Hire Employee invitations carry the employee document ID created by that flow,
so onboarding updates the intended record and preserves fields such as country
and work mode. If no matching employee exists, onboarding creates exactly one
record at the authenticated UID.

Company context now fetches a specific company document using the verified
profile `companyId`; only the Platform Admin dashboard calls
`listAllCompanies()`. Attendance waits for a resolved active profile and
matching company context, checks the current Firebase UID before and after
async reads, deduplicates active syncs, and no longer writes employee links.

## Verification and limits

After hardening the user update branches, `npm run test:invitation-onboarding`
completed with **19/19** authenticated Firestore/Auth Emulator cases passing,
without the earlier 1,000-expression evaluation-limit warnings. The rules
evaluation regression command passed **11/11**.

An actual headless-browser run of the application invitation page passed
**7/7** scenarios: existing Gmail- and Outlook-domain Auth Emulator accounts
retained their UIDs, linked exactly one existing employee, and accepted their
invites; duplicate acceptance made no further writes; expired, revoked, and
already-accepted invites exposed no acceptance action. The company count did
not change.

The attendance browser suite did **not** complete. Ten attendance scenarios
(A, B, C-EN, C-AR, and E1–E6) timed out waiting for sync; its D cross-tenant
isolation scenario passed. The browser captured `[AttendanceStore] Sync
failed` and permission-denied service errors. The run stopped before F and a
complete result. The browser log did not preserve the denied operation's
document path/code, so this run does not identify that denial's exact rule or
document.

`npm run build` (TypeScript plus production bundle) and `npm run lint` exited
successfully; ESLint reported warnings. `git diff --check` passed. No
production Firebase project was accessed or changed.

The original live request remains unobserved: no production token, document,
ruleset, or browser request was inspected. The reproduced direct employee
update is the prior implementation's confirmed Emulator denial, not proof
that it was the first denial for the live invitation. Release remains blocked
until the attendance sync denial is traced and the complete attendance browser
suite passes. See `FIREBASE_EMULATOR_SECURITY_TEST_REPORT.md`,
`ATTENDANCE_INITIALIZATION_RACE_REPORT.md`, and
`PRODUCTION_DEPLOYMENT_APPROVAL_CHECKLIST.md`.
