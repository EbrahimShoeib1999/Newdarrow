# D-ARROW — AUTH TENANT HYDRATION FINAL ACCEPTANCE

**Scope:** auth/tenant hydration fix + isolated Firebase Emulator browser E2E.
**Environment:** local workspace only. Firebase **Emulators only** (`127.0.0.1`).
No production login/registration, no production data, no production rules change,
no deployment, no commit, no push.

---

## 1. Verdict

| Item | Verdict |
|---|---|
| Auth tenant hydration defect (fabricated/default tenant, wrong company, navigation before tenant resolution) | **FIXED — verified end-to-end in a real browser** |
| Complete registration → dashboard browser flow | **PASS** |
| Session restoration (refresh, logout/login, delayed provisioning) | **PASS** |
| Tenant isolation (no foreign tenant access, no `default-company` access) | **PASS** |
| Firestore rules allowlist coverage for shipped app collections | **FAIL — pre-existing, not introduced here, NOT fixed here** |
| `firestore.rules` vs. reconciliation/provision test fixtures | **FAIL — pre-existing drift, NOT fixed here** |
| **Overall production readiness** | **NOT READY** — see §6 |

---

## 2. What was broken in the E2E environment (and why "Invalid email or password")

Four independent defects were found and fixed in the **test harness only**
(no production code was involved in any of them):

1. **Stale, shared accounts.** The fixture used hard-coded accounts
   (`redirect_admin_a@acme.test` / `RedirectTest2026!`) and a silent
   `signUp → signInWithPassword` fallback. On a re-used emulator the
   `signUp` returned `EMAIL_EXISTS`, the fallback sign-in was never asserted,
   and the browser then presented `Invalid email or password`.
   **Fix:** every run now creates its own isolated accounts through the
   **Auth Emulator REST API** (`accounts:signUp`), and the test **asserts**
   that the fresh account can independently `signInWithPassword` before the
   browser touches it. Passwords and e-mails are random per run (`randomUUID`),
   so no run can reuse another run's credentials.

2. **The browser could silently attach to the wrong page.** Edge intermittently
   opens `edge://sync-confirmation-dialog` as the *first* CDP `page` target.
   The harness picked the first page target, so it drove a page that never
   loads the app → `Timed out waiting for browser Firebase app initialized`.
   **Fix:** the harness closes every `edge://`/`chrome://` target and only
   attaches to a real, navigable web target (and logs which one it picked).

3. **Hard-coded CDP / Vite ports.** A browser left behind by a previous run
   kept port `9782`; the harness then attached to the *stale* instance and
   hung. **Fix:** both ports are now allocated per run from the OS free-port
   pool, CDP calls have a 60 s fail-fast timeout, and the process tree is
   terminated with `taskkill /T` on exit.

4. **`vite dev` is unusable as an E2E target for this app.** On-demand
   transformation of this codebase took **> 90 s** for the first page load
   (each additional route tens of seconds more), so the suite timed out before
   the app ever mounted. **Fix:** the harness now **builds the production
   bundle** with the emulator env and serves it with `vite preview`.
   Cold boot dropped from >90 s to **~1.2 s**; the suite now drives the
   *shipped* bundle instead of a dev build.

Additional harness fix: `clearSession()` now signs out through the Auth SDK
before clearing IndexedDB. Deleting `firebaseLocalStorageDb` alone can be
**BLOCKED** by the SDK's open connection, leaving a live session that bounced
`/login` back to `/apps` and made the next login form unreachable (this
intermittently failed `T10`).

A fifth harness fix closes the same class of race on the *assertion* side:
the fail-closed scenarios now mark the captured Firestore traffic **after**
the signed-out login form is on screen. The previous session's own listeners
can still fire for a moment after the sign-out, and attributing them to the
next scenario produced a false "tenant data was read" verdict. The
"tenant data" detector was also tightened to distinguish a subcollection
access (`companies/{id}/<sub>` or a query scoped to `companies/{id}`) from the
legitimate **company-document read** that the tenant verification itself
performs.

Every timeout in the harness now emits a `DIAGNOSTIC[...]` snapshot (URL,
body text, inputs, Firebase `currentUser`, auth-store state, console tail) so
a failure explains itself instead of only reporting "timed out".

The browser was also verified to actually talk to the emulator:
`window.__darrowAuth.app.options.projectId` must equal the emulator project
id, and the suite asserts that at least one Auth request reached
`http://127.0.0.1:9099/`.

---

## 3. Real registration E2E (evidence)

`scripts/test-auth-redirect-browser.mjs` registers a brand-new company through
the actual registration form and then asserts, from the emulator's own data:

