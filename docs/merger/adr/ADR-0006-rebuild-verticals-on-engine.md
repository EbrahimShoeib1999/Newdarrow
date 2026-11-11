# ADR-0006 — New verticals are rebuilt on the module engine, never ported from demos

- **Status:** Proposed (Phase One)

## Context
Project B's tenant business modules (pos, orders, kitchen, menu, tables, vehicles, work orders, loyalty, discounts, appointments, prescriptions, delivery…) render `DEMO_LIST_DATA` / `generateMockData`. They demonstrate layout, not logic. Project A's engine provides real records with validation, transactions, and revisions.

## Decision
Every B business module is delivered on A's engine via the Phase-3 playbook: catalog descriptor → template entry → engine field schemas → record collections (`mod_<activity>_rec_*`) → optional special pages (POS entry, kitchen display) written as A feature pages. POS-style transactions integrate with A's billing engine (order → invoice → journal). B's demo code and mock data are never copied.

## Consequences
- Verticals gain capabilities B never had (double-entry ledger, ZATCA-compliant invoices, permissions, i18n, RTL).
- First vertical (restaurant) is the playbook proof; car-wash/retail/salon follow mechanically.
- B's `appointments` must not be conflated with A's `meetings` (different business meaning — doc 06 §5).
