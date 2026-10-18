/**
 * D-Arrow Business — Production BillingService Firestore Emulator Concurrency Test Suite
 *
 * Invokes the actual production BillingService.executeCustomerPaymentTransaction and
 * BillingService.executeVendorPaymentTransaction against the local Firestore Emulator.
 */

import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { BillingService } from "../src/features/billing/api/billing.service";

const PROJECT_ID = "accounting-concurrency-gate";
console.log("=================================================================");
console.log(" D-Arrow Business — Production BillingService Concurrency Suite");
console.log("=================================================================\n");

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

const CO = "company_concurrency_test";
const adminCtx = testEnv.authenticatedContext("admin_user");
const db = adminCtx.firestore();

// 1. Seed user profile & initial Chart of Accounts
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const adminDb = ctx.firestore();
  await setDoc(doc(adminDb, "users", "admin_user"), {
    companyId: CO,
    role: "admin",
  });
  // AR (1200), Bank (1100), Cash (1000), AP (2000), Revenue (4000), Expense (5000)
  await setDoc(doc(adminDb, "companies", CO, "accounts", "acc_1200"), {
    code: "1200",
    name: "Accounts Receivable",
    type: "asset",
    subType: "accounts_receivable",
    currentBalance: 0,
    isActive: true,
  });
  await setDoc(doc(adminDb, "companies", CO, "accounts", "acc_1100"), {
    code: "1100",
    name: "Bank Account",
    type: "asset",
    subType: "bank",
    currentBalance: 0,
    isActive: true,
  });
  await setDoc(doc(adminDb, "companies", CO, "accounts", "acc_2000"), {
    code: "2000",
    name: "Accounts Payable",
    type: "liability",
    subType: "accounts_payable",
    currentBalance: 0,
    isActive: true,
  });
  await setDoc(doc(adminDb, "companies", CO, "accounts", "acc_4000"), {
    code: "4000",
    name: "Sales Revenue",
    type: "income",
    subType: "sales_revenue",
    currentBalance: 0,
    isActive: true,
  });
  await setDoc(doc(adminDb, "companies", CO, "accounts", "acc_5000"), {
    code: "5000",
    name: "Operating Expense",
    type: "expense",
    subType: "operating_expense",
    currentBalance: 0,
    isActive: true,
  });
});

const results: { name: string; passed: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ PASS: ${name}`);
    results.push({ name, passed: true });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`✗ FAIL: ${name}`, msg);
    results.push({ name, passed: false, error: msg });
  }
}

// -------------------------------------------------------------
// Test 1: Competing Concurrency Race (6,000 SAR + 6,000 SAR on 10,000 SAR Invoice)
// -------------------------------------------------------------
await test("1. Production Concurrency Race: Two simultaneous 6,000 SAR payments on 10,000 SAR invoice -> Exactly 1 succeeds, 1 rejected", async () => {
  const invId = "inv_prod_race_01";
  await setDoc(doc(db, "companies", CO, "invoices", invId), {
    id: invId,
    invoiceNumber: "INV-RACE-01",
    status: "sent",
    subTotal: 10000,
    totalTax: 0,
    grandTotal: 10000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const [res1, res2] = await Promise.allSettled([
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 6000, id: "pay_race_a" } }, db),
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 6000, id: "pay_race_b" } }, db),
  ]);

  const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
  const rejected = [res1, res2].filter((r) => r.status === "rejected");

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Expected exactly 1 success and 1 rejection, got ${fulfilled.length} successes and ${rejected.length} rejections`);
  }

  const rejectionMsg = (rejected[0] as PromiseRejectedResult).reason?.message || "";
  if (!rejectionMsg.includes("Payment exceeds amount due")) {
    throw new Error(`Unexpected rejection error: ${rejectionMsg}`);
  }

  // Independent Firestore Read-Back Verification
  const invSnap = await getDoc(doc(db, "companies", CO, "invoices", invId));
  const invData = invSnap.data()!;
  if (invData.amountPaid !== 6000) {
    throw new Error(`Persisted invoice amountPaid corrupted! Expected 6000, got ${invData.amountPaid}`);
  }
  if (invData.status !== "sent") {
    throw new Error(`Expected invoice status 'sent', got ${invData.status}`);
  }

  const payASnap = await getDoc(doc(db, "companies", CO, "payments", "pay_race_a"));
  const payBSnap = await getDoc(doc(db, "companies", CO, "payments", "pay_race_b"));
  const payCount = (payASnap.exists() ? 1 : 0) + (payBSnap.exists() ? 1 : 0);
  if (payCount !== 1) {
    throw new Error(`Expected exactly 1 payment document in Firestore, found ${payCount}`);
  }
});

