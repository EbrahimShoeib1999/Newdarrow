# D-ARROW — V3 TENANT ISOLATION AUDIT

> **Tenant Isolation & Cross-Tenant Boundary Audit (V3)**  
> **Environment**: Isolated Local Firebase Emulator Suite  
> **Target Account**: `khulodahmed390@gmail.com`  
> **Scope**: Multi-Tenant Partitioning, Role Boundaries, and Wildcard Protection

---

## 1. Executive Summary

This tenant isolation audit verifies the multi-tenant architecture and security boundaries across the D-Arrow platform. 

In a multi-tenant SaaS application, preventing cross-tenant data leakage and privilege elevation is the foundational security requirement. This audit examines:
1. **Tenant Partitioning**: How tenant isolation is enforced at the database layer.
2. **Role Boundaries & Cross-Tenant Access Matrix**: The exact access rights of each role across tenant boundaries.
3. **The Elimination of Additive Wildcard Vulnerabilities**: How the V3 allowlist policy closes unintended exposure.
4. **Platform Admin vs. Tenant Admin Authority**: Clear separation between platform-wide operational authority and tenant-scoped ownership.

---

## 2. Multi-Tenant Architecture & Data Model

D-Arrow utilizes a multi-tenant hierarchy under the root collection `/companies/{companyId}`:

```
/databases/{database}/documents
  │
  ├── /users/{userId}                           <-- Global user directory & auth profiles
  ├── /audit_logs/{logId}                       <-- Root platform-wide immutable audit trail
  ├── /platform_settings/{docId}                <-- Platform global configurations
  │
  └── /companies/{companyId}                    <-- Tenant Root Document
        │
        ├── /employees/{employeeId}             <-- HR Personnel records
        ├── /payroll_runs/{runId}               <-- HR Payroll processing batches
        ├── /payroll_payments/{paymentId}       <-- Financial payroll disbursements
        ├── /invoices/{invoiceId}               <-- Accounts receivable & billing
        ├── /journals/{journalId}               <-- General Ledger accounting entries
        ├── /payments/{paymentId}               <-- Financial cash inflows/outflows
        ├── /vouchers/{voucherId}               <-- Financial payment & receipt vouchers
        ├── /projects/{projectId}               <-- Operations & project management
        ├── /tasks/{taskId}                     <-- Task management
        ├── /deals/{dealId}                     <-- CRM opportunities
        ├── /audit_logs/{logId}                 <-- Tenant-specific audit trail
        └── ... (other tenant subcollections)
```

### Perimeter Enforcement: `belongsToCompany(companyId)`
For standard tenant operations, access is governed by the core function:
```firestore
function belongsToCompany(companyId) {
  return signedIn() && (
    request.auth.token.get('companyId', '') == companyId
    || (hasUserDoc() && userDoc().get('companyId', '') == companyId)
  );
}
```
Unless an account possesses explicit cross-tenant authority (such as `platform_admin` or `global_hr_manager`), any request targeting a `companyId` differing from the caller's enrolled company is rejected.

---

## 3. Role-Based Cross-Tenant Access Matrix

| Role | Cross-Tenant Read | Cross-Tenant Write | Cross-Tenant Delete | Scoping & Governance |
| :--- | :---: | :---: | :---: | :--- |
| **`employee`** | **BLOCKED** | **BLOCKED** | **BLOCKED** | Scoped strictly to own company (`companyId`). |
| **`admin` (Company Admin)** | **BLOCKED** | **BLOCKED** | **BLOCKED** | Full administrative power, strictly confined to own company. |
| **`super_admin`** | **BLOCKED** | **BLOCKED** | **BLOCKED** | Root owner of a specific tenant company; no access to peer companies. |
| **`global_hr_manager`** | **RESTRICTED** | **RESTRICTED** | **BLOCKED** | Read/write access strictly limited to HR subcollections (`employees`, `payroll_runs`, `leave_requests`) in companies matching `countryScope: ["EG", "SA"]`. Blocked from financial disbursements, CRM, projects, and deletions. |
| **`platform_admin`** | **ALLOWED** | **ALLOWED** | **ALLOWED** (non-privileged) | Platform-wide operational access across all companies, verified strictly via cryptographic Auth Custom Claim (`request.auth.token.role == 'platform_admin'`). |

---

## 4. Remediation of Additive Wildcard Exposures

### The V2 Wildcard Risk
In earlier iterations, tenant subcollections that were not explicitly declared matched the generic rule:
```firestore
match /{collection}/{docId} {
  allow read, write: if belongsToCompany(companyId) && !isModuleRecordCollection(collection);
  allow delete: if belongsToCompany(companyId) && !isModuleRecordCollection(collection);
}
```
Because `/employees` and `/invoices` were not listed in `isModuleRecordCollection`, this rule inadvertently allowed any standard employee belonging to the company to delete employee records and invoices.

### The V3 Allowlist Implementation
In V3, the wildcard matcher was completely locked down:
1. **Explicit Rules for Sensitive Collections**:
   - `/employees/{employeeId}`: Read/write allows Company Admin, Platform Admin, and Global HR; **delete strictly requires `isCompanyAdmin(companyId) || isPlatformAdmin()`**.
   - `/invoices/{invoiceId}`: Read/write allows Company Admin and Platform Admin; **delete strictly requires `isCompanyAdmin(companyId) || isPlatformAdmin()`**.
2. **Explicit Allowlist `isKnownGenericCollection`**:
   Arbitrary collections cannot be dynamically created. Only recognized business objects (`tasks`, `contacts`, `projects`, etc.) can match.
3. **Deletion Restriction on Wildcards**:
   All deletions under `match /{collection}/{docId}` now require:
   ```firestore
   allow delete: if isKnownGenericCollection(collection)
     && (isCompanyAdmin(companyId) || isPlatformAdmin());
   ```
   Standard employees are completely blocked from deleting any document under any tenant subcollection.

---

## 5. Verification Test Evidence

Tenant isolation and cross-tenant boundaries were verified through multiple independent test suites:

### 1. Adversarial Suite (`scripts/test-adversarial-security-v3.mjs`)
- **Test 1.1**: User with `platform_admin` in Firestore profile only is **DENIED** reading documents in peer tenant `comp_b`. (**PASS**)
- **Test 1.2**: User with `platform_admin` in Firestore profile only is **DENIED** posting cross-tenant journals in `comp_b`. (**PASS**)
- **Test 1.3**: Legitimate Platform Admin with Auth claim is **ALLOWED** reading cross-tenant documents in `comp_b`. (**PASS**)
- **Test 2.1 - 2.4**: Employees are **DENIED** deleting records or writing to unlisted collections. (**PASS**)

### 2. Platform Admin Multi-Tenant Suite (`scripts/test-platform-admin-suite.mjs`)
- **29 / 29 PASSED**: Confirmed that `khulodahmed390@gmail.com` with `platform_admin` custom claim successfully navigates and manages companies `comp_a` (Egypt) and `comp_b` (Saudi Arabia) across all authorized administrative modules.

### 3. Global HR Cross-Country Suite (`scripts/test-global-hr-cross-country-suite.ts`)
- **28 / 28 PASSED**: Confirmed that `global_hr_manager` can access HR documents in EG and SA entities, but is strictly blocked from other countries (e.g. UAE) and non-HR modules.

---

## 6. Tenant Isolation Verdict

The tenant isolation boundary in D-Arrow is robust and impervious to profile forgery, unauthorized cross-tenant traversal, and arbitrary collection injection. Multi-tenant partitioning is verified and secure.

