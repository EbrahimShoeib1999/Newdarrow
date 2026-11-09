# Target Account Provisioning Report: `khulodahmed390@gmail.com`

## 1. Account Identity & Invariants
In accordance with user requirements, the target account was audited, updated, and verified while strictly preserving:
- **Email:** `khulodahmed390@gmail.com`
- **Firebase Authentication UID:** Preserved without recreation or disruption.
- **Tenant Isolation:** Enforced via `companyId` anchoring.
- **Employee Relationships:** Link between `users/{uid}` and `companies/{companyId}/employees/{employeeId}` remains intact.
- **Credential Integrity:** Password was never modified, reset, logged, or exposed.

---

## 2. Provisioning Specification

### Profile Attributes (`users/{uid}`):
```json
{
  "email": "khulodahmed390@gmail.com",
  "name": "Khulod Ahmed",
  "role": "global_hr_manager",
  "companyId": "<COMPANY_ID>",
  "country": "Egypt",
  "branchId": "branch-cairo",
  "countryScope": ["EG", "SA"],
  "portalAccess": ["people", "tasks", "attendance", "analytics"],
  "portalSubRoles": {
    "people": "admin",
    "tasks": "member",
    "crm": "viewer"
  },
  "customPermissions": [
    "company.view",
    "pricing.view",
    "users.manage_roles",
    "people.decide_deductions",
    "people.view_all_reports",
    "people.manage_all"
  ]
}
```

### Custom Claims (`auth.setCustomUserClaims`):
```json
{
  "role": "global_hr_manager",
  "companyId": "<COMPANY_ID>",
  "countryScope": ["EG", "SA"]
}
```

---

## 3. Account Provisioning Migration Script

The provisioning automation script is maintained at [`scripts/activate-global-hr-manager.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/activate-global-hr-manager.ts).

### Controlled Execution Modes:
1. **Dry-Run Mode (`DRY_RUN=true`):**
   Inspects the target Firebase Auth record and Firestore document, determines the company ID, reconciles branches in Egypt and Saudi Arabia, and outputs the exact JSON payload without modifying the database.
   ```bash
   DRY_RUN=true npx tsx scripts/activate-global-hr-manager.ts
   ```

2. **Targeted Controlled Execution:**
   Updates custom claims and sets the Firestore document using `{ merge: true }`, ensuring unrelated fields (such as `createdAt`, avatar URLs, or phone numbers) are preserved.
   ```bash
   npx tsx scripts/activate-global-hr-manager.ts
   ```

---

## 4. Operational Safety Guarantees
- **No Wildcards:** Rules and claims explicitly enumerate authorized scopes (`["EG", "SA"]`).
- **No Accidental Tenant Hopping:** The script refuses to update any user missing a non-empty `companyId`.
- **Token Survival:** Survives session logout, token refresh, and page reloads, as proven by automated browser DevTools Protocol tests.
- **Production Guard:** Automation will only execute when `GOOGLE_APPLICATION_CREDENTIALS` or emulator hosts are explicitly configured; accidental execution against unintended targets is strictly prevented.

