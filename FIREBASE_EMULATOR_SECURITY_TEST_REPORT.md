# Firebase Emulator Security Test Report

## Environment

Command: `npm run test:invitation-onboarding`

The command runs Firebase Auth and Firestore Emulators and loads the repository
`firestore.rules`. Tests use real Firestore Emulator requests and
`@firebase/rules-unit-testing`; cases A–C additionally create/sign in real
Firebase Auth Emulator accounts and use their credentials for Firestore
requests. These are not mocked Firestore unit tests.

## Results

**19/19 cases passed** in the latest `npm run test:invitation-onboarding`
run. The test executes authenticated requests against the actual Firestore
Emulator rules and uses the Auth Emulator for real test accounts.

The additional `npm run test:rules-eval` regression command also completed
successfully: **11/11 cases passed**.

The completed invitation UI browser suite passed **7/7** scenarios in the
application: existing Gmail and Outlook accounts, UID preservation, exact
employee linking, duplicate rejection without writes, and no acceptance
action for expired, revoked, and already-accepted invites. The browser was
configured to use local Auth/Firestore Emulators, and non-local Firebase
endpoints were blocked.

| Case | Scenario | Result |
|---|---|---|
| A | New Gmail Auth identity links the pre-created employee, preserves country/work mode, and creates no company | PASS |
| B | Existing Gmail Auth account signs in and preserves its UID | PASS |
| C | Existing Outlook Auth account signs in and preserves its UID | PASS |
| D | Existing account attached to another company cannot be transferred | PASS |
| E | Expired invitation is denied | PASS |
| F | Already-accepted invitation cannot be read/reused | PASS |
| G | Wrong authenticated email cannot accept another person's invite | PASS |
| H | Forged `companyId` cannot stage an invitation profile | PASS |
| I | Forged role cannot override invitation role | PASS |
| J | Missing employee record is created once at the authenticated UID | PASS |
| K | Existing employee record is linked without a duplicate | PASS |
| L | Accepted employee can perform the employee and attendance reads used by initialization | PASS |
| M | Normal employee cannot list every company | PASS |
| N | Platform administrator can list companies | PASS |
| O | Company administrator can retrieve their own company document | PASS |
| P | Former direct employee-link update is denied | PASS |
| Q | A previously claimed employee record cannot be taken over; authorized repair permits retry | PASS |
| R | A pending invitee cannot activate a profile without the atomic completion batch | PASS |
| S | An ordinary employee cannot self-grant portal access | PASS |

## Interpretation and caveats

The latest invitation suite no longer emitted the earlier 1,000-expression
limit warning for cases R and S. The separate rules-evaluation suite includes
expected denied writes and passed its clean-denial assertions.

The UI browser test exercises the actual `AcceptInvitePage` and
`AuthService.acceptInvite` with Emulator-created pre-existing Auth accounts.
It does not establish that the attendance lifecycle is ready: the subsequent
attendance browser suite had **10 scenario timeouts** (A, B, C-EN, C-AR, and
E1–E6) waiting for tracker sync. Its D cross-tenant isolation scenario passed.
Repeated permission-denied errors were logged, but the exact denied document
path was not captured. The suite was stopped before the F eligibility cases
and a complete result. See the attendance race report.

No live invitation, production rules, or production Auth account was inspected
or changed. No rules were deployed. Full release approval is withheld until
the attendance denial is isolated and the complete attendance UI/security
matrix passes.
