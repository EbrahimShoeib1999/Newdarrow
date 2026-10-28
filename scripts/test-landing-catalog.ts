/**
 * D-Arrow Business — Public Homepage Activity Catalog + Scroll Stability Suite
 *
 * Pure deterministic tests (no Firebase, no DOM render):
 *  1. The public catalog is complete and derived from the registry (single
 *     source of truth for identity, bilingual copy and real availability).
 *  2. No card exposes an internal/tenant-configuration action surface.
 *  3. The homepage smooth-scroll provider no longer hijacks native scrolling
 *     (the root cause of the reported jump/freeze) and respects reduced motion.
 * Run: npx tsx scripts/test-landing-catalog.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ACTIVITY_IDS,
  ACTIVITY_REGISTRY,
} from "../src/features/activities/types/activity.types";
import { PUBLIC_ACTIVITY_CARDS } from "../src/features/marketing/constants/landing-activities";

const here = dirname(fileURLToPath(import.meta.url));

let passedCount = 0;
let failedCount = 0;
const testResults: { name: string; passed: boolean; error?: string }[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    testResults.push({ name, passed: true });
    passedCount++;
  } catch (err: any) {
    console.error(`  \u2717 ${name}`);
    console.error(`    Error: ${err.message}`);
    testResults.push({ name, passed: false, error: err.message });
    failedCount++;
  }
}

console.log("\n=======================================================");
console.log(" D-Arrow Business — Public Catalog & Scroll Tests");
console.log("=======================================================\n");

/* -------------------------------------------------------------------------- */
/* 1. Catalog completeness & single source of truth                           */
/* -------------------------------------------------------------------------- */
console.log("1. Public activity catalog:");

await test("every supported activity is listed exactly once", () => {
  assert(
    PUBLIC_ACTIVITY_CARDS.length === ACTIVITY_IDS.length,
    `catalog has ${PUBLIC_ACTIVITY_CARDS.length} cards but registry has ${ACTIVITY_IDS.length} activities`,
  );
  const ids = PUBLIC_ACTIVITY_CARDS.map((c) => c.id);
  for (const id of ACTIVITY_IDS) {
    assert(ids.filter((x) => x === id).length === 1, `${id} must appear exactly once`);
  }
});

await test("school management & medical clinic are surfaced even though not enabled", () => {
  const ids = PUBLIC_ACTIVITY_CARDS.map((c) => c.id);
  assert(ids.includes("SCHOOL_MANAGEMENT"), "SCHOOL_MANAGEMENT hidden from public catalog");
  assert(ids.includes("MEDICAL_CLINIC"), "MEDICAL_CLINIC hidden from public catalog");
  assert(ids.includes("REAL_ESTATE_BROKERAGE"), "REAL_ESTATE_BROKERAGE hidden from public catalog");
  assert(ids.includes("REAL_ESTATE_DEVELOPMENT"), "REAL_ESTATE_DEVELOPMENT hidden from public catalog");
});

await test("bilingual copy matches the registry exactly (no drift, no placeholders)", () => {
  for (const card of PUBLIC_ACTIVITY_CARDS) {
    const meta = ACTIVITY_REGISTRY[card.id];
    assert(card.nameEn === meta.labels.en, `${card.id} EN name drifted from registry`);
    assert(card.nameAr === meta.labels.ar, `${card.id} AR name drifted from registry`);
    assert(card.descEn === meta.description.en, `${card.id} EN description drifted from registry`);
    assert(card.descAr === meta.description.ar, `${card.id} AR description drifted from registry`);
    for (const [field, val] of [
      ["nameEn", card.nameEn],
      ["nameAr", card.nameAr],
      ["descEn", card.descEn],
      ["descAr", card.descAr],
    ] as const) {
      assert(typeof val === "string" && val.trim().length > 0, `${card.id}.${field} is empty`);
    }
  }
});

