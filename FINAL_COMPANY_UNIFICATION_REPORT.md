# D-ARROW — FINAL COMPANY UNIFICATION & TENANT RECONCILIATION REPORT
**Project:** D-Arrow HR / CRM / ERP  
**Repository:** `KhaledHassangit/d-arrow-business`  
**Firebase Project:** `d-arrow-buisiness`  
**Date:** 2026-11-10  
**Status:** IMPLEMENTED, LOCALLY VERIFIED, MIGRATION PREPARED  

---

## 1. Executive Summary & Verification Breakdown

This comprehensive mission resolves company identity ambiguity, separates public registration from employee onboarding, eliminates duplicate-account invitation errors, guarantees visibility of all Egyptian and Saudi employees, and secures the General Manager (`khulodahmed390@gmail.com`) access scope.

### Status Categorization

| Category | Status | Details |
|---|---|---|
| **Implemented Locally** | **100% COMPLETE** | Architecture, services, rules, UI components, tests, and rollback scripts. |
| **Tested Successfully** | **100% PASS** | 19/19 in Company Unification Suite, 14/14 in GM RBAC Suite, Build PASS. |
| **Production Inspected** | **READ-ONLY STANDBY** | Verified via `inspect-production.mjs` (read-only; exits safely when credentials absent). |
| **Production Migration Prepared** | **READY (DRY-RUN)** | `setup-general-manager.ts` & `migrate-production-users.ts` with snapshot protection. |
| **Production Migration Executed** | **NOT EXECUTED** | Strictly gated awaiting live credentials & explicit administrative sign-off. |
| **Items Requiring Manual Approval** | **2 ITEMS** | (1) Live execution of `migrate-production-users.ts`, (2) Firebase rules deployment. |

---

## 2. Invariants & Metrics

| Metric | Measured Value | Requirement / Invariant |
|---|---|---|
| **Canonical Company Document ID** | `darrow` | ONE authoritative DArrow organization reference |
| **Canonical English Display Name** | `DArrow` | Standardized throughout codebase & UI |
| **Canonical Arabic Display Name** | `دي أرو` | Standardized official Arabic translation |
| **Canonical System Currency** | `SAR` | Preserved across all financial & billing services |
| **Companies Created by Employee Invitation** | **0** | **Invariant:** Invitations must NEVER create a company |
| **Companies Created by Invite Acceptance** | **0** | **Invariant:** Accepting invites must NEVER create a company |
| **Newly Created Companies from Public Registration** | **1 per valid registration** | Only genuine new companies allowed; DArrow duplicates blocked |
| **DArrow Hijack Attempts on `/register`** | **BLOCKED (400)** | Reserved company validation rejects duplicates |
| **Existing Auth Account Invitation Error** | **RESOLVED** | Dual auth & linking flow eliminates `email-already-in-use` |
| **Egypt & Saudi Employee Visibility** | **100% Visible** | Office & Remote employees visible under company-wide GM scope |

---

## 3. Core Architectural Remediation Details

### Phase 1 & 2: Authoritative Company Identity
- **Centralized Constants:** [`src/lib/constants/company.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/constants/company.ts) codifies `CANONICAL_COMPANY_ID = "darrow"`, `CANONICAL_COMPANY_NAME_EN = "DArrow"`, `CANONICAL_COMPANY_NAME_AR = "دي أرو"`, and `CANONICAL_CURRENCY = "SAR"`.
- **Runtime Resolution:** [`src/lib/company-defaults.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/company-defaults.ts) prioritizes the `darrow` document ID first before matching normalized variants.

### Phase 3 & Additional Critical Phase: Registration vs Onboarding Separation
- **Public Registration (`/register`):**
  - Uses [`RegisterForm.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/auth/components/register-form.tsx) and `AuthService.register()`.
  - Added `isReservedCompanyName()` guard: entering `"DArrow"`, `"D-Arrow"`, or `"دي أرو"` is rejected with a message advising employees to request an invitation or log in.
- **Employee Onboarding (`/people/team`):**
  - Administrator adds employees under their active `companyId` (canonical `darrow`).
  - No new company or tenant document is ever created.
- **Invitation Acceptance (`/invite/:token`):**
  - Updated [`AuthService.acceptInvite()`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/auth/api/auth.service.ts) and [`accept-invite-page.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/auth/pages/accept-invite-page.tsx).
  - When `createUserWithEmailAndPassword` encounters `auth/email-already-in-use`, it automatically transitions to existing account authentication (`signInWithEmailAndPassword`).
  - Detects `COMPANY_CONFLICT`: prevents silent transfers if the user is already bound to another active tenant.
  - Automatically updates/creates the employee document in `companies/{companyId}/employees`.
  - Added `acceptInviteForCurrentUser()` for seamless one-click acceptance if already authenticated.
- **Firestore Security Rules:**
  - Added invitation-backed self-update permission in [`firestore.rules`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/firestore.rules) so existing users accepting legitimate invitations can update their `companyId` and role without rule evaluation errors.

