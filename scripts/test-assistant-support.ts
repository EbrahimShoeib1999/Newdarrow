/**
 * D-Arrow Business — Assistant & Support Unit Suite (Phase 8)
 *
 * Pure unit tests (no Firebase, no network): WhatsApp support-link builders,
 * the trusted-backend gating of the AI provider, the help knowledge base, and
 * a source-level security assertion that assistant code never references a
 * client-side AI provider key (VITE_GEMINI_API_KEY must never be bundled).
 * Run: npx tsx scripts/test-assistant-support.ts
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  normalizeSupportPhone,
  safePageReference,
  buildSupportMessage,
  buildSupportWhatsAppUrl,
} from "../src/features/assistant/utils/support-whatsapp";
import {
  assistantStatus,
  isLiveAssistantEnabled,
  askAssistant,
} from "../src/features/assistant/lib/ai-provider";
import { HELP_ARTICLES, searchHelp } from "../src/features/assistant/data/help-knowledge";

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — Assistant & Support Unit Tests");
console.log("=======================================================\n");

/* -------------------------------------------------------------------------- */
/* 1. Support phone normalization                                             */
/* -------------------------------------------------------------------------- */
console.log("1. WhatsApp support phone normalization:");

await test("valid international numbers normalize to digits only", () => {
  assert(normalizeSupportPhone("+966 50 123 4567") === "966501234567", "plus/space format");
  assert(normalizeSupportPhone("00966501234567") === "966501234567", "00-prefixed format");
  assert(normalizeSupportPhone("+966-50-123-4567") === "966501234567", "dashed format");
});

await test("invalid or missing numbers are rejected (never invented)", () => {
  assert(normalizeSupportPhone(undefined) === null, "undefined -> null");
  assert(normalizeSupportPhone("") === null, "empty -> null");
  assert(normalizeSupportPhone("+12 345") === null, "too short -> null");
  assert(normalizeSupportPhone("1234567890123456") === null, "too long -> null");
  assert(normalizeSupportPhone("not-a-phone") === null, "garbage -> null");
});

/* -------------------------------------------------------------------------- */
/* 2. Safe page reference                                                     */
/* -------------------------------------------------------------------------- */
console.log("2. Safe page reference (privacy guard):");

await test("query and hash values are dropped, path kept", () => {
  assert(safePageReference("/projects/abc123?tab=units#x") === "/projects/abc123", "drops query+hash");
  assert(safePageReference("/billing/invoices") === "/billing/invoices", "plain path kept");
});

await test("root and empty paths yield no reference", () => {
  assert(safePageReference("/") === undefined, "root -> undefined");
  assert(safePageReference(undefined) === undefined, "undefined -> undefined");
  assert(safePageReference("   ") === undefined, "blank -> undefined");
});

await test("oversized paths are truncated, never passed through raw", () => {
  const long = "/" + "a".repeat(200);
  const ref = safePageReference(long)!;
  assert(ref.length <= 81, `truncated (${ref.length} chars)`);
});

/* -------------------------------------------------------------------------- */
/* 3. Message + URL builders                                                  */
/* -------------------------------------------------------------------------- */
console.log("3. Support message and wa.me URL builders:");

await test("messages are localized and carry the safe page ref", () => {
  const en = buildSupportMessage("en", { pageRef: "/projects/p1" });
  const ar = buildSupportMessage("ar", { pageRef: "/projects/p1" });
  assert(en !== ar, "languages differ");
  assert(en.includes("/projects/p1"), "EN includes page ref");
  assert(ar.includes("/projects/p1"), "AR includes page ref");
});

await test("ticket id is included when provided", () => {
  const msg = buildSupportMessage("en", { pageRef: "/crm", ticketId: "T-42" });
  assert(msg.includes("T-42"), "includes ticket id");
});

await test("wa.me URL built only from a configured number", () => {
  const url = buildSupportWhatsAppUrl("+966501234567", "مرحبا test &more")!;
  assert(url.startsWith("https://wa.me/966501234567?text="), "digits-only number");
  assert(url.includes(encodeURIComponent("مرحبا")), "message is URL-encoded");
  assert(!url.includes("&more"), "raw ampersand escaped into encoding");
  assert(buildSupportWhatsAppUrl("", "hi") === null, "no phone -> null (link hidden)");
  assert(buildSupportWhatsAppUrl("123", "hi") === null, "invalid phone -> null");
});

/* -------------------------------------------------------------------------- */
/* 4. AI provider — trusted-backend gating (security)                          */
/* -------------------------------------------------------------------------- */
console.log("4. AI provider gating and never-leaking rule:");

await test("assistant is blocked without a trusted backend endpoint", async () => {
  // In this test env VITE_ASSISTANT_ENDPOINT is unset (and .env has none), so
  // live AI MUST report blocked — an honest state, never a fake success.
  assert(assistantStatus() === "blocked", "status blocked when unconfigured");
  assert(isLiveAssistantEnabled() === false, "not enabled");
  const res = await askAssistant("hello", { lang: "en" });
  assert(res.ok === false && res.reason === "blocked", "askAssistant -> ok:false reason:blocked");
  assert(res.status === "blocked", "result carries blocked status");
});

await test("assistant module never references the client-side provider key", () => {
  // Rule: VITE_* values are public (bundled). Assistant code must NEVER read
  // the client-side Gemini key — inference only flows through the gated endpoint.
  // Scan the whole feature directory so no future file can regress this.
  // Resolved from the repo root (scripts are always run from there via npm).
  const dir = join(process.cwd(), "src", "features", "assistant");
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));
  assert(files.length >= 5, `expected assistant sources, found ${files.length}`);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert(!src.includes("VITE_GEMINI_API_KEY"), `${f} must not read the client-side Gemini key`);
  }
});

/* -------------------------------------------------------------------------- */
/* 5. Help knowledge base                                                     */
/* -------------------------------------------------------------------------- */
console.log("5. Help knowledge base (safe fallback):");

await test("every article is fully bilingual", () => {
  for (const a of HELP_ARTICLES) {
    assert(a.title.en.trim().length > 0 && a.title.ar.trim().length > 0, `${a.id} bilingual title`);
    assert(a.body.en.trim().length > 0 && a.body.ar.trim().length > 0, `${a.id} bilingual body`);
  }
});

await test("search matches in both languages and falls back safely", () => {
  assert(searchHelp("invoice").some((a) => a.id === "sales-lifecycle"), "EN keyword match");
  assert(searchHelp("عقد").some((a) => a.id === "sales-lifecycle"), "AR keyword match");
  assert(searchHelp("واتساب").some((a) => a.id === "support"), "support article found");
  const empty = searchHelp("");
  assert(empty.length > 0 && empty.length <= 5, "empty query -> default list");
  const nonsense = searchHelp("zzzqqqxyz");
  assert(nonsense.length > 0, "nonsense query still returns guidance, never a dead end");
});

await test("article links are safe bare routes", () => {
  for (const a of HELP_ARTICLES) {
    if (a.link) {
      assert(/^\/[a-z0-9\-/]*$/i.test(a.link), `${a.id} link is a clean path: ${a.link}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */
console.log("\n=======================================================");
console.log(` Assistant & Support Summary: ${passedCount}/${testResults.length} passed, ${failedCount} failed`);
console.log("=======================================================\n");
if (failedCount > 0) process.exit(1);
process.exit(0);
