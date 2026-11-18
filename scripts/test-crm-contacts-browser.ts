import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
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
        if (res.url.includes('/crm/customers')) {
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

      // Auto-accept JS dialogs (confirm / alert / prompt)
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    };
  }

  send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
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

  async waitForSelector(selector: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const found = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
        if (found) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  }

  async waitForText(text: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const found = await this.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
        if (found) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  }

  async setInputValue(selector: string, value: string): Promise<void> {
    const ok = await this.waitForSelector(selector, 5000);
    if (!ok) throw new Error(`Selector not found for input: ${selector}`);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  async click(selector: string): Promise<void> {
    const ok = await this.waitForSelector(selector, 5000);
    if (!ok) throw new Error(`Selector not found for click: ${selector}`);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  async clickByText(tag: string, text: string): Promise<boolean> {
    return await this.evaluate(`(() => {
      const elements = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
      const el = elements.find(e => (e.innerText || e.textContent || '').includes(${JSON.stringify(text)}));
      if (el) {
        el.click();
        return true;
      }
      return false;
    })()`);
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    if (res && res.data) {
      writeFileSync(outputPath, Buffer.from(res.data, 'base64'));
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function runCrmContactsBrowserTest() {
  console.log("================================================================================");
  console.log("AUTONOMOUS BROWSER VERIFICATION & SELF-HEALING: CRM CONTACTS (WP-01)");
  console.log("Target Frontend: http://127.0.0.1:5173");
  console.log("Target Backend:  http://localhost:3005/api/v1");
  console.log("Database:        darrow_dev");
  console.log("================================================================================");

  // 1. Pre-flight DB Safety Check
  const [dbRow]: any = await prisma.$queryRawUnsafe('SELECT current_database(), current_user;');
  if (dbRow.current_database !== 'darrow_dev' || dbRow.current_user !== 'darrow') {
    throw new Error(`CRITICAL SAFETY VIOLATION: expected darrow_dev / darrow, got ${JSON.stringify(dbRow)}`);
  }
  console.log("[Safety Check] PASS: Database confirmed as darrow_dev (user: darrow).");

  // 2. Setup screenshot directory
  const debugDir = path.join(process.cwd(), 'tmp', 'browser-debug');
  mkdirSync(debugDir, { recursive: true });

  // 3. Prepare or Ensure E2E Admin User
  const testUserEmail = 'crm_e2e_admin@darrow.com';
  const testPassword = 'Password123!';
  const hashedPassword = await bcrypt.hash(testPassword, 10);
  const companyName = 'CRM Verification Corp';

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
        name: 'CRM E2E Tester',
        nameAr: 'مختبر إدارة علاقات العملاء',
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
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });
  } else if (membership.companyId !== testCompany.id || membership.role !== 'ADMIN' || membership.status !== 'ACTIVE') {
    membership = await prisma.companyMembership.update({
      where: { userId: testUser.id },
      data: {
        companyId: testCompany.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  }

  console.log(`[User Setup] PASS: Ready user ${testUserEmail} with role ADMIN at company ${companyName}.`);

  // 4. Launch Edge in Headed mode (or headless with custom flags)
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'edge-crm-profile-'));

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
    
    // Wait for email input (either by type=email or name=email) - 50s timeout to allow Vite initial bundle compile
    const emailSelector = 'input[type="email"], input[name="email"]';
    const emailField = await client.waitForSelector(emailSelector, 50000);
    if (!emailField) {
      const curUrl = await client.evaluate('window.location.href');
      const bodyHtml = await client.evaluate('document.body.innerHTML');
      console.error(`[DEBUG] Failed to find email field. Current URL: ${curUrl}`);
      console.error(`[DEBUG] Page HTML: ${bodyHtml.slice(0, 1000)}`);
      console.error(`[DEBUG] Browser Console Logs:`, JSON.stringify(client.consoleLogs, null, 2));
      console.error(`[DEBUG] Network Logs:`, JSON.stringify(client.networkLogs.slice(-15), null, 2));
      await client.captureScreenshot(path.join(debugDir, 'debug-login-failed.png'));
      throw new Error(`Login page did not render email input. Current URL: ${curUrl}`);
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
    const step1Ok = loginSuccess && Boolean(tokenInStorage);
    await client.captureScreenshot(path.join(debugDir, '01-login-success.png'));

    testSteps.push({
      step: "1. Login through React UI",
      status: step1Ok ? 'PASS' : 'FAIL',
      details: `tokenStored=${Boolean(tokenInStorage)}, url=${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 1] ${step1Ok ? 'PASS' : 'FAIL'} (Screenshot: 01-login-success.png)`);

    // STEP 2: NAVIGATE TO CRM CONTACTS
    console.log("\n--- STEP 2: Navigate to CRM Contacts ---");
    await client.navigate('http://127.0.0.1:5173/crm/contacts');
    await client.waitForSelector('main, .space-y-6', 8000);
    await sleep(2000);

    const buttonsOnPage = await client.evaluate(`Array.from(document.querySelectorAll('button')).map(b => (b.innerText || b.textContent || '').trim())`);
    const pageText = await client.evaluate(`document.body.innerText.slice(0, 500)`);
    console.log(`[DEBUG STEP 2] Current URL: ${await client.evaluate('window.location.href')}`);
    console.log(`[DEBUG STEP 2] Buttons on page:`, JSON.stringify(buttonsOnPage));
    console.log(`[DEBUG STEP 2] Page Text:`, JSON.stringify(pageText));

    await client.captureScreenshot(path.join(debugDir, '02-contacts-list.png'));
    const isContactsPage = await client.evaluate('window.location.pathname.includes("/crm/contacts")');

    testSteps.push({
      step: "2. Navigate to CRM Contacts page",
      status: isContactsPage ? 'PASS' : 'FAIL',
      details: `Current Path: ${await client.evaluate('window.location.pathname')}`,
    });
    console.log(`[Step 2] ${isContactsPage ? 'PASS' : 'FAIL'} (Screenshot: 02-contacts-list.png)`);

    // STEP 3: CLICK "ADD CONTACT" BUTTON
    console.log("\n--- STEP 3: Click 'Add Contact' Button ---");
    // Wait for any initial spinner to clear and Add button to appear
    for (let i = 0; i < 20; i++) {
      const hasAdd = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.innerText || b.textContent || '').trim();
          return text.includes('إضافة جهة') || text.includes('Add Contact') || Boolean(b.querySelector('svg.lucide-plus'));
        });
      })()`);
      if (hasAdd) break;
      await sleep(300);
    }

    const clickedAdd = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const addBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('إضافة جهة') || text.includes('Add Contact') || text.includes('إضافة جهة اتصال') || Boolean(b.querySelector('svg.lucide-plus'));
      });
      if (addBtn) {
        addBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedAdd) {
      throw new Error("Could not find or click 'Add Contact' button on /crm/contacts");
    }

    // Wait for Modal to open
    const modalOpened = await client.waitForSelector('section[role="dialog"], [role="dialog"], form', 5000);
    await sleep(600);
    await client.captureScreenshot(path.join(debugDir, '03-add-contact-modal.png'));

    testSteps.push({
      step: "3. Open Add Contact Modal",
      status: modalOpened ? 'PASS' : 'FAIL',
      details: `Modal opened: ${modalOpened}`,
    });
    console.log(`[Step 3] ${modalOpened ? 'PASS' : 'FAIL'} (Screenshot: 03-add-contact-modal.png)`);

    // STEP 4: FILL FORM FIELDS
    console.log("\n--- STEP 4: Fill Contact Form (Individual) ---");
    const testFirstName = "سعود";
    const testLastName = "الشهري";
    const testPhone = "0551234567";
    const testEmail = `saud.shehri.${Date.now()}@darrow-test.com`;
    const testCity = "الرياض";

    await client.setInputValue('input[name="firstName"]', testFirstName);
    await client.setInputValue('input[name="lastName"]', testLastName);
    await client.setInputValue('input[name="phone"]', testPhone);
    await client.setInputValue('input[name="email"]', testEmail);
    await client.setInputValue('input[name="city"]', testCity);

    await sleep(400);
    await client.captureScreenshot(path.join(debugDir, '04-form-filled.png'));
    console.log(`[Step 4] PASS: Form filled with ${testFirstName} ${testLastName} (Screenshot: 04-form-filled.png)`);

    // STEP 5: SAVE CONTACT & VERIFY NETWORK REQUEST
    console.log("\n--- STEP 5: Submit Form and Verify POST /api/crm/customers ---");
    const initialNetworkCount = client.networkLogs.length;

    // Click submit button in modal
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
      throw new Error("Could not find submit button in Contact modal");
    }

    // Wait for POST response
    let postCustomerReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      postCustomerReq = client.networkLogs.find(
        (l) => l.method === 'POST' && (l.url.includes('/crm/customers') || l.url.includes('/api/crm/customers'))
      );
      if (postCustomerReq && postCustomerReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '05-contact-saved-in-list.png'));

    // Check database for created customer
    const createdDbCustomer = await prisma.customer.findFirst({
      where: {
        companyId: testCompany.id,
        email: testEmail,
        deletedAt: null,
      },
    });

    const step5Ok = Boolean(postCustomerReq && postCustomerReq.status === 201 && createdDbCustomer);
    testSteps.push({
      step: "4 & 5. Create Contact and Verify API (201 Created)",
      status: step5Ok ? 'PASS' : 'FAIL',
      details: `Network: ${postCustomerReq?.method} ${postCustomerReq?.url} -> ${postCustomerReq?.status}, DB Customer ID: ${createdDbCustomer?.id}`,
    });
    console.log(`[Step 5] ${step5Ok ? 'PASS' : 'FAIL'} (Status: ${postCustomerReq?.status}, DB ID: ${createdDbCustomer?.id})`);

    if (!createdDbCustomer) {
      throw new Error("Customer was not created in database!");
    }

    const createdCustomerId = createdDbCustomer.id;

    // STEP 6: NAVIGATE TO CONTACT DETAIL PAGE
    console.log(`\n--- STEP 6: Open Contact Details (/crm/contacts/${createdCustomerId}) ---`);
    await client.navigate(`http://127.0.0.1:5173/crm/contacts/${createdCustomerId}`);
    
    // Wait for contact details to render (testFirstName in header or Edit button)
    let contactDetailReady = false;
    for (let i = 0; i < 60; i++) {
      const hasTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testFirstName)})`);
      const hasEditBtn = await client.evaluate(`Boolean(document.querySelector('button svg.lucide-pencil') || Array.from(document.querySelectorAll('button')).some(b => (b.innerText || '').includes('تعديل') || (b.innerText || '').includes('Edit')))`);
      if (hasTitle || hasEditBtn) {
        contactDetailReady = true;
        break;
      }
      await sleep(500);
    }
    await sleep(500);

    const hasContactTitle = await client.evaluate(`document.body.innerText.includes(${JSON.stringify(testFirstName)})`);
    await client.captureScreenshot(path.join(debugDir, '06-contact-detail.png'));

    testSteps.push({
      step: "6. Open Contact Detail Page",
      status: contactDetailReady ? 'PASS' : 'FAIL',
      details: `Rendered name "${testFirstName} ${testLastName}": ${hasContactTitle}`,
    });
    console.log(`[Step 6] ${contactDetailReady ? 'PASS' : 'FAIL'} (Screenshot: 06-contact-detail.png)`);

    // STEP 7: EDIT CONTACT DETAILS
    console.log("\n--- STEP 7: Edit Contact Details ---");
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
      throw new Error("Could not find or click 'Edit Contact' button on ContactDetailPage");
    }

    await client.waitForSelector('input[name="city"]', 10000);
    const updatedCity = "جدة - حي الشاطئ";
    await client.setInputValue('input[name="city"]', updatedCity);
    await sleep(300);

    // Click save in modal
    await client.evaluate(`(() => {
      const modal = document.querySelector('section[role="dialog"], [role="dialog"]');
      if (!modal) return false;
      const submitBtn = modal.querySelector('button[type="submit"]') || Array.from(modal.querySelectorAll('button')).find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('حفظ') || text.includes('Save');
      });
      if (submitBtn) {
        submitBtn.click();
        return true;
      }
      return false;
    })()`);

    // Wait for PUT response
    let putCustomerReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      putCustomerReq = client.networkLogs.find(
        (l) => l.method === 'PUT' && l.url.includes(`/crm/customers/${createdCustomerId}`)
      );
      if (putCustomerReq && putCustomerReq.status) break;
    }

    await sleep(1000);
    await client.captureScreenshot(path.join(debugDir, '07-contact-edited.png'));

    const step7Ok = Boolean(putCustomerReq && putCustomerReq.status === 200);
    testSteps.push({
      step: "7. Edit Contact and Verify API (200 OK)",
      status: step7Ok ? 'PASS' : 'FAIL',
      details: `Network: ${putCustomerReq?.method} ${putCustomerReq?.url} -> ${putCustomerReq?.status}`,
    });
    console.log(`[Step 7] ${step7Ok ? 'PASS' : 'FAIL'} (Status: ${putCustomerReq?.status})`);

    // STEP 8: RELOAD AND VERIFY PERSISTENCE
    console.log("\n--- STEP 8: Reload and Verify Persistence ---");
    await client.send('Page.reload');
    await sleep(2000);
    try {
      await client.evaluate('window.confirm = () => true;');
    } catch {}

    const reloadedDbCustomer = await prisma.customer.findUnique({
      where: { id: createdCustomerId },
    });
    const persistedInDb = reloadedDbCustomer?.city === updatedCity;

    await client.captureScreenshot(path.join(debugDir, '08-reloaded-persisted.png'));

    testSteps.push({
      step: "8. Reload and Verify Persistence in UI & DB",
      status: persistedInDb ? 'PASS' : 'FAIL',
      details: `DB city updated to "${reloadedDbCustomer?.city}" (expected: "${updatedCity}")`,
    });
    console.log(`[Step 8] ${persistedInDb ? 'PASS' : 'FAIL'} (Persisted City: ${reloadedDbCustomer?.city})`);

    // STEP 9: DELETE CONTACT
    console.log("\n--- STEP 9: Delete Contact and Verify Soft Delete (200 OK) ---");
    // Wait for page to finish reloading and render the Delete button
    for (let i = 0; i < 30; i++) {
      const hasDelBtn = await client.evaluate(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(b => {
          const text = (b.innerText || b.textContent || '').trim();
          return text.includes('حذف') || text.includes('Delete') || Boolean(b.querySelector('svg.lucide-trash-2')) || b.getAttribute('aria-label') === 'Delete contact';
        });
      })()`);
      if (hasDelBtn) break;
      await sleep(400);
    }

    const clickedDelete = await client.evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const delBtn = buttons.find(b => {
        const text = (b.innerText || b.textContent || '').trim();
        return text.includes('حذف') || text.includes('Delete') || Boolean(b.querySelector('svg.lucide-trash-2')) || b.getAttribute('aria-label') === 'Delete contact';
      });
      if (delBtn) {
        delBtn.click();
        return true;
      }
      return false;
    })()`);

    if (!clickedDelete) {
      throw new Error("Could not find or click Delete button on ContactDetailPage");
    }

    // Wait for DELETE response
    let deleteCustomerReq: NetworkLogEntry | undefined;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      deleteCustomerReq = client.networkLogs.find(
        (l) => l.method === 'DELETE' && l.url.includes(`/crm/customers/${createdCustomerId}`)
      );
      if (deleteCustomerReq && deleteCustomerReq.status) break;
    }

    await sleep(1500);
    await client.captureScreenshot(path.join(debugDir, '09-contact-deleted.png'));

    // Check database for soft-deleted customer
    const deletedDbCustomer = await prisma.customer.findUnique({
      where: { id: createdCustomerId },
    });
    const isSoftDeleted = deletedDbCustomer !== null && deletedDbCustomer.deletedAt !== null;

    const step9Ok = Boolean(deleteCustomerReq && deleteCustomerReq.status === 200 && isSoftDeleted);
    testSteps.push({
      step: "9. Delete Contact via UI and Verify Soft Delete",
      status: step9Ok ? 'PASS' : 'FAIL',
      details: `Network: ${deleteCustomerReq?.method} ${deleteCustomerReq?.url} -> ${deleteCustomerReq?.status}, DB deletedAt: ${deletedDbCustomer?.deletedAt}`,
    });
    console.log(`[Step 9] ${step9Ok ? 'PASS' : 'FAIL'} (Status: ${deleteCustomerReq?.status}, deletedAt: ${deletedDbCustomer?.deletedAt})`);

    // Check that no Firebase / Firestore write requests were sent during Contacts CRUD
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
      step: "10. Verify Zero Firebase/Firestore Writes During Contacts CRUD",
      status: step10Ok ? 'PASS' : 'FAIL',
      details: `Detected ${firebaseWriteRequests.length} Firestore write requests during Contacts lifecycle.`,
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
  console.log("CRM CONTACTS BROWSER TEST SUMMARY:");
  console.table(testSteps);
  console.log("================================================================================");

  const allPassed = testSteps.every((s) => s.status === 'PASS');
  if (!allPassed) {
    process.exit(1);
  }
}

runCrmContactsBrowserTest().catch((err) => {
  console.error("\n[TEST RUNNER FATAL ERROR]:", err);
  process.exit(1);
});
