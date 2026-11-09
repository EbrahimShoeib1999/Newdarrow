# HR Role & Permission Matrix

## Overview
This matrix details the exact capability assignments across all user role tiers in the D-Arrow Business platform, specifically comparing **Super Admin**, **Company Admin**, **GLOBAL_HR_MANAGER**, **Country-Level HR Manager**, **Branch Manager**, and **Ordinary Employee**.

---

## 1. Role Comparison Matrix

| Domain / Permission Area | Capability | SUPER_ADMIN | ADMIN | GLOBAL_HR_MANAGER | COUNTRY_HR_MGR | BRANCH_MGR | EMPLOYEE |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Employee Scope** | Organization-wide visibility | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Egypt personnel access | ✅ | ✅ | ✅ | ✅ (If EG) | ✅ (If Cairo/Alex) | Own record |
| | Saudi Arabia personnel access | ✅ | ✅ | ✅ | ✅ (If SA) | ✅ (If Riyadh/Jeddah) | Own record |
| | Cross-country transfers | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Cross-tenant visibility | ✅ (Platform) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Employee Management** | Create & Onboard employees | ✅ | ✅ | ✅ | ✅ (Local) | ❌ | ❌ |
| | Edit employee titles/departments | ✅ | ✅ | ✅ | ✅ (Local) | ✅ (Local) | ❌ |
| | Activate / Deactivate employee | ✅ | ✅ | ✅ | ✅ (Local) | ❌ | ❌ |
| | Manage contracts & documents | ✅ | ✅ | ✅ | ✅ (Local) | ❌ | Own docs |
| | Manage job titles / roles | ✅ | ✅ | ✅ (Roles <= Employee) | ❌ | ❌ | ❌ |
| **Attendance Management**| View attendance organization-wide | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View attendance in Egypt & Saudi | ✅ | ✅ | ✅ | Local only | Local only | Own only |
| | Review lateness and absences | ✅ | ✅ | ✅ | Local only | Local only | Own only |
| | Approve/reject attendance corrections| ✅ | ✅ | ✅ | Local only | Local only | ❌ |
| | Manage work schedules & policies | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Access attendance reports | ✅ | ✅ | ✅ | Local only | Local only | Own only |
| **Leave Management** | View all leave requests | ✅ | ✅ | ✅ | Local only | Local only | Own only |
| | Approve / Reject leave requests | ✅ | ✅ | ✅ | Local only | Local only | ❌ |
| | Manage leave balances & policies | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Cross-country leave audit | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Compensation & Payroll**| View salary & allowances | ✅ | ✅ | ✅ | Local only | ❌ | Own only |
| | Review compensation calculations | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Decide deduction cases | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | Post deductions to GL Accounting | ✅ | ✅ | ❌ *(Duties separated)* | ❌ | ❌ | ❌ |
| | Create manual accounting journals | ✅ | ✅ | ❌ *(Duties separated)* | ❌ | ❌ | ❌ |
| **Recruitment & Admin** | Manage invites for hiring | ✅ | ✅ | ✅ (`employee`/`viewer`) | ❌ | ❌ | ❌ |
| | Invite Tenant Admins | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| | View company billing & subscriptions| ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| | View pricing & plans | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| | View company profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 2. Technical Key Assignments for `global_hr_manager`

In [`src/lib/permissions/index.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/permissions/index.ts), the role definition contains:
```ts
global_hr_manager: [
  "portals.people",
  "company.view",
  "pricing.view",
  "users.manage_roles",
  "people.view",
  "people.manage_employees",
  "people.approve_leave",
  "people.view_performance",
  "people.view_all_reports",
  "people.view_schedules",
  "people.manage_schedules",
  "people.view_all_attendance",
  "people.correct_attendance",
  "people.view_lateness",
  "people.evaluate_lateness",
  "people.manage_lateness_policies",
  "people.decide_deductions",
]
```

### Portal Sub-Role Configuration:
In [`src/lib/permissions/sub-roles.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/permissions/sub-roles.ts):
```ts
global_hr_manager: {
  tasks: "member",
  crm: "viewer",
  people: "admin",
}
```

### Role Assignment Hierarchy:
In [`src/lib/permissions/role-assignment.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/lib/permissions/role-assignment.ts):
```ts
if (actorRole === "global_hr_manager") {
  return ["employee", "viewer"];
}
```
This guarantees that while `global_hr_manager` can provision, invite, and onboard operational employees, they cannot escalate any user to administrative or supervisory roles.

