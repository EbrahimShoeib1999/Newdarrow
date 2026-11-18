# DATA_AUDIT_REPORT.md

## 1. Audit Scope and Verified Database Targets

| Item | Value | Status |
|------|-------|--------|
| Workspace root | `E:\real projects\DArrow\NewDArrow\d-arrow-business` | VERIFIED |
| Git branch | `main` | VERIFIED |
| Git HEAD | `abd7c3b` — Phase 3 security hardening | VERIFIED |
| Git working tree | 1 pre-existing change: `backend/package-lock.json` (generated artifact, untouched) | VERIFIED |
| Local PostgreSQL | `localhost:5432`, service `postgresql-x64-18` | VERIFIED |
| Development database | `darrow_dev` (owner: `darrow`) | VERIFIED — connected and queried |
| Test database | `darrow_test` (owner: `darrow`), 0 tables — schema not yet pushed | VERIFIED — connected, empty |
| Production database | `darrow` — does NOT exist locally | VERIFIED — not accessed, not touched |
| Read-only enforcement | Only `SELECT` queries executed; no INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE | VERIFIED |

### Databases inspected

| Database | Tables | Rows inspected | Production? |
|----------|--------|----------------|-------------|
| `darrow_dev` | 19 tables | All tables queried | NO — local development |
| `darrow_test` | 0 tables | Empty | NO — local test |
| `darrow` | N/A | Not accessed | YES — production, absent locally |

---

## 2. Exact Read-Only Queries and Inspection Methods

All queries executed via `psql -f <sql_file>` against `darrow_dev` as user `darrow`. No write operations performed.

| Query file | Purpose |
|------------|---------|
| `audit_aggregate_counts.sql` | Row counts for all core tables |
| `audit_multi_membership.sql` | Users with > 1 CompanyMembership |
| `audit_missing_membership.sql` | Users with 0 active memberships |
| `audit_employee_consistency.sql` | Employee.companyId vs membership.companyId mismatches |
| `audit_invitations.sql` | Pending invitations and existing user/membership overlap |
| `audit_refresh_tokens.sql` | Refresh tokens linked to users and memberships |
| `audit_all_memberships.sql` | Complete membership listing |
| `audit_all_employees.sql` | Complete employee listing |
| `audit_companies.sql` | Complete company listing with owner and membership counts |

---

## 3. Aggregate Counts (darrow_dev)

| Metric | Count |
|--------|-------|
| Total users | 1 |
| Total companies | 1 |
| Total memberships | 1 |
| Total employees | 0 |
| Total invitations | 0 |
| Total refresh tokens | 1 |
| Active memberships | 1 |
| Suspended memberships | 0 |
| Removed memberships | 0 |
| Pending invitations | 0 |

---

## 4. Detailed Findings

### 4.1 Multiple Memberships per User — VERIFIED CLEAN

**Query:** `audit_multi_membership.sql` — users with `COUNT(cm.id) > 1`

**Result:** 0 rows. No user has more one CompanyMembership.

**Finding:** No multiple-membership violations exist in `darrow_dev`.

**Status:** VERIFIED

---

### 4.2 Missing Memberships — VERIFIED CLEAN

**Query:** `audit_missing_membership.sql` — users with 0 ACTIVE memberships

**Result:** 0 rows. Every user has exactly one ACTIVE membership.

**Finding:** No missing-membership violations exist in `darrow_dev`.

**Status:** VERIFIED

---

### 4.3 Employee Consistency — VERIFIED CLEAN (with caveat)

**Query:** `audit_employee_consistency.sql` — Employee.companyId vs active membership.companyId mismatches

**Result:** 0 rows.

**Caveat:** There are 0 employees in `darrow_dev` (`audit_all_employees.sql` returned 0 rows). The consistency check is trivially satisfied because no employees exist.

**Finding:** No employee/membership company mismatches exist. However, the table is empty so this is a vacuum truth.

**Status:** VERIFIED (with caveat: empty table)

---

### 4.4 Invitation Risks — VERIFIED CLEAN (with caveat)

**Query:** `audit_invitations.sql` — PENDING invitations joined to existing users and their memberships

