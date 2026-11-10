# D-ARROW — COMPANY-WIDE EMPLOYEE VISIBILITY TEST REPORT
**Document Reference:** SEC-CVT-2026-V1  
**Target Environment:** Local Workspace & Production Ready  
**Date:** 2026-11-10  
**Status:** ALL TESTS PASSED (19/19)  

---

## 1. Scope & Objective

To verify that the authorized DArrow company-wide administrator (General Manager `platform_admin` / Khuloud) has complete, uninterrupted visibility across:
1. Egypt office employees.
2. Egypt remote employees.
3. Saudi Arabia office employees.
4. Saudi Arabia remote employees.

And to ensure that country filters and work-mode filters in [`PeopleDashboardPage.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/people/pages/PeopleDashboardPage.tsx) normalize variants without excluding legitimate staff.

---

## 2. Forensic Corrections Implemented

1. **Country Normalization in [`people.service.ts`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/people/api/people.service.ts):**
   - Exported and expanded `canonicalCountryKey`:
     - Normalizes `"Saudi Arabia"`, `"SA"`, `"KSA"`, `"Riyadh"`, `"Jeddah"`, `"Dammam"` to `"sa"`.
     - Normalizes `"Egypt"`, `"EG"`, `"Cairo"`, `"Alexandria"`, `"Giza"` to `"eg"`.
2. **Dashboard Filter Matching in [`PeopleDashboardPage.tsx`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/src/features/people/pages/PeopleDashboardPage.tsx):**
   - Updated `matchCountry` to compare canonical keys:
     ```ts
     const matchCountry =
       !countryFilter ||
       countryFilter === "ALL" ||
       canonicalCountryKey(e.country || "") === canonicalCountryKey(countryFilter);
     ```
   - Updated `matchWorkMode` to recognize both `"office"` and `"onsite"`, and infer remote locations.
3. **Caller Scope Resolution:**
   - In `PeopleService.getEmployees()`, updated line 590 to ensure `platform_admin` and `super_admin` are always granted company-wide caller scope:
     ```ts
     if (authUser && (authUser.role === "platform_admin" || authUser.role === "super_admin" || authUser.companyId === companyId))
     ```

---

## 3. Test Matrix & Execution Results

| Test Case | Scenario | Expected Result | Actual Result |
|---|---|---|---|
| **SA Normalization** | Input `"Saudi Arabia"`, `"SA"`, `"KSA"` | Normalized to `"sa"` | **PASS** |
| **EG Normalization** | Input `"Egypt"`, `"EG"`, `"Cairo"` | Normalized to `"eg"` | **PASS** |
| **GM Visibility** | Scope `{ role: "platform_admin", countryScope: ["EG", "SA"] }` | Sees all 4 archetypes (EG & SA, Office & Remote) | **PASS** (4/4 visible) |
| **ALL Filter** | `countryFilter = "ALL"` | Retains 100% of employees | **PASS** (4/4 visible) |
| **Saudi Filter** | `countryFilter = "Saudi Arabia"` | Returns Riyadh Office & Jeddah Remote | **PASS** (2/2 visible) |
| **Egypt Filter** | `countryFilter = "Egypt"` | Returns Cairo HQ & Alex Remote | **PASS** (2/2 visible) |
| **Remote Filter** | `workModeFilter = "remote"` | Returns EG Remote & SA Remote | **PASS** (2/2 visible) |
| **Employee Isolation** | Scope `{ role: "employee", branchId: "cairo" }` | Restricted to own branch | **PASS** |

**Summary Result:** **19/19 Tests Passed** in [`scripts/test-company-unification-suite.mjs`](file:///e:/real%20projects/DArrow/New%20folder/d-arrow-business/scripts/test-company-unification-suite.mjs).

