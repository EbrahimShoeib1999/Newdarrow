# Phase 1 — 04 · Unified Customization & Module Platform

> **Status:** Design for approval. Marks: **[V]** verified · **[D]** design decision.

## 1. Non-negotiable: one runtime engine

D-Arrow's Custom Module Engine (`src/features/custom-modules/lib/module-engine.ts` **[V]**) stays the **single** runtime (Directive §4). Project B contributes **architecture, never a runtime**: its tenant-facing modules are demo-only, and its good ideas (catalog, dependency guard, templates, provisioning, subscriptions, audit) are re-expressed on top of D-Arrow's engine.

**Verified engine contract (19/19 unit suite passing, Phase 0):** module key grammar, definition validation, per-type field coercion, record payload contract with **mass-assignment rejection** (`splitRecordInput` strips protected fields), definition sanitization, lifecycle stage transitions (terminal + next-graph), access resolution (**permission atom AND role grant**), list view (search/status/archived/sort/pagination), bilingual cell formatting, and record collection naming that **encodes the owning activity** (`mod_<activity>_rec_<key>` prefix contract, mirrored in `firestore.rules`).

The engine's pure functions move into the backend as the domain core of `CustomModulesRuntimeModule`; the frontend keeps `module-ui-helpers.ts` for rendering only. No behavior change — the same invariants, enforced server-side instead of (only) client-side + rules.

## 2. The nine separated concerns (Directive §4) → concrete ownership

| Concern | Owner (table / module) | Notes |
|---|---|---|
| 1. Module definition | `ModuleDefinition` | identity + key + owning activity **[V: module_definitions/{key}]** |
| 2. Module catalog | published `ModuleDefinition`s (read model) | browse/search for activation wizard |
| 3. Module version | `ModuleDefinitionVersion` (semver) | schema JSONB = engine definition verbatim |
| 4. Company activation | `CompanyModule` | pins version; per-company |
| 5. Configuration | `CompanyModule.config` | company-specific settings JSONB |
| 6. Module permissions | version's `permissionAtoms` + RBAC grants | engine atom grammar, DB-backed grants (doc 03) |
| 7. Subscription entitlement | `PlanEntitlement` → `EntitlementGuard` | module route gate |
| 8. Module data | `ModuleRecord` (+ relations) | engine-validated JSONB **[D5]** |
| 9. Dependencies | `ModuleDependency` + activation-time validation | Project B's module-guard concept **[V: B src/lib/module-guard.ts]** |

## 3. Integrating Project B's concepts (verified against B's working tree)

| B concept **[V: B prisma models]** | D-Arrow target |
|---|---|
| `Module`, `ActivityModule`, `OrganizationModule` | `ModuleDefinition` + `CompanyModule` (rebuilt for D-Arrow's engine semantics — B's schemas are reference, not copied) |
| `BusinessTemplate`, `BusinessTemplateModule` | **Business templates** = curated `ModuleDefinitionVersion` bundles per activity; used by onboarding to pre-activate a module set |
| `Activity` | replaced by D-Arrow's **activity registry** (8 activities **[V]**, `moduleLive` flags) — B's registry (4 activities) is not used |
| `Subscription` | `SubscriptionPlan`/`PlanEntitlement`/`CompanySubscription` (doc 02 §6) |
| `Organization`, `OrganizationMember`, `Branch` | `Company`/`CompanyMembership`/`Branch` |
| `Role`, `Permission`, `RolePermission` | RBAC tables (doc 03) |
| `AuditLog` | `AuditLog` (doc 02 §8) |
| Onboarding wizard (business type → provisioning) | company provisioning transaction (§4 below) |

## 4. Company provisioning & onboarding flow (new capability)

```
POST /api/v1/companies
  (auth: fresh registration or platform admin)
  → single Prisma transaction:
      Company + owner CompanyMembership (SUPER_ADMIN or ADMIN per current registration flow [V])
      + CompanySubscription (default plan / trial)
      + activate BusinessTemplate bundle for chosen activity
        (each CompanyModule: dependency check → activation → config defaults)
      + seed activity-required shared modules (tasks/CRM defaults)
  → AuditLog entries; invitation of first team members via InvitationsModule
```

- **Dependency guard**: activation validates every `ModuleDependency` (requiresKey + semver range) and **activates missing dependencies transitively**, refusing cycles (B's module-guard semantics, applied to D-Arrow's tables). Deactivation refuses if another active company module depends on it.
- **Activity templates**: `primaryActivity` **[V]** on Company drives which vertical's module bundle is offered; switching activity (existing behavior **[V: activity switching tests]**) re-runs the wizard for the new activity without touching shared-module data.

## 5. Definition lifecycle & upgrades

- `draft → published → deprecated` on `ModuleDefinition`; only `published` versions are activatable.
- `CompanyModule` pins a `versionId`; upgrades are explicit: `POST /companies/:id/modules/:moduleKey/upgrade` — engine validates the new version's schema against existing records (field compatibility check via `validateRecordValues`), writes a `MigrationRun`-style report, upgrades atomically per record batch inside a transaction.
- Records store the `versionId` they were written under — mixed-version reads are rendered by the definition the record was written against (forward compatibility, no silent rewrites).

## 6. API surface (module routes behind `EntitlementGuard`)

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/modules/catalog` | published definitions (activity filter) |
| `POST /api/v1/companies/:id/modules` | activate (dependency-validated) |
| `PATCH …/modules/:key` | config update |
| `DELETE …/modules/:key` | deactivate (blocked if depended upon) |
| `GET/POST …/modules/:key/records` | engine-validated list/create |
| `GET/PATCH/DELETE …/records/:recordId` | detail/update (stage moves via engine `canMoveStage`), archive |
| `POST …/records/:recordId/actions/:action` | lifecycle actions (`canPerformModuleAction`) |

All record writes pass through `splitRecordInput`/`validateRecordValues` — mass-assignment protection stays server-side **[V: engine invariant]**.
