/**
 * D-Arrow Business — Facilities Management Browser E2E (Edge headless / CDP)
 *
 * Drives the REAL UI against local Auth + Firestore emulators:
 * admin login -> /facilities blocked BEFORE the activity is selected (fail
 * closed) -> FACILITIES_MANAGEMENT chosen through the real settings card
 * -> facility -> asset linked to it -> work order linked to the asset
 * (code WO-0001 allocated by the settings/facilities transaction WRITE,
 * enforced by the real security rules) -> guarded transition machine
 * (no skip edges; assigned -> in progress -> completion behind the required
 * note + final parts/labor costs; history + derived total verified against
 * persisted state) -> derived reports -> overdue preventive schedule raises
 * a work order idempotently per business day, and completion rolls the
 * schedule forward -> cross-tenant and non-admin denials against the real
 * rules -> deactivating the activity blocks both UI and data while records
 * survive reactivation -> shared CRM/billing modules keep working and the
 * PROJECTS namespace stays correctly denied under Facilities.
 *
 * All mutations go through UI interaction; the emulator REST API is used
 * only for fixture seeding and READ-ONLY verification of persisted state
 * (plus the two explicit authorization probes in steps 12-13).
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_facilities_${Date.now()}`);
const CDP_PORT = 9781;
const VITE_PORT = 5178;
const PROJECT_ID = "test-facilities-lifecycle";
const COMPANY_ID = "fm-co";
const OTHER_COMPANY_ID = "other-co";
const ADMIN_EMAIL = "fm_admin@fm.test";
const ADMIN_PASS = "FmAdmin2026!";
const EMP_EMAIL = "fm_emp@fm.test";
const OUTSIDER_EMAIL = "fm_outsider@other.test";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/facilities-lifecycle";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);
let adminIdToken = "";

// ---------- Firestore REST helpers (admin token unless overridden) ----------
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
  if ("timestampValue" in v) return v.timestampValue;
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
  if (val instanceof Date) return { timestampValue: val.toISOString() };
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
  if (!j.fields) return null;
  return { id: docPath.split("/").pop(), ...decodeFields(j.fields) };
}
async function fsGetStatus(docPath, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, { headers: authHdr(token) });
  return res.status;
}
async function fsList(collectionPath, token) {
  const res = await fetch(`${FS_BASE}/${collectionPath}?pageSize=500`, { headers: authHdr(token) });
  if (!res.ok) throw new Error(`fsList ${collectionPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) }));
}
async function fsPatch(docPath, obj, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH", headers: authHdr(token), body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  return res.status;
}
async function seedDoc(docPath, obj) {
  const status = await fsPatch(docPath, obj);
  if (status >= 400) throw new Error(`seed PATCH ${docPath}: ${status}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const isoDate = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };

// ---------- 1. Vite (isolated, emulator-backed) ----------
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
try {
  await waitUntil(async () => (await fetch(`http://localhost:${VITE_PORT}/`)).ok, 60000, "Vite ready");
} catch (e) { viteProc.kill(); throw e; }
log(`Vite ready: http://localhost:${VITE_PORT}`);

// ---------- 2. Edge headless ----------
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,900",
  `--user-data-dir=${profileDir}`, "about:blank",
]);
let pageTarget = null;
for (let i = 0; i < 20 && !pageTarget; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      pageTarget = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
    }
  } catch {}
}
if (!pageTarget) { edgeProc.kill(); viteProc.kill(); throw new Error("No Edge CDP page target"); }

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
async function waitFor(expr, timeoutMs = 20000, label = expr.slice(0, 60)) {
  await waitUntil(() => js(`!!(${expr})`), timeoutMs, label);
  return true;
}
await send("Runtime.enable");
await send("Page.enable");
await send("Network.clearBrowserCookies");

async function shot(name) {
  const scr = await send("Page.captureScreenshot", { format: "png" });
  if (scr?.result?.data) {
    const p = path.join(OUT_DIR, `${name}.png`);
    writeFileSync(p, Buffer.from(scr.result.data, "base64"));
    log(`   📸 ${p}`);
  }
}
async function goto(url) { await send("Page.navigate", { url }); await sleep(800); }
async function currentUrl() { return (await js("window.location.href")) || ""; }

// ---------- UI primitives (HeroUI-aware; same helpers as the projects harness) ----------
async function setLabeled(labelText, value) {
  return js(`(() => {
    const want = ${JSON.stringify(labelText)}.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label'));
    const lab = labels.find(l => (l.innerText || '').trim().toLowerCase().includes(want));
    if (!lab) return false;
    let scope = lab.parentElement;
    let inp = null;
    for (let i = 0; i < 4 && scope && !inp; i++) {
      inp = scope.querySelector('input:not([type=hidden]), textarea');
      if (!inp) scope = scope.parentElement;
    }
    if (!inp) return false;
    const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, ${JSON.stringify(String(value))});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}
async function clickText(what, candidates, { within } = {}) {
  return js(`(() => {
    const cands = ${JSON.stringify(candidates)}.map(s => s.toLowerCase());
    const scope = ${within ? `Array.from(document.querySelectorAll(${JSON.stringify(within)}))` : "null"};
    const pool = scope
      ? scope.flatMap(s => Array.from(s.querySelectorAll('${what}')))
      : Array.from(document.querySelectorAll('${what}, [role="option"]'));
    const el = pool.find(e => { const t = (e.innerText || e.textContent || '').trim().toLowerCase();
      return t && cands.some(c => t === c || t.includes(c)); });
    if (!el) return false;
    el.click(); return true;
  })()`);
}
async function selectOption(labelText, optionText) {
  const want = String(labelText).toLowerCase();
  const opened = await js(`(() => {
    const want = ${JSON.stringify(want)};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]'));
    const labelFor = (el) => {
      const lb = el.getAttribute && el.getAttribute('aria-labelledby');
      if (lb) {
        const refs = lb.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean);
        const asLabel = refs.find((r) => r.tagName === 'LABEL' || r.closest('label'));
        if (asLabel && norm(asLabel.innerText)) return norm(asLabel.innerText);
      }
      const own = el.getAttribute && el.getAttribute('aria-label');
      if (own && norm(own)) return norm(own);
      let n = el.parentElement;
      for (let i = 0; i < 6 && n; i++) {
        const direct = Array.from(n.children).filter((c) => c.tagName === 'LABEL');
        if (direct.length) return norm(direct[0].innerText);
        n = n.parentElement;
      }
      return '';
    };
    const trig = combos.find((c) => labelFor(c) === want) || combos.find((c) => labelFor(c).includes(want));
    if (!trig) return false;
    trig.setAttribute('data-e2e-open', '1');
    trig.click(); return true;
  })()`);
  if (!opened) {
    const opts = await js(`JSON.stringify(Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).map(el => (el.getAttribute('aria-labelledby')||'') + '|' + (el.innerText||'').slice(0,30)))`).catch(() => "?");
    log(`   [selectDiag:${labelText}] no trigger matched. combos=${opts}`);
    return false;
  }
  const chosen = await waitUntil(
    () => clickText('li, [role="option"]', [optionText]),
    8000,
    `option "${optionText}" for "${labelText}"`
  ).catch(() => false);
  if (chosen) return true;
  await js(`(() => { const t = document.querySelector('[data-e2e-open]'); if (t) t.click(); return true; })()`).catch(() => {});
  return false;
}
async function bodyText() {
  return (await js(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ')`)) || "";
}
async function dump(tag) {
  try {
    const url = await currentUrl();
    const text = ((await bodyText()) || "").slice(0, 400);
    log(`   [dump:${tag}] url=${url} body="${text}"`);
    log(`   [dump:${tag}:console] ${JSON.stringify(consoleBuf.slice(-15))}`);
    await shot(`dump-${tag}`);
  } catch (e) { log(`   [dump:${tag}] failed: ${e?.message}`); }
}
async function clickButton(candidates) { return clickText("button, a", candidates); }
// Trusted CDP mouse press on the first button whose text contains `needle`
// (React-Aria press synthesis needs real pointer events in some spots —
// same technique the projects harness needed for card clicks).
async function pressButton(needle) {
  const found = await js(`(() => {
    const want = ${JSON.stringify(needle.toLowerCase())};
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim().toLowerCase().includes(want));
    if (!b) return false;
    b.scrollIntoView({ block: 'center' });
    b.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
  if (!found) return false;
  await sleep(300);
  const pt = await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  if (!pt) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (b) b.removeAttribute('data-e2e-press'); return true; })()`).catch(() => {});
  return true;
}
// Press + verify: trusted click first, dispatched DOM click as the fallback.
async function pressButtonUntil(needle, checkExpr, timeoutMs = 20000) {
  if (!(await pressButton(needle))) throw new Error(`button "${needle}" not found`);
  try { await waitUntil(() => js(checkExpr), timeoutMs, `"${needle}" effect`); return; } catch {}
  await clickText("button", [needle]);
  await waitUntil(() => js(checkExpr), timeoutMs, `"${needle}" effect after DOM click`);
}
async function clickRowButton(rowText, btnCandidates) {
  return js(`(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const row = rows.find(r => (r.innerText || '').includes(${JSON.stringify(rowText)}));
    if (!row) return false;
    const cands = ${JSON.stringify(btnCandidates)}.map(s => s.toLowerCase());
    const btn = Array.from(row.querySelectorAll('button')).find(b => cands.some(c => (b.innerText || '').trim().toLowerCase().includes(c)));
    if (!btn) return false;
    btn.click(); return true;
  })()`);
}
/** Dialog-scoped: is the button with this exact-ish label disabled? */
async function dialogButtonState(label) {
  return js(`(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return "no-dialog";
    const b = Array.from(d.querySelectorAll('button')).find(x => (x.innerText||'').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (!b) return "no-button";
    return (b.disabled || b.getAttribute('aria-disabled') === 'true') ? "disabled" : "enabled";
  })()`);
}

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); await dump(`fail-${results.length}`); }
}

