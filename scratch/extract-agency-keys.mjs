// Extracts every translation key used in the agency feature (static) plus
// dynamic template prefixes, so the marketing.json locales can be authored
// with exact coverage.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve("src/features/agency");
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
})(root);

const statics = new Set();
const dynamics = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]*)`)/g)) {
    const key = m[1] || m[2] || m[3];
    if (key.includes("${")) dynamics.add(key.split("${")[0]);
    else statics.add(key);
  }
}
console.log("STATIC:");
console.log([...statics].sort().join("\n"));
console.log("\nDYNAMIC PREFIXES:");
console.log([...dynamics].sort().join("\n"));