await test("availability label is derived from moduleLive — never a second source of truth", () => {
  for (const card of PUBLIC_ACTIVITY_CARDS) {
    assert(
      card.live === ACTIVITY_REGISTRY[card.id].moduleLive,
      `${card.id} availability (${card.live}) contradicts registry moduleLive (${ACTIVITY_REGISTRY[card.id].moduleLive})`,
    );
  }
  // Honest "available" set: only genuinely shipped domains.
  const live = PUBLIC_ACTIVITY_CARDS.filter((c) => c.live).map((c) => c.id);
  assert(live.includes("PROJECTS"), "PROJECTS must be shown available");
  assert(live.includes("REAL_ESTATE_MANAGEMENT"), "REM must be shown available");
  assert(live.includes("FACILITIES_MANAGEMENT"), "FACILITIES must be shown available");
  assert(live.includes("MARKETING_AGENCY"), "MARKETING must be shown available");
  assert(live.includes("SCHOOL_MANAGEMENT"), "SCHOOL must be shown available");
  // Not-yet-complete domains must NOT be labelled available.
  const comingSoon = PUBLIC_ACTIVITY_CARDS.filter((c) => !c.live).map((c) => c.id);
  assert(comingSoon.includes("MEDICAL_CLINIC"), "CLINIC must be honest 'coming soon'");
});

/* -------------------------------------------------------------------------- */
/* 2. No internal / tenant-configuration action surface                       */
/* -------------------------------------------------------------------------- */
console.log("\n2. Public-vs-internal separation:");

await test("cards carry only presentation fields — no route, path or activation hook", () => {
  const allowed = new Set(["id", "icon", "nameEn", "nameAr", "descEn", "descAr", "live"]);
  for (const card of PUBLIC_ACTIVITY_CARDS) {
    for (const key of Object.keys(card)) {
      assert(allowed.has(key), `${card.id} exposes unexpected field '${key}' (possible internal action)`);
    }
  }
});

await test("no catalog entry references a settings/admin route or any internal routeBase", () => {
  const routeBases = ACTIVITY_IDS.map((id) => ACTIVITY_REGISTRY[id].routeBase);
  for (const card of PUBLIC_ACTIVITY_CARDS) {
    const blob = JSON.stringify(card);
    assert(!blob.includes("/settings"), `${card.id} leaks a settings route onto the public page`);
    for (const base of routeBases) {
      assert(!blob.includes(`"${base}`), `${card.id} links to internal route ${base}`);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Scroll-hijack removal regression guard                                  */
/* -------------------------------------------------------------------------- */
console.log("\n3. Homepage scroll stability:");

const providerSrc = readFileSync(resolve(here, "../src/components/providers/smooth-scroll-provider.tsx"), "utf8");

await test("smooth-scroll provider no longer hijacks native scrolling", () => {
  // These constructs formed the competing-scroll-owner machinery that caused
  // the page to jump/freeze. Their reintroduction must fail the suite.
  const banned: [string, string][] = [
    ['position = "fixed"', "fixed-position content takeover"],
    ["translate3d", "transform-based fake scroll"],
    ["requestAnimationFrame", "rAF lerp scroll loop"],
    ["document.body.style.height", "manual body-height scroll proxy"],
    ["setInterval", "periodic scroll-owner re-enable loop"],
  ];
  for (const [token, why] of banned) {
    assert(!providerSrc.includes(token), `provider still uses ${why} ('${token}')`);
  }
});

await test("smooth-scroll provider honours prefers-reduced-motion", () => {
  assert(providerSrc.includes("prefers-reduced-motion"), "provider dropped reduced-motion handling");
});

/* -------------------------------------------------------------------------- */

console.log("\n=======================================================");
console.log(` Results: ${passedCount} passed, ${failedCount} failed`);
console.log("=======================================================\n");
if (failedCount > 0) {
  for (const r of testResults.filter((t) => !t.passed)) {
    console.error(`FAILED: ${r.name}\n  ${r.error}`);
  }
  process.exit(1);
}
