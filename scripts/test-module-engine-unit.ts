/**
 * D-Arrow Business — Custom Business Modules Engine unit suite
 *
 * Pure deterministic tests over the engine's domain core (no Firebase, no DOM):
 * module-key grammar, definition validation, per-type value coercion, record
 * payload contract (mass-assignment rejection), lifecycle transitions, access
 * resolution (permission atom AND role grant) and the list view (search /
 * status / archived / sort / pagination). These are the invariants that hold
 * the configurable engine safe without any network, so they gate the build.
 *
 * Run: npx tsx scripts/test-module-engine-unit.ts
 */

import {
  isValidModuleKey,
  slugifyModuleKey,
  validateDefinition,
  coerceFieldValue,
  validateRecordValues,
  splitRecordInput,
  sanitizeDefinitionInput,
  canMoveStage,
  isTerminalStage,
  canPerformModuleAction,
  moduleVisibleTo,
  queryRecords,
  formatCellValue,
  recordCollectionFor,
} from "../src/features/custom-modules/lib/module-engine";
import type {
  CustomModuleDefinition,
  ModuleFieldDefinition,
  ModuleRecord,
} from "../src/features/custom-modules/types/custom-module.types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${(err as Error).message}`);
  }
}

function assertTrue(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}
function hasReason(errors: { reason: string; fieldKey?: string }[], reason: string, fieldKey?: string) {
  return errors.some(
    (e) => e.reason === reason && (fieldKey === undefined || e.fieldKey === fieldKey),
  );
}

/* ---- helpers to build a valid definition + records ---- */

const F = (over: Partial<ModuleFieldDefinition>): ModuleFieldDefinition => ({
  key: "name",
  type: "text",
  label: { ar: "الاسم", en: "Name" },
  required: true,
  searchable: true,
  showInList: true,
  ...over,
});

