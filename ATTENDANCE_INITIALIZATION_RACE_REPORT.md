# Attendance Initialization Race

## Previous risk

Auth state, the user profile, and company context resolve asynchronously.
During account switches or invitation completion, an attendance effect could
observe an outdated user/company combination. Attendance initialization also
had employee lookup/claim behavior that could attempt to create or attach
employee data outside the invitation's validated transaction.

## Changes

* The auth store clears stale identity while a different Firebase UID resolves,
  versions `onIdTokenChanged` callbacks, and ignores results when the callback
  is obsolete or the current Firebase UID changed.
* Company context resolves only from the authenticated user's explicit
  `companyId`; it no longer lists all companies to select a default tenant.
* `AttendanceInitializer` requires auth and company loading to finish, a
  current authenticated user with a resolved profile, active onboarding, and
  exact agreement between user and company IDs. Otherwise it cancels sync.
* Attendance sync is deduplicated by company/user, validates the current Auth
  UID and current user profile before starting and after every awaited read, and
  ignores obsolete generations.
* Attendance sync no longer creates or claims employee profiles. It validates
  employee company, email, UID (when already assigned), and role before using
  the employee record.

## Verification result and blocker

Emulator case L still passes the rules-backed post-acceptance employee and
attendance reads. However, the actual browser attendance suite was started
against the Auth and Firestore Emulators after its fixture setup was corrected
to seed only test fixtures through Emulator owner access. Ten scenarios timed
out waiting for tracker sync: office, remote, English and Arabic no-location,
and E1–E6 schedule cases. The separate D cross-tenant isolation scenario
passed. The browser captured repeated `[AttendanceStore] Sync failed`
messages and permission-denied service errors. The run was stopped before the
remaining F eligibility scenarios and before a complete suite result.

The captured browser log rendered the error object without its Firestore
operation/path/code. As a result, the specific denied request and rule have
not been identified. No conclusion that the attendance race is resolved is
supported by the current evidence. Check-in/out, break/resume, account
switching, concurrency, and midnight/timezone UI behavior remain unverified
in this run. The invitation-backed rules suite's attendance read assertion is
not a substitute for mounting the real store and initializer.

**Release blocker:** instrument the next Emulator browser run to serialize the
first failing Firestore operation's safe path template and error code, correct
the authorization or lifecycle defect, then rerun the full attendance UI
matrix. Do not deploy rules while this failure remains.
