# PHASE 1 REPORT — Final Architecture and Migration Design

> **Phase:** 1 of 9 · **Status:** APPROVED & CLOSED 2026-11-11 — owner gate decisions: approve design set + report; confirm D1 (`backend/` same-repo), D5 (JSONB module records), and the auth bridge + separately-approved cutover; start Phase 2
> **Directive:** Master Platform Transformation & Integration Directive (2026-11-11)
> **Date:** 2026-11-11 · **Executor:** Transformation agent
> Facts below are marked **[VERIFIED]** (directly observed in this session) or **[ASSESSMENT]** (judgment/recommendation).
> Deliverable: the six-document design set in `docs/transformation/phase-1/` (summarized in §2).

---

## 1. What Was Inspected

All analysis was performed on the **post-pull, post-WIP-landing tree** — `main` @ `6b38c3b` (merge `c20700c` + the landed invite/HR work) — so the design describes the exact current source, not a stale snapshot.

**Remote merge (authorized Phase 0 gate decision) [VERIFIED]**

| Item | Finding |
|---|---|
| Merge | `c20700c` = merge of `origin/main` (`dffbf82`, `0db431f`, `73db806`) — clean `ort` merge, zero conflict with the owner's WIP |
| Files touched | `README.md` (2 lines), `src/app/App.tsx` (+11 — outer `<Suspense>` spinner wrapper), `src/app/router.tsx` (153-line diff) |
| Router diff audit | Full diff read: a pure **code-splitting rework** — static page imports replaced with `React.lazy()`; route table, guards, and redirect behavior unchanged |
| Branch state after | `main` **ahead 5, behind 0** (remote history had been force-rewritten twice; the merge incorporates it, so a normal non-force push is now possible — owner decision, §8.3) |

**Frontend architecture [VERIFIED]**

| Area | Finding |
|---|---|
| Feature domains | 23 under `src/features/**`: accounting, activities, admin, agency, assistant, auth, automation, billing, chat, companies, crm, custom-modules, facilities, marketing, meetings, notifications, people, portals, projects, real-estate, school, tasks, users |
| Activities | 8 in the registry: `PROJECTS` (core, ungated) + 7 activity-owned verticals — `REAL_ESTATE_MANAGEMENT`, `REAL_ESTATE_BROKERAGE`, `FACILITIES_MANAGEMENT`, `REAL_ESTATE_DEVELOPMENT`, `MARKETING_AGENCY`, `MEDICAL_CLINIC`, `SCHOOL_MANAGEMENT` |
| Custom Module Engine | `src/features/custom-modules/lib/module-engine.ts` (+ `module-templates.ts`, `module-ui-helpers.ts`) — verified export contract: module-key grammar, definition validation/sanitization, per-type field coercion, record payload contract (**mass-assignment rejection** via `splitRecordInput`), lifecycle transitions (`canMoveStage`/`isTerminalStage`), access resolution (`canPerformModuleAction` = permission atom **AND** role grant), list query (search/status/archived/sort/pagination), and activity-encoding collection naming (`mod_<activity>_rec_<key>`) |
| Auth (client) | Firebase SDK in `src/features/auth/api/auth.service.ts` / `otp.service.ts`: email/password, Google popup, `getIdToken`, custom claims, OTP resets (`otpResets` collection) |
| RBAC model | 7 roles (`UserRole`); permission atoms in `src/lib/permissions/index.ts` (70 atoms — corrected at Phase 2 start, 2026-11-11, by direct count; this report originally recorded "181 per Phase One evidence", an overcount); portal sub-roles (Tasks/CRM/People/Billing) in `sub-roles.ts`; effective resolution (role → sub-role → per-user `customPermissions`) in `effective-permissions.ts`; `portalAccess` subset logic in `portal-access.ts`; `INVITABLE_ROLES` invite policy in `role-assignment.ts` (landed this session, `6b38c3b`) |
| User document shape | `onboardingStatus`, `portalAccess`, `portalSubRoles`, `customPermissions`, `branchId`, `workLocationId`, `countryScope`, `companyId`/`companyName` (`auth.types.ts`) |
| Integration seam | `src/lib/api-client.ts` with `baseURL = API_BASE_URL`; `src/lib/constants.ts`: `API_BASE_URL = VITE_API_BASE_URL || "/api"`; `ApiResponse` envelope in `src/types/api.types.ts` — **a REST seam already exists** for the frontend integration phase |