**Result:** 0 rows. No pending invitations exist.

**Finding:** No invitation risks exist in `darrow_dev`. However, the table is empty so this is a vacuum truth.

**Current code risk (code inspection, not data):** `auth.service.ts:182-191` (`acceptInvitation`) creates a `CompanyMembership` without checking if the user already has an ACTIVE membership. This is a code-level gap that would allow a user to accept a second company's invitation and violate the one-account-one-company invariant. **This must be fixed in application code regardless of current data state.**

**Status:** VERIFIED (data is clean; code gap identified separately)

---

### 4.5 Token and Session Risks — VERIFIED

**Query:** `audit_refresh_tokens.sql` — refresh tokens linked to users and memberships

**Result:** 1 refresh token:
- Token ID: `cmwdev8us0001vywcrd5uksf0` (prefix `f0dd78ca`)
- User ID: `6582a034-5d6b-4892-8dc0-2a36104e282e` (test@darrow.com)
- Company: `test-company-6582a034`, membership status ACTIVE
- Expires: 2026-11-19 10:34:37.586
- Created: 2026-11-12 10:34:37.588

**Code inspection findings (not data mutations):**

1. **`auth.service.ts:generateTokens()` (line 203-206):** Uses `findFirst({ where: { userId, status: "ACTIVE" } })` without `orderBy`. If multiple memberships existed, the JWT would receive a non-deterministic company context. With `@@unique([userId])`, this becomes safe (at most one row).

2. **`auth.service.ts:refresh()` (line 119-133):** Calls `generateTokens(stored.user)` which re-queries membership from DB. Old refresh tokens are deleted on rotation (line 130). However, if a membership changes between token issuance and refresh, the new token reflects the new membership — old tokens are invalidated by rotation.

3. **`auth.service.ts:logout()` (line 135-137):** Deletes refresh tokens by token value only. Does not delete all user tokens on membership change/removal.

