# Checkpoint — Registration & Attendance Bug-Fix

> Durable project checkpoint for session resumption. This is a status/handoff document, **not** application source. Do not treat it as a task to re-run from scratch — completed work below is already done and verified.
>
> Created: 2026-10-31 · Branch: `main` · HEAD: `2e98588 (fix logo)`, **0 commits ahead of `origin/main`** · No commits, pushes, deploys, resets, cleans, `npm ci`, or Firebase-config/production changes were made by this work.

## Overall status

| Item | Status |
|---|---|
| Registration / invite-visibility bug | **FIXED AND BROWSER VERIFIED** |
| Attendance (office/geofence check-in) bug | **FIXED AND BROWSER VERIFIED (local emulators, 10/10 incl. the late-check-in E-matrix)** — staging E2E still BLOCKED |
| Firestore realtime LIST permission-denied | **RESOLVED AS EMULATOR ARTIFACT** (deterministic repro; production inferred-unaffected, not live-observed) |
| Final staging browser E2E | **BLOCKED** (no approved staging project) |
| Reconciliation UI | **FEATURE GAP** (no view exists; service/rules/hook only) |

---

## 1. Registration / invite — browser verification results (DONE)

Executed with the CDP + headless-Edge + Vite harness via `npm run test:employee-lifecycle` against local Auth+Firestore emulators.

**Browser-confirmed PASS (real UI actions):**
1. Admin login via the login form (`/login` → `/apps`).
2. Hire employee through `HireEmployeeModal` on `/people` → a real `companies/acme-co/invites/{token}` doc created.
3. Accept invite via `/invite/:token` (set password → `acceptInvite`) → auto-login.
4. Authenticated UID maps to `users/{uid}` with correct `companyId=acme-co`, `role=employee`.
5. Employee business record associated by identity (claim-by-email).

Suite finished **12/15 steps passed, exit 1**. The 3 failures are the attendance steps only (see §3); all registration/invite steps passed. This is why the registration bug is marked FIXED AND BROWSER VERIFIED.

## 2. Attendance — backend / emulator test results (DONE)

All green, exit 0. These prove the write path and authz, but are **not** browser verification.

| Suite | Command | Result |
|---|---|---|
| Attendance config parity — Firestore **write path** integration | `npm run test:attendance-config-parity` | **6/6** |
| Attendance authz (rules) | `npm run test:attendance-authz` | **32/32** |
| Attendance `captureAttendanceGeo` client branches (tsx) | `npm run test:attendance-parity` | **7/7** |
| Attendance check-in payload (tsx) | `npm run test:attendance-payload` | **8/8** |
| Firestore rules (incl. 7 reconcile cases) | `npm run test:rules` | **150/150** |
| Registration visibility (auth+firestore integration) | `npm run test:registration-visibility` | **13/13** |
| map-user profile (tsx) | `npm run test:map-user` | **5/5** |
| invite delivery (tsx) | `npm run test:invite-delivery` | **7/7** |
| TypeScript build | `npx tsc -b` | **exit 0** |
| Lint | `npm run lint` | **0 errors**, 376 pre-existing warnings |

Key backend facts already established:
- `test-attendance-config-parity.mjs` seeds three employees (office geofence+assigned location, remote/flexible, geofence-without-location) and asserts each one's `PeopleService.checkIn` sequence (settings GET → attendance where-date `getDocs` → `addDoc` punch → own employee `updateDoc`) is authorized and persisted by the SERVER. Proves the "unassigned geofence cannot check in" block is purely **client-side**, not a permissions defect.
- The `addDoc` attendance write uses **one-shot filtered `getDocs`**, which the emulator services correctly. The browser flow uses **realtime `onSnapshot` LISTs**, which the emulator does not (see §4).

## 3. Attendance — browser scenarios: NOW VERIFIED on local emulators (DONE 2026-10-31)

Dedicated deterministic harness built for this purpose: `scripts/test-attendance-lifecycle-browser.mjs`
→ `npm run test:attendance-lifecycle-browser` (Edge CDP 9779, Vite 5176, project `test-attendance-lifecycle`).
Result: **5/5 scenarios PASS, exit 0.** Artifacts in `tmp/attendance-lifecycle/` (screenshots, `console.log`, `network.log`, `results.json`, `run-4.log`).

