# Invitation and Attendance Release Readiness

## Decision

**NO-GO. Do not deploy application changes or Firestore rules.**

Invitation onboarding passed the focused Emulator and browser checks, but the
real attendance browser flow failed to complete its initial sync. The first
denied attendance operation and rule have not been identified. The task
requires stopping when a critical authorization or tenant-isolation test
fails; the attendance run was therefore stopped before the remaining matrix.

## Verified fixes

* Invitation acceptance uses the existing Firebase Auth UID and takes the
  company, employee-facing role, and employee ID from the validated invite.
* User activation, employee link/create, and invite acceptance are committed
  atomically. Pending profiles do not gain normal tenant access.
* Existing employee IDs are preflighted; an employee already claimed by a
  different UID cannot be taken over.
* Normal self-profile updates cannot change tenant, role, portal permissions,
  country scope, or onboarding status. Pending-to-active requires the
  completion batch.
* Company context retrieves the resolved tenant instead of requiring a
  platform-wide company list. Company listing remains platform-admin-only.
* Attendance initialization is gated on resolved, matching identity/company
  state and obsolete syncs are cancelled or ignored.

These are code/rules changes verified in focused tests; they are not yet a
release approval.

## Test evidence

| Validation | Result | Scope |
|---|---:|---|
| `npm run test:invitation-onboarding` | **19/19 passed** | Auth + Firestore Emulator; invitation validation, atomic linking, existing/new Gmail identities, existing Outlook identity, tenant isolation, anti-takeover, and escalation denials |
| `npm run test:rules-eval` | **11/11 passed** | Firestore Emulator rule evaluation regressions |
| `npm run test:invitation-ui` | **7/7 passed** | Actual application UI in a headless browser; existing Gmail/Outlook Auth accounts, UID preservation, single employee record, duplicate rejection, expired/revoked/already-accepted handling |
| `npm run build` | **Passed** | TypeScript project check and production Vite build |
| `npm run lint` | **Exit 0; warnings reported** | Full ESLint run |
| `git diff --check` | **Passed** | Whitespace/error check |
| `npm run test:attendance-lifecycle-browser` | **Aborted — blocker** | Ten scenarios (A, B, C-EN, C-AR, E1–E6) timed out waiting for attendance sync; D cross-tenant isolation passed; repeated `[AttendanceStore] Sync failed` and permission-denied service errors were captured |

The attendance browser run did not finish and has no valid full-suite test
count. It is not evidence that check-in, break/resume, check-out, switching,
concurrency, or midnight/timezone behavior passes.

## Blocking defect and open questions

The browser attendance tracker did not reach its completed-sync signal in ten
scenarios (A, B, C-EN, C-AR, E1–E6). The D cross-tenant isolation scenario
passed. The captured browser console showed permission-denied service
failures, but the harness rendered the error object without its Firestore
operation, document path, or error code. Therefore the specific denied
request and responsible rule remain unknown. The run stopped before F and
there is no complete suite result.

The rules-backed invitation suite's attendance read assertion is narrower than
the real Zustand store and React initializer. It cannot replace a successful
browser sync. Do not treat the invitation fixes as complete release
verification while attendance remains blocked.

Other requested checks not completed in this run include attendance
break/resume, rapid account switching and stale-request cancellation under
browser conditions, concurrent initialization, unauthorized attendance
creation, and timezone/midnight boundaries.

## Security and production risks

* The live invitation and production Firestore rules were not inspected.
  Its actual expiry type, employee ID, email, role, and company relationship
  remain unknown.
* The reproduced legacy direct employee update is a confirmed Emulator denial,
  but it is not proof that this was the first denied operation for the live
  invitation.
* Rules changes have not been deployed. No production Firebase access, writes,
  password resets, migrations, custom-claim changes, or deployment occurred.
* Company-wide listing remains restricted to platform administrators; the
  complete platform-admin and cross-company browser matrix was not part of the
  successful invitation UI run.

## Prerequisites to reconsider GO

1. Instrument and rerun the attendance browser suite against local Auth and
   Firestore Emulators. Log only safe operation/path templates and Firebase
   error codes; capture the first denied request.
2. Fix the exact rule or lifecycle cause without weakening tenant isolation.
3. Pass the full attendance UI lifecycle and account-switch matrix, including
   break/resume, concurrent/repeated initialization, check-in/out, and
   timezone/midnight cases.
4. Pass positive and negative cross-company authorization tests, including
   platform-admin separation and unauthorized attendance writes.
5. Rerun the focused Emulator tests, full lint/build, and `git diff --check`
   after the fix.
6. Conduct a separate approved read-only review of the production invitation
   schema and exact proposed rule/code diff. Obtain explicit deployment
   approval. Do not perform production writes during that review.

Until every prerequisite is satisfied, the release decision remains
**NO-GO**.
