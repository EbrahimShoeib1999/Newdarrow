# 15 — Risk Register

> Risks ordered by severity (Impact × Likelihood). Each has an owner-class, mitigation, and detection signal.

## R1 — Duplicate module systems / competing sources of truth 🔴 Critical

- **Cause:** Porting B's module runtime (or leaving B runnable) alongside A's engine.
- **Impact:** Data split across two module systems; tenant confusion; rules drift.
- **Mitigation:** Doc 07 D3 — one engine, layered catalog; B repo archived read-only (D12); guard rails in doc 11 §5.
- **Detection:** Code review rejects any `src/` vendoring of B; CI rules-diff guard.

## R2 — Tenant isolation regression in new rules 🔴 Critical

- **Cause:** Sloppy match blocks for the new platform collections.
- **Impact:** Cross-tenant data leak — the worst possible platform failure.
- **Mitigation:** Additive-only rules; emulator negative tests mandatory (doc 14 §3); CI byte-compare of existing rules segment.
- **Detection:** Rules test suite fails on any regression before deploy.

## R3 — Disturbance of in-progress invite/HR work 🟠 High

- **Cause:** Merger commits colliding with uncommitted WIP in the working tree.
- **Impact:** Lost work / merge hell; trust damage.
- **Mitigation:** Phase 0 requires the WIP be committed/stashed by its author before any merger commit.
- **Detection:** `git status` gate at Phase 0 exit.

## R4 — Scope creep: rebuilding B's 15 demo modules as "real" now 🟠 High

- **Cause:** Enthusiasm to port all B modules early.
- **Impact:** Schedule blowout; half-built verticals.
- **Mitigation:** Roadmap sequences one vertical first (Phase 3), others after playbook proven; deferred list in Phase 6.
- **Detection:** Phase gates with exit criteria (doc 13).

## R5 — Backward-compatibility break for existing tenants 🟠 High

- **Cause:** Assuming new optional fields exist on old documents.
- **Impact:** Runtime errors for production companies.
- **Mitigation:** Optional-field tolerance tests (doc 14 §4); no renames; additive atoms only.
- **Detection:** Regression suite on old-shape fixtures.

## R6 — Permission atom drift between templates and code 🟡 Medium

- **Cause:** A template referencing an atom that doesn't exist (B's dangling-reference bug class).
- **Impact:** Broken onboarding; silent permission holes.
- **Mitigation:** Template loader validates against typed atom union; hard test failure on unknown atoms (doc 14).
- **Detection:** Vitest template-validation suite.

## R7 — Dependency cycles / invalid catalog graphs 🟡 Medium

- **Cause:** Seed data errors (B's seed already had 5 dangling template references).
- **Impact:** Provisioning failures at runtime.
- **Mitigation:** Seed-time validation + guard unit tests for cycles/missing/dangling (doc 14).
- **Detection:** Seed script refuses to import invalid graphs.

## R8 — Working on the wrong D-Arrow clone 🟡 Medium

- **Cause:** Three copies of the repo exist (`NewDArrow`, `D-Arrow-Business`, `New folder`).
- **Impact:** Divergent work lost or deployed from stale copy.
- **Mitigation:** Canonical declared in doc 01; stale clones marked read-only in Phase 0; optional hash verification.
- **Detection:** Phase 0 checklist.

## R9 — Production Firebase accidentally touched during testing 🟡 Medium

- **Cause:** Emulator opt-in misconfigured (`VITE_USE_FIREBASE_EMULATORS` unset during a test run).
- **Impact:** Test data in production; rules experiments live.
- **Mitigation:** Opt-in stays default-off; test scripts assert emulator config; no seeds run outside emulator (doc 14 §6).
- **Detection:** Test harness precondition check.

## R10 — Terminology/i18n gaps in new verticals 🟢 Low

- **Cause:** B's en/ar strings incomplete or mistranslated.
- **Impact:** UX polish issues only.
- **Mitigation:** i18n overlay fallback chain to base namespaces; bilingual review per vertical.

## R11 — Loss of B knowledge after archiving 🟢 Low

- **Cause:** B repo archived read-only.
- **Impact:** Design context lost.
- **Mitigation:** `docs/merger/research/` archive of registries/worklog/agent-ctx (Phase 0).

## R12 — Roadmap stalls after Phase 2 (platform built, no vertical shipped) 🟢 Low-Med

- **Cause:** Effort concentration on infrastructure.
- **Impact:** Value not realized.
- **Mitigation:** Phase 3 is the smallest end-to-end vertical (restaurant) — deliberately scheduled immediately after provisioning.

## Residual Risk Statement

With mitigations applied, the highest residual risks are R2 (isolation) and R4 (scope) — both bounded by emulator gates and phase discipline. No risk requires touching production data destructively; the plan contains **zero data migrations** by design.
