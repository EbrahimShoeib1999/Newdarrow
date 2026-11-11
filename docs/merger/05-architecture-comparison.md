# 05 — Architecture Comparison

> Dimension-by-dimension comparison. Verdict column states which system's approach should survive into the target architecture (detailed in doc 07/08).

| # | Dimension | Project A (D-Arrow) | Project B (CustomModules~) | Verdict |
|---|---|---|---|---|
| 1 | **App model** | Vite SPA + React Router v7; lazy activity-gated route trees | Next.js 16 App Router used as SPA (client-state switching; App Router benefits unused) | **A** — honest SPA; no benefit porting B's shell |
| 2 | **Tenancy** | Firestore hierarchy `companies/{companyId}/**` + collection prefixes (`rem_`, `fm_`, `mkt_`, `cln_`, `sch_`, `mod_<activity>_rec_*`) | Prisma flat tables with `organizationId` FKs | **A** — hierarchical + rules-enforced |
| 3 | **Tenant isolation** | Server-enforced in 73 KB `firestore.rules`; mirrored domain-prefix contract | Application-level only (queries filter by org id); no enforcement layer | **A** (non-negotiable) |
| 4 | **Data store** | Firestore (NoSQL, real-time, scales) + Firebase Storage | SQLite via Prisma (single-file, dev-grade) | **A** |
| 5 | **Auth** | Firebase Auth (managed, audited) + invite onboarding | Custom JWT: secret fallback, broken refresh flow, localStorage tokens | **A** (B stack rejected on security) |
| 6 | **RBAC** | 181 typed atoms, 7 static roles, compile-time matrix, effective-permission resolver, role-assignment guard | DB rows (Role/Permission/RolePermission), per-activity default roles, runtime-flexible but unverifiable | **A** runtime; **B** *catalog pattern* (role templates per activity) as seed data |
| 7 | **Vertical model ("activities")** | 8 code-defined activities, 5 live; routes + prefixes wired in code | 4 data-defined activities + 9 templates (5 dangling); full metadata (roles, widgets, terminology, workflows) | **Merge**: A's runtime + B's data-driven template richness |
| 8 | **Module system** | Runtime engine (field schemas → records, transactions, revisions) with per-company definitions | Declarative catalog + dependency resolution + enable/disable APIs; views are demo | **Merge**: A engine = runtime; B catalog/guard = provisioning semantics |
| 9 | **Business depth** | Production: double-entry accounting (ZATCA/Zakat/VAT), CRM funnel, HR, tasks, chat, meetings, portals | None (mock data everywhere tenant-facing) | **A** |
| 10 | **Platform ops** | PlatformAdminDashboard (oversight only) | Transactional tenant provisioning, module catalog admin, templates, audit logs, subscriptions | **B patterns** imported into A console |
| 11 | **Monetization** | None | Subscription model | **B design** imported (Firestore-first) |
| 12 | **Branching** | None | Branch per org | **B design** imported (deferred) |
| 13 | **i18n** | i18next, 19 namespaces, en/ar, RTL automation | Inline en/ar in registries; per-activity terminology maps | **A** framework; **B** terminology concept layered on namespaces |
| 14 | **Validation** | Zod schemas in billing/CRM domains | Zod in stack but unused on routes | **A** practice extended to all new code |
| 15 | **Testing** | 104 emulator-based scripts; rules suites; service tests | Negligible | **A** |
| 16 | **Compliance** | KSA: ZATCA QR, VAT return, Zakat; fiscal closing | None | **A** |
| 17 | **Observability** | Feature-level logs; platform admin views | AuditLog model + API | **B design** for platform audit trail |
| 18 | **DX / repo hygiene** | One canonical repo + 2 stale clones; uncommitted WIP (invite/HR) preserved | Single repo, worklog/agent-ctx documentation culture | Neutral; A repo is home |
| 19 | **Maturity** | Production system, live Firebase project | Prototype/scaffold with known security debt | **A** as foundation |
| 20 | **Scale** | ~690 files / ~137K LOC / 24 feature domains | ~157 files / ~23K LOC / 24 demo modules | **A** |

## Summary Judgment

Project B is **not a competing product** — it is a **design lab** for exactly the platform-shape questions Project A will face as it scales verticals: data-driven activity catalogs, template-based provisioning, module dependency management, subscriptions, multi-branch, and platform audit. Its implementation is disposable; its **information model is valuable**.

Therefore the merger is not a code merger: it is a **capability transplant** — B's structural patterns re-implemented natively on A's runtime, plus new verticals built on A's custom-module engine instead of porting demo code.
