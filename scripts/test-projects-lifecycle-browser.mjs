/**
 * D-Arrow Business — Project Lifecycle Browser E2E (Edge headless / CDP)
 *
 * Drives the REAL UI against local Auth + Firestore emulators:
 * admin login -> create project with activity preset (milestones seeded)
 * -> audited transitions (Start / Put on Hold WITH required reason / Resume)
 * -> tenant terminology rename ("Orders") reflected in nav + headers while the
 *    /projects routes stay stable -> derived financials tab renders figures
 *    from an authoritative invoice record -> three cost tiers (recorded /
 *    approved actual / paid) with the inline accountant review -> project
 *    CARD CLICK opens the detail page (the exact user-reported failure) ->
 *    won-deal contract-workflow initiation -> task assignment visibility.
 *
 * All mutations go through UI interaction; the emulator REST API is used only
 * for fixture seeding and READ-ONLY verification of persisted state.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_projects_${Date.now()}`);
const CDP_PORT = 9780;
const VITE_PORT = 5177;
const PROJECT_ID = "test-projects-lifecycle";
const COMPANY_ID = "acme-co";
const ADMIN_EMAIL = "projects_admin@acme.test";
const ADMIN_PASS = "ProjectsAdmin2026!";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/projects-lifecycle";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);
let adminIdToken = "";

// ---------- Firestore REST helpers (act as the seeded admin, read-only checks) ----------
function authHdr() {
  const h = { "Content-Type": "application/json" };
  if (adminIdToken) h.Authorization = `Bearer ${adminIdToken}`;
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
async function fsGet(docPath) {
  const res = await fetch(`${FS_BASE}/${docPath}`, { headers: authHdr() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet ${docPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  if (!j.fields) return null;
  return { id: docPath.split("/").pop(), ...decodeFields(j.fields) };
}
async function fsList(collectionPath) {
  const res = await fetch(`${FS_BASE}/${collectionPath}?pageSize=500`, { headers: authHdr() });
  if (!res.ok) throw new Error(`fsList ${collectionPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) }));
}
async function seedDoc(docPath, obj) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH", headers: authHdr(), body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seed PATCH ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
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

// ---------- UI primitives (HeroUI-aware; same helpers as the lifecycle harness) ----------
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
  // React-Aria/HeroUI Select trigger is a <button> whose aria-labelledby lists
  // the selected VALUE element first and the field <label> second. Reading the
  // first id gives the value (e.g. "None"), which is why loose matching silently
  // broke once a field's current value didn't contain its label word. Resolve
  // the labelledby ids and keep the one that is an actual <label> element.
  const want = String(labelText).toLowerCase();
  const opened = await js(`(() => {
    const want = ${JSON.stringify(want)};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]'));
    const labelFor = (el) => {
      const lb = el.getAttribute && el.getAttribute('aria-labelledby');
      if (lb) {
        // Prefer a referenced element that is a real <label> (the field caption).
        const refs = lb.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean);
        const asLabel = refs.find((r) => r.tagName === 'LABEL' || r.closest('label'));
        if (asLabel && norm(asLabel.innerText)) return norm(asLabel.innerText);
      }
      const own = el.getAttribute && el.getAttribute('aria-label');
      if (own && norm(own)) return norm(own);
      // Fallback: nearest ancestor with a direct-child <label>.
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
    const diag = await js(`(() => {
      const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]'));
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      return JSON.stringify(combos.map((el, i) => {
        const lb = el.getAttribute('aria-labelledby');
        const resolved = lb ? norm(lb.split(/\\s+/).map(id => (document.getElementById(id) || {}).innerText || '').join(' ')) : '';
        return { i, tag: el.tagName, role: el.getAttribute('role'), ariaLabel: norm(el.getAttribute('aria-label') || ''), labelledby: lb || '', resolved, own: norm(el.innerText || '') };
      }));
    })()`).catch((e) => String(e));
    log(`   [selectDiag:${labelText}] no trigger matched. combos=${diag}`);
    const html = await js(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.outerHTML : document.body.innerHTML; })()`).catch(() => '');
    try { writeFileSync(path.join(OUT_DIR, `select-fail-${labelText.replace(/[^a-z0-9]/gi, '_')}.html`), html || ''); log(`   [selectDiag] wrote dialog HTML (${(html || '').length} bytes)`); } catch {}
    return false;
  }
  // Portal list may animate in / compile lazily — poll for the option instead of a fixed sleep.
  const chosen = await waitUntil(
    () => clickText('li, [role="option"]', [optionText]),
    8000,
    `option "${optionText}" for "${labelText}"`
  ).catch(() => false);
  if (chosen) return true;
  const opts = await js(`JSON.stringify(Array.from(document.querySelectorAll('li, [role="option"]')).map(o => (o.innerText||o.textContent||'').trim()).filter(Boolean))`).catch(() => '?');
  log(`   [selectDiag:${labelText}] option "${optionText}" never appeared. visibleOptions=${opts}`);
  // Close any half-open popover before the caller's next select, then report.
  await js(`(() => { const t = document.querySelector('[data-e2e-open]'); if (t) t.click(); return true; })()`).catch(() => {});
  return false;
}
async function bodyText() {
  return (await js(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ')`)) || "";
}
async function dump(tag) {
  try {
    const url = await currentUrl();
    const text = ((await bodyText()) || "").slice(0, 300);
    log(`   [dump:${tag}] url=${url} body="${text}"`);
    log(`   [dump:${tag}:console] ${JSON.stringify(consoleBuf.slice(-15))}`);
    await shot(`dump-${tag}`);
  } catch (e) { log(`   [dump:${tag}] failed: ${e?.message}`); }
}
async function clickButton(candidates) { return clickText("button, a", candidates); }
// Real user-grade click: CDP synthesizes trusted mouse events at the element
// coordinates (works with React root delegation exactly like a human click).
async function clickAt(selectorFnBody, yFrac = 0.5) {
  const rect = await js(`(() => {
    const el = (${selectorFnBody})();
    if (!el) return null;
    el.setAttribute('data-e2e-target', '1');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  if (!rect || rect.w < 4 || rect.h < 4) return false;
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h * yFrac);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return true;
}
// Click a button that lives in the same table row as `rowText` (unique row
// identity like a bill number), so identical action buttons in other rows
// can never be hit by mistake.
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

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); }
}

let projectId = "";
let adminUid = "";
try {
  // ---------- Step 0: auth + fixtures ----------
  await step("0. Seed admin, company, customer contact, approved contract (fixtures)", async () => {
    const su = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
    })).json();
    if (!su.localId) throw new Error("admin signUp failed: " + JSON.stringify(su));
    adminIdToken = su.idToken;
    const uid = su.localId;
    adminUid = uid;
    await seedDoc(`users/${uid}`, { email: ADMIN_EMAIL, name: "Projects Admin", companyId: COMPANY_ID, role: "admin" });
    await seedDoc(`companies/${COMPANY_ID}`, { id: COMPANY_ID, name: "Acme Solutions", defaultCurrency: "SAR" });
    await seedDoc(`companies/${COMPANY_ID}/contacts/ct_e2e`, {
      id: "ct_e2e", firstName: "Globex", lastName: "Trading", company: "Globex Trading",
      type: "customer", email: "ops@globex.test", createdAt: new Date().toISOString(),
    });
    const contract = {
      id: "cn_e2e", title: "Globex Website Contract", status: "final", approvalStatus: "approved",
      contactId: "ct_e2e", createdBy: uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      form: {
        title: "Globex Website Contract", contractNumber: "CNT-E2E-001", contractDateIso: "2026-01-01",
        preamble: "", provider: { name: "D-Arrow" }, client: { name: "Globex Trading" },
        fields: [
          { id: "f1", key: "amountExclVat", label: "Amount", value: "50000" },
          { id: "f2", key: "vatRate", label: "VAT", value: "15" },
        ],
        clauses: [], pageCount: "1", signatureDateIso: "2026-01-01", contactId: "ct_e2e",
      },
    };
    await seedDoc(`companies/${COMPANY_ID}/contracts/cn_e2e`, contract);
    return `admin uid=${uid}`;
  });

  // ---------- Step 1: login through the UI ----------
  await step("1. Admin login via UI", async () => {
    await goto(`http://localhost:${VITE_PORT}/login`);
    try {
      await waitFor(`document.querySelector('input[name="email"]')`, 120000, "login form");
    } catch (e) {
      await dump("no-login-form");
      const btns = await js(`JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => (b.innerText||'').trim()).filter(Boolean))`).catch(() => "?");
      log(`   [diag] buttons=${btns}`);
      // Cold-chunk self-heal: reload once and retry before declaring failure.
      await send("Page.reload", { ignoreCache: true });
      await waitFor(`document.querySelector('input[name="email"]')`, 90000, "login form after reload");
    }
    // Pin the UI to English deterministically: the language detector falls
    // back to the machine locale (often Arabic), which would make the
    // wording/number needles below machine-dependent.
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(`document.querySelector('input[name="email"]')`, 90000, "login form (english pinned)");
    await js(`(() => {
      const set = (sel, v) => { const el = document.querySelector(sel);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true })); };
      set('input[name="email"]', ${JSON.stringify(ADMIN_EMAIL)});
      set('input[type="password"]', ${JSON.stringify(ADMIN_PASS)});
      const sub = document.querySelector('button[type="submit"]');
      if (sub) sub.click();
    })()`);
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 120000, "post-login redirect");
    await shot("01-logged-in");
    return `url=${await currentUrl()}`;
  });

  // ---------- Step 2: create a project through the real modal ----------
  await step("2. Create project via UI form (customer, contract, preset, budget)", async () => {
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /new project|new order/i.test(b.innerText || ''))`, 90000, "projects list + New button");
    if (!(await clickText("button", ["New Project", "New Order"]))) throw new Error("New Project button not found");
    await waitFor(`document.querySelector('[role="dialog"], .modal')`, 15000, "form modal");
    if (!(await setLabeled("Project name", "Website Revamp"))) throw new Error("name field not filled");
    await setLabeled("Budget", "40000");
    if (!(await selectOption("Priority", "High Priority"))) throw new Error("priority select failed");
    if (!(await selectOption("Customer", "Globex"))) throw new Error("customer select failed");
    if (!(await selectOption("Related contract", "Globex Website Contract"))) throw new Error("contract select failed");
    if (!(await selectOption("Activity type", "Software Development"))) throw new Error("activity select failed");
    await shot("02-form-filled");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save button not found");
    await waitUntil(async () => (await bodyText()).includes("Website Revamp"), 30000, "project row in list");
    await shot("03-list-with-new-project");
    const docs = await fsList(`companies/${COMPANY_ID}/projects`);
    const p = docs.find((d) => d.name === "Website Revamp");
    if (!p) throw new Error("project doc not persisted");
    projectId = p.id;
    if (p.code !== "PRJ-0001") throw new Error(`expected code PRJ-0001, got ${p.code}`);
    if (p.contactId !== "ct_e2e" || p.contractId !== "cn_e2e") throw new Error("CRM references not persisted");
    if (p.budget !== 40000) throw new Error(`budget not persisted: ${p.budget}`);
    return `id=${p.id} code=${p.code}`;
  });

  // ---------- Step 3: preset milestones seeded by the create flow ----------
  await step("3. Software preset milestones auto-seeded (deterministic ids)", async () => {
    const ms = await fsList(`companies/${COMPANY_ID}/projects/${projectId}/milestones`);
    if (ms.length !== 5) throw new Error(`expected 5 preset milestones, found ${ms.length}`);
    if (!ms.every((m) => /^preset_software_\d$/.test(m.id))) throw new Error("milestone ids not deterministic preset ids");
    return `${ms.length} milestones`;
  });

  // ---------- Step 4: audited Start transition ----------
  await step("4. Start transition through UI stamps actual start + history", async () => {
    await goto(`http://localhost:${VITE_PORT}/projects/${projectId}`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /start/i.test(b.innerText || ''))`, 30000, "Start button");
    if (!(await clickText("button", ["Start"]))) throw new Error("Start not clicked");
    await waitFor(`(() => { const d = document.querySelector('[role="dialog"]'); return d && Array.from(d.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase() === 'save'); })()`, 15000, "confirm modal save");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/projects/${projectId}`);
      return d && d.status === "active" && d.actualStartDate && (d.statusHistory || []).length === 1;
    }, 30000, "active status + stamped date + history persisted");
    await shot("04-active");
    return "status=active, history=1";
  });

  // ---------- Step 5: pause requires a reason (UI gate + persisted reason) ----------
  await step("5. Put on Hold requires a reason; with reason it persists pauseReason", async () => {
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /put on hold/i.test(b.innerText || ''))`, 20000, "Put on Hold button");
    if (!(await clickText("button", ["Put on Hold"]))) throw new Error("hold button not found");
    await waitFor(`!!document.querySelector('textarea')`, 15000, "reason textarea");
    // Save must be disabled while the reason is empty (UI gate over the service rule).
    const saveDisabled = await js(`(() => {
      const d = document.querySelector('[role="dialog"]') || document;
      const b = Array.from(d.querySelectorAll('button')).find(x => (x.innerText||'').trim().toLowerCase() === 'save');
      return b ? b.disabled || b.getAttribute('aria-disabled') === 'true' : false;
    })()`);
    if (!saveDisabled) throw new Error("reason-less pause save was NOT disabled");
    await setLabeled("Pause reason", "Client deferred the kickoff");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/projects/${projectId}`);
      return d && d.status === "on_hold" && d.pauseReason === "Client deferred the kickoff";
    }, 30000, "on_hold persisted with pauseReason");
    await shot("05-on-hold");
    return "pauseReason persisted";
  });

  // ---------- Step 6: resume clears the pause reason ----------
  await step("6. Resume returns to active and clears pauseReason", async () => {
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase() === 'resume')`, 20000, "Resume button");
    if (!(await clickText("button", ["Resume"]))) throw new Error("resume button not found");
    await waitFor(`(() => { const d = document.querySelector('[role="dialog"]'); return d && Array.from(d.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase() === 'save'); })()`, 15000, "resume modal save");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/projects/${projectId}`);
      return d && d.status === "active" && d.pauseReason === null && (d.statusHistory || []).length === 3;
    }, 30000, "resume persisted");
    return "history=3, pauseReason cleared";
  });

  // ---------- Step 7: terminology rename affects labels, never routes ----------
  await step("7. Terminology settings rename labels in the UI (Projects → Orders)", async () => {
    await goto(`http://localhost:${VITE_PORT}/projects/settings`);
    await waitFor(`document.body.innerText.includes('Display terminology')`, 30000, "settings page");
    if (!(await setLabeled("Singular (English)", "Order"))) throw new Error("singular input not found");
    if (!(await setLabeled("Plural (English)", "Orders"))) throw new Error("plural input not found");
    await clickButton(["Save settings"]);
    await waitUntil(async () => {
      const s = await fsGet(`companies/${COMPANY_ID}/settings/projects`);
      return s?.terminology?.singular?.en === "Order";
    }, 20000, "terminology persisted");
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitUntil(async () => (await bodyText()).includes("New Order"), 30000, "renamed New Order button");
    const txt = await bodyText();
    if (!/orders/i.test(txt)) throw new Error("renamed plural not visible on list page");
    const url = await currentUrl();
    if (!url.includes("/projects")) throw new Error(`route changed by rename! url=${url}`);
    await shot("06-renamed-orders");
    return "labels renamed, route stable";
  });

  // ---------- Step 8: revert to defaults ----------
  await step("8. Revert terminology to defaults restores Projects wording", async () => {
    await goto(`http://localhost:${VITE_PORT}/projects/settings`);
    await waitFor(`document.body.innerText.includes('Display terminology') || document.body.innerText.includes('\u0635\u064a\u0627\u063a\u0629')`, 30000, "settings page mounted");
    const btns = await js(`JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => (b.innerText||'').trim()).filter(Boolean))`).catch(() => '?');
    log(`   [step8 buttons] ${btns}`);
    // isCustom gates the revert button; give the settings query time to resolve terminology.
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /default wording/i.test(b.innerText || ''))`, 20000, "revert button");
    await clickButton(["Use default wording"]);
    await waitUntil(async () => {
      const s = await fsGet(`companies/${COMPANY_ID}/settings/projects`);
      return s && s.terminology === undefined;
    }, 20000, "terminology removed from settings doc");
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitUntil(async () => (await bodyText()).includes("New Project"), 30000, "New Project restored");
    return "defaults restored";
  });

  // ---------- Step 9: derived financials from an authoritative invoice ----------
  await step("9. Financials tab renders derived figures from the seeded invoice", async () => {
    await seedDoc(`companies/${COMPANY_ID}/invoices/inv_e2e_001`, {
      id: "inv_e2e_001", invoiceNumber: "E2E-INV-0001", status: "sent",
      subTotal: 20000, totalTax: 3500, grandTotal: 23500, amountPaid: 8000,
      currency: "SAR", projectId, contractId: "cn_e2e", dueDate: "2026-12-31",
      createdAt: new Date().toISOString(),
    });
    await goto(`http://localhost:${VITE_PORT}/projects/${projectId}`);
    await waitFor(`Array.from(document.querySelectorAll('[role="tablist"] [role="tab"], [role="tablist"] button')).some(b => /financials/i.test(b.innerText || ''))`, 30000, "Financials tab");
    await clickText('[role="tablist"] [role="tab"], [role="tablist"] button', ["Financials"]);
    await waitUntil(async () => (await bodyText()).includes("23,500"), 30000, "derived invoiced figure");
    const txt = await bodyText();
    for (const needle of ["8,000", "15,500", "50,000"]) {
      if (!txt.includes(needle)) throw new Error(`expected derived figure ${needle} on Financials tab`);
    }
    if (!txt.includes("nothing here is editable")) throw new Error("derived-only disclaimer missing");
    await shot("07-financials");
    return "invoiced/collected/outstanding/contracted all rendered";
  });

  // ---------- Step 10: timeline tab audit list ----------
  await step("10. Activity timeline tab shows the audited transitions", async () => {
    await clickText('[role="tablist"] [role="tab"], [role="tablist"] button', ["Activity Timeline"]);
    await sleep(1200);
    const txt = await bodyText();
    if (!/Planning/.test(txt) || !/Status:/.test(txt)) throw new Error("status transitions not rendered in timeline tab");
    await shot("08-timeline");
    return "transitions visible";
  });

  // ---------- Step 11: three cost tiers + the inline accountant review ----------
  await step("11. Costs stay in three distinct tiers (recorded / approved actual / paid) and the review updates the source bill", async () => {
    const bills = [
      { id: "bl_e2e_1", billNumber: "E2E-B-001", vendorName: "Acme Media", status: "open", approvalStatus: "pending",
        projectId, currency: "SAR", subTotal: 10000, totalTax: 1500, grandTotal: 11500, amountPaid: 0,
        issueDate: "2026-10-01T00:00:00.000Z", dueDate: "2026-12-31",
        items: [{ id: "li1", description: "Ads burst", accountId: "acct_x", quantity: 1, unitPrice: 10000, taxRate: 15, total: 11500 }] },
      { id: "bl_e2e_2", billNumber: "E2E-B-002", vendorName: "Staff Co", status: "open", approvalStatus: "approved", approvedBy: adminUid,
        projectId, currency: "SAR", subTotal: 8000, totalTax: 1200, grandTotal: 9200, amountPaid: 2000,
        issueDate: "2026-10-02T00:00:00.000Z", dueDate: "2026-12-31",
        items: [{ id: "li1", description: "Contract staff", accountId: "acct_x", quantity: 1, unitPrice: 8000, taxRate: 15, total: 9200 }] },
      { id: "bl_e2e_3", billNumber: "E2E-B-003", vendorName: "Old Vendor", status: "open", approvalStatus: "rejected", reviewNote: "wrong project",
        projectId, currency: "SAR", subTotal: 1000, totalTax: 150, grandTotal: 1150, amountPaid: 0,
        issueDate: "2026-10-03T00:00:00.000Z", dueDate: "2026-12-31",
        items: [{ id: "li1", description: "Misc", accountId: "acct_x", quantity: 1, unitPrice: 1000, taxRate: 15, total: 1150 }] },
    ];
    // Bills must carry createdAt: the client getAll orders by it and Firestore
    // silently EXCLUDES docs missing the orderBy field — without it the tab
    // would render empty even though the docs exist (service always sets it).
    for (const b of bills) await seedDoc(`companies/${COMPANY_ID}/bills/${b.id}`, { ...b, createdAt: b.issueDate, updatedAt: b.issueDate });
    await goto(`http://localhost:${VITE_PORT}/projects/${projectId}`);
    await waitFor(`Array.from(document.querySelectorAll('[role="tablist"] [role="tab"], [role="tablist"] button')).some(b => /financials/i.test(b.innerText || ''))`, 30000, "Financials tab");
    await clickText('[role="tablist"] [role="tab"], [role="tablist"] button', ["Financials"]);
    // Tier snapshot before the review: recorded 11,500+9,200+EXCLUDED 1,150 rejected.
    try {
      await waitUntil(async () => (await bodyText()).includes("20,700"), 30000, "recorded cost 20,700");
    } catch (e) {
      const stored = await fsList(`companies/${COMPANY_ID}/bills`).catch((err) => `list failed: ${err.message}`);
      log(`   [step11 diag] stored bills=${JSON.stringify(Array.isArray(stored) ? stored.map((b) => ({ id: b.id, n: b.billNumber, projectId: b.projectId, status: b.status, approval: b.approvalStatus, gt: b.grandTotal })) : stored)}`);
      log(`   [step11 diag] tab body="${((await bodyText()) || '').slice(0, 900)}"`);
      await shot("11f-financials-diag");
      throw e;
    }
    let txt = await bodyText();
    const needles = [
      ["9,200", "approved actual (approved bills only)"],
      ["11,500", "pending review slice"],
      ["2,000", "paid (settled cash, independent of review)"],
      ["1,150", "rejected slice stays visible though excluded"],
    ];
    for (const [n, what] of needles) if (!txt.includes(n)) throw new Error(`${what} (${n}) missing before review`);
    // Phase 5: costs-by-category card. The seeded lines point at an accountId
    // absent from the chart of accounts, so every riyal must degrade into the
    // single "Uncategorized" row — reconciling with the recorded tier — and the
    // raw Firestore id must NEVER leak as a label. (Heading is CSS-uppercased:
    // innerText reports it lowercase, hence the case-insensitive probes.)
    const lower = txt.toLowerCase();
    if (!lower.includes("costs by category")) throw new Error("costs-by-category card missing");
    if (!lower.includes("uncategorized")) throw new Error("unclassified category row missing");
    if (lower.includes("acct_x")) throw new Error("raw account id leaked into the category label");
    // Frame the card for the evidence shot (it sits below the totals grid).
    await js(`(() => { const h = Array.from(document.querySelectorAll('p')).find(p => /costs by category/i.test(p.innerText || '')); if (h) h.scrollIntoView({ block: 'start' }); return !!h; })()`);
    await sleep(400);
    await shot("09a-costs-by-category");
    await shot("09-cost-tiers-before-review");
    // Accountant approves E2E-B-001 from the project's review queue.
    if (!(await clickRowButton("E2E-B-001", ["Approve"]))) throw new Error("approve button not found on E2E-B-001 row");
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/bills/bl_e2e_1`);
      return d && d.approvalStatus === "approved" && !!d.approvedBy;
    }, 30000, "bill doc carries the accountant's approval stamp");
    // Once the only pending bill is approved, approved == recorded (20,700),
    // so the number alone is not distinguishing — also assert the pending-
    // review row actually cleared, proving the tier re-derived live.
    await waitUntil(async () => {
      const t = await bodyText();
      return t.includes("20,700") && !t.includes("Pending accountant review");
    }, 30000, "approved tier re-derived to 20,700 and pending review cleared");
    // Accountant rejects E2E-B-002 with a required reason.
    if (!(await clickRowButton("E2E-B-002", ["Reject"]))) throw new Error("reject button not found on E2E-B-002 row");
    await waitFor(`!!document.querySelector('textarea')`, 15000, "rejection reason textarea");
    const ta = await js(`(() => { const el = document.querySelector('textarea'); if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, 'Not project-related');
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    if (!ta) throw new Error("reason textarea not filled");
    await clickText("button", ["Reject", "Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/bills/bl_e2e_2`);
      return d && d.approvalStatus === "rejected" && d.reviewNote === "Not project-related";
    }, 30000, "rejection + reason persisted on the source bill");
    // After rejecting B-002: recorded/approved = 11,500 (only B-001 stands);
    // rejected slice = 9,200 + 1,150 = 10,350 excluded from every total.
    await waitUntil(async () => (await bodyText()).includes("10,350"), 30000, "rejected slice 10,350 after exclusion");
    txt = await bodyText();
    if (!txt.includes("11,500")) throw new Error("recorded/approved at 11,500 after review not rendered");
    await shot("10-cost-tiers-after-review");
    return "tiers distinct before and after the review; source bills updated";
  });

  // ---------- Step 12: THE user-reported failure — clicking a project card opens details ----------
  await step("12. Project list CARD CLICK opens the detail page (real browser, real route)", async () => {
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitFor(`(document.body.innerText || '').includes('Website Revamp')`, 30000, "project card visible");
    const marked = await js(`(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const nameLink = links.find(a => (a.textContent || '').trim() === 'Website Revamp');
      if (!nameLink) return false;
      // HeroUI Card root is the clickable region (className carries
      // cursor-pointer). Resolve it via the stable class, not React prop keys.
      const card = nameLink.closest('.cursor-pointer');
      if (!card) return false;
      // Choose a NON-interactive descendant (the code chip) so the click is
      // handled by the whole-card onClick — proving the card itself opens
      // details, not just the accessible name link.
      const chip = Array.from(card.querySelectorAll('span'))
        .find(s => (s.textContent || '').trim() === 'PRJ-0001');
      if (!chip) return false;
      chip.setAttribute('data-e2e-card', '1');
      return true;
    })()`);
    if (!marked) throw new Error("card / code chip not found in DOM");
    // Ensure the card is on-screen so the trusted mouse actually lands on it.
    await js(`(() => { const el = document.querySelector('[data-e2e-card]'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
    await new Promise((r) => setTimeout(r, 300));
    // Exact user gesture: trusted CDP mouse events at the code chip's own
    // coordinates (the reported-broken card-body click).
    const viaMouse = await clickAt(`() => document.querySelector('[data-e2e-card]')`, 0.5);
    let navigated = false;
    try {
      await waitUntil(async () => (await currentUrl()).includes(`/projects/${projectId}`), 6000, "url after trusted mouse click");
      navigated = true;
    } catch { /* fall through to dispatched click */ }
    if (!navigated) {
      // Fall back to a dispatched DOM click on the same non-interactive chip —
      // still a real browser click event through the Card onClick + router.
      await js(`(() => { const el = document.querySelector('[data-e2e-card]'); if (!el) return false; el.click(); return true; })()`);
      try {
        await waitUntil(async () => (await currentUrl()).includes(`/projects/${projectId}`), 15000, `url reaches /projects/${projectId}`);
        navigated = true;
      } catch { /* report below */ }
    }
    if (!navigated) {
      await shot("12-card-click-FAILED");
      throw new Error(`card click did not navigate (mouseDispatched=${viaMouse}, url=${await currentUrl()})`);
    }
    await waitFor(`(document.body.innerText || '').includes('Financials')`, 20000, "detail tabs rendered");
    await shot("11-card-click-detail");
    return `card click landed on ${await currentUrl()}`;
  });

  // ---------- Step 13: won deal initiates the contract workflow ----------
  await step("13. Won deal journals the event and initiates the contract workflow (idempotent prompt)", async () => {
    await seedDoc(`companies/${COMPANY_ID}/deals/dl_e2e`, {
      id: "dl_e2e", title: "Phoenix Rollout", stage: "proposal", amount: 30000, currency: "SAR",
      contactId: "ct_e2e", assignedTo: adminUid, probability: 60,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await goto(`http://localhost:${VITE_PORT}/crm/deals/dl_e2e`);
    await waitFor(`(document.body.innerText || '').includes('Phoenix Rollout')`, 40000, "deal detail mounted");
    if (!(await clickText("button", ["Won"]))) throw new Error("Won stage button not found on the stage bar");
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/deals/dl_e2e`);
      return d && d.stage === "won";
    }, 30000, "stage persisted as won");
    // The workflow initiation is journaled on the deal's own activity timeline.
    await waitUntil(async () => {
      const acts = await fsList(`companies/${COMPANY_ID}/activities`);
      return acts.some((a) => a.entityId === "dl_e2e");
    }, 30000, "won event recorded on the activity timeline");
    // Won-but-no-contract prompt appears.
    await waitUntil(async () => {
      const t = await bodyText();
      return /no contract linked yet/i.test(t);
    }, 30000, "contract-workflow prompt visible");
    await shot("12-won-deal-prompt");
    // One intentional click hands over to the contract builder, deal-linked.
    if (!(await clickButton(["Draft contract now"]))) throw new Error("draft-contract CTA not clicked");
    await waitUntil(async () => (await currentUrl()).includes("dealId=dl_e2e"), 20000, "builder route carries dealId");
    await shot("13-contract-prefill-route");
    // Idempotency: once a contract is linked, the prompt disappears — no nagging.
    await seedDoc(`companies/${COMPANY_ID}/contracts/cn_e2e_d`, {
      id: "cn_e2e_d", title: "Phoenix Contract", status: "draft", approvalStatus: "pending",
      dealId: "dl_e2e", contactId: "ct_e2e", createdBy: adminUid, createdAt: new Date().toISOString(),
      form: { title: "Phoenix Contract", contractNumber: "CNT-D", contractDateIso: "2026-10-01", preamble: "",
        provider: { name: "D-Arrow" }, client: { name: "Phoenix" },
        fields: [{ id: "f1", key: "amountExclVat", label: "Amount", value: "30000" }, { id: "f2", key: "vatRate", label: "VAT", value: "15" }],
        clauses: [], pageCount: "1", signatureDateIso: "2026-10-01", contactId: "ct_e2e", dealId: "dl_e2e" },
    });
    await goto(`http://localhost:${VITE_PORT}/crm/deals/dl_e2e`);
    await waitFor(`(document.body.innerText || '').includes('Phoenix Rollout')`, 40000, "deal detail remounted");
    await sleep(1500);
    const t2 = await bodyText();
    if (/no contract linked yet/i.test(t2)) {
      throw new Error("prompt still nagging after a contract was linked");
    }
    return "won event journaled; prompt shown, actioned, then self-resolved";
  });

  // ---------- Step 14: assignment visibility on the project board ----------
  await step("14. Project tasks show the canonical assignee and flag unassigned explicitly", async () => {
    // Contract-scope task WITH a responsible assignee (canonical assigneeId).
    await seedDoc(`companies/${COMPANY_ID}/tasks/tk_e2e_asg`, {
      title: "Assigned scope task", description: "from contract item", status: "todo", priority: "high",
      type: "task", department: "Development", estimatedHours: 8,
      contractId: "cn_e2e", projectId, assigneeId: adminUid, reporterId: adminUid,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    // Contract-scope task left deliberately unassigned.
    await seedDoc(`companies/${COMPANY_ID}/tasks/tk_e2e_unas`, {
      title: "Open owner gap task", description: "needs a responsible person", status: "todo", priority: "medium",
      type: "task", department: "Design", estimatedHours: 4,
      contractId: "cn_e2e", reporterId: adminUid,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await goto(`http://localhost:${VITE_PORT}/projects/${projectId}`);
    await waitFor(`Array.from(document.querySelectorAll('[role="tablist"] [role="tab"], [role="tablist"] button')).some(b => /tasks/i.test(b.innerText || ''))`, 30000, "Tasks tab");
    await clickText('[role="tablist"] [role="tab"], [role="tablist"] button', ["Tasks"]);
    await waitUntil(async () => (await bodyText()).includes("Assigned scope task"), 30000, "assignee-scoped task visible");
    const txt = await bodyText();
    if (!txt.includes("Projects Admin")) throw new Error("assignee name not rendered next to their task");
    if (!txt.includes("Open owner gap task")) throw new Error("unassigned contract-scope task missing from project board");
    if (!/Unassigned/i.test(txt)) throw new Error("unassigned flag not visible");
    await shot("13-task-assignment-visible");
    return "assignee + explicit unassigned flag both visible";
  });
} finally {
  edgeProc.kill();
  viteProc.kill();
}

console.log("\n=================================================================");
const passed = results.filter((r) => r.ok).length;
console.log(` Projects Browser E2E Summary: ${passed}/${results.length} passed`);
console.log("=================================================================\n");
process.exit(passed === results.length ? 0 : 1);
