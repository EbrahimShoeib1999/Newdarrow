# D-Arrow Business — Global HR Production Readiness Final Decision Report

**Target Account:** `khulodahmed390@gmail.com`  
**Target Role:** `global_hr_manager`  
**Multi-Country Scope:** Egypt (`EG`) & Saudi Arabia (`SA`)  
**Evaluation Date:** November 9, 2026  
**Final Production Gate Verdict:** **LOCALLY VERIFIED & HARDENED — READY FOR STAGED OPERATOR APPROVAL**  
**Production Boundary Enforcement:** **ZERO PRODUCTION CHANGES EXECUTED**

---

## Executive Status Dashboard

| Verification Dimension | Scope | Verdict | Evidence / Notes |
| :--- | :--- | :---: | :--- |
| **Local Code & Architecture** | Source code, Types, Routes, Services | **PASS** | Full separation of duties, cross-country visibility, TypeScript 0 errors. |
| **Emulator Test Harness** | Rules, Auth, Cross-Country, Chaos Suites | **PASS** | 186 rules tests, 42 negative security tests, 28 cross-country, 16 lifecycle, 6 chaos tests passed. |
| **TypeScript Typecheck** | `tsc -b` | **PASS** | Completed with 0 type errors. |
| **Production Build** | `vite build` | **PASS** | Production bundles generated in 4m 4s. |
| **Production Account Provisioning** | Live Auth UID, Claims, Firestore profile | **NOT VERIFIED** | Intentionally blocked by safety boundary. Production was NOT touched. |
| **Production Firestore Rules** | `firebase deploy --only firestore:rules` | **NOT VERIFIED** | Intentionally blocked by safety boundary. Deployment is pending operator approval. |

---

## 1. Account Status Protection

