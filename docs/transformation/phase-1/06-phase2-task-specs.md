# Phase 1 — 06 · Phase 2 Task Specifications (Foundation)

> Each task follows Directive §9: objective, scope, files, dependencies, risks, expected behavior, acceptance criteria, tests. **No task is started before Phase 2 is explicitly approved.**
> Common rules: no frontend changes; no Firebase changes; all work in `backend/` (+ one scoped root `package.json` script addition in T2.3); local environments only.

---

## T2.1 — NestJS scaffold & runtime conventions

- **Objective:** a runnable NestJS modular-monolith skeleton with enforced conventions (config validation, logging, error contract, health endpoint).
- **Scope:** `backend/` new project only.
- **Files:** `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/config/*` (Zod-validated env), `backend/src/common/filters/http-exception.filter.ts` (error envelope `{ success, error: { code, message, details } }`), `backend/src/common/interceptors/logging.interceptor.ts` (requestId), `backend/src/health/*`.
- **Dependencies:** none (first task).
- **Risks:** over-scaffolding (avoid — no guards/DB yet); ESLint config drift from frontend.
- **Expected behavior:** `GET /api/v1/health` returns `{ success, data: { status: "ok" } }`; invalid env fails fast at boot; unhandled errors map to the envelope contract.
- **Acceptance criteria:** app boots from a clean checkout with `npm install && npm run dev` in `backend/`; health endpoint responds; error envelope verified.
- **Tests:** unit (config validation), e2e (supertest): health 200, unknown route → envelope 404, boot-fail on bad env.

## T2.2 — PostgreSQL + Prisma foundation & first migration

- **Objective:** version-controlled database with the core identity/RBAC schema (doc 02 §2–§4) and a reproducible local database.
- **Scope:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/0001_core_identity/`, seed script, `backend/docker-compose.dev.yml` (postgres:16, local ports only, named volume).
- **Files:** as above + `backend/src/prisma/*` (module), `backend/prisma/seed.ts` (roles enum, permission atoms + role grants from the ported manifest, one dev company + admin user for local testing only).
- **Dependencies:** T2.1.
- **Risks:** schema drift vs doc 02 (reviewed line-by-line against the design); secret leakage (compose has no credentials beyond local dev defaults; real creds stay in gitignored `.env`).
- **Expected behavior:** `docker compose -f docker-compose.dev.yml up -d && npx prisma migrate dev && npm run seed` yields a schema-conformant DB; migrations are committed, never re-generated ad hoc.
- **Acceptance criteria:** `prisma migrate dev` clean from scratch; `prisma migrate deploy` idempotent; seed creates 7 roles, N permission atoms matching the manifest checksum assertion (must equal the frontend manifest count — **70 atoms**, verified by direct count at Phase 2 start, 2026-11-11, correcting the "181" figure inherited from Phase One merger evidence; the task asserts the exact number at seed time).
- **Tests:** integration: migrate-up from empty DB, seed idempotency, unique constraints (`userId+companyId`), tenant-scoped composite indexes exist.

## T2.3 — Test harness & scripts wiring

- **Objective:** mandatory testability (Directive §10) for everything that follows.
- **Scope:** `backend/test/` (unit + e2e), test database profile in compose, root convenience scripts.
- **Files:** `backend/jest.config.*`, `backend/test/app.e2e-spec.ts`, `backend/test/db.setup.ts` (isolated test DB, reset per run), root `package.json` **+3 scripts only** (`api:dev`, `api:test`, `api:test:e2e`).
- **Dependencies:** T2.1, T2.2.
- **Risks:** root package.json is shared with the owner's WIP — the change is additive scripts only, committed as its own scoped commit.
- **Expected behavior:** `npm run api:test` and `api:test:e2e` run green from the repo root; e2e boots the app against the isolated test DB.
- **Acceptance criteria:** all suites green locally; no test touches any Firebase service or production resource.
- **Tests:** the harness itself (one canary unit test, one canary e2e test, one DB integration test).

## T2.4 — Cross-cutting request pipeline skeletons

- **Objective:** the guard/interceptor skeleton of doc 03 §2 so Phase 3 fills it with real auth.
- **Scope:** `TenantContext` (AsyncLocalStorage), `TenantGuard` + `PermissionsGuard` skeletons wired but permissive-with-audit in dev (deny-by-default OFF until Phase 3 — they exist, are tested with stub principals, and log every bypass), pagination helper, `AuditLog` interceptor skeleton (writes rows for a seeded action).
- **Files:** `backend/src/common/context/*`, `backend/src/common/guards/*`, `backend/src/audit/*`.
- **Dependencies:** T2.2.
- **Risks:** none to production (backend not yet serving the frontend).
- **Expected behavior:** pipeline order (doc 01 §4) executes deterministically; audit rows written for a demo endpoint.
- **Acceptance criteria:** unit tests prove pipeline order and audit write; documentation of the Phase 3 hardening contract.
- **Tests:** unit (context propagation), e2e (stub-principal request traverses pipeline; audit row persisted).

---

**Phase 2 exit (gate to Phase 3):** all four tasks implemented, tested green locally, code reviewed against doc 01/02/03, and a Phase 2 report delivered with the 12-section format.
