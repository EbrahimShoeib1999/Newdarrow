# ADR-0003 — Firebase Auth retained; Project B's JWT stack rejected

- **Status:** Proposed (Phase One)

## Context
Project B implements custom JWT auth: login/register/me/logout/refresh/switch-organization. Source-verified findings: JWT secret has a hardcoded default fallback; the refresh-token flow never stores or validates tokens server-side; tokens persist in localStorage; passwords hashed in the app DB (SQLite).

## Decision
Retain Firebase Auth + A's invitation-onboarding as the only authentication path. Reject all of B's auth code. Future multi-org switching (B UX concept) is deferred and must be re-designed on membership-doc context switching, never token tricks.

## Consequences
- No credential handling in app code; no secret management burden; session storage managed by the SDK.
- Tenant provisioning cannot create passwords — it creates **invites** (A's secure pattern) instead.
- B's `switch-organization` API is not ported.