The update rule in [`firestore.rules`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/firestore.rules#L312-L322) for `users/{userId}` strictly locks the `status` field for Global HR:

```javascript
        || (
          hasUserDoc() && isGlobalHrManager(resource.data.get('companyId', ''))
          && resource.data.get('role', '') in ['employee', 'viewer']
          && request.resource.data.get('role', '') in ['employee', 'viewer']
          && request.resource.data.get('companyId', '') == resource.data.get('companyId', '')
          && request.resource.data.get('customPermissions', []) == resource.data.get('customPermissions', [])
          && request.resource.data.get('portalSubRoles', {}) == resource.data.get('portalSubRoles', {})
          && request.resource.data.get('portalAccess', []) == resource.data.get('portalAccess', [])
          && request.resource.data.get('countryScope', []) == resource.data.get('countryScope', [])
          && request.resource.data.get('status', 'active') == resource.data.get('status', 'active')
        )
```

### 1.1 Status Transition Test Results

| Test Case | Actor | Target Account | Attempted Action | Expected | Result | Classification |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: |
| **8i** | Global HR | `employee-cairo` | Disable user account (`status: 'disabled'`) | Deny | Denied | **PASS** |
| **8j** | Global HR | `employee-cairo` | Suspend user account (`status: 'suspended'`) | Deny | Denied | **PASS** |
| **8k** | Global HR | `employee-cairo` | Set unauthorized arbitrary state | Deny | Denied | **PASS** |
| **8l** | Global HR | `admin-user` | Modify admin status (`status: 'disabled'`) | Deny | Denied | **PASS** |
| **8m** | Global HR | `admin-user` | Reactivate disabled privileged account | Deny | Denied | **PASS** |
| **8n** | Company Admin | `employee-cairo` | Update user status (`status: 'active'`) | Allow | Allowed | **PASS** |
| **8o** | Global HR | `emp-eg-1` (doc) | Update employee lifecycle status | Allow | Allowed | **PASS** |

---

## 2. Financial Authorization Tests (Valid Payloads)

All tests were executed using **structurally and financially valid payloads** (balanced debits/credits, positive monetary amounts) to prove that rejection occurs solely due to **authorization denial**, not validation failure.

### 2.1 Financial Test Results

| Test Case | Target Resource | Payload Shape | Actor | Rules Defense | Result | Classification |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| **9** | `journals/{id}` | `totalDebit: 1500, totalCredit: 1500` (Balanced) | Global HR | `!isGlobalHrManager(companyId)` | Denied | **PASS** |
| **9b** | `journals/{id}` | `totalDebit: 1500, totalCredit: 1500` (Balanced) | Admin | `isCompanyAdmin(companyId)` | Allowed | **PASS** |
| **10** | `vouchers/{id}` | `voucherType: "disbursement", amount: 2500` | Global HR | `!isGlobalHrManager(companyId)` | Denied | **PASS** |
| **10b** | `vouchers/{id}` | `voucherType: "disbursement", amount: 2500` | Admin | `isCompanyAdmin(companyId)` | Allowed | **PASS** |
| **10c** | `payments/{id}` | `amount: 1750, currency: "SAR"` | Global HR | `!isGlobalHrManager(companyId)` | Denied | **PASS** |
| **10d** | `payments/{id}` | `amount: 1750, currency: "SAR"` | Admin | `isCompanyAdmin(companyId)` | Allowed | **PASS** |
| **10e** | `payroll_payments/{id}` | `amount: 45000, month: "2026-11"` | Global HR | `!isGlobalHrManager(companyId)` | Denied | **PASS** |
| **10f** | `payroll_payments/{id}` | `amount: 45000, month: "2026-11"` | Admin | `isCompanyAdmin(companyId)` | Allowed | **PASS** |
| **10g** | `settings/fiscal_closing` | `year: 2026, isClosed: true` | Global HR | `isCompanyAdmin(companyId)` | Denied | **PASS** |
| **10h** | `settings/fiscal_closing` | `year: 2026, isClosed: true` | Admin | `isCompanyAdmin(companyId)` | Allowed | **PASS** |

---

## 3. Full Admin SDK and Backend Audit

An exhaustive scan of the repository confirmed:
- `functions/`, `server/`, `backend/`, API routes, Cloud Functions, scheduled jobs: **CONFIRMED NON-EXISTENT** (D-Arrow Business is a pure client-side SPA).
- The **only** backend Admin SDK operations reside in [`scripts/activate-global-hr-manager.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/activate-global-hr-manager.ts).

### 3.1 Write Path Authorization Inventory

| Write Path / File | Target Entity | Operation | Authentication Enforcement | Authorization Enforcement | Security Verdict |
| :--- | :--- | :--- | :--- | :--- | :---: |
| [`scripts/activate-global-hr-manager.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/activate-global-hr-manager.ts#L266) | Target User Auth Claims | `setCustomUserClaims` | Service account (`GOOGLE_APPLICATION_CREDENTIALS`) | Hard-pinned to `khulodahmed390@gmail.com`; snapshot-backed | **PASS** |
| [`scripts/activate-global-hr-manager.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/activate-global-hr-manager.ts#L278) | Target User Profile | `userDocRef.set` | Service account | Read-back verified against claims; auto-rollback | **PASS** |
| [`src/features/users/api/users.service.ts:32`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/users/api/users.service.ts#L32) | Teammate Profile | `updateDoc` (Role) | Firebase Auth Session | Client `canAssignRole` + Firestore rule: `role in ['employee','viewer']` | **PASS** |
| [`src/features/users/api/users.service.ts:79`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/users/api/users.service.ts#L79) | Teammate Profile | `updateDoc` (Portals) | Firebase Auth Session | Client `actorRole === 'super_admin'` + Firestore rule locks `portalAccess` | **PASS** |
| [`src/features/users/api/users.service.ts:89`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/users/api/users.service.ts#L89) | Teammate Profile | `updateDoc` (CustomPerms) | Firebase Auth Session | Firestore rule locks `customPermissions` against Global HR | **PASS** |
| [`src/features/users/api/users.service.ts:96`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/users/api/users.service.ts#L96) | User Account | `deleteDoc` | Firebase Auth Session | Firestore rule restricts user deletion to `isCompanyAdmin()` | **PASS** |
| [`src/features/companies/api/invites.service.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/companies/api/invites.service.ts#L158) | Invitations | `setDoc` | Firebase Auth Session | Firestore `invites/{token}` locks role, subroles, and permissions | **PASS** |

---

## 4. Migration Recovery Failure & Chaos Tests

Automated test suite: [`scripts/test-migration-failure-recovery.mjs`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/test-migration-failure-recovery.mjs)  
Executed in Firebase Emulator (Auth :9099, Firestore :8080):

| Chaos Scenario | Simulated Failure Condition | Auto-Recovery Mechanism | Result | Status |
| :--- | :--- | :--- | :---: | :---: |
| **Baseline Seeding** | Pre-migration employee fixture | Pre-flight validation | Verified | **PASS** |
| **Read-Back Mismatch** | Claims elevated but doc failed/mismatched | Automatic recovery restored Auth claims & Firestore doc to snapshot | Verified | **PASS** |
| **Corrupted Snapshot** | Intruder email / foreign UID snapshot | Schema validation rejected restoration; aborted cleanly | Verified | **PASS** |
| **Phased State Tracking** | Step-by-step state machine | Recorded `VERIFIED` in `state_<email>.json` with mode 0o600 | Verified | **PASS** |
| **Golden Snapshot Invariance** | Repeated execution with existing baseline | Preserved original baseline snapshot; refused overwrite | Verified | **PASS** |
| **Safe Rollback Engine** | Manual recovery via `ACTION=rollback` | Restored baseline employee state; recorded `ROLLED_BACK` in state file | Verified | **PASS** |

**Summary: 6/6 Chaos & Recovery Scenarios Passed (0 Failed)**

---

## 5. Final Regression Execution Results

```
========================================================================================
 D-ARROW FINAL REGRESSION VERIFICATION MATRIX
========================================================================================
 1. Firestore Security Rules Suite (test:rules)           : 186/186 PASSED
 2. Firestore Rules Eval Regression (test:rules-eval)     :  11/11  PASSED
 3. Global HR Core Service Suite (test:global-hr-manager) :         PASSED
 4. Cross-Country Access & Lifecycle (28 tests)           :  28/28  PASSED
 5. Negative Security & Boundary Suite (42 tests)         :  42/42  PASSED
 6. Migration Rollback Lifecycle Suite (16 tests)         :  16/16  PASSED
 7. Migration Chaos & Recovery Suite (6 tests)            :   6/6   PASSED
 8. TypeScript Typecheck (tsc -b)                         : 0 ERRORS
 9. Production Build (vite build)                         : SUCCESS (4m 4s)
========================================================================================
 ALL LOCAL & EMULATOR VERIFICATION SUITES PASSED
========================================================================================
```

---

## 6. Production Activation Checklist & Operational Recommendation

### Explicit Readiness Assessment

| Requirement | Classification | Action Required Prior to Live Operations |
| :--- | :---: | :--- |
| Core Implementation | **PASS** | Ready. |
| Security Hardening | **PASS** | Ready. |
| Separation of Duties | **PASS** | Ready. |
| Rollback & State Machine | **PASS** | Ready. |
| Production Auth State | **NOT VERIFIED** | Requires operator running read-only inspection with production service account credentials. |
| Production Rules Deployment | **NOT VERIFIED** | Requires operator executing `firebase deploy --only firestore:rules`. |
| Production Migration Run | **NOT VERIFIED** | Requires operator executing `npm run activate:global-hr` with valid production credentials. |

### Strict Safety Commitment
As instructed, **zero modifications have been made to the production Firebase project**. Execution is complete and halted. We await your explicit authorization before any production operations are undertaken.

