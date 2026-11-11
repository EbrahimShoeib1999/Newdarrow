# 09 — Database Consolidation Plan

> ⚠️ **Superseded by the Master Directive** — PostgreSQL (via Prisma, versioned migrations) becomes the final system of record, with incremental Firebase→PostgreSQL domain migration. The Firestore-first designs below are superseded. See `docs/transformation/README.md`. Retained as analysis reference (model dispositions and backward-compat concerns still apply in spirit).

> How Project B's Prisma models are re-homed into Project A's Firestore, and how existing A data stays untouched. **No production data or rules are modified in Phase One.**

## 1. Governing Rules

1. **Firestore is the only operational datastore.** Prisma/SQLite is retired with Project B (rejected B4).
2. **Existing A collections and document shapes are frozen** — the consolidation is purely additive. No back-fills, no migrations of live data.
3. **Every new collection ships with a rules match block**, written and validated in the Firebase Emulator before any deploy.
4. **Single source of truth per concept** — see layer split in doc 08 §3.

## 2. Model-by-Model Disposition (B's 17 Prisma models)

| B model | Disposition | Target in A |
|---|---|---|
| `Organization` | **REJECTED (row) / MAPPED** | Existing `companies/{id}` doc. Optional new fields (`slug`, `status`, `activityIds[]` snapshot) added **only** going forward — old docs keep working (Firestore is schemaless; code must tolerate absence) |
| `OrganizationMember` | MAPPED | Existing membership docs + invite system; add `joinedAt`, `isDefault` semantics in code |
| `User` | REJECTED | Firebase Auth + existing `users` feature |
| `Role` / `Permission` / `RolePermission` | REJECTED (mechanics) | A's typed RBAC. Only **role templates** import: `activity_templates.{roles[]}` referencing A's role ids and permission atoms |
| `Activity` | MERGED | `activity_templates` (platform collection) — one doc per vertical, carrying B's metadata (modules, roles, terminology, quick actions) |
| `ActivityModule` | MERGED | `activity_templates.modules[]` array (no separate collection needed) |
| `BusinessTemplate` / `BusinessTemplateModule` | MERGED | Folded into `activity_templates` (B's template≈activity 1:1 in practice); if multiple templates per activity emerge later, split then — YAGNI now |
| `Module` | IMPORTED (design) | `module_catalog` (platform collection) — descriptors: code, name (en/ar), icon, category, dependencies[] |
| `OrganizationModule` | MERGED | Existing `companies/{id}/module_definitions` doc gains `enabled` + `catalogCode` fields; dependency state computed via catalog |
| `Branch` | IMPORTED (deferred) | `companies/{id}/branches/{branchId}` — Phase 3+, not in first verticals |
| `Subscription` | IMPORTED (design) | `plans` (platform) + `companies/{id}/subscription` |
| `OrganizationSettings` | MAPPED | Existing company settings features; wizard writes initial values |
| `AuditLog` | IMPORTED (design) | `platform_audit` (platform collection, append-only by rules) |

## 3. New Collection Schemas (proposed, emulator-first)

### 3.1 `module_catalog` (platform-level)

```ts
{
  code: string;                  // "pos", "kitchen", "loyalty" (B codes preserved)
  name: { en: string; ar: string };
  icon: string;                  // lucide icon name
  category: string;              // "sales" | "operations" | "hr" | ...
  dependencies: string[];        // catalog codes (module-guard input)
  engineKind: "record-based" | "page-based";
  pageRoute?: string;            // for page-based modules living as A feature routes
  version: number;
  isActive: boolean;
}
```

### 3.2 `activity_templates` (platform-level)

```ts
{
  activityId: string;            // A ActivityId ("RESTAURANT") — joins to A registry
  name: { en: string; ar: string };
  modules: string[];             // catalog codes enabled by default
  starterRoles: Array<{          // maps onto A's 7 roles; permission presets validated
    role: ARole;                 // against permission atoms (compile-checked loader)
    extraPermissions?: string[];
  }>;
  terminology: string;           // i18n overlay namespace ("activities/restaurant")
  quickActions: Array<{ code, label: {en,ar}, icon, targetRoute }>;
  isDefault: boolean;
  version: number;
}
```

### 3.3 `plans` + `companies/{id}/subscription`

```ts
// plans (platform)
{ code: string; name: {en,ar}; priceSar: number; cycle: "monthly"|"yearly";
  maxUsers?: number; maxBranches?: number; includedModules: string[] | "all"; isActive: boolean }

// companies/{id}/subscription
{ planCode: string; status: "trialing"|"active"|"past_due"|"cancelled";
  startedAt: Timestamp; renewsAt?: Timestamp; seatsUsed?: number }
```

### 3.4 `platform_audit` (append-only)

```ts
{ actorId: string; actorEmail: string; action: string;   // "tenant.provisioned"
  targetCompanyId?: string; metadata?: Record<string, unknown>;
  at: Timestamp }
```

## 4. Rules Strategy (emulator-first)

1. New match blocks added in a dedicated section of `firestore.rules` with comment headers `// === MERGER: platform catalog ===` etc.
2. Platform collections: `read` for authenticated platform staff, `write` restricted to `platform_admin` role proof (via existing role-claim/membership functions in rules).
3. `companies/{id}/subscription`: read by company members; write by platform staff only (never tenant-writable).
4. `platform_audit`: create-only, no update/delete (rules deny `update`/`delete`).
5. Every block gets an emulator rules test mirroring the existing 104-script culture (doc 14).

## 5. Data Migration & Seeding

- **No production data migration.** B's SQLite contains only demo tenants — nothing worth moving.
- Seeding scripts (emulator + future deploy):
  - `module_catalog` seed from B's registry (41 descriptors — code-translated, verified against doc 03 list).
  - `activity_templates` seed for the 4 B verticals (+ eventually A's 8 existing as templates for consistency).
  - `plans` seed (e.g., trial/standard/business).
- Seeding tooling extends `src/lib/seed-firestore.ts` / `company-defaults.ts` (A's existing utilities), executed against the emulator first.

## 6. Backward Compatibility Checklist

- [ ] Old company docs without `slug`/`status`/`subscription` render unchanged (field absence tolerated).
- [ ] Existing `module_definitions` without `catalogCode`/`enabled` treated as `enabled: true` (default-on).
- [ ] No renamed or repurposed collection prefixes.
- [ ] Permission atom list only extended (new atoms appended; none renamed/removed).
- [ ] Rules: new blocks purely additive; existing blocks byte-identical except comment headers.

## 7. Consistency & Concurrency

- Provisioning writes run in **Firestore batch/transaction** (mirrors B3's Prisma transaction intent; A's `custom-modules.service.ts` already demonstrates the pattern with optimistic revisions).
- Template versioning: templates carry `version`; instantiated definitions record `templateVersion` for future upgrade paths.
- No dual-write anywhere: catalog is read-only at runtime; records live only in engine collections.
