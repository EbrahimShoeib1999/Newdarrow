# 12 — Frontend Consolidation

> How the two UIs resolve into one. Executive rule: **Project A's frontend is the frontend.** Project B's UI is a reference, not a port.

## 1. Stack Decision

| Aspect | Decision | Reason |
|---|---|---|
| Framework | Vite + React 19 SPA (A) | B's Next.js was an SPA anti-pattern (App Router unused); porting would mean a rewrite for zero benefit |
| Component kit | **HeroUI only** (A) | Mixing shadcn would double bundle, split design language, complicate maintenance (B20 rejected) |
| Routing | React Router v7, activity-gated lazy trees (A) | Preserves the prefix/route contract |
| State | zustand + TanStack Query (A) | Unchanged |
| Styling | Tailwind + A theming | Unchanged |
| i18n | i18next + **new per-activity terminology overlays** | B concept layered on A framework (doc 11 §3.5) |

## 2. UI Surface Inventory After Merger

| Surface | Origin | Notes |
|---|---|---|
| All existing A pages | A | Untouched |
| Platform Admin console (extended) | A + B-inspired | New tabs: Provisioning Wizard, Templates, Catalog, Subscriptions, Audit Viewer |
| Provisioning wizard | **New** (B16 UX pattern) | Multi-step: activity → module set (dependency-aware) → owner invite → plan |
| Template preview | **New** (B19 concept) | Shows what a vertical includes before provisioning |
| New vertical pages | New on A patterns | Engine-driven record UIs + special pages (POS/kitchen) |
| Terminology overlays | **New** (B17) | Locale JSON per activity |
| B tenant demo pages | **Rejected** | Mock-data renderer never ships |

## 3. Design Language Rules

1. Every new screen follows A's existing layouts: list page + record layout + modals + print documents (as CRM/Billing do).
2. B's shadcn screenshots may inform *content* (what fields a POS screen needs) — never *code*.
3. RTL must work from day one for every new screen (A's `dir` automation + bilingual labels; B's registries provide the ar/en strings to harvest).
4. Print/PDF needs follow A's existing print-document components (InvoicePrintDocument pattern).

## 4. Component Reuse Map (B reference → A building blocks)

| B demo screen | A building block to use |
|---|---|
| Generic list views | A tables (EmployeeTable/DealsListView patterns) |
| Dashboard widget grid | A dashboard pages; future config-driven widgets (roadmap) |
| Module settings forms | A settings modals + engine field schemas |
| Onboarding wizard | New — modeled on A modals/steps, B flow order |
| POS/kitchen displays | New feature pages (fast-entry, ticket board) — A routing + HeroUI |

## 5. Performance & Bundle

- New vertical pages lazy-loaded exactly like existing activity route trees.
- Catalog/templates read via TanStack Query with stale caching (platform data changes rarely).
- No new heavy deps: no Next, no Prisma adapter, no shadcn — bundle stays lean.

## 6. Developer Experience

- Feature folder structure preserved (`src/features/<domain>`).
- New vertical checklist (docs 11 §4) becomes `docs/implementation/` guide.
- Storybook/visual tests out of scope (A has none today — not introduced by merger).

## 7. Explicit Non-Goals

- No redesign of existing A pages.
- No white-labeling engine beyond existing company theming.
- No B code vendoring (including its UI kit) — reference only.
