# ADR-0008 — Import subscription, audit, and branch models as Firestore designs

- **Status:** Proposed (Phase One)

## Context
Project A lacks platform monetization, platform-level audit, and multi-branch. Project B has workable designs: `Subscription` (plan/status per org), `AuditLog` (structured trail), `Branch` (per-org locations) — implemented on the rejected Prisma stack, but the shapes are sound.

## Decision
Import the **designs**, re-homed on Firestore (doc 09 §3):
- `plans` (platform) + `companies/{id}/subscription`
- `platform_audit` (append-only)
- `companies/{id}/branches` — **deferred** to Phase 6 (not needed by first verticals)

Subscriptions start as plan/state tracking only; payment gateway integration is the reserved `ADAPTER_INTEGRATION` classification for a future phase.

## Consequences
- A gains a monetization and compliance posture without any runtime from B.
- Branch deferral keeps early phases vertical-focused.
- Audit records provisioning/status/template/subscription actions with actor + timestamp.
