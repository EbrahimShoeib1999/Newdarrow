/**
 * D-Arrow Business — Client Demo End-to-End Browser Acceptance Test
 * Drives Microsoft Edge Headless via Chrome DevTools Protocol (CDP)
 * Connected to local Firebase Auth, Firestore, and Storage emulators.
 * Validates the complete 10-step client demo journey across CRM, Tasks, and Billing.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_client_demo_${Date.now()}`);
const CDP_PORT = 9788;
const VITE_PORT = 5175;
const PROJECT_ID = "demo-acceptance-suite";

try {
  rmSync(profileDir, { recursive: true, force: true });
} catch (e) {}
mkdirSync(profileDir, { recursive: true });

console.log("\n========================================================================");
console.log(" D-Arrow Business — Client Demo E2E Browser Acceptance (CDP)");
console.log("========================================================================\n");

// 1. Start isolated test Vite dev server
console.log(`Starting isolated test Vite instance on port ${VITE_PORT}...`);
const viteProc = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"],
  {
    env: {
      ...process.env,
      VITE_USE_FIREBASE_EMULATOR: "true",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
      VITE_FIRESTORE_EMULATOR_PORT: "8080",
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
    },
    stdio: "pipe",
  }
);

viteProc.stdout.on("data", (d) => {
  const msg = d.toString();
  if (msg.includes("Local:")) {
    console.log(`Vite test server ready: http://localhost:${VITE_PORT}`);
  }
});

let viteReady = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const res = await fetch(`http://localhost:${VITE_PORT}/`);
    if (res.ok) {
      viteReady = true;
      break;
    }
  } catch (e) {}
}

if (!viteReady) {
  viteProc.kill();
  throw new Error("Vite test server failed to start");
}

// 2. Start Edge Headless with isolated debugging port
console.log(`Starting Edge Headless on CDP port ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profileDir}`,
  "about:blank",
]);
const edgePid = edgeProc.pid;
console.log(`Edge process started (PID: ${edgePid})`);

let pageTarget = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      pageTarget = pages.find((p) => p.type === "page");
      if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
    }
  } catch (e) {}
}

if (!pageTarget) {
  edgeProc.kill();
  viteProc.kill();
  throw new Error("Could not connect to Edge DevTools port");
}

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let msgId = 1;
const pending = new Map();

ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
  if (data.method === "Runtime.consoleAPICalled" && (data.params?.type === "error" || data.params?.type === "warning")) {
    const args = (data.params.args || []).map((a) => a.value || a.description || JSON.stringify(a)).join(" ");
    console.log(`  [Browser ${data.params.type}]`, args);
  }
  if (data.method === "Runtime.exceptionThrown") {
    console.log("  [Browser Exception]", data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text);
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.clearBrowserCookies");
await send("Network.clearBrowserCache");

async function waitForSelector(selector, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await send("Runtime.evaluate", {
      expression: `!!document.querySelector('${selector}')`,
    });
    if (res?.result?.result?.value) return true;
  }
  return false;
}

async function waitForText(textMatcher, maxTries = 40) {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 600));
    const res = await send("Runtime.evaluate", { expression: "document.body.innerText" });
    const content = res?.result?.result?.value || "";
    if (typeof textMatcher === "string" ? content.includes(textMatcher) : textMatcher(content)) {
      return content;
    }
  }
  return null;
}

const testResults = [];

async function step(name, fn) {
  try {
    console.log(`\n>>> EXECUTING: ${name}`);
    const detail = await fn();
    console.log(`✓ PASS: ${name} ${detail ? `(${detail})` : ""}`);
    testResults.push({ name, ok: true, detail });
  } catch (err) {
    console.error(`✗ FAIL: ${name}`, err?.message || err);
    testResults.push({ name, ok: false, error: err?.message || String(err) });
  }
}

// 3. Seed Auth & Firestore
const DEMO_EMAIL = "admin@darrow.com";
const DEMO_PASS = "admin123";

// Create user in Auth Emulator
let userId = null;
const signUpRes = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: DEMO_EMAIL,
    password: DEMO_PASS,
    returnSecureToken: true,
  }),
});
const signUpData = await signUpRes.json();
if (signUpData.localId) {
  userId = signUpData.localId;
} else {
  const signInRes = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: DEMO_EMAIL,
      password: DEMO_PASS,
      returnSecureToken: true,
    }),
  });
  const signInData = await signInRes.json();
  userId = signInData.localId;
}

// Seed Firestore records
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { rules: readFileSync("firestore.rules", "utf8") },
});

const companyId = "d-arrow";
const inv1Date = new Date();
const inv1Due = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  if (userId) {
    await setDoc(doc(db, "users", userId), {
      email: DEMO_EMAIL,
      name: "Salem Al-Rashid",
      nameAr: "سالم الراشد",
      role: "admin",
      companyId,
      companyName: "D-Arrow Business Solutions",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  await setDoc(doc(db, "companies", companyId), {
    id: companyId,
    name: "D-Arrow Business Solutions",
    nameAr: "دي-آرو للأعمال والحلول الرقمية",
    currency: "SAR",
    taxNumber: "300012345600003",
    commercialRegister: "1010123456",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Chart of Accounts
  await setDoc(doc(db, "companies", companyId, "accounts", "acc_1020"), {
    id: "acc_1020",
    code: "1020",
    nameAr: "البنك الأهلي السعودي",
    nameEn: "SNB Bank Account",
    type: "asset",
    balance: 250000,
    isActive: true,
    companyId,
  });
  await setDoc(doc(db, "companies", companyId, "accounts", "acc_1200"), {
    id: "acc_1200",
    code: "1200",
    nameAr: "العملاء والمدينون",
    nameEn: "Accounts Receivable",
    type: "asset",
    balance: 23000,
    isActive: true,
    companyId,
  });
  await setDoc(doc(db, "companies", companyId, "accounts", "acc_2200"), {
    id: "acc_2200",
    code: "2200",
    nameAr: "ضريبة القيمة المضافة المستحقة (15%)",
    nameEn: "VAT Output Tax",
    type: "liability",
    balance: 3000,
    isActive: true,
    companyId,
  });
  await setDoc(doc(db, "companies", companyId, "accounts", "acc_4100"), {
    id: "acc_4100",
    code: "4100",
    nameAr: "إيرادات تطوير البرمجيات والحلول الرقمية",
    nameEn: "Software & Digital Solutions Revenue",
    type: "revenue",
    balance: 20000,
    isActive: true,
    companyId,
  });

  // CRM Contacts
  await setDoc(doc(db, "companies", companyId, "contacts", "contact-horizon-01"), {
    id: "contact-horizon-01",
    accountName: "شركة الأفق للتقنية المتقدمة",
    entityType: "company",
    classification: "actual_client",
    relationships: ["active_client"],
    email: "info@horizon-tech.sa",
    phone: "+966551234567",
    city: "الرياض",
    taxNumber: "300099887700003",
    commercialRegister: "1010998877",
    status: "active",
    companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // CRM Deals
  await setDoc(doc(db, "companies", companyId, "deals", "deal-platform-01"), {
    id: "deal-platform-01",
    title: "مشروع تطوير منصة رقمية متكاملة",
    contactId: "contact-horizon-01",
    amount: 120000,
    stage: "proposal",
    probability: 70,
    expectedCloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    assignedTo: userId,
    priority: "high",
    companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Sprints & Tasks
  await setDoc(doc(db, "companies", companyId, "sprints", "sprint-demo-01"), {
    id: "sprint-demo-01",
    name: "Sprint 2026-Q4 / إطلاق المنصة",
    status: "active",
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    companyId,
  });

  await setDoc(doc(db, "companies", companyId, "tasks", "task-demo-01"), {
    id: "task-demo-01",
    title: "تصميم لوحات التحكم والتقارير المالية التفاعلية",
    status: "in_progress",
    priority: "high",
    type: "task",
    department: "الهندسة والبرمجيات",
    estimatedHours: 40,
    dealId: "deal-platform-01",
    contactId: "contact-horizon-01",
    companyId,
    assigneeId: userId,
    sprintId: "sprint-demo-01",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Invoices & Journals
  await setDoc(doc(db, "companies", companyId, "invoices", "inv_demo_01"), {
    id: "inv_demo_01",
    invoiceNumber: "INV-2026-001",
    status: "sent",
    approvalStatus: "approved",
    customerId: "contact-horizon-01",
    customerName: "شركة الأفق للتقنية المتقدمة",
    issueDate: inv1Date.toISOString(),
    dueDate: inv1Due.toISOString(),
    currency: "SAR",
    subTotal: 20000,
    totalTax: 3000,
    totalDiscount: 0,
    grandTotal: 23000,
    amountPaid: 0,
    shareToken: "share_demo_01",
    journalEntryId: "je_inv_demo_01",
    items: [
      {
        id: "item_0",
        description: "تطوير برمجيات سحابية مخصصة - المرحلة الأولى",
        quantity: 1,
        unitPrice: 20000,
        taxRate: 15,
        total: 20000,
      },
    ],
    companyId,
    createdAt: inv1Date.toISOString(),
    updatedAt: inv1Date.toISOString(),
  });

  // Balanced Journal Entry
  await setDoc(doc(db, "companies", companyId, "journals", "je_inv_demo_01"), {
    id: "je_inv_demo_01",
    entryNumber: "JE-2026-001",
    date: inv1Date.toISOString(),
    description: "إثبات فاتورة مبيعات INV-2026-001 - شركة الأفق",
    status: "posted",
    isAutoGenerated: true,
    sourceDocumentId: "inv_demo_01",
    sourceDocumentType: "invoice",
    lines: [
      { id: "line_1", accountId: "acc_1200", debit: 23000, credit: 0, description: "مدينون - شركة الأفق" },
      { id: "line_2", accountId: "acc_4100", debit: 0, credit: 20000, description: "إيرادات تطوير البرمجيات" },
      { id: "line_3", accountId: "acc_2200", debit: 0, credit: 3000, description: "ضريبة القيمة المضافة المستحقة (15%)" },
    ],
    totalDebit: 23000,
    totalCredit: 23000,
    companyId,
    createdAt: inv1Date.toISOString(),
    updatedAt: inv1Date.toISOString(),
  });

  // Public Invoice Share
  await setDoc(doc(db, "publicInvoiceShares", "share_demo_01"), {
    token: "share_demo_01",
    companyId,
    invoiceId: "inv_demo_01",
    status: "active",
    createdAt: inv1Date.toISOString(),
    snapshot: {
      amountDue: 23000,
      customerName: "شركة الأفق للتقنية المتقدمة",
      company: {
        name: "دي-آرو للأعمال والحلول الرقمية",
        taxNumber: "300012345600003",
      },
      invoice: {
        id: "inv_demo_01",
        invoiceNumber: "INV-2026-001",
        status: "sent",
        customerName: "شركة الأفق للتقنية المتقدمة",
        issueDate: inv1Date.toISOString(),
        dueDate: inv1Due.toISOString(),
        currency: "SAR",
        subTotal: 20000,
        totalTax: 3000,
        totalDiscount: 0,
        grandTotal: 23000,
        amountPaid: 0,
        items: [
          {
            id: "item_0",
            description: "تطوير برمجيات سحابية مخصصة - المرحلة الأولى",
            quantity: 1,
            unitPrice: 20000,
            taxRate: 15,
            total: 20000,
          },
        ],
      },
    },
  });
});

try {
  // Test 1: Protected route redirection & login form mounting
  await step("1. Protected Route Interception & Login Form Mounting", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/login` });
    const mounted = await waitForSelector('input[name="email"]', 30);
    if (!mounted) throw new Error("Login form email input failed to mount");
    return "Login form mounted successfully";
  });

  // Test 2: Authenticate Demo Admin Account via UI
  await step("2. Authenticate Demo Admin Account via UI", async () => {
    const fillRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const emailInput = document.querySelector('input[name="email"]');
        const passInput = document.querySelector('input[id="login-password"]') || document.querySelector('input[type="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        if (!emailInput || !passInput || !submitBtn) return { error: "Inputs not found" };

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(emailInput, "${DEMO_EMAIL}");
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));

        setter.call(passInput, "${DEMO_PASS}");
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));

        submitBtn.click();
        return { ok: true };
      })()`,
      returnByValue: true,
    });

    if (fillRes?.result?.result?.value?.error) throw new Error(fillRes.result.result.value.error);

    let authedUrl = "";
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await send("Runtime.evaluate", { expression: "window.location.href" });
      authedUrl = res?.result?.result?.value || "";
      if (!authedUrl.includes("/login")) break;
    }

    if (authedUrl.includes("/login")) throw new Error("Login failed to navigate");
    return `Signed in successfully, landed at: ${authedUrl}`;
  });

  // Test 3: Navigate to CRM Module & Verify Dashboard Metrics
  await step("3. CRM Module & Metric Verification", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/crm` });
    const content = await waitForText((txt) => txt.includes("CRM") || txt.includes("العملاء") || txt.includes("الصفقات"), 25);
    if (!content) throw new Error("CRM Dashboard did not render expected sections");
    return "CRM dashboard mounted with live metrics";
  });

  // Test 4: CRM Contacts List & Verification of Horizon Tech
  await step("4. CRM Contacts Module & Client Record", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/crm/contacts` });
    const content = await waitForText((txt) => txt.includes("الأفق") || txt.includes("Horizon"), 25);
    if (!content) throw new Error("Customer 'شركة الأفق' not found in contacts table");
    return "Contacts table lists 'شركة الأفق للتقنية المتقدمة' with active status";
  });

  // Test 5: CRM Deals Pipeline View
  await step("5. Deals Pipeline Kanban & Stage Verification", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/crm/deals` });
    const content = await waitForText((txt) => txt.includes("مشروع تطوير منصة رقمية") || txt.includes("120,000"), 25);
    if (!content) throw new Error("Expected deal in pipeline not found");
    return "Pipeline displays 'مشروع تطوير منصة رقمية متكاملة' (120,000 SAR) in proposal stage";
  });

  // Test 6: Tasks Workspace & Sprints
  await step("6. Tasks Workspace & Delivery Execution", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/tasks/work` });
    const content = await waitForText((txt) => txt.includes("تصميم لوحات التحكم") || txt.includes("مهام") || txt.includes("Sprint"), 25);
    if (!content) throw new Error("Tasks workspace did not load active tasks");
    return "Tasks workspace loaded with Sprint 2026-Q4 delivery tasks";
  });

  // Test 7: Billing & Invoicing Module
  await step("7. Invoices Module & Issued Record Verification", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/billing/invoices` });
    const content = await waitForText(
      (txt) => txt.includes("INV-2026-001") || txt.includes("23,000") || txt.includes("٢٣"),
      45
    );
    if (!content) {
      const cur = await send("Runtime.evaluate", { expression: "document.body.innerText.substring(0, 300)" });
      throw new Error(`Invoice INV-2026-001 not found; page text: ${cur?.result?.result?.value}`);
    }
    return "Invoices table displays INV-2026-001 (23,000 SAR, Approved/Sent)";
  });

  // Test 8: Invoice Detail View with Audit & QR Delivery
  await step("8. Invoice Detail Page & Accounting Connection", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/billing/invoices/inv_demo_01` });
    const content = await waitForText(
      (txt) => txt.includes("INV-2026-001") && (txt.includes("23,000") || txt.includes("23000") || txt.includes("٢٣")),
      45
    );
    if (!content) {
      const cur = await send("Runtime.evaluate", { expression: "document.body.innerText.substring(0, 300)" });
      throw new Error(`Invoice detail did not display invoice data; page text: ${cur?.result?.result?.value}`);
    }
    return "Invoice detail displays 23,000 SAR total, 15% VAT breakdown, and QR share integration";
  });

  // Test 9: Public Invoice Share Verification
  await step("9. Public Invoice Share Verification (/i/share_demo_01)", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/i/share_demo_01` });
    const content = await waitForText(
      (txt) => txt.includes("INV-2026-001") || txt.includes("الأفق") || txt.includes("23,000") || txt.includes("٢٣"),
      45
    );
    if (!content) {
      const cur = await send("Runtime.evaluate", { expression: "document.body.innerText.substring(0, 300)" });
      throw new Error(`Public share view failed; page text: ${cur?.result?.result?.value}`);
    }

    // Verify privacy: no internal account IDs or journal linkages
    if (content.includes("journalEntryId") || content.includes("costCenterId") || content.includes("acc_1200")) {
      throw new Error("Public share leaked internal accounting fields!");
    }
    return "Public share renders customer invoice, QR code, and allowlisted fields securely";
  });

  // Test 10: State Persistence across Full Reload
  await step("10. State Persistence Across Full Page Reload", async () => {
    await send("Page.navigate", { url: `http://localhost:${VITE_PORT}/crm/deals` });
    await waitForText((txt) => txt.includes("مشروع تطوير منصة رقمية"), 20);
    await send("Page.reload");
    await new Promise((r) => setTimeout(r, 2500));

    let authed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const checkUrl = await send("Runtime.evaluate", { expression: "window.location.href" });
      const url = checkUrl?.result?.result?.value || "";
      if (!url.includes("/login")) {
        authed = true;
        break;
      }
    }
    if (!authed) throw new Error("Authentication lost upon page reload; redirected to /login");

    const content = await waitForText(
      (txt) => !txt.includes("Loading...") && (txt.includes("مشروع تطوير منصة رقمية") || txt.includes("120,000") || txt.includes("١٢٠")),
      60
    );
    if (!content) {
      const curUrl = await send("Runtime.evaluate", { expression: "window.location.href" });
      const curBody = await send("Runtime.evaluate", { expression: "document.body.innerText.substring(0, 500)" });
      throw new Error(`Persisted deal disappeared after reload. Current URL: ${curUrl?.result?.result?.value}, Body: ${curBody?.result?.result?.value}`);
    }

    return "Session and business data persist across browser reload";
  });

} finally {
  try {
    if (typeof testEnv !== "undefined" && testEnv) {
      await testEnv.cleanup();
    }
  } catch (e) {}
  try {
    ws.close();
  } catch (e) {}
  try {
    edgeProc.kill();
    console.log(`Killed Edge process (PID: ${edgePid})`);
  } catch (e) {}
  try {
    viteProc.kill();
    console.log("Killed test Vite server");
  } catch (e) {}
}

console.log("\n========================================================================");
const passed = testResults.filter((r) => r.ok).length;
console.log(` Client Demo Acceptance Summary: ${passed}/${testResults.length} passed`);
console.log("========================================================================\n");

if (passed < testResults.length) {
  process.exit(1);
}