| Assertion | Evidence |
|---|---|
| Auth session established | `uid` present, `email` matches the registered address |
| Firestore user document exists, role `admin`, non-empty `companyId`, not `default-company` | `users/{uid}` read back from the emulator |
| Company ownership / id consistency | `companies/{companyId}.id === users/{uid}.companyId`, `.name === registered company name` |
| Auth store resolves the **real** company id | `window.__darrowAuthStore.getState()` → `companyId === <registered id>`, `role: "admin"`, `authError: null` |
| CompanyProvider resolves the correct company | company-profile form `input[name=name]` equals the registered company name **and** the browser read exactly `companies/{registered id}` |
| No default / fabricated tenant | no request anywhere in the run contains `default-company`; store `companyId` is the generated id |
| Navigation happens only after tenant resolution | the app navigated to `/apps` only after the provisioning verification gate passed |

`src/features/auth/api/auth.service.ts` now performs an explicit
**verification gate** after registration (user document committed, `role ===
admin`, `companyId` consistent, company document committed) and returns the
*authoritative* re-read user, so the store never publishes a tenant that the
database does not actually contain.

---

## 4. Session lifecycle (evidence)

| Scenario | Result | Evidence |
|---|---|---|
| Immediate post-registration navigation | **PASS** | `T0-registration-provisions-real-tenant-before-navigation` |
| Browser refresh | **PASS** | `T3-refresh-keeps-protected-route` (final `/crm/leads`) |
| Session restoration after refresh | **PASS** | `T0-session-restored-after-refresh` (still authenticated, `/apps`) |
| Logout → login | **PASS** | `T0-logout-login-restores-same-tenant` (same `uid`, same `companyId`) |
| **Delayed user document visibility** | **PASS** | `T0-delayed-user-document-resolves-real-tenant` — profile + company documents deleted, session restored, documents published only *after* the app's first read → store resolves the real tenant, no provisioning error |
| **Delayed company document visibility** | **PASS** | `T0-delayed-company-document-resolves-real-tenant` — company document published only after the app's first read → store resolves the real tenant |
| Missing user document | **PASS (fails closed)** | `T8-missing-profile-denied-safely` — explicit error screen, `companyId: ""`, `authError` set, **0** tenant-scoped reads, no `default-company` request |
| Missing company document | **PASS (fails closed)** | `T9-missing-company-denied-safely` — same |
| Invalid companyId (`default-company`) | **PASS (fails closed)** | `T10-invalid-tenant-denied-safely` — same |

The delayed-document scenarios required one **product** fix: the login path
used to publish the profile's `companyId` without checking that the company
document actually existed. The CompanyProvider then queried a non-existent
company, cached "company does not exist", and the UI never recovered — even
though the auth-store hydration had already resolved the real tenant.
`useAuthStore.login` / `loginWithGoogle` / `checkAuth` now go through
`resolveVerifiedUser()`, which verifies the company document with the same
bounded retry window used by the hydration and **drops the tenant (fail
closed)** when it cannot be confirmed.

---

## 5. Critical application routes

Every route below was **actually visited by the browser** and asserted on the
rendered DOM, the final URL, the console output and the captured Firestore
network traffic.

| Route | Name | Tenant violations | Provisioning error | Firestore denials | Result |
|---|---|---|---|---|---|
| `/apps` | Portal picker | 0 | no | **1** (see §6) | PASS (tenant-correct) |
| `/projects` | Tenant dashboard (default activity) | 0 | no | 0 | PASS |
| `/settings/company` | Company profile | 0 | no | 0 | PASS |
| `/crm` | CRM | 0 | no | 0 | PASS |
| `/tasks` | Tasks dashboard | 0 | no | 0 | PASS |
| `/people/attendance-settings` | Attendance | 0 | no | 0 | PASS |
| `/meetings` | Meetings | 0 | no | 0 | PASS |
| `/people` | People / HR | 0 | no | 0 | PASS |
| `/settings/team` | Settings | 0 | no | 0 | PASS |

"Tenant violations" = any Firestore request that referenced a company id other
than the registered tenant, or any reference to `default-company`.
**Zero across every route.**

---

## 6. Remaining failures — classified

### 6.1 Firestore rules allowlist gap (PRE-EXISTING, NOT FIXED HERE)

`T0-routes-free-of-firestore-permission-denials` **FAILS**: the portal picker
(`/apps`) triggers Firestore permission denials.

Root cause (measured with `@firebase/rules-unit-testing` against the current,
unmodified `firestore.rules`): several collections that shipped services read
and write are **not** in `isKnownGenericCollection()` and have no dedicated
`match` block, so they are denied for *every* tenant — including the tenant's
own members.

Denied for a legitimate same-tenant company admin:

```
crm_tasks, crm_notifications, crm_attachments, activities, notes,
quotations, meetings, prices, presence,
companies/{companyId}/invites   (the rules only cover the ROOT `invites` collection)
```

