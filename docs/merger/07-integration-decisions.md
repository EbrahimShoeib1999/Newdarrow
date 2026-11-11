# 07 — Integration Decisions (Capability Classification)

> Every capability from both projects is classified. **No decision here licenses a code change** — this is the Phase One proposal awaiting approval.
> Classifications: `KEEP_D_ARROW` · `IMPORT_FROM_PROJECT_B` · `MERGE_AND_REFACTOR` · `REBUILD_WITH_EXISTING_CORE` · `ADAPTER_INTEGRATION` · `KEEP_AS_SEPARATE_DOMAIN` · `DEPRECATE` · `REJECT`

## 1. Project A Capabilities

| # | Capability | Decision | Reason |
|---|---|---|---|
| A1 | Firebase Auth + invite onboarding | **KEEP_D_ARROW** | Production-proven; B's JWT stack is insecure (secret fallback, broken refresh, localStorage) |
| A2 | Firestore multi-tenant hierarchy + rules isolation | **KEEP_D_ARROW** | Server-enforced isolation is non-negotiable; B has nothing equivalent |
| A3 | Activity registry + route gating + collection prefixes | **KEEP_D_ARROW** (extend per D3) | Core contract; extension is additive |
| A4 | Static typed RBAC (181 atoms, 7 roles) | **KEEP_D_ARROW** | Compile-time safety; no runtime drift; B's DB roles unverifiable |
| A5 | Billing/accounting engine (journals, CoA, VAT, Zakat, ZATCA) | **KEEP_D_ARROW** | No B counterpart exists (B is demo) |
| A6 | CRM suite (leads→deals→quotation→contract→invoice) | **KEEP_D_ARROW** | Same |
| A7 | People/HR suite | **KEEP_D_ARROW** | Same |
| A8 | Projects, facilities, marketing, school domains | **KEEP_D_ARROW** | Live production domains |
| A9 | Brokerage/development/clinic placeholders | **KEEP_D_ARROW** (finish later via D4) | Route stubs; will be completed on the unified engine |
| A10 | Custom-module engine + service (runtime) | **KEEP_D_ARROW** (core of D3) | The runtime single-source-of-truth |
| A11 | Tasks, chat, meetings, notifications, portals | **KEEP_D_ARROW** | No B equivalent of equal maturity |
| A12 | i18n (19 namespaces, RTL) | **KEEP_D_ARROW** (extend per D6) | Framework canonical |
| A13 | PlatformAdminDashboardPage | **MERGE_AND_REFACTOR** → with B2 | Console gains provisioning powers |
| A14 | Emulator test suites (104 scripts) | **KEEP_D_ARROW** (extend per D13) | Safety net for all changes |
| A15 | `company-defaults.ts` provisioning | **MERGE_AND_REFACTOR** → into D3 | Generalized into template-driven provisioning |

## 2. Project B Capabilities

