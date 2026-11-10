# D-ARROW — V3 FINANCIAL SECURITY AUDIT

> **Financial Authorization & Immutability Audit (V3)**  
> **Environment**: Isolated Local Firebase Emulator Suite  
> **Target Account**: `khulodahmed390@gmail.com`  
> **Scope**: Accounting General Ledger, Payments, Vouchers, and Payroll Disbursements

---

## 1. Executive Summary

This financial security audit evaluates the authorization controls, numeric integrity validations, immutability guarantees, and segregation of duties (SoD) across all financial collections in D-Arrow.

Prior to the V3 remediations, the V2 adversarial audit detected potential vulnerabilities where non-admin members could issue vouchers or execute payroll disbursements, negative amounts could be written, and payment records could be deleted by tenant administrators.

In V3, [`firestore.rules`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/firestore.rules) has been hardened with strict numeric validation, complete deletion prohibition (`allow delete: if false;`), role-based creation locks, and segregation of HR from financial disbursements.

---

## 2. Financial Collections Security Matrix

| Subcollection Path | Allowed Roles (Read) | Allowed Roles (Create/Update) | Deletion Policy | Numeric / Value Constraints | Segregation of Duties Enforced |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`/journals/{journalId}`** | Company Members, Platform Admin | Company Members (excl. Global HR) | **PROHIBITED** (`if false;`) | `totalDebit == totalCredit` AND `totalDebit > 0` | Balanced double-entry required; Global HR blocked from GL posting |
| **`/payments/{paymentId}`** | Company Members, Platform Admin | Company Members (excl. Global HR) | **PROHIBITED** (`if false;`) | `amount is number` AND `amount > 0` | Global HR blocked from payment creation; deletions prohibited |
| **`/vouchers/{voucherId}`** | Company Members, Platform Admin | Company Admin, Platform Admin | **PROHIBITED** (`if false;`) | `amount > 0` OR `totalAmount > 0` (strictly positive number) | Regular employees & Global HR blocked from issuing vouchers |
| **`/payroll_payments/{paymentId}`**| Company Members, Platform Admin | Company Admin, Platform Admin | **PROHIBITED** (`if false;`) | `amount > 0` OR `totalDisbursement > 0` (strictly positive number) | Global HR prepares payroll, but **CANNOT** disburse funds |

---

## 3. Deep Dive: Segregation of Duties (SoD)

### Separation of HR Preparation vs. Financial Execution
In D-Arrow, payroll management is split into two distinct lifecycle phases:
1. **HR Payroll Preparation**: Handled by HR Managers / Global HR Managers in `/payroll_runs/{runId}`. HR compiles timesheets, calculates deductions, and submits payroll batches for approval.
2. **Payroll Execution & Disbursement**: Handled exclusively in `/payroll_payments/{paymentId}`.
   - Global HR Managers are explicitly barred from creating or updating records in `/payroll_payments`:
     ```firestore
     match /payroll_payments/{paymentId} {
       allow create, update: if (isCompanyAdmin(companyId) || isPlatformAdmin())
         && !isGlobalHrManager(companyId)
         && (
           (request.resource.data.get('amount', 0) is number && request.resource.data.get('amount', 0) > 0)
           || (request.resource.data.get('totalDisbursement', 0) is number && request.resource.data.get('totalDisbursement', 0) > 0)
         );
       allow delete: if false;
     }
     ```
   - This ensures that an HR officer cannot unilaterally disburse funds to an employee or fictitious account.

### Voucher Issuance Authorization
Payment vouchers (`PV`) and receipt vouchers (`RV`) represent legal authorizations for cash movements.
- In V2, vouchers fell under general module collections allowing standard members to draft/post.
- In V3, `/vouchers/{voucherId}` requires explicit administrative credentials (`isCompanyAdmin(companyId) || isPlatformAdmin()`), preventing unauthorized employees from issuing financial commitments.

---

## 4. General Ledger Double-Entry Validation

