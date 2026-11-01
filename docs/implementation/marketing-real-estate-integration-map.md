# Marketing Agency + Real Estate — System-Wide Integration Map

**Phase 0/1 deliverable** (Discovery → Reuse → Integrate → Extend → Build → Test).
Every row was verified against the current source tree (routes, services, `firestore.rules`,
`storage.rules`, nav trees, test scripts) — not against prior docs alone.

- **Marketing activity id:** `MARKETING_AGENCY` · namespace `/agency` · collections `mkt_*` · portal `agency`
- **Real Estate activity id:** `REAL_ESTATE_MANAGEMENT` · namespace `/real-estate` · collections `rem_*` · portal `real_estate`
- **Activity engine:** `companies/{id}.primaryActivity` resolved from Firestore on every load
  (`src/features/activities/`), enforced by `ActivityRouteGuard` + `resolveRouteAccess`
  (`src/lib/activity-routes.ts`) and fail-closed by `firestore.rules`
  (`domainOwnerActivity()` maps `^rem_.*`/`^mkt_.*` → owning activity; `domainAccessAllowed` requires
  tenant membership **and** the authoritative activity).
- **Shared portals** (CRM, Tasks, Projects, Billing, People, Chat, Documents) are reachable by every
  activity through the portal switcher — `PORTAL_ACTIVITY` only maps `real_estate`, `facilities`,
  `agency`, `school`, etc.; `crm`/`billing`/`tasks`/`projects` have no owner, so they stay shared.

Strategies: **REUSE** · **EXTEND** · **CONFIGURE** · **NEW** · **BLOCKED**

---

## 1. Marketing Agency activity

### 1.1 Clients & Sales (must be the shared CRM — no duplicate entities)

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Clients (companies/accounts) | CRM contacts (type=customer) | `/crm/contacts` | `contacts` / CrmService | REUSE | None — campaign stores `clientId` → validated against tenant `contacts` at write (`assertTenantRef`) |
| Contacts | CRM | `/crm/contacts/:id` | `contacts` | REUSE | None |
| Leads + sources + follow-ups | CRM | `/crm/leads` | `leads` | REUSE | None |
| Lead → opportunity conversion (no dup client/contact) | CRM | `/crm/leads/:id`, `/crm/deals` | `leads`,`deals` | REUSE | None |
| Opportunities + pipeline stages + deal values + lost reasons | CRM kanban | `/crm/deals` | `deals` | REUSE | None |
| Quotations | CRM quotation builder | `/crm/quotations` | `quotations` | REUSE | None |
| Contracts (marketing service contracts) | CRM contract builder | `/crm/contracts` | `contracts` | REUSE | None — campaign stores `contractId` → validated |
| Client notes / activity timeline | CRM unified timeline | `/crm/contacts/:id` | `activity_logs` | REUSE | Campaign detail already links client → CRM timeline (commit `605d05d`) |
| Service interests | CRM lead service categories (static 5-item list) | `/crm/leads` | `crm/constants/lead-service-categories.ts` | CONFIGURE | Static list only; see 1.2 services catalog |
| Marketing nav exposure of CRM pages | portal-switcher architecture | `/apps` → CRM portal | — | CONFIGURE | Agency sidebar shows only `agency`-portal pages (by design, §5 forbids duplicating sidebars). Optional: cross-portal nav entries in `AGENCY_NAV_TREE` |