**Data surface — `firestore.rules` (73 KB) [VERIFIED]**

- **29 named collections**: `users, invites, otpResets, publicInvoiceShares, audit_logs, companies, client_reports, daily_reports, conversations, messages, journals, payments, vouchers, payroll_payments, employees, invoices, bills, rem_leases, rem_rent_installments, rem_rent_payments, rem_security_deposits, rem_property_expenses, hr_schedule_templates, hr_schedule_assignments, hr_lateness_policies, hr_deduction_cases, attendance, settings, module_definitions`
- Wildcard matches (`/{collection}/{docId}`, `/{nested=**}`) covering `mod_*_rec_*` engine records and domain-prefixed collections (`rem_`, `fm_`, `mkt_`, `cln_`, `sch_`, …)
- The invite rule family was read as the exact contract the landed WIP mirrors (`INVITABLE_ROLES`, admin/HR/platform-admin constraints, tenant isolation)

**Project B — architectural reference only [VERIFIED]**

- `CustomModules~/prisma/schema.prisma`: 17 models (`User, RefreshToken, Activity, BusinessTemplate, BusinessTemplateModule, Module, ActivityModule, OrganizationModule, Organization, OrganizationMember, Branch, Subscription, Role, Permission, RolePermission, OrganizationSettings, AuditLog`). Project B contributes **concepts** (catalog, dependency guard, templates, provisioning, subscriptions, audit) — never code or runtime (Directive §1/§4).

## 2. What Was Implemented

**Phase 1 = design documents only. No application source file was created, modified, or deleted by Phase 1.** The deliverable is the six-document design set in `docs/transformation/phase-1/`:

| Doc | Contents |
|---|---|
| `01-target-architecture.md` | NestJS modular monolith: system context (SPA → REST/WS → NestJS → Prisma → PostgreSQL; Firebase retired per-domain), repository layout **D1** (`backend/` in the same repo), platform-core + business module map absorbing the verified feature domains, DDD dependency rules, request pipeline (validation → auth → tenant → permissions → entitlement → audit), API conventions (`/api/v1`, `ApiResponse` envelope, stable error codes, text PKs **D2**), WS push-only **D3**, config/health/observability, testing architecture |
| `02-database-schema.md` | Prisma design: conventions (text PKs preserving Firestore ids, company-scoped uniques, soft delete, integer minor units), identity & tenancy (`User`, `Company`, `CompanyMembership` **D7**, Branch/Department), DB-backed RBAC **D8**, `Invitation`, sessions **D4**/**D9**, subscriptions & entitlements, module-platform tables (nine concerns), `ModuleRecord` JSONB **D5** + relations, audit & migration bookkeeping, tenant-isolation enforcement, complete Firestore→tables surface mapping |
| `03-rbac-and-tenancy.md` | The verified current model as the preservation contract; target guard chain; `firestore.rules` → backend conformance mapping per rule family (invites, HR/attendance, billing, `rem_*`, chat, public shares, module wildcards, domain prefixes, sensitive verticals); conformance test strategy (the invite suites become API-level authz tests — the per-domain acceptance gate); frontend impact (guards remain UX affordances, not security boundaries) |
| `04-custom-module-platform.md` | One runtime engine (Directive §4); the nine separated concerns mapped to concrete tables; Project B concept mapping (`OrganizationModule`→`CompanyModule`, templates as definition bundles, subscriptions, provisioning); company provisioning/onboarding transaction with dependency guard; definition lifecycle (draft→published→deprecated), version pinning & explicit upgrades; module API surface behind `EntitlementGuard` |
| `05-migration-plan.md` | Wave sequencing **W0–W7** (identity bridge + invitations first → shared modules → HR cluster → chat → accounting → verticals → custom modules → auth cutover last, separately approved); per-domain migration & reconciliation pattern (export → transform → staged import → count+checksum reconciliation → flag-gated cutover → retirement); Firebase-token bridge and forced-password cutover; frontend service-swap pattern; risk table |
| `06-phase2-task-specs.md` | Phase 2 tasks T2.1–T2.4 in Directive §9 format (objective, scope, files, dependencies, risks, expected behavior, acceptance criteria, tests): NestJS scaffold, Prisma core-identity migration + seed, test harness, pipeline skeletons; Phase 2 exit gate |

**Authorized Phase 0 close-out actions executed at the start of this session** (owner gate decisions 2026-11-11; each landed as its own scoped commit — these are not Phase 1 design changes):
1. Merge `c20700c` — pull of the 3 remote commits (audit in §1).
2. Approval bookkeeping `d76ab72` — README phase table + Phase 0 report status stamp (2 files, docs only).
3. Invite/HR WIP landing `6b38c3b` — **after** both emulator suites passed (§6/§7): 14 files, +850/−39, the owner-authored invite role-policy work, committed exactly as it existed in the working tree.

## 3. Why the Decisions Were Made

| Decision | Rationale |
|---|---|
| **D1** — backend at `backend/` in the same repo | Atomic cross-stack changes (DTO + frontend service swap in one commit); single history; no monorepo-workspace migration risk in a repo carrying live work; `backend/` is isolated enough to never disturb frontend builds |
| **D2** — text PKs preserving Firestore document ids | Invite tokens, public share links, and cross-document references keep working after migration; reconciliation is diffable id-for-id; new rows use `cuid()` |
| **D3** — WS push-only; REST is the write path | One auditable write path per domain; no dual-write consistency window during migration; realtime UX preserved via push |
| **D4** — argon2id password hashing | Memory-hard, current OWASP first-line recommendation for new systems |
| **D5** — JSONB generic `ModuleRecord` table | Module fields are definition **data**, not DDL; the engine must stay the single runtime without per-tenant generated tables (Directive §4 bans uncontrolled dynamic structure); GIN indexes cover engine search; documented escape hatch — promote high-volume verticals to native tables later behind the same service interface |
| **D6** — nullable `passwordHash` during the bridge | Firebase exposes no password hashes; the column fills at cutover via forced password-set; no password is ever guessed, defaulted, or migrated |
| **D7** — multi-company-ready membership table | Migration creates exactly one membership row per user (behavior unchanged today); the SaaS multi-company future then needs no second identity migration |
| **D8** — permission atoms code-defined, synced to DB with checksum | The atom vocabulary stays PR-reviewable; grants are queryable data; a startup checksum detects drift between manifest and DB |
| **D9** — refresh tokens stored hashed with rotation families | Database-theft containment; replay of a rotated token revokes its family |
| Invitations first (W0) | Smallest, most security-critical domain; the just-landed WIP + both passing emulator suites are a ready conformance baseline; memberships/invites unblock every later wave |
| Auth cutover last + separately approved | Directive §7 requires the auth migration to be separately planned and approved; the token bridge keeps Firebase login working per-domain until then |

## 4. Files Created or Modified

**Created (documentation — committed together with this report):**
- `docs/transformation/phase-1/01-target-architecture.md`
- `docs/transformation/phase-1/02-database-schema.md`
- `docs/transformation/phase-1/03-rbac-and-tenancy.md`
- `docs/transformation/phase-1/04-custom-module-platform.md`
- `docs/transformation/phase-1/05-migration-plan.md`
- `docs/transformation/phase-1/06-phase2-task-specs.md`
- `docs/transformation/reports/PHASE-1-REPORT.md` (this file)

**Modified (documentation):**
- `docs/transformation/README.md` — phase table (Phase 1 → complete/awaiting approval) + phase-1 design-set index

**Source code: NONE created, modified, or deleted by Phase 1.** `firestore.rules`, `firebase.json`, any `src/**`, any `prisma/**`: untouched. Production Firebase: untouched (all suites emulator-only, §6).

**Session commits inside the Phase 1 window** (all authorized Phase 0 close-out actions, each scoped; hashes also recorded in `_transformation-backups\phase-0\MANIFEST.md`):
- `c20700c` — merge of `origin/main` (3 files: README, App.tsx, router.tsx)
- `d76ab72` — Phase 0 approval bookkeeping (2 docs files)
- `6b38c3b` — invite role-policy WIP (14 files, +850/−39)
- Phase 1 docs commit — this report + the six design docs + README (hash recorded in the MANIFEST; a commit cannot embed its own hash)

## 5. Files Deleted

None. No deletion was authorized or performed. **[VERIFIED]**

## 6. Tests Executed

| # | Command | Scope | Result |
|---|---|---|---|
| 1 | `npm run test:invite-role-policy` | Re-run **after** the WIP landing, on the committed tree (`6b38c3b`) | **PASS** |
| 2 | `npm run test:invites-rules` | Firestore emulator (`@firebase/rules-unit-testing`), executed while the working tree contained **exactly** the 14 files then committed unchanged as `6b38c3b` | **PASS — 8/8 scenarios** |
| 3 | `npm run test:invites-admin-browser` | Auth + Firestore emulators, full vite build, headless Edge E2E through the real UI (same tree as #2) | **PASS — 2/2 scenarios** |
| 4 | `npm run build` | Final tree: merge `c20700c` + landed WIP `6b38c3b` | see §7 |

**Safety notes [VERIFIED]:** both emulator suites were read line-by-line before running and verified emulator-only (hard-coded `127.0.0.1` endpoints; the browser suite fails the run on any non-local Firebase request — it reported **zero external requests**). Production Firebase was never contacted. The suites ran sequentially (shared emulator ports 8080/9099).

**Not re-run this phase:** `test:engine-unit` (19/19) and `test:activity-routing` (23/23) passed in Phase 0 and their subjects are unchanged since — the merge touched only `App.tsx`/`router.tsx` import style and the WIP touched none of them; the full `tsc -b` in §7 recompiles everything they import.

## 7. Actual Test Results

- **Test 1 (unit, committed tree):** `PASS invite role policy: UI, service, and built-in permission policy agree` — exact output.
- **Test 2 (rules conformance, 8/8):** ① company admin creates allowed invite roles ② company admin lists only its company's pending invites ③ company admin revokes a same-company pending invitation ④ restricted and invalid invitation roles are denied by rules ⑤ platform admin can create, list, and revoke an allowed invite ⑥ same-company employee cannot create, list, or revoke invites ⑦ Global HR can manage only employee/viewer invitations ⑧ tenant A admin cannot list, update, or revoke tenant B invitations. The `PERMISSION_DENIED` log lines in the output are the negative scenarios' `assertFails` cases being **correctly denied**.
- **Test 3 (browser E2E, 2/2):** login against the auth emulator → Employee Management page + roster loaded → invite modal role policy honored → allowed Viewer invitation created and persisted as a pending row → admin revoked it and the refreshed list excludes it → **zero external Firebase requests and zero invite-authorization errors**.
- **Build (`npm run build` = lucide type generation + `tsc -b` + `vite build`):** **PASS.** `tsc -b` compiled the entire final tree — merged `App.tsx`/`router.tsx` + the landed invite/HR WIP — with **zero type errors**; `vite build` transformed **6,284 modules** and completed in **1m 25s** (prebuild regenerated declarations for 5,822 lucide icons; output to gitignored `dist/`). The merged `React.lazy()` code-splitting visibly took effect: the build now emits many small per-page chunks and the main `index-*.js` chunk dropped from 2.21 MB (Phase 0 baseline) to **823 kB**; largest vendor chunks: heroui 933 kB, pdf 587 kB, firebase 408 kB, charts 403 kB. Non-blocking warnings only, same pre-existing categories as Phase 0 (not introduced by this phase): stale browserslist data (7 months old) and 4 mixed dynamic/static import notices (billing / real-estate / storage-utils chunking hints).

**Working-tree integrity after all operations [VERIFIED]:** `git status` shows only `docs/transformation/README.md` modified plus the six untracked `docs/transformation/phase-1/*.md` files — i.e., exactly the Phase 1 documentation set. Nothing else is dirty; the entire invite/HR WIP is landed (`6b38c3b`).

## 8. Known Issues

1. **[VERIFIED]** `firestore.rules` emits a type-coercion diagnostic at L585/L599/L615 when deny paths evaluate ("Type error. Received: [string] Expected: [bool]"). Denies still work correctly; the issue is pre-existing and cosmetic. No rules change was made (out of Phase 1 scope); the Phase 3 port must not replicate the diagnostic.
2. **[VERIFIED]** The browser suite surfaced unrelated `permission-denied` console errors from a snapshot listener (`list` @ L1323/L1380) — flagged by the suite itself as unrelated to invites. Pre-existing app behavior for the seeded admin context; to be identified when that domain is ported.
3. **[VERIFIED]** `main` is **ahead 5, behind 0, unpushed** (owner decision; the remote was force-rewritten twice before the merge). After the merge a normal (non-force) push would fast-forward `origin/main` — recommended when the owner is ready, to remove single-machine loss exposure for five commits including the invite/HR work.
4. **[ASSESSMENT]** All design decisions D1–D9 remain proposals until this gate is approved.
5. Build warnings (large chunk, mixed imports, stale browserslist) — pre-existing conditions of the codebase; see §7 build result.

## 9. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1-1 | Behavioral drift between `firestore.rules` and backend authorization during migration | Critical | Every rules family maps to an explicit backend check (doc 03 §3); each domain's ported conformance suite is its acceptance gate; the backend must enforce **at least** what the rules enforce |
| R1-2 | JSONB `ModuleRecord` query performance at scale | Medium | GIN indexes + engine pagination from day one; documented escape hatch (promote high-volume verticals to native tables behind the same service interface, Phase 8+) |
| R1-3 | Auth bridge/cutover complexity; Firebase passwords are not exportable | High | Bridge is additive and only the bridge endpoint accepts Firebase tokens; cutover is separately approved (Phase 9) with a forced password-set flow; no password is ever guessed or defaulted |
| R1-4 | Five local commits unpushed (incl. the owner's invite/HR work) — single-machine loss risk | Medium | Cold backups exist outside the repo; a normal push is now possible post-merge (§8.3) — owner decision |
| R1-5 | `CompanyMembership` (D7) is ahead of current single-company behavior | Low | Migration creates exactly one membership row per user; behavior unchanged; avoids a second identity migration later |
| R1-6 | Design→implementation drift in Phase 2 | Medium | T2.2 is reviewed line-by-line against doc 02; the permission-atom seed asserts the manifest count/checksum (70 atoms — corrected count; see §1 RBAC row) |

## 10. Rollback / Recovery Strategy

- **Phase 1 docs commit:** `git reset --soft HEAD~1` before any push (docs become untracked again), or `git revert <hash>` after. Documentation only — no source effect either way.
- **WIP commit (`6b38c3b`):** `git revert 6b38c3b`; the original files are additionally preserved in `_transformation-backups\phase-0\` (patches against `12b685e`).
- **Merge commit (`c20700c`):** revertible (`git revert -m 1 c20700c`) but not recommended — it is upstream content whose pull was owner-authorized.
- **Phase 1 changed no runtime artifacts, no data, and no Firebase resources.** The application's recoverability is unchanged from its pre-phase state.

## 11. Remaining Work

1. **Owner gate decisions (this report):** approve the design set including D1–D9; explicitly confirm the headline choices — **D1** (`backend/` in the same repo), **D5** (JSONB generic module-record storage), and the **auth approach** (Firebase-token bridge now; forced-password cutover separately approved in Phase 9).
2. **Phase 2 — Foundation** (on approval): execute T2.1–T2.4 per `06-phase2-task-specs.md` — all confined to `backend/` plus additive root scripts; no frontend source, no Firebase changes.
3. **Auth cutover detailed plan** — Phase 9, separate approval (Directive §7).
4. **Owner-side:** external copy of `_transformation-backups\phase-0\`; push decision (§8.3).
5. **Minor open item:** identify the snapshot listener behind the unrelated L1323/L1380 warnings when that domain is ported.

## 12. Recommendation for the Next Phase

**[ASSESSMENT] Approve Phase 1 and start Phase 2 (Foundation).** The design preserves every verified behavior and business rule of D-Arrow (7-role RBAC, invite policy, engine invariants, accounting integrity, activity-gated verticals), retires Firebase per-domain with ported conformance suites as acceptance gates, and keeps PostgreSQL as the system of record with backend-enforced tenancy. Phase 2 is low-risk by construction: new `backend/` directory, additive root scripts, tests as acceptance criteria, no frontend or Firebase changes.

---
*Prepared under the Master Platform Transformation & Integration Directive. Facts verified by direct observation in this session; assumptions and recommendations are labeled.*
