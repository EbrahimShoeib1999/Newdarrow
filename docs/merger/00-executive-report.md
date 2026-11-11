# 00 — Executive Report: D-Arrow Platform Merger (Phase One)

> ⚠️ **SUPERSEDED IN PART — see `docs/transformation/README.md`.**
> The **Master Platform Transformation & Integration Directive (2026-11-11)** changed the end state: the final architecture is a **NestJS + PostgreSQL + Prisma backend** with backend-managed auth and DB-backed RBAC, with **Firebase retained in the legacy app per-domain until each replacement is accepted** (not a Firebase-forever platform as proposed below).
> - Docs **01–07, 15, 16** (discovery evidence, inventories, workflows, comparison, mapping, classification, risks, acceptance) remain valid as analysis inputs.
> - Docs **08–14** (target architecture, database consolidation, security, module architecture, frontend, roadmap, testing) are **superseded by Phase 1 of the transformation** (`docs/transformation/`).
> - The strategy recommendation below is likewise superseded by the Directive's controlled-migration strategy.
>
> **Status:** Phase One deliverable — discovery, analysis, and proposal. No code has been changed.
> Prepared 2026-11-11 · Full evidence in docs 01–16 + `adr/`.

---

## Recommendation up front

**Adopt Strategy B — Balanced ("Selective Architectural Integration").**

Project A (D-Arrow) remains the entire runtime and repository. Project B (CustomModules~) is treated as a **design donor**: its four genuinely valuable systems — module catalog with dependency resolution, activity templates, subscription/audit models, and the provisioning/onboarding flow — are re-implemented natively on A's stack, and its four business verticals (restaurant, car-wash, retail, salon) are **rebuilt on A's custom-module engine** rather than ported. Nothing from B's insecure or demo runtime survives. Every change is additive and emulator-gated; there are **zero data migrations** and **zero production Firebase touches**.

---

## The 16 Questions

**1. What is each project, actually?**
A = production multi-tenant SaaS (Vite + React 19 + Firebase; ~137K LOC; 24 feature domains; live Firebase project; 181-permission RBAC; double-entry accounting with ZATCA/Zakat/VAT; full CRM; HR with geo attendance; bilingual RTL). B = platform scaffold prototype (Next.js 16 + Prisma/SQLite; ~23K LOC; **tenant features are demo mock data**; only platform-admin/config APIs are real). (Docs 01, 02)

**2. What does each system genuinely do well?**
A: real business functionality, rules-enforced tenant isolation, typed RBAC, compliance depth, test culture (104 emulator scripts). B: clean *information model* for platform scaling — module catalog, dependency guard, activity templates with roles/widgets/terminology, transactional tenant provisioning, subscriptions. (Docs 01 §11, 02 §10)

**3. What overlaps, and where do looks deceive?**
Both have "modules" and "activities" — but A's module system is a **runtime** (real records) and B's is a **catalog + demo renderer**; they are complementary layers, not duplicates. Name-collision traps documented: B `accounting` (fake) vs A engine; B `appointments` ≠ A `meetings`; B `Module` (catalog entry) vs A `module_definitions` (instance config). (Docs 03, 06)

**4. How do the core workflows run today?**
A: auth → company/activities → prefix-isolated domains; CRM funnel (lead→deal→quotation→contract→invoice→journal); HR cycle (hire→geo attendance→leave/timesheets→approvals); module records via revision-guarded transactions. B: platform admin provisions a tenant transactionally (org+owner+modules+roles+subscription); tenants see mock data. (Doc 04 — 11 Mermaid diagrams)

**5. How do the architectures compare?**
Across 20 dimensions (doc 05): A wins tenancy/isolation/auth/RBAC/business depth/testing/compliance; B wins platform-ops patterns (provisioning, subscriptions, audit) and data-driven vertical modeling. Verdict: A is the body; B contributes the nervous system for scaling.

**6. How do B's concepts map onto A's?**
Full mapping table (doc 06): `Organization`→`companies/{id}`; `TENANT_OWNER`→`super_admin`; `BusinessTemplate`→new `activity_templates`; `Module`→new `module_catalog`; `OrganizationModule`→`module_definitions` (+`enabled`); `Subscription`/`Branch`/`AuditLog`→new Firestore collections; `terminology`→i18n overlays. A's names stay canonical.

**7. What happens to every capability?**
35 capabilities classified + 13 cross-cutting decisions (doc 07): 13 KEEP_D_ARROW · 4 MERGE_AND_REFACTOR · 9 IMPORT_FROM_PROJECT_B · ~15 modules bundled as REBUILD_WITH_EXISTING_CORE · 2 KEEP_AS_SEPARATE_DOMAIN · 1 DEPRECATE · 5 REJECT · 0 ADAPTER_INTEGRATION (reserved for future payment gateway). Each with documented reason.

**8. What is the target architecture?**
One runtime (A), one tenancy model, **one three-layer module system** (catalog → provisioning → engine), data-driven activity templates, extended platform-admin console, new platform collections (catalog/templates/plans/audit/subscription/branches-deferred), Firebase Auth retained. (Doc 08)