It seeds **three independently configured employees in one company** (`e-office`, `e-remote`, `e-noassign`), plus a real `work_locations/hq` (24.7136, 46.6753 / 500 m), then drives the **real UI** for each. Every wait is condition-based (DOM state or emulator document state), never a fixed sleep.

| Scenario | Classification | Observed evidence |
|---|---|---|
| **A. Office geofence** — GPS granted + pinned at the geofence centre | **BROWSER VERIFIED** | UI play-click → toast `"Shift started!"`; record `7xVsvQF5hnbmrNHsrp63` with `checkInLat/Lng=24.7136/46.6753`, `checkInLocationId=hq`, `checkInDistanceMeters=0`; **refresh restored the SAME open session id**; stop → daily-report modal → submit → `checkOut=2026-10-31T13:39:46.314Z`, `totalHours≈0.0024`, no open session left, UI back to off-duty |
| **B. Remote / flexible** — GPS permission **DENIED** | **BROWSER VERIFIED** | Product behavior **derived, not assumed**: `workType:"remote"`/`allowRemoteTimer` + `attendanceCheckMode:"flexible"` ⇒ check-in **allowed with NO geo**; record `TknlxJu1By7ltjtK955n` persisted with geo fields absent (`{}`); refresh restored it; check-out persisted |
| **C. Geofence with NO assigned location — EN** | **BROWSER VERIFIED** | Exact shipped copy: `"No attendance location is assigned to you. Ask your manager to set it."`; **0 new attendance records**; `isShiftLoading` cleared, play control usable again; console shows the intended `Check-in error: AttendanceGeoError: No attendance location assigned` |
| **C. Same, AR (RTL)** | **BROWSER VERIFIED** | `dir=rtl`, exact copy `"لم يُعيَّن لك موقع حضور. اطلب من مديرك تحديد المكان."`; still 0 records, UI usable |
| **D. Tenant isolation / no privilege** | **BROWSER VERIFIED (scope-limited)** | 3 employees isolated in `acme-co`, no cross-project documents, all employees `role=employee`; the rules-enforced reads behind every step succeeded only inside the tenant |

Zero `permission-denied`, zero `Uncaught Error in snapshot listener`, zero `evaluation error` lines in the whole run — the §4 conversations LIST artifact did **not** reproduce on `/tasks` for these employee sessions.

Two behaviors discovered that a next session should know:
- A **blocking `LateCheckInAlertModal`** ("Got it") appears after check-in when the punch is classified late. **UPDATED (hardening run, 2026-10-31 later session):** the classification trigger is now fully mapped — see §3a. The previous "no schedule ⇒ late" observation was actually the **default company cutoff `11:30`** (`DEFAULT_ATTENDANCE_LATE_POLICY`) being passed at an afternoon test hour; a missing schedule NEVER produces lateness by itself (proven by scenario E3).
- Check-in fires an **outbound `https://api.emailjs.com/api/v1.0/email/send`** attempt (attendance notification to the company admin). It fails in the test env (`[AttendanceNotification] Failed email to att_admin@acme.test`). This is non-Firebase egress carrying only test data, but it is NOT gated by `VITE_DISABLE_EMAIL_DELIVERY` (that flag only covers invite delivery) — see §10.

## 3a. LateCheckInAlertModal hardening run — 10/10 (DONE 2026-10-31)

The same harness (`npm run test:attendance-lifecycle-browser`, project `test-attendance-lifecycle`) was extended with 5 punctuality employees + a deterministic E-matrix (fixtures: 2 active `hr_schedule_assignments` with UTC-anchored starts derived from the run clock, 1 employee with NO assignment; `settings/attendance` cutoff flipped per scenario to isolate the two bases). Final verified run: **`tmp/attendance-lifecycle/run-9.log` — 10/10, exit 0** (A–D unchanged, all still green).

