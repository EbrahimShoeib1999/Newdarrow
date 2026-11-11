# Phase 1 — 03 · RBAC, Authorization & Tenant Isolation

> **Status:** Design for approval. Marks: **[V]** verified · **[D]** design decision.

## 1. The current model (contract to preserve) — all verified this session

| Element | Current implementation |
|---|---|
| Roles (7) | `platform_admin, super_admin, admin, manager, global_hr_manager, employee, viewer` — `auth.types.UserRole` |
| Permission atoms | Dot-namespaced strings (`tasks.view`, `crm.manage_leads`, `people.approve_leave`) declared in `src/lib/permissions/index.ts` (`ROLE_PERMISSIONS`, `hasPermission`) — **70 atoms** (verified by direct count at Phase 2 start, 2026-11-11; corrects the "181" figure inherited from Phase One merger evidence) |
| Portal sub-roles | Per-portal overrides: Tasks (admin/manager/member/viewer), CRM (admin/manager/sales/viewer), People (admin/manager/hr/employee), Billing (admin/manager/accountant) — `sub-roles.ts` |
| Effective permissions | role → portal sub-role restriction → per-user `customPermissions` override → `hasEffectivePermission` |
| Portal access | `user.portalAccess` subset (super-admin-assigned, restricted to role defaults) — `portal-access.ts` |
| Invite policy | `INVITABLE_ROLES = employee/viewer/manager/global_hr_manager`; `canInviteRole`/`canManageInviteRole` mirror the Firestore rules invite branch — `role-assignment.ts` |
| Resource-level context | `branchId`, `workLocationId`, `countryScope` on the user doc; attendance/HR rules apply branch scoping |
| Server enforcement | `firestore.rules` (73 KB): tenant isolation on every collection, role checks, INVITABLE_ROLES invite constraints, domain-collection prefix ownership, least-privilege for clinical/school data |

**Non-negotiable:** the NestJS backend must enforce **at least** everything `firestore.rules` enforces today. Anything less is a regression; anything more must be justified per rule.

## 2. Target model (DB-backed)

```
JwtAuthGuard ──▶ TenantGuard ──▶ PermissionsGuard ──▶ EntitlementGuard (module routes)
   (identity)     (company ctx)    (atom grant)          (module + plan)
```

1. **Grants are data** (Directive §2): `RolePermission(role, atom)` + `CompanyMembership.customPermissions` + `portalSubRoles`/`portalAccess` (JSON on membership). Role assignment matrix (`role-assignment.ts` logic: who may assign/manage which roles) becomes service-enforced policy **plus** a startup self-test asserting it agrees with the seeded grant tables.
2. **Permission atoms stay code-defined** **[D8]**: a manifest module (ported from `src/lib/permissions/index.ts`) exports the atom list + default role grants; a seed script syncs them to the DB; a checksum assertion detects drift at boot. Code review keeps the vocabulary stable; the DB keeps grants queryable per tenant.
3. **Company context is derived, never supplied**: `TenantGuard` resolves `companyId` from the authenticated principal's active membership. Any client-supplied `companyId`/`role`/permission value is validated against server state (Directive §6).
4. **platform_admin** is a global flag on `User` (+ optional platform-scope grants), not a company membership role — matching today's semantics **[V: platform_admin referenced separately from ALL_ROLES]**.

## 3. `firestore.rules` → backend conformance mapping

Every rule family becomes an explicit backend check with a ported test (the emulator suites are the source scenarios — see §4):

| Rules family [V: match blocks] | Backend enforcement |
|---|---|
| `users/{userId}` | read/update own profile; admins read company roster (People module service) |
| `invites/{token}` | `MembershipsModule`: INVITABLE_ROLES enum + `canInviteRole`/`canManageInviteRole` service policy + tenant scope — **the exact scenarios in `test-invites-rules.mjs` become API authz tests** |
| `companies`, `settings` | company admins manage; members read |
| `attendance`, `hr_*`, `payroll_payments` | People module: role + branch/workLocation scoping (port `test:attendance-authz`, `test:attendance-all-employees-audit` scenarios **[V]**) |
| `invoices`, `bills`, `vouchers`, `journals`, `payments` | Billing module: billing sub-role grants + company scope |
| `rem_*` (leases, installments, payments, deposits, expenses) | RealEstate module: activity ownership + role grants |
| `conversations`, `messages` | Chat module: conversation-participant membership check |
| `client_reports`, `publicInvoiceShares` | signed public tokens (read-only public endpoints, no auth) |
| `module_definitions` + `mod_*_rec_*` wildcards | Custom modules runtime: engine `canPerformModuleAction` = atom AND role grant **[V: engine access resolution]** + entitlement guard |
| domain-collection prefix ownership (`rem_`, `fm_`, `mkt_`, `cln_`, `sch_`, …) | Tenant + activity-ownership check in each vertical module (prefix contract mirrored in `activity-domain.ts` **[V]**) |
| clinical/school least-privilege sensitivity **[V: SENSITIVE_DOMAIN_ACTIVITIES]** | stricter default grants for those modules; documented and tested |

## 4. Conformance test strategy

- Port the two invite suites **[V]** to API-level authz tests: same role × action × tenant matrix, executed as HTTP calls (supertest) against the NestJS app with a seeded DB — the **acceptance gate for the first migrated domain**.
- Same pattern per domain: each existing emulator suite (`attendance-authz`, `attendance-all-employees-audit`, domain workflow suites **[V: 104 test scripts]**) is re-expressed as backend tests in the corresponding module before that domain's Firebase retirement.
- Tenant isolation matrix (Directive §10): every endpoint × {same tenant, cross tenant, unauthenticated, under-privileged} → expected {200, 404, 401, 403}.

## 5. What changes for the frontend

Nothing structural: `hasEffectivePermission` and the permission context continue to exist client-side for UX gating, but their inputs come from the API (`GET /api/v1/me` returns role, effective atoms, portals) instead of Firestore user docs. **Route guards remain UX affordances, not security boundaries** (Directive §6).
