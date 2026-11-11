# ADR-0004 — Firestore is the only operational datastore

- **Status:** Proposed (Phase One)

## Context
Project B uses Prisma + SQLite with 17 models. Project A uses Firestore with a rules-enforced tenant hierarchy. Running both would create two sources of truth, two consistency models, and no path to production for SQLite.

## Decision
All B models are **re-homed as Firestore designs** (doc 09): catalog/templates/plans/audit as platform collections; subscription/branches as company subcollections; role mechanics rejected in favor of A's typed RBAC (data presets only). No Prisma, no SQLite, no dual-write adapters in the unified platform.

## Consequences
- Zero data migration: B contains demo data only; nothing is worth moving.
- Existing A collections and shapes frozen; consolidation purely additive.
- Every new collection requires rules blocks + emulator tests before deploy.
- B's transactional provisioning intent is preserved via Firestore batch/transactions.
