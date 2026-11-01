# Marketing Agency — Deep Audit & Feature Matrix

**Activity:** `MARKETING_AGENCY` · **Route namespace:** `/agency` · **Collection prefix:** `mkt_`
**Scope:** Every dashboard card, route, form, detail page, Firebase service, permission and
workflow in the Marketing Agency activity, traced to real components, Firestore collections,
queries and services — and mapped against the target "complete Marketing Agency Management
System" capability list. Reused shared modules (CRM, Projects, Tasks, Billing, HR) are marked
as reuse, never counted as marketing-owned duplication.

**Method:** Inspected source only (no runtime mocks). Classification per spec §1:
COMPLETE / PARTIAL / UI_ONLY / BACKEND_ONLY / BROKEN / MISSING. A feature is only COMPLETE when
real UI **and** real Firebase CRUD **and** permission enforcement **and** a verified workflow exist.

---

## 0. Executive verdict

The Marketing Agency **domain module is genuinely production-grade**, not a demo dashboard:
it owns campaigns, revision-governed budgets, expenses, creative briefs (with attachments),
a deliverable review machine with a client sign-off publication gate, and a content calendar
with a scheduled-date precondition and server-stamped publish times. These are backed by real
`mkt_*` writes, a transaction-allocated campaign code, rules-enforced tenant+activity isolation,
and an automated browser E2E journey.

The capabilities on the target list that are **not** marketing-owned (clients, contacts, leads,
opportunities/pipeline, quotations, contracts, client timeline, notifications, service line
items) already exist as **shared CRM/Projects/Tasks/Billing modules** and are reachable by a
`MARKETING_AGENCY` tenant through the portal launcher (CRM is a shared portal — see §3). The
marketing system therefore **composes** those modules rather than duplicating them, which is the
required behaviour.

The real, narrow gaps are: a tenant-manageable **services/packages catalog** (only static
categories exist today), **per-campaign task/project coordination** surfaced in the marketing
workspace, **marketing-scoped notifications**, and a few in-context links. The highest-priority
of these (a blocked in-context workflow step) was fixed this session — see §6.

---

## 1. Dashboard trace — every card to its real source

`src/features/agency/pages/AgencyDashboardPage.tsx`. Every figure is derived from persisted
`mkt_*` records fetched through TanStack Query hooks in `src/features/agency/hooks/use-marketing.ts`.
No estimated/mocked analytics anywhere (verified by reading the component; each card links to a real route).

| Dashboard surface | Component source | Query hook | Firestore collection | Derivation (pure fn) | Links to |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Active campaigns | `AgencyDashboardPage` stat card | `useCampaigns` | `mkt_campaigns` | `isCampaignRunning(status)` (`lib/campaign-rules.ts`) | `/agency/campaigns` |
| Pending budget revisions | stat card | `useCampaigns` | `mkt_campaigns[].budgetRevisions` | `hasPendingRevision(revisions)` | `/agency/campaigns` |
| Overdue deliverables | stat card + "Due deliverables" table | `useDeliverables` | `mkt_deliverables` | `overdueDeliverables(list)` (`lib/deliverable-rules.ts`) | `/agency/deliverables` |
| Publishing today | stat card | `useContentItems` | `mkt_content_items` | `status==="scheduled" && scheduledDate===todayIso()` | `/agency/content` |
| Recent campaigns (name·code·spend/budget·status) | left table | `useCampaigns`, `useExpenses` | `mkt_campaigns`, `mkt_expenses` | `totalSpent(expenses, campaignId)` | `/agency/campaigns/:id` |
| Upcoming publishing schedule | bottom table | `useContentItems` | `mkt_content_items` | scheduled items sorted by `scheduledDate` | (rows are data only) |

**Verdict:** Dashboard is **COMPLETE** and honest. It is an *overview* only — by design it does
not attempt to be the whole management system; the management workflows live on the pages below.

---

## 2. Marketing-owned routes, pages, services, permissions

