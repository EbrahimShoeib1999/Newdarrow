# Existing Firebase Auth Account Linking

## Intended behavior

The existing-account path authenticates with the submitted credentials through
Firebase Auth, then passes that authenticated `FirebaseUser` and its existing
UID to the shared invitation onboarding function. The invite's verified email
must match the Auth account. No new account is created for the existing-account
path, no password is reset, and the UID is not replaced.

The "accept with current session" path uses `auth.currentUser` and the same
onboarding function. Both paths therefore share invitation checks and Firestore
completion logic.

## Data linkage

The profile is `users/{auth.uid}`. The employee is
`companies/{invite.companyId}/employees/{invite.employeeId}` when the invite
was created from an existing employee record. If the invite has no employee ID,
onboarding searches the target company's employee subcollection by normalized
email and rejects ambiguous or mismatched records. If none exists, the UID is
used as the employee document ID.

The final batch preserves existing employee attributes, including country and
work mode, while attaching `userId` and setting the canonical tenant, invited
email, and invited role. The profile, employee link, and invitation acceptance
are committed together after a pending, inert profile stage.

An account already associated with a different non-empty `companyId` is
rejected; there is no self-service tenant transfer. The invited company and
role are taken from the validated invite, not caller-provided values.

## Emulator evidence

The suite creates and signs in actual Gmail and Outlook accounts using the
Firebase Auth Emulator, then performs Firestore operations against the
Firestore Emulator. Both existing-account cases preserve the generated Auth
UID and attach the expected employee record. A separate new-Gmail scenario
also verifies account creation for the new-user flow.

These are emulator identities only. No live account was authenticated,
migrated, reset, or modified. The production invitation's actual expiry type,
employee ID, and other fields have not been inspected.

## Application UI evidence

The headless-browser test entered an already-existing Gmail- and
Outlook-domain Emulator account's existing password on `/invite/:token`.
`AuthService.acceptInvite` authenticated the pre-existing Auth account and the
invitation flow retained the original UID. For both accounts the test verified
the accepted invitation, exact employee `userId`, company/email/role, retained
country/work mode, exactly one employee record, and no new company document.
Both duplicate acceptance attempts were rejected without changing the user,
employee, or invitation documents.

The same browser run verified that expired, revoked, and already-accepted
invites expose no acceptance/password-onboarding action. These UI attempts
were against the local Emulators only. The separate browser attendance
initialization did not pass; it is documented in
`ATTENDANCE_INITIALIZATION_RACE_REPORT.md`.
