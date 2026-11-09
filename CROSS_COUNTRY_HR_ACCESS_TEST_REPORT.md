# Cross-Country HR Access Test Report

## Executive Overview
This report documents the verification and test execution results for the cross-country HR visibility, management, and tenant isolation capabilities of **`khulodahmed390@gmail.com`** acting as **GLOBAL HR & ADMINISTRATION MANAGER** (`global_hr_manager`).

All tests were executed against real running services using the local Firebase Auth and Firestore emulators along with real Microsoft Edge headless browser testing via Chrome DevTools Protocol (CDP).

---

## 1. Test Results Matrix

| # | Test Scenario | Target Entity / Path | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **View Egyptian employees** | Nour El-Masri (Cairo), Hassan Alex (Alexandria) | Both visible in employee list | Nour & Hassan visible | **PASS** |
| 2 | **View Saudi employees** | Norah (Riyadh), Albraa (Riyadh), Zainab (Riyadh), Mohamed (Jeddah) | All 4 visible in employee list | All 4 visible | **PASS** |
| 3 | **View all company employees** | All Egypt & Saudi workforce | Unfiltered aggregated list | 6/6 company employees displayed | **PASS** |
| 4 | **Filter Egypt** | Country filter set to "Egypt" | Only Egyptian employees visible; Saudi employees hidden | Nour & Hassan visible; Saudi employees omitted | **PASS** |
| 5 | **Filter Saudi Arabia** | Country filter set to "Saudi Arabia" | Only Saudi employees visible; Egyptian employees hidden | Norah, Albraa, Zainab, Mohamed visible; Egypt employees omitted | **PASS** |
| 6 | **Filter All Countries** | Country filter set to "ALL" | Both Egyptian and Saudi employees visible | Full list restored | **PASS** |
| 7 | **View Egyptian employee profile** | `/people/e-nour-cairo` | Profile loaded with details (Engineering, salary, attendance) | Full profile loaded | **PASS** |
| 8 | **View Saudi employee profile** | `/people/e-norah-riyadh` | Profile loaded with details (Operations, salary, attendance) | Full profile loaded | **PASS** |
| 9 | **Authorized Egyptian employee editing** | Edit profile button on `/people/e-nour-cairo` | Edit modal accessible with inputs | Edit modal opened; fields modifiable | **PASS** |
| 10 | **Authorized Saudi employee editing** | Edit profile button on `/people/e-norah-riyadh` | Edit modal accessible with inputs | Edit modal opened; fields modifiable | **PASS** |
| 11 | **View attendance across countries** | `/people/timesheets` & attendance API | Egyptian and Saudi attendance records both accessible | Both records retrieved | **PASS** |
| 12 | **View leave requests across countries** | `/people/leave` & leave API | Pending leave requests for EG & SA visible | Both requests visible & actionable | **PASS** |
| 13 | **Payroll & Compensation review** | `/people/deduction-cases` | Deduction cases accessible for evaluation | Successfully accessed & evaluated | **PASS** |
| 14 | **Separation of Duties: Accounting GL posting** | `/billing/journals` | Direct navigation blocked / Access Denied | `PortalGuard` triggered (`ShieldAlert`, `portals.billing.denied`) | **PASS** |
| 15 | **Session persistence across Page Refresh** | Browser reload on `/people` | Session, role, and cross-country visibility persist | No redirect to login; all employees present | **PASS** |
| 16 | **Session persistence across Re-login** | Sign out and sign in with target credentials | Account recognized as `global_hr_manager` | Cross-country visibility intact | **PASS** |
| 17 | **Direct URL navigation to employee records** | Direct load of `/people/:id` for EG and SA | Accessible without country restriction | Direct access confirmed | **PASS** |
| 18 | **Paginated employee lists** | Pagination controls with filters | Resets to page 1 on filter switch; preserves total counts | Verified | **PASS** |
| 19 | **Search employees across countries** | Query "Norah" and query "Nour" | Matches found regardless of user's local country | Verified | **PASS** |
| 20 | **Tenant isolation: Foreign company employees** | Foreign employee in `co-foreign-corp` | Never visible on `/people` or readable via queries | 0 foreign records leaked | **PASS** |
| 21 | **Tenant isolation: Foreign Firestore queries** | Firestore rules attempt on other `companyId` | Permission denied (403) | Enforced by Firestore Security Rules | **PASS** |
| 22 | **Country-level HR regression check** | Restricted manager in Cairo (`branch-cairo`) | Cannot see Saudi employees; sees only Cairo branch | Restricted to Cairo; 0 Saudi records leaked | **PASS** |
| 23 | **Ordinary employee private data protection** | Employee account reading colleague private records | Blocked by rules | Enforced | **PASS** |
| 24 | **Super Admin regression check** | `super_admin` operations | Full system-wide access preserved | Verified | **PASS** |

---

## 2. Screenshot Artifacts Generated During Browser E2E

The test suite executed via Microsoft Edge CDP produced the following timestamped screenshot evidence in `tmp/global-hr-e2e/`:

- `01-global-hr-post-login.png`: Successful login of `khulodahmed390@gmail.com` landing on application shell.
- `02-global-hr-people-dashboard-all.png`: Default "All Countries" view showing Egyptian (Nour, Hassan) and Saudi (Norah, Albraa, Zainab, Mohamed) employees together.
- `03-global-hr-filter-egypt.png`: Filter switched to Egypt showing only Egyptian personnel.
- `04-global-hr-filter-saudi.png`: Filter switched to Saudi Arabia showing only Saudi personnel.
- `05-global-hr-view-egypt-profile.png`: Egyptian employee detailed profile page.
- `06-global-hr-view-saudi-profile.png`: Saudi employee detailed profile page.
- `07-global-hr-edit-modal-open.png`: Edit profile modal open with title, department, salary inputs.
- `08-global-hr-timesheets-module.png`: Timesheets and attendance dashboard across countries.
- `09-global-hr-leave-module.png`: Leave tracker view across countries.
- `10-global-hr-separation-of-duties.png`: `PortalGuard` protection blocking access to `/billing/journals`.
- `11-global-hr-after-refresh.png`: Uninterrupted visibility after F5 page reload.
- `12-global-hr-after-relogin.png`: Uninterrupted visibility after logout and subsequent login.

---

## 3. Summary of Findings
- **Cross-Country Visibility:** 100% PASS. Egyptian and Saudi employees are displayed seamlessly without country-of-origin bias.
- **Tenant Isolation:** 100% PASS. Zero records leaked across `companyId` boundaries.
- **Security & Separation of Duties:** 100% PASS. HR management and deduction evaluation are fully functional while accounting journal commits are strictly gated.
- **Regression:** 100% PASS. Country-restricted managers and branch managers remain properly scoped to their local territories.

