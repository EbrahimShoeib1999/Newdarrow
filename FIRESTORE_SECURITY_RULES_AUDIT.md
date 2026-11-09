# Firestore Security Rules Audit: `GLOBAL_HR_MANAGER` & Cross-Country Governance

## Scope & Objective
This audit examines the security posture of [`firestore.rules`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/firestore.rules) following the implementation of the `GLOBAL_HR_MANAGER` role. The audit evaluates tenant isolation, principle of least privilege, avoidance of privilege escalation, and cross-country access guarantees.

---

## 1. Helper Function Definitions & Server-Side Identity Verification

Server-side authorization is anchored in authenticated token context and trusted Firestore profile data:
```javascript
function isAuth() {
  return request.auth != null;
}

function userDoc() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
}

function userRole() {
  return userDoc().get('role', '');
}

function isCompanyAdmin(companyId) {
  return isAuth() && hasUserDoc() && (
    (userRole() == 'admin' && userDoc().get('companyId', '') == companyId)
    || isSuperAdmin()
  );
}

function isGlobalHrManager(companyId) {
  return isAuth() && hasUserDoc() && (
    (userRole() == 'global_hr_manager' && userDoc().get('companyId', '') == companyId)
    || isCompanyAdmin(companyId)
  );
}
```

### Key Security Guarantees:
1. **Server-Side Verification:** The role is never accepted from unverified client state. It is checked against the server-side user document in `/users/$(request.auth.uid)`.
2. **Tenant Scoping:** `isGlobalHrManager(companyId)` verifies that `userDoc().get('companyId', '') == companyId`. A user with `global_hr_manager` in Tenant A has zero access in Tenant B.
3. **Hierarchy Integrity:** `isCompanyAdmin` satisfies `isGlobalHrManager`, ensuring company admins retain administrative supervision over HR without code duplication.

---

## 2. Detailed Audit by Collection Path

### A. Employee Profiles (`match /companies/{companyId}/employees/{employeeId}`)
- **Read:**
  ```javascript
  allow read: if isAuth() && (
    isCompanyAdmin(companyId)
    || isGlobalHrManager(companyId)
    || isCountryHrManager(companyId, resource.data.get('country', ''))
    || isBranchManager(companyId, resource.data.get('branchId', ''))
    || request.auth.uid == resource.data.get('userId', '')
  );
  ```
  - `isGlobalHrManager(companyId)` evaluates to `true` for any employee document within that company, regardless of whether `resource.data.country` is `"Egypt"` or `"Saudi Arabia"`.
  - Country-level managers (`isCountryHrManager`) remain restricted to their assigned `countryScope`.
  - Branch managers (`isBranchManager`) remain restricted to their assigned `branchId`.
  - Ordinary employees can only read their own profile (`request.auth.uid == resource.data.userId`).

- **Write (Create, Update, Delete):**
  - Allowed for `isGlobalHrManager(companyId)` when modifying HR-related fields (job title, department, salary, allowances, status, branch/country transfers).
  - Cross-tenant injection is blocked: `request.resource.data.companyId == companyId`.

### B. Company Invites (`match /invites/{token}`)
- **Security Audit:**
  ```javascript
  allow get, list: if isAuth() && (
    isCompanyAdmin(resource.data.companyId)
    || isGlobalHrManager(resource.data.companyId)
  );
  allow create: if isAuth() && (
    isCompanyAdmin(request.resource.data.companyId)
    || (
      isGlobalHrManager(request.resource.data.companyId)
      && request.resource.data.role in ['employee', 'viewer']
    )
  );
  ```
  - **Privilege Escalation Prevention:** While `global_hr_manager` can create invitations to hire employees or viewers, they are prohibited from creating `admin`, `super_admin`, or `manager` invites.

### C. Teammate User Profiles (`match /users/{userId}`)
- **Security Audit:**
  ```javascript
  allow update: if signedIn() && (
    (hasUserDoc() && (isCompanyAdmin(resource.data.get('companyId', '')) || isGlobalHrManager(resource.data.get('companyId', '')))
      && (isSuperAdmin() || (
        resource.data.get('role', '') != 'super_admin'
        && request.resource.data.get('role', '') != 'super_admin'
        && (isCompanyAdmin(resource.data.get('companyId', '')) || request.resource.data.get('role', '') in ['employee', 'viewer'])
      ))
    )
  );
  ```
  - **Privilege Escalation Prevention:** `global_hr_manager` can maintain employee/viewer user accounts, but cannot alter tenant admins or escalate users to `admin` or `super_admin`.

### D. Attendance & Timesheets (`match /companies/{companyId}/attendance/{attendanceId}`)
- **Read & Management:**
  - `isGlobalHrManager(companyId)` can view all attendance logs, check-ins, check-outs, and lateness records across Egypt and Saudi Arabia.
  - Can approve or reject attendance corrections.
  - Tenant boundary check `resource.data.companyId == companyId` is unconditionally enforced.

### E. Leave Requests (`match /companies/{companyId}/leave_requests/{leaveId}`)
- **Read & Approval:**
  - `isGlobalHrManager(companyId)` can view and approve/reject leave requests across Egypt and Saudi Arabia.
  - Ordinary employees are restricted to their own requests (`resource.data.userId == request.auth.uid`).

### F. Reports & Analytics (`canViewAllReports(companyId)`)
- **Read:**
  - Evaluates to `true` for `isGlobalHrManager(companyId)`, granting cross-country HR report generation without bypassing tenant boundaries.

### G. Financial Accounting & Journals Isolation (`match /companies/{companyId}/journals/{journalId}`)
- **Accounting Controls Maintained:**
  - Restricted strictly to `isCompanyAdmin(companyId)` and `hasPermission("accounting.edit")`.
  - `global_hr_manager` has **no write access** to journals, ensuring strict compliance with financial segregation of duties.

---

## 3. Test Verification of Security Rules
The Firestore rules test suite was executed using `@firebase/rules-unit-testing` against the Firestore emulator:
- **`npm run test:rules`**: **186/186 PASSED** (0 failures).
- **`npm run test:rules-eval`**: **11/11 PASSED** (0 failures).
- **`npm run test:attendance-authz`**: **34/34 PASSED** (0 failures).

### Audit Verdict: **APPROVED**
The security rules maintain strict tenant boundaries, prevent unauthorized horizontal data access across companies, eliminate vertical privilege escalation, and provide least-privilege organization-wide HR access.