| # | Capability | Decision | Reason |
|---|---|---|---|
| B1 | Next.js app shell, SPA anti-pattern routing | **REJECT** | No value; A's router is superior; B never used App Router properly |
| B2 | Platform admin console APIs (tenants, users, templates, audit, dashboard) | **IMPORT_FROM_PROJECT_B** *(design → A console)* | B's only production-grade surface; reimplement natively on Firestore in A's admin feature |
| B3 | Transactional tenant provisioning (`platform/tenants/route.ts`) | **IMPORT_FROM_PROJECT_B** *(flow design)* | Valuable flow (org+owner+modules+roles+subscription in one tx); rebuild with Firestore batch + invite (A's auth has no password-creation API) |
| B4 | Prisma/SQLite data layer | **REJECT** | Dev-grade; duplicate source of truth risk; A's Firestore is canonical |
| B5 | Custom JWT auth (login/register/refresh/switch-org) | **REJECT** | Security findings (doc 02 §8); Firebase Auth wins |
| B6 | DB-driven Role/Permission/RolePermission | **REJECT** *(mechanics)* / **IMPORT** *(per-activity role templates as data)* | Mechanics unverifiable; the *content* (role presets per activity) is valuable seed data |
| B7 | `Activity` model + `ACTIVITY_REGISTRY` (4 activities with rich metadata) | **MERGE_AND_REFACTOR** with A3 | Union: A's runtime + B's metadata richness (roles, widgets, terminology, quick actions) as template data |
| B8 | `BusinessTemplate` / `BusinessTemplateModule` | **IMPORT_FROM_PROJECT_B** | Template-driven provisioning is the right model; port shape to Firestore |
| B9 | Module catalog (`Module` + ~41 codes) | **IMPORT_FROM_PROJECT_B** *(catalog layer only)* | Feeds A's engine as the platform-level catalog; engine remains A's |
| B10 | `OrganizationModule` enablement + dependency `module-guard` | **MERGE_AND_REFACTOR** with A10 | Explicit enablement semantics + dependency resolution join A's engine |
| B11 | Demo module views (`module-view-renderer`, `DEMO_LIST_DATA`) | **REJECT** | Fake data; never ship |
| B12 | All tenant business modules (pos, orders, kitchen, menu, tables, vehicles, work orders, loyalty, discounts, appointments, prescriptions, delivery, …) | **REBUILD_WITH_EXISTING_CORE** | Each becomes a `module_definition` template + real records on A's engine; B's demo code is a UX reference only |
| B13 | `Subscription` model | **IMPORT_FROM_PROJECT_B** *(design)* | A lacks platform monetization; Firestore-first redesign |
| B14 | `Branch` model | **IMPORT_FROM_PROJECT_B** *(design, deferred)* | New capability; not needed for first verticals |
| B15 | `AuditLog` model + `platform/audit-logs` API | **IMPORT_FROM_PROJECT_B** *(design)* | Platform-level audit trail A lacks |
| B16 | Onboarding wizard (`onboarding-flow.tsx`) | **IMPORT_FROM_PROJECT_B** *(UX pattern)* | Multi-step activity→modules→owner flow adapted to A's invite model |
| B17 | Terminology per activity | **IMPORT_FROM_PROJECT_B** *(concept)* | Becomes per-activity i18n overlay namespaces |
| B18 | Config-driven dashboard widgets | **DEPRECATE** *(in B)* / roadmap idea for A | Not blocking; note for future |
| B19 | `platform/activities/[code]/preview` | **IMPORT_FROM_PROJECT_B** *(concept)* | Template preview before provisioning |
| B20 | shadcn/ui kit | **REJECT** | A standardizes on HeroUI; mixing kits violates doc 12 |
| B21 | worklog/agent-ctx documentation culture | **KEEP_AS_SEPARATE_DOMAIN** | Valuable process artifact; archive under `docs/merger/research/` for reference, not merged into A docs |
| B22 | `ibrahim-dates-backend` (adjacent 3rd project) | **KEEP_AS_SEPARATE_DOMAIN** (out of scope) | Unrelated product; explicitly excluded |

## 3. Cross-Cutting Decisions (the "D" series referenced above)

| ID | Decision | Classification | Rationale |
|---|---|---|---|
| D1 | A remains sole runtime & repo | — | Foundation constraint from merger objectives |
| D2 | No B code is copied into `src/` wholesale | — | All imports are *re-implementations* of designs, reviewed against A's patterns |
| D3 | **Unified module system**: A engine (runtime) + B catalog/guard/enablement (provisioning) + B templates (data) | **MERGE_AND_REFACTOR** | Single source of truth; eliminates the two competing module systems |
| D4 | New verticals (restaurant, car-wash, retail, salon, …) delivered as activity templates + module definitions on A's engine | **REBUILD_WITH_EXISTING_CORE** | Never port demo code; build real records on the existing engine |
| D5 | Auth stays Firebase; B JWT rejected | **KEEP_D_ARROW / REJECT** | Security findings |
| D6 | Terminology overlays as i18n namespaces per activity | **IMPORT_FROM_PROJECT_B** | Fits A's i18n exactly |
| D7 | Subscription/plan model on Firestore | **IMPORT_FROM_PROJECT_B** | New revenue capability |
| D8 | Branch model (deferred to post-vertical phase) | **IMPORT_FROM_PROJECT_B** | Not required by first 4 verticals |
| D9 | Platform audit collection | **IMPORT_FROM_PROJECT_B** | Compliance posture |
| D10 | Provisioning wizard for platform admins | **IMPORT_FROM_PROJECT_B** | Turns A's console from oversight to operations |
| D11 | `ADAPTER_INTEGRATION` — deliberately unused in this phase | — | No external system requires bridging; classification reserved for future third-party integrations (e.g., payment gateways for subscriptions) |
| D12 | B repository archived read-only after knowledge extraction | **DEPRECATE** | Prevents accidental parallel development |
| D13 | All changes emulator-tested; production Firebase untouched | — | Phase One constraint, carried into implementation phases |

## 4. Consolidated Tally

| Classification | Count | Items |
|---|---|---|
| KEEP_D_ARROW | 13 | A1–A12, A14 |
| MERGE_AND_REFACTOR | 4 | A13, A15, B7, B10 (+ D3) |
| IMPORT_FROM_PROJECT_B | 9 | B2, B3, B6(data), B8, B9, B13, B15, B16, B17 (+B19, D7–D10) |
| REBUILD_WITH_EXISTING_CORE | 1 (bundle of ~15 modules) | B12 |
| ADAPTER_INTEGRATION | 0 (reserved) | D11 |
| KEEP_AS_SEPARATE_DOMAIN | 2 | B21, B22 |
| DEPRECATE | 1 | B18 |
| REJECT | 5 | B1, B4, B5, B11, B20 |

**Net effect:** Project B contributes **no runtime code** and **four structural systems** (template catalog, provisioning flow, subscription/audit models, terminology overlays) plus **four new business verticals as build-back plans**. Project A keeps everything it has and gains the platform-scaling layer it lacked.