**9. How is data consolidated?**
Firestore-only. B's 17 Prisma models re-homed (doc 09); existing A collections and shapes frozen; optional fields only going forward (old docs keep working); every new collection rules-gated and emulator-tested first; **no production data migration** (B holds demo data only).

**10. How are security and RBAC unified?**
Firebase Auth stays; B's JWT stack rejected on verified findings (secret fallback, broken refresh, localStorage tokens). Typed RBAC stays; B's role presets import as validated template data. Rules strategy: additive-only blocks with CI byte-compare of existing segments. New platform permission atoms appended. (Doc 10)

**11. How do the two "custom module" systems unify?**
Layered single source of truth (doc 11): catalog (what can exist) → provisioning with dependency guard (what a company has) → A's engine with transactions/revisions (what users do). Existing definitions need no migration. Guard rails prevent any second runtime.

**12. How is the frontend consolidated?**
A's SPA wholesale; B's shell/kit/demo pages rejected; new console surfaces (wizard, templates, subscriptions, audit) + vertical pages built on A patterns/HeroUI with bilingual RTL; terminology overlays via i18n namespaces. (Doc 12)

**13. What is the roadmap?**
Phase 0 hygiene (incl. protecting uncommitted invite/HR WIP) → 1 catalog/templates → 2 provisioning/subscriptions/audit → 3 restaurant playbook → 4 car-wash/retail/salon → 5 A's own placeholders → 6 deferred (branches, widgets, gateway). Each phase emulator-gated with rollback = revert. (Doc 13)

**14. How will it be tested?**
Emulator-first always: rules negative tests (cross-tenant, append-only audit), guard unit tests (cycles/dangling), provisioning transaction tests, backward-compat fixtures with old-shape docs, per-vertical suites, CI rules-diff guard. Production Firebase is never a test bed. (Doc 14)

**15. What are the risks?**
12-item register (doc 15), top three: duplicate module systems (mitigated by ADR-0002), isolation regression (additive rules + tests), WIP collision (Phase 0 gate). Residual risk assessed low with mitigations; scope creep explicitly bounded by phase gates.

**16. Is Phase One complete and acceptable?**
Yes — all 16 acceptance criteria verified (doc 16), with 4 non-blocking open items recorded (clone hash verification, B seed inconsistencies, per-vertical schemas deferred by design, role-template semantics at authoring time). **Implementation awaits explicit approval.**

---

## The Three Strategies

### Strategy A — Conservative
Keep A untouched; read B as documentation; hand-build verticals someday.

- ✅ Zero integration risk
- ❌ Discards B's only real value (catalog/templates/provisioning/subscriptions designs) — they'd be reinvented from scratch
- ❌ Vertical delivery stays code-only and slow; no monetization model
- **Verdict:** Safe but leaves value on the table; slowest to revenue.

### Strategy B — Balanced (Selective Architectural Integration) ⭐ RECOMMENDED
A is the runtime; B's structural systems re-implemented natively; verticals rebuilt on A's engine; B's insecure/demo runtime rejected wholesale.

- ✅ Captures 100% of B's genuine value, 0% of its liabilities
- ✅ Additive-only changes; emulator-gated; rollback-safe; zero data migration
- ✅ Verticals gain A capabilities B never had (double-entry ledger, compliance, RBAC, i18n)
- ⚠️ Requires disciplined phase gates (R4 scope-creep risk is real but bounded)
- **Verdict:** Highest value-per-risk; honors every merger constraint.

### Strategy C — Full Architectural Consolidation
Merge both codebases/stacks — either dual data layers (Firestore + Prisma) or rewriting A onto B's Next.js/Prisma.

- ❌ Violates the constraints: duplicate business logic, competing sources of truth, tenant-isolation rework
- ❌ Imports B's security debt (JWT fallback, broken refresh, localStorage tokens) or forces re-securing it
- ❌ Rewrites the larger, working, production system (~137K LOC) to match a prototype (~23K LOC)
- ❌ SQLite has no production path; dual-DB means dual-consistency
- **Verdict:** Rejected — maximum risk for negative net value.

## Decision Matrix

| Criterion (weight) | Conservative | **Balanced** | Full |
|---|---|---|---|
| Single source of truth (mandatory) | ✅ | ✅ | ❌ |
| Tenant isolation preserved (mandatory) | ✅ | ✅ | ⚠️/❌ |
| Security posture | ✅ | ✅ | ❌ |
| Captures B's real value | ❌ | ✅ | ✅* |
| Backward compatibility | ✅ | ✅ | ⚠️ |
| Effort to first new vertical | High | Medium | Very high |
| Rollback safety | ✅ | ✅ | ❌ |
| Time to monetization (subscriptions) | Slow | Medium | Slowest |

\* only after paying the rewrite cost.

## What Approval Unlocks

Approving this report + Strategy B authorizes **Phase 0 only** (doc 13): landing/quarantining the in-progress invite/HR work, baseline emulator run, clone hygiene, and archiving B's knowledge into `docs/merger/research/`. Each subsequent phase returns for its own gate review.

---

*Evidence trail: docs 01–16 · ADR-0001…0010 · all claims cite source files in the repositories.*
