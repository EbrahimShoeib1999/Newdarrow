# ADR-0005 — Static typed RBAC retained; role templates become data

- **Status:** Proposed (Phase One)

## Context
Project A: 181 typed permission atoms, 7 roles, compile-time `ROLE_PERMISSIONS` matrix, effective-permission resolver, role-assignment guard. Project B: DB-driven `Role`/`Permission`/`RolePermission` rows plus per-activity `defaultRoles` presets (owner/manager/staff…).

## Decision
A's static typed model remains the **runtime** enforcement. B's per-activity role presets import as **data** (`activity_templates.starterRoles[]`), each validated at load time against the typed atom union — an unknown atom is a hard failure, never silent. New atoms are appended additively (platform.* / modules.* per doc 10 §5); none renamed or removed.

## Consequences
- Compile-time safety where it matters (enforcement), data flexibility where it helps (onboarding presets).
- B's runtime role editing (tenant-created roles) is **not** adopted — deferred indefinitely.
- Privilege-escalation protections (`role-assignment.ts`) extend unchanged.
