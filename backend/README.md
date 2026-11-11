# D-Arrow Backend (NestJS)

The target backend of the D-Arrow platform transformation — a NestJS modular monolith (REST now, WebSockets later) over PostgreSQL/Prisma. This package is the **Phase 2 foundation** (tasks T2.1–T2.4). Governing design: `../docs/transformation/phase-1/` (owner-approved 2026-11-11).

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Run the API locally with watch reload (`tsx watch`) |
| `npm run build` | Compile with strict TypeScript to `dist/` |
| `npm run start` | Run the compiled build |
| `npm run typecheck` | Type-check without emitting |
| `npm run test` | Unit tests (`src/**/*.spec.ts`) |
| `npm run test:e2e` | End-to-end tests (`test/**/*.e2e-spec.ts`) |

### Platform notes (verified on Node 24)

- **NestJS 12 packages are ESM-only** (`"type": "module"`). Node ≥ 22.12 loads them from CommonJS output via native `require(esm)`, so the app runs as plain CommonJS — but Jest implements its own module registry and needs Node's `--experimental-vm-modules` capability to do the same. Both test scripts invoke Jest through `node --experimental-vm-modules` (the "VM Modules is an experimental feature" warning on test runs is expected).
- **`class-validator` + `class-transformer` are required peers** of `ValidationPipe` (not auto-installed by Nest) — both are declared as direct dependencies.
- This package requires Node ≥ 20 in general, but the test scripts assume Node ≥ 22.12 (native `require(esm)`).

## Configuration

All configuration is validated by Zod at boot (`src/config/env.ts`) — invalid values fail fast with a list of every problem; nothing starts half-configured. Copy `.env.example` to `.env` for local values (gitignored); real environment variables always win over the file.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3001` | API listen port |
| `DATABASE_URL` | — | PostgreSQL connection string; optional in T2.1, required from T2.2 onward |

## Wire contract

The API matches the frontend's existing contract in `../src/types/api.types.ts` **exactly** — this is the preservation requirement. (Design doc 01 sketched a `{ success, data | error }` envelope from an inaccurate description of that file; the implemented contract follows the real types. See the Phase 2 report, erratum 2.)

- Base path: **`/api/v1`**
- Success: `{ "data": <payload>, "message": <string> }` — `ApiResponse<T>`; the message comes from the `@ResponseMessage()` route decorator (default `"OK"`)
- Error: `{ "message": <string>, "statusCode": <number>, "errors"?: Record<string, string[]> }` — `ApiError`; internal details never leave the server (5xx details are logged server-side only)
- Paginated payloads are `PaginatedResponse<T>` (`{ data, total, page, pageSize, totalPages }`) carried inside `data`
- Every response carries an `x-request-id` header (echoed from the request when the client sends one); request logs include it

## Layout

```
src/
  main.ts            boot entry — exported bootstrap(), require.main guard, fail-fast env
  app-setup.ts       single place defining runtime conventions (used by prod AND tests)
  app.module.ts      root module
  config/            Zod env validation + global ENV provider (ENV_TOKEN)
  common/
    decorators/      @ResponseMessage() — sets the ApiResponse message
    filters/         HttpExceptionFilter → ApiError envelope
    interceptors/    request logging (x-request-id) + ApiResponse envelope
  health/            GET /api/v1/health (liveness)
test/
  app.e2e-spec.ts    e2e: health envelope, 404 envelope, boot-fail on poisoned env
```

## Deliberate Phase 2 boundaries

- **No auth guards and no database access yet** — the guard/tenant/permissions skeletons arrive in T2.4 and are hardened with real auth in Phase 3. Nothing here trusts or reads client-supplied company/user identity.
- The full pipeline order (validation → auth → tenant → permissions → entitlement → audit, doc 01 §4) is assembled in `configureApp` as those pieces land.
