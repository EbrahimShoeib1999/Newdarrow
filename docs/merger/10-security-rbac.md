# 10 — Security & RBAC Integration

> How the unified platform enforces tenant isolation, authentication, and authorization. Includes the disposition of Project B's security findings.

## 1. Authentication — Final State

| Concern | Decision |
|---|---|
| Identity provider | **Firebase Auth** (A). B's JWT stack **rejected**: hardcoded secret fallback, broken refresh-token validation, tokens in localStorage (XSS exposure), password hashing in app DB |
| Onboarding | A's invitation-onboarding flow (currently being improved in the working tree — untouched by merger until that work lands) |
| Multi-org switching (B's `switch-organization`) | Deferred design note; A users are company-scoped today. If ever added, it must be a *client-side context switch over separate memberships*, never a token trick |
| Session storage | Firebase Auth SDK managed (never localStorage tokens) |

## 2. RBAC — Final State

**Runtime:** Project A's model is retained intact:

- 181 typed permission atoms — extended additively (new atoms for platform-admin operations, e.g. `platform.tenants.provision`, `platform.templates.manage`, `platform.audit.view`, `platform.subscriptions.manage`).
- 7 static roles with compile-time `ROLE_PERMISSIONS` matrix — **unchanged for existing roles**.
- `effective-permissions.ts` and `role-assignment.ts` remain the guards (privilege-escalation prevention preserved).

**Data contribution from B:** per-activity **starter role presets** (B's `defaultRoles`) become `activity_templates.starterRoles[]` — but every preset is **validated against A's atom list at load time** (a template referencing an unknown atom fails loudly in tests, never silently). This keeps B's flexibility without B's unverifiability.

**Role mapping (B → A):**

| B system role | A role |
|---|---|
| `PLATFORM_ADMIN` | `platform_admin` |
| `TENANT_OWNER` | `super_admin` (company-scoped) |
| `TENANT_USER` | `employee` |
| B per-activity roles (owner/manager/staff/…) | Presets over A roles + permission sets (templates) |

## 3. Tenant Isolation — Final State

- The `firestore.rules` contract remains the single enforcement point: company membership proof + prefix-based domain ownership (`rem_`, `fm_`, `mkt_`, `cln_`, `sch_`, `mod_<activity>_rec_*`).
- New collections follow the same discipline (doc 09 §4): platform collections gated to platform staff; tenant subcollections gated to company members; `platform_audit` append-only; `subscription` tenant-read/platform-write.
- **Rule:** no new collection ships without a rules block + emulator test (enforced in review checklist, doc 14).

## 4. Threats Addressed by Rejecting B's Stack

| B weakness | Risk if merged | Mitigated by |
|---|---|---|
| JWT secret fallback | Credential forgery | Firebase Auth |
| Refresh tokens never stored/validated | Session hijack | Firebase Auth session management |
| Tokens in localStorage | XSS token theft | SDK-managed storage |
| SQLite file DB | Data corruption/exfiltration | Firestore + rules |
| No route input validation | Injection/abuse | A's Zod schema culture extended to all new services |
| App-level-only tenant isolation | Cross-tenant leaks | Rules-enforced isolation (A) |

## 5. New Permission Atoms (proposed, additive)

```
platform.tenants.view        platform.tenants.provision
platform.tenants.status      platform.templates.view
platform.templates.manage    platform.catalog.view
platform.catalog.manage      platform.subscriptions.view
platform.subscriptions.manage  platform.audit.view
modules.definitions.manage   modules.enable.toggle
```

Assigned initially to `platform_admin` only; `super_admin`/`admin` get tenant-scoped `modules.*` atoms.

## 6. Audit & Compliance Posture

- `platform_audit` (from B's AuditLog design): append-only, records provisioning/status/subscription/template changes with actor + timestamp. Rules deny update/delete.
- Existing feature-level logs (CRM lead log etc.) remain domain-local.
- KSA compliance features (ZATCA QR, VAT, Zakat) are untouched A assets.

## 7. Security Review Gates (implementation phases)

1. Rules diff review for every `firestore.rules` change — no deletions of existing blocks.
2. Emulator rules suite must pass 100% before any deploy.
3. New services must validate inputs with Zod (A culture) — B's unvalidated-route anti-pattern banned.
4. No secrets in client code; env via Vite config as A does today.
5. Production Firebase changes only via approved scripted release with rollback plan (never ad-hoc from a dev machine).

## 8. Non-Goals

- No migration of B users/tokens (B has no production users worth migrating — demo data only).
- No custom password flows ever (Firebase Auth handles credentials).
- No weakening of the prefix contract to accommodate B concepts.
