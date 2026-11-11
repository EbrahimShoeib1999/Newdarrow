# ADR-0010 — Recommended merger strategy: Balanced (Selective Architectural Integration)

- **Status:** Proposed (Phase One) — **requires owner approval**

## Context
Three strategies were evaluated (doc 00):
1. **Conservative** — keep A; read B as documentation only.
2. **Balanced** — A as foundation; import B's structural systems as native re-implementations; rebuild verticals on A's engine.
3. **Full Architectural Consolidation** — merge codebases/stacks (dual data layers or full rewrite onto one).

## Decision
Adopt **Balanced**. B's four structural systems (module catalog + dependency guard, activity templates, subscription/audit models, onboarding/provisioning flows) and its four vertical concepts (restaurant, car-wash, retail, salon) are integrated natively; B's runtime (auth, DB, shell, demo views) is rejected wholesale.

## Rationale
- Conservative discards B's only real value (platform-scaling designs) — slowest to revenue.
- Full consolidation violates the merger constraints: duplicate business logic, dual sources of truth, tenant-isolation rework, security regression (B's stack), and a rewrite of the production system.
- Balanced captures 100% of B's genuine value at a fraction of the risk: all changes additive, emulator-gated, rollback-safe, zero data migration.

## Consequences
Phased roadmap (doc 13): Phase 0 hygiene → 1 catalog/templates → 2 provisioning/subscriptions/audit → 3 restaurant playbook → 4 remaining verticals → 5 A placeholders → 6 deferred (branches, widgets, gateway).
