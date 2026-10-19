/**
 * DIAGNOSTIC ONLY (not part of the acceptance suite).
 * Isolates whether Firestore `runTransaction` (get-nonexistent-then-set-merge)
 * works against the local emulator, and whether security rules affect it.
 * Mirrors BillingService.reserveInvoiceNumber's transaction shape.
 */
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  runTransaction,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

const PROJECT = "diag-tx";
const COMPANY = "company-alpha";

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

// Seed tenancy + a user doc (as the real harness does).
const uid = "diag-admin-uid";
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", uid), { email: "d@d.com", companyId: COMPANY, role: "admin" });
  await setDoc(doc(db, "companies", COMPANY), { id: COMPANY, name: "Alpha" });
});

const authed = env.authenticatedContext(uid).firestore();

async function attempt(label, db) {
  try {
    const result = await runTransaction(db, async (tx) => {
      const ref = doc(db, "companies", COMPANY, "settings", "billing");
      const snap = await tx.get(ref);
      const seq = snap.exists() ? snap.data().invoiceSequence ?? { prefix: "INV-", nextNumber: 1, padding: 4 } : { prefix: "INV-", nextNumber: 1, padding: 4 };
      const number = `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
      tx.set(ref, { invoiceSequence: { ...seq, nextNumber: seq.nextNumber + 1 }, updatedAt: serverTimestamp() }, { merge: true });
      return number;
    });
    console.log(`OK [${label}] reserved=${result}`);
  } catch (e) {
    console.log(`THROW [${label}] name=${e?.name} code=${e?.code} msg=${e?.message}`);
  }
}

async function attemptNoRules(label) {
  await env.withSecurityRulesDisabled(async (c) => {
    await attempt(label, c.firestore());
  });
}

await attempt("authed+rules", authed);
await attemptNoRules("admin(no rules)");

// Also test a second run (document now exists) to check re-run behavior.
await attempt("authed+rules-2nd", authed);

await env.cleanup();
process.exit(0);
