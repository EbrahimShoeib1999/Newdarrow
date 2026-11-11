# 14 — Testing Strategy

> Every merger change is emulator-first. **No production Firebase instance is ever used as a test bed.**

## 1. Baseline (exists today — Project A)

- 104 test scripts in `package.json` (Vitest + Firebase Emulator suites): service tests, rules suites, invite/role policy scripts.
- Culture: rules changes ship with rules tests; services ship with transaction tests.

## 2. Test Matrix by Layer

| Layer | Tests | Environment |
|---|---|---|
| Rules (`firestore.rules`) | New match blocks: platform catalog/templates/audit/subscription; negative tests (tenant cannot write platform collections; audit is append-only; subscription tenant-read-only) | Emulator |
| Dependency guard | Pure TS unit tests: valid graphs, missing deps, cycles, dangling codes (fixes B's seed inconsistency class of bug) | Vitest |
| Provisioning service | Transaction tests: full tenant graph created atomically; failure mid-way leaves no partial company; invite created; audit appended | Emulator |
| Module engine extension | Existing engine semantics regression + new `enabled`/`catalogCode` optional-field tolerance (backward compat: old definitions default enabled) | Vitest + Emulator |
| Permission atoms | Loader validates template starter roles against atom union — unknown atom = hard test failure | Vitest |
| Vertical modules (per Phase 3/4) | Records CRUD, validation, revision conflicts, permission gating, billing tie-in (order→invoice→journal) | Emulator |
| i18n overlays | Namespace chaining: activity overlay falls back to `custom_modules` base; RTL direction intact | Vitest |
| Frontend | Route gating per activity (lazy trees), wizard flow happy/negative paths | Vitest + Testing Library |

## 3. Security Test Additions

1. Cross-tenant probes: company A user cannot read company B catalog-instantiated definitions/records (emulator rules suite).
2. Privilege-escalation probes: `admin` cannot provision tenants; `platform_admin` cannot impersonate tenant writes outside rules.
3. Audit immutability: update/delete on `platform_audit` must be denied.
4. Zod validation presence lint for new services (CI grep or type-level check).

## 4. Migration / Backward-Compatibility Tests

- Old-shape company docs (no `slug`, `status`, `subscription`) render and function — regression suite.
- Old-shape `module_definitions` (no `catalogCode`/`enabled`) default to enabled — unit tests.
- Rules diff assertion in CI: existing blocks unchanged (byte-compare of pre-merger segment) — automated guard against accidental rule edits.

## 5. Acceptance Testing Per Phase (gates in doc 13)

| Phase | Gate test |
|---|---|
| 1 | Seeds + catalog/template read + tenant-write-denied |
| 2 | Wizard end-to-end tenant creation with isolation proof |
| 3 | Restaurant order→kitchen→payment→journal in emulator |
| 4 | Three verticals repeat gate 3 |
| 5 | Placeholder activities activated without regression |

## 6. Test Data Policy

- All test tenants/companies created inside emulator; **never** against production project id `d-arrow-buisiness`.
- Emulator opt-in stays `VITE_USE_FIREBASE_EMULATORS=true` (no default-on change).
- B's demo datasets (DEMO_LIST_DATA) are **not** used as test fixtures except as schema references.

## 7. Definition of Done (per change)

1. New/changed code has tests in the matrix above.
2. Full existing suite green.
3. Rules diff reviewed (additive-only enforced).
4. No production deploy from the change itself — deploy is a separate approved step.