Allowed for the same admin (control group): `tasks, contacts, leads, deals,
projects, sprints, customers, accounts, contracts, products, inventory_items,
leave_requests, performance_reviews, announcements, work_locations, assets,
client_reports, employees, attendance, hr_schedule_templates,
hr_lateness_policies, hr_deduction_cases, settings, module_definitions,
contact_classifications`.

`rem_*` / `fm_*` denials are **not** a gap — those are activity-gated by
design and a `PROJECTS` tenant is correctly denied them.

`git log -S "crm_tasks" -- firestore.rules` and `git log -S "'meetings'" --
firestore.rules` return **no commits**: these collections were never
allowlisted. The defect is pre-existing and **fails closed** (it denies; it
never grants cross-tenant access).

**Per the acceptance instruction, `firestore.rules` was NOT modified.**
Proposed change, for separate review (not applied):

> In `isKnownGenericCollection()` add `crm_tasks`, `crm_notifications`,
> `crm_attachments`, `activities`, `notes`, `quotations`, `meetings`,
> `prices`, `presence`; and add a `match /invites/{inviteId}` block under
> `companies/{companyId}` mirroring the root `invites` gate
> (`isCompanyAdmin(resource.data.companyId)`), so the shipped
> `companies/{companyId}/invites` read path is authorised for tenant admins.
> Every one of them stays inside `belongsToCompany(companyId)`, so tenant
> isolation is unchanged. This must land with a dedicated negative test
> ("outsider cannot list <collection> of another company") per collection.

### 6.2 The 4 failing cases of the 9/13 emulator test (PRE-EXISTING)

`npm run test:registration-visibility` → **9/13**, failures:

1. `invite accept: new account writes own profile with invite.companyId`
2. `invite accept: invitee VISIBLE in the company-scoped roster query`
3. `SEC: super_admin CAN attach an orphan to a real company (reconciliation write)`
4. `SEC: after assignment the orphan is now in the acme roster (workflow closed)`

**Proof they are pre-existing:** the identical test file and the identical
rules file were taken from `HEAD` (`git show HEAD:...`) into an isolated
directory and executed against a fresh emulator. The pristine baseline fails
the **same four cases** with the **same rule lines** → **9/13**.
Both files are untouched by this change, and the test imports **no** module
from `src/`, so it cannot be affected by it.

Root causes (both **fail closed**):

* **(1)/(2)** — `firestore.rules` L413 (`allow create` on `users/{userId}`)
  now permits only three shapes: invitation-backed provisioning
  (`onboardingStatus == "pending"` + a matching `invitationToken` + a real
  pending `invites` document), an ordinary self-provisioned **orphan**
  (`role in [employee, viewer]` **and** `companyId == ""`), or the admin of a
  **not yet existing** company. The test fixture writes an `employee` profile
  with a **non-empty** `companyId` and no invitation → correctly denied. The
  fixture is stale, the rules are stricter.
* **(3)/(4)** — the super-admin orphan-reconciliation branch
  (`isSuperAdmin() && resource.companyId == '' && request.companyId != ''`)
  is nested under `request.auth.uid == userId` (L444), so it can only assign a
  tenant to the caller's **own** profile. Assigning a *different* orphan is
  unreachable: the `request.auth.uid != userId` branch requires
  `resource.companyId == request.companyId`, which is exactly what a
  reconciliation changes. The rule comment (L438-441) promises a capability
  the implementation cannot grant. The same root cause produces the identical
  failure `reconcile: super_admin ASSIGNS an orphan to a company` in
  `npm run test:rules` (183/186), whose pristine `HEAD` baseline also fails
  the **same three** cases.

**Not modified** (`firestore.rules` and both test files are untouched). A fix
requires either (a) moving the reconciliation branch into the
`request.auth.uid != userId` branch with an explicit
`isSuperAdmin() && resource.companyId == '' && request.companyId != ''`
condition, or (b) updating the stale test fixtures to the current,
stricter provisioning contract. Both are rule/behaviour decisions that must be
reviewed on their own.

### 6.3 Not a failure — by design

The "Couldn't load your attendance session" banner is visible on several
routes. It is the app's own **attendance** module failing to read
`companies/{id}/attendance` for a tenant whose `primaryActivity` is
`PROJECTS`; the attendance collection is activity-gated by design. It is not a
tenant-resolution error and does not grant or leak any access.

---

## 7. Quality gate