Routes registered in `src/features/agency/routes/lazy-pages.tsx`; nav in `src/lib/portal-nav.ts`
(`AGENCY_NAV_TREE`); guard `resolveRouteAccess` in `src/lib/activity-routes.ts` (`/agency` → `agency`
portal → owned by `MARKETING_AGENCY`). Permissions `marketing.view` / `marketing.manage` /
`marketing.delete` (`src/lib/permissions/index.ts`; admin/manager hold all three, employee view+manage).

| Route | Page | Service(s) (`api/marketing.service.ts`) | Collections | CRUD reality | Guard/permission | Status |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| `/agency` | AgencyDashboardPage | read-only hooks | mkt_campaigns/deliverables/content_items/expenses | Derived reads | activity + `marketing.view` | COMPLETE |
| `/agency/campaigns` | CampaignsListPage | CampaignService.list | mkt_campaigns | List/search/filter, create, row edit | `marketing.view`/`manage` | COMPLETE |
| `/agency/campaigns/:id` | CampaignDetailPage | Campaign/Expense/Invoice-link + budget revisions | mkt_campaigns, mkt_expenses, shared invoices | Status machine, budget propose/approve/reject, expense CRUD, invoice link/unlink, deliverable rollup | `marketing.manage` (delete gated `marketing.delete`) | COMPLETE |
| `/agency/deliverables` | DeliverablesListPage | DeliverableService | mkt_deliverables | Create/edit, review transition machine, client sign-off state + audited history, publication gate | `marketing.manage` | COMPLETE |
| `/agency/content` | ContentCalendarPage | ContentService | mkt_content_items | Create/edit, status machine draft→approved→scheduled→published, date precondition, `publishedAt` server-stamped | `marketing.manage` | COMPLETE |
| `/agency/briefs` | BriefsPage | BriefService | mkt_briefs | Create/edit briefs + attachment (tenant storage path contract), delete | `marketing.manage`/`delete` | COMPLETE |
| `/agency/reports` | AgencyReportsPage (ReportsPage.tsx) | reads campaigns/expenses/invoices/deliverables | derived | Budget-vs-actual + delivery summary, all figures traced to persisted records | `marketing.view` | COMPLETE |

Cross-reference integrity: every campaign `clientId`/`contractId` and content/deliverable
`campaignId` is validated against the tenant's own records at write time
(`assertTenantRef` / `assertCampaignExists`), so a forged id from another tenant cannot be attached.
Collections are named via `domainCollection("MARKETING_AGENCY", …)` — never hand-typed.

---

## 3. Reuse map — target capability → where it actually lives

`firestore.rules`: `domainOwnerActivity("mkt_.*") → MARKETING_AGENCY`; marketing is **not** a
sensitive domain (only `cln_`/`sch_`/their module mirrors are), so `mkt_*` is gated by
tenant membership **+** the company's authoritative `primaryActivity` (fail-closed). Shared CRM
collections (`contacts`, `contracts`, `leads`, `deals`, `quotations`) and billing `invoices` remain
shared and are reachable under every activity (`/crm` is in `SHARED_ROUTE_PREFIXES`; the CRM portal
has no `PORTAL_ACTIVITY` entry so `portalAllowedForActivity` keeps it visible for marketing tenants).