### 1.2 Marketing operations

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Campaigns (list/create/edit/detail) | **agency-owned** | `/agency/campaigns`, `/agency/campaigns/:id` | `mkt_campaigns` (`CampaignService`) | REUSE | Complete: transactional `CMP-` codes, status machine, audited history |
| Campaign objective/channels/dates/status/team | agency-owned | `/agency/campaigns/:id` | `mkt_campaigns` | REUSE | Complete |
| Budget allocation + revision governance | agency-owned | `/agency/campaigns/:id` | `mkt_campaigns.budgetRevisions[]` | REUSE | Complete (propose/approve/reject audited) |
| Actual spending (campaign expenses) | agency-owned | `/agency/campaigns/:id` | `mkt_expenses` (`ExpenseService`) | EXTEND | Expenses are domain rows w/ amount snapshot; no reference into shared `bills`/payment vouchers. Optional link (`billId`) to close the loop with Accounting |
| Campaign ↔ invoice revenue link | agency + billing | `/agency/campaigns/:id` | `invoices.campaignId` (pure ref) | REUSE | Complete (link/unlink, revenue derived from billing, never copied) |
| Campaign tasks / project association | Tasks + Projects (shared) | `/tasks`, `/projects` | `tasks`, `projects` | **EXTEND** | **MISSING in campaign workspace**: no per-campaign task rollup or project link. Deliverables carry `assignee` only. Close by storing `projectId`/`taskIds` refs on campaign validated against shared collections — no new engine |
| Performance records (manual, honest) | — | — | — | **NEW** | **MISSING**: no `mkt_performance_records`. Spec §3.4 allows manual records when no platform API exists. New entity justified: campaign-scoped metric entries (date, channel, impressions, clicks, etc.) user-entered, tenant-isolated |
| Services & packages catalog | CRM quotation line items + static categories | `/crm/quotations`, `/billing/products` | `quotations`, billing `products` | **EXTEND** | **PARTIAL**: no tenant-manageable Service/Package entity (pricing, active flag, included deliverables). Two non-duplicative options: extend billing `products` w/ service metadata, or shared CRM catalog. Needs design decision (prior audit deferred it deliberately) |
| Content management (ideas/plans/calendar/copy/attachments/schedule/status/assignee/campaign) | agency-owned | `/agency/content` | `mkt_content_items` (`ContentService`) | REUSE | Core fields complete incl. status machine draft→approved→scheduled→published + server-stamped `publishedAt` |
| Content categories & formats | agency-owned | `/agency/content` | `mkt_content_items.channel` | CONFIGURE | Channel enum exists; explicit category/format taxonomy + content history per item not verified as UI filters — small EXTEND if required |
| Publishing calendar (calendar view, today/upcoming/overdue, filters by campaign/client/channel/status) | agency-owned | `/agency/content` (sorted list/table) | `mkt_content_items` | **EXTEND** | **PARTIAL**: list view w/ campaign filter; spec's calendar-style view + client/channel/status filter set + overdue highlight not fully present |
| Reviews & client approvals (internal review, approve/reject/revision, comments, timestamps, revision history, locking) | agency-owned review machine | `/agency/deliverables` | `mkt_deliverables` (review states, sign-off, audited history) | REUSE | Complete w/ publication gate. Note: uses domain state machine, not the generic people/`approvals` engine — transition legality + `marketing.manage` enforced service-side and by rules |
| Deliverables (files, versions, campaign/project link, assignee, review status, dates, feedback, attachments) | agency-owned + shared Storage | `/agency/deliverables`, `/agency/briefs` | `mkt_deliverables`, `mkt_briefs`, `domain/mkt_briefs/{companyId}/…` | REUSE | Complete; version-chain on deliverables is the only sub-item to confirm against spec 3.8 depth |
| Marketing dashboard | agency-owned | `/agency` | derived from `mkt_*` | REUSE | Complete & honest (every card links to a filtered route) |
| Campaign reports (budget-vs-actual, delivery) | agency-owned | `/agency/reports` | derived | REUSE | Complete |
| Client performance reports | CRM `ClientReportsPage` | `/crm/client-reports` | `client_reports` | EXTEND | Marketing-scoped client report (campaign revenue vs spend per client) not surfaced; derivable from existing refs (`invoice.campaignId`, `campaign.clientId`) |
| Invoices & collections | Billing | `/billing/invoices` | `invoices` | REUSE | Complete |
| Marketing-scoped notifications (overdue deliverables, upcoming publishing) | shared `notifications` collection + UI | `/notifications` | `notifications` | **EXTEND** | **PARTIAL**: REM already writes idempotent notifications; agency does not. Reuse the REM `generateReminders` pattern (deterministic doc ids) for `mkt_*` events |

### 1.3 Marketing execution (team)

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Employees / departments / roles / permissions | People (HR) + companies | `/people`, `/settings/team`, `/settings/roles` | `users`, `employees` | REUSE | No duplicate employee records in agency; deliverables reference `assigneeId` |
| Tasks & sprints | Tasks portal | `/tasks` | `tasks` | REUSE | See campaign-task rollup EXTEND above |
| Projects | Projects core module | `/projects` | `projects` | REUSE | Campaign→Project association is the open EXTEND |

