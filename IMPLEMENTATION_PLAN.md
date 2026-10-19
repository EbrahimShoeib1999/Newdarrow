# D-Arrow Business - Unified Lifecycle Implementation Plan

**Generated:** 2026-10-19
**Based on:** RELATIONSHIP_MAP.md and codebase audit
**Objective:** Connect existing modules into a coherent operational lifecycle

---

## Executive Summary

**Good News:** The D-Arrow Business codebase already has significant lifecycle integration:

✅ **Already Implemented (Verified):**
- Unified Customer 360 Profile with tabs for overview, contacts, deals, tasks, notes, attachments, timeline, billing, reports, contracts
- Deal → Customer connection with navigation
- Deal → Contracts filtering
- Deal → Tasks filtering (via dealId and contractId)
- Contract creation from deals with prefill (via URL params)
- Contract → Task conversion with relationship preservation
- Contact → Deals, Contracts, Tasks, Invoices filtering
- Smart task assignment modal
- CRM timeline for activities

**What Needs Enhancement:**
1. Contract → Invoice auto-prefill workflow
2. Deal → Invoice suggestion on won deals
3. Invoice detail page to show related contract/deal/task
4. Unified Operations Dashboard for managers
5. Enhanced timeline to include invoice/payment events
6. Better relationship navigation breadcrumbs across all pages

---

## Implementation Phases

### Phase 1: Strengthen Financial Connections (High Priority)

#### 1.1 Contract → Invoice Auto-Prefill
**Objective:** When creating an invoice from a contract, prefill customer, items, and amounts

**Implementation:**
1. Modify `CreateInvoicePage.tsx` to accept URL params: `?contractId={id}`
2. When contractId is present:
   - Fetch contract by ID
   - Prefill `customerId` from `contract.contactId`
   - Prefill `customerName` from contact data
   - Prefill `contractId` field
   - Prefill `dealId` from `contract.dealId`
   - Generate invoice items from contract services:
     - Use service name as description
     - Use service estimated hours * rate as unit price (or use contract amount field)
     - Use contract VAT rate
3. Add "Create Invoice" button on Contract detail/view
4. Navigate to `/billing/invoices/new?contractId={contractId}`

**Files to Modify:**
- `src/features/billing/pages/CreateInvoicePage.tsx`
- `src/features/crm/components/ContractBuilderForm.tsx` (add invoice button)
- `src/features/billing/hooks/use-invoices.ts` (add prefetched contract query)

**Acceptance Criteria:**
- Invoice creation from contract prefills all relevant fields
- Contract reference is preserved in invoice
- User can modify prefilled data before saving
- Invoice shows link back to contract on detail page

#### 1.2 Deal → Invoice Suggestion on Won Deals
**Objective:** When a deal reaches "won" stage, suggest creating an invoice

**Implementation:**
1. Modify `DealDetailPage.tsx` to detect when `deal.stage === "won"`
2. Add "Create Invoice" action button in smart buttons or header actions
3. When clicked:
   - Check if deal has contract: if yes, redirect to contract → invoice flow
   - If no contract, redirect to invoice creation with dealId and contactId
   - Prefill invoice amount from deal amount
   - Prefill customer from deal.contactId
4. Add indicator if invoice already exists for this deal

**Files to Modify:**
- `src/features/crm/pages/DealDetailPage.tsx`
- `src/features/billing/pages/CreateInvoicePage.tsx` (accept dealId param)

**Acceptance Criteria:**
- Won deals show "Create Invoice" button
- Invoice prefill works with or without contract
- Prevents duplicate invoice suggestions if invoice already exists

#### 1.3 Invoice Detail Page Enhancement
**Objective:** Show related contract, deal, and tasks on invoice detail

**Implementation:**
1. Modify `InvoiceDetailPage.tsx` to fetch related entities:
   - If `invoice.contractId` exists, fetch contract
   - If `invoice.dealId` exists, fetch deal
   - If `invoice.customerId` exists, fetch contact
2. Add "Related Records" section showing:
   - Contract (with link to contract view)
   - Deal (with link to deal view)
   - Customer (with link to customer 360)
   - Tasks linked to contract/deal (if any)
3. Add breadcrumbs navigation

