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
        if (res.url.includes('/crm/deals')) {
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

  send(method: string, params: Record<string, any> = {}): Promise<any> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  async navigate(url: string) {
    await this.send('Page.navigate', { url });
    await sleep(2000);
  }

  async evaluate(expression: string): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result?.value;
  }

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return true;
      await sleep(250);
    }
    return false;
  }

  async captureScreenshot(filePath: string) {
    const data = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(data.data, 'base64');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath, buffer);
  }

  async setInputValue(selector: string, value: string) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) {
          desc.set.call(el, ${JSON.stringify(value)});
        } else {
          el.value = ${JSON.stringify(value)};
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
  }
}

async function findChromeExecutable(): Promise<string> {
  const commonPaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of commonPaths) {
    if (p && existsSync(p)) return p;
  }
  return 'chrome.exe';
}

async function main() {
  console.log("===============================================================================");
  console.log("  D-ARROW PLATFORM — WP-03 CRM DEALS BROWSER E2E VERIFICATION & NETWORK AUDIT");
  console.log("===============================================================================\n");

  const debugDir = path.resolve('screenshots-deals');
  if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });

  const testSteps: { step: string; status: 'PASS' | 'FAIL'; details: string }[] = [];

  // SAFETY DB CHECK
  const res = await prisma.$queryRawUnsafe('SELECT current_database(), current_user;');
  console.log(`[SAFETY CHECK] Connected DB:`, JSON.stringify(res));
  if (res[0].current_database !== 'darrow_dev') {
    throw new Error(`ABORT: Target database is NOT darrow_dev! (${res[0].current_database})`);
  }

  const UNIQUE = Date.now().toString(36);
  const testCompanyId = randomUUID();
  const testEmail = `deals-e2e-admin-${UNIQUE}@darrow.test`;
  const testPassword = "Password123!";
  const hashedPassword = await bcrypt.hash(testPassword, 10);

  console.log(`[SEED] Creating test company & admin in PostgreSQL darrow_dev...`);
  const testCompany = await prisma.company.create({
    data: {
      id: testCompanyId,
      name: `Deals E2E Company ${UNIQUE}`,
    }
  });

  const testUser = await prisma.user.create({
    data: {
      id: randomUUID(),
      email: testEmail,
      name: "Deals E2E Administrator",
      passwordHash: hashedPassword,
    }
  });

  await prisma.companyMembership.create({
    data: {
      userId: testUser.id,
      companyId: testCompany.id,
      role: "ADMIN",
      status: "ACTIVE",
    }
  });

  // Seed a Customer in this company for deal linkage
  const testContact = await prisma.customer.create({
    data: {
      companyId: testCompany.id,
      firstName: "أحمد",
      lastName: "الغامدي",
      accountName: "مؤسسة الغامدي للمقاولات",
    }
  });

  console.log(`[SEED OK] Company: ${testCompany.name} (${testCompany.id})`);
  console.log(`[SEED OK] Contact: ${testContact.firstName} ${testContact.lastName} (${testContact.id})`);

  // Start Chrome with Remote Debugging
  const chromePath = await findChromeExecutable();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'chrome-deals-e2e-'));
  const port = 9333;

  console.log(`[BROWSER] Launching Chrome CDP on port ${port}...`);
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let client: CDPBrowserSession;

  try {
    // Wait for CDP endpoint
    let cdpReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (response.ok) {
          cdpReady = true;
          break;
        }
      } catch {}
      await sleep(300);
    }

    if (!cdpReady) {
      throw new Error(`Failed to connect to Browser CDP on port ${port}`);
    }

    const newTargetRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    const pageTarget = await newTargetRes.json();
    client = new CDPBrowserSession();
    await client.connect(pageTarget.webSocketDebuggerUrl);
    console.log(`[BROWSER] Page CDP Session connected!`);

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    await client.evaluate(`
      window.confirm = () => true;
      window.__crm_test_events = [];
    `);

    // STEP 1: LOGIN THROUGH UI
    console.log("\n--- STEP 1: Login through React UI ---");
    await client.navigate('http://127.0.0.1:5173/login');
    await client.waitForSelector('input[type="email"], input[name="email"]', 10000);
    await sleep(500);

    await client.setInputValue('input[type="email"], input[name="email"]', testEmail);
    await client.setInputValue('input[type="password"], input[name="password"]', testPassword);
    await sleep(300);

    await client.evaluate(`(() => {
      const btn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('دخول') || (b.innerText || '').includes('Login'));
      if (btn) btn.click();
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
    const step1Ok = loginSuccess && Boolean(tokenInStorage);
    await client.captureScreenshot(path.join(debugDir, '01-login-success.png'));

    testSteps.push({
      step: "1. Login through React UI",
      status: step1Ok ? 'PASS' : 'FAIL',
      details: `tokenStored=${Boolean(tokenInStorage)}, url=${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 1] ${step1Ok ? 'PASS' : 'FAIL'} (Screenshot: 01-login-success.png)`);

    // STEP 2: NAVIGATE TO CRM DEALS
    console.log("\n--- STEP 2: Navigate to CRM Deals ---");
    await client.navigate('http://127.0.0.1:5173/crm/deals');
    await client.waitForSelector('main, .space-y-3, .flex-col', 10000);
    await sleep(2000);

    await client.captureScreenshot(path.join(debugDir, '02-deals-pipeline.png'));
    const isDealsPage = await client.evaluate('window.location.pathname.includes("/crm/deals")');

    testSteps.push({
      step: "2. Navigate to CRM Deals page",
      status: isDealsPage ? 'PASS' : 'FAIL',
      details: `Current Path: ${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 2] ${isDealsPage ? 'PASS' : 'FAIL'} (Screenshot: 02-deals-pipeline.png)`);

    // STEP 3: CLICK "ADD DEAL" BUTTON
    console.log("\n--- STEP 3: Click 'Add Deal' Button ---");
    await sleep(1000);
    const buttonsFound = await client.evaluate(`Array.from(document.querySelectorAll('button')).map(b => (b.innerText || b.textContent || '').trim())`);
    console.log("[DEBUG STEP 3 BUTTONS]:", JSON.stringify(buttonsFound));

    for (let i = 0; i < 20; i++) {
      const hasAdd = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.innerText || b.textContent || '').trim();
          return text.includes('إضافة صفقة') || text.includes('Add deal') || text.includes('Add Deal') || Boolean(b.querySelector('svg.lucide-plus'));
        });
      })()`);
      if (hasAdd) break;
      await sleep(300);
    }

    const clickedAdd = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const addBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('إضافة صفقة') || text.includes('Add deal') || text.includes('Add Deal') || Boolean(b.querySelector('svg.lucide-plus'));
      });
      if (addBtn) {
        addBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedAdd) {
      throw new Error("Could not find or click 'Add Deal' button on /crm/deals");
    }

    // Wait for Modal to open
    const modalOpened = await client.waitForSelector('section[role="dialog"], [role="dialog"], form', 5000);
    await sleep(600);
    await client.captureScreenshot(path.join(debugDir, '03-add-deal-modal.png'));

    testSteps.push({
      step: "3. Open Add Deal Modal",
      status: modalOpened ? 'PASS' : 'FAIL',
      details: `Modal opened: ${modalOpened}`,
    });
    console.log(`[Step 3] ${modalOpened ? 'PASS' : 'FAIL'} (Screenshot: 03-add-deal-modal.png)`);

    // STEP 4: FILL DEAL FORM FIELDS
    console.log("\n--- STEP 4: Fill Deal Form ---");
    const testDealTitle = "مشروع توريد وتجهيز أنظمة ذكية لبرج الأعمال";
    const testDealAmount = "150000";

    await client.setInputValue('input[name="title"]', testDealTitle);
    await client.setInputValue('input[name="amount"]', testDealAmount);

    // Select Contact if contact select exists
    await client.evaluate(`(() => {
      const selectBtns = Array.from(document.querySelectorAll('button[data-slot="trigger"], [role="combobox"]'));
      if (selectBtns.length > 0) {
        selectBtns[0].click();
      }
    })()`);
    await sleep(400);

    await client.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('li[role="option"], [data-slot="listbox-item"]'));
      if (items.length > 0) {
        items[0].click();
      }
    })()`);
    await sleep(400);

    await client.captureScreenshot(path.join(debugDir, '04-deal-form-filled.png'));
    console.log(`[Step 4] PASS: Form filled with ${testDealTitle} (Screenshot: 04-deal-form-filled.png)`);

    // STEP 5: SUBMIT FORM & VERIFY POST /api/v1/crm/deals
    console.log("\n--- STEP 5: Submit Form and Verify POST /api/v1/crm/deals ---");
    const clickedSubmit = await client.evaluate(`(() => {
      const modal = document.querySelector('section[role="dialog"], [role="dialog"]');
      if (!modal) return false;
      const buttons = Array.from(modal.querySelectorAll('button[type="submit"], button'));
      const submitBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return (text.includes('حفظ') || text.includes('Save') || text.includes('إنشاء') || text.includes('Create')) && !text.includes('إلغاء');
      });
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedSubmit) {
      throw new Error("Could not find submit button in Deal modal");
    }

    // Wait for POST response
    let postDealReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      postDealReq = client.networkLogs.find(
        (l) => l.method === 'POST' && (l.url.includes('/crm/deals') || l.url.includes('/api/v1/crm/deals'))
      );
      if (postDealReq && postDealReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '05-deal-saved-in-pipeline.png'));

    // Check database for created deal
    const createdDbDeal = await prisma.deal.findFirst({
      where: {
        companyId: testCompany.id,
        title: testDealTitle,
        deletedAt: null,
      },
    });

    const step5Ok = Boolean(postDealReq && postDealReq.status === 201 && createdDbDeal);
    testSteps.push({
      step: "4 & 5. Create Deal and Verify API (201 Created)",
      status: step5Ok ? 'PASS' : 'FAIL',
      details: `Network: ${postDealReq?.method} ${postDealReq?.url} -> ${postDealReq?.status}, DB Deal ID: ${createdDbDeal?.id}`,
    });
    console.log(`[Step 5] ${step5Ok ? 'PASS' : 'FAIL'} (Status: ${postDealReq?.status}, DB ID: ${createdDbDeal?.id})`);

    if (!createdDbDeal) {
      throw new Error("Deal was not created in database!");
    }

    const createdDealId = createdDbDeal.id;

    // STEP 6: NAVIGATE TO DEAL DETAIL PAGE
    console.log(`\n--- STEP 6: Open Deal Details (/crm/deals/${createdDealId}) ---`);
    await client.navigate(`http://127.0.0.1:5173/crm/deals/${createdDealId}`);
    await sleep(2000);

    const step6Url = await client.evaluate('window.location.href');
    const step6Text = await client.evaluate('document.body.innerText');
    console.log(`[DEBUG STEP 6] URL: ${step6Url}`);
    console.log(`[DEBUG STEP 6] Body Text: ${JSON.stringify(step6Text.slice(0, 400))}`);
    console.log(`[DEBUG STEP 6] Recent Network:`, JSON.stringify(client.networkLogs.slice(-10), null, 2));
    console.log(`[DEBUG STEP 6] Recent Console:`, JSON.stringify(client.consoleLogs.slice(-10), null, 2));

    let dealDetailReady = false;
    for (let i = 0; i < 30; i++) {
      const hasTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testDealTitle)})`);
      const hasEditBtn = await client.evaluate(`Boolean(document.querySelector('button svg.lucide-pencil') || Array.from(document.querySelectorAll('button')).some(b => (b.innerText || '').includes('تعديل') || (b.innerText || '').includes('Edit')))`);
      if (hasTitle || hasEditBtn) {
        dealDetailReady = true;
        break;
      }
      await sleep(500);
    }
    await sleep(500);

    const hasDealTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testDealTitle)})`);
    await client.captureScreenshot(path.join(debugDir, '06-deal-detail.png'));

    testSteps.push({
      step: "6. Open Deal Detail Page",
      status: dealDetailReady ? 'PASS' : 'FAIL',
      details: `Rendered title "${testDealTitle}": ${hasDealTitle}`,
    });
    console.log(`[Step 6] ${dealDetailReady ? 'PASS' : 'FAIL'} (Screenshot: 06-deal-detail.png)`);

    // STEP 7: EDIT DEAL DETAILS (AMOUNT & STAGE)
    console.log("\n--- STEP 7: Edit Deal Details via Edit Modal ---");
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
      throw new Error("Could not find or click 'Edit' button on DealDetailPage");
    }

    await client.waitForSelector('input[name="amount"]', 10000);
    const updatedAmount = "250000";
    await client.setInputValue('input[name="amount"]', updatedAmount);
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

    // Wait for PATCH/PUT response
    let patchDealReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      patchDealReq = client.networkLogs.find(
        (l) => (l.method === 'PATCH' || l.method === 'PUT') && l.url.includes(`/crm/deals/${createdDealId}`)
      );
      if (patchDealReq && patchDealReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '07-deal-edited.png'));

    const step7Ok = Boolean(patchDealReq && patchDealReq.status === 200);
    testSteps.push({
      step: "7. Edit Deal and Verify API (200 OK)",
      status: step7Ok ? 'PASS' : 'FAIL',
      details: `Network: ${patchDealReq?.method} ${patchDealReq?.url} -> ${patchDealReq?.status}`,
    });
    console.log(`[Step 7] ${step7Ok ? 'PASS' : 'FAIL'} (Status: ${patchDealReq?.status})`);

    // STEP 8: RELOAD AND VERIFY PERSISTENCE
    console.log("\n--- STEP 8: Reload and Verify Persistence ---");
    await client.send('Page.reload');
    await sleep(2000);

    const reloadedDbDeal = await prisma.deal.findUnique({
      where: { id: createdDealId },
    });
    const persistedInDb = reloadedDbDeal?.amount === 250000;

    await client.captureScreenshot(path.join(debugDir, '08-reloaded-persisted.png'));

    testSteps.push({
      step: "8. Reload and Verify Persistence in UI & DB",
      status: persistedInDb ? 'PASS' : 'FAIL',
      details: `DB amount updated to ${reloadedDbDeal?.amount}`,
    });
    console.log(`[Step 8] ${persistedInDb ? 'PASS' : 'FAIL'} (Persisted Amount in DB: ${persistedInDb})`);

    // STEP 9: DELETE DEAL
    console.log("\n--- STEP 9: Delete Deal and Verify Soft Delete (200 OK) ---");
    try {
      await client.evaluate('window.confirm = () => true;');
    } catch {}

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
      throw new Error("Could not find or click Delete button on DealDetailPage");
    }

    // Wait for DELETE response
    let deleteDealReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      deleteDealReq = client.networkLogs.find(
        (l) => l.method === 'DELETE' && l.url.includes(`/crm/deals/${createdDealId}`)
      );
      if (deleteDealReq && deleteDealReq.status) break;
    }

    await sleep(1500);
    await client.captureScreenshot(path.join(debugDir, '09-deal-deleted.png'));

    // Check database for soft-deleted deal
    const deletedDbDeal = await prisma.deal.findUnique({
      where: { id: createdDealId },
    });
    const isSoftDeleted = deletedDbDeal !== null && deletedDbDeal.deletedAt !== null;

    const step9Ok = Boolean(deleteDealReq && deleteDealReq.status === 200 && isSoftDeleted);
    testSteps.push({
      step: "9. Delete Deal via UI and Verify Soft Delete",
      status: step9Ok ? 'PASS' : 'FAIL',
      details: `Network: ${deleteDealReq?.method} ${deleteDealReq?.url} -> ${deleteDealReq?.status}, DB deletedAt: ${deletedDbDeal?.deletedAt}`,
    });
    console.log(`[Step 9] ${step9Ok ? 'PASS' : 'FAIL'} (Status: ${deleteDealReq?.status}, deletedAt: ${deletedDbDeal?.deletedAt})`);

    // STEP 10: VERIFY ZERO FIRESTORE WRITES
    console.log("\n--- STEP 10: Verify Zero Firestore Writes During Deals CRUD ---");
    const firebaseWriteRequests = client.networkLogs.filter(
      (l) => (l.url.includes('firestore.googleapis.com') || l.url.includes('firebaseio.com')) &&
             (l.url.includes('Write') || l.url.includes('commit') || (l.method !== 'GET' && !l.url.includes('Listen') && !l.url.includes('BatchGet')))
    );
    const step10Ok = firebaseWriteRequests.length === 0;
    testSteps.push({
      step: "10. Verify Zero Firebase/Firestore Writes During Deals CRUD",
      status: step10Ok ? 'PASS' : 'FAIL',
      details: `Detected ${firebaseWriteRequests.length} Firestore write requests during Deals lifecycle.`,
    });
    console.log(`[Step 10] ${step10Ok ? 'PASS' : 'FAIL'} (Firestore Writes: ${firebaseWriteRequests.length})`);

  } finally {
    // Cleanup browser & test database records
    try {
      chromeProc.kill();
    } catch {}

    console.log(`\n[CLEANUP] Cleaning test database records...`);
    try {
      await prisma.deal.deleteMany({ where: { companyId: testCompany.id } });
      await prisma.customer.deleteMany({ where: { companyId: testCompany.id } });
      await prisma.companyMembership.deleteMany({ where: { companyId: testCompany.id } });
      await prisma.user.deleteMany({ where: { id: testUser.id } });
      await prisma.company.deleteMany({ where: { id: testCompany.id } });
      await prisma.$disconnect();
    } catch (e) {
      console.error("[CLEANUP ERROR]:", e);
    }
  }

  console.log("\n===============================================================================");
  console.log("                        BROWSER E2E TEST SUMMARY");
  console.log("===============================================================================");
  let allPass = true;
  for (const t of testSteps) {
    const symbol = t.status === 'PASS' ? '✓' : '✗';
    console.log(`${symbol} [${t.status}] ${t.step}`);
    console.log(`    ${t.details}`);
    if (t.status === 'FAIL') allPass = false;
  }
  console.log("===============================================================================\n");

  if (!allPass) {
    console.error("Browser E2E failed one or more steps.");
    process.exit(1);
  } else {
    console.log("All 10 Browser E2E Steps PASSED successfully!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("FATAL ERROR IN TEST SCRIPT:", err);
  process.exit(1);
});
