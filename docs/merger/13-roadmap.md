# 13 — Implementation Roadmap (Proposal)

> Phased plan for the Balanced strategy (see doc 00). **Nothing below starts until this documentation set is approved.** Every phase ends with an emulator-verified gate; production Firebase is touched only via approved scripted releases.

## Phase 0 — Prerequisites & Safety Net

**Goal:** make the repo safe to change.

| Task | Detail |
|---|---|
| Land or isolate in-progress invite/HR work | The working tree has uncommitted changes (invites.service.ts, InviteUserModal, use-invites, TeamMembersPage, HireEmployeeModal, role-assignment, attendance.store + 3 untracked test scripts). They must be committed/stashed by their author **before** merger commits begin |
| Baseline emulator run | Run the 104-script suite green on canonical repo; record baseline |
| Clone hygiene | Mark `D-Arrow-Business` and `New folder\d-arrow-business` as read-only stale clones; canonical = `NewDArrow\d-arrow-business` (optionally verify by hash later — non-blocking) |
| Archive Project B knowledge | Copy B's worklog/agent-ctx + registries into `docs/merger/research/` (reference-only); B repo goes read-only (D12) |

**Exit criteria:** clean working tree (or explicitly quarantined WIP), green baseline suite, research archive committed.

## Phase 1 — Platform Catalog & Templates (foundation, no user-visible change)

| Task | Detail |
|---|---|
| `module_catalog` collection + seed script | 41 descriptors from B registry; dependency graph validated at seed time |
| `activity_templates` collection + seed | 4 B verticals first (restaurant, car-wash, retail, salon); starter roles validated against A atoms |
| Rules blocks | Additive match blocks for both collections (platform_admin read/write) |
| Permission atoms | Add `platform.*` / `modules.*` atoms (doc 10 §5) |
| Emulator tests | Catalog read, template read, tenant cannot write platform collections, role gating |

**Exit criteria:** seeds run in emulator; new rules tests green; existing suites untouched-green.

## Phase 2 — Provisioning, Subscriptions & Audit (B's real value, native)

| Task | Detail |
|---|---|
| Dependency guard port | `module-guard` logic re-implemented in `features/custom-modules` (pure TS, unit-tested) |
| Provisioning service + wizard UI | Transaction: company + settings + module_definitions + subscription + audit + owner invite (doc 08 §5) |
| `plans` + `companies/{id}/subscription` | Schema + rules (tenant-read/platform-write) + console plan manager |
| `platform_audit` | Append-only collection + audit viewer tab in console |
| Template preview | Console preview of a vertical's module set/roles before provisioning |

**Exit criteria:** a wizard-created tenant in emulator has working isolation, definitions, invite, subscription, and audit trail — all rules-enforced.

## Phase 3 — First Vertical: Restaurant (proves the playbook)

| Task | Detail |
|---|---|
| Activity registration | `RESTAURANT` in A registry + route tree (code, one place) |
| Module definitions schemas | orders, menu, tables, kitchen tickets, delivery, discounts via engine field schemas |
| Special pages | POS fast entry + kitchen display (A feature pages writing engine records) |
| Billing tie-in | POS order → invoice → journal entry (A engine — B never had this) |
| Terminology overlay | `locales/{en,ar}/activities/restaurant.json` |
| Full test suite | Records CRUD, rules, permissions, billing integration |

**Exit criteria:** restaurant tenant operates end-to-end in emulator: order → kitchen → payment → ledger.

## Phase 4 — Remaining B Verticals

Car-wash, retail, salon via the Phase-3 playbook (engine-heavy, fewer special pages: vehicles/work-orders, loyalty/catalog, appointments).

**Exit criteria:** three verticals live; playbook documented in `docs/implementation/`.

## Phase 5 — Complete A's Own Placeholders (optional track, can interleave)

Brokerage, development, clinic (A's existing stubs) — same playbook; may reuse B's clinic template ideas (appointments/prescriptions as engine modules).

## Phase 6 — Deferred Capabilities

| Item | Trigger |
|---|---|
| Branch model | When a vertical needs multi-location (retail/salon chains) |
| Config-driven dashboard widgets | When per-activity dashboards multiply beyond hand-built maintenance |
| Role template authoring UI | When marketing (not engineering) needs to define verticals |
| Payment gateway for subscriptions | Monetization go-live (ADAPTER_INTEGRATION class reserved for this) |

## Sequencing & Estimates

| Phase | Relative size | Risk |
|---|---|---|
| 0 | XS | Low |
| 1 | S | Low (purely additive) |
| 2 | M | Medium (wizard + transactions) |
| 3 | L | Medium (first vertical proves everything) |
| 4 | M | Low after 3 |
| 5 | L | Medium |
| 6 | Variable | Deferred by design |

## Rollback Posture

- Every phase is additive; rollback = revert rules block + remove new feature flag. No data migration to undo (Firestore schemaless; new fields optional).
- Feature flags gate new console surfaces until emulator suites pass.
- Production deploys scripted, one phase at a time, with rules diff attached to the release notes.
