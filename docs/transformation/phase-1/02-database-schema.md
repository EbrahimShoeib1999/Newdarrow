# Phase 1 — 02 · Database Schema Design (PostgreSQL + Prisma)

> **Status:** Design for approval. Prisma models below are design sketches; the real `schema.prisma` is authored in Phase 2 as versioned migrations.
> Marks: **[V]** verified fact · **[D]** design decision.

## 1. Conventions

- **[D2]** Text primary keys. Migrated rows **keep their Firestore document ids** (`User.id` = Firebase uid, `Invitation.id` = invite token, etc.) so existing invite links, shared report links, and cross-references survive reconciliation. New rows use `cuid()`.
- Every tenant-owned table carries `companyId` (FK → `companies`) + composite indexes `(companyId, …)`. Unique constraints are **company-scoped** (e.g. `@@unique([companyId, key])`), never global — except identity (email).
- Timestamps: `createdAt`, `updatedAt` on all tables; **soft delete** (`deletedAt`) on business records (Directive §6); hard delete only for sessions/tokens and (post-approval)GDPR-style erasure.
- FK behavior: `OnDelete: Restrict` between tenant entities (protect referential integrity); `Cascade` only from parent to owned child rows (e.g., `CompanyModule → ModuleRecord` is *not* cascaded — records are archived, never silently destroyed **[D]**).
- Money: integer minor units (`halalas`/cents) — never floats **[V: current billing computes in minor units]**. Currency: `SAR` default **[V: `companies.defaultCurrency`]**.
- JSONB for engine definitions and company configuration only — never for fields that need joins/constraints.

## 2. Identity, tenancy core

```prisma
model User {
  id              String    @id                     // = Firebase uid for migrated users
  email           String    @unique
  passwordHash    String?                           // null while Firebase bridge is active [D6]
  firebaseUid     String?   @unique                 // bridge mapping; dropped at final cutover
  name            String
  nameAr          String    @default("")
  avatar          String    @default("")
  locale          String    @default("en")
  isPlatformAdmin Boolean   @default(false)         // platform_admin role [V]
  onboardingStatus String   @default("pending")     // pending | active [V: user doc field]
  country         String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  memberships     CompanyMembership[]
  refreshTokens   RefreshToken[]
}

model Company {
  id               String   @id
  name             String
  primaryActivity  String?  // stored activity id [V: companies/{id}.primaryActivity]
  defaultCurrency  String   @default("SAR")
  settings         Json?    // company-scoped settings doc [V: settings collection]
  ownerId          String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  deletedAt        DateTime?
  memberships      CompanyMembership[]
  branches         Branch[]
  departments      Department[]
  modules          CompanyModule[]
  subscriptions    CompanySubscription[]
  @@index([primaryActivity])
}

// Multi-membership-ready [D7]: today a user belongs to one company [V: user.companyId];
// migration creates exactly one membership row per user. Behavior is unchanged;
// the table permits the SaaS multi-company future without a second migration.
model CompanyMembership {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id])
  companyId         String
  company           Company  @relation(fields: [companyId], references: [id])
  role              RoleSlug
  branchId          String?  // employment context [V: user doc fields branchId/workLocationId]
  workLocationId    String?
  portalAccess      Json?     // PortalId[] subset [V: user.portalAccess]
  portalSubRoles    Json?     // { tasks, crm, people, billing } [V: user.portalSubRoles]
  customPermissions String[]  // per-user atom grants [V: user.customPermissions]
  invitedByUserId   String?
  joinedAt          DateTime @default(now())
  status            MembershipStatus @default(ACTIVE)
  @@unique([userId, companyId])
  @@index([companyId, role])
}

model Branch    { id String @id; companyId String; name String; @@unique([companyId, name]) }
model Department { id String @id; companyId String; branchId String?; name String; @@unique([companyId, name]) }
```

## 3. RBAC (DB-backed — Directive §2)

