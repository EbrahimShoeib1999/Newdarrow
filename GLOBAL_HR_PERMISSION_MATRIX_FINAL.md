# D-Arrow Business — Global HR Final Permission Matrix & Operational Boundaries

**Date:** 2026-11-09  
**Target Account:** `khulodahmed390@gmail.com`  
**Target Role:** `global_hr_manager`  
**Authority Scope:** Company-Wide / Multi-Country (`EG` & `SA`)  
**Status:** **VERIFIED — STRICT FINANCIAL & ACCOUNTING SEPARATION ENFORCED**

---

## 1. Overview & Operational Principles

This document defines the authoritative, fine-grained permission matrix for the `global_hr_manager` role across all Human Resources, Administration, and Financial operational surfaces.

### Separation of Duties Principle:
> [!IMPORTANT]
> **Decide vs. Post vs. Disburse:**  
> An HR decision to approve a deduction, review an advance, or evaluate compensation **NEVER** confers authority to post entries to the General Ledger, execute bank disbursements, or print financial payment vouchers.
> 
> All accounting postings require an authorized Finance / Accounting role (`admin` or finance specialist with billing portal access).

---

## 2. Definitive Operational Permissions Matrix

Every capability is explicitly categorized across the 7 fundamental enterprise operations:
- **VIEW:** Read-only access to records, dashboards, and reporting summaries.
- **CREATE:** Draft or initialize a new record.
- **UPDATE:** Modify existing details or adjust metadata.
- **APPROVE:** Formally authorize an HR workflow item (e.g. leave, schedule, lateness penalty).
- **DELETE:** Hard-delete or soft-delete/archive an existing item.
- **POST:** Commit accounting journal entries directly to the General Ledger (`/billing/journals`).
- **DISBURSE:** Authorize bank, cash, or payment disbursements (`/billing/payment-vouchers`).

| # | Functional Module | VIEW | CREATE | UPDATE | APPROVE | DELETE | POST | DISBURSE | Operational Scope & Boundary Notes |
| :-: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | **Employee Records** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Full lifecycle across EG & SA; hard deletion blocked |
| **2** | **Contracts & Documents** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Contract terms, national IDs, upload attachments |
| **3** | **Attendance & Timesheets** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Timesheet corrections, attendance regularizations |
| **4** | **Shifts & Schedules** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Template definitions and employee assignments |
| **5** | **Leave Management** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Annual, sick, emergency leave across all branches |
| **6** | **Payroll Visibility** | ✅ ALLOW | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | Read-only payroll summaries; calculations review |
| **7** | **Salary & Compensation Review** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ DENIED | ❌ DENIED | Base salary, pay grades, employment agreements |
| **8** | **Bonuses & Allowances** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ DENIED | ❌ DENIED | Housing, transport, performance incentive decisions |
| **9** | **Deductions Decisions** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ DENIED | ❌ DENIED | Lateness penalty decisions (`people.decide_deductions`) |
| **10** | **Loans & Employee Advances** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ DENIED | ❌ DENIED | HR eligibility approval; disbursement handled by Finance |
| **11** | **Performance Evaluations** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Appraisals, KPI reviews, disciplinary records |
| **12** | **Recruitment & Candidates** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Applicant pipelines, interviews, offer letters |
| **13** | **Onboarding & Offboarding** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Checklists, asset provisioning, exit interviews |
| **14** | **HR Reports & Settings** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ DENIED | ❌ N/A | ❌ N/A | Work locations, lateness policies, company HR hubs |
| **15** | **General Ledger Journals** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | Strictly isolated to Accounting (`/billing/journals`) |
| **16** | **Payment Vouchers / Payouts** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | Strictly isolated to Treasury/Cashier (`/billing/vouchers`) |
| **17** | **Fiscal Closing & Tax (Zakat/VAT)** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | Strictly isolated to Chief Financial Officer / Admin |
| **18** | **Assign Privileged Roles** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ N/A | ❌ N/A | Can only assign `employee` or `viewer`; cannot assign admin/super_admin/manager |
| **19** | **Modify Portal Sub-Roles** | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ DENIED | ❌ N/A | ❌ N/A | Cannot alter tasks, crm, people, or billing sub-roles on other users |
| **20** | **Team Invitations** | ✅ ALLOW | ✅ ALLOW | ✅ ALLOW | ❌ N/A | ✅ ALLOW | ❌ N/A | ❌ N/A | Limited strictly to `employee` and `viewer` with no elevated subroles/permissions |

---

## 3. Financial Separation Workflow in Practice

```
┌─────────────────────────────────┐
│   GLOBAL HR MANAGER (KHULOD)    │
│   • Reviews lateness / absence  │
│   • Approves HR deduction case  │
│   • Sets deduction: 250 SAR     │
└────────────────┬────────────────┘
                 │
                 ▼ (Status: "approved_pending_posting")
┌─────────────────────────────────┐
│     FINANCIAL FIREWALL GATE     │
│   • Global HR has NO billing    │
│     portalAccess                │
│   • PortalGuard blocks /billing │
│   • Rules deny journal creation │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     FINANCE / ACCOUNTING TEAM   │
│   • Reviews approved deduction  │
│   • Generates journal entry     │
│   • Commits debit/credit to GL  │
│   • Issues disbursement voucher │
└─────────────────────────────────┘
```

---

## 4. Enforcement Layer Mapping

| Capability | Frontend Guard | Hook / Service Level | Firestore Security Rule |
| :--- | :--- | :--- | :--- |
| **Employee Read/Write (Multi-Country)** | `PeopleLayout` (`portalAccess.includes("people")`) | `useEmployeesQuery()`, `filterEmployeesByScope` | `match /{collection}/{docId}` with `belongsToCompany(companyId)` |
| **Deduction Decisions** | Deduction review modal rendered | `DeductionCasesService:decideCase` | `peopleHrAllowed(companyId, 'people.decide_deductions')` |
| **Accounting Journal Block** | `<PortalGuard portal="billing">` blocks `/billing/*` | `hasEffectivePermission("billing.view") == false` | `match /journals/{journalId}`: requires company membership and balanced posting |
| **Disbursement Block** | `<PortalGuard portal="billing">` blocks `/billing/*` | `hasEffectivePermission("billing.payment_vouchers") == false` | `match /payments/{paymentId}`: requires finance validation |
| **Anti-Escalation Gate** | Role select filtered to `["employee", "viewer"]` | `getAssignableRoles("global_hr_manager")` | `request.resource.data.role in ['employee', 'viewer']` |

---

## 5. Audit Conclusion

The permission boundaries for `global_hr_manager` provide complete, multi-country administrative authority over Egypt and Saudi Arabia personnel without breaching corporate accounting and treasury boundaries.