| Gate | Result |
|---|---|
| `npm run build` (`tsc -b && vite build`, production env) | **PASS** — exit 0, built in 2 m 20 s |
| `npx tsc --noEmit -p tsconfig.app.json` | **PASS** — no diagnostics |
| `npm test` | **NOT AVAILABLE** — the repository has no aggregate `test` script (`npm error Missing script: "test"`). The relevant suites were run individually below. |
| `npm run test:auth-tenant-hydration` (focused hydration/race unit test) | **PASS** — 3/3 assertions |
| `npm run test:map-user` | **PASS** — 5/5 |
| `npm run test:invitation-onboarding` (auth+firestore emulator) | **PASS** — 19/19 |
| `npm run test:rules-eval` | **PASS** — 18/18 |
| `npm run test:rules` | **FAIL** — 183/186; the 3 failures are **identical in the pristine `HEAD` baseline** (pre-existing) |
| `npm run test:registration-visibility` | **FAIL** — 9/13; the 4 failures are **identical in the pristine `HEAD` baseline** (pre-existing) |
| Browser E2E (`scripts/test-auth-redirect-browser.mjs`) | **26/27 PASS** — the single failure is the §6.1 rules-allowlist aggregate |
| ESLint on all changed source files | **0 errors, 6 warnings** (the `HEAD` baseline for the same files is **0 errors, 9 warnings** — three pre-existing warnings were removed, **none added**) |
| `git diff --check` | **PASS** — clean (only the repository's existing LF→CRLF advisory for `map-user.ts`) |

---

## 8. Changed files

### Source (product)

| File | Change |
|---|---|
| `src/stores/auth.store.ts` | `authError` state; `register()` action; bounded-retry tenant verification (`resolveVerifiedUser`) for `login` / `loginWithGoogle` / `checkAuth`; hydration retries the profile **and** the company document; drops the tenant when it cannot be verified; emulator-only `window.__darrowAuthStore` test hook. |
| `src/features/auth/utils/retry-auth-profile.ts` | **New.** Bounded (4-read) retry helper for provisioning reads. |
| `src/features/auth/utils/map-user.ts` | Trims `companyId`; rejects the legacy `default-company` sentinel; no longer promotes a **claim-only** tenant. |
| `src/features/auth/api/auth.service.ts` | Registration verification gate (user + company committed, role/`companyId` consistent) and authoritative re-read of the user document. |
| `src/features/auth/context/auth-context.tsx` | Exposes `authError` and `register`. |
| `src/features/auth/components/register-form.tsx` | Uses the store's `register` (single authoritative hydration path). |
| `src/features/auth/components/protected-route.tsx` | Fails closed with an explicit error when the tenant cannot be resolved; spinner while resolving; platform/super-admin exempt. |
| `src/features/companies/context/company-context.tsx` | Normalises/rejects `default-company`; exposes `error`; keeps loading state until the tenant resolves. |

### Test / tooling

| File | Change |
|---|---|
| `scripts/test-auth-redirect-browser.mjs` | Isolated per-run accounts created and verified through the Auth Emulator API; emulator preflight; production build + preview server; per-run CDP/Vite ports; Edge internal-page handling; CDP timeouts; process-tree cleanup; registration/tenant/route/session/delayed-provisioning/fail-closed assertions; per-run result directory (legacy summary path still written). |
| `scripts/test-auth-tenant-hydration.ts` | **New.** Focused hydration/race unit test. |
| `package.json` | Adds `test:auth-tenant-hydration`. |

### Not touched (verified)

`firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json`,
`.firebaserc`, `.env`, `.env.local`, and every pre-existing untracked file.

---

## 9. Production-readiness verdict

**The auth tenant hydration defect is fixed and verified.** A brand-new
company can register in a real browser, its owner/admin profile and company
document are written, the auth store and `CompanyProvider` both resolve that
**real** tenant, navigation happens only after resolution, the session
survives refresh and logout/login, late-published tenant documents are
tolerated, and missing/invalid tenant data fails closed without granting any
tenant access. Tenant isolation is intact on every route.

**The product is NOT ready to ship**, for reasons that are **pre-existing and
outside this change**:

1. **Firestore rules allowlist gap (§6.1)** — `crm_tasks`, `crm_notifications`,
   `crm_attachments`, `activities`, `notes`, `quotations`, `meetings`,
   `prices`, `presence` and `companies/{id}/invites` are unreadable/unwritable
   for every tenant. CRM tasks/notifications, quotations, activities, meetings
   and pricing are broken in production today. The rules change is specified
   in §6.1 but **deliberately not applied**.
2. **Rules/test drift (§6.2)** — the super-admin orphan-reconciliation
   capability is unreachable, so orphan accounts cannot be reconciled, and the
   `test:rules` / `test:registration-visibility` suites are red (183/186 and
   9/13) on the pristine `HEAD` baseline as well.

Both items fail **closed**; neither grants cross-tenant access. They must be
resolved (and their suites made green) before a production sign-off.