```prisma
enum RoleSlug {
  PLATFORM_ADMIN      // global platform staff [V]
  SUPER_ADMIN
  ADMIN
  MANAGER
  GLOBAL_HR_MANAGER
  EMPLOYEE
  VIEWER
}   // exactly the 7 current roles [V: auth.types.UserRole]

enum InvitableRole { EMPLOYEE VIEWER MANAGER GLOBAL_HR_MANAGER }  // mirrors INVITABLE_ROLES [V: role-assignment.ts]

model Permission { atom String @id }              // e.g. "tasks.view", "crm.manage_leads" [V: atom grammar]
model RolePermission {
  role RoleSlug
  atom String
  @@id([role, atom])
}
```

**[D8] Single source of truth for atoms:** the permission manifest stays a **code module** (ported from `src/lib/permissions/index.ts` **[V]**), and a seed/sync script materializes `Permission` + `RolePermission` rows at deploy time. Rationale: atoms are reviewable in code (PR-gated), grants are data (DB), and drift is detected by a startup checksum assertion — satisfying "unified database-backed RBAC" without losing code reviewability of the atom vocabulary.

## 4. Invitations (first migrated domain — see 05)

```prisma
enum InviteStatus { PENDING ACCEPTED REVOKED EXPIRED }

model Invitation {
  id              String        @id    // = invite token [V: invites/{token}]
  companyId       String
  email           String
  role            InvitableRole        // INVITABLE_ROLES enforced by service + enum [V]
  status          InviteStatus   @default(PENDING)
  companyName     String               // denormalized for emails [V: invites doc carries companyName]
  invitedByUserId String
  invitedByName   String
  portalAccess    Json?                // pre-assigned portal subset [V: invites doc fields]
  portalSubRoles  Json?
  expiresAt       DateTime
  acceptedByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([companyId, status])
  @@index([email, status])
}
```

## 5. Sessions & tokens

```prisma
model RefreshToken {
  id           String    @id @default(cuid())
  userId       String
  tokenHash    String    @unique      // only the hash is stored [D9]
  familyId     String                 // rotation family → reuse detection revokes the family
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?
  userAgent    String?
  ip           String?
  createdAt    DateTime @default(now())
  @@index([userId])
}
```

Access tokens: short-lived (15 min) JWTs; refresh tokens: rotating (30 days), family-based reuse detection, revocation on logout-all. `passwordHash` uses **argon2id** **[D4]**.

## 6. Subscriptions & entitlements

```prisma
model SubscriptionPlan {
  code          String  @id           // e.g. "starter", "growth"
  name          Json                  // i18n labels
  priceMonthly  Int                   // minor units
  status        PlanStatus @default(ACTIVE)
}
model PlanEntitlement {
  planCode  String
  moduleKey String                    // matches ModuleDefinition.key
  limits    Json?                     // seats, records/month, feature flags
  @@id([planCode, moduleKey])
}
model CompanySubscription {
  id                String  @id @default(cuid())
  companyId         String
  planCode          String
  status            SubscriptionStatus @default(TRIALING)
  trialEndsAt       DateTime?
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  @@index([companyId, status])
}
```

Informed by Project B's `Subscription` model **[V]**, rebuilt for D-Arrow's plan model. Enforcement: `EntitlementGuard` checks module activation **and** plan entitlement on module routes.

## 7. Custom module platform (Directive §4 — nine separated concerns)

```prisma
model ModuleDefinition {                 // 1. definition identity
  id              String @id            // = definition key [V: module_definitions/{key}]
  key             String @unique
  owningActivity  String?               // activity namespace [V: record collection encodes owning activity]
  currentVersionId String?
  status          ModuleDefinitionStatus @default(DRAFT)  // draft|published|deprecated
  createdAt DateTime @default(now())
}
model ModuleDefinitionVersion {          // 3. version
  id            String @id @default(cuid())
  definitionId  String
  version       String                   // semver
  name          Json                     // bilingual labels [V: engine renders bilingual]
  schema        Json                     // full engine definition: fields, lifecycle, actions [V: engine contract]
  permissionAtoms String[]                // mod-prefixed atoms [V: prefix contract]
  changelog     String?
  publishedAt   DateTime?
  @@unique([definitionId, version])
}
model ModuleDependency {                 // 9. dependencies (Project B module-guard concept [V])
  versionId    String
  requiresKey  String
  requiresRange String                  // semver range; validated at activation time
  @@id([versionId, requiresKey])
}
model CompanyModule {                    // 4. activation + 5. configuration
  id               String @id @default(cuid())
  companyId        String
  definitionId     String
  versionId        String                // pinned version
  status           CompanyModuleStatus @default(ACTIVE)  // active|suspended
  config           Json?
  activatedByUserId String
  activatedAt      DateTime @default(now())
  @@unique([companyId, definitionId])
}
// 7. entitlement  → PlanEntitlement above
// 8. data         → ModuleRecord below (single engine runtime [V])
// 2. catalog      → published ModuleDefinitions browsable (read model; no separate table)
```