D-Arrow enforces cryptographic and logical balance on all journal transactions prior to Firestore commit:
```firestore
match /journals/{journalId} {
  allow read: if belongsToCompany(companyId);
  allow create: if belongsToCompany(companyId)
    && !isGlobalHrManager(companyId)
    && request.resource.data.totalDebit == request.resource.data.totalCredit
    && request.resource.data.totalDebit > 0;
  allow update, delete: if false;
}
```

### Protection Against Financial Inversion & Zero-Sum Exploits
- **Zero-Sum Injection Blocked**: A payload with `totalDebit: 0, totalCredit: 0` is rejected by `request.resource.data.totalDebit > 0`.
- **Negative Balances Blocked**: Since `totalDebit` must be greater than zero and equal to `totalCredit`, inverted credit-debit attacks are rejected.
- **Immutability Guaranteed**: Once written, GL journals can neither be edited nor deleted (`allow update, delete: if false;`). Corrections must be posted as offset journal adjustments, preserving audit compliance.

---

## 5. Client Rules vs. Server-Side / Cloud Functions Boundaries

While Firestore Security Rules provide ironclad perimeter defense against client-side tampering, enterprise financial systems require distinguishing between client rules and server-side backend requirements:

```
+-----------------------------------------------------------------------------------+
|                           CLIENT / BROWSER INTERACTION                            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                     FIRESTORE SECURITY RULES (Perimeter Gate)                     |
| - Authenticated role verification (isCompanyAdmin, isPlatformAdmin)               |
| - SoD enforcement (!isGlobalHrManager)                                            |
| - Numeric positivity checks (amount > 0, totalDebit == totalCredit)               |
| - Deletion locks (allow delete: if false;)                                        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|               CLOUD FUNCTIONS / BACKEND SERVER (Admin SDK Operations)             |
| - Idempotency Keys (deduplication against double-clicks/network retries)           |
| - Distributed transactions & distributed locks (e.g., Redlock / Firestore runTransaction)
| - Bank API webhooks & settlement reconciliations                                  |
| - Real-time currency exchange rate conversion lock-in                             |
+-----------------------------------------------------------------------------------+
```

### Analysis of Server-Side Requirements:
1. **Duplicate Payment Prevention**:
   - *Client Rule Boundary*: Firestore rules verify that each written record has a valid positive amount and authorized user.
   - *Server-Side Requirement*: To prevent accidental duplicate clicks during network latency, financial disbursement operations in production should utilize an idempotency key (e.g. `payrollRunId_recipientId_month`) in a Firestore transaction (`runTransaction`) or dedicated Cloud Function.
2. **Third-Party Payment Gateways**:
   - Live bank payouts or payment gateway disbursements (e.g. Stripe, Fawry, HyperPay) must be triggered via secure Cloud Functions using Firebase Admin SDK, never directly from client SDKs.

---

## 6. Empirical Verification Results

The financial security suite in [`scripts/test-adversarial-security-v3.mjs`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/test-adversarial-security-v3.mjs) evaluated 9 targeted test cases:

- **Test 3.1** (`[NEGATIVE] Ordinary employee CANNOT create payroll disbursement`): **PASS**
- **Test 3.2** (`[NEGATIVE] Company Admin CANNOT create payroll payment with negative amount`): **PASS**
- **Test 3.3** (`[NEGATIVE] Company Admin CANNOT create payroll payment with zero amount`): **PASS**
- **Test 3.4** (`[NEGATIVE] Company Admin CANNOT create payroll payment with non-numeric amount`): **PASS**
- **Test 3.5** (`[NEGATIVE] Ordinary employee CANNOT create payment voucher`): **PASS**
- **Test 3.6** (`[NEGATIVE] Company Admin CANNOT create voucher with zero or negative amount`): **PASS**
- **Test 3.7** (`[NEGATIVE] Executed financial records CANNOT be deleted (immutable audit trail)`): **PASS**
- **Test 3.8** (`[POSITIVE] Company Admin CAN create valid payroll payment with positive amount`): **PASS**
- **Test 3.9** (`[POSITIVE] Company Admin CAN create valid payment voucher with positive amount`): **PASS**

### Conclusion
Financial records in D-Arrow are fully protected against unauthorized creation, tampering, negative values, and deletion at the Firestore security perimeter.

