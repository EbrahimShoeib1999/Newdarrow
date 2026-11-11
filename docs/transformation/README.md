# D-Arrow Platform Transformation

Controlled transformation of the D-Arrow Business Platform into a unified, extensible, multi-tenant SaaS platform, per the **Master Platform Transformation & Integration Directive** (2026-11-11).

## Governing rules

- **PROJECT A (D-Arrow)** at `E:\real projects\DArrow\NewDArrow\d-arrow-business` is the primary product and architectural foundation. It is never replaced.
- **PROJECT B (CustomModules~)** at `E:\real projects\DArrow\NewDArrow\CustomModules~` contributes architectural concepts (module catalog, templates, provisioning, subscriptions) — not a competing runtime.
- **Final stack:** React/Vite frontend → NestJS backend (modular monolith, REST + WebSockets) → PostgreSQL via Prisma with versioned migrations. Backend-managed auth (access/refresh tokens, hashing). Unified DB-backed RBAC with subscription entitlements.
- **Firebase remains available in the legacy app** until each domain's replacement is implemented, tested, and approved. Firebase is retired **per-domain, never globally, and never before acceptance**.
- Every phase passes: DISCOVER → ANALYZE → DESIGN → PLAN → APPROVE → IMPLEMENT → TEST → REVIEW → ACCEPT. No gate is skipped; no phase starts without explicit approval.

## Phase gates

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository safety and baseline | **Closed — owner-approved 2026-11-11** |
| 1 | Final architecture and migration design | **Complete — awaiting approval to close** |
| 2 | NestJS, PostgreSQL, Prisma foundation | Not started |
| 3 | Authentication, RBAC, multi-tenancy | Not started |
| 4 | Data migration and reconciliation | Not started |
| 5 | Existing standard business module migration | Not started |
| 6 | Frontend API integration | Not started |
| 7 | Custom module platform and company provisioning | Not started |
| 8 | Specialized vertical modules | Not started |
| 9 | Security, regression, production readiness | Not started |

## Documentation layout

- `reports/` — one numbered report per phase, following the 12-section reporting requirements of the directive.
- `phase-1/` — Phase 1 design set (awaiting owner approval): `01-target-architecture.md` (NestJS modular monolith), `02-database-schema.md` (PostgreSQL/Prisma design), `03-rbac-and-tenancy.md` (DB-backed RBAC & tenant isolation), `04-custom-module-platform.md` (nine separated concerns on D-Arrow's engine), `05-migration-plan.md` (per-domain Firebase→NestJS sequencing + auth bridge), `06-phase2-task-specs.md` (Phase 2 task specifications).
- `../merger/` — Phase One discovery evidence (project inventories, workflows, domain mapping, integration decisions, ADRs). **Note:** the merger docs' *target-architecture* proposals (Firebase-forever end state) are superseded by the Master Directive's NestJS/PostgreSQL target; their *discovery evidence and classification rationale* remain valid inputs.

## Safety artifacts (outside the repos)

- `E:\real projects\DArrow\NewDArrow\_transformation-backups\` — cold snapshots of all uncommitted work in both repositories, per phase. See `phase-0/MANIFEST.md`. Contains secrets; never commit.
