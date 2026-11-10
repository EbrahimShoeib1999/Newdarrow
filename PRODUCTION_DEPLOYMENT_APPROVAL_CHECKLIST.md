# Production Deployment Approval Checklist

**Status: NO-GO / NOT APPROVED / NOT DEPLOYED.** This investigation made no
production Firebase reads or writes and did not deploy rules.

## Latest release-readiness evidence

* Invitation/Auth Firestore Emulator suite: **19/19 passed**.
* Rules evaluation regression suite: **11/11 passed**.
* Actual invitation page UI in a browser: **7/7 passed** for existing
  Gmail/Outlook accounts, UID preservation, exact employee linking, duplicate
  rejection, and expired/revoked/already-accepted invitation handling.
* TypeScript plus production build: **passed**.
* Full ESLint: **exit 0 with warnings**.
* `git diff --check`: **passed**.
* Attendance browser UI: **BLOCKED**. Ten scenarios (A, B, C-EN, C-AR, and
  E1–E6) timed out waiting for tracker sync; D cross-tenant isolation passed.
  Permission-denied errors were logged but the exact denied Firestore
  operation/path was not captured. The run stopped before F and a complete
  result; attendance lifecycle behavior is not verified.

The attendance failure is a critical authorization/lifecycle blocker. No
production deployment or rules deployment is approved.

## Required review before release

- [ ] Review the complete `firestore.rules` diff, especially invitation
  validation, pending-profile isolation, `getAfter()` completion checks,
  employee update/create permissions, and companies collection listing.
- [ ] Review all application code changes, including `acceptInvite`,
  `acceptInviteForCurrentUser`, `invitation-onboarding.ts`, company context,
  and attendance initialization/cancellation.
- [ ] Confirm the production canonical company document is `companies/darrow`
  and confirm the employee subcollection schema using an approved, read-only
  production review. Do not infer this review from Emulator data.
- [ ] Determine whether the live invitation's `expiresAt` is a Firestore
  `Timestamp`. Current rules reject string expiries; if a pending legacy invite
  is incompatible, coordinate a safe reissue rather than mutating it during
  diagnosis.
- [ ] Confirm the live invitation's `employeeId` points at the intended employee
  record and that email, company, and role match. No personal data should be
  copied into logs or reports.
- [ ] Run `npm run test:invitation-onboarding` with Auth and Firestore
  Emulators, then run the relevant broader Firestore rules tests.
- [x] Validate existing-account invitation acceptance in a real browser
  against local Firebase Emulators for Gmail- and Outlook-domain accounts.
- [ ] Resolve the attendance sync permission-denied failure, capture the first
  denied operation/path, then pass the complete attendance UI and tenant
  isolation matrix.
- [ ] Verify company directory visibility and attendance initialization after
  acceptance in the corrected browser run.
- [ ] Confirm role policy and platform administrator custom-claim handling with
  the security owner; do not make client-side claim changes.
- [ ] Prepare an approved deployment and rollback plan for the exact rules and
  application revisions.
- [ ] Obtain explicit production deployment approval from the responsible
  owner.

## Prohibited during diagnosis

Do not repeatedly accept the live invitation, create/delete employee records,
reset passwords, migrate users, change custom claims, or deploy Firestore rules
without the above review and approval.
