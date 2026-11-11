# ADR-0007 — Additive-only `firestore.rules` strategy

- **Status:** Proposed (Phase One)

## Context
`firestore.rules` (73 KB) is the tenant-isolation backbone, mirroring the domain-prefix contract (`rem_`, `fm_`, `mkt_`, `cln_`, `sch_`, `mod_<activity>_rec_*`). New platform collections (catalog, templates, plans, audit, subscription, branches) require rule coverage. Any accidental edit to existing blocks risks production tenant leaks.

## Decision
1. New match blocks are **appended** in clearly-commented sections (`// === MERGER: ... ===`).
2. Existing blocks remain byte-identical (CI byte-compare of the pre-merger segment — doc 14 §4).
3. New blocks: platform collections writable only by platform staff; `subscription` tenant-read/platform-write; `platform_audit` append-only (update/delete denied).
4. No rules deploy without emulator suite green.

## Consequences
- Rollback of any phase = remove the appended section.
- Review burden is minimal and auditable (diff shows only additions).
- Production rules changes are scripted releases, never ad-hoc.
