# Phase 1 — 05 · Firebase → NestJS/PostgreSQL Migration Plan

> **Status:** Design for approval. Marks: **[V]** verified · **[D]** decision/plan.
> Governing rule (Directive §7): per-domain — identify dependencies → understand behavior → design schema → design APIs → implement & test → migrate data → integrate frontend → regression → **approval** → retire that domain's Firebase usage only then. Never a global removal.

## 1. Sequencing principles

Order by: (a) security value, (b) blast radius, (c) test coverage available to port, (d) coupling to other domains.

| Wave | Domains | Why this order |
|---|---|---|
| **W0 — Identity bridge** (Phase 3) | Token bridge + `users`/`companies`/`memberships`/**invitations** read-model migration | Invitations is the smallest, most security-critical domain; the owner's invite role-policy WIP + both emulator suites provide a ready conformance test baseline **[V]**; memberships/invites unblock everything else |
| **W1 — self-contained shared modules** (Phase 5) | Tasks → Meetings → CRM (incl. `client_reports` public shares) | Lowest cross-domain coupling; sub-role model already exercised |
| **W2 — HR cluster** (Phase 5) | People: employees, attendance, work schedules, lateness, deductions, payroll payments | Rules-heavy; existing emulator suites to port **[V: attendance-authz, attendance-all-employees-audit]**; branch/workLocation scoping lands here |
| **W3 — communication** (Phase 5/6) | Chat (`conversations`, `messages`) + notifications | WebSocket gateways mature by then; REST write path |
| **W4 — accounting cluster** (Phase 5) | Billing/accounting: invoices, bills, vouchers, journals, payments, products, chart of accounts, zakat, VAT, fixed assets, reconciliation, fiscal closing, `publicInvoiceShares` | Largest domain; invoice sequences & accounting engine need transactional integrity (PG strength); migrated last among shared modules |
| **W5 — verticals** (Phase 5/8) | Projects (core) → live verticals first (`moduleLive` **[V]**): Real Estate (`rem_*`), School, Agency/Marketing, Facilities → remaining verticals | Vertical isolation is already enforced by activity namespaces **[V]**; specialized verticals beyond current ones land in Phase 8 |
| **W6 — custom module platform** (Phase 7) | `module_definitions` + `mod_*_rec_*` records | Requires catalog/entitlement tables first (doc 04) |
| **W7 — auth cutover** (Phase 9, separate plan §3) | Firebase Auth retirement | Must be separately approved (Directive §7) |

Each wave = its own approval gate within the phase gates (Phases 3–8 as mapped in the directive).

## 2. Data migration & reconciliation (Phase 4 pattern, per domain)

1. **Export**: Firestore Admin SDK query per collection, partitioned by `companyId` where collections are tenant-owned; preserve document ids **[D2]**.
2. **Transform**: `Timestamp → timestamptz`; engine record docs → `ModuleRecord.data`; denormalized display fields (`companyName`, `invitedByName` **[V: invites doc]**) preserved as columns where queried; unknown/missing fields recorded in a field-coverage report (never silently dropped).
3. **Import**: staged upserts in per-company transactions; `MigrationRun` row per domain records counts + checksums.
4. **Reconcile**: per-company count match + sampled field-level diff + aggregate checksums (e.g., invoice totals per company for billing **[V: accounting computes totals]**). Discrepancy report blocks cutover.
5. **Cutover**: frontend service for that domain switches to REST (Phase 6 pattern); legacy Firestore path stays as rollback behind a per-domain feature flag.
6. **Retire**: after acceptance + a stability window, the domain's Firestore writes are disabled (rules tightened to deny), data retained read-only until final decommission (owner decision, outside this plan's scope).

**Rollback:** per-domain flag flips the frontend service back to the Firestore implementation; PostgreSQL data is never deleted during the transformation (Firestore remains the authoritative fallback until that domain's retirement is approved).

## 3. Authentication migration (separately planned — Directive §7)

**Constraint:** Firebase passwords cannot be read or directly migrated **[V: Firebase does not expose password hashes].** Google sign-in exists today **[V: GoogleAuthProvider popup]**.

**Bridge (Phase 3, W0):**
```
POST /api/v1/auth/bridge  { firebaseIdToken }
  → firebase-admin verifyIdToken (project-scoped)      // validates signature + audience
  → upsert User (id = uid, firebaseUid) + membership from user doc
  → issue own access JWT (15 min) + refresh (30 d, rotating family)  [doc 02 §5]
```
- Frontend keeps Firebase signIn → calls bridge once per session; after that, only D-Arrow tokens hit the API. Firebase Auth stays the login provider during Phases 3–8; APIs stop trusting Firebase tokens per-domain as each domain migrates.
- Custom claims (**[V: platform_admin via claims]**) migrate into `User.isPlatformAdmin` / membership roles at bridge time.

**Cutover (Phase 9, separate approval):**
1. Email/password users receive a "set your new password" flow (signed, expiring token via existing email channel **[V: EmailJS integration exists]**); passwords stored as argon2id **[D4]**. No password is ever guessed, defaulted, or migrated.
2. Google users switch to a backend OAuth code flow (same provider, no password involved).
3. Grace window with dual login; after it, Firebase project → read-only archive; `firebaseUid` column retired.

## 4. Frontend integration pattern (Phase 6, per domain)

Each feature's `*.service.ts` keeps its exported interface; its internals swap Firestore calls for `apiClient` calls (`src/lib/api-client.ts` seam **[V]**). Pages/hooks/components unchanged except where a domain's data shape is normalized (documented per domain in Phase 5 tasks). Error codes preserved so locale strings keep working **[V: INVITE_* codes]**.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Behavioral drift between rules and backend checks | Ported conformance suites per domain are the acceptance gate (doc 03 §4) |
| Data loss in migration | ids preserved; reconciliation reports; Firestore retained read-only; per-domain rollback flags |
| Dual-running confusion during transition | One source of truth per domain at any moment (cutover flag), never simultaneous writes |
| Auth bridge token confusion | Bridge is additive; Firebase tokens are only accepted by the bridge endpoint, never by domain APIs |
| Custom module records with legacy definitions | records keep `versionId`; engine renders against the version they were written under (doc 04 §5) |
