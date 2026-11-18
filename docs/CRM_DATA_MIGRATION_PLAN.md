# D-ARROW — CRM FIRESTORE TO POSTGRESQL DATA MIGRATION PLAN

## 1. Objectives & Scope

This document specifies the operational data migration procedure to transfer any historical CRM records currently residing in Google Cloud Firestore into PostgreSQL.

### Scope Collections:
1. `companies/{companyId}/contracts` -> `CrmContract`
2. `companies/{companyId}/quotations` -> `CrmQuotation`
3. `companies/{companyId}/crm_tasks` -> `CrmTask`
4. `companies/{companyId}/crm_notes` -> `CrmNote`
5. `companies/{companyId}/crm_attachments` -> `CrmAttachment`
6. `companies/{companyId}/client_reports` -> `CrmClientReport`
7. `companies/{companyId}/contact_classifications` -> `CrmContactClassification`

---

## 2. Field-by-Field Schema Mapping

### 2.1 Contracts (`CrmContract`)
| Firestore Document Field | PostgreSQL Column | Type / Constraint | Transformation / Default |
|---|---|---|---|
| Document ID | `id` | `TEXT PRIMARY KEY` | Preserved if cuid/uuid, else mapped via ID lookup table |
| Path `companyId` | `companyId` | `TEXT FK(Company)` | Extracted from parent company path |
| `title` / `form.title` | `title` | `TEXT` | `data.title || data.form?.title || 'عقد جديد'` |
| `status` | `status` | `TEXT` | `data.status || 'draft'` |
| Whole document draft | `form` | `JSONB` | Full document JSON stored verbatim |
| `contactId` / `form.contactId` | `contactId` | `TEXT FK(Customer)?` | Null if contact does not exist in PostgreSQL |
| `dealId` / `form.dealId` | `dealId` | `TEXT FK(Deal)?` | Null if deal does not exist in PostgreSQL |
| `createdBy` | `createdBy` | `TEXT?` | Stored as user ID |
| `approvalStatus` | `approvalStatus` | `TEXT` | Default: `'pending'` |
| `approvedAt` | `approvedAt` | `TIMESTAMP?` | Parsed from Firestore Timestamp to ISO/Date |
| `approvedBy` | `approvedBy` | `TEXT?` | Stored as user ID |
| `convertedToTasks` | `convertedToTasks` | `BOOLEAN` | `Boolean(data.convertedToTasks)` |
| `createdTaskIds` | `createdTaskIds` | `JSONB?` | Array of task IDs |
| `createdAt` | `createdAt` | `TIMESTAMP` | Timestamp to Date, fallback `now()` |
| `updatedAt` | `updatedAt` | `TIMESTAMP` | Timestamp to Date, fallback `now()` |

### 2.2 Quotations (`CrmQuotation`)
| Firestore Document Field | PostgreSQL Column | Type / Constraint | Transformation / Default |
|---|---|---|---|
| Document ID | `id` | `TEXT PRIMARY KEY` | Preserved |
| Path `companyId` | `companyId` | `TEXT FK(Company)` | Parent company ID |
| `title` / `quoteNumber` | `title` | `TEXT` | `data.title || data.quoteNumber || 'عرض سعر جديد'` |
| `status` | `status` | `TEXT` | Default: `'draft'` |
| `subtotal` / `total` | `subtotal` / `total` | `FLOAT` | Default: `0` |
| `currency` | `currency` | `TEXT` | Default: `'SAR'` |
| Whole draft | `form` | `JSONB` | Full quotation draft JSON |
| `contactId` | `contactId` | `TEXT FK(Customer)?` | Validated foreign key |
| `dealId` | `dealId` | `TEXT FK(Deal)?` | Validated foreign key |
| `approvalStatus` | `approvalStatus` | `TEXT` | Default: `'pending'` |
| `createdAt` / `updatedAt` | `createdAt` / `updatedAt` | `TIMESTAMP` | Converted from Timestamp |

### 2.3 Tasks (`CrmTask`)
| Firestore Document Field | PostgreSQL Column | Type / Constraint | Transformation / Default |
|---|---|---|---|
| Document ID | `id` | `TEXT PRIMARY KEY` | Preserved |
| Path `companyId` | `companyId` | `TEXT FK(Company)` | Parent company ID |
| `title` | `title` | `TEXT` | Trimmed string |
| `description` | `description` | `TEXT?` | Trimmed string |
| `taskType` | `taskType` | `TEXT` | Default: `'follow_up'` |
| `status` | `status` | `TEXT` | Default: `'pending'` |
| `priority` | `priority` | `TEXT` | Default: `'medium'` |
| `dueDate` | `dueDate` | `TIMESTAMP?` | Parsed ISO date |
| `entityType` | `entityType` | `TEXT` | `'lead' | 'contact' | 'deal'` |
| `entityId` | `entityId` | `TEXT` | ID of associated entity |
| `assigneeId` | `assigneeId` | `TEXT?` | User ID |
| `ownerId` | `ownerId` | `TEXT?` | User ID |
| `tags` | `tags` | `JSONB?` | Array of strings |

### 2.4 Notes (`CrmNote`) & Attachments (`CrmAttachment`)
- Directly mapped with `entityType`, `entityId`, `authorId`/`uploadedBy`, `companyId`.
- Attachments include `fileUrl`, `mimeType`, `sizeBytes`, `storageKey`.

### 2.5 Client Reports (`CrmClientReport`)
- Stored with `contactId`, `contactName`, `authorId`, `authorName`, `reportType`, `clientMood`, `satisfactionRating`, `status`.
- Key outcomes and action items preserved as `JSONB`.

### 2.6 Contact Classifications (`CrmContactClassification`)
- Key normalized: `toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_')`.
- Enforces unique constraint `[companyId, key]`.

---

## 3. Migration Script Architecture

```typescript
// scripts/migrate-crm-firestore-to-pg.ts
//
// 1. Initialize Firebase Admin SDK (read-only credentials)
// 2. Initialize PrismaClient (PostgreSQL dev/prod connection)
// 3. For each tenant company in PostgreSQL:
//    a. Fetch Firestore collections concurrently in batches of 100
//    b. Transform documents using field mappers
//    c. Validate foreign-key existence (e.g. contactId exists in Customer table)
//    d. Upsert into PostgreSQL using prisma.$transaction
// 4. Verification Checksum:
//    Compare COUNT(*) per company in Firestore vs PostgreSQL
```

---

## 4. Rollback and Safety Protocol

1. **Read-Only Firestore**: The migration script only reads from Firestore (`getDocs`). It never executes `deleteDoc` or `updateDoc`.
2. **Idempotency**: All records are upserted using their original document IDs or unique composite keys. Running the script multiple times produces identical state without duplicate records.
3. **Transaction Batching**: Database writes occur in per-company transactions. If an invalid reference or constraint failure occurs, only that company's batch is rolled back and logged.