| Target capability | Provided by | Path | Marketing integration | Status |
| :-- | :-- | :-- | :-- | :-- |
| Clients & accounts | CRM `contacts` (type=customer) | `/crm/contacts` | campaign stores `clientId` → contact | COMPLETE (shared) |
| Contacts (multiple per company, info, socials, VAT/CR fields) | CRM ContactFormModal + ContactDetailPage | `/crm/contacts/:id` | referenced as campaign client | COMPLETE (shared) |
| Leads & opportunities | CRM `leads`, `deals` (kanban, stages, workflow) | `/crm/leads`, `/crm/deals` | — | COMPLETE (shared) |
| Sales pipeline | CRM `deals` kanban + stages | `/crm/deals` | — | COMPLETE (shared) |
| Quotations | CRM QuotationBuilderForm + templates + print | `/crm/quotations` | — | COMPLETE (shared) |
| Contracts | CRM ContractBuilderForm + templates + print | `/crm/contracts` | campaign stores `contractId` → contract | COMPLETE (shared) |
| Campaigns & budgets | **marketing** mkt_campaigns + budget revisions | `/agency/campaigns` | — | COMPLETE (owned) |
| Content planning & calendar | **marketing** mkt_content_items | `/agency/content` | — | COMPLETE (owned) |
| Social media publishing records | **marketing** content channel + status + `publishedAt` | `/agency/content` | — | COMPLETE (manual, honest — no fake platform integration) |
| Content review & client approvals | **marketing** mkt_deliverables client sign-off + content status | `/agency/deliverables` | — | COMPLETE (owned) |
| Creative deliverables & attachments | **marketing** mkt_deliverables + mkt_briefs attachments | `/agency/deliverables`, `/agency/briefs` | — | COMPLETE (owned) |
| Campaign performance & reporting | **marketing** ReportsPage (budget-vs-actual + delivery) | `/agency/reports` | — | COMPLETE (financial/delivery); see PARTIAL note §5 |
| Invoices & collections | Billing `invoices` | `/billing/invoices` | revenue derived by `invoice.campaignId` reference (never copied) | COMPLETE (shared) |
| Client activity timeline | CRM unified timeline / activity logs | `/crm/contacts/:id` | reachable from campaign (see §6 fix) | COMPLETE (shared) |
| Team assignments & tasks | Tasks + CRM/Projects assignment | `/tasks`, `/crm/tasks` | deliverables carry `assignee`; no per-campaign task board link | PARTIAL (§5) |
| Services & packages catalog | CRM static lead categories + quotation line items | `/crm/*` | no tenant-manageable service entity | PARTIAL (§5) |
| Notifications & overdue work | CRM notification center; dashboard overdue cards | — | no marketing-scoped notification feed | PARTIAL (§5) |

**No duplication:** the marketing module never re-implements clients/leads/quotes/contracts/invoices.
It stores references into the shared collections and derives money from billing. This matches spec §3/§4 rules.

---

## 4. Firebase & security posture (verified)

- **Firestore collections owned:** `mkt_campaigns`, `mkt_expenses`, `mkt_deliverables`, `mkt_briefs`, `mkt_content_items`. Budget revisions and status/approval history are appended sub-arrays on the campaign/deliverable doc (audited, never overwritten).
- **Real CRUD + atomicity:** campaign codes allocated via `runTransaction` against `companies/{id}/settings/marketing` `campaignSequence` (E2E-verified write accepted by rules); `publishedAt`/timestamps server-stamped; content transitions and publication gate re-checked service-side (UI is not the only validator).
- **Rules:** `mkt_*` require `belongsToCompany` **and** `companyAuthoritativeActivity === MARKETING_AGENCY` (`domainAccessAllowed`). Disabling the activity blocks reads/writes but preserves data (E2E-verified). Not weakened this session.
- **Storage:** brief attachments use company-scoped `mkt_briefs` paths (covered by the dedicated storage-rules suite).
- **Indexes:** list queries are unordered/`orderBy(createdAt)`-style over the tenant subtree; no new composite index was required for the marketing domain.

---

## 5. Confirmed gaps (PARTIAL / MISSING) with rationale

These are the honest gaps after tracing. None are BROKEN; each is scoped so closing it never
duplicates a shared module.

1. **Services & packages catalog — PARTIAL.** `crm/constants/lead-service-categories.ts` is a
   hardcoded 5-item list used for lead interest + contract-template families. There is no
   tenant-manageable *Service/Package* entity with pricing config, active/inactive state, or
   service→project relationships. Priced work is currently modelled as quotation/contract line items.
   *Decision:* a dedicated catalog is a CRM-wide entity (not marketing-owned); building it here
   would risk duplicating quotations. Deferred with rationale rather than faked. (spec §3C, rule 4.)