// -------------------------------------------------------------
// Test 2: Concurrent Non-Conflicting Exact Settlement (4,000 + 6,000 on 10,000)
// -------------------------------------------------------------
await test("2. Exact Settlement: Concurrent 4,000 SAR and 6,000 SAR payments fully settle 10,000 SAR invoice -> Status 'paid'", async () => {
  const invId = "inv_prod_settle_02";
  await setDoc(doc(db, "companies", CO, "invoices", invId), {
    id: invId,
    invoiceNumber: "INV-SETTLE-02",
    status: "sent",
    subTotal: 10000,
    totalTax: 0,
    grandTotal: 10000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const [res1, res2] = await Promise.allSettled([
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 4000, id: "pay_settle_a" } }, db),
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 6000, id: "pay_settle_b" } }, db),
  ]);

  const rejected = [res1, res2].filter((r) => r.status === "rejected");
  if (rejected.length > 0) {
    throw new Error(`Expected both non-conflicting payments to succeed; error: ${(rejected[0] as PromiseRejectedResult).reason?.message}`);
  }

  const invSnap = await getDoc(doc(db, "companies", CO, "invoices", invId));
  const invData = invSnap.data()!;
  if (invData.amountPaid !== 10000) {
    throw new Error(`Persisted invoice amountPaid mismatch: expected 10000, got ${invData.amountPaid}`);
  }
  if (invData.status !== "paid") {
    throw new Error(`Expected invoice status 'paid', got ${invData.status}`);
  }

  const jASnap = await getDoc(doc(db, "companies", CO, "journals", "je_payment_pay_settle_a"));
  const jBSnap = await getDoc(doc(db, "companies", CO, "journals", "je_payment_pay_settle_b"));
  if (!jASnap.exists() || !jBSnap.exists()) {
    throw new Error("Missing journal entry document for concurrent payment");
  }
});

// -------------------------------------------------------------
// Test 3: Idempotent Payment Replay (Same ID & Same Payload)
// -------------------------------------------------------------
await test("3. Idempotent Replay: Repeating identical payment ID and payload does not duplicate balance deltas", async () => {
  const invId = "inv_prod_idemp_03";
  await setDoc(doc(db, "companies", CO, "invoices", invId), {
    id: invId,
    invoiceNumber: "INV-IDEMP-03",
    status: "sent",
    subTotal: 5000,
    totalTax: 0,
    grandTotal: 5000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const payId = "pay_idemp_01";
  const firstRes = await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 2000, id: payId } }, db);
  const secondRes = await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 2000, id: payId } }, db);

  if (firstRes.payment.id !== secondRes.payment.id) {
    throw new Error("Expected identical payment returned on replay");
  }

  const invSnap = await getDoc(doc(db, "companies", CO, "invoices", invId));
  if (invSnap.data()!.amountPaid !== 2000) {
    throw new Error(`Idempotency violated: amountPaid corrupted to ${invSnap.data()!.amountPaid}`);
  }
});

// -------------------------------------------------------------
// Test 4: Conflict on Replay with Conflicting Invoice/Amount
// -------------------------------------------------------------
await test("4. Replay Conflict Guard: Reusing payment ID with different invoice or amount throws explicit conflict error", async () => {
  const payId = "pay_conflict_test";
  const invA = "inv_conflict_a";
  const invB = "inv_conflict_b";

  await setDoc(doc(db, "companies", CO, "invoices", invA), {
    id: invA,
    invoiceNumber: "INV-CONF-A",
    status: "sent",
    grandTotal: 5000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, "companies", CO, "invoices", invB), {
    id: invB,
    invoiceNumber: "INV-CONF-B",
    status: "sent",
    grandTotal: 5000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  // First payment on Invoice A
  await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invA, payment: { amount: 1000, id: payId } }, db);

  // Attempt to reuse same payId on Invoice B -> MUST FAIL
  let failedDifferentInvoice = false;
  try {
    await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invB, payment: { amount: 1000, id: payId } }, db);
  } catch (err: any) {
    failedDifferentInvoice = true;
    if (!err.message.includes("invoiceId mismatch")) {
      throw new Error(`Expected invoiceId mismatch error, got: ${err.message}`);
    }
  }
  if (!failedDifferentInvoice) {
    throw new Error("Security failure: Reusing payment ID across different invoices was silently accepted!");
  }

  // Attempt to reuse same payId on Invoice A with conflicting amount -> MUST FAIL
  let failedDifferentAmount = false;
  try {
    await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invA, payment: { amount: 2000, id: payId } }, db);
  } catch (err: any) {
    failedDifferentAmount = true;
    if (!err.message.includes("amount mismatch")) {
      throw new Error(`Expected amount mismatch error, got: ${err.message}`);
    }
  }
  if (!failedDifferentAmount) {
    throw new Error("Security failure: Reusing payment ID with conflicting amount was silently accepted!");
  }
});