function vendorsDef(): CustomModuleDefinition {
  return {
    key: "vendors",
    name: { ar: "الموردون", en: "Vendors" },
    description: { ar: "سجل الموردين", en: "Vendor register" },
    icon: "Truck",
    activity: "MARKETING_AGENCY" as CustomModuleDefinition["activity"],
    lifecycle: "active",
    fields: [
      F({ key: "vendor_name" }),
      F({ key: "category", type: "select", required: false, searchable: true, options: [
        { key: "media", label: { ar: "إعلام", en: "Media" } },
        { key: "print", label: { ar: "طباعة", en: "Print" } },
      ] }),
      F({ key: "credit_limit", type: "currency", required: false, searchable: false, min: 0 }),
      F({ key: "active_year", type: "date", required: false, searchable: false }),
      F({ key: "contact", type: "relation", required: false, searchable: false, relation: { target: "contact" } }),
    ],
    stages: [
      { key: "open", label: { ar: "مفتوح", en: "Open" }, color: "primary", next: ["approved", "rejected"] },
      { key: "approved", label: { ar: "معتمد", en: "Approved" }, color: "success", next: ["terminated"] },
      { key: "rejected", label: { ar: "مرفوض", en: "Rejected" }, color: "danger", terminal: true, next: [] },
      { key: "terminated", label: { ar: "منتهي", en: "Terminated" }, color: "default", terminal: true, next: [] },
    ],
    initialStage: "open",
    listConfig: { primaryField: "vendor_name", columns: ["vendor_name", "category"], sortField: "vendor_name", sortDir: "asc", pageSize: 5 },
    roleGrants: {
      view: ["super_admin", "admin", "manager", "employee"],
      create: ["super_admin", "admin", "manager", "employee"],
      update: ["super_admin", "admin", "manager"],
      archive: ["super_admin", "admin"],
    },
    allowPermanentDelete: false,
    permissions: {
      view: "custom_modules.view",
      create: "custom_modules.create",
      update: "custom_modules.update",
      archive: "custom_modules.archive",
    },
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

const R = (over: Partial<ModuleRecord>): ModuleRecord => ({
  id: over.id ?? "r1",
  moduleKey: "vendors",
  code: over.code,
  values: over.values ?? {},
  status: over.status ?? "open",
  archived: over.archived ?? false,
  stageHistory: over.stageHistory ?? [{ from: "", to: "open", at: "2026-01-01T00:00:00.000Z", by: "u1" }],
  revision: over.revision ?? 1,
  createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
});

/* -------------------------------------------------------------------------- */

console.log("== Custom Business Modules Engine — unit suite ==\n");

check("module key grammar", () => {
  assertTrue(isValidModuleKey("vendors"), "vendors should be valid");
  assertTrue(isValidModuleKey("a1"), "two chars valid");
  assertTrue(!isValidModuleKey("Vendors"), "uppercase-first invalid");
  assertTrue(!isValidModuleKey("a"), "single char invalid");
  assertTrue(!isValidModuleKey("1vend"), "digit-first invalid");
  assertTrue(!isValidModuleKey("rec_x"), "rec_ prefix reserved");
  assertTrue(!isValidModuleKey("foo_rec_bar"), "_rec_ substring reserved");
  assertTrue(!isValidModuleKey("a".repeat(31)), "31 chars invalid");
});

check("slugifyModuleKey derives lowercase keys", () => {
  assertEq(slugifyModuleKey("Vendor List"), "vendor_list", "space to underscore");
  assertTrue(isValidModuleKey(slugifyModuleKey("Rent Payments 2026")), "slug is a valid key");
});

check("valid definition yields zero errors", () => {
  const errs = validateDefinition(vendorsDef());
  assertEq(errs, [], `expected no errors, got ${JSON.stringify(errs)}`);
});

check("definition validation catches structural faults", () => {
  const d = vendorsDef();
  d.icon = "NotAnIcon";
  d.stages[0].next = ["ghost"];
  d.listConfig.primaryField = "nope";
  d.roleGrants.update = [];
  const errs = validateDefinition(d);
  assertTrue(hasReason(errs, "iconNotAllowed"), "icon not allowed");
  assertTrue(hasReason(errs, "unknownNextStage", "stage:open"), "unknown next stage");
  assertTrue(hasReason(errs, "unknownField", "listConfig.primaryField"), "unknown primary field");
  assertTrue(hasReason(errs, "grantsEmpty", "roleGrants.update"), "empty grant set");
});

check("coerce text honors min/max length", () => {
  const f = F({ key: "code", minLen: 3, maxLen: 5 });
  assertEq(coerceFieldValue(f, "  ab ").ok, false, "too short fails");
  const ok = coerceFieldValue(f, "abcde");
  assertTrue(ok.ok === true && ok.value === "abcde", "trimmed value kept");
  assertEq(coerceFieldValue(f, "abcdef").ok, false, "too long fails");
});

check("coerce email/phone/url reject malformed", () => {
  assertEq(coerceFieldValue(F({ key: "e", type: "email" }), "nope").ok, false, "bad email");
  assertTrue(coerceFieldValue(F({ key: "e", type: "email" }), "a@b.com").ok, "good email");
  assertEq(coerceFieldValue(F({ key: "u", type: "url" }), "notaurl").ok, false, "bad url");
});

check("coerce currency rejects negatives (min 0 default) and rounds", () => {
  const c = F({ key: "amt", type: "currency" });
  assertEq(coerceFieldValue(c, "-1").ok, false, "negative currency rejected");
  const r = coerceFieldValue(c, "1,234.567");
  assertTrue(r.ok === true && r.value === 1234.57, `rounds to 2dp, got ${JSON.stringify(r)}`);
});

check("coerce date rejects impossible calendar days", () => {
  assertEq(coerceFieldValue(F({ key: "d", type: "date" }), "2026-02-30").ok, false, "Feb 30 invalid");
  assertEq(coerceFieldValue(F({ key: "d", type: "date" }), "2026-02-29").ok, false, "2026 is not a leap year");
  assertTrue(coerceFieldValue(F({ key: "d", type: "date" }), "2028-02-29").ok, "leap day valid");
  assertTrue(coerceFieldValue(F({ key: "d", type: "date" }), "2026-02-28").ok, "Feb 28 valid");
  assertEq(coerceFieldValue(F({ key: "d", type: "date" }), "2026-13-01").ok, false, "month 13 invalid");
});

check("coerce select/multiselect validate option keys", () => {
  const sel = F({ key: "c", type: "select", options: [{ key: "media", label: { ar: "إ", en: "E" } }] });
  assertEq(coerceFieldValue(sel, "ghost").ok, false, "unknown option rejected");
  const multi = F({ key: "t", type: "multiselect", options: [
    { key: "a", label: { ar: "ا", en: "A" } },
    { key: "b", label: { ar: "ب", en: "B" } },
  ] });
  const ok = coerceFieldValue(multi, ["a", "a", "b"]);
  assertTrue(ok.ok === true && JSON.stringify(ok.value) === JSON.stringify(["a", "b"]), "dedup + order kept");
});

check("coerce relation rejects ids with path chars", () => {
  assertEq(coerceFieldValue(F({ key: "r", type: "relation", relation: { target: "contact" } }), "a/b").ok, false, "slash rejected");
  assertTrue(coerceFieldValue(F({ key: "r", type: "relation", relation: { target: "contact" } }), "contact1").ok, "clean id ok");
});

check("record value validation flags unknown and required", () => {
  const res = validateRecordValues(vendorsDef(), { vendor_name: "", bogus: "x" });
  assertTrue(!res.ok, "should fail");
  assertTrue(hasReason(res.errors, "unknownField", "bogus"), "unknown field flagged");
  assertTrue(hasReason(res.errors, "required", "vendor_name"), "required flagged");
});

check("record value validation coerces and drops nulls", () => {
  const res = validateRecordValues(vendorsDef(), { vendor_name: "Acme", category: "media", credit_limit: "500" });
  assertTrue(res.ok, `expected ok, got ${JSON.stringify(res.errors)}`);
  assertEq(res.values.credit_limit, 500, "currency coerced to number");
  assertEq("active_year" in res.values, false, "absent optional not materialized");
});

check("splitRecordInput rejects protected field mass-assignment", () => {
  let threw = "";
  try {
    splitRecordInput({ values: { a: 1 }, archived: true });
  } catch (e) {
    threw = (e as Error).message;
  }
  assertEq(threw, "protected_field:archived", "archived is engine-owned");
  const parsed = splitRecordInput({ values: { a: 1 }, status: "open" });
  assertEq(parsed.values, { a: 1 }, "values passed through");
  assertEq(parsed.status, "open", "status passed through");
});

check("sanitizeDefinitionInput strips derived keys", () => {
  const clean = sanitizeDefinitionInput({
    key: "vendors",
    name: { ar: "ا", en: "E" },
    revision: 99,
    createdBy: "hacker",
    createdAt: "now",
  } as Record<string, unknown>);
  assertEq("revision" in clean, false, "revision dropped");
  assertEq("createdBy" in clean, false, "createdBy dropped");
  assertEq("createdAt" in clean, false, "createdAt dropped");
  assertEq(clean.key, "vendors", "writable key kept");
});

check("lifecycle transitions obey terminal + next graph", () => {
  const st = vendorsDef().stages;
  assertTrue(canMoveStage(st, "open", "approved"), "legal move");
  assertTrue(!canMoveStage(st, "open", "terminated"), "illegal skip move");
  assertTrue(canMoveStage(st, "open", "open"), "self move allowed");
  assertTrue(!canMoveStage(st, "rejected", "open"), "terminal cannot move");
  assertTrue(isTerminalStage(st, "terminated"), "terminated is terminal");
});

check("access resolution requires atom AND role grant", () => {
  const def = vendorsDef();
  const allowAll = () => true;
  const denyAll = () => false;
  assertTrue(canPerformModuleAction(def, "update", "manager", allowAll), "manager update granted");
  assertTrue(!canPerformModuleAction(def, "update", "employee", allowAll), "employee not in update grant");
  assertTrue(!canPerformModuleAction(def, "view", "employee", denyAll), "missing atom denies even if role allowed");
  assertTrue(moduleVisibleTo(def, "employee", allowAll), "active+view => visible");
  const draft = { ...def, lifecycle: "draft" as const };
  assertTrue(!moduleVisibleTo(draft, "admin", allowAll), "draft not visible");
});

check("queryRecords filters archived by default, searches, sorts, paginates", () => {
  const def = vendorsDef();
  const rows = [
    R({ id: "1", code: "VEND-0001", values: { vendor_name: "Zeta", category: "media" }, status: "open" }),
    R({ id: "2", code: "VEND-0002", values: { vendor_name: "Alpha", category: "print" }, status: "approved" }),
    R({ id: "3", code: "VEND-0003", values: { vendor_name: "Masked", category: "media" }, status: "open", archived: true }),
  ];
  // default hides archived
  const all = queryRecords(def, rows, {});
  assertEq(all.total, 2, "archived hidden");
  // search by code
  const byCode = queryRecords(def, rows, { search: "0002" });
  assertEq(byCode.rows.map((r) => r.id), ["2"], "matched by code");
  // search select by label EN
  const byLabel = queryRecords(def, rows, { search: "print" });
  assertEq(byLabel.rows.map((r) => r.id), ["2"], "select searchable by label");
  // status filter
  const approved = queryRecords(def, rows, { status: "approved" });
  assertEq(approved.rows.map((r) => r.id), ["2"], "status filter");
  // include archived
  const withArch = queryRecords(def, rows, { includeArchived: true });
  assertEq(withArch.total, 3, "archived included on request");
  // sort asc by vendor_name; definition pageSize (5) governs when no override
  const asc = queryRecords(def, rows, { sortField: "vendor_name", sortDir: "asc" });
  assertEq(asc.pages, 1, "two visible rows fit the definition pageSize of 5");
  assertEq(asc.rows[0].values.vendor_name, "Alpha", "asc first is Alpha");
  assertEq(asc.rows.map((r) => r.id), ["2", "1"], "alpha before zeta");
  // explicit pageSize is clamped to the 5..100 range, never below 5
  const clamped = queryRecords(def, rows, { pageSize: 1 });
  assertEq(clamped.pages, 1, "pageSize clamped up, single page");
  const desc = queryRecords(def, rows, { sortField: "vendor_name", sortDir: "desc", pageSize: 5 });
  assertEq(desc.rows[0].values.vendor_name, "Zeta", "desc first is Zeta");
});

check("formatCellValue renders bilingual + type-aware", () => {
  const def = vendorsDef();
  const cat = def.fields.find((f) => f.key === "category")!;
  assertEq(formatCellValue(cat, "media", "en"), "Media", "select label en");
  assertEq(formatCellValue(cat, "media", "ar"), "إعلام", "select label ar");
  const amt = def.fields.find((f) => f.key === "credit_limit")!;
  assertTrue(formatCellValue(amt, 1500, "en").includes("1,500"), `currency grouped, got ${formatCellValue(amt, 1500, "en")}`);
  const name = def.fields.find((f) => f.key === "vendor_name")!;
  assertEq(formatCellValue(name, null, "en"), "—", "empty renders dash");
});

check("record collection name encodes the owning activity", () => {
  assertEq(
    recordCollectionFor("MARKETING_AGENCY" as CustomModuleDefinition["activity"], "vendors"),
    "mod_marketing_agency_rec_vendors",
    "collection grammar matches the rules regex",
  );
});

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
