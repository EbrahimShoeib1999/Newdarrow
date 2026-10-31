/**
 * D-Arrow Business — Marketing Agency Browser E2E (Edge headless / CDP)
 *
 * Drives the REAL UI against local Auth + Firestore emulators:
 * admin login -> /agency blocked BEFORE MARKETING_AGENCY is selected (fail
 * closed) -> activity chosen through the real settings card -> campaign
 * created through the form modal (code CMP-0001 allocated by the
 * settings/marketing transaction WRITE, enforced by the real rules) ->
 * activation behind the approved-budget gate (zero-budget activation is
 * disabled, the revision flow lifts the cap with a full audit trail) ->
 * actual spend recorded separately from revenue -> revenue is the SHARED
 * billing invoice linked by campaignId only (never copied) -> deliverable
 * review machine with the client sign-off publication gate -> content
 * calendar with the scheduled-date precondition -> creative brief with an
 * attachment -> reports derived from persisted records only -> cross-tenant
 * and non-admin denials -> deactivating the activity blocks UI + data while
 * records survive reactivation -> CRM/billing keep working, the facilities
 * namespace stays activity-denied, and the core PROJECTS module stays
 * reachable (Projects is a CORE_ROUTE_PREFIXES shared module, never gated).
 *
 * All mutations go through UI interaction; the emulator REST API is used
 * only for fixture seeding and READ-ONLY verification of persisted state
 * (plus the explicit authorization probes).
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_agency_${Date.now()}`);
const CDP_PORT = 9782;
const VITE_PORT = 5179;
const PROJECT_ID = "test-agency-lifecycle";
const COMPANY_ID = "mkt-co";
const OTHER_COMPANY_ID = "other-co";
const ADMIN_EMAIL = "mkt_admin@mkt.test";
const ADMIN_PASS = "MktAdmin2026!";
const EMP_EMAIL = "mkt_emp@mkt.test";
const OUTSIDER_EMAIL = "mkt_outsider@other.test";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/agency-lifecycle";

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
function encodeFields(obj) {
  const f = {};
  for (const k in obj) f[k] = encodeValue(obj[k]);
  return f;
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
    // Point the bucket at a nonexistent name: the REST probe 404s, the
    // helper marks the bucket unavailable and small attachments fall back to
    // inline data URLs (the shape the service also accepts). Storage-rule
    // coverage for mkt_briefs lives in the dedicated rules suite instead.
    VITE_FIREBASE_STORAGE_BUCKET: "mock-project.appspot.com",
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

// ---------- UI primitives (HeroUI-aware; same helpers as the facilities harness) ----------
// HeroUI keeps CLOSED modals mounted (display:none on an ancestor) but animates
// OPEN ones with opacity/transform — so "shown" must mean only "no display:none
// /visibility:hidden ancestor". Never use offsetParent/getClientRects here: the
// (visually-hidden) combobox input itself has no client rects.
const VIS = `(el) => { let n = el; while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; n = n.parentElement; } return true; }`;
async function setLabeled(labelText, value) {
  return js(`(() => {
    const isVis = ${VIS};
    const want = ${JSON.stringify(labelText)}.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label')).filter(l => isVis(l));
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
    const isVis = ${VIS};
    const scope = ${within ? `Array.from(document.querySelectorAll(${JSON.stringify(within)})).filter(s => isVis(s))` : "null"};
    const pool = scope
      ? scope.flatMap(s => Array.from(s.querySelectorAll('${what}')))
      : Array.from(document.querySelectorAll('${what}, [role="option"]'));
    const el = pool.find(e => { const t = (e.innerText || e.textContent || '').trim().toLowerCase();
      return t && cands.some(c => t === c || t.includes(c)); });
    if (!el) return false;
    el.click(); return true;
  })()`);
}
/** Click a VISIBLE button whose text equals one of the candidates exactly. */
async function clickTextExact(candidates) {
  return js(`(() => {
    const isVis = ${VIS};
    const cands = ${JSON.stringify(candidates)}.map(s => s.toLowerCase());
    const el = Array.from(document.querySelectorAll('button, a')).find(e => isVis(e) &&
      cands.includes((e.innerText || '').trim().toLowerCase()));
    if (!el) return false;
    el.click(); return true;
  })()`);
}
/** Trusted-mouse click on the element currently marked [data-e2e-press].
    React-Aria (HeroUI Select) listens for real pointer events; a synthetic
    .click() is intermittently ignored, leaving the selection uncommitted and
    the listbox popover open — which then pollutes dialogButtonState reads. */
async function trustedClickMarked() {
  const pt = await js(`(() => {
    const b = document.querySelector('[data-e2e-press]');
    if (!b) return null;
    b.scrollIntoView({ block: 'center', inline: 'center' });
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!pt) return false;
  await sleep(120);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (b) b.removeAttribute('data-e2e-press'); return true; })()`).catch(() => {});
  return true;
}
/** True while a Select listbox/option popover is visible on screen. */
async function listboxVisible() {
  return js(`(() => {
    const isVis = ${VIS};
    return Array.from(document.querySelectorAll('[role="listbox"], [role="option"]')).some((e) => isVis(e));
  })()`);
}
/** True once the labelled combobox visibly shows the chosen value. Proves the
    React-Aria selection actually committed, independent of popover-close
    animation (which is what made the old listbox-close heuristic flake). */