---

## 2. Real Estate & Property/Unit management

### 2.1 Property registry

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Properties (listing, register, edit, detail, code, type, address, city/district, status, images, docs, search/filters) | **rem-owned** | `/real-estate/properties`, `/real-estate/properties/:id` | `rem_properties` (`PropertyService`), transactional `PRP-` codes | REUSE | Complete; hard-delete blocked when links exist |
| Buildings (+ codes, floors) | rem-owned | managed inside property workspace (`BuildingFormModal`, `Floor` in types) | `rem_buildings` + `Floor` model, `BLD-` codes | REUSE | Complete. Not standalone nav pages by design (buildings live in property detail) |
| Units (code, type, floor/building, area, beds/baths, furnishing, rent/sale price, availability, images, docs, occupancy history, active contract) | rem-owned | `/real-estate/units`, `/real-estate/units/:id` | `rem_units` (`UnitService`), `UNT-` codes | REUSE | Complete; occupancy **derived** from live leases (`deriveOccupancyState`) + cache sync service-side — not a client-only flag |
| Property types / unit types | rem-owned static enums | forms | `real-estate.types.ts` | CONFIGURE | Tenant-manageable type registries not present (static enum). Acceptable unless client demands custom taxonomy — then EXTEND with a settings doc |
| Available-units / occupancy views | rem-owned | `/real-estate/units` (status filter), dashboard occupancy report | `rem_units.occupancyStatus` | REUSE | Occupancy report + CSV export exist (`RemReportsPage`) |
| Overlapping-contract prevention | rem-owned | lease activate path | `findLeaseOverlap` re-checked at activation | REUSE | Service+rules re-validate on CURRENT data; documented residual web-client race (no server functions) |
| Property documents | rem-owned + Storage | property/unit/lease detail (`DocumentsPanel`) | `rem_property_documents`, `domain/rem_property_documents/…` (+ sensitive partition) | REUSE | Complete, size/MIME validation, officer-only sensitive partition in `storage.rules` |

### 2.2 People

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Owners (profile, individual/company, ownership %, owned properties, docs) | CRM contacts + rem ownership rows | `/crm/contacts` + property detail ownership panel | `contacts`, `rem_ownerships` (`OwnershipService`, allocation + date-range conflict validation) | REUSE | Owner identity = CRM contact (`ownership → CRM contact` validated at write). **No owner-facing pages inside REM sidebar** — owner portfolio/financial summary lives in property detail |
| Tenants (profile, docs, occupied units, contracts, schedule, payments, balances, timeline) | CRM contacts + rem rows | `/crm/contacts/:id` + `/real-estate/leases/:id` | `contacts` (`tenantContactId` validated), `rem_leases`, `rem_rent_installments`, `rem_rent_payments` | EXTEND | Data complete; **tenant statement** (single printable/derivable account of due/paid/outstanding per tenant) not surfaced as a dedicated view |
| Customers / Vendors | CRM + facilities vendors | `/crm/contacts`, `/facilities/vendors` | `contacts`, `fm_vendors` | REUSE | Work orders raised from REM already use the facilities vendor lifecycle |

### 2.3 Leasing

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Rental contracts | **rem-owned leasing domain** | `/real-estate/leases`, `/real-estate/leases/:id` | `rem_leases` (`LeaseService`), `LSE-` codes, draft→pending→active→expiring/expired/terminated/cancelled machine | REUSE | See ⚠ note below. Full: renewals (`renewedFromLeaseId`), amendments (audited), termination (reason-required, history preserved, never deleted — rules `allow delete: if false`) |
| Renewals / terminations | rem-owned | lease detail + `RenewLeaseModal`, `AmendLeaseModal`, `HandoverFormModal` | same | REUSE | Complete |
| Occupancy effects on units | rem-owned | unit detail | occupancy sync | REUSE | Complete |
| Handover (move-in/out) records | rem-owned | lease/unit detail | `rem_handover_records` | REUSE | Complete (follow-up work orders link facilities) |

