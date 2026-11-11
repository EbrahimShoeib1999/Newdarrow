# ADR-0001 — D-Arrow (Project A) is the sole foundation and runtime

- **Status:** Proposed (Phase One)
- **Deciders:** Platform owner
- **Date:** 2026-11-11

## Context
Two systems exist: Project A (production SaaS, ~137K LOC, Firebase, real tenants) and Project B (prototype scaffold, ~23K LOC, demo-only tenant features). The merger must produce one platform without duplicate business logic or competing sources of truth.

## Decision
Project A's repository, stack (Vite + React 19 + Firebase), tenancy model, and runtime are **the** foundation. Project B contributes designs and data shapes only; **no Project B code is vendored into `src/`**. Project B's repo is archived read-only after knowledge extraction.

## Consequences
- **Positive:** zero regression risk to production tenants; single source of truth; B's security debt never enters the platform.
- **Negative:** B's structural systems must be re-implemented (cost accepted — they are small, well-understood patterns).
- **Neutral:** B remains a reference archive under `docs/merger/research/`.

## Alternatives considered
- Co-running both apps behind a gateway (rejected: two truths, double auth, no isolation parity).
- Porting A onto B's Next.js/Prisma (rejected: rewrite of the larger, working system; security regressions).
