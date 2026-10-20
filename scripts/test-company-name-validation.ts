/**
 * Workstream B regression test — flexible company / organization name validation.
 *
 * Proves that the customer (organization) name and the company-profile name
 * accept normal business names — mixed case, Arabic, spaces and real-world
 * punctuation — without any unjustified regex, and that no destructive case
 * normalization happens on the way to persistence. It also confirms the safe
 * boundaries remain: required (non-empty after trim) and control-character
 * handling. Runs without Firebase/emulators (pure schema logic).
 *
 *   npx tsx scripts/test-company-name-validation.ts
 */
import { contactFormSchema, toCreateContactDTO } from "../src/features/crm/schemas/contact.schema";
import { companyProfileSchema } from "../src/features/companies/schemas/company.schema";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`\u2713 PASS: ${name}`);
  } else {
    console.log(`\u2717 FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

const ORG_BASE = {
  entityType: "company" as const,
  // A minimally valid organization contact; only the name is under test.
  phone: "+966500000000",
};

/** Company-style names that MUST be accepted verbatim (case + punctuation). */
const ACCEPTED = [
  "Acme Solutions",
  "ACME SOLUTIONS",
  "acme solutions",
  "aCmE Solutions",
  "Smith & Sons, Ltd.",
  "O'Brien Technologies",
  "North-Star (Egypt)",
  "\u0634\u0631\u0643\u0629 \u062f\u064a \u0623\u0631\u0648 \u0644\u062a\u0642\u0646\u064a\u0629 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a", // شركة دي أرو لتقنية المعلومات
  "Al Noor Trading Co.", // normal internal spaces
  "A".repeat(150), // a long-but-reasonable name
];

for (const name of ACCEPTED) {
  const res = contactFormSchema.safeParse({ ...ORG_BASE, accountName: name });
  ok(`organization accepts "${name.slice(0, 40)}"`, res.success,
    res.success ? "" : JSON.stringify((res as any).error.issues?.[0]?.message));

  // Persisted DTO must preserve the intended display name (no case transform).
  if (res.success) {
    const dto = toCreateContactDTO(res.data as any);
    ok(`  → preserved verbatim "${name.slice(0, 24)}"`, dto.accountName === name,
      `got "${dto.accountName}"`);
    ok(`  → fullName mirrors display name`, dto.fullName === name);
  }
}

/** Safe boundaries that MUST still hold. */
const rejected = [
  ["empty string", ""],
  ["whitespace-only", "   "],
];
for (const [label, name] of rejected) {
  const res = contactFormSchema.safeParse({ ...ORG_BASE, accountName: name });
  ok(`rejects ${label}`, !res.success);
}

/** Control characters (newline / NUL) inside a name are rejected as corrupting. */
ok("rejects embedded newline", !contactFormSchema.safeParse({ ...ORG_BASE, accountName: "Acme\nCorp" }).success);
ok("rejects NUL control char", !contactFormSchema.safeParse({ ...ORG_BASE, accountName: "Acme\u0000Corp" }).success);

/**
 * Company-profile (tenant settings) name behaves the same: permissive on case /
 * punctuation / Arabic, but still a required field.
 */
const CP_BASE = {
  commercialRegister: "1010123456",
  defaultCurrency: "SAR",
};
for (const name of ACCEPTED.filter((n) => n.length <= 150)) {
  const res = companyProfileSchema.safeParse({ ...CP_BASE, name });
  ok(`company profile accepts "${name.slice(0, 30)}"`, res.success,
    res.success ? "" : JSON.stringify((res as any).error.issues?.[0]?.message));
}
ok("company profile rejects empty name", !companyProfileSchema.safeParse({ ...CP_BASE, name: "" }).success);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`} — company-name validation`);
process.exit(failures === 0 ? 0 : 1);
