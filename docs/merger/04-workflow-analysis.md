# 04 — Workflow Analysis (with Mermaid)

> Workflows reconstructed from source. A-flows are real production paths; B-flows reflect its real (platform) vs demo (tenant) split.

---

## A. Project A (D-Arrow) — Core Workflows

### A1. Authentication & tenant resolution

```mermaid
flowchart TD
    U[User] --> FB[Firebase Auth sign-in]
    FB --> CTX[Load user + company profile]
    CTX --> ACT{Company activities}
    ACT -->|default| P[PROJECTS domain /projects]
    ACT --> REM[rem_ collections /real-estate]
    ACT --> FM[fm_ collections /facilities]
    ACT --> MKT[mkt_ collections /agency]
    ACT --> SCH[sch_ collections /school]
    ACT --> CLN[cln_ placeholder /clinic]
    CTX --> PERM[effective-permissions.ts<br/>role matrix → permission set]
    PERM --> GUARD[Route + UI permission guards]
```

### A2. Invitation & onboarding (in-progress work — preserve)

```mermaid
sequenceDiagram
    participant Admin as Admin/Manager
    participant Invite as invites.service
    participant Rules as firestore.rules
    participant NewUser as Invitee
    Admin->>Invite: create invite (role, company)
    Invite->>Rules: create allowed (role-assignment.ts policy)
    Invite->>NewUser: email link
    NewUser->>Rules: accept invite (rules-validated)
    Rules->>NewUser: membership doc created (role bound)
    NewUser->>Invite: onboarding completes via invitation-onboarding.ts
```

### A3. CRM revenue funnel (real, production)

```mermaid
flowchart LR
    L[Lead<br/>lead-workflow.ts<br/>kanban stages] -->|lead-conversion.service| C[Contact + classification]
    L -->|LeadToTaskModal| T[CRM Task]
    C --> D[Deal<br/>deal-workflow.ts<br/>pipeline]
    D --> Q[Quotation<br/>builder + calculations<br/>PDF + letterhead]
    Q --> CT[Contract<br/>builder + print<br/>contract-invoice-prefill]
    CT -->|prefill| IN[Invoice in Billing]
    C --> RPT[Client Report<br/>public link page]
```

### A4. Billing: document → ledger (double-entry, real)

```mermaid
flowchart TD
    IN[Invoice] --> JE1[journal entry<br/>AR debit / revenue + tax credit<br/>accounting-engine.ts]
    PY[Payment] --> JE2[journal entry<br/>cash debit / AR credit]
    CN[Credit note] --> JE3[reversal entry]
    JE1 & JE2 & JE3 --> GL[(Journals)]
    GL --> RPTS[Reports: trial balance, aged AR/AP,<br/>statement of account, VAT return, Zakat]
    IN --> ZQ[ZATCA QR on invoice print]
    subgraph Ops
        BR[Bank reconciliation] --> GL
        FC[Fiscal closing] --> GL
        FA[Fixed assets] --> GL
        CC[Cost centers] --> JE1
    end
```

### A5. People/HR cycle (real)

```mermaid
flowchart LR
    H[HireEmployeeModal<br/>people.service] --> E[Employee profile]
    E --> AT[Attendance<br/>geo check-in, lateness policy,<br/>timer, notifications]
    AT --> TS[Timesheets]
    AT --> LD[Lateness report / deduction cases]
    E --> LV[Leave tracker + balances]
    E --> DR[Daily reports]
    E --> PR[Performance]
    TS & LV & DR --> AP[Approvals page]
```

### A6. Custom module record lifecycle (engine, real)

```mermaid
sequenceDiagram
    participant UI as Module UI
    participant Eng as module-engine.ts
    participant Svc as custom-modules.service.ts
    participant FS as Firestore
    UI->>Eng: validate field schema
    Eng-->>UI: typed record DTO
    UI->>Svc: save (revision N)
    Svc->>FS: transaction: read mod_<activity>_rec_<key>
    alt revision mismatch
        FS-->>Svc: conflict → optimistic-revision error
    else ok
        Svc->>FS: write record + bump revision
    end
    Svc-->>UI: saved record
```

---

## B. Project B — Workflows

### B1. Platform tenant provisioning (REAL, transactional)

```mermaid
sequenceDiagram
    participant PA as Platform Admin
    participant API as /api/v1/platform/tenants
    participant DB as Prisma (SQLite)
    PA->>API: POST tenant (activity, template, owner)
    API->>DB: tx: Organization + owner User +<br/>OrganizationMember(TENANT_OWNER) +<br/>OrganizationModules from BusinessTemplate +<br/>Roles/Permissions from Activity defaults +<br/>Subscription + Settings
    DB-->>API: committed tenant graph
    API-->>PA: tenant created
```

### B2. Tenant onboarding wizard (REAL UX, demo-grade backend)

```mermaid
flowchart TD
    O[Owner] --> S1[Step 1: pick activity<br/>platform/activities preview]
    S1 --> S2[Step 2: confirm module set<br/>module-guard dependency check]
    S2 --> S3[Step 3: owner account + org details]
    S3 --> S4[Provision via platform API]
    S4 --> D[Tenant dashboard<br/>config-driven widgets + terminology]
```

### B3. Module enablement with dependencies (REAL logic)

```mermaid
flowchart LR
    R[Enable module request] --> G{module-guard:<br/>dependencies enabled?}
    G -- no --> X[Reject: enable deps first]
    G -- yes --> OM[OrganizationModule row<br/>tenant/modules API]
    OM --> NAV[navigation rebuild<br/>tenant/navigation API]
```

### B4. Tenant module usage (DEMO)

```mermaid
flowchart LR
    U[Tenant user] --> PG[tenant-module-page]
    PG --> RV[module-view-renderer]
    RV --> M[DEMO_LIST_DATA /<br/>generateMockData]
    M --> UI[Generic list/table UI]
    style M fill:#fdd,stroke:#900
```

---

## C. Target (post-merger) Workflows — preview of doc 08

### C1. Unified tenant provisioning (A runtime + B flow design)

```mermaid
sequenceDiagram
    participant PA as Platform Admin (A console)
    participant Wiz as Onboarding wizard (B-inspired)
    participant FS as Firestore (emulator-tested)
    PA->>Wiz: select activity template (data-driven catalog)
    Wiz->>Wiz: dependency-checked module set (B module-guard logic, ported)
    Wiz->>FS: batch: company + owner invite +<br/>module_definitions from template +<br/>subscription plan + branches
    Wiz-->>PA: tenant ready (A rules enforce isolation)
```

### C2. New vertical (e.g., restaurant) delivery

```mermaid
flowchart LR
    T[Activity template:<br/>restaurant module set] --> A2[New ACTIVITY in A registry<br/>code change, one place]
    A2 --> CM[Module definitions provisioned<br/>into companies/id/module_definitions]
    CM --> RUN[A custom-module engine runtime<br/>mod_REST_rec_* records]
    RUN --> BL[A billing integration<br/>POS invoice → journal]
    style RUN fill:#dfd,stroke:#060
```

> Detailed design in docs 08, 09, 11.