Product facts established (all browser-observed, not inferred):
- **Two independent lateness bases exist.** LEGACY = `settings/attendance.lateCutoffTime` (default `11:30`) → `status/lateMinutes/deductionMinutes` — and it is the ONLY trigger of the modal (`attendance.store` reads `res.data.lateMinutes`). SCHEDULE = the frozen `hr_schedule_assignments` snapshot (start + `graceMinutes`, in the schedule's tz, `punctualityForCheckIn`) — recorded on the row but **never consulted by the alert**.
- **E1** on-time vs assigned shift ⇒ `present`, no snapshot lateness, silent. **E2** 48m past schedule start+grace ⇒ snapshot carries `rawLateMinutes=48/countable=48` but legacy says `present` and **no alert** (finding: alert ignores schedule). **E3** NO assignment ⇒ `schedule` absent, `present`, silent — **missing schedule is never classified late**; the documented fallback is the company cutoff. **E4** cutoff-late ⇒ modal opens exactly once (`titleHits=1`, blocking), copy minutes == record minutes, tracker shows only stop (no duplicate check-in possible), ack preserves the session id, refresh does NOT re-alert or re-classify, check-out lands on the same doc. **E5** `lateThreshold=1` ⇒ deducted copy, minutes match.
- **Harness-only fixes needed to see the truth** (no product change): (1) modal sampled before the store's post-check-in `syncWithDb` resolves → false "no alert" (run-5); (2) HeroUI exit animation → "modal still visible after ack" false failure (run-7); (3) header renders the tracker twice (mobile Popover) → `querySelector('button svg.lucide-square')` hit the hidden copy (run-7). All three were fixed with condition-based waits + visibility-aware selectors in `scripts/test-attendance-lifecycle-browser.mjs`.
- **EmailJS isolation (proposed, NOT implemented — awaiting approval):** `attendance-notifications.service.ts` `dispatchNotifications` has the same courtesy-notification semantics as invites but no kill switch. Minimal change: one guard before the EmailJS block — `if ((import.meta.env.VITE_DISABLE_EMAIL_DELIVERY as string) === "true") { console.warn(…); return; }` — in-app Firestore notifications still written, zero `api.emailjs.com` egress in tests. Same unguarded pattern also exists in `task-notifications.service.ts` and `otp.service.ts` (separate, out of attendance scope).

Regression battery re-run after the harness changes (all against this working tree):
`test:attendance-lifecycle-browser` **10/10** · `test:attendance-authz` **32/32** · `test:rules` **150/150** · `test:registration-visibility` **13/13** · `npx tsc -b` **exit 0** · `npm run lint` **0 errors / 376 pre-existing warnings**. Logs: `tmp/hardening-*.log`, `tmp/attendance-hardening-*.log`.

**Historical note** (why the previous harness was insufficient): `npm run test:employee-lifecycle` finished 12/15 with steps 9–11 timing out. It drives a **single flexible employee with no seeded `work_locations`**, so it never exercised the three configurations above. Its failure was UI/harness coverage, not a permissions block.

## 3b. Canonical attendance lateness policy — IMPLEMENTED (DONE 2026-10-31)

Approved follow-up to §3a: the two bases were unified into ONE canonical policy, implemented tests-first in the service/lib layer only.

**Contract now enforced everywhere** (`src/features/people/lib/work-schedule-rules.ts` → `canonicalLateness`, `effectivePunchTimezone`, `zonedDayKeyOf`, `zonedMonthKeyOf`, `cutoffLateMinutes`, `FALLBACK_TIMEZONE`):
- A resolved assignment is **authoritative**: `lateMinutes` = snapshot `countableLateMinutes`, measured in the **schedule's own IANA timezone**. The company cutoff can neither add nor remove lateness for a scheduled punch (browser scenario **E6** pins `lateCutoffTime=00:00` against a punctual shift ⇒ `present`, `lateMinutes=0`, no alert, no deduction).
- No assignment / resolution failure ⇒ the **documented fallback basis** `settings/attendance.lateCutoffTime` (`cutoffLateMinutes`), evaluated in the effective timezone — never the browser's — and schedule absence itself never produces lateness (**E3**).
- One effective timezone drives **punch date, month key, late-occurrence counting, schedule day-key/cross-day probing and reporting-period alignment**. `resolveScheduleSnapshotForPunch` uses a deterministic two-pass probe (fallback-zone probe day → schedule-zone day → re-probe only if the day differs) which also removed the false `crossDayCheckIn` that zeroed early-morning non-UTC punches.
- Fields keep their distinct meanings — `rawLateMinutes` (wall-clock lateness, snapshot only), `excusedLateMinutes` (approved-leave carve-out), `countableLateMinutes`, row `lateMinutes` (canonical occurrence), `deductionMinutes` (occurrence ≥ `lateThreshold`), `graceMinutes`/`lateThreshold` (unchanged math; only the clock changed).
- Consumers agree **by construction**: the store alert, Timesheets day-bucketing/status, the employee-profile month window and `WorkScheduleService.punchCountableMinutes`/`evaluateMonth` all read the same canonical persisted values. `correctAttendance` recomputes through the same helper (`canonicalForCorrection`, with `excludeAttendanceId`) instead of the old `countable > 0 || rawLate > 0` rule; the browser-local `computeLateMinutes` was deleted.

**Timezone decision (audited, not invented):** the product has **no company-level timezone field** — the only timezone setting is `ScheduleValues.timezone` (schedule-scoped). The only documented project fallback is `"UTC"` (previously `values.timezone || "UTC"` inside `punctualityForCheckIn`). Therefore: schedule tz → `FALLBACK_TIMEZONE="UTC"`. `Asia/Riyadh` is NOT hardcoded anywhere in the policy (it remains only a schedule seed/UI default), and an invalid tz string is sanitized to the fallback instead of throwing.

**Verification (all local emulators, nothing committed):** `scripts/test-attendance-lateness-unit.ts` (new, deterministic injected epochs + explicit IANA zones, 12 audit scenarios) **47/47** · `npm run test:attendance-lifecycle-browser` **11/11** (A–D, E1–E6; run log `tmp/lateness-browser-run1.log`) · `test:schedule-unit` **96/96** · `test:attendance-payload` **8/8** · `test:attendance-config-parity` **6/6** · `test:attendance-authz` **32/32** · `test:rules` **150/150** · `test:registration-visibility` **13/13** · `npx tsc -b` **exit 0** · `npm run lint` **0 errors / 377 warnings** (one warning at `EmployeeProfilePage` monthStats is the pre-existing `Date`-impurity pattern relocated; it already existed at the same spot as `new Date()`).

**Boundaries respected / remaining limitations:** no Firestore Rules change, no schema/migration, no historical backfill (legacy rows keep their stored basis — `punchCountableMinutes` still prefers `schedule.countable` and falls back to `lateMinutes`), no posted deduction-case mutation (recomputation can never reopen a posted case; asserted in S12), no production Firebase access. `dayKeyOf` for approved-leave windows still evaluates in UTC (leave semantics out of this scope), and the lateness report's *default* period key remains UTC-derived; both are noted, not silently changed. A real company-timezone setting (if product wants one) is a separate, approval-gated schema decision.

## 4. Firestore realtime LIST permission-denied — RESOLVED AS EMULATOR ARTIFACT (deterministic repro)

> Re-investigated 2026-10-31 with a dedicated minimal repro: `npm run test:realtime-list-gate` (`scripts/test-realtime-list-gate.mjs`) — **8/8, exit 0**, loads `firestore.rules` verbatim, weakens nothing.

During the browser check-in step the ONLY repeating error is:

```
Uncaught Error in snapshot listener: permission-denied:
  evaluation error at L362:24 for 'list' @ L362, false for 'list' @ L720,
  false for 'list' @ L767, false for 'list' @ L362, ...
```

Repro findings (each directly observed):
- **`employees` LIST succeeds** in the emulator via BOTH `getDocs` AND `onSnapshot` (gate = `belongsToCompany()` reading `users/{uid}` through `get()`, never `resource.data`). So the check-in reads are NOT blocked — in-browser `PeopleService:getEmployees/:getAttendance/:getEmployee/:getWorkLocations` all log `Completed`.
- **The failing listener is the `conversations` LIST** (chat): its rule at **L362 references `resource.data.get('type'/...)`**. A rules-engine LIST gate that reads the listed document cannot be statically evaluated, so the emulator throws `... for 'list'`.
- **Not realtime-vs-one-shot:** the identical **one-shot `getDocs`** over the conversations query fails with the exact same message — proving it is the LIST + `resource.data` rule class, not `onSnapshot`.
- **Rule logic is correct:** the same membership resolves fine for a **single-doc GET** (member → allowed; non-member → denied). This is the officially documented `array-contains` secure pattern, which production Firestore evaluates **per candidate document** — so it does not reproduce there.

**Conclusion:** the permission-denied is a **confirmed, deterministic emulator limitation** on `resource`-referencing LIST rules, **not** a permissions defect and **not** the reason browser check-in steps 9–11 did not persist (see §3). **Caveat (honest):** production being unaffected is *inferred* from documented LIST-evaluation semantics + the working single-GET, not *observed* on a live backend (staging remains BLOCKED per §5–§6). No rule was weakened to force any pass.

## 5. Evidence that NO staging Firebase project is configured

Read-only inspection (nothing was created or mutated):

- `.firebaserc`: only `default` → `d-arrow-buisiness` (the production project). No `staging` alias.
- `.env`: `VITE_FIREBASE_PROJECT_ID=d-arrow-buisiness` (production). `.env.example` is a placeholder.
- Grep across `package.json`, `firebase.json`, `.firebaserc`, `src/**`, `scripts/**`: **no** `staging` and **no** hosting config.
- `firebase login:list` → `No authorized accounts, run "firebase login"`.
- `firebase projects:list` → `Error: Failed to authenticate, have you run firebase login?`
- Conclusion: no approved staging project is discoverable or reachable; the only known project is production, which is out of scope for this verification-only task.

## 6. Exact staging prerequisites to resume

To unblock §3 and §4, obtain authorization and set up a dedicated staging project, then resume:

1. **Project + services:** create/target `d-arrow-staging` (or approved ID) with Cloud Firestore (native) and **Email/Password auth enabled**; deploy the repo's `firestore.rules` + `firestore.indexes.json` to it.
2. **CLI auth:** `firebase login` with an account that owns only the staging project (currently no authorized account).
3. **Alias, production-safe:** add `"staging": "<staging-project-id>"` to `.firebaserc`; leave `default` unchanged so no command accidentally targets production.
4. **App env for a REAL backend browser run:** a dedicated env (e.g. `.env.staging`) with `VITE_FIREBASE_PROJECT_ID=<staging-project-id>` and matching `VITE_FIREBASE_API_KEY / AUTH_DOMAIN / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID`, and **`VITE_USE_FIREBASE_EMULATOR` unset/false** so Vite connects to staging, not the emulator. (Note: the existing CDP harness hard-codes emulator env vars in `scripts/test-employee-lifecycle-browser.mjs`; a staging run must launch Vite against real staging config instead.)
5. **Isolated test data (staging only, never production):** a test company + three employee records with linked test auth accounts:
   - office: `attendanceCheckMode: geofence` + an **active assigned `work_locations` doc** (lat/lng/radius, employee assigned to it);
   - remote/flexible: remote-authorized config (`workType: remote` / `allowRemoteTimer`);
   - geofence without assigned location (`attendanceLocationIds: []`).
6. **Geolocation control in the harness:** CDP `Emulation.setGeolocationOverride` with in-range coords for the office scenario; permission-denied / no override for remote and unassigned scenarios.

Before any mutation, confirm the connected project ID equals the approved staging ID. If staging is unavailable, remain BLOCKED; do **not** substitute production.

## 7. Missing reconciliation UI — separate feature gap

- Implemented at data/service layer only: `UsersService.listUnassignedAccounts` / `assignUnassignedAccount` (`src/features/users/api/users.service.ts`), the `useUnassignedAccounts` react-query hook (`src/features/users/hooks/use-users.ts`, gated to `role === "super_admin"`), and the reconcile list/update branches in `firestore.rules` (verified by `test:rules` reconcile cases + `test:registration-visibility`).
- **No UI view exists:** `useUnassignedAccounts` has **zero** UI consumers; the router's only "reconciliation" screen is the unrelated billing `BankReconciliationPage`.
- Consequence: orphan-visibility and ordinary-employee-denied reconciliation cannot be browser-verified until a view is built. **Do not** fabricate a reconciliation view under a verification-only task — record it as this feature gap.

## 8. Modified and untracked files

Tracked (modified):
- `firestore.rules`
- `package.json` (added `test:registration-visibility`, `test:attendance-config-parity`, `test:realtime-list-gate`, `test:attendance-lifecycle-browser` scripts)
- `scripts/test-firestore-rules.mjs`
- `src/features/auth/api/auth.service.ts`
- `src/features/auth/types/auth.types.ts`
- `src/features/auth/utils/map-user.ts`
- `src/features/people/types/people.types.ts`
- `src/features/people/utils/attendance-geo-check.ts`
- `src/features/users/api/users.service.ts`
- `src/features/users/hooks/use-users.ts`
- `tmp/employee-lifecycle/*.png` (12 browser screenshots)

Untracked (new tests / scratch / docs):
- `scripts/test-registration-visibility.mjs`
- `scripts/test-attendance-config-parity.mjs`
- `scripts/test-attendance-config-parity.ts`
- `scripts/test-map-user-profile.ts`
- `scripts/test-realtime-list-gate.mjs` (Phase-3 minimal repro)
- `scripts/test-attendance-lifecycle-browser.mjs` (**attendance browser E2E — 3 configurations, 5/5 PASS**)
- `docs/implementation/registration-attendance-checkpoint.md` (this document)
- `scratch/geo-repro.mjs`
- `tmp/attendance-lifecycle/` (11 screenshots + `console.log`, `network.log`, `results.json`, `run-1..4.log`)

(The bug-fix source changes — `auth.service.ts` empty-tenant login provisioning, `map-user.ts` no-fabricated-tenant, `users.service.ts`/`use-users.ts` reconciliation, `attendance-geo-check.ts` remote-authorized geofence gate, `firestore.rules` reconcile branches — are pre-existing uncommitted work in this tree and are covered by the §2 suites. This checkpoint task modified only this document.)

## 9. Git status & no-commit confirmation

- Branch `main`; `git status -sb` = `## main...origin/main` → **0 commits ahead**, in sync with remote.
- Last commit `2e98588 (HEAD -> main, origin/main, origin/HEAD) fix logo` — not created by this work.
- All changes remain **uncommitted in the working tree**; screenshots and prior scratch/test artifacts preserved.
- **No** commits, pushes, deployments, `git reset`, `git clean`, `npm ci`, or Firebase/production configuration changes were performed.

## 10. Local-E2E safety model + Firebase-emulator facts (reusable)

Established by the attendance browser run and the three failed-start iterations that preceded it:

- **The Firestore emulator's REST v1 API ENFORCES `firestore.rules`.** Unauthenticated
  seeding/verification is rejected (`false for 'list' @ L317`), so a harness must attach a real
  Auth-emulator ID token of a legitimately authorized admin. Rules are satisfied, never bypassed
  (`Authorization: Bearer <adminIdToken>`), and `companies/{id}` writes only work after that admin's
  `users/{uid}` profile exists.
- **`belongsToCompany()` throws an *evaluation error* (not a clean `false`) when the caller's
  `users/{uid}` doc is missing**, because `get(/users/$(uid)).data` is `null` and the rule then
  dereferences it. Any rules-enforced probe issued before the actor profile exists fails as
  `evaluation error at L317:22` — so "is the database empty?" cannot be probed that way. The
  durable guarantee used instead: `firebase.json` sets **no `persist`** and no import/export, so
  `emulators:exec` always starts an empty in-memory database.
- **Emulator routing:** `src/lib/firebase.ts` only calls `connectAuthEmulator`/
  `connectFirestoreEmulator`/`connectStorageEmulator` when `VITE_USE_FIREBASE_EMULATOR === "true"`,
  and Vite gives inline `process.env` priority over `.env`, so the harness env block fully controls
  the target. The config's `projectId` string can still be the production ID while every *connection*
  is localhost — hence the harness asserts actual network egress rather than config strings.
- **Egress proof is measured, not assumed:** the harness records every
  `Network.requestWillBeSent`/`webSocketCreated` URL and hard-aborts (exit 2) if any matches a real
  Firebase host (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `*.firebaseio.com`,
  `firebaseinstallations`, `d-arrow-buisiness`, google-analytics). Verified outcome: 7548 requests,
  **0 Firebase-production endpoints**; all Auth/Firestore traffic to `127.0.0.1:9099`/`:8080`.
  Non-local requests observed were only Google Fonts (cosmetic) and one EmailJS notification
  attempt (§3) — neither is a Firebase data path.

---

## Resume checklist for the next session (do NOT redo the DONE items)

1. §1 registration browser: **done** — no re-run needed unless rules/env changed.
2. §2 attendance backend/emulator: **done** — re-run only after touching attendance/rules code.
3. §3/§3a attendance browser: **DONE on local emulators (10/10 incl. the late-check-in E-matrix, `npm run test:attendance-lifecycle-browser`, last verified run `tmp/attendance-lifecycle/run-9.log`)** — re-run only after touching attendance/geo/rules code. A real-backend/staging run is still outstanding (§6) and is the only thing that can upgrade "local emulator verified" to "verified against production Firestore".
4. §4 realtime LIST permission-denied: **resolved locally as an emulator artifact** (deterministic repro, §4) and it did **not** reproduce in the attendance browser run. Confirming it is production-harmless still needs a staging run (§6).
5. §6 staging: **blocked** — obtain authorization + config; verify project ID before any mutation.
6. §7 reconciliation UI: **feature gap** — out of scope for verification-only; raise separately if a view is desired.
