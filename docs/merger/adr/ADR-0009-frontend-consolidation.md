# ADR-0009 — Frontend consolidates on A's SPA (Vite + React Router + HeroUI)

- **Status:** Proposed (Phase One)

## Context
Project A: Vite SPA, React Router v7 with activity-gated lazy route trees, HeroUI, zustand + TanStack Query, i18next with RTL. Project B: Next.js 16 App Router used as an SPA (client-state view switching — App Router benefits unused), shadcn/ui kit, no i18n framework.

## Decision
A's frontend is the frontend. B's shell, kit, and demo pages are rejected (docs 12, 07 B1/B20/B11). New surfaces (provisioning wizard, template preview, subscription manager, audit viewer, vertical pages) are built with A's patterns and HeroUI. B's per-activity **terminology** concept imports as i18n overlay namespaces. New screens are bilingual + RTL from day one.

## Consequences
- One design language, one bundle, one routing model.
- Vertical-specific UI inspiration may be taken from B screenshots (content only, never code).
- No Next.js, Prisma, or shadcn dependencies enter `package.json`.
