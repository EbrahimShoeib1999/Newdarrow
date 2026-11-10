# D-ARROW — PLATFORM ADMINISTRATOR PERMISSION MATRIX (V2)

> **Authority Reference**: Comprehensive Role & Resource Permission Specification (V2)  
> **Source Rule File**: [`firestore.rules`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/firestore.rules)  
> **Client Permission Engine**: [`src/lib/permissions/index.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/permissions/index.ts)  
> **Audit Status**: Contains findings and field-level constraints from the Adversarial Security Verification.

---

## 1. System Role Hierarchy & Authority Scopes

| Role Key | System Title | Display Name (AR) | Governance Domain | Cryptographic Claim Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **`platform_admin`** | Platform Administrator | مدير المنصة العام | Full cross-tenant & platform-wide authority | **MANDATORY**: `role: "platform_admin"` in Firebase Auth JWT |
| **`super_admin`** | Super Administrator | مدير عام النظام | Tenant-wide governance across all tenant modules | `role: "super_admin"` in Auth token or user doc |
| **`admin`** | Company Administrator | مدير الشركة | Tenant-wide administration in own tenant | `role: "admin"` in Auth token or user doc |
| **`global_hr_manager`** | Global HR Manager | مدير الموارد البشرية العام | Cross-country People & HR management (non-financial) | `role: "global_hr_manager"` with `countryScope` |
| **`manager`** | Department Manager | مدير قسم | Departmental workflows in own tenant | `role: "manager"` in own tenant |
| **`employee`** | Employee | موظف | Assigned workflows in own tenant | `role: "employee"` in own tenant |
| **`viewer`** | Viewer | مشاهد | Read-only access within assigned tenant | `role: "viewer"` in own tenant |

---

## 2. Granular Permission & Attack Surface Matrix

The table below contrasts standard capabilities against the adversarial vulnerabilities identified during the audit:

| Resource / Action | `platform_admin` | `super_admin` | `admin` | `global_hr_manager` | `employee` | Audit Finding & Vulnerability Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Cross-Tenant Document Read** | **ALLOW** | DENY | DENY | DENY | DENY | **SECURE**: Only `platform_admin` can read foreign tenants. |
| **Cross-Tenant Document Write** | **ALLOW** | DENY | DENY | DENY | DENY | **SECURE**: Only `platform_admin` can write to foreign tenants. |
| **General Ledger: Balanced Journal** | **ALLOW** | **ALLOW** | **ALLOW** | **DENIED** | DENY | **SECURE**: Requires `totalDebit == totalCredit`. |
| **General Ledger: Unbalanced Journal**| **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **SECURE**: Evaluated fail-closed at rule level. |
| **General Ledger: Edit/Delete Posted** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **SECURE**: Immutability enforced (`allow delete: if false`). |
| **Payment Vouchers: Create/Update** | **ALLOW** | **ALLOW** | **ALLOW** | **DENIED** | **VULN** | ⚠️ **VULNERABILITY**: Fallthrough allows regular employees. Must restrict to Admins. |
| **Payroll Payments: Create/Update** | **ALLOW** | **ALLOW** | **ALLOW** | **DENIED** | **VULN** | ⚠️ **VULNERABILITY**: Allows regular employees & negative amounts. Must require `amount > 0` and Admin role. |
| **Payroll Payments: Delete** | **ALLOW** | **VULN** | **VULN** | **DENIED** | DENY | ⚠️ **VULNERABILITY**: Allows tenant admins to delete payment history. Must be immutable. |
| **Employee Records: Delete** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **VULN** | ⚠️ **VULNERABILITY**: Wildcard match lets any employee delete colleagues' records. |
| **Client Invoices: Delete** | **ALLOW** | **ALLOW** | **ALLOW** | DENY | **VULN** | ⚠️ **VULNERABILITY**: Wildcard match lets any employee delete company invoices. |
| **User Status: Suspend / Disable** | **ALLOW** | Teammates | Teammates | **DENIED** | DENY | **SECURE**: Global HR and regular employees denied. |
| **Own Account Self-Deletion** | **RISK** | **RISK** | **RISK** | DENY | DENY | ⚠️ **RISK**: Platform Admin can delete own `/users/{uid}` doc. Must enforce `auth.uid != userId`. |
| **Super Admin Account Deletion** | **RISK** | DENY | DENY | DENY | DENY | ⚠️ **RISK**: Platform Admin can delete `super_admin`. Must require multi-party governance. |
| **Audit Logs: Append Entry** | **ALLOW** | **ALLOW** | **ALLOW** | **ALLOW** | **VULN** | ⚠️ **VULNERABILITY**: Client can forge `actorUid` of Platform/Super Admin. Must assert `actorUid == auth.uid`. |
| **Audit Logs: Update / Delete** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **DENIED** | **SECURE**: Fully immutable (`allow update, delete: if false`). |

---

## 3. Mandatory Rule Remediations (Field-Level Constraints)

To eliminate the confirmed vulnerabilities, the following field-level rule constraints are required:

### 1. `isPlatformAdmin()` Custom Claim Assertion
```firestore
function isPlatformAdmin() {
  return signedIn() && request.auth.token.get('role', '') == 'platform_admin';
}
```

### 2. Explicit Subcollection Match: `/employees` & `/invoices`
```firestore
match /employees/{employeeId} {
  allow read: if belongsToCompany(companyId) || isPlatformAdmin() || isGlobalHrManager(companyId);
  allow create, update: if isCompanyAdmin(companyId) || isPlatformAdmin() || isGlobalHrManager(companyId);
  allow delete: if isCompanyAdmin(companyId) || isPlatformAdmin();
}

match /invoices/{invoiceId} {
  allow read: if belongsToCompany(companyId) || isPlatformAdmin();
  allow create, update: if isCompanyAdmin(companyId) || isPlatformAdmin();
  allow delete: if isCompanyAdmin(companyId) || isPlatformAdmin();
}
```

### 3. Financial Invariant Protection: `/payroll_payments` & `/vouchers`
```firestore
match /payroll_payments/{paymentId} {
  allow read: if belongsToCompany(companyId) || isPlatformAdmin();
  allow create, update: if (isCompanyAdmin(companyId) || isPlatformAdmin())
    && request.resource.data.amount is number
    && request.resource.data.amount > 0;
  allow delete: if false; // Financial audit records are immutable
}

match /vouchers/{voucherId} {
  allow read: if belongsToCompany(companyId) || isPlatformAdmin();
  allow create, update: if (isCompanyAdmin(companyId) || isPlatformAdmin())
    && request.resource.data.amount is number
    && request.resource.data.amount > 0;
  allow delete: if false;
}
```

### 4. Self-Identity & Super Admin Protection: `/users/{userId}`
```firestore
match /users/{userId} {
  // Prevent self-deletion and super_admin destruction
  allow delete: if isPlatformAdmin()
    && request.auth.uid != userId
    && resource.data.get('role', '') != 'super_admin';
}
```

### 5. Audit Log Authenticity & Anti-Spoofing: `/audit_logs`
```firestore
match /audit_logs/{logId} {
  allow read: if isPlatformAdmin() || isSuperAdmin(userDoc().companyId);
  allow create: if signedIn()
    && request.resource.data.actorUid == request.auth.uid
    && request.resource.data.timestamp is string;
  allow update, delete: if false;
}
```