let facilityId = "";
let assetId = "";
let woId = "";
let schedId = "";
let wo2Id = "";
let empToken = "";
let outsiderToken = "";

try {
  // ---------- Step 0: auth + fixtures ----------
  await step("0. Seed admin/employee/outsider, company (no activity yet), CRM + billing fixtures", async () => {
    // Rules constraint: a users doc may only be CREATED by its own uid
    // (`request.auth.uid == userId`), so every account self-seeds its profile
    // with its own token — exactly what the app's signup flow does.
    const createAccount = async (email, name, companyId, role) => {
      const su = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: ADMIN_PASS, returnSecureToken: true }),
      })).json();
      if (!su.localId) throw new Error(`signUp failed for ${email}: ${JSON.stringify(su)}`);
      const st = await fsPatch(`users/${su.localId}`, { email, name, companyId, role }, su.idToken);
      if (st >= 400) throw new Error(`self-seed users doc for ${email}: ${st}`);
      return su;
    };
    const admin = await createAccount(ADMIN_EMAIL, "FM Admin", COMPANY_ID, "admin");
    adminIdToken = admin.idToken;
    const emp = await createAccount(EMP_EMAIL, "FM Employee", COMPANY_ID, "employee");
    const outsider = await createAccount(OUTSIDER_EMAIL, "Other Co Admin", OTHER_COMPANY_ID, "admin");
    empToken = emp.idToken;
    outsiderToken = outsider.idToken;

    // NO primaryActivity yet -> the fail-closed pre-activation probe is meaningful.
    await seedDoc(`companies/${COMPANY_ID}`, { id: COMPANY_ID, name: "Falcon Facilities Co", defaultCurrency: "SAR" });
    await seedDoc(`companies/${OTHER_COMPANY_ID}`, { id: OTHER_COMPANY_ID, name: "Other Co", defaultCurrency: "SAR" });
    // Shared-module fixtures (regression probes later).
    await seedDoc(`companies/${COMPANY_ID}/contacts/ct_fm`, {
      id: "ct_fm", firstName: "Globex", lastName: "Trading", company: "Globex Trading",
      type: "customer", email: "ops@globex.test", createdAt: new Date().toISOString(),
    });
    await seedDoc(`companies/${COMPANY_ID}/invoices/inv_fm_shared`, {
      id: "inv_fm_shared", invoiceNumber: "FM-SHARED-0001", status: "sent", subTotal: 1000,
      totalTax: 150, grandTotal: 1150, amountPaid: 0, currency: "SAR",
      issueDate: new Date().toISOString(),
      // The real service stores dueDate as a Timestamp; the page renders it
      // with toLocaleDateString(), so seed the same shape, not a bare string.
      dueDate: new Date("2026-12-31T00:00:00Z"),
      createdAt: new Date().toISOString(),
    });
    return `admin=${admin.localId.slice(0, 8)}… tokens ready`;
  });

  // ---------- Step 1: login through the UI ----------
  await step("1. Admin login via UI", async () => {
    await goto(`http://localhost:${VITE_PORT}/login`);
    await waitFor(`document.querySelector('input[name="email"]')`, 120000, "login form");
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(`document.querySelector('input[name="email"]')`, 90000, "login form (english pinned)");
    // The inputs exist in the very first paint, but React's controlled state
    // may not have attached yet — inject, click, and retry until the page
    // actually navigates away from /login.
    let loggedIn = false;
    for (let attempt = 0; attempt < 4 && !loggedIn; attempt++) {
      await js(`(() => {
        const set = (sel, v) => { const el = document.querySelector(sel);
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('input[name="email"]', ${JSON.stringify(ADMIN_EMAIL)});
        set('input[type="password"]', ${JSON.stringify(ADMIN_PASS)});
      })()`);
      await sleep(600 + attempt * 900);
      await clickButton(["sign in", "login"]);
      loggedIn = await waitUntil(async () => !(await currentUrl()).includes("/login"), 15000, `post-login redirect (attempt ${attempt + 1})`).then(() => true).catch(() => false);
      if (!loggedIn) { await dump(`login-retry-${attempt}`); await send("Page.reload", { ignoreCache: true }); await waitFor(`document.querySelector('input[name="email"]')`, 60000, "login form again"); }
    }
    if (!loggedIn) throw new Error("login never completed after 4 attempts");
    await shot("01-logged-in");
    return `url=${await currentUrl()}`;
  });

  // ---------- Step 2: fail-closed before the activity is selected ----------
  await step("2. /facilities blocked before FACILITIES_MANAGEMENT is the tenant activity", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 30000, "activity denial card");
    const st = await fsGetStatus(`companies/${COMPANY_ID}/fm_work_orders/probe-none`, outsiderToken);
    if (st !== 400 && st !== 403 && st !== 404) throw new Error(`unexpected outsider probe status ${st}`);
    await shot("02-denied-before-activation");
    return `guard denied direct URL (REST outsider probe status=${st})`;
  });

  // ---------- Step 3: switch the activity through the real settings card ----------
  await step("3. Select FACILITIES_MANAGEMENT via the settings UI (persisted on the company doc)", async () => {
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitFor(`(document.body.innerText || '').includes('Primary business activity')`, 60000, "activity settings card");
    if (!(await clickText("button", ["facilities management"]))) throw new Error("activity option not found");
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /activate/i.test(b.innerText || ''))`, 15000, "activate button");
    if (!(await clickButton(["activate"]))) throw new Error("activate button not clicked");
    await waitUntil(async () => {
      const c = await fsGet(`companies/${COMPANY_ID}`);
      return c && c.primaryActivity === "FACILITIES_MANAGEMENT";
    }, 30000, "primaryActivity persisted");
    await shot("03-activity-set");
    return "company doc now owns FACILITIES_MANAGEMENT";
  });

  // ---------- Step 4: the module actually renders ----------
  await step("4. Facilities dashboard renders under the active activity", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities`);
    await waitUntil(async () => (await bodyText()).includes("Facilities Dashboard"), 60000, "dashboard");
    await shot("04-dashboard");
    return "dashboard visible";
  });

  // ---------- Step 5: create a facility ----------
  await step("5. Create facility via UI -> persisted in fm_facilities", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/facilities`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim() === 'New')`, 90000, "New button");
    if (!(await clickText("button", ["New"]))) throw new Error("New not clicked");
    await waitFor(`document.querySelector('[role="dialog"]')`, 15000, "facility modal");
    if (!(await setLabeled("Name", "Al Hamra Tower"))) throw new Error("name not filled");
    await setLabeled("Location", "Riyadh");
    await setLabeled("Area", "5200");
    await shot("05-facility-form");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save not clicked");
    await waitUntil(async () => (await bodyText()).includes("Al Hamra Tower"), 30000, "facility row");
    const docs = await fsList(`companies/${COMPANY_ID}/fm_facilities`);
    const f = docs.find((d) => d.name === "Al Hamra Tower");
    if (!f) throw new Error("facility doc not persisted");
    facilityId = f.id;
    if (f.area !== 5200 || f.location !== "Riyadh") throw new Error(`facility fields wrong: area=${f.area} loc=${f.location}`);
    return `facilityId=${facilityId}`;
  });

  // ---------- Step 6: create an asset linked to the facility ----------
  await step("6. Create asset via UI -> persisted in fm_assets with facilityId link", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/assets`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim() === 'New')`, 90000, "New button");
    if (!(await clickText("button", ["New"]))) throw new Error("New not clicked");
    await waitFor(`document.querySelector('[role="dialog"]')`, 15000, "asset modal");
    if (!(await setLabeled("Asset Tag", "HVAC-01"))) throw new Error("tag not filled");
    if (!(await setLabeled("Name", "Chiller Unit 1"))) throw new Error("name not filled");
    if (!(await selectOption("Category", "HVAC"))) throw new Error("category select failed");
    if (!(await selectOption("Facility", "Al Hamra Tower"))) throw new Error("facility select failed");
    await setLabeled("Purchase Cost", "18000");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save not clicked");
    await waitUntil(async () => (await bodyText()).includes("HVAC-01"), 30000, "asset row");
    const docs = await fsList(`companies/${COMPANY_ID}/fm_assets`);
    const a = docs.find((d) => d.tag === "HVAC-01");
    if (!a) throw new Error("asset doc not persisted");
    assetId = a.id;
    if (a.facilityId !== facilityId) throw new Error(`asset facilityId link wrong: ${a.facilityId}`);
    if (a.purchaseCost !== 18000) throw new Error(`purchase cost not normalized: ${a.purchaseCost}`);
    return `assetId=${assetId} linked to ${facilityId}`;
  });

  // ---------- Step 7: create a work order (transactional code + settings write under real rules) ----------
  await step("7. Create work order via UI -> WO-0001 + settings/facilities sequence written under real rules", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/work-orders`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim() === 'New')`, 90000, "New button");
    if (!(await clickText("button", ["New"]))) throw new Error("New not clicked");
    await waitFor(`document.querySelector('[role="dialog"]')`, 15000, "WO modal");
    if (!(await setLabeled("Title", "Chiller noisy vibration"))) throw new Error("title not filled");
    await setLabeled("Due Date", daysFromNow(2));
    if (!(await selectOption("Priority", "High"))) throw new Error("priority select failed");
    if (!(await selectOption("Asset", "HVAC-01"))) throw new Error("asset select failed");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save not clicked");
    await waitUntil(async () => (await bodyText()).includes("WO-0001"), 30000, "WO code in list");
    const docs = await fsList(`companies/${COMPANY_ID}/fm_work_orders`);
    const w = docs.find((d) => d.code === "WO-0001");
    if (!w) throw new Error("work order doc not persisted");
    woId = w.id;
    if (w.status !== "requested") throw new Error(`new WO must start at requested, got ${w.status}`);
    if (w.assetId !== assetId) throw new Error("WO asset link wrong");
    if (w.priority !== "high") throw new Error(`WO priority not persisted: ${w.priority}`);
    // The transactional counter lands in settings/facilities via a real rules-gated write.
    const s = await fsGet(`companies/${COMPANY_ID}/settings/facilities`);
    if (!s || !s.woSequence || s.woSequence.nextNumber !== 2) {
      throw new Error(`settings/facilities sequence not advanced: ${JSON.stringify(s?.woSequence)}`);
    }
    await shot("07-wo-created");
    return `woId=${woId} seq.nextNumber=2 (transaction write accepted by rules)`;
  });

  // ---------- Step 8: the transition machine as the user sees it ----------
  await step("8. Requested state exposes ONLY assigned/cancelled edges (no skip-to-completed)", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/work-orders/${woId}`);
    await waitFor(`(document.body.innerText || '').includes('Chiller noisy vibration')`, 40000, "WO detail");
    const txt = await bodyText();
    if (!/Move to Assigned/i.test(txt)) throw new Error("assigned edge not offered");
    if (!/Move to Cancelled/i.test(txt)) throw new Error("cancelled edge not offered");
    if (/Move to Completed/i.test(txt)) throw new Error("SKIP EDGE requested->completed exposed!");
    if (/Move to In Progress/i.test(txt)) throw new Error("SKIP EDGE requested->in_progress exposed!");
    // Walk the legal path (trusted mouse presses).
    await pressButtonUntil("Move to Assigned", `document.body.innerText.includes('Move to In Progress')`, 30000);
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${woId}`))?.status === "assigned", 5000, "assigned persisted");
    await pressButtonUntil("Move to In Progress", `(document.body.innerText || '').includes('Move to Completed')`, 30000);
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${woId}`);
      return d?.status === "in_progress" && (d.statusHistory || []).length === 2;
    }, 30000, "in_progress + 2 history entries");
    await shot("08-in-progress");
    return "history=2, only legal edges ever rendered";
  });

  // ---------- Step 9: completion behind the mandatory note ----------
  await step("9. Complete requires a note; final costs persist; history + derived total correct", async () => {
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /move to completed/i.test(b.innerText || ''))`, 30000, "complete edge");
    await pressButtonUntil("Move to Completed", `!!(document.querySelector('[role="dialog"] textarea'))`, 20000);
    await waitFor(`document.querySelector('[role="dialog"] textarea')`, 15000, "completion modal note");
    const stEmpty = await dialogButtonState("Complete");
    if (stEmpty !== "disabled") throw new Error(`confirm must be disabled with an empty note, got ${stEmpty}`);
    if (!(await setLabeled("Completion Note", "Replaced compressor mount bolts and topped up refrigerant"))) throw new Error("note not filled");
    await setLabeled("Parts Cost", "250.5");
    await setLabeled("Labor Cost", "400");
    if ((await dialogButtonState("Complete")) !== "enabled") throw new Error("confirm still disabled with a note");
    await shot("09-completion-modal");
    if (!(await clickText("button", ["Complete"], { within: '[role="dialog"]' }))) throw new Error("confirm not clicked");
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${woId}`);
      return d && d.status === "completed" && d.partsCost === 250.5 && d.laborCost === 400
        && (d.statusHistory || []).length === 3 && d.completedAt && !!d.completionNote;
    }, 30000, "completed persisted with costs/history/timestamp");
    const d = await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${woId}`);
    if (!/Replaced compressor mount/.test(String(d.completionNote))) throw new Error("completion note not stored");
    const last = (d.statusHistory || [])[2];
    if (last?.from !== "in_progress" || last?.to !== "completed") throw new Error(`last history edge wrong: ${last?.from}->${last?.to}`);
    if (!last?.by) throw new Error("history entry missing actor stamp");
    await waitUntil(async () => (await bodyText()).includes("650.5"), 30000, "derived total 650.5 in UI");
    const txt = await bodyText();
    if (!txt.includes("250.5") || !txt.includes("400")) throw new Error("cost buckets not rendered");
    if (!/Costs were finalized at completion/.test(txt)) throw new Error("frozen-costs notice missing");
    if (/Move to (Assigned|In Progress|On Hold|Completed|Cancelled)/i.test(txt)) throw new Error("terminal state still offers transitions!");
    await shot("09-completed");
    return "total 650.50 derived from stored buckets; state terminal";
  });

  // ---------- Step 10: reports derive only from persisted data ----------
  await step("10. Reports render backlog + cost-by-month from stored records", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/reports`);
    await waitUntil(async () => (await bodyText()).includes("Maintenance Cost by Month"), 40000, "reports cards");
    const txt = await bodyText();
    for (const needle of ["Open Backlog by Status", "Spend by Asset Category", "Asset Condition Summary", "250.5", "400", "650.5"]) {
      if (!txt.includes(needle)) throw new Error(`reports missing "${needle}"`);
    }
    if (!txt.includes("HVAC")) throw new Error("category spend row not attributed to HVAC");
    await shot("10-reports");
    return "monthly parts/labor/total + category attribution visible";
  });

  // ---------- Step 11: preventive schedule raises an idempotent work order ----------
  await step("11. Overdue schedule -> Generate Work Order -> WO-0002; second click is idempotent", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/schedules`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim() === 'New')`, 90000, "New button");
    if (!(await clickText("button", ["New"]))) throw new Error("New not clicked");
    await waitFor(`document.querySelector('[role="dialog"]')`, 15000, "schedule modal");
    if (!(await setLabeled("Title", "Quarterly chiller service"))) throw new Error("title not filled");
    if (!(await selectOption("Asset", "HVAC-01"))) throw new Error("asset select failed");
    if (!(await setLabeled("Interval", "30"))) throw new Error("interval not filled");
    if (!(await setLabeled("Last Done", daysFromNow(-40)))) throw new Error("last done not filled");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save not clicked");
    await waitUntil(async () => (await bodyText()).includes("Quarterly chiller service"), 30000, "schedule row");
    const scheds = await fsList(`companies/${COMPANY_ID}/fm_pm_schedules`);
    const s = scheds.find((x) => x.title === "Quarterly chiller service");
    if (!s) throw new Error("schedule not persisted");
    schedId = s.id;
    const expectedDue = daysFromNow(-10); // -40 + 30
    if (s.nextDueDate !== expectedDue) throw new Error(`nextDueDate=${s.nextDueDate} expected ${expectedDue}`);
    // Due state renders Overdue and the generate action appears.
    await waitUntil(async () => /Overdue/i.test(await bodyText()), 20000, "overdue chip");
    if (!(await clickRowButton("Quarterly chiller service", ["Generate Work Order"]))) throw new Error("generate not clicked");
    await waitUntil(async () => (await bodyText()).includes("WO-0002 raised for today"), 30000, "generation feedback");
    const wos = await fsList(`companies/${COMPANY_ID}/fm_work_orders`);
    const w2 = wos.find((x) => x.code === "WO-0002");
    if (!w2) throw new Error("generated WO not persisted");
    wo2Id = w2.id;
    if (w2.scheduleId !== schedId) throw new Error("generated WO not linked to the schedule");
    if (w2.title !== "Quarterly chiller service") throw new Error("generated WO title not carried from schedule");
    const s2 = await fsGet(`companies/${COMPANY_ID}/settings/facilities`);
    if (s2?.woSequence?.nextNumber !== 3) throw new Error(`sequence not advanced by generation: ${JSON.stringify(s2?.woSequence)}`);
    // Idempotency: same business day -> no duplicate.
    if (!(await clickRowButton("Quarterly chiller service", ["Generate Work Order"]))) throw new Error("second generate not clicked");
    await waitUntil(async () => (await bodyText()).includes("already exists"), 30000, "idempotency feedback");
    const wos2 = await fsList(`companies/${COMPANY_ID}/fm_work_orders`);
    const todays = wos2.filter((x) => x.scheduleId === schedId && String(x.createdAt).slice(0, 10) === daysFromNow(0));
    if (todays.length !== 1) throw new Error(`idempotency broken: ${todays.length} WOs raised today for the schedule`);
    if (wos2.filter((x) => x.code === "WO-0002").length !== 1) throw new Error("WO-0002 duplicated");
    await shot("11-generate-idempotent");
    return "WO-0002 raised once; second click reported the existing order";
  });

  // ---------- Step 12: completion rolls the schedule forward ----------
  await step("12. Completing the generated WO rolls the schedule (lastDone=today, nextDue=+30d)", async () => {
    await goto(`http://localhost:${VITE_PORT}/facilities/work-orders/${wo2Id}`);
    await waitFor(`(document.body.innerText || '').includes('Quarterly chiller service')`, 40000, "WO-0002 detail");
    await pressButtonUntil("Move to Assigned", `(document.body.innerText || '').includes('Move to In Progress')`, 30000);
    await pressButtonUntil("Move to In Progress", `(document.body.innerText || '').includes('Move to Completed')`, 30000);
    // Scheduled WOs carry a "From preventive schedule" chip.
    if (!/From preventive schedule/i.test(await bodyText())) throw new Error("schedule linkage chip missing on detail");
    await pressButtonUntil("Move to Completed", `!!(document.querySelector('[role="dialog"] textarea'))`, 20000);
    await waitFor(`document.querySelector('[role="dialog"] textarea')`, 15000, "completion modal");
    if (!(await setLabeled("Completion Note", "Coils cleaned, service book updated"))) throw new Error("note not filled");
    await clickText("button", ["Complete"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${wo2Id}`))?.status === "completed", 30000, "WO-0002 completed");
    await waitUntil(async () => {
      const s = await fsGet(`companies/${COMPANY_ID}/fm_pm_schedules/${schedId}`);
      return s && s.lastDoneDate === daysFromNow(0) && s.nextDueDate === daysFromNow(30);
    }, 30000, "schedule rolled forward");
    await goto(`http://localhost:${VITE_PORT}/facilities/schedules`);
    await waitFor(`(document.body.innerText || '').includes('Quarterly chiller service')`, 30000, "schedules list");
    const txt = await bodyText();
    if (/Generate Work Order/i.test(txt)) throw new Error("generate action still visible after roll-over");
    if (!/Scheduled/i.test(txt)) throw new Error("due-state 'Scheduled' not visible after roll-over");
    await shot("12-schedule-rolled");
    return `lastDone=${daysFromNow(0)} nextDue=${daysFromNow(30)}`;
  });

  // ---------- Step 13: authorization probes against the real rules ----------
  await step("13. Cross-tenant read denied; member may not switch the tenant activity", async () => {
    const stOutsider = await fsGetStatus(`companies/${COMPANY_ID}/fm_work_orders/${woId}`, outsiderToken);
    if (stOutsider !== 403) throw new Error(`outsider read expected 403, got ${stOutsider}`);
    const stEmp = await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "PROJECTS" }, empToken);
    if (stEmp !== 403) throw new Error(`employee activity-switch expected 403, got ${stEmp} (outsider=${stOutsider})`);
    const still = await fsGet(`companies/${COMPANY_ID}`);
    if (still.primaryActivity !== "FACILITIES_MANAGEMENT") throw new Error("switch was denied yet the value changed!");
    return `outsider=${stOutsider} employee-switch=${stEmp} (both denied, value unchanged)`;
  });

  // ---------- Step 14: deactivating the activity blocks data + UI but preserves records ----------
  await step("14. Inactive activity blocks UI and REST reads; records survive reactivation intact", async () => {
    const patchSt = await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "REAL_ESTATE_MANAGEMENT" });
    if (patchSt >= 400) throw new Error(`admin switch to REM failed: ${patchSt}`);
    const stFm = await fsGetStatus(`companies/${COMPANY_ID}/fm_work_orders/${woId}`);
    if (stFm !== 403) throw new Error(`admin read of fm data under inactive activity expected 403, got ${stFm}`);
    await goto(`http://localhost:${VITE_PORT}/facilities`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "denied card under inactive activity");
    await shot("14-denied-while-inactive");
    // Reactivate: nothing was deleted by the switch.
    await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "FACILITIES_MANAGEMENT" });
    await goto(`http://localhost:${VITE_PORT}/facilities/work-orders`);
    await waitUntil(async () => {
      const t = await bodyText();
      return t.includes("WO-0001") && t.includes("WO-0002");
    }, 40000, "both work orders visible again");
    const w = await fsGet(`companies/${COMPANY_ID}/fm_work_orders/${woId}`);
    if (w.status !== "completed" || w.partsCost !== 250.5 || (w.statusHistory || []).length !== 3) {
      throw new Error("WO-0001 data mutated across the activity switch!");
    }
    await shot("14-records-survived");
    return "blocked while inactive; identical records after reactivation";
  });

  // ---------- Step 15: shared modules and other namespaces unaffected ----------
  await step("15. CRM + billing still work under Facilities; /projects stays activity-denied", async () => {
    await goto(`http://localhost:${VITE_PORT}/crm/contacts`);
    await waitUntil(async () => (await bodyText()).includes("Globex Trading"), 60000, "CRM contacts list");
    await goto(`http://localhost:${VITE_PORT}/billing/invoices`);
    await waitUntil(async () => (await bodyText()).includes("FM-SHARED-0001"), 90000, "billing invoices list");
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "projects denial under FM");
    await shot("15-shared-modules-ok");
    return "CRM/billing render; PROJECTS namespace correctly denied (not a crash)";
  });
} finally {
  edgeProc.kill();
  viteProc.kill();
}

console.log("\n=================================================================");
const passed = results.filter((r) => r.ok).length;
console.log(` Facilities Browser E2E Summary: ${passed}/${results.length} passed`);
for (const r of results.filter((x) => !x.ok)) console.log(`   ✗ ${r.name}: ${r.error}`);
console.log("=================================================================\n");
process.exit(passed === results.length ? 0 : 1);