> ⚠ **Architecture finding (honest, deliberate):** spec §4.7 suggests extending the shared CRM
> `contracts` collection. The shipped implementation instead keeps leases in `rem_leases` — a
> domain leasing model with schedule/payment/deposit/occupancy invariants that CRM service contracts
> do not carry (CRM contracts are still used by Marketing and remain intact). No parallel *service-contract*
> system exists. Migrating leases into `contracts` would be a destructive schema migration — **not
> performed** per rule "Do not perform destructive migrations / do not backfill without approval".
> Status recorded as REUSE of an established domain design, flagged for explicit client sign-off.

### 2.4 Financial management

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Rent schedule (installments, frequency, due day, grace, escalations, custom due dates, advance/arrears) | rem-owned | lease detail / `/real-estate/collections` | `rem_rent_installments` (deterministic ids `${leaseId}_${index}` → idempotent generation) | REUSE | Complete; funded installments immutable |
| Rent collections / partial payments / methods / references | rem-owned, rules-gated | `/real-estate/collections` | `rem_rent_payments` (`PaymentService`, allocation validation, `real_estate.collect` permission in rules) | REUSE→EXTEND | Balances always re-derived from allocation set — client never supplies balance; double-submit killed by `ipk_` deterministic ids. **EXTEND candidate:** mirror receipts into shared billing `receipt-vouchers`/`invoices` so rental cash appears in the general ledger today (see ⚠ note) |
| Payment history / outstanding balances | rem-owned | collections desk, lease detail | derived from installments | REUSE | Complete |
| Security deposits (liability, receipt, deduction w/ reason+inspection evidence, refund) | rem-owned | `/real-estate/deposits` | `rem_security_deposits` (doc id = lease id), liability never touches revenue reports | REUSE | Complete |
| Receipts | rem-owned attachment (`receiptUrl`) + Storage | payment flow | `rem_rent_payments.receiptUrl` | EXTEND | No billing receipt-voucher number printed; a rent receipt PDF/statement is derivable and spec-listed |
| Operating expenses (category, property/unit, amount, date, vendor, attachments, approval, accounting reference) | rem-owned view over shared billing | `/real-estate/expenses` | `rem_property_expenses` (`ExpenseService`; approval mirrors bills contract client-side) | EXTEND | Rows store a reference (bill/voucher/journal) + amount snapshot but **do not auto-create** the shared `bills` document. Documented rules gap: subcollection writes are member-level; approval enforced service/client-side |
| Property budgets | — | — | — | NEW | Spec lists "Property Budgets"; nothing exists. Could reuse campaign-style budget-revision governance as a pattern over a new `rem_property_budgets` row or per-property target on `rem_properties` — needs decision |
| Invoices & receipts (rental) | Billing | `/billing/invoices`, `/billing/receipt-vouchers` | `invoices`, `vouchers` | EXTEND | Same ⚠ as rent collections: today REM money lives only in `rem_*`. Bridging (service-side optional creation of a billing receipt voucher per rent payment, tenant-consent gated) is the main open financial-integration item |
| Financial reports (rental income, collections, cash flow) | rem-owned reports | `/real-estate/reports` | derived (`rem-export.ts` CSV) | REUSE | Complete w/ permission-gated export |

> ⚠ The REM money model is **trusted-service** (normalization, allocation validation, idempotency,
> void-audit, rules-gated `real_estate.collect`, no client-supplied balances) and satisfies the
> spirit of §4.8, but it is **not the Accounting module itself**. Rental cash currently does **not**
> post journal entries. Closing this is an EXTEND decision (mirror to billing vouchers), not a rewrite.

### 2.5 Operations

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| Maintenance requests | **Facilities module** (WorkOrderService) | `/facilities/work-orders` | `fm_work_orders` | REUSE→EXTEND | REM raises work orders through facilities (`createWorkOrderForIssue`) — no parallel system. **Missing:** a REM-side request intake (tenant-initiated) + work-order list scoped to properties inside `/real-estate`. Spec §4.9 nav not present in `REAL_ESTATE_NAV_TREE` |
| Inspections (checklist, photos, meter readings, issues→work orders, finalize, versions) | rem-owned | `/real-estate/inspections` | `rem_inspections` (finalized immutable; versions supersede) | REUSE | Complete |
| Meter readings | rem-owned | unit detail (`MeterReadingsCard`) | `rem_meter_readings` | REUSE | Complete (regression note rule) |
| Property activities / timeline | shared activity logs | entity details | `activity_logs` | REUSE | Per-entity history tabs present on property/lease details |
| Reminders/notifications (lease expiry, rent upcoming/overdue) | shared `notifications` + UI | `/notifications` | idempotent deterministic docs (`generateReminders`) | REUSE | Complete, on-demand processor (documented: no cron claimed) |

