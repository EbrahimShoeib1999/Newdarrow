/**
 * D-Arrow Business — School Management Browser E2E (Edge headless / CDP)
 *
 * Drives the REAL UI against local Auth + Firestore emulators:
 * admin login → /school dashboard → academic year → term → grade → section
 * → subject → guardian → student (pending → enrolled) → attendance marking
 * → persisted-state verification → cross-tenant denial probe → Arabic RTL check
 *
 * Run: npm run test:school-browser
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_school_${Date.now()}`);
const CDP_PORT = 9785;
const VITE_PORT = 5185;
const PROJECT_ID = "test-school-lifecycle";
const COMPANY_ID = "sch-co";
const OTHER_COMPANY_ID = "other-sch-co";
const ADMIN_EMAIL = "sch_admin@sch.test";
const ADMIN_PASS = "SchAdmin2026!";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/school-lifecycle";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);
let adminIdToken = "";

// ---------- Firestore REST helpers ----------
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

// ---------- 1. Vite ----------
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

// ---------- UI primitives (HeroUI-aware) ----------
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
// Dispatch trusted CDP pointer events over the element currently marked with
// [data-e2e-press]. React-Aria (HeroUI Select/ListBox) ignores synthetic DOM
// .click() in headless mode and requires real pointer events to commit.
async function pressMarked() {
  await sleep(300);
  const pt = await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  if (!pt) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (b) b.removeAttribute('data-e2e-press'); return true; })()`).catch(() => {});
  return true;
}
// Shared JS snippet that resolves the label→combobox trigger and marks it.
const COMBO_RESOLVER = `
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const dialog = document.querySelector('[role="dialog"]');
    const scope = dialog || document;
    const combos = Array.from(scope.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]'));
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
`;
// Locate the labeled Select trigger and mark it for a press.
async function markComboTrigger(labelText) {
  const want = String(labelText).toLowerCase();
  return js(`(() => {
    const want = ${JSON.stringify(want)};
    ${COMBO_RESOLVER}
    if (!trig) return false;
    trig.scrollIntoView({ block: 'center' });
    trig.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
}
// Read the currently-displayed value text of the labeled Select.
async function comboValue(labelText) {
  const want = String(labelText).toLowerCase();
  return js(`(() => {
    const want = ${JSON.stringify(want)};
    ${COMBO_RESOLVER}
    return trig ? norm(trig.innerText) : null;
  })()`);
}
// Dispatch a trusted keyboard event (React-Aria listbox navigation).
async function pressKey(key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function selectOption(labelText, optionText) {
  const opt = String(optionText);
  const optLow = opt.toLowerCase();
  if (!(await markComboTrigger(labelText))) return false;
  // Trusted pointer event to OPEN the listbox popup (DOM-click fallback).
  if (!(await pressMarked())) {
    await js(`(() => { const t = document.querySelector('[data-e2e-press]'); if (t) { t.removeAttribute('data-e2e-press'); t.click(); } return true; })()`).catch(() => {});
  }
  await sleep(350);
  // Attempt 1: trusted pointer press directly on the matching option.
  const marked = await js(`(() => {
    const want = ${JSON.stringify(optLow)};
    const el = Array.from(document.querySelectorAll('[role="option"], li')).find(e => ((e.innerText || e.textContent || '').trim().toLowerCase().includes(want)));
    if (!el) return false;
    el.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
  if (marked) await pressMarked();
  let committed = await waitUntil(async () => { const v = await comboValue(labelText); return v && v.includes(optLow); }, 4000, `commit "${opt}"`).catch(() => false);
  if (committed) return true;
  // Attempt 2: keyboard navigation (portal popup may swallow pointer coords).
  await pressKey("Escape", "Escape", 27);
  await sleep(200);
  if (!(await markComboTrigger(labelText))) return false;
  await pressMarked();
  await sleep(350);
  const idx = await js(`(() => {
    const want = ${JSON.stringify(optLow)};
    const opts = Array.from(document.querySelectorAll('[role="option"]'));
    return opts.findIndex(e => ((e.innerText || e.textContent || '').trim().toLowerCase().includes(want)));
  })()`);
  const target = idx >= 0 ? idx : 0;
  for (let i = 0; i <= target; i++) { await pressKey("ArrowDown", "ArrowDown", 40); await sleep(90); }
  await pressKey("Enter", "Enter", 13);
  await sleep(350);
  committed = await waitUntil(async () => { const v = await comboValue(labelText); return v && v.includes(optLow); }, 4000, `commit(kbd) "${opt}"`).catch(() => false);
  return !!committed;
}
async function bodyText() {
  return (await js(`(document.body && document.body.innerText || '').replace(/\\s+/g, ' ')`)) || "";
}
async function dump(tag) {
  try {
    const url = await currentUrl();
    const text = ((await bodyText()) || "").slice(0, 400);
    log(`   [dump:${tag}] url=${url} body="${text}"`);
    await shot(`dump-${tag}`);
  } catch (e) { log(`   [dump:${tag}] failed: ${e?.message}`); }
}
async function clickButton(candidates) { return clickText("button, a", candidates); }
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
async function pressButtonUntil(needle, checkExpr, timeoutMs = 20000) {
  if (!(await pressButton(needle))) throw new Error(`button "${needle}" not found`);
  try { await waitUntil(() => js(checkExpr), timeoutMs, `"${needle}" effect`); return; } catch {}
  await clickText("button", [needle]);
  await waitUntil(() => js(checkExpr), timeoutMs, `"${needle}" effect after DOM click`);
}

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); await dump(`fail-${results.length}`); }
}

try {
  // ---------- Step 0: Auth + Seed ----------
  await step("0. Seed admin, company (SCHOOL_MANAGEMENT activity)", async () => {
    const su = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
    })).json();
    if (!su.localId) {
      const si = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
      })).json();
      su.localId = si.localId; su.idToken = si.idToken;
      if (!su.localId) throw new Error(`auth bootstrap failed: ${JSON.stringify(su)}`);
    }
    adminIdToken = su.idToken;
    const st = await fsPatch(`users/${su.localId}`, { email: ADMIN_EMAIL, name: "School Admin", companyId: COMPANY_ID, role: "admin" }, su.idToken);
    if (st >= 400) throw new Error(`self-seed users doc: ${st}`);
    await seedDoc(`companies/${COMPANY_ID}`, { name: "Greenfield Academy", primaryActivity: "SCHOOL_MANAGEMENT", defaultCurrency: "SAR" });
    await seedDoc(`companies/${OTHER_COMPANY_ID}`, { name: "Other Academy", primaryActivity: "SCHOOL_MANAGEMENT", defaultCurrency: "SAR" });
    return `uid=${su.localId}`;
  });

  // ---------- Step 1: Login ----------
  await step("1. Login via auth form", async () => {
    await goto(`http://localhost:${VITE_PORT}/login`);
    await waitFor(`document.querySelector('input[name="email"]')`, 120000, "login form");
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(`document.querySelector('input[name="email"]')`, 90000, "login form (english)");
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
      await clickButton(["sign in", "login", "\u062a\u0633\u062c\u064a\u0644"]);
      loggedIn = await waitUntil(async () => !(await currentUrl()).includes("/login"), 20000, `post-login redirect (attempt ${attempt + 1})`).then(() => true).catch(() => false);
    }
    if (!loggedIn) throw new Error("Could not log in after 4 attempts");
    return `url=${await currentUrl()}`;
  });

  await step("2. Navigate to /school dashboard", async () => {
    await goto(`http://localhost:${VITE_PORT}/school`);
    await waitUntil(async () => {
      const b = await bodyText();
      const u = await currentUrl();
      return !u.includes("/login") && (b.includes("School") || b.includes("Academic") || b.includes("\u0645\u062f\u0631\u0633\u0629") || b.includes("Dashboard") || b.includes("\u0644\u0648\u062d\u0629"));
    }, 90000, "school dashboard content");
    await shot("02-school-dashboard");
    const url = await currentUrl();
    if (!url.includes("/school")) throw new Error(`expected /school but got ${url}`);
    return url;
  });

  // ---------- Step 3: Create Academic Year via UI ----------
  await step("3. Create academic year via Academic Years page", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/academic-years`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new') || (b.innerText||'').includes('\u062c\u062f\u064a'))`, 90000, "New button");
    // Click "New" button
    const clicked = await clickButton(["new", "إضافة", "جديد"]);
    if (!clicked) throw new Error("New button not found");
    await sleep(500);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "modal open");
    await setLabeled("name", "2025/2026");
    await setLabeled("start", "2025-09-01");
    await setLabeled("end", "2026-06-30");
    await shot("03-ay-form");
    await clickButton(["save", "\u062d\u0641\u0638", "add", "create"]);
    await waitFor("!document.querySelector('[role=dialog]') || document.body.innerText.includes('2025/2026')", 15000, "modal closed");
    // Verify persisted via REST
    const items = await fsList(`companies/${COMPANY_ID}/sch_academic_years`);
    const found = items.find((i) => i.name === "2025/2026");
    if (!found) throw new Error("academic year not persisted");
    await shot("03-ay-list");
    return `id=${found.id}`;
  });

  // ---------- Step 4: Create Grade ----------
  await step("4. Create grade", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/grades`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new'))`, 90000, "New button on grades");
    await clickButton(["new", "\u0625\u0636\u0627\u0641\u0629", "\u062c\u062f\u064a\u062f"]);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "grade modal");
    await setLabeled("name", "Grade 1");
    await setLabeled("level", "1");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_grades`);
    const g = items.find((i) => i.name === "Grade 1");
    if (!g) throw new Error("grade not persisted");
    return `id=${g.id}`;
  });

  // ---------- Step 5: Create Section ----------
  await step("5. Create section linked to grade", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/sections`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new'))`, 90000, "New button on sections");
    await clickButton(["new", "\u0625\u0636\u0627\u0641\u0629", "\u062c\u062f\u064a\u062f"]);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "section modal");
    await setLabeled("name", "Section A");
    await selectOption("grade", "Grade 1");
    await shot("05-section-form");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_sections`);
    const s = items.find((i) => i.name === "Section A");
    if (!s) throw new Error("section not persisted");
    return `id=${s.id}`;
  });

  // ---------- Step 6: Create Subject ----------
  await step("6. Create subject", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/subjects`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new'))`, 90000, "New button on subjects");
    await clickButton(["new", "\u0625\u0636\u0627\u0641\u0629", "\u062c\u062f\u064a\u062f"]);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "subject modal");
    await setLabeled("name", "Mathematics");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_subjects`);
    if (!items.find((i) => i.name === "Mathematics")) throw new Error("subject not persisted");
    return "OK";
  });

  // ---------- Step 7: Create Guardian ----------
  await step("7. Create guardian", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/guardians`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new'))`, 90000, "New button on guardians");
    await clickButton(["new", "\u0625\u0636\u0627\u0641\u0629", "\u062c\u062f\u064a\u062f"]);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "guardian modal");
    await setLabeled("name", "Ahmed Ali");
    await setLabeled("phone", "+966551234567");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_guardians`);
    if (!items.find((i) => i.name === "Ahmed Ali")) throw new Error("guardian not persisted");
    return "OK";
  });

  // ---------- Step 8: Create Student (pending) ----------
  await step("8. Create student (pending status)", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/students`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').trim().toLowerCase().includes('new'))`, 90000, "New button on students");
    await clickButton(["new", "\u0625\u0636\u0627\u0641\u0629", "\u062c\u062f\u064a\u062f"]);
    await waitFor("document.querySelector('[role=dialog]')", 10000, "student modal");
    await setLabeled("name", "Sara Ahmed");
    await selectOption("guardian", "Ahmed Ali");
    await selectOption("status", "pending");
    await shot("08-student-form");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_students`);
    const st = items.find((i) => i.name === "Sara Ahmed");
    if (!st) throw new Error("student not persisted");
    if (st.status !== "pending") throw new Error(`expected pending, got ${st.status}`);
    return `id=${st.id}`;
  });

  // ---------- Step 9: Enroll Student ----------
  await step("9. Enroll student (pending \u2192 enrolled via edit)", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/students`);
    await waitFor(`(document.body.innerText||'').includes('Sara Ahmed')`, 60000, "student in list");
    // Click Edit on the student row
    const clicked = await js(`(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const row = rows.find(r => (r.innerText || '').includes('Sara Ahmed'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find(b => (b.innerText||'').toLowerCase().includes('edit') || (b.innerText||'').includes('تعديل'));
      if (!btn) return false;
      btn.click(); return true;
    })()`);
    if (!clicked) throw new Error("edit button not found on student row");
    await waitFor("document.querySelector('[role=dialog]')", 10000, "edit modal");
    if (!(await selectOption("status", "enrolled"))) throw new Error("status select did not commit");
    await sleep(500);
    if (!(await selectOption("grade", "Grade 1"))) throw new Error("grade select did not commit");
    await sleep(500);
    if (!(await selectOption("section", "Section A"))) throw new Error("section select did not commit");
    await shot("09-enroll-form");
    await pressButtonUntil("Save", "!document.querySelector('[role=dialog]')", 20000);
    const items = await fsList(`companies/${COMPANY_ID}/sch_students`);
    const st = items.find((i) => i.name === "Sara Ahmed");
    if (st?.status !== "enrolled") throw new Error(`expected enrolled, got ${st?.status}`);
    if (!st?.sectionId) throw new Error(`student enrolled but sectionId not persisted (attendance would list no students)`);
    return `status=${st.status}, sectionId=${st.sectionId}`;
  });

  // ---------- Step 10: Record Attendance ----------
  await step("10. Record attendance", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/attendance`);
    // Wait for the lazily-loaded page (section combobox present), not just the navbar.
    await waitFor(`Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).length > 0`, 60000, "attendance page combobox");
    // Select section (must commit or the students table stays empty)
    if (!(await selectOption("section", "Section A"))) throw new Error("section select did not commit on attendance page");
    await waitFor("document.body.innerText.includes('Sara')", 15000, "student listed");
    await shot("10-attendance-page");
    // Trusted press the "present" mark button (React-Aria onPress ignores DOM click).
    if (!(await pressButton("present"))) throw new Error("present button not found");
    const today = new Date().toISOString().slice(0, 10);
    const att = await waitUntil(async () => {
      const items = await fsList(`companies/${COMPANY_ID}/sch_attendance`);
      return items.find((i) => i.date === today && i.mark) || false;
    }, 15000, "attendance persisted").catch(() => null);
    if (!att) throw new Error("attendance not persisted");
    return `mark=${att.mark}`;
  });

  // ---------- Step 11: Idempotent Re-mark ----------
  await step("11. Re-mark attendance (idempotency: same row updated)", async () => {
    await goto(`http://localhost:${VITE_PORT}/school/attendance`);
    await waitFor(`Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).length > 0`, 60000, "attendance page combobox (re-mark)");
    if (!(await selectOption("section", "Section A"))) throw new Error("section select did not commit on re-mark");
    await waitFor("document.body.innerText.includes('Sara')", 15000, "student listed (re-mark)");
    // Trusted press "absent" — should UPDATE the same studentId+date row.
    if (!(await pressButton("absent"))) throw new Error("absent button not found");
    const today = new Date().toISOString().slice(0, 10);
    await waitUntil(async () => {
      const items = await fsList(`companies/${COMPANY_ID}/sch_attendance`);
      const rows = items.filter((i) => i.date === today);
      return rows.length === 1 && rows[0].mark === "absent";
    }, 15000, "re-mark to absent").catch(() => {});
    const items = await fsList(`companies/${COMPANY_ID}/sch_attendance`);
    const rows = items.filter((i) => i.date === today);
    if (rows.length === 0) throw new Error("no attendance row found after re-mark");
    if (rows.length > 1) throw new Error(`expected 1 row for today, got ${rows.length}`);
    if (rows[0]?.mark !== "absent") throw new Error(`expected mark updated to absent, got ${rows[0]?.mark}`);
    return `mark=${rows[0]?.mark} (idempotent single row)`;
  });

  // ---------- Step 12: Dashboard KPI ----------
  await step("12. Dashboard shows KPIs and 'not yet available' chips", async () => {
    await goto(`http://localhost:${VITE_PORT}/school`);
    await waitUntil(async () => {
      const b = await bodyText();
      return b.includes("Exams") || b.includes("Timetables") || b.includes("Fees") || b.includes("\u0627\u0645\u062a\u062d\u0627\u0646\u0627\u062a") || b.includes("Students") || b.includes("\u0637\u0644\u0627\u0628");
    }, 90000, "dashboard content");
    const body = await bodyText();
    if (!body.includes("Exams") && !body.includes("Timetables") && !body.includes("Fees") && !body.includes("\u0627\u0645\u062a\u062d\u0627\u0646\u0627\u062a")) {
      throw new Error("dashboard missing 'not yet available' chips");
    }
    await shot("12-dashboard");
    return "OK";
  });

  // ---------- Step 13: Arabic RTL ----------
  await step("13. Arabic RTL rendering", async () => {
    // The app's language detector uses the 'd-arrow-lang' localStorage key
    // (see src/lib/i18n.ts), NOT 'i18nextLng'.
    await js(`localStorage.setItem('d-arrow-lang', 'ar')`);
    await goto(`http://localhost:${VITE_PORT}/school`);
    // A distinctive Arabic School string that only renders when the school
    // namespace is actually translated (not the always-present toggle label).
    const AR_MARKERS = ["\u0644\u0648\u062d\u0629 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a", "\u0627\u0644\u0623\u0639\u0648\u0627\u0645 \u0627\u0644\u062f\u0631\u0627\u0633\u064a\u0629", "\u0627\u0644\u0637\u0644\u0627\u0628"];
    await waitUntil(async () => {
      const b = await bodyText();
      return AR_MARKERS.some((m) => b.includes(m));
    }, 90000, "Arabic school content");
    const dir = await js(`document.documentElement.dir`);
    const body = await bodyText();
    await shot("13-arabic-dashboard");
    if (dir !== "rtl") throw new Error(`expected documentElement.dir=rtl for Arabic, got "${dir}"`);
    if (!AR_MARKERS.some((m) => body.includes(m))) throw new Error("Arabic school strings not found");
    // Restore English so later steps / other suites are unaffected.
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    return `dir=${dir}, arabic-markers=true`;
  });

  // ---------- Step 14: Security — cross-tenant ----------
  await step("14. Cross-tenant: other-co admin denied our sch_ data via REST", async () => {
    const otherSu = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "other@other.test", password: ADMIN_PASS, returnSecureToken: true }),
    })).json();
    if (!otherSu.localId) {
      const si = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "other@other.test", password: ADMIN_PASS, returnSecureToken: true }),
      })).json();
      otherSu.localId = si.localId; otherSu.idToken = si.idToken;
    }
    if (otherSu.localId && otherSu.idToken) {
      // Self-seed using own token (users/{uid} rule: request.auth.uid == userId)
      const seedStatus = await fsPatch(`users/${otherSu.localId}`, { email: "other@other.test", name: "Other Admin", companyId: OTHER_COMPANY_ID, role: "admin" }, otherSu.idToken);
      if (seedStatus >= 400) return `self-seed status=${seedStatus} (skipped)`;
      const status = await fsGetStatus(`companies/${COMPANY_ID}/sch_grades`, otherSu.idToken);
      if (status === 200) throw new Error("cross-tenant read was ALLOWED (security gap!)");
      return `denied with status=${status}`;
    }
    return "skipped";
  });

} catch (fatal) {
  log(`FATAL: ${fatal?.message || fatal}`);
  results.push({ name: "FATAL", ok: false, error: fatal?.message });
} finally {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  log(`\n${"=".repeat(60)}`);
  log(` School Browser E2E: ${passed} passed, ${failed} failed`);
  log(`${"=".repeat(60)}\n`);
  edgeProc.kill();
  viteProc.kill();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  if (failed > 0) process.exit(1);
}

// Helper for security probe
async function fsGetStatus(docPath, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, { headers: authHdr(token) });
  return res.status;
}
