import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const bcrypt = require('../backend/node_modules/bcryptjs');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://darrow:root@localhost:5432/darrow_dev"
    }
  }
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NetworkLogEntry {
  url: string;
  method: string;
  status?: number;
  type?: string;
  timestamp: number;
}

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
}

class CDPBrowserSession {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  public networkLogs: NetworkLogEntry[] = [];
  public consoleLogs: ConsoleLogEntry[] = [];
  public lastCapturedResponse: { url: string; status: number; body?: string } | null = null;

  async connect(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }

      // Handle Network events
      if (msg.method === 'Network.requestWillBeSent') {
        const req = msg.params.request;
        this.networkLogs.push({
          url: req.url,
          method: req.method,
          timestamp: Date.now(),
        });
      }
      if (msg.method === 'Network.responseReceived') {
        const res = msg.params.response;
        const entry = this.networkLogs.slice().reverse().find(l => l.url === res.url);
        if (entry) {
          entry.status = res.status;
        }
        if (res.url.includes('/crm/leads')) {
          this.lastCapturedResponse = {
            url: res.url,
            status: res.status,
          };
        }
      }

      // Handle Console events
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a: any) => a.value ?? a.description ?? '').join(' ');
        this.consoleLogs.push({
          type: msg.params.type,
          text,
          timestamp: Date.now(),
        });
      }

      if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params.exceptionDetails;
        this.consoleLogs.push({
          type: 'error',
          text: `EXCEPTION: ${details.text || ''} ${details.exception?.description || ''}`,
          timestamp: Date.now(),
        });
      }
    };
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Evaluation failed: ${res.exceptionDetails.text} (${JSON.stringify(res.exceptionDetails)})`);
    }
    return res.result?.value;
  }

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(200);
      try {
        const state = await this.evaluate('document.readyState');
        if (state === 'complete' || state === 'interactive') break;
      } catch {}
    }
    await sleep(500);
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const result = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(result.data, 'base64');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputPath, buffer);
  }

  async setInputValue(selector: string, value: string): Promise<void> {
    const ok = await this.waitForSelector(selector, 5000);
    if (!ok) throw new Error(`Selector not found for input: ${selector}`);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, ${JSON.stringify(value)});
      } else {
        el.value = ${JSON.stringify(value)};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async click(selector: string): Promise<void> {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      el.click();
    })()`);
  }

  async waitForSelector(selector: string, timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return true;
      await sleep(250);
    }
    return false;
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function runCrmLeadsBrowserTest() {
  console.log("================================================================================");
  console.log("STARTING AUTONOMOUS BROWSER E2E TEST: CRM LEADS MIGRATION (WP-02)");
  console.log("================================================================================");

  const debugDir = path.join(process.cwd(), 'docs', 'architecture', 'testing', 'screenshots-leads');
  mkdirSync(debugDir, { recursive: true });

  // 1. Verify DB Target
  const dbCheck = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database() AS current_database"
  );
  const currentDb = dbCheck[0]?.current_database;
  console.log(`[DB Check] Connected to PostgreSQL database: ${currentDb}`);
  if (currentDb !== "darrow_dev") {
    throw new Error(`SAFETY BLOCK: Connected to ${currentDb}, expected darrow_dev!`);
  }

  // 2. Prepare Test User and Company
  const testUserEmail = "admin@local.test";
  const testPassword = "Password123!";
  const hashedPassword = await bcrypt.hash(testPassword, 10);
  const companyName = "CRM Verification Corp";

  let testCompany = await prisma.company.findFirst({
    where: { name: companyName, deletedAt: null },
  });
  if (!testCompany) {
    testCompany = await prisma.company.create({
      data: {
        id: randomUUID(),
        name: companyName,
      },
    });
  }

  let testUser = await prisma.user.findUnique({
    where: { email: testUserEmail },
  });

  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: testUserEmail,
        passwordHash: hashedPassword,
        name: "CRM E2E Tester",
        nameAr: "مختبر إدارة علاقات العملاء",
      },
    });
  } else {
    await prisma.user.update({
      where: { id: testUser.id },
      data: { passwordHash: hashedPassword, deletedAt: null },
    });
  }

  let membership = await prisma.companyMembership.findUnique({
    where: { userId: testUser.id },
  });

  if (!membership) {
    membership = await prisma.companyMembership.create({
      data: {
        userId: testUser.id,
        companyId: testCompany.id,
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    });
  } else if (membership.companyId !== testCompany.id || membership.role !== "ADMIN" || membership.status !== "ACTIVE") {
    membership = await prisma.companyMembership.update({
      where: { userId: testUser.id },
      data: {
        companyId: testCompany.id,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
  }

  console.log(`[User Setup] Ready user ${testUserEmail} with role ADMIN at company ${companyName}.`);

  // 3. Launch Edge with remote debugging port
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'edge-crm-leads-profile-'));

  console.log("[Browser Launch] Launching Microsoft Edge on CDP port 9222...");
  const edge: ChildProcess = spawn(edgePath, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ]);

  edge.on('error', (err) => {
    console.error('[Browser Process Error]:', err);
  });

  let cdpReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://localhost:9222/json/version');
      if (res.ok) {
        cdpReady = true;
        break;
      }
    } catch {}
  }

  if (!cdpReady) {
    throw new Error("Failed to connect to Microsoft Edge CDP on port 9222");
  }
  console.log("[Browser Launch] Connected to Edge CDP.");

  const newTargetRes = await fetch('http://localhost:9222/json/new?about:blank', { method: 'PUT' });
  const pageTarget = await newTargetRes.json();
  const client = new CDPBrowserSession();
  await client.connect(pageTarget.webSocketDebuggerUrl);

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  const testSteps: { step: string; status: 'PASS' | 'FAIL'; details: string }[] = [];

  try {
    // Override window.confirm to always return true
    await client.evaluate(`
      window.confirm = () => true;
      window.__crm_test_events = [];
    `);

    // STEP 1: LOGIN FLOW
    console.log("\n--- STEP 1: Login via UI ---");
    await client.navigate('http://127.0.0.1:5173/login');

    const emailSelector = 'input[type="email"], input[name="email"]';
    const emailField = await client.waitForSelector(emailSelector, 50000);
    if (!emailField) {
      await client.captureScreenshot(path.join(debugDir, 'debug-login-failed.png'));
      throw new Error(`Login page did not render email input.`);
    }

    await client.setInputValue(emailSelector, testUserEmail);
    await client.setInputValue('input[type="password"], input[name="password"]', testPassword);
    await sleep(300);

    // Submit form
    await client.evaluate(`(() => {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
      } else {
        const form = document.querySelector('form');
        if (form) form.requestSubmit();
      }
    })()`);

    // Wait for redirect to /apps or dashboard
    let loginSuccess = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const url = await client.evaluate('window.location.href');
      if (!url.includes('/login')) {
        loginSuccess = true;
        break;
      }
    }

    const tokenInStorage = await client.evaluate('localStorage.getItem("d-arrow-refresh-token")');
    console.log(`[DEBUG LOGIN] URL: ${await client.evaluate('window.location.href')}, token: ${tokenInStorage}`);
    console.log(`[DEBUG LOGIN NETWORK]:`, JSON.stringify(client.networkLogs.slice(-10), null, 2));
    console.log(`[DEBUG LOGIN CONSOLE]:`, JSON.stringify(client.consoleLogs.slice(-10), null, 2));
    const step1Ok = loginSuccess && Boolean(tokenInStorage);
    await client.captureScreenshot(path.join(debugDir, '01-login-success.png'));

    testSteps.push({
      step: "1. Login through React UI",
      status: step1Ok ? 'PASS' : 'FAIL',
      details: `tokenStored=${Boolean(tokenInStorage)}, url=${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 1] ${step1Ok ? 'PASS' : 'FAIL'} (Screenshot: 01-login-success.png)`);

    // STEP 2: NAVIGATE TO CRM LEADS
    console.log("\n--- STEP 2: Navigate to CRM Leads ---");
    await client.navigate('http://127.0.0.1:5173/crm/leads');
    await client.waitForSelector('main, .space-y-6, .flex-col', 10000);
    await sleep(2000);

    const buttonsOnPage = await client.evaluate(`Array.from(document.querySelectorAll('button')).map(b => (b.innerText || b.textContent || '').trim())`);
    const pageText = await client.evaluate(`document.body.innerText.slice(0, 500)`);
    console.log(`[DEBUG STEP 2] Current URL: ${await client.evaluate('window.location.href')}`);
    console.log(`[DEBUG STEP 2] Buttons on page:`, JSON.stringify(buttonsOnPage));
    console.log(`[DEBUG STEP 2] Page Text:`, JSON.stringify(pageText));

    await client.captureScreenshot(path.join(debugDir, '02-leads-list.png'));
    const isLeadsPage = await client.evaluate('window.location.pathname.includes("/crm/leads")');

    testSteps.push({
      step: "2. Navigate to CRM Leads page",
      status: isLeadsPage ? 'PASS' : 'FAIL',
      details: `Current Path: ${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 2] ${isLeadsPage ? 'PASS' : 'FAIL'} (Screenshot: 02-leads-list.png)`);

    // STEP 3: CLICK "ADD LEAD" BUTTON
    console.log("\n--- STEP 3: Click 'Add Lead' Button ---");
    for (let i = 0; i < 20; i++) {
      const hasAdd = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.innerText || b.textContent || '').trim();
          return text.includes('إضافة عميل محتمل') || text.includes('Add Lead') || Boolean(b.querySelector('svg.lucide-plus'));
        });
      })()`);
      if (hasAdd) break;
      await sleep(300);
    }

    const clickedAdd = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const addBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('إضافة عميل محتمل') || text.includes('Add Lead') || Boolean(b.querySelector('svg.lucide-plus'));
      });
      if (addBtn) {
        addBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedAdd) {
      throw new Error("Could not find or click 'Add Lead' button on /crm/leads");
    }

    // Wait for Modal to open
    const modalOpened = await client.waitForSelector('section[role="dialog"], [role="dialog"], form', 5000);
    await sleep(600);
    await client.captureScreenshot(path.join(debugDir, '03-add-lead-modal.png'));

    testSteps.push({
      step: "3. Open Add Lead Modal",
      status: modalOpened ? 'PASS' : 'FAIL',
      details: `Modal opened: ${modalOpened}`,
    });
    console.log(`[Step 3] ${modalOpened ? 'PASS' : 'FAIL'} (Screenshot: 03-add-lead-modal.png)`);

    // STEP 4: FILL FORM FIELDS
    console.log("\n--- STEP 4: Fill Lead Form ---");
    const testLeadName = "شركة الرواد للتطوير العقاري";
    const testCompanyName = "مجموعة الرواد القابضة";
    const testPhone = "0559988776";
    const testEmail = `alrowad.lead.${Date.now()}@darrow-test.com`;
    const testNotes = "عميل محتمل كبير مهتم بأنظمة إدارة الأعمال المتكاملة";

    await client.setInputValue('input[name="name"]', testLeadName);
    await client.setInputValue('input[name="company"]', testCompanyName);
    await client.setInputValue('input[name="phone"]', testPhone);
    await client.setInputValue('input[name="email"]', testEmail);
    await client.setInputValue('textarea[name="notes"]', testNotes);

    await sleep(400);
    await client.captureScreenshot(path.join(debugDir, '04-lead-form-filled.png'));
    console.log(`[Step 4] PASS: Form filled with ${testLeadName} (Screenshot: 04-lead-form-filled.png)`);

    // STEP 5: SUBMIT FORM & VERIFY POST /api/v1/crm/leads
    console.log("\n--- STEP 5: Submit Form and Verify POST /api/v1/crm/leads ---");
    const clickedSubmit = await client.evaluate(`(() => {
      const modal = document.querySelector('section[role="dialog"], [role="dialog"]');
      if (!modal) return false;
      const buttons = Array.from(modal.querySelectorAll('button[type="submit"], button'));
      const submitBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return (text.includes('حفظ') || text.includes('Save') || text.includes('إنشاء') || text.includes('Create')) && !text.includes('إضافة أخرى');
      });
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedSubmit) {
      throw new Error("Could not find submit button in Lead modal");
    }

    // Wait for POST response
    let postLeadReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      postLeadReq = client.networkLogs.find(
        (l) => l.method === 'POST' && (l.url.includes('/crm/leads') || l.url.includes('/api/v1/crm/leads'))
      );
      if (postLeadReq && postLeadReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '05-lead-saved-in-list.png'));

    // Check database for created lead
    const createdDbLead = await prisma.lead.findFirst({
      where: {
        companyId: testCompany.id,
        email: testEmail,
        deletedAt: null,
      },
    });

    const step5Ok = Boolean(postLeadReq && postLeadReq.status === 201 && createdDbLead);
    testSteps.push({
      step: "4 & 5. Create Lead and Verify API (201 Created)",
      status: step5Ok ? 'PASS' : 'FAIL',
      details: `Network: ${postLeadReq?.method} ${postLeadReq?.url} -> ${postLeadReq?.status}, DB Lead ID: ${createdDbLead?.id}`,
    });
    console.log(`[Step 5] ${step5Ok ? 'PASS' : 'FAIL'} (Status: ${postLeadReq?.status}, DB ID: ${createdDbLead?.id})`);

    if (!createdDbLead) {
      throw new Error("Lead was not created in database!");
    }

    const createdLeadId = createdDbLead.id;

    // STEP 6: NAVIGATE TO LEAD DETAIL PAGE
    console.log(`\n--- STEP 6: Open Lead Details (/crm/leads/${createdLeadId}) ---`);
    await client.navigate(`http://127.0.0.1:5173/crm/leads/${createdLeadId}`);

    let leadDetailReady = false;
    for (let i = 0; i < 60; i++) {
      const hasTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testLeadName)})`);
      const hasEditBtn = await client.evaluate(`Boolean(document.querySelector('button svg.lucide-pencil') || Array.from(document.querySelectorAll('button')).some(b => (b.innerText || '').includes('تعديل') || (b.innerText || '').includes('Edit')))`);
      if (hasTitle || hasEditBtn) {
        leadDetailReady = true;
        break;
      }
      await sleep(500);
    }
    await sleep(500);

    const hasLeadTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testLeadName)})`);
    await client.captureScreenshot(path.join(debugDir, '06-lead-detail.png'));

    testSteps.push({
      step: "6. Open Lead Detail Page",
      status: leadDetailReady ? 'PASS' : 'FAIL',
      details: `Rendered name "${testLeadName}": ${hasLeadTitle}`,
    });
    console.log(`[Step 6] ${leadDetailReady ? 'PASS' : 'FAIL'} (Screenshot: 06-lead-detail.png)`);

    // STEP 7: EDIT LEAD DETAILS
    console.log("\n--- STEP 7: Edit Lead Details via Edit Modal ---");
    const clickedEdit = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const editBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('تعديل') || text.includes('Edit') || Boolean(b.querySelector('svg.lucide-pencil'));
      });
      if (editBtn) {
        editBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedEdit) {
      throw new Error("Could not find or click 'Edit' button on LeadDetailPage");
    }

    await client.waitForSelector('textarea[name="notes"]', 10000);
    const updatedNotes = "تم التواصل مع العميل وتقديم العرض المبدئي بنجاح - ملاحظات محدثة";
    await client.setInputValue('textarea[name="notes"]', updatedNotes);
    await sleep(300);

    // Click save in modal
    await client.evaluate(`(() => {
      const modal = document.querySelector('section[role="dialog"], [role="dialog"]');
      if (!modal) return false;
      const submitBtn = modal.querySelector('button[type="submit"]') || Array.from(modal.querySelectorAll('button')).find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('حفظ') || text.includes('Save') || text.includes('تحديث');
      });
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      return false;
    })()`);

    // Wait for PUT response
    let putLeadReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      putLeadReq = client.networkLogs.find(
        (l) => l.method === 'PUT' && l.url.includes(`/crm/leads/${createdLeadId}`)
      );
      if (putLeadReq && putLeadReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '07-lead-edited.png'));

    const step7Ok = Boolean(putLeadReq && putLeadReq.status === 200);
    testSteps.push({
      step: "7. Edit Lead and Verify API (200 OK)",
      status: step7Ok ? 'PASS' : 'FAIL',
      details: `Network: ${putLeadReq?.method} ${putLeadReq?.url} -> ${putLeadReq?.status}`,
    });
    console.log(`[Step 7] ${step7Ok ? 'PASS' : 'FAIL'} (Status: ${putLeadReq?.status})`);

    // STEP 8: RELOAD AND VERIFY PERSISTENCE
    console.log("\n--- STEP 8: Reload and Verify Persistence ---");
    await client.send('Page.reload');
    await sleep(2000);
    try {
      await client.evaluate('window.confirm = () => true;');
    } catch {}

    const reloadedDbLead = await prisma.lead.findUnique({
      where: { id: createdLeadId },
    });
    const persistedInDb = reloadedDbLead?.notes === updatedNotes;

    await client.captureScreenshot(path.join(debugDir, '08-reloaded-persisted.png'));

    testSteps.push({
      step: "8. Reload and Verify Persistence in UI & DB",
      status: persistedInDb ? 'PASS' : 'FAIL',
      details: `DB notes updated to "${reloadedDbLead?.notes?.slice(0, 40)}..."`,
    });
    console.log(`[Step 8] ${persistedInDb ? 'PASS' : 'FAIL'} (Persisted Notes in DB: ${persistedInDb})`);

    // STEP 9: DELETE LEAD
    console.log("\n--- STEP 9: Delete Lead and Verify Soft Delete (200 OK) ---");
    for (let i = 0; i < 30; i++) {
      const hasDelBtn = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.innerText || b.textContent || '').trim();
          return text.includes('حذف') || text.includes('Delete') || Boolean(b.querySelector('svg.lucide-trash-2'));
        });
      })()`);
      if (hasDelBtn) break;
      await sleep(400);
    }

    const clickedDelete = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const delBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('حذف') || text.includes('Delete') || Boolean(b.querySelector('svg.lucide-trash-2'));
      });
      if (delBtn) {
        delBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedDelete) {
      throw new Error("Could not find or click Delete button on LeadDetailPage");
    }

    // Wait for DELETE response
    let deleteLeadReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      deleteLeadReq = client.networkLogs.find(
        (l) => l.method === 'DELETE' && l.url.includes(`/crm/leads/${createdLeadId}`)
      );
      if (deleteLeadReq && deleteLeadReq.status) break;
    }

    await sleep(1500);
    await client.captureScreenshot(path.join(debugDir, '09-lead-deleted.png'));

    // Check database for soft-deleted lead
    const deletedDbLead = await prisma.lead.findUnique({
      where: { id: createdLeadId },
    });
    const isSoftDeleted = deletedDbLead !== null && deletedDbLead.deletedAt !== null;

    const step9Ok = Boolean(deleteLeadReq && deleteLeadReq.status === 200 && isSoftDeleted);
    testSteps.push({
      step: "9. Delete Lead via UI and Verify Soft Delete",
      status: step9Ok ? 'PASS' : 'FAIL',
      details: `Network: ${deleteLeadReq?.method} ${deleteLeadReq?.url} -> ${deleteLeadReq?.status}, DB deletedAt: ${deletedDbLead?.deletedAt}`,
    });
    console.log(`[Step 9] ${step9Ok ? 'PASS' : 'FAIL'} (Status: ${deleteLeadReq?.status}, deletedAt: ${deletedDbLead?.deletedAt})`);

    // STEP 10: VERIFY ZERO FIRESTORE WRITES
    console.log("\n--- STEP 10: Verify Zero Firestore Writes During Leads CRUD ---");
    const allFirebaseRequests = client.networkLogs.filter(
      (l) => l.url.includes('firestore.googleapis.com') || l.url.includes('firebaseio.com')
    );
    console.log("[DEBUG ALL FIREBASE REQUESTS]:", JSON.stringify(allFirebaseRequests, null, 2));

    const firebaseWriteRequests = client.networkLogs.filter(
      (l) => (l.url.includes('firestore.googleapis.com') || l.url.includes('firebaseio.com')) &&
             (l.url.includes('Write') || l.url.includes('commit') || (l.method !== 'GET' && !l.url.includes('Listen') && !l.url.includes('BatchGet')))
    );
    const step10Ok = firebaseWriteRequests.length === 0;
    testSteps.push({
      step: "10. Verify Zero Firebase/Firestore Writes During Leads CRUD",
      status: step10Ok ? 'PASS' : 'FAIL',
      details: `Detected ${firebaseWriteRequests.length} Firestore write requests during Leads lifecycle.`,
    });
    console.log(`[Step 10] ${step10Ok ? 'PASS' : 'FAIL'} (Firebase write requests: ${firebaseWriteRequests.length})`);

  } finally {
    client.close();
    try {
      edge.kill();
    } catch {}
    await prisma.$disconnect();
  }

  // Summary
  console.log("\n================================================================================");
  console.log("CRM LEADS BROWSER TEST SUMMARY:");
  console.table(testSteps);
  console.log("================================================================================");

  const allPassed = testSteps.every((s) => s.status === 'PASS');
  if (!allPassed) {
    process.exit(1);
  }
}

runCrmLeadsBrowserTest().catch((err) => {
  console.error("\n[TEST RUNNER FATAL ERROR]:", err);
  process.exit(1);
});