### 2.6 Dashboard & reports

| Feature | Existing module | Existing route | Existing service/collection | Strategy | Missing work |
|---|---|---|---|---|---|
| REM dashboard (properties/buildings/units/occupancy/contracts/expiring/dues/overdue/received/maintenance/expenses) | rem-owned | `/real-estate` | derived from `rem_*` via `use-real-estate*` hooks + `processDueDates` | REUSE | Verified real-data; cards link to routes. Spec item "every metric opens its filtered records": deep-link w/ filter params partially present (route links, not pre-filtered queries) — small EXTEND |
| Reports (performance, occupancy, rental income, collections, expiring contracts, maintenance costs, opex) | rem-owned | `/real-estate/reports` | derived + CSV export | REUSE | Complete |

---

## 3. Testing baseline (what exists today)

| Suite | Script | Covers |
|---|---|---|
| Marketing unit/workflow | `test:marketing` | pure rules + service transitions |
| Marketing browser E2E | `test:agency-browser` | full lifecycle incl. budget revisions, publication gate, activity denial, rules-verified writes (has uncommitted hardening changes in working tree) |
| REM unit | `test:rem-unit` | pure leasing/finance rules only |
| Firestore rules | `test:rules`, `test:rules-eval` | includes `rem_*`/`mkt_*` domain gates |
| Storage rules | `test:storage` | domain partitions incl. rem/mkt |
| Navigation/activity | `test:navigation-browser`, `test:activity-switch-browser`, `test:activity-routing` | guards, reserved namespaces |

**Missing vs spec §8:**
1. **No Real Estate browser E2E at all** (unit-only coverage of the money/lease machine) — highest testing gap.
2. Marketing E2E does not yet register/select the client **through the CRM UI** inside the journey (documented next-phase item).
3. No cross-module duplicate-entity assertions (same contact as tenant, same invoice in billing) in either suite.

---

## 4. Missing-work summary (candidates for Phases 3–8, ordered by value)

| # | Item | Activity | Strategy | Size | Risk |
|---|---|---|---|---|---|
| T1 | Real Estate integrated browser E2E (spec §8 workflow 1–19) on emulators | REM | NEW (test) | M | none (test-only) |
| M1 | Marketing browser E2E extension: CRM client registration inside journey + cross-module duplicate checks | MKT | EXTEND (test) | S | none |
| T2 | Tenant-facing maintenance-request intake inside REM + property-scoped work-order surface (reuses `fm_work_orders`) | REM | EXTEND | M | low — writes through facilities service |
| M2 | Campaign → Project/Tasks association + per-campaign task rollup in campaign workspace | MKT | EXTEND | M | low — reference ids only |
| M3 | Manual campaign performance records (`mkt_performance_records`) + report columns | MKT | NEW | M | needs rules+indexes additions (documented, minimal) |
| F1 | Rent payment → shared billing receipt-voucher mirroring (opt-in per tenant) | REM+FIN | EXTEND | L | medium — touches financial path; rules unchanged; idempotent |
| P1 | Tenant/owner statement view (derived; printable) | REM | EXTEND | S | none |
| M4 | Marketing-scoped notification feed (reuse `generateReminders` idempotent pattern) | MKT | EXTEND | S | none |
| M5 | Publishing-calendar view upgrade (month grid + client/channel/status filters + overdue) | MKT | EXTEND | M | none |
| S1 | Services & packages catalog (shared CRM entity vs billing `products` extension — design decision first) | MKT/CRM | EXTEND | L | medium — must not overlap quotations |
| B1 | Property budgets | REM | NEW | M | needs schema decision |
| N1 | Activity-sidebar cross links (CRM/billing entries visible under agency/REM nav) | both | CONFIGURE | S | must respect "no duplicated sidebars" rule |

**Deliberate non-work:** lease→`contracts` migration (destructive; documented §2.3 note),
fabricated social-platform integrations, fake analytics — all excluded per strict rules.
