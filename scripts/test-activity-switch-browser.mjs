/**
 * D-Arrow Business — Comprehensive Activity Switch & Multi-Activity Lifecycle E2E
 *
 * Verifies Section 7 of the Master Execution Prompt:
 * 1. Open internal Settings (/settings/company)
 * 2. Select a supported activity (FACILITIES_MANAGEMENT) and save
 * 3. Verify the company record in Firestore and refreshed UI
 * 4. Refresh the browser
 * 5. Verify the selection persists
 * 6. Verify the correct navigation and dashboard
 * 7. Open an inactive activity's route directly (/school/students) -> access is denied
 * 8. Switch to another supported activity (SCHOOL_MANAGEMENT)
 * 9. Verify new module (/school) appears and old activity (/facilities) is denied
 * 10. Verify shared core modules (/projects, /people, /tasks, /billing) remain accessible
 * 11. Verify old records have not been deleted or corrupted
 * 12. Repeat switching through MARKETING_AGENCY and REAL_ESTATE_MANAGEMENT
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_act_switch_${Date.now()}`);
const CDP_PORT = 9781;
const VITE_PORT = 5177;
const PROJECT_ID = "test-activity-switch";
const COMPANY_ID = "acme-dynamic-co";
const ADMIN_EMAIL = "switch_admin@acme.test";
const ADMIN_PASS = "SwitchAdmin2026!";

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/activity-switch-browser";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);
let adminIdToken = "";
let adminUid = "";

function authHdr(token) {
  const h = { "Content-Type": "application/json" };
  const t = token ?? adminIdToken;
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return undefined;
}
function decodeFields(fields) {
  const o = {};
  for (const k in fields) o[k] = decodeValue(fields[k]);
  return o;
}
function encodeValue(val) {
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (val == null) return { nullValue: null };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(encodeValue) } };
  if (typeof val === "object") return { mapValue: { fields: encodeFields(val) } };
  return { stringValue: String(val) };
}
function encodeFields(obj) {
  const f = {};
  for (const k in obj) f[k] = encodeValue(obj[k]);
  return f;
}
async function fsGet(docPath, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, { headers: authHdr(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet ${docPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.fields ? { id: docPath.split("/").pop(), ...decodeFields(j.fields) } : null;
}
async function seedDoc(docPath, obj, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH", headers: authHdr(token), body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seed ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function createAuthUser(email, password) {
  await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }).then((r) => r.json());
  const j = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  if (!j.idToken) throw new Error(`auth user ${email} unusable: ${JSON.stringify(j)}`);
  return j;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

log("=================================================================");
log(" D-Arrow Business — Real Activity Switching Browser Verification");
log("=================================================================\n");

// 1. Vite
log(`Starting test Vite on port ${VITE_PORT}...`);
const viteProc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"], {
  env: {
    ...process.env,
    VITE_USE_FIREBASE_EMULATOR: "true",
    VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
    VITE_FIRESTORE_EMULATOR_PORT: "8080",
    VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  },
  stdio: "pipe",
});
let viteReady = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { if ((await fetch(`http://localhost:${VITE_PORT}/`)).ok) { viteReady = true; break; } } catch {}
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start on port " + VITE_PORT); }
log(`Vite ready: http://localhost:${VITE_PORT}`);

// 2. Edge headless
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-first-run",
  "--no-default-browser-check", "--window-size=1280,900",
  `--user-data-dir=${profileDir}`, "about:blank",
]);

let pageTarget = null;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      pageTarget = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (pageTarget) break;
    }
  } catch {}
}
if (!pageTarget) { edgeProc.kill(); viteProc.kill(); throw new Error("No Edge CDP page target found"); }

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 1;
const pending = new Map();
const consoleBuf = [];
ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
  if (data.method === "Runtime.consoleAPICalled") {
    const txt = (data.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleBuf.push(`[${data.params?.type}] ${txt}`);
  } else if (data.method === "Runtime.exceptionThrown") {
    const d = data.params?.exceptionDetails;
    consoleBuf.push(`[exception] ${d?.exception?.description || d?.text || ""}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

async function js(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res?.result?.result?.value;
}
async function goto(url) { await send("Page.navigate", { url }); await sleep(800); }
async function currentUrl() { return (await js("window.location.href")) || ""; }
async function bodyText() { return (await js(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ')`)) || ""; }

async function shot(name) {
  const scr = await send("Page.captureScreenshot", { format: "png" });
  if (scr?.result?.data) {
    const p = path.join(OUT_DIR, `${name}.png`);
    writeFileSync(p, Buffer.from(scr.result.data, "base64"));
    log(`   📸 ${p}`);
  }
}

await send("Runtime.enable");
await send("Page.enable");
await send("Network.clearBrowserCookies");

const results = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`);
    results.push({ name, ok: true, detail });
  } catch (e) {
    log(`✗ FAIL: ${name} — ${e?.message || e}`);
    results.push({ name, ok: false, error: e?.message || String(e) });
  }
}

try {
  // Step 0: Seed Fixtures
  await step("0. Seed Company and Admin User Fixtures", async () => {
    const authUser = await createAuthUser(ADMIN_EMAIL, ADMIN_PASS);
    adminIdToken = authUser.idToken;
    adminUid = authUser.localId;

    await seedDoc(`companies/${COMPANY_ID}`, {
      id: COMPANY_ID,
      name: "Acme Global Dynamics",
      defaultCurrency: "SAR",
      primaryActivity: "PROJECTS",
    }, adminIdToken);

    await seedDoc(`users/${adminUid}`, {
      email: ADMIN_EMAIL,
      name: "Super Admin",
      companyId: COMPANY_ID,
      role: "admin",
    }, adminIdToken);

    return `admin=${adminUid} initialActivity=PROJECTS`;
  });

  // Step 1: Login via UI
  await step("1. Admin logs into the system via UI", async () => {
    await goto("about:blank");
    await send("Storage.clearDataForOrigin", {
      origin: `http://localhost:${VITE_PORT}`,
      storageTypes: "local_storage,indexed_db,cookies,session_storage",
    });
    await sleep(1000);

    await goto(`http://localhost:${VITE_PORT}/login`);
    await waitUntil(async () => js(`!!document.querySelector('input[name="email"]')`), 120000, "login form mounted");

    // Deterministic English locale (preference set before submit; no reload so
    // the mounted SDK and form state are not torn down mid-login).
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);

    // Mirrors the proven sequence in test-navigation-browser.mjs: one field per
    // evaluate call, then a plain submit click.
    const setField = (sel, v) => js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!(await setField('input[name="email"]', ADMIN_EMAIL))) throw new Error("email input missing");
    if (!(await setField('input[type="password"]', ADMIN_PASS))) throw new Error("password input missing");
    await js(`document.querySelector('button[type="submit"]').click()`);

    try {
      await waitUntil(async () => !(await currentUrl()).includes("/login"), 150000, "post-login redirect");
    } catch (e) {
      // Dump what the page really says so the failure is diagnosable from logs.
      const said = await js(`JSON.stringify(Array.from(document.querySelectorAll('p,[role="alert"],small'))
        .map(x => (x.innerText||'').trim()).filter(Boolean).slice(0,8))`);
      await shot("01-login-failure-dump");
      throw new Error(`login never left /login — page says ${said}`);
    }
    await shot("01-logged-in");
    return `landed on ${await currentUrl()}`;
  });

  // Step 2: Verify Home Page has NO Activity Selector / Wizard
  await step("2. Verify Home Page (/) has NO activity selection wizard or setup prompt", async () => {
    await goto(`http://localhost:${VITE_PORT}/`);
    await sleep(1500);
    const txt = await bodyText();
    // Must NOT contain activity picker options
    if (/Facilities Management/i.test(txt) && /Save activity/i.test(txt)) {
      throw new Error("Home page contains activity selection wizard!");
    }
    await shot("02-clean-home");
    return "home page is clean of configuration wizards";
  });

  // Step 3: Open internal Settings (/settings/company)
  await step("3. Open internal Settings (/settings/company) and verify Activity Card presence", async () => {
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitUntil(async () => {
      const txt = await bodyText();
      return /business activity|النشاط التجاري|general projects|المشاريع العامة/i.test(txt);
    }, 40000, "Business Activity card mounted");
    await shot("03-company-settings-card");
    const txt = await bodyText();
    if (!/general projects|المشاريع العامة/i.test(txt)) throw new Error("Initial activity not displayed as General Projects");
    return "BusinessActivitySettingsCard mounted in CompanySettingsPage";
  });

  // Helper function to switch activity in Settings
  async function selectAndSaveActivity(labelTarget, expectedActivityId, shotName) {
    // Diagnostic: log all buttons currently in DOM
    const initialBtns = await js(`Array.from(document.querySelectorAll('button')).map(b => ({
      text: (b.innerText || '').replace(/\\s+/g, ' ').trim(),
      ariaPressed: b.getAttribute('aria-pressed'),
      type: b.getAttribute('type'),
    }))`);
    log(`   [DEBUG] Buttons before click (${initialBtns.length}):`, JSON.stringify(initialBtns.slice(0, 15)));

    // Scroll card into view and click
    const clicked = await js(`(() => {
      const buttons = Array.from(document.querySelectorAll('button[aria-pressed]'));
      const target = buttons.find(b => (b.innerText || '').toLowerCase().includes(${JSON.stringify(labelTarget.toLowerCase())}));
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    if (!clicked) throw new Error(`Could not click activity button for "${labelTarget}"`);
    await sleep(1000);

    // Diagnostic: log buttons after click
    const afterBtns = await js(`Array.from(document.querySelectorAll('button')).map(b => ({
      text: (b.innerText || '').replace(/\\s+/g, ' ').trim(),
      ariaPressed: b.getAttribute('aria-pressed'),
      type: b.getAttribute('type'),
    }))`);
    log(`   [DEBUG] Buttons after click (${afterBtns.length}):`, JSON.stringify(afterBtns.slice(0, 15)));

    // Click the activation button (which appears once draft is dirty)
    await waitUntil(async () => {
      return js(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const actBtn = btns.find(b => !b.hasAttribute('aria-pressed') && ((b.innerText || '').toLowerCase().includes(${JSON.stringify(labelTarget.toLowerCase())}) || /activate|تفعيل/i.test(b.innerText || '')));
        if (!actBtn) return false;
        actBtn.scrollIntoView({ block: 'center' });
        actBtn.click();
        actBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      })()`);
    }, 20000, `Activation button for ${labelTarget}`);

    // Verify Firestore persistence
    await waitUntil(async () => {
      const doc = await fsGet(`companies/${COMPANY_ID}`, adminIdToken);
      return doc?.primaryActivity === expectedActivityId;
    }, 25000, `Firestore primaryActivity == ${expectedActivityId}`);

    await sleep(1000);
    await shot(shotName);
  }

  // Step 4: Switch to FACILITIES_MANAGEMENT and save
  await step("4. Switch to FACILITIES_MANAGEMENT and verify persistence in Firestore", async () => {
    await selectAndSaveActivity("Facilities Management", "FACILITIES_MANAGEMENT", "04-switched-to-facilities");
    
    // Seed facilities asset now that primaryActivity == FACILITIES_MANAGEMENT (rules allow)
    await seedDoc(`companies/${COMPANY_ID}/fm_assets/asset_001`, {
      id: "asset_001",
      name: "HVAC Chiller Unit A1",
      category: "HVAC",
      status: "operational",
    }, adminIdToken);

    const doc = await fsGet(`companies/${COMPANY_ID}`, adminIdToken);
    return `persisted primaryActivity=${doc?.primaryActivity}`;
  });

  // Step 5: Refresh browser and verify selection persists
  await step("5. Refresh browser and verify selection persists across reload", async () => {
    await send("Page.reload", { ignoreCache: true });
    await sleep(2000);
    await waitUntil(async () => {
      const txt = await bodyText();
      return /business activity|النشاط التجاري|facilities management|إدارة المرافق/i.test(txt);
    }, 30000, "settings reloaded");
    const txt = await bodyText();
    if (!/facilities management|إدارة المرافق/i.test(txt)) {
      throw new Error(`Expected Facilities Management after reload, got: "${txt.slice(0, 300)}"`);
    }
    await shot("05-persisted-after-reload");
    return "persisted across reload";
  });

  // Step 6: Verify Facilities modules are accessible
  await step("6. Verify Facilities module (/facilities/assets) is accessible", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/assets`);
    await sleep(1500);
    const txt = await bodyText();
    const url = await currentUrl();
    if (!url.includes("/facilities/assets")) throw new Error(`Navigated away from /facilities/assets to ${url}`);
    if (txt.includes("Access Restricted") || txt.includes("Module Inactive") || /section not available|القسم غير متاح/i.test(txt)) {
      throw new Error("Active facilities route was denied!");
    }
    await shot("06-facilities-assets-allowed");
    return "facilities routes fully navigable";
  });

  // Step 7: Verify School route is DENIED while on Facilities activity
  await step("7. Inactive activity route (/school/students) is strictly DENIED", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/students`);
    await sleep(2000);
    const denied = await js(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-construction')`);
    const txt = await bodyText();
    const hasDeniedText = /section not available|not enabled for your company|access restricted|القسم غير متاح|غير مفعل/i.test(txt);
    if (!denied && !hasDeniedText) {
      throw new Error("Direct entry to /school/students was not denied for facilities company!");
    }
    await shot("07-school-denied-for-facilities");
    return "inactive activity route successfully denied with shield alert";
  });

  // Step 8: Switch to SCHOOL_MANAGEMENT in Settings
  await step("8. Switch to SCHOOL_MANAGEMENT in Settings and save", async () => {
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitUntil(async () => {
      const txt = await bodyText();
      return /business activity|النشاط التجاري|facilities management|school management/i.test(txt);
    }, 30000, "settings mounted");
    await selectAndSaveActivity("School Management", "SCHOOL_MANAGEMENT", "08-switched-to-school");

    // Seed school student now that primaryActivity == SCHOOL_MANAGEMENT (rules allow)
    await seedDoc(`companies/${COMPANY_ID}/sch_students/student_001`, {
      id: "student_001",
      firstName: "Tariq",
      lastName: "Mansour",
      grade: "Grade 10",
      status: "active",
    }, adminIdToken);

    const doc = await fsGet(`companies/${COMPANY_ID}`, adminIdToken);
    return `primaryActivity=${doc?.primaryActivity}`;
  });

  // Step 9: Verify School is now ALLOWED and Facilities is now DENIED
  await step("9. Verify School (/school/students) is ALLOWED and Facilities (/facilities/assets) is DENIED", async () => {
    // School should now be allowed
    await goto(`http://localhost:${VITE_PORT}/school/students`);
    await sleep(1500);
    const schoolUrl = await currentUrl();
    if (!schoolUrl.includes("/school/students")) throw new Error(`Navigated away from /school/students to ${schoolUrl}`);
    const schoolTxt = await bodyText();
    if (schoolTxt.includes("Access Restricted") || /section not available|القسم غير متاح/i.test(schoolTxt)) {
      throw new Error("School route was denied after switching to school!");
    }
    await shot("09a-school-allowed");

    // Facilities should now be denied
    await goto(`http://localhost:${VITE_PORT}/facilities/assets`);
    await sleep(2000);
    const denied = await js(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-construction')`);
    const facTxt = await bodyText();
    const hasDenied = denied || /section not available|not enabled for your company|access restricted|القسم غير متاح|غير مفعل/i.test(facTxt);
    if (!hasDenied) throw new Error("Old activity route /facilities/assets was not denied!");
    await shot("09b-facilities-now-denied");
    return "school allowed, facilities denied";
  });

  // Step 10: Verify Shared Core Modules remain available
  await step("10. Shared Core Modules (/projects, /people, /tasks, /billing) remain accessible", async () => {
    const coreRoutes = ["/projects", "/people", "/tasks", "/billing/invoices"];
    for (const r of coreRoutes) {
      await goto(`http://localhost:${VITE_PORT}${r}`);
      await sleep(1500);
      const url = await currentUrl();
      if (!url.includes(r)) throw new Error(`Core route ${r} redirected to ${url}`);
      const txt = await bodyText();
      if (txt.includes("Access Restricted") || /section not available|القسم غير متاح/i.test(txt)) {
        throw new Error(`Core route ${r} was restricted!`);
      }
    }
    await shot("10-core-modules-accessible");
    return "all core routes verified accessible";
  });

  // Step 11: Verify previous activity data was NOT deleted or corrupted
  await step("11. Verify historical data integrity (facilities asset & school student preserved)", async () => {
    // Current activity is SCHOOL_MANAGEMENT, so school student is readable
    const student = await fsGet(`companies/${COMPANY_ID}/sch_students/student_001`, adminIdToken);
    if (!student || student.firstName !== "Tariq") {
      throw new Error("School student record was corrupted or deleted during activity switch!");
    }

    // Switch back to FACILITIES_MANAGEMENT to assert fm_assets/asset_001 survived with zero data loss
    await seedDoc(`companies/${COMPANY_ID}`, {
      id: COMPANY_ID,
      name: "Acme Global Dynamics",
      defaultCurrency: "SAR",
      primaryActivity: "FACILITIES_MANAGEMENT",
    }, adminIdToken);

    const asset = await fsGet(`companies/${COMPANY_ID}/fm_assets/asset_001`, adminIdToken);
    if (!asset || asset.name !== "HVAC Chiller Unit A1") {
      throw new Error("Previous facilities asset was corrupted or deleted during activity switch!");
    }

    return `fm_asset="${asset.name}" and sch_student="${student.firstName}" both intact`;
  });

  // Step 12: Switch to MARKETING_AGENCY and REAL_ESTATE_MANAGEMENT
  await step("12. Verify switching through MARKETING_AGENCY and REAL_ESTATE_MANAGEMENT", async () => {
    // Switch to Marketing Agency
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitUntil(async () => {
      const txt = await bodyText();
      return /business activity|النشاط التجاري|primary business activity|facilities management/i.test(txt);
    }, 30000, "settings mounted");
    await selectAndSaveActivity("Marketing Agency", "MARKETING_AGENCY", "12a-marketing-selected");
    
    // Verify Agency route allowed
    await goto(`http://localhost:${VITE_PORT}/agency/campaigns`);
    await sleep(1500);
    const agencyUrl = await currentUrl();
    if (!agencyUrl.includes("/agency/campaigns")) throw new Error(`Agency route not reachable: ${agencyUrl}`);
    await shot("12b-agency-allowed");

    // Switch to Real Estate Management
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitUntil(async () => {
      const txt = await bodyText();
      return /business activity|النشاط التجاري|marketing agency/i.test(txt);
    }, 30000, "settings mounted");
    await selectAndSaveActivity("Real Estate Management", "REAL_ESTATE_MANAGEMENT", "12c-real-estate-selected");

    // Verify Real Estate route allowed
    await goto(`http://localhost:${VITE_PORT}/real-estate/properties`);
    await sleep(1500);
    const remUrl = await currentUrl();
    if (!remUrl.includes("/real-estate/properties")) throw new Error(`Real estate route not reachable: ${remUrl}`);
    await shot("12d-real-estate-allowed");

    return "switched cleanly through Marketing Agency and Real Estate Management";
  });

} catch (e) {
  log(`\n[FATAL] ${e?.message || e}`);
  results.push({ name: "fatal", ok: false, error: String(e?.message || e) });
} finally {
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}

  const failed = results.filter((r) => !r.ok);
  log("\n=================================================================");
  log(` Real Activity Switch Results: ${results.length - failed.length}/${results.length} passed`);
  log("=================================================================");
  for (const f of failed) log(` ✗ ${f.name}: ${f.error}`);
  process.exit(failed.length ? 1 : 0);
}