**Files to Modify:**
- `src/features/billing/pages/InvoiceDetailPage.tsx`

**Acceptance Criteria:**
- Invoice detail shows all related records
- Each related record is clickable
- Empty state shown when no relationships exist

---

### Phase 2: Unified Operations Dashboard (High Priority)

#### 2.1 Create Unified Customer Operations Dashboard
**Objective:** Single dashboard for managers to see all customer lifecycle states

**Implementation:**
1. Create new page: `src/features/crm/pages/CustomerOperationsDashboard.tsx`
2. Fetch data across all modules:
   - Contacts with their deals, contracts, tasks, invoices
   - Aggregate metrics per customer:
     - Active deals count and value
     - Pending contracts (not approved)
     - Contracts without delivery tasks
     - Overdue tasks
     - Outstanding invoice balance
     - Total invoiced vs collected
3. Display in card/list format with drill-down:
   - Customer name and type
   - Status badges (e.g., "Attention Required")
   - Key metrics (deals, contracts, tasks, invoices)
   - Last activity date
   - "View Customer 360" button
4. Add filters:
   - Customers with overdue invoices
   - Customers with pending contracts
   - Customers with blocked tasks
   - Customers with won deals but no invoice

**Files to Create:**
- `src/features/crm/pages/CustomerOperationsDashboard.tsx`
- `src/features/crm/hooks/use-customer-operations.ts` (new hook aggregating data)

**Route:** `/crm/operations` (add to router.tsx)

**Acceptance Criteria:**
- Dashboard shows all customers with lifecycle metrics
- Metrics are accurate and clickable
- Filters work correctly
- Each customer links to Customer 360

---

### Phase 3: Enhanced Timeline Aggregation (Medium Priority)

#### 3.1 Comprehensive Customer Timeline
**Objective:** Aggregate all lifecycle events (deals, contracts, tasks, invoices, payments) into unified timeline

**Implementation:**
1. Modify `CrmTimeline` component or create new `UnifiedTimeline` component
2. Fetch events from multiple sources:
   - CRM activities (existing)
   - Deal stage changes
   - Contract creation/approval
   - Task creation/completion
   - Invoice creation/payment
   - Payment recording
3. Normalize event structure:
   - Timestamp
   - Event type (deal_stage_change, contract_created, task_completed, invoice_issued, payment_received)
   - Actor (user who performed action)
   - Related entity (deal, contract, task, invoice)
   - Summary description
4. Display in chronological order with icons and links
5. Add filter by event type

**Files to Modify:**
- `src/features/crm/components/shared/CrmTimeline.tsx` (or create new)
- `src/features/crm/hooks/use-customer-timeline.ts` (new hook)

**Acceptance Criteria:**
- Timeline shows all customer-related events
- Events are in chronological order
- Each event links to source record
- Filters work correctly

---

### Phase 4: Relationship Navigation Enhancement (Medium Priority)

#### 4.1 Breadcrumbs and Related Records Panel
**Objective:** Add consistent navigation breadcrumbs and related records panel across all detail pages

**Implementation:**
1. Create reusable `RelatedRecordsPanel` component
2. Add to each detail page:
   - DealDetailPage: show customer, contracts, tasks, invoices
   - ContractDetailPage: show deal, customer, tasks, invoices
   - TaskDetailPage: show contract, deal, customer, project
   - InvoiceDetailPage: show contract, deal, customer
3. Add breadcrumbs showing navigation path
4. Use consistent styling and icons

**Files to Create:**
- `src/features/crm/components/shared/RelatedRecordsPanel.tsx`

**Files to Modify:**
- `src/features/crm/pages/DealDetailPage.tsx`
- `src/features/crm/pages/ContractPage.tsx` (or create ContractDetailPage)
- `src/features/tasks/pages/task-detail-page.tsx`
- `src/features/billing/pages/InvoiceDetailPage.tsx`

**Acceptance Criteria:**
- All detail pages show related records
- Navigation is consistent
- Empty states handled gracefully

---

### Phase 5: End-to-End Acceptance Testing (Critical)

#### 5.1 Create Test Scenario Script
**Objective:** Execute the mission's required end-to-end scenario with fictional data

