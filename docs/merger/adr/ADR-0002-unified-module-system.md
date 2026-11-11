# ADR-0002 — Unified layered module system (engine + catalog + templates)

- **Status:** Proposed (Phase One)

## Context
Project A has a production module **runtime** (`module-engine.ts`, `custom-modules.service.ts`, per-company `module_definitions`, `mod_<activity>_rec_*` records). Project B has a module **catalog** (~41 descriptors), **dependency resolution** (module-guard), **enablement** (`OrganizationModule`), and **activity templates** (module bundles + roles + terminology). Both claim "custom modules" — naive merging would create two competing systems.

## Decision
One module system, three layers with distinct truths:
1. **Catalog** (platform `module_catalog`) — what can exist (B design, Firestore-native).
2. **Provisioning** (templates + dependency guard + wizard) — what a company has (B flows on A's transaction/invite patterns).
3. **Runtime** (A's engine + services) — what users do (records, revisions, rules prefixes).

B's demo view renderer (`module-view-renderer.tsx`, `DEMO_LIST_DATA`) is rejected; B's registry metadata and guard logic are re-implemented.

## Consequences
- Existing A `module_definitions` need no migration (new fields `catalogCode`, `enabled`, `templateVersion` optional; absence = enabled).
- Adding a vertical becomes data-first: catalog + template + (code only for) route registration and any special pages.
- Dependency graphs validated at seed and load time (prevents B's dangling-reference bug class).