4. **`permissions.guard.ts:50-52:** Uses `findFirst({ where: { userId, status: "ACTIVE" } })` without `orderBy`. Same non-determinism risk as generateTokens if multiple memberships exist.

5. **Platform admin:** `User.isPlatformAdmin` (line 45-47 in guard) short-circuits all company-scoped checks. Platform admins are separate from company membership — correct for the one-account-one-company model.

**Finding:** 1 refresh token exists, 1 user, 1 company — consistent. Code-level risks identified in token generation and guard resolution (non-deterministic `findFirst`). These are resolved by enforcing `@@unique([userId])` at the DB level and changing `findFirst` to `findUnique`.

**Status:** VERIFIED

---

## 5. Complete Membership Listing (darrow_dev)

| Membership ID | User ID | Company ID | Role | Status | Joined At | Invited By | User Email | isPlatformAdmin |
|---------------|---------|------------|------|--------|-----------|------------|------------|-----------------|
| `cmwdeqizq0001vydsh1yzmkho` | `6582a034-5d6b-4892-8dc0-2a36104e282e` | `test-company-6582a034` | ADMIN | ACTIVE | 2026-11-12 10:30:57.441 | (none) | test@darrow.com | false |

**Finding:** Exactly 1 membership for 1 user in 1 company. Fully consistent with one-account-one-company.

**Status:** VERIFIED

---

## 6. Complete Company Listing (darrow_dev)

| Company ID | Name | Owner ID | Deleted At | Membership Count | Statuses | Roles |
|------------|------|----------|------------|------------------|----------|-------|
| `test-company-6582a034` | Test Company | `6582a034-5d6b-4892-8dc0-2a36104e282e` | (none) | 1 | ACTIVE | ADMIN |

**Finding:** 1 company, owned by the single user, with 1 ADMIN membership. OwnerId matches the membership userId. Consistent.

**Status:** VERIFIED

---

## 7. Complete Employee Listing (darrow_dev)

**Result:** 0 employees.

**Finding:** Employee table is empty. No employee consistency violations possible.

**Status:** VERIFIED (empty table)

---

## 8. Complete Invitation Listing (darrow_dev)

**Result:** 0 invitations.

**Finding:** Invitation table is empty. No invitation risks exist in current data.

**Status:** VERIFIED (empty table)

---

## 9. Proposed Reconciliation Categories

| Category | Count in darrow_dev | Resolution Approach |
|----------|--------------------|---------------------|
| Clean (1 user, 1 membership, 1 company) | 1 user | No action needed |
| Multiple memberships per user | 0 | N/A — would require explicitly approved company selection |
| Missing membership (user with 0) | 0 | N/A — user would need invitation or company creation |
| Employee/membership company mismatch | 0 | N/A — would require correcting Employee.companyId |
| Duplicate/inconsistent invitations | 0 | N/A — would require deduplication or revocation |

**Important:** No reconciliation is needed for `darrow_dev`. The database is already in a state compliant with `@@unique([userId])`.

---

## 10. Can `@@unique([userId])` Be Safely Applied?

| Database | Current Users | Current Memberships | Max Memberships per User | Can Apply? | Condition |
|----------|---------------|---------------------|-------------------------|------------|-----------|
| `darrow_dev` | 1 | 1 | 1 | ✅ YES | No duplicates exist; constraint will succeed |
| `darrow_test` | 0 | 0 | 0 | ✅ YES | Empty table; constraint will succeed |
| `darrow` (production) | N/A | N/A | N/A | BLOCKED | Database does not exist locally; production access forbidden |

**Finding:** `@@unique([userId])` can be safely applied to `darrow_dev` and `darrow_test`. Production cannot be assessed locally (database absent, access forbidden).

**Status:** VERIFIED for local databases; BLOCKED for production

---

## 11. Blockers and Unknowns

| # | Blocker / Unknown | Details |
|---|-------------------|---------|
| B1 | Production database (`darrow`) not accessible locally | Cannot verify production data compliance. Must be audited separately before any production migration. |
| B2 | `darrow_test` schema not yet pushed | `darrow_test` has 0 tables. Schema must be pushed before testing migrations there. |
| B3 | Code-level gaps exist regardless of data | `acceptInvitation()` doesn't check existing memberships; `generateTokens()` and `PermissionsGuard` use non-deterministic `findFirst`. These must be fixed in application code even though current data is clean. |
| B4 | `darrow_dev` may contain seed/test data only | The single user/company/membership may be test data from development, not production data. Production may have different data patterns. |

---

## 12. Explicit Recommendation for Next Phase

**Recommendation:** Proceed to Phase 4.1 (Database Schema Change: Enforce Unique Membership per User) for `darrow_dev` only.

**Prerequisites met:**
- ✅ No multiple memberships exist in `darrow_dev`
- ✅ No missing memberships exist in `darrow_dev`
- ✅ No employee consistency violations exist
- ✅ No invitation risks exist in current data
- ✅ Production database not touched or accessed
- ✅ All queries were read-only; no writes performed

**Next steps (require explicit approval):**
1. Add `@@unique([userId])` to `CompanyMembership` in `prisma/schema.prisma`
2. Create and apply Prisma migration to `darrow_dev`
3. Verify constraint in PostgreSQL
4. Fix application code gaps: `acceptInvitation()` membership pre-check, `generateTokens()` `findFirst`→`findUnique`, `PermissionsGuard` `findFirst`→`findUnique`

**Do NOT proceed to production until:**
- Production database is audited for multiple memberships
- Production migration is planned and tested

---

## Final Verification

| Check | Result |
|-------|--------|
| No source files changed | ✅ VERIFIED — `git diff --name-only` shows only `backend/package-lock.json` (pre-existing) |
| No Prisma schema or migration changed | ✅ VERIFIED — only read `schema.prisma` |
| No database writes occurred | ✅ VERIFIED — only `SELECT` queries executed |
| No production service accessed | ✅ VERIFIED — production `darrow` DB absent locally; only `darrow_dev` and `darrow_test` queried |
| Existing uncommitted work untouched | ✅ VERIFIED — `backend/package-lock.json` modification preserved; `docs/architecture/` is new (design docs from prior phase) |

**STOP — awaiting explicit approval before any reconciliation, schema change, migration, or application implementation.**