**Implementation:**
1. Create test script: `scripts/test-e2e-lifecycle.mjs`
2. Steps:
   - Create 1 customer (contact)
   - Create 2 contact persons (if supported)
   - Create 1 deal linked to customer
   - Create 1 quotation (if supported)
   - Create 1 contract from deal
   - Create 1 project or delivery plan
   - Convert contract to 1 parent task + subtasks
   - Assign tasks to employee
   - Create 1 invoice from contract
   - Record 2 partial payments
   - Verify receipts and journal entries
   - Verify all relationships are preserved
3. Use Firebase emulator for testing
4. Record actual IDs, statuses, amounts
5. Verify navigation between all entities

**Files to Create:**
- `scripts/test-e2e-lifecycle.mjs`

**Acceptance Criteria:**
- All steps execute successfully
- All relationships are preserved
- Navigation works between all entities
- Financial integrity maintained
- Script is idempotent (can be rerun)

---

## Implementation Order

1. **Phase 1 (Financial Connections):** 2-3 days
   - 1.1 Contract → Invoice auto-prefill
   - 1.2 Deal → Invoice suggestion
   - 1.3 Invoice detail enhancement

2. **Phase 2 (Operations Dashboard):** 2 days
   - 2.1 Unified Customer Operations Dashboard

3. **Phase 3 (Timeline):** 1-2 days
   - 3.1 Comprehensive Customer Timeline

4. **Phase 4 (Navigation):** 1-2 days
   - 4.1 Breadcrumbs and Related Records Panel

5. **Phase 5 (Testing):** 1-2 days
   - 5.1 End-to-end acceptance test

**Total Estimated Time:** 7-11 days

---

## Risk Assessment

### Low Risk
- Adding URL params to existing pages (backward compatible)
- Creating new dashboard (doesn't affect existing functionality)
- Enhancing timeline (display-only changes)

### Medium Risk
- Modifying invoice creation logic (needs careful testing)
- Adding new hooks (ensure performance)
- Complex data aggregation (ensure accuracy)

### Mitigation
- All changes use optional URL params (no breaking changes)
- New features are additive (don't modify existing core logic)
- Comprehensive testing with emulator before deployment
- Maintain existing functionality as-is

---

## Success Criteria

By the end of this implementation:

1. ✅ Single Source of Truth: All entities use stable IDs for relationships
2. ✅ Unified Customer 360: Customer profile shows all related records (already done)
3. ✅ Deal Lifecycle: Deals connect to customer, contracts, tasks, invoices (enhanced)
4. ✅ Contract Automation: Contracts prefill from deals and auto-generate tasks (already done)
5. ✅ Invoice Automation: Invoices prefill from contracts/deals (new)
6. ✅ Delivery Work: Tasks generated from contracts with relationship preservation (already done)
7. ✅ Eliminated Duplicate Entry: Prefill reduces manual data entry (enhanced)
8. ✅ Unified Timeline: Comprehensive customer timeline (new)
9. ✅ Relationship Navigation: Easy navigation between related records (enhanced)
10. ✅ Operations Dashboard: Manager view of all lifecycle states (new)
11. ✅ Financial Integrity: Accounting transactions maintain consistency (verified)
12. ✅ End-to-End Tested: Complete lifecycle executed and verified (new)

---

## Files Changed Summary

### New Files
- `src/features/crm/pages/CustomerOperationsDashboard.tsx`
- `src/features/crm/hooks/use-customer-operations.ts`
- `src/features/crm/hooks/use-customer-timeline.ts`
- `src/features/crm/components/shared/RelatedRecordsPanel.tsx`
- `scripts/test-e2e-lifecycle.mjs`

### Modified Files
- `src/features/billing/pages/CreateInvoicePage.tsx`
- `src/features/billing/pages/InvoiceDetailPage.tsx`
- `src/features/crm/pages/DealDetailPage.tsx`
- `src/features/crm/components/ContractBuilderForm.tsx`
- `src/features/crm/components/shared/CrmTimeline.tsx`
- `src/features/tasks/pages/task-detail-page.tsx`
- `src/app/router.tsx` (add operations dashboard route)

### Documentation Files
- `RELATIONSHIP_MAP.md` (already created)
- `IMPLEMENTATION_PLAN.md` (this file)
- `ACCEPTANCE_REPORT.md` (to be created after testing)