### Module data **[D5]**

```prisma
model ModuleRecord {
  id              String    @id
  companyId       String
  companyModuleId String
  versionId       String     // definition version at write time (schema evolution trace)
  data            Json       // engine-validated field values [V: validateRecordValues/coerceFieldValue]
  stage           String     // lifecycle stage [V: canMoveStage/isTerminalStage]
  archivedAt      DateTime? // [V: queryRecords filters archived by default]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([companyId, companyModuleId, stage])
  @@index([companyId, companyModuleId, archivedAt])
  // GIN index on `data` for engine search [V: queryRecords search contract]
}
model ModuleRecordRelation {
  id         String @id @default(cuid())
  fromRecordId String
  fieldKey   String
  toRecordId   String   // [V: relation fields reject ids with path chars — engine validates]
  @@index([fromRecordId, fieldKey])
  @@index([toRecordId])
}
```

**Decision D5 — JSONB generic table, not per-module native tables.** The engine is definition-driven and versioned (fields are data, not DDL **[V]**) and must stay the single runtime (Directive §4). Per-module native tables would require generated DDL per tenant module — exactly the "uncontrolled dynamic code execution" the Directive bans. Trade-off: JSONB queries need GIN indexes; the escape hatch (documented, Phase 8+) is promoting high-volume verticals (e.g., POS) to native tables behind the same engine service interface.

## 8. Audit & migration support

```prisma
model AuditLog {                          // today: audit_logs collection [V]
  id            String  @id @default(cuid())
  companyId     String?
  actorUserId   String?
  action        String
  resourceType  String
  resourceId    String?
  before        Json?
  after         Json?
  ip            String?
  createdAt      DateTime @default(now())
  @@index([companyId, createdAt])
  @@index([actorUserId, createdAt])
}

model MigrationRun {                      // Phase 4 reconciliation bookkeeping
  id         String  @id @default(cuid())
  domain     String                       // e.g. "invites", "tasks"
  wave       Int
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  status     String                        // running|reconciled|failed|rolled-back
  counts     Json?                         // per-collection counts read/written/skipped
  checksums  Json?
  notes      String?
  @@index([domain, startedAt])
}
```

## 9. Tenant isolation enforcement

1. **Application (primary):** TenantGuard injects the authenticated membership's `companyId` into a request-scoped `TenantContext`; a Prisma client extension hard-scopes every query on tenant models. Cross-tenant id = 404.
2. **Database (defense-in-depth, Phase 9):** optional PostgreSQL Row-Level Security policies keyed on `current_setting('app.company_id')` — belt-and-suspenders for `SET LOCAL` transaction scoping. Deferred to Phase 9 so it never blocks feature migration.
3. **Testing:** an automated matrix — for every tenant endpoint: same-tenant ✅, other-tenant 404, unauthenticated 401, forbidden-role 403 (Directive §10).

## 10. Migration surface (Firestore → tables) **[V: collection list from firestore.rules]**

29 named collections today: `users, invites, otpResets, publicInvoiceShares, audit_logs, companies, client_reports, daily_reports, conversations, messages, journals, payments, vouchers, payroll_payments, employees, invoices, bills, rem_leases, rem_rent_installments, rem_rent_payments, rem_security_deposits, rem_property_expenses, hr_schedule_templates, hr_schedule_assignments, hr_lateness_policies, hr_deduction_cases, attendance, settings, module_definitions` + wildcard-covered collections (tasks/CRM/projects/school/agency/facilities/marketing data and `mod_*_rec_*` engine records). Each maps 1:1 to tables designed in this document and per-domain in Phase 5; sequencing in `05-migration-plan.md`.