async function comboboxShowsValue(labelText, optionText) {
  const want = String(labelText).toLowerCase();
  const oWant = String(optionText).toLowerCase();
  return js(`(() => {
    const want = ${JSON.stringify(want)};
    const oWant = ${JSON.stringify(oWant)};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const isVis = ${VIS};
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
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
    return norm(trig.innerText || trig.textContent).includes(oWant);
  })()`);
}
async function selectOption(labelText, optionText, attempts = 3) {
  const want = String(labelText).toLowerCase();
  const oWant = String(optionText).toLowerCase();
  // Locate the labelled combobox and mark it for a trusted press.
  const findTrigger = () => js(`(() => {
    const want = ${JSON.stringify(want)};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const isVis = ${VIS};
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
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
    trig.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
  const markOption = () => js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const opts = Array.from(document.querySelectorAll('li, [role="option"]')).filter(isVis);
    const el = opts.find((o) => norm(o.innerText || o.textContent).includes(${JSON.stringify(oWant)}));
    if (!el) return false;
    el.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
  // Best-effort: dismiss a lingering open popover by toggling the combobox
  // trigger shut with a synthetic click. NEVER use Escape here: inside a
  // HeroUI Modal Escape closes the whole dialog, wiping the form mid-sequence.
  const dismissListbox = async () => {
    if (!(await listboxVisible())) return;
    await js(`(() => { const isVis = ${VIS}; const t = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(isVis).find(c => c.getAttribute('aria-expanded') === 'true'); if (t) t.click(); return true; })()`).catch(() => {});
    await waitUntil(async () => (await listboxVisible()) === false, 1500, "listbox dismissed").catch(() => {});
  };
  // OPEN the listbox (trusted press, synthetic fallback) exactly once.
  if (!(await findTrigger())) {
    const opts = await js(`JSON.stringify(Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).map(el => (el.getAttribute('aria-labelledby')||'') + '|' + (el.innerText||'').slice(0,30)))`).catch(() => "?");
    log(`   [selectDiag:${labelText}] no trigger matched. combos=${opts}`);
    return false;
  }
  await trustedClickMarked();
  if (!(await waitUntil(async () => (await listboxVisible()) === true, 2000, "listbox open").catch(() => false))) {
    await findTrigger();
    await js(`(() => { const t = document.querySelector('[data-e2e-press]'); if (t) { t.click(); t.removeAttribute('data-e2e-press'); } return true; })()`).catch(() => {});
    await waitUntil(async () => (await listboxVisible()) === true, 2000, "listbox open (synthetic fallback)").catch(() => {});
  }
  if (!(await listboxVisible())) { await dismissListbox(); return false; }
  // Let the popover finish its open animation before measuring the option, then
  // press it with trusted pointer events. React-Aria closes the listbox on a
  // real selection, so "listbox gone" is the authoritative commit signal (the
  // old value-text read was unreliable because HeroUI repoints aria-labelledby
  // once a value is chosen). Retry the press if the popover stays open — the
  // historic flake was measuring the option rect mid-animation.
  await sleep(350);
  for (let press = 1; press <= attempts; press++) {
    if (!(await listboxVisible())) break;
    if (await markOption()) await trustedClickMarked();
    else await clickText('li, [role="option"]', [optionText]);
    if (await waitUntil(async () => (await listboxVisible()) === false, 1500, `"${optionText}" selected (press ${press})`).catch(() => false)) return true;
    await sleep(250);
  }
  await dismissListbox();
  return false;
}
/** Check a HeroUI checkbox by its visible label text. */
async function checkCheckbox(labelText) {
  return js(`(() => {
    const isVis = ${VIS};
    const want = ${JSON.stringify(labelText)}.toLowerCase();
    const labels = Array.from(document.querySelectorAll('label')).filter(l => isVis(l));
    const lab = labels.find(l => (l.innerText || '').trim().toLowerCase().includes(want));
    if (!lab) return false;
    const inp = lab.querySelector('input[type="checkbox"]') || (lab.closest('label') && lab.closest('label').querySelector('input[type="checkbox"]'));
    if (!inp) return false;
    if (!inp.checked) { inp.click(); }
    return true;
  })()`);
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
/** Trusted-mouse press of the button whose text matches EXACTLY (no substring
collateral like the "Unlink" button or the "Link" react-router anchor). */
async function pressButtonExact(exactText, timeoutMs = 20000) {
  const clicked = await waitUntil(() => clickTextExact([exactText]), timeoutMs, `exact button "${exactText}" clicked`).catch(() => false);
  if (!clicked) throw new Error(`visible exact button "${exactText}" never found`);
  return true;
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
async function dialogButtonState(label) {
  return js(`(() => {
    // HeroUI keeps CLOSED modals mounted (display:none ancestor): the FIRST
    // [role=dialog] can be a stale hidden node. Use the last SHOWN dialog.
    const isVis = ${VIS};
    const ds = Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => isVis(d));
    const d = ds[ds.length - 1];
    if (!d) return "no-dialog";
    const b = Array.from(d.querySelectorAll('button')).find(x => (x.innerText||'').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
    if (!b) return "no-button";
    return (b.disabled || b.getAttribute('aria-disabled') === 'true') ? "disabled" : "enabled";
  })()`);
}
async function closeModal() {
  await clickText("button", ["cancel"], { within: '[role="dialog"]' });
  await waitUntil(async () => !(await js(`(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => isVis(d) && d.querySelector('[role="combobox"], input, textarea')).length; })()`)), 10000, "modal closed").catch(() => {});
  await sleep(400);
}
/** Wait for a SHOWN dialog (stale hidden modals must not satisfy this). */
async function waitForVisibleDialog(label, timeoutMs = 15000) {
  await waitFor(`(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => isVis(d)); })()`, timeoutMs, label);
  return true;
}

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); await dump(`fail-${results.length}`); }
}

let campaignId = "";
let deliverableId = "";
let contentId = "";
let empToken = "";
let outsiderToken = "";

const CMP = "Ramadan Reach";
const TEASER = "Eid launch teaser";
const CAROUSEL = "Ramadan carousel";
const BRIEF = "Teaser direction";

try {
  // ---------- Step 0: fixtures ----------
  await step("0. Seed admin/employee/outsider, company (no activity yet), CRM client + shared invoice", async () => {
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
    const admin = await createAccount(ADMIN_EMAIL, "MKT Admin", COMPANY_ID, "admin");
    adminIdToken = admin.idToken;
    const emp = await createAccount(EMP_EMAIL, "MKT Employee", COMPANY_ID, "employee");
    const outsider = await createAccount(OUTSIDER_EMAIL, "Other Co Admin", OTHER_COMPANY_ID, "admin");
    empToken = emp.idToken;
    outsiderToken = outsider.idToken;

    // NO primaryActivity yet -> the fail-closed pre-activation probe is meaningful.
    await seedDoc(`companies/${COMPANY_ID}`, { id: COMPANY_ID, name: "Crescent Marketing Co", defaultCurrency: "SAR" });
    await seedDoc(`companies/${OTHER_COMPANY_ID}`, { id: OTHER_COMPANY_ID, name: "Other Co", defaultCurrency: "SAR" });
    // CRM client the campaign will reference (shared contacts collection).
    await seedDoc(`companies/${COMPANY_ID}/contacts/ct_mkt`, {
      id: "ct_mkt", firstName: "Globex", lastName: "Foods", company: "Globex Foods",
      type: "customer", email: "brand@globex.test", createdAt: new Date().toISOString(),
    });
    // Shared billing invoice for the revenue link (no campaignId yet).
    await seedDoc(`companies/${COMPANY_ID}/invoices/inv_mkt_shared`, {
      id: "inv_mkt_shared", invoiceNumber: "MKT-INV-0001", customerName: "Globex Foods",
      status: "sent", subTotal: 26087, totalTax: 3913, grandTotal: 30000, amountPaid: 10000,
      currency: "SAR", issueDate: new Date().toISOString(),
      dueDate: new Date("2026-12-31T00:00:00Z"), createdAt: new Date().toISOString(),
    });
    return `admin=${admin.localId.slice(0, 8)}… tokens ready`;
  });

  // ---------- Step 1: login ----------
  await step("1. Admin login via UI", async () => {
    await goto(`http://localhost:${VITE_PORT}/login`);
    await waitFor(`document.querySelector('input[name="email"]')`, 120000, "login form");
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    await send("Page.reload", { ignoreCache: true });
    await waitFor(`document.querySelector('input[name="email"]')`, 90000, "login form (english pinned)");
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

  // ---------- Step 2: fail closed before activation ----------
  await step("2. /agency blocked before MARKETING_AGENCY is the tenant activity", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 30000, "activity denial card");
    const st = await fsGetStatus(`companies/${COMPANY_ID}/mkt_campaigns/probe-none`, outsiderToken);
    if (st !== 400 && st !== 403 && st !== 404) throw new Error(`unexpected outsider probe status ${st}`);
    await shot("02-denied-before-activation");
    return `guard denied direct URL (REST outsider probe status=${st})`;
  });

  // ---------- Step 3: activate through the real settings card ----------
  await step("3. Select MARKETING_AGENCY via the settings UI (persisted on the company doc)", async () => {
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitFor(`(document.body.innerText || '').includes('Primary business activity')`, 60000, "activity settings card");
    if (!(await clickText("button", ["marketing agency"]))) throw new Error("activity option not found");
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /activate/i.test(b.innerText || ''))`, 15000, "activate button");
    if (!(await clickButton(["activate"]))) throw new Error("activate button not clicked");
    await waitUntil(async () => {
      const c = await fsGet(`companies/${COMPANY_ID}`);
      return c && c.primaryActivity === "MARKETING_AGENCY";
    }, 30000, "primaryActivity persisted");
    await shot("03-activity-set");
    return "company doc now owns MARKETING_AGENCY";
  });

  // ---------- Step 4: module renders ----------
  await step("4. Marketing dashboard renders under the active activity", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency`);
    await waitUntil(async () => (await bodyText()).includes("Marketing Dashboard"), 60000, "dashboard");
    await shot("04-dashboard");
    return "dashboard visible";
  });

  // ---------- Step 5: create campaign (transactional code + settings write under real rules) ----------
  await step("5. Create campaign via UI -> CMP-0001 + settings/marketing sequence written under real rules", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/campaigns`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').includes('New Campaign'))`, 90000, "New Campaign button");
    if (!(await clickText("button", ["New Campaign"]))) throw new Error("New Campaign not clicked");
    await waitForVisibleDialog("campaign modal");
    if (!(await setLabeled("Name", CMP))) throw new Error("name not filled");
    await setLabeled("Objective", "Own the Eid conversation for Globex Foods");
    if (!(await selectOption("Client", "Globex Foods"))) throw new Error("client select failed");
    if (!(await checkCheckbox("Social Media"))) throw new Error("channel checkbox not toggled");
    await setLabeled("Start Date", daysFromNow(-1));
    await setLabeled("End Date", daysFromNow(30));
    await setLabeled("Approved Budget", "0");
    await shot("05-campaign-form");
    if (!(await clickText("button", ["Save"], { within: '[role="dialog"]' }))) throw new Error("save not clicked");
    await waitUntil(async () => (await bodyText()).includes("CMP-0001"), 30000, "campaign code in list");
    const docs = await fsList(`companies/${COMPANY_ID}/mkt_campaigns`);
    const c = docs.find((d) => d.code === "CMP-0001");
    if (!c) throw new Error("campaign doc not persisted");
    campaignId = c.id;
    if (c.status !== "draft") throw new Error(`new campaign must start at draft, got ${c.status}`);
    if (c.clientId !== "ct_mkt") throw new Error(`campaign client link wrong: ${c.clientId}`);
    if (!Array.isArray(c.channels) || !c.channels.includes("social")) throw new Error(`channels not persisted: ${JSON.stringify(c.channels)}`);
    if (Number(c.budgetAmount) !== 0) throw new Error(`budget should be 0 for the gate test, got ${c.budgetAmount}`);
    // The transactional counter lands in settings/marketing via a real rules-gated write.
    const s = await fsGet(`companies/${COMPANY_ID}/settings/marketing`);
    if (!s || !s.campaignSequence || s.campaignSequence.nextNumber !== 2) {
      throw new Error(`settings/marketing sequence not advanced: ${JSON.stringify(s?.campaignSequence)}`);
    }
    await shot("05-campaign-created");
    return `campaignId=${campaignId} seq.nextNumber=2 (transaction write accepted by rules)`;
  });

  // ---------- Step 6: draft exposes only approval/cancel edges ----------
  await step("6. Draft campaign offers ONLY approved/cancelled (no activation skip edges)", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/campaigns/${campaignId}`);
    await waitFor(`(document.body.innerText || '').includes('${CMP}')`, 40000, "campaign detail");
    const txt = await bodyText();
    if (!/Move to Approved/i.test(txt)) throw new Error("approved edge not offered");
    if (!/Move to Cancelled/i.test(txt)) throw new Error("cancelled edge not offered");
    if (/Move to (Active|Paused|Completed)/i.test(txt)) throw new Error("SKIP EDGE from draft exposed!");
    await pressButtonUntil("Move to Approved", `(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => isVis(d)); })()`, 20000);
    await setLabeled("Note", "Budget later; concept signed off verbally");
    await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
      return d?.status === "approved" && (d.statusHistory || []).length === 1;
    }, 30000, "approved persisted with history");
    await shot("06-approved");
    return "history=1, only legal edges ever rendered";
  });

  // ---------- Step 7: activation budget gate + revision governance ----------
  await step("7. Activation blocked at zero budget; revision proposes, approve raises cap to 50,000", async () => {
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /move to active/i.test(b.innerText || ''))`, 30000, "active edge");
    await pressButtonUntil("Move to Active", `(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => isVis(d)); })()`, 20000);
    const st = await dialogButtonState("Confirm");
    if (st !== "disabled") throw new Error(`activate without budget must be disabled, got ${st}`);
    if (!/budget greater than zero/i.test(await bodyText())) throw new Error("activation gate hint not shown");
    await closeModal();
    // Propose the revision — the only way to change an approved-era budget.
    if (!(await clickButton(["Propose Revision"]))) throw new Error("propose button not found");
    await waitForVisibleDialog("revision modal");
    if (!(await setLabeled("New Budget", "50000"))) throw new Error("amount not filled");
    if (!(await setLabeled("Reason", "Client expanded scope to three markets"))) throw new Error("reason not filled");
    await shot("07-revision-modal");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
      const r = (d?.budgetRevisions || [])[0];
      return r && r.state === "pending" && Number(d.budgetAmount) === 0;
    }, 30000, "pending revision, budget untouched");
    // The hint only appears once the campaign query refetch lands — wait for
    // the UI to catch up with the server rather than asserting instantly.
    await waitUntil(async () => /already pending/i.test(await bodyText()), 20000, "pending-revision hint");
    // Decide it (wait for the decision buttons to render off the refetched row).
    await waitUntil(async () => (await clickButton(["Approve"])) === true, 20000, "approve-revision button");
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
      return Number(d.budgetAmount) === 50000 && (d.budgetRevisions || [])[0]?.state === "approved";
    }, 30000, "budget 50000 after approval");
    await shot("07-revision-approved");
    return "gate held at 0; approved revision moved budget 0 -> 50,000 with audit";
  });

  // ---------- Step 8: activate now that the budget is real ----------
  await step("8. Move to Active succeeds after the budget exists", async () => {
    // Wait for the refetched budget to render — the activation gate reads the
    // same campaign object the card displays.
    await waitUntil(async () => (await bodyText()).includes("50,000"), 20000, "budget 50,000 in UI");
    await pressButtonUntil("Move to Active", `(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => isVis(d)); })()`, 20000);
    if ((await dialogButtonState("Confirm")) !== "enabled") throw new Error("activate still disabled with approved budget");
    await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
      return d?.status === "active" && (d.statusHistory || []).length === 2;
    }, 30000, "active persisted");
    await waitFor(`(document.body.innerText || '').includes('Active')`, 20000, "active chip");
    await shot("08-active");
    return "status=active, history=2";
  });

  // ---------- Step 9: actual spend, derived figures ----------
  await step("9. Record expense 12,500.5 -> spent/remaining/utilization derive correctly", async () => {
    if (!(await clickButton(["Add Expense"]))) throw new Error("add expense not clicked");
    await waitForVisibleDialog("expense modal");
    if (!(await setLabeled("Title", "Meta ads flight 1"))) throw new Error("title not filled");
    if (!(await setLabeled("Amount", "12500.5"))) throw new Error("amount not filled");
    await setLabeled("Spent On", daysFromNow(0));
    await setLabeled("Vendor", "Meta");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const docs = await fsList(`companies/${COMPANY_ID}/mkt_expenses`);
      const e = docs.find((x) => x.title === "Meta ads flight 1");
      return e && Number(e.amount) === 12500.5 && e.campaignId === campaignId;
    }, 30000, "expense persisted");
    await waitUntil(async () => (await bodyText()).includes("12,500.5"), 20000, "derived spent in UI");
    const txt = await bodyText();
    if (!txt.includes("37,499.5")) throw new Error(`remaining not derived: "${txt.slice(0, 200)}"`);
    if (!/25%/.test(txt)) throw new Error("utilization 25% not rendered");
    await shot("09-expense");
    return "spent 12,500.5 | remaining 37,499.5 | utilization 25% — all derived";
  });

  // ---------- Step 10: revenue is a pure reference into shared billing ----------
  await step("10. Link shared invoice MKT-INV-0001 -> invoice doc carries campaignId only; revenue derives", async () => {
    // Pick the invoice and verify the selection actually landed on the
    // trigger before pressing Link (retry once if the popover missed).
    const pickInvoice = async () => {
      await selectOption("unlinked invoice", "MKT-INV-0001");
      return waitUntil(
        async () => (await js(`(() => {
          const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => { const isVis = ${VIS}; return isVis(c); });
          return combos.some(c => (c.innerText || '').includes('MKT-INV-0001'));
        })()`)),
        4000,
        "invoice selection rendered on the trigger",
      ).then(() => true).catch(() => false);
    };
    if (!(await pickInvoice()) && !(await pickInvoice())) throw new Error("invoice select never applied");
    await pressButtonExact("link", 10000);
    await waitUntil(async () => {
      const inv = await fsGet(`companies/${COMPANY_ID}/invoices/inv_mkt_shared`);
      return inv?.campaignId === campaignId;
    }, 30000, "campaignId written on the shared invoice");
    await waitUntil(async () => (await bodyText()).includes("30,000"), 20000, "invoiced figure");
    const txt = await bodyText();
    if (!txt.includes("10,000")) throw new Error("collected figure not rendered");
    // No revenue copy: the campaign doc itself must not store invoice amounts.
    const c = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
    if (JSON.stringify(c).includes("30000")) throw new Error("invoice amount was COPIED into the campaign record!");
    await shot("10-invoice-linked");
    return "pure reference; invoiced 30,000 collected 10,000 derived from billing";
  });

  // ---------- Step 11: deliverable review machine ----------
  await step("11. Deliverable walks not_started -> in_progress -> in_review -> approved (no publish skip edge)", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/deliverables`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').includes('New Deliverable'))`, 90000, "New Deliverable button");
    await clickText("button", ["New Deliverable"]);
    await waitForVisibleDialog("deliverable modal");
    if (!(await selectOption("Campaign", "CMP-0001"))) throw new Error("campaign select failed");
    if (!(await setLabeled("Title", TEASER))) throw new Error("title not filled");
    await setLabeled("Due Date", daysFromNow(5));
    if (!(await checkCheckbox("Requires client approval"))) throw new Error("approval checkbox not toggled");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await bodyText()).includes(TEASER), 30000, "deliverable row");
    const docs = await fsList(`companies/${COMPANY_ID}/mkt_deliverables`);
    const d = docs.find((x) => x.title === TEASER);
    if (!d) throw new Error("deliverable not persisted");
    deliverableId = d.id;
    if (d.status !== "not_started") throw new Error(`new deliverable must start not_started, got ${d.status}`);
    if (d.requiresClientApproval !== true) throw new Error("requiresClientApproval not persisted");
    // Walk the machine through the guarded modal.
    for (const [from, to] of [["not_started", "In Progress"], ["in_progress", "In Review"]]) {
      void from;
      await clickRowButton(TEASER, ["Change Status"]);
      await waitFor(`!!(document.querySelector('[role="dialog"] [role="combobox"], [role="dialog"] button[aria-haspopup="listbox"]'))`, 15000, "transition modal");
      if (to === "In Review") {
        // in_review must NOT offer a direct publish edge.
        const txt = await bodyText();
        if (/Move to Published/i.test(txt)) throw new Error("SKIP EDGE in_review->published exposed!");
      }
      if (!(await selectOption("Move to", to))) throw new Error(`select ${to} failed`);
      await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
      await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_deliverables/${deliverableId}`))?.status === to.toLowerCase().replace(" ", "_"), 30000, `${to} persisted`);
      await sleep(600);
    }
    await clickRowButton(TEASER, ["Change Status"]);
    await waitFor(`!!(document.querySelector('[role="dialog"]'))`, 15000, "transition modal 2");
    if (!(await selectOption("Move to", "Approved"))) throw new Error("select approved failed");
    await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_deliverables/${deliverableId}`))?.status === "approved", 30000, "approved persisted");
    await shot("11-deliverable-approved");
    return "review machine walked exactly along legal edges";
  });

  // ---------- Step 12: client sign-off publication gate ----------
  await step("12. Publishing held until the client decision is recorded, then succeeds", async () => {
    await clickRowButton(TEASER, ["Change Status"]);
    await waitForVisibleDialog("transition modal");
    if (!(await selectOption("Move to", "Published"))) throw new Error("select published failed");
    // The Confirm button mounts a frame after the dialog animates open; poll
    // for it to render as DISABLED instead of misreading a transient "no-button".
    await waitUntil(async () => (await dialogButtonState("Confirm")) === "disabled", 8000, "publish Confirm disabled (no sign-off)");
    if (!/blocked until the client approval/i.test(await bodyText())) throw new Error("publication gate hint not shown");
    await closeModal();
    // Record the sign-off: not_required -> pending -> approved.
    await clickRowButton(TEASER, ["Client Approval"]);
    await waitForVisibleDialog("approval modal");
    if (!(await clickText("button", ["Mark Pending"], { within: '[role="dialog"]' }))) throw new Error("mark pending not found");
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_deliverables/${deliverableId}`))?.clientApprovalState === "pending", 30000, "pending recorded");
    // The sign-off modal's legal options are derived from the LIST row object
    // (cache-backed), so wait for the refetch to repaint it to "Pending"
    // before reopening — otherwise the modal still reads the stale
    // not_required state and offers only "Mark Pending".
    await waitUntil(async () => (await js(`(() => {
      const r = Array.from(document.querySelectorAll('tr')).find(x => (x.innerText || '').includes('${TEASER}'));
      return !!r && /Pending/.test(r.innerText) && !/Not Required/.test(r.innerText);
    })()`)) === true, 20000, "row repaints to Pending");
    await clickRowButton(TEASER, ["Client Approval"]);
    await waitForVisibleDialog("approval modal 2");
    await setLabeled("Note", "Brand manager signed off via email thread #441");
    if (!(await clickText("button", ["Mark Approved"], { within: '[role="dialog"]' }))) throw new Error("mark approved not found");
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_deliverables/${deliverableId}`);
      return d?.clientApprovalState === "approved" && (d.clientApprovalHistory || []).length === 2;
    }, 30000, "approved with two history records");
    // Wait for the LIST row to re-render off the refetched data before
    // reopening the transition modal (the gate reads the row object).
    await waitUntil(async () => (await js(`(() => {
      const r = Array.from(document.querySelectorAll('tr')).find(x => (x.innerText || '').includes('${TEASER}'));
      return !!r && /Approved/.test(r.innerText) && !/Pending|Not Required/.test(r.innerText);
    })()`)) === true, 20000, "row shows client approval landed");
    // Now publication is legal.
    await clickRowButton(TEASER, ["Change Status"]);
    await waitForVisibleDialog("transition modal 3");
    if (!(await selectOption("Move to", "Published"))) throw new Error("re-select published failed");
    await waitUntil(async () => (await dialogButtonState("Confirm")) === "enabled", 10000, "publish Confirm enabled after sign-off");
    await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/mkt_deliverables/${deliverableId}`);
      return d?.status === "published" && !!d.publishedAt;
    }, 30000, "published + publishedAt stamped");
    await shot("12-published");
    return "gate held, sign-off audited (2 records), publishedAt server-stamped";
  });

  // ---------- Step 13: content calendar with the date precondition ----------
  await step("13. Content: scheduling held until a date exists, then scheduled -> published", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/content`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').includes('New Content'))`, 90000, "New Content button");
    await clickText("button", ["New Content"]);
    await waitForVisibleDialog("content modal");
    if (!(await selectOption("Campaign", "CMP-0001"))) throw new Error("campaign select failed");
    if (!(await setLabeled("Title", CAROUSEL))) throw new Error("title not filled");
    // NOTE: the channel field's placeholder is literally "Social Media", and
    // the blank option carries the placeholder text — picking "Email" avoids
    // the ambiguity between the none-option and the real one.
    if (!(await selectOption("Channel", "Email"))) throw new Error("channel select failed");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await bodyText()).includes(CAROUSEL), 30000, "content row");
    const docs = await fsList(`companies/${COMPANY_ID}/mkt_content_items`);
    const c0 = docs.find((x) => x.title === CAROUSEL);
    if (!c0 || c0.status !== "draft") throw new Error("content not persisted as draft");
    contentId = c0.id;
    // draft -> approved (legal edge).
    await clickRowButton(CAROUSEL, ["Change Status"]);
    await waitForVisibleDialog("transition modal A");
    if (!(await selectOption("Move to", "Approved"))) throw new Error("select approved failed");
    await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_content_items/${contentId}`))?.status === "approved", 30000, "approved");
    // approved -> scheduled must be blocked without a date.
    await clickRowButton(CAROUSEL, ["Change Status"]);
    await waitForVisibleDialog("transition modal 2");
    if (!(await selectOption("Move to", "Scheduled"))) throw new Error("select scheduled failed");
    await waitUntil(async () => (await dialogButtonState("Confirm")) === "disabled", 8000, "schedule Confirm disabled (no date)");
    if (!/scheduled date must be set/i.test(await bodyText())) throw new Error("date-precondition hint not shown");
    await closeModal();
    // Edit: add the date.
    await clickRowButton(CAROUSEL, ["Edit"]);
    await waitForVisibleDialog("edit modal");
    await setLabeled("Scheduled Date", daysFromNow(3));
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_content_items/${contentId}`))?.scheduledDate === daysFromNow(3), 30000, "date persisted");
    // The schedule gate reads the LIST row object, so wait for the content
    // refetch to repaint the scheduled-date cell before reopening the
    // transition modal — otherwise dateBlocked stays true from stale data and
    // Confirm is wrongly disabled on the first Scheduled attempt.
    await waitUntil(async () => (await js(`(() => {
      const r = Array.from(document.querySelectorAll('tr')).find(x => (x.innerText || '').includes('${CAROUSEL}'));
      return !!r && r.innerText.includes('${daysFromNow(3)}');
    })()`)) === true, 20000, "row repaints scheduled date");
    // -> scheduled -> published.
    for (const to of ["Scheduled", "Published"]) {
      await clickRowButton(CAROUSEL, ["Change Status"]);
      await waitForVisibleDialog("transition modal B");
      if (!(await selectOption("Move to", to))) throw new Error(`select ${to} failed`);
      await clickText("button", ["Confirm"], { within: '[role="dialog"]' });
      await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/mkt_content_items/${contentId}`))?.status === to.toLowerCase(), 30000, `${to} persisted`);
      await sleep(500);
    }
    const pub = await fsGet(`companies/${COMPANY_ID}/mkt_content_items/${contentId}`);
    if (!pub.publishedAt) throw new Error("publishedAt not stamped");
    await shot("13-content-published");
    return "date precondition enforced in UI; publishedAt server-stamped";
  });

  // ---------- Step 14: brief with attachment ----------
  await step("14. Creative brief with attachment persists (tenant storage path contract)", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/briefs`);
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => (b.innerText||'').includes('New Brief'))`, 90000, "New Brief button");
    await clickText("button", ["New Brief"]);
    await waitForVisibleDialog("brief modal");
    if (!(await selectOption("Campaign", "CMP-0001"))) throw new Error("campaign select failed");
    if (!(await setLabeled("Title", BRIEF))) throw new Error("title not filled");
    if (!(await setLabeled("Brief Body", "Warm tungsten look, product-first frames, Arabic-first copy"))) throw new Error("body not filled");
    // Inject a small file into the hidden input; the upload helper lands it
    // inline (data URL) against the fake bucket — the service re-validates
    // the URL shape either way, and storage-rule paths are covered by the
    // dedicated rules suite.
    const injected = await js(`(() => {
      const inp = document.querySelector('[role="dialog"] input[type="file"], input[type="file"]');
      if (!inp) return false;
      const dt = new DataTransfer();
      dt.items.add(new File(['attachment-payload-for-e2e'], 'brief-note.txt', { type: 'text/plain' }));
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!injected) throw new Error("file input not found");
    await waitUntil(async () => (await js(`(document.querySelector('[role="dialog"]')||document.body).innerText.includes('brief-note.txt')`)), 20000, "attachment listed in modal");
    await clickText("button", ["Save"], { within: '[role="dialog"]' });
    await waitUntil(async () => (await bodyText()).includes(BRIEF), 30000, "brief row");
    const docs = await fsList(`companies/${COMPANY_ID}/mkt_briefs`);
    const b = docs.find((x) => x.title === BRIEF);
    if (!b) throw new Error("brief not persisted");
    if (!Array.isArray(b.attachments) || b.attachments.length !== 1) throw new Error(`attachment not persisted: ${JSON.stringify(b.attachments)}`);
    const url = String(b.attachments[0]?.url || "");
    if (!(url.startsWith("data:") || url.includes("mkt_briefs"))) throw new Error(`unexpected attachment url shape: ${url.slice(0, 80)}`);
    if (b.campaignId !== campaignId) throw new Error("brief campaign link wrong");
    await shot("14-brief");
    return "brief + attachment persisted with the campaign link";
  });

  // ---------- Step 15: reports from persisted data only ----------
  await step("15. Reports page shows budget-vs-actual + delivery summary from persisted records", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/reports`);
    await waitUntil(async () => (await bodyText()).includes("Budget vs Actual by Campaign"), 40000, "reports cards");
    const txt = await bodyText();
    for (const needle of [CMP, "12,500.5", "30,000", "10,000", "Delivery Summary", "Awaiting Client Decision"]) {
      if (!txt.includes(needle)) throw new Error(`reports missing "${needle}"`);
    }
    if (/Over budget/i.test(txt)) throw new Error("over-budget flag shown while under budget!");
    await shot("15-reports");
    return "figures derived live from mkt_expenses + linked billing invoice";
  });

  // ---------- Step 16: authorization probes ----------
  await step("16. Cross-tenant read denied; member may not switch the tenant activity", async () => {
    const stOutsider = await fsGetStatus(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`, outsiderToken);
    if (stOutsider !== 403) throw new Error(`outsider read expected 403, got ${stOutsider}`);
    const stEmp = await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "PROJECTS" }, empToken);
    if (stEmp !== 403) throw new Error(`employee activity-switch expected 403, got ${stEmp}`);
    const still = await fsGet(`companies/${COMPANY_ID}`);
    if (still.primaryActivity !== "MARKETING_AGENCY") throw new Error("switch was denied yet the value changed!");
    return `outsider=${stOutsider} employee-switch=${stEmp} (both denied, value unchanged)`;
  });

  // ---------- Step 17: deactivation blocks but preserves ----------
  await step("17. Inactive activity blocks UI and REST reads; records survive reactivation intact", async () => {
    const patchSt = await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "REAL_ESTATE_MANAGEMENT" });
    if (patchSt >= 400) throw new Error(`admin switch to REM failed: ${patchSt}`);
    const stMkt = await fsGetStatus(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
    if (stMkt !== 403) throw new Error(`admin read of mkt data under inactive activity expected 403, got ${stMkt}`);
    await goto(`http://localhost:${VITE_PORT}/agency`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "denied card under inactive activity");
    await shot("17-denied-while-inactive");
    await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "MARKETING_AGENCY" });
    await goto(`http://localhost:${VITE_PORT}/agency/campaigns`);
    await waitUntil(async () => {
      const t = await bodyText();
      return t.includes("CMP-0001") && t.includes(CMP);
    }, 40000, "campaign visible again");
    const c = await fsGet(`companies/${COMPANY_ID}/mkt_campaigns/${campaignId}`);
    if (c.status !== "active" || Number(c.budgetAmount) !== 50000 || (c.budgetRevisions || []).length !== 1) {
      throw new Error("campaign data mutated across the activity switch!");
    }
    await shot("17-records-survived");
    return "blocked while inactive; identical records after reactivation";
  });

  // ---------- Step 18: shared modules + other namespaces unaffected ----------
  await step("18. CRM + billing still work under Marketing; facilities stays denied, PROJECTS stays reachable", async () => {
    await goto(`http://localhost:${VITE_PORT}/crm/contacts`);
    await waitUntil(async () => (await bodyText()).includes("Globex Foods"), 60000, "CRM contacts list");
    await goto(`http://localhost:${VITE_PORT}/billing/invoices`);
    await waitUntil(async () => (await bodyText()).includes("MKT-INV-0001"), 90000, "billing invoices list");
    await goto(`http://localhost:${VITE_PORT}/facilities`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "facilities denial under Marketing");
    await goto(`http://localhost:${VITE_PORT}/projects`);
    // Projects is a CORE module (activity-routes.ts CORE_ROUTE_PREFIXES),
    // intentionally reachable under every activity — so it must render here,
    // NOT resolve to the activity-denied card. This guards the fixed
    // "Projects disappeared when switching activity" regression.
    await waitUntil(async () => (await bodyText()).includes("New Project"), 40000, "projects core module reachable under Marketing");
    if ((await bodyText()).includes("Section not available")) throw new Error("PROJECTS must stay reachable as a core module under Marketing");
    await shot("18-shared-modules-ok");
    return "CRM/billing render; facilities denied; PROJECTS core module stays reachable";
  });

  // ---------- Step 19: register a client through the CRM UI (not a seed) ----------
  await step("19. Register a new client through the CRM contacts form (real CRUD under the tenant)", async () => {
    const NOVA_FIRST = "Nova";
    const NOVA_LAST = "Retail Group";
    await goto(`http://localhost:${VITE_PORT}/crm/contacts`);
    await waitUntil(async () => (await bodyText()).includes("Globex Foods"), 60000, "CRM contacts list loaded");
    if (!(await clickText("button", ["add contact"]))) throw new Error("Add contact button not found");
    await waitForVisibleDialog("contact form");
    if (!(await setLabeled("First Name", NOVA_FIRST))) throw new Error("first name not filled");
    if (!(await setLabeled("Last Name", NOVA_LAST))) throw new Error("last name not filled");
    // Individual contacts need phone OR email to pass validation.
    if (!(await setLabeled("Primary Phone", "0500000099"))) throw new Error("phone not filled");
    if (!(await clickTextExact(["Save Contact"]))) throw new Error("Save Contact button not found");
    await waitUntil(async () => {
      const rows = await fsList(`companies/${COMPANY_ID}/contacts`);
      return rows.some((c) => (c.firstName || "").includes(NOVA_FIRST) && (c.lastName || "").includes(NOVA_LAST));
    }, 30000, "new contact persisted to Firestore under the tenant");
    await waitUntil(async () => (await bodyText()).includes(NOVA_LAST), 30000, "new contact repaints the list");
    await shot("19-client-registered");
    return "client created through the real CRM form and persisted under the tenant";
  });

  // ---------- Step 20: campaign detail in-context links actually navigate ----------
  await step("20. Campaign detail client link resolves to the shared CRM contact (no dead buttons)", async () => {
    await goto(`http://localhost:${VITE_PORT}/agency/campaigns/${campaignId}`);
    // The client chip must be a real anchor to the shared contact, not plain text.
    const marked = await waitUntil(async () => js(`(() => {
      const isVis = ${VIS};
      const a = Array.from(document.querySelectorAll('a[href^="/crm/contacts/"]')).find((x) => isVis(x) && (x.innerText || '').includes('Globex'));
      if (!a) return false;
      a.setAttribute('data-e2e-press', '1');
      return true;
    })()`), 40000, "client in-context anchor renders").catch(() => false);
    if (!marked) throw new Error("campaign client link did not render");
    const href = await js(`(() => { const a = document.querySelector('[data-e2e-press]'); return a ? a.getAttribute('href') : null; })()`);
    if (!href || !/^\/crm\/contacts\//.test(href)) throw new Error(`client link malformed: ${href}`);
    await trustedClickMarked();
    await waitUntil(async () => (await currentUrl()).includes("/crm/contacts/"), 20000, "navigated to CRM contact via the campaign link");
    await waitUntil(async () => (await bodyText()).includes("Globex"), 20000, "CRM contact detail renders the client");
    await shot("20-client-link-navigated");
    return `href=${href} → CRM contact detail rendered`;
  });
} finally {
  edgeProc.kill();
  viteProc.kill();
}

console.log("\n=================================================================");
const passed = results.filter((r) => r.ok).length;
console.log(` Marketing Agency Browser E2E Summary: ${passed}/${results.length} passed`);
for (const r of results.filter((x) => !x.ok)) console.log(`   ✗ ${r.name}: ${r.error}`);
console.log("=================================================================\n");
process.exit(passed === results.length ? 0 : 1);
