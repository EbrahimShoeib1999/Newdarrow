# Phase 10 — Data Migration, Compatibility & Observability

## Summary

All data-model changes introduced in Phases 5–9 are **purely additive**:
no existing Firestore documents are mutated, rewritten, or backfilled.
Legacy records without the new fields degrade gracefully at read time.

## Affected Collections and Fields

| Phase | Change | Collections / Paths | Backward Compatibility |
|-------|--------|---------------------|------------------------|
| P5 | Expense-category rollup | Read-time derivation in `project-financials.ts`; no schema change | N/A — purely computed |
| P6 | task→project traceability link | Read-time UI navigation; no stored field | N/A — display only |
| P7a | Extended `ProjectActivityType` | `companies/{id}/projects/{id}` field `activityType` | `supportsUnitInventory(undefined)` → false; legacy types unaffected |
| P7b | New Units subcollection | `companies/{id}/projects/{id}/units/{unitId}` | Non-existent for old projects; `UnitService.list()` returns `[]` via empty `getDocs` |
| P8 | `whatsappSupportPhone` field | `companies/{id}` document | Optional (`whatsappSupportPhone?: string`); absent → UI shows "not configured" |
| P9 | Automation events | `companies/{id}/automationEvents/{eventId}` | New subcollection; absent until first automation fires; no reads from legacy code |

## Migration Behavior

**No migration script is required.** Each change uses the "lazy adoption" pattern:

- New fields are optional (`?.`) or default gracefully.
- New subcollections only materialize when their feature is first used.
- `normalizeUnit()` handles missing `statusHistory` → defaults to `[]`.
- `mapCompanyDoc()` reads `whatsappSupportPhone ?? undefined` — no crash when absent.
- The automation scanner writes its first event only when a condition is met.

**Retry safety**: All new Firestore operations use deterministic doc IDs (`automationEventId`).
Re-running the same automation within the same period reads the existing token and skips
(`skipped_duplicate`). No destructive updates.

## Tenant Isolation

All new data lives under `companies/{companyId}/...`, protected by the existing
firestore.rules catch-all (`belongsToCompany(companyId)`). Cross-tenant reads
are denied by the rules (verified in Phase 3 functional tests + Phase 7 integration tests).

## Reports & UI Screens Verified

- **ProjectDetailPage**: Units tab appears only for `real_estate` / `property_management` projects; all other project tabs unchanged.
- **Billing / Bills list**: The `useUpdateBillMutation` return type changed from `Bill` to `{ updated, previousApproval }` — callers use `await mutateAsync(...)` without destructuring, so no UI breakage (verified: `CreateBillPage`, `ProjectDetailPage`).
- **AppLayout**: New hooks (`useAutomationScanner`, `AssistantLauncher`) mount conditionally; no effect on existing layout.
- **Company Profile Form**: New `whatsappSupportPhone` input is optional; the form submits the same `zodResolver(companySchema)` as before.

## Operational Logging

The existing `withLogging(serviceName, actionName, promise)` utility wraps:

- `UnitService.list/create/update/changeStatus/remove`
- `AutomationService.fireOnce`
- All pre-existing service methods

Structured output: timestamp + service + action + latency. Errors include the stack trace via console.error.

**Sensitive data excluded**: No tokens, passwords, payment credentials, or customer PII
are logged. The automation event doc records only `ruleId`, `entityId`, `outcome`, and
timestamps.

## Rollback & Recovery

To roll back to a pre-Phase-7/8/9 state:

1. Remove the Units tab gate from `ProjectDetailPage` (UI only; stored unit docs become orphaned but harmless).
2. Remove `whatsappSupportPhone` from the form (field stays in Firestore as unknown, never read).
3. Remove `useAutomationScanner()` from AppLayout (events stop firing; existing automation event docs are inert).
4. Remove `AssistantLauncher` from AppLayout (floating button disappears).

No Firestore cleanup is required — orphaned data costs negligible storage and reads are
never issued unless the feature is re-enabled.

## Verification Commands

```bash
# Full tsc + regression
npx tsc -b && npm run build

# Projects lifecycle (includes unit tests for P7)
npx tsx scripts/test-projects-lifecycle.ts

# Automation unit predicates
npx tsx scripts/test-automation-unit.ts

# Integration (emulator, includes unit cross-tenant denial)
npm run test:projects-integration

# Assistant + WhatsApp security
npx tsx scripts/test-assistant-support.ts
```