2. **Campaign ↔ Tasks / Projects — PARTIAL.** Deliverables have an `assignee`; there is no
   per-campaign task list or project link surfaced inside `/agency/campaigns/:id`. Coordination
   happens in the shared Tasks/Projects modules. A campaign→project association is a schema addition
   that should be deliberate. (spec §3D "Campaign tasks", §3F.)
3. **Marketing-scoped notifications — PARTIAL.** Overdue deliverables and today's publishing are
   surfaced on the dashboard, but there is no marketing notification feed (the CRM notification
   center covers CRM entities only). (spec target "Notifications and overdue work".)
4. **Campaign performance metrics — COMPLETE but intentionally bounded.** Reports derive real
   budget-vs-actual and delivery summaries from persisted data. Reach/impression/engagement
   "performance records" are **absent by design** because there is no ad-platform integration — per
   spec §3D "Never fabricate performance statistics", the correct status is honest absence, not a
   fake chart.

---

## 6. Implemented this session (safe, non-duplicative, verified)

**Fix — Campaign workspace in-context links (`MarketingAgency` → CRM).**
`src/features/agency/pages/CampaignDetailPage.tsx` previously rendered the campaign's **Client**
and **Contract** as plain non-clickable text, blocking the "open client / opportunity / contract"
step of the marketing journey from inside the activity (the invoice was already linked). They are
now real links to the existing CRM detail routes, following the exact pattern already used by
`ProjectDetailPage`/`DealDetailPage`:
- Client → `/crm/contacts/{clientId}` (reaches the CRM client timeline).
- Contract → `/crm/contracts?contractId={contractId}`.

Links render only when the referenced record resolves in the tenant; missing references keep the
prior fallback text (`removedRef` / `none`). No new data model, no duplication, no rule change.
`npx tsc -p tsconfig.app.json --noEmit` → clean.

**Test harness hardening — `scripts/test-agency-lifecycle-browser.mjs`.** Triage of the earlier
3/19 browser failures concluded **none were product defects**:
- *Step 18 (PROJECTS denial under Marketing)* was an **outdated expectation**: `/projects` is an
  intentional core/shared module (`activity-routes.ts` `CORE_ROUTE_PREFIXES`, added to fix a real
  "Projects disappeared on activity switch" regression). Corrected the assertion to require Projects
  to **stay reachable**, mirroring the same correction in `scripts/test-facilities-lifecycle-browser.mjs`. → **now PASSES.**
- *Steps 12 & 13 (publication gate / schedule gate)* were **harness render races**: the assertions
  read the `Confirm` button state while the HeroUI dialog was still animating open (`"no-button"`),
  and the sign-off/schedule modals were reopened before the list refetch repainted the row object the
  gate reads. Hardened into bounded polls that wait for the button to render + for the row to repaint.
  Strictness is unchanged (still fails if the gate is genuinely wrong); product logic verified correct
  in `lib/deliverable-rules.ts`.
  Evidence: re-run captured in `tmp/agency-browser-final.log` (see §7 for the result).

---

## 7. Evidence

- Unit: `npm run test:marketing` → 30/30 pass.
- Browser E2E: `npm run test:agency-browser` (Emulator-only) — final run recorded in
  `tmp/agency-browser-final.log`; result summarized in the session report.

## 8. Proposed next phases (ordered)

1. Extend the marketing browser E2E to **register a client through the CRM UI** and select it for the
   campaign, then assert the new campaign→client/contract links resolve — proving the full
   "register client → campaign → content → approval → publish → reports" journey end-to-end.
2. Campaign→Project association + per-campaign task rollup in the campaign workspace (reuse Tasks/Projects).
3. Marketing notification feed for overdue deliverables + upcoming publishing (reuse notification center).
4. Tenant services/packages catalog as a shared CRM entity (design review first to avoid quotation overlap).
