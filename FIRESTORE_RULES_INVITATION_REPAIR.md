# Firestore Rules — Invitation Repair

## Authorization model

The employee record schema used by this application is the company subcollection:

`companies/{companyId}/employees/{employeeId}`

`companies/darrow` is the canonical D-Arrow company document. Rules and the
application use the `companyId` field, `email`, `role`, and `userId` employee
fields; the employee UID is stored in `userId`, while the employee document ID
may be a pre-existing HR-generated ID.

## Invitation validation

The rules now require invitation-backed profile provisioning to agree on:

* Token value and `invites/{token}` document ID.
* Pending status and a future Firestore `Timestamp` expiry.
* Auth token email, invite email, and profile email.
* Authoritative invitation `companyId`, company name, role, portal access, and
  portal sub-roles.
* Authenticated UID and the user document ID.
* An allowed employee-facing role; platform administrator and super-admin
  assignment is not invitation-provisionable.

The final batch is validated with `getAfter()`: the user profile becomes active
only alongside the accepted invite and a matching company employee containing
the authenticated `userId`, email, company, and invited role. A pending profile
alone does not grant normal company access. An ordinary self-created employee
profile must have an empty `companyId`; it cannot select a tenant.

The invitation's existing `employeeId`, when present, is immutable for invite
acceptance. This prevents choosing an unrelated employee document. A missing
employee ID is set by the onboarding client to the UID only after checking for
an unambiguous matching email record.

## Company isolation and listing

Company document `get` remains tenant-scoped. Collection-wide `list` on
`companies` is restricted to platform administrators. A company employee does
not need or receive permission to list every tenant. Company admins retrieve
their own document using `getCompany(companyId)`.

## Negative authorization cases

The Emulator tests verify rejection of expired and accepted invitations, a
wrong authenticated email, forged company assignment, forged role assignment,
cross-company transfer, and direct employee linking outside the invitation
batch. They also reject takeover of an employee linked to another UID,
pending-profile self-activation without the completion batch, and self-granted
portal access.

Ordinary self-profile changes are evaluated separately from administrator
management paths. A normal profile update must preserve role, company,
custom permissions, portal access/sub-roles, country scope, and onboarding
status. Completion from pending to active is restricted to the same atomic
user/employee/invite batch and to the two changed profile fields used by the
service (`onboardingStatus` and `updatedAt`). This avoids running the expensive
`getAfter()` completion checks for unrelated self-updates and prevents a
permission-denied result from being masked by the 1,000-expression limit.

Latest rules-backed evidence: **19/19** invitation/Auth Emulator cases passed,
including the new anti-takeover and self-escalation cases. No broad employee
write grant was introduced. The separate rules-evaluation regression suite
passed **11/11**; its expected denied-operation diagnostics are recorded in
the test output.

## Compatibility and deployment notes

New invitations store `expiresAt` as a Firestore `Timestamp`. The current rule
rejects legacy invitations whose expiry is an ISO string. Pre-deployment review
must determine whether any still-valid production invitation needs safe
reissue; no production invitation was inspected or modified here.

No rules were deployed. Review the exact rule diff together with the service
changes before release. Run `npm run test:invitation-onboarding` and the
project's broader rules suite against the intended rules file before approval.
The release is currently **NO-GO** because the actual attendance UI sync did
not complete and its permission-denied operation has not been isolated.