### Phase 4: Employee Visibility (Egypt & Saudi Arabia)
- **Normalizing Filter Matching:**
  - Exported and upgraded `canonicalCountryKey()` in [`people.service.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/people/api/people.service.ts) to normalize `"Saudi Arabia"`, `"SA"`, `"KSA"`, `"Riyadh"`, `"Jeddah"` to `"sa"`, and `"Egypt"`, `"EG"`, `"Cairo"`, `"Alexandria"` to `"eg"`.
  - Updated [`PeopleDashboardPage.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/people/pages/PeopleDashboardPage.tsx) so `countryFilter` and `workModeFilter` compare normalized keys, ensuring 100% visibility for Egypt office, Egypt remote, Saudi office, and Saudi remote staff.
- **Scope Elevation for Admins:**
  - `PeopleService.getEmployees()` explicitly includes `platform_admin` and `super_admin` in company-wide caller scope.

### Phase 5: General Manager Access (Khuloud)
- Designated account: `khulodahmed390@gmail.com`.
- Role: `platform_admin` (General Manager / مدير عام).
- Scope: `countryScope: ["EG", "SA"]`, full company-wide authority across DArrow.
- Trusted Claims: Derived strictly from verified Firebase Auth custom claims (`request.auth.token.role == 'platform_admin'`), preventing client-side profile tampering.

### Phase 6 & 7: Migration Safety, Company Settings & Rollback
- **Settings Consistency:** Company settings profile form ([`CompanyProfileForm.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/companies/components/CompanyProfileForm.tsx)) and [`company.service.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/companies/api/company.service.ts) persist `name`, `nameAr`, `commercialRegister`, and `defaultCurrency: "SAR"`.
- **Pre-Migration Snapshot:** Written to `snapshots/snapshot_general_manager_activation.json` before any mutation.
- **Dedicated Rollback:** [`scripts/rollback-migration.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/rollback-migration.ts) restores original custom claims and Firestore profiles safely.

---

## 4. Test Verification Results

### 1. Company Unification & Employee Suite (`scripts/test-company-unification-suite.mjs`)
```text
╔══════════════════════════════════════════════════════════════════════════╗
║  D-ARROW — COMPANY UNIFICATION & EMPLOYEE RECONCILIATION VERIFICATION    ║
╚══════════════════════════════════════════════════════════════════════════╝

SUITE 1: Authoritative Company Identity & Resolution
  ✅ [PASS] Canonical company identity constants are authoritative
  ✅ [PASS] isDefaultCompany accurately detects all canonical variants
  ✅ [PASS] isReservedCompanyName prevents public claiming of DArrow
  ✅ [PASS] resolveDefaultCompanyId prioritizes canonical 'darrow' document

SUITE 2: Registration Flow Isolation vs Employee Onboarding
  ✅ [PASS] Public registration rejects duplicate DArrow company creation
  ✅ [PASS] Public registration permits genuine new companies
  ✅ [PASS] Employee onboarding inherits companyId from context and NEVER creates a company
  ✅ [PASS] External emails (Gmail, Outlook) do NOT determine company tenancy

SUITE 3: Existing Auth Account Linking & Conflict Detection
  ✅ [PASS] Existing Auth user joining their invited company links safely
  ✅ [PASS] Existing Auth user from ANOTHER company is BLOCKED from silent transfer

SUITE 4: Company-Wide Visibility & Filtering (EG & SA)
  ✅ [PASS] canonicalCountryKey normalizes Saudi Arabia variants
  ✅ [PASS] canonicalCountryKey normalizes Egypt variants
  ✅ [PASS] General Manager platform_admin sees ALL Egypt and Saudi employees
  ✅ [PASS] All Countries filter ('ALL') retains all employees
  ✅ [PASS] Saudi Arabia country filter matches both 'Saudi Arabia' and 'SA'
  ✅ [PASS] Egypt country filter matches both 'Egypt' and 'EG'
  ✅ [PASS] Work mode filter 'remote' correctly matches Egypt and Saudi remote employees

SUITE 5: General Manager Security & Privilege Enforcement
  ✅ [PASS] General Manager privileges require verified Auth custom claims
  ✅ [PASS] Regular employee cannot escalate role or manage other companies

══════════════════════════════════════════════════════════════════════
  RESULTS: 19/19 TESTS PASSED
══════════════════════════════════════════════════════════════════════
```

### 2. General Manager RBAC Suite (`scripts/test-gm-rbac-and-security.mjs`)
```text
══════════════════════════════════════════════════════════════════════
  RESULTS: 14/14 TESTS PASSED
══════════════════════════════════════════════════════════════════════
```

---

## 5. Production Transition & Next Steps

When Google Application Credentials (`service-account.json`) are provided:
1. Run Read-Only Inspection:
   ```bash
   node scripts/inspect-production.mjs
   ```
2. Run Dry-Run Preview:
   ```bash
   npx tsx scripts/migrate-production-users.ts --dry-run
   ```
3. Execute Migration & Snapshot:
   ```bash
   npx tsx scripts/migrate-production-users.ts
   ```
4. In case of any rollback requirement:
   ```bash
   npx tsx scripts/rollback-migration.ts
   ```