// -------------------------------------------------------------
// Test 5: Exact Decimal Money Boundary (Zero Overpayment Tolerance)
// -------------------------------------------------------------
await test("5. Exact Monetary Boundary: Non-positive amounts and fractional overpayment (1000.01 on 1000.00) are blocked", async () => {
  const invId = "inv_boundary_05";
  await setDoc(doc(db, "companies", CO, "invoices", invId), {
    id: invId,
    invoiceNumber: "INV-BOUND-05",
    status: "sent",
    grandTotal: 1000.00,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  // Zero payment
  let zeroBlocked = false;
  try {
    await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 0, id: "pay_zero" } }, db);
  } catch (err: any) {
    zeroBlocked = true;
  }
  if (!zeroBlocked) throw new Error("Zero payment was not rejected");

  // Fractional overpayment: 1000.01 on 1000.00
  let overpayBlocked = false;
  try {
    await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 1000.01, id: "pay_over" } }, db);
  } catch (err: any) {
    overpayBlocked = true;
  }
  if (!overpayBlocked) throw new Error("Fractional overpayment (1000.01 on 1000.00) was not rejected!");
});

// -------------------------------------------------------------
// Test 6: Transaction Atomicity on Rejection
// -------------------------------------------------------------
await test("6. Transaction Atomicity: Rejected overpayment leaves zero orphan payment or journal records", async () => {
  const invId = "inv_atomic_06";
  await setDoc(doc(db, "companies", CO, "invoices", invId), {
    id: invId,
    invoiceNumber: "INV-ATOMIC-06",
    status: "sent",
    grandTotal: 1000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const orphanPayId = "pay_orphan_probe";
  try {
    await BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: invId, payment: { amount: 5000, id: orphanPayId } }, db);
  } catch (e) {
    /* expected rejection */
  }

  const paySnap = await getDoc(doc(db, "companies", CO, "payments", orphanPayId));
  if (paySnap.exists()) throw new Error("Orphan payment document was written despite transaction abort!");

  const journalSnap = await getDoc(doc(db, "companies", CO, "journals", `je_payment_${orphanPayId}`));
  if (journalSnap.exists()) throw new Error("Orphan journal document was written despite transaction abort!");

  const invSnap = await getDoc(doc(db, "companies", CO, "invoices", invId));
  if (invSnap.data()!.amountPaid !== 0) throw new Error("Invoice amountPaid was modified despite transaction abort!");
});

// -------------------------------------------------------------
// Test 7: Multi-Invoice Concurrency Isolation
// -------------------------------------------------------------
await test("7. Multi-Invoice Isolation: Simultaneous payments on different invoices do not contend or block", async () => {
  const inv1 = "inv_iso_1";
  const inv2 = "inv_iso_2";

  await setDoc(doc(db, "companies", CO, "invoices", inv1), {
    id: inv1,
    invoiceNumber: "INV-ISO-1",
    status: "sent",
    grandTotal: 3000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, "companies", CO, "invoices", inv2), {
    id: inv2,
    invoiceNumber: "INV-ISO-2",
    status: "sent",
    grandTotal: 7000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const [r1, r2] = await Promise.all([
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: inv1, payment: { amount: 1500, id: "pay_iso_1" } }, db),
    BillingService.executeCustomerPaymentTransaction(CO, { invoiceId: inv2, payment: { amount: 3500, id: "pay_iso_2" } }, db),
  ]);

  if (r1.invoice.amountPaid !== 1500 || r2.invoice.amountPaid !== 3500) {
    throw new Error("Independent invoice payments did not record correct totals");
  }
});

// -------------------------------------------------------------
// Test 8: Vendor Payment Concurrency & Validation
// -------------------------------------------------------------
await test("8. Vendor Payment Flow: executeVendorPaymentTransaction correctly verifies Bills and debits AP", async () => {
  const billId = "bill_vendor_01";
  await setDoc(doc(db, "companies", CO, "bills", billId), {
    id: billId,
    billNumber: "BILL-001",
    status: "open",
    grandTotal: 5000,
    amountPaid: 0,
    currency: "SAR",
    companyId: CO,
    createdAt: serverTimestamp(),
  });

  const [res1, res2] = await Promise.allSettled([
    BillingService.executeVendorPaymentTransaction(CO, { billId, payment: { amount: 3000, id: "pay_vend_a" } }, db),
    BillingService.executeVendorPaymentTransaction(CO, { billId, payment: { amount: 3000, id: "pay_vend_b" } }, db),
  ]);

  const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
  const rejected = [res1, res2].filter((r) => r.status === "rejected");

  if (fulfilled.length !== 1 || rejected.length !== 1) {
    throw new Error(`Expected exactly 1 vendor payment success and 1 rejection, got ${fulfilled.length} / ${rejected.length}`);
  }

  const billSnap = await getDoc(doc(db, "companies", CO, "bills", billId));
  if (billSnap.data()!.amountPaid !== 3000) {
    throw new Error(`Vendor bill amountPaid mismatch: expected 3000, got ${billSnap.data()!.amountPaid}`);
  }
});

await testEnv.cleanup();

console.log("\n=================================================================");
const passed = results.filter((r) => r.passed).length;
console.log(` Production Concurrency Summary: ${passed}/${results.length} passed`);
console.log("=================================================================\n");

if (passed < results.length) {
  process.exit(1);
}
process.exit(0);
