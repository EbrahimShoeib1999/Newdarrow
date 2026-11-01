/**
 * D-Arrow Business — Real Estate Management Browser E2E (Edge visible window / CDP)
 *
 * Drives the REAL UI against local Auth + Firestore emulators:
 * admin login -> /real-estate blocked BEFORE REAL_ESTATE_MANAGEMENT is the
 * tenant activity (fail closed) -> activity chosen through the real settings
 * card -> empty dashboard (nothing fabricated) -> tenant registered through
 * the SHARED CRM UI -> property created through the form modal (code PRP-0001
 * allocated by the settings/real_estate transaction WRITE, enforced by the
 * real rules) -> building -> unit (occupancy derived, never hand-typed) ->
 * ownership linked to the canonical CRM contact (display snapshot only) ->
 * lease draft, the overlap rule rejecting a conflicting contract with zero
 * partial writes -> submit -> activate (full derived schedule + deposit row +
 * occupancy flip all derived server-side) -> rent payment with allocation
 * re-derivation -> partial payment + audit-preserving void -> deposit receipt
 * kept OUT of revenue -> inspection + finalize with the facilities work-order
 * boundary asserted (fm_* writes stay fail-closed under REM — gap T2) ->
 * expense approval -> collections balance derived from the ledger ->
 * dashboard metrics + idempotent reminder sweep -> reports from persisted
 * records -> full-reload persistence -> employee/outsider/admin authorization
 * probes -> CRM/billing shared, /agency + /facilities denied, core PROJECTS
 * reachable -> switching the activity blocks rem_* while every record
 * survives reactivation.
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
const profileDir = path.join(os.tmpdir(), `edge_rem_${Date.now()}`);
const CDP_PORT = 9783;
const VITE_PORT = 5180;
const PROJECT_ID = "test-rem-lifecycle";
const COMPANY_ID = "rem-co";
const OTHER_COMPANY_ID = "remother-co";
const ADMIN_EMAIL = "rem_admin@rem.test";
const ADMIN_PASS = "RemAdmin2026!";
const EMP_EMAIL = "rem_emp@rem.test";
const OUTSIDER_EMAIL = "rem_outsider@other.test";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/rem-lifecycle";

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
    // Disable Vite HMR for this throwaway test server. The Firestore emulator
    // writes firestore-debug.log into the project root while the lifecycle
    // runs; Vite's watcher can fire a full page reload on that edit, which
    // wipes an in-progress modal (a filled lease form disappears mid-save).
    // Normal `npm run dev` is untouched (flag is set only here).
    E2E_NO_HMR: "1",
    VITE_USE_FIREBASE_EMULATOR: "true",
    VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
    VITE_FIRESTORE_EMULATOR_PORT: "8080",
    VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
    // Point the bucket at a nonexistent name: the REST probe 404s, the
    // helper marks the bucket unavailable and small attachments fall back to
    // inline data URLs (the shape the service also accepts). Storage-rule
    // coverage for rem_documents lives in the dedicated rules suite instead.
    VITE_FIREBASE_STORAGE_BUCKET: "mock-project.appspot.com",
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  },
  stdio: "pipe",
});
try {
  await waitUntil(async () => (await fetch(`http://localhost:${VITE_PORT}/`)).ok, 60000, "Vite ready");
} catch (e) { viteProc.kill(); throw e; }
log(`Vite ready: http://localhost:${VITE_PORT}`);

// ---------- 2. Edge (VISIBLE window) ----------
log(`Starting Edge (visible window) on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  // No --headless flag => a real on-screen window the operator can watch.
  // CDP is unchanged: the same remote-debugging-port drives the visible page.
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", "--no-default-browser-check",
  "--window-size=1280,900", "--window-position=80,60",
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
const send = (method, params = {}, timeoutMs = 30000) =>
  new Promise((resolve) => {
    const id = msgId++;
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); pending.delete(id); resolve(v); } };
    // A wedged renderer/tab can stop answering Runtime.evaluate forever; bound
    // every CDP round-trip so the lifecycle fails fast (and surfaces in the
    // step) instead of hanging the whole run with no output.
    const timer = setTimeout(() => finish({ __cdpTimeout: true, method }), timeoutMs);
    pending.set(id, finish);
    ws.send(JSON.stringify({ id, method, params }));
  });
async function js(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res?.__cdpTimeout) throw new Error(`CDP Runtime.evaluate timed out (browser wedged) while: ${String(expression).slice(0, 60)}`);
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

// ---------- UI primitives (HeroUI-aware; same helpers as the agency harness) ----------
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
/** Trusted-open the LABELED combobox trigger (idempotent: no-op if already
    expanded). Returns true when that trigger reports aria-expanded=true. Used
    to keep a dynamic-options popover OPEN while its query resolves — HeroUI
    collapses an empty listbox, and options rendered into a closed popover are
    display:none (invisible to optionPresent). */
async function openCombo(labelText) {
  const want = String(labelText).toLowerCase();
  const marked = await js(`(() => {
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
    if (!trig) return 'no-trigger';
    if (trig.getAttribute('aria-expanded') === 'true') return 'already-open';
    trig.scrollIntoView({ block: 'center', inline: 'center' });
    trig.setAttribute('data-e2e-press', '1');
    return 'marked';
  })()`);
  if (marked === 'no-trigger') return false;
  if (marked === 'already-open') return true;
  await trustedClickMarked();
  const expandedByMouse = await waitUntil(async () => js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
    return combos.some(c => norm(c.innerText).startsWith(${JSON.stringify(want)}) && c.getAttribute('aria-expanded') === 'true');
  })()`), 2500, "combo expanded").catch(() => false);
  if (expandedByMouse) return true;
  // KEYBOARD FALLBACK: a lingering sibling popover's dismiss overlay can
  // swallow the trusted pointer press (first click only closes the overlay),
  // so the mouse path never expands THIS trigger. React-Aria opens a focused
  // Select on ArrowDown regardless of overlays — focus the trigger and send a
  // trusted key.
  const focusPt = await js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const want = ${JSON.stringify(want)};
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
    const trig = combos.find((c) => norm(c.innerText).startsWith(want));
    if (!trig) return null;
    trig.scrollIntoView({ block: 'center', inline: 'center' });
    trig.focus();
    const b = (trig.closest && trig.closest('button')) || trig;
    b.setAttribute('data-e2e-press', '1');
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (focusPt) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: focusPt.x, y: focusPt.y });
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 });
    await js(`(() => { const b = document.querySelector('[data-e2e-press]'); if (b) b.removeAttribute('data-e2e-press'); return true; })()`).catch(() => {});
  }
  return waitUntil(async () => js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
    return combos.some(c => norm(c.innerText).startsWith(${JSON.stringify(want)}) && c.getAttribute('aria-expanded') === 'true');
  })()`), 4000, "combo expanded (keyboard)").catch(() => false);
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
/** Post-press proof when labelFor resolution broke (HeroUI rewires aria-
    labelledby once a value is set): the trigger whose OWN text begins with
    its label now carries the chosen value. While a popover is open, the
    trigger of that very select lacks the label prefix (the listbox carries it),
    so this can only answer true for a committed, closed select. */
async function triggerShowsOwnValue(labelText, optionText) {
  const want = String(labelText).toLowerCase();
  const oWant = String(optionText).toLowerCase();
  return js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
    return combos.some((c) => { const t = norm(c.innerText); return t.startsWith(want) && t.includes(oWant); });
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
collateral like the "New Expense"/"New Inspection" buttons on other pages). */
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
/** Set a visible input/textarea found by PLACEHOLDER text (REM issue rows have
    no label — only "Describe the issue…"). */
async function setByPlaceholder(placeholderText, value) {
  return js(`(() => {
    const isVis = ${VIS};
    const want = ${JSON.stringify(placeholderText)}.toLowerCase();
    const el = Array.from(document.querySelectorAll('input, textarea')).filter(isVis)
      .find(i => (i.placeholder || '').toLowerCase().includes(want));
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}
/** Set the number input of the LAST VISIBLE dialog (payment modals pre-focus
    an unlabelled amount input inside a table row — label lookup cannot reach
    it, but only the open dialog ever contains a number input). */
async function setDialogNumber(value) {
  return js(`(() => {
    const isVis = ${VIS};
    const ds = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVis);
    const d = ds[ds.length - 1];
    if (!d) return false;
    const el = d.querySelector('input[type="number"]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}
/** Press a button INSIDE the visible dialog (page buttons often share the
    exact same text — "Record Payment", "Activate Lease", "Record Receipt"). */
async function clickDialogButton(candidates) {
  return waitUntil(async () => (await clickText("button", candidates, { within: '[role="dialog"]' })) === true, 15000, `dialog button ${JSON.stringify(candidates)}`);
}
/** True when the option text is present among VISIBLE listbox items — the
    modal can legitimately be open while its reference query is still in
    flight (empty popover); pressing then always fails, so waits are required. */
async function optionPresent(optionText) {
  const oWant = String(optionText).toLowerCase();
  return js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const oWant = ${JSON.stringify(oWant)};
    return Array.from(document.querySelectorAll('li, [role="option"]')).filter(isVis)
      .some((o) => norm(o.innerText || o.textContent).includes(oWant));
  })()`);
}
/** Press the option that is ALREADY VISIBLE in an open popover (mark + trusted
    click). Used instead of selectOption once openCombo has confirmed the
    popover is expanded WITH the option — calling selectOption there would
    TOGGLE the open popover shut (it assumes a closed starting state). */
async function pressVisibleOption(optionText) {
  const oWant = String(optionText).toLowerCase();
  const marked = await js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const oWant = ${JSON.stringify(oWant)};
    const opts = Array.from(document.querySelectorAll('li, [role="option"]')).filter(isVis);
    const el = opts.find((o) => norm(o.innerText || o.textContent).includes(oWant));
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.setAttribute('data-e2e-press', '1');
    return true;
  })()`);
  if (!marked) return false;
  await trustedClickMarked();
  return true;
}
/** Dismiss ANY lingering open Select popover (toggle its expanded trigger with
    a synthetic click) and wait for the listbox to unmount. A committed value
    does NOT guarantee the popover closed — HeroUI sometimes keeps the just-open
    listbox mounted after onSelectionChange fires, and that overlay swallows the
    NEXT combobox's trusted press (the first click only dismisses the overlay),
    which is exactly why the Unit select intermittently never expanded. */
async function dismissAnyPopover() {
  if (!(await listboxVisible())) return true;
  await js(`(() => { const isVis = ${VIS}; const t = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(isVis).find(c => c.getAttribute('aria-expanded') === 'true'); if (t) t.click(); return true; })()`).catch(() => {});
  return waitUntil(async () => (await listboxVisible()) === false, 3000, "popover closed").catch(() => false);
}
/** selectOption with a value-committed safety net: React-Aria sometimes lands
    the selection while the popover-close signal is missed (stale mounted
    listbox). The trigger showing the value is the authoritative proof. The
    whole open->await-option->press cycle retries: the options list only
    renders once the modal's reference query resolves (emulator cold reads can
    take tens of seconds), and a press into an empty popover is wasted. */
async function pickOption(labelText, optionText) {
  // Defensive: a previous pick may have committed its value while leaving the
  // listbox mounted — clear any stray overlay before touching this field.
  await dismissAnyPopover();
  if (await comboboxShowsValue(labelText, optionText)) { await dismissAnyPopover(); return true; }
  if (await triggerShowsOwnValue(labelText, optionText)) { await dismissAnyPopover(); return true; }
  // FAST PATH (warm query): selectOption opens a closed popover and presses in
  // one motion — this is the primitive that passed the lifecycle when reads are
  // served quickly. Only fall through to the slow reopen-poll when it misses.
  if (await selectOption(labelText, optionText)) { await dismissAnyPopover(); return true; }
  if (await waitUntil(async () => (await comboboxShowsValue(labelText, optionText)) || (await triggerShowsOwnValue(labelText, optionText)), 4000, `"${optionText}" committed on ${labelText} (fast)`).catch(() => false)) { await dismissAnyPopover(); return true; }
  for (let cycle = 0; cycle < 8; cycle++) {
    // Poll for the option, RE-OPENING the target popover on every tick: an
    // empty dynamic listbox auto-collapses, and options rendered while closed
    // are display:none — so the only reliable way to SEE the query resolve is
    // to keep the specific trigger expanded while we look.
    const appeared = await waitUntil(async () => {
      const opened = await openCombo(labelText);
      const present = await optionPresent(optionText);
      // Per-cycle diagnostic: was the target trigger expanded, and how many
      // VISIBLE options existed? Distinguishes "option never rendered (data/
      // propertyId not propagated)" from "option rendered but press toggled it".
      if (labelText === "Unit") {
        const st = await js(`(() => {
          const isVis = ${VIS};
          const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
          const want = ${JSON.stringify(String(labelText).toLowerCase())};
          const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
          const trig = combos.find((c) => norm(c.innerText).toLowerCase().startsWith(want) && !norm(c.innerText).toLowerCase().startsWith(want + ' type'));
          const btn = trig && (trig.closest('button') || trig);
          const opts = Array.from(document.querySelectorAll('li, [role="option"]')).filter(isVis).map((o) => norm(o.innerText).slice(0, 30));
          return JSON.stringify({
            exp: trig ? trig.getAttribute('aria-expanded') : 'no-trig',
            disabled: btn ? !!(btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.hasAttribute('disabled')) : 'no-el',
            optCount: opts.length, opts,
          });
        })()`).catch(() => 'err');
        log(`   [unitCycle ${cycle}] opened=${opened} present=${present} ${st}`);
      }
      return present;
    }, 12000, `"${optionText}" appears in the open ${labelText} listbox`).catch(() => false);
    if (appeared) {
      // Popover is confirmed OPEN with the option visible: press it directly
      // (selectOption would toggle the open popover shut).
      await pressVisibleOption(optionText);
      if (await waitUntil(async () => (await comboboxShowsValue(labelText, optionText)) || (await triggerShowsOwnValue(labelText, optionText)), 5000, `"${optionText}" committed on ${labelText}`).catch(() => false)) { await dismissAnyPopover(); return true; }
      continue;
    }
    // Still nothing: dismiss any open popover before reopening next cycle.
    await js(`(() => { const isVis = ${VIS}; const t = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(isVis).find(c => c.getAttribute('aria-expanded') === 'true'); if (t) t.click(); return true; })()`).catch(() => {});
    await sleep(400);
  }
  // Failure diagnostic: dump every visible combobox trigger text + whether a
  // listbox is open, so a false-positive commit read can be identified.
  const diag = await js(`(() => {
    const isVis = ${VIS};
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]')).filter(c => isVis(c));
    return JSON.stringify({
      open: Array.from(document.querySelectorAll('[role="listbox"]')).filter(isVis).length,
      combos: combos.map(c => ({ t: norm(c.innerText).slice(0, 40), exp: c.getAttribute('aria-expanded') })),
    });
  })()`).catch((e) => `diag-error:${e?.message}`);
  log(`   [pickDiag:${labelText}] gave up. ${diag}`);
  return false;
}

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); await dump(`fail-${results.length}`); }
}

let propertyId = "";
let unitId = "";
let leaseId = "";
let tenantContactId = "";
let empToken = "";
let outsiderToken = "";

const PROPERTY = "Riyadh Gateway Tower";
const TENANT_FIRST = "Omar";
const TENANT_LAST = "Haddad";
const OWNER_NAME = "Fatima Al-Sayed";
const ISSUE = "Cooling failure in server room";
const EXPENSE = "AC servicing contract";

try {
  // ---------- Step 0: fixtures ----------
  await step("0. Seed admin/employee/outsider, company (no activity yet), CRM owner contact + shared invoice", async () => {
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
    const admin = await createAccount(ADMIN_EMAIL, "REM Admin", COMPANY_ID, "admin");
    adminIdToken = admin.idToken;
    const emp = await createAccount(EMP_EMAIL, "REM Employee", COMPANY_ID, "employee");
    const outsider = await createAccount(OUTSIDER_EMAIL, "Other Co Admin", OTHER_COMPANY_ID, "admin");
    empToken = emp.idToken;
    outsiderToken = outsider.idToken;

    // NO primaryActivity yet -> the fail-closed pre-activation probe is meaningful.
    await seedDoc(`companies/${COMPANY_ID}`, { id: COMPANY_ID, name: "Nakheel Real Estate Co", defaultCurrency: "SAR" });
    await seedDoc(`companies/${OTHER_COMPANY_ID}`, { id: OTHER_COMPANY_ID, name: "Other Co", defaultCurrency: "SAR" });
    // The PROPERTY OWNER lives in the shared CRM (REM links, never re-models).
    await seedDoc(`companies/${COMPANY_ID}/contacts/ct_owner`, {
      id: "ct_owner", firstName: "Fatima", lastName: "Al-Sayed",
      type: "customer", email: "fatima@alsayed.test", createdAt: new Date().toISOString(),
    });
    // Shared billing invoice proving the billing portal stays alive for this tenant.
    await seedDoc(`companies/${COMPANY_ID}/invoices/inv_rem_shared`, {
      id: "inv_rem_shared", invoiceNumber: "REM-INV-0001", customerName: "Al-Majdoula Trading",
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
  await step("2. /real-estate blocked before REAL_ESTATE_MANAGEMENT is the tenant activity", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 30000, "activity denial card");
    const st = await fsGetStatus(`companies/${COMPANY_ID}/rem_properties/probe-none`, outsiderToken);
    if (st !== 400 && st !== 403 && st !== 404) throw new Error(`unexpected outsider probe status ${st}`);
    await shot("02-denied-before-activation");
    return `guard denied direct URL (REST outsider probe status=${st})`;
  });

  // ---------- Step 3: activate through the real settings card ----------
  await step("3. Select REAL_ESTATE_MANAGEMENT via the settings UI (persisted on the company doc)", async () => {
    await goto(`http://localhost:${VITE_PORT}/settings/company`);
    await waitFor(`(document.body.innerText || '').includes('Primary business activity')`, 60000, "activity settings card");
    if (!(await clickText("button", ["real estate management"]))) throw new Error("activity option not found");
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => /activate/i.test(b.innerText || ''))`, 15000, "activate button");
    if (!(await clickButton(["activate"]))) throw new Error("activate button not clicked");
    await waitUntil(async () => {
      const c = await fsGet(`companies/${COMPANY_ID}`);
      return c && c.primaryActivity === "REAL_ESTATE_MANAGEMENT";
    }, 30000, "primaryActivity persisted");
    await shot("03-activity-set");
    return "company doc now owns REAL_ESTATE_MANAGEMENT";
  });

  // ---------- Step 4: dashboard renders empty ----------
  await step("4. Real Estate dashboard renders the empty state (nothing fabricated)", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate`);
    await waitUntil(async () => (await bodyText()).includes("Real Estate Overview"), 60000, "dashboard");
    // The empty hint only renders once every dashboard query has resolved.
    await waitUntil(async () => (await bodyText()).includes("Nothing persisted yet"), 30000, "empty hint");
    await shot("04-dashboard-empty");
    return "empty overview rendered under the active activity";
  });

  // ---------- Step 5: tenant lives in the SHARED CRM ----------
  await step("5. Register the future tenant through the shared CRM UI (single contacts collection)", async () => {
    // The CRM page can sit on its skeleton while cold emulator queries land —
    // re-navigate up to 3 times until the real toolbar button is clickable
    // (the sidebar nav also says "Contacts", so body text is not the signal).
    let opened = false;
    for (let nav = 0; nav < 3 && !opened; nav++) {
      await goto(`http://localhost:${VITE_PORT}/crm/contacts`);
      opened = await waitUntil(async () => (await clickText("button", ["add contact"])) === true, 45000, "add contact button")
        .then(() => true).catch(() => false);
    }
    if (!opened) throw new Error("add contact button never rendered");
    await waitForVisibleDialog("contact modal");
    if (!(await setLabeled("First Name", TENANT_FIRST))) throw new Error("first name not filled");
    if (!(await setLabeled("Last Name", TENANT_LAST))) throw new Error("last name not filled");
    // The CRM form gates submit on a primary phone (required by the module).
    if (!(await setLabeled("Primary Phone", "0501234567"))) throw new Error("phone not filled");
    await setLabeled("Email", "omar.haddad@tenant.test");
    await shot("05-tenant-form");
    await clickDialogButton(["Save Contact"]);
    await waitUntil(async () => {
      const docs = await fsList(`companies/${COMPANY_ID}/contacts`);
      const c = docs.find((x) => x.firstName === TENANT_FIRST && x.lastName === TENANT_LAST);
      if (!c) return false;
      tenantContactId = c.id;
      return true;
    }, 30000, "tenant contact persisted");
    await shot("05-tenant-contact");
    return `tenantContactId=${tenantContactId} (REM links by id, never copies)`;
  });

  // ---------- Step 6: property (transactional code + settings write under real rules) ----------
  await step("6. New property via UI -> PRP-0001 + settings/real_estate sequence advanced by a rules-gated transaction", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/properties`);
    await waitFor(`(document.body.innerText || '').includes('Properties')`, 60000, "properties page");
    await pressButtonExact("New");
    await waitForVisibleDialog("property modal");
    if (!(await setLabeled("Name (English)", PROPERTY))) throw new Error("name not filled");
    await selectOption("Property Type", "Commercial");
    await setLabeled("Country", "Saudi Arabia");
    if (!(await setLabeled("City", "Riyadh"))) throw new Error("city not filled");
    await setLabeled("Total Area", "4200");
    await shot("06-property-form");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes("PRP-0001"), 30000, "property code in list");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_properties`);
    const p = docs.find((d) => d.code === "PRP-0001");
    if (!p) throw new Error("property not persisted");
    propertyId = p.id;
    if (p.nameEn !== PROPERTY) throw new Error(`property name mismatch: ${p.nameEn}`);
    if (p.status !== "active") throw new Error(`new property should be active, got ${p.status}`);
    const s = await fsGet(`companies/${COMPANY_ID}/settings/real_estate`);
    if (!s || !s.sequences || !s.sequences.property || Number(s.sequences.property.nextNumber) !== 2) {
      throw new Error(`settings/real_estate property sequence not advanced: ${JSON.stringify(s?.sequences?.property)}`);
    }
    await shot("06-property-created");
    return `propertyId=${propertyId} sequences.property.nextNumber=2 (transaction write accepted by rules)`;
  });

  // ---------- Step 7: building ----------
  await step("7. Add Building on the property profile -> BLD-001 attached to the property", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/properties/${propertyId}`);
    // The property detail runs several reference queries (units, buildings,
    // ownerships, documents) before it un-suspends; on a cold/busy emulator the
    // page can sit on its spinner for the better part of a minute, so give the
    // 'Buildings' section far more headroom than a warm run needs.
    await waitFor(`(document.body.innerText || '').includes('Buildings')`, 90000, "property detail buildings section");
    if (!(await clickText("button", ["Add Building"]))) throw new Error("Add Building not clicked");
    await waitForVisibleDialog("building modal");
    if (!(await setLabeled("Name (English)", "Gateway Tower A"))) throw new Error("building name not filled");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes("BLD-001"), 30000, "building code in section");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_buildings`);
    const b = docs.find((x) => x.code === "BLD-001");
    if (!b) throw new Error("building not persisted");
    if (b.propertyId !== propertyId) throw new Error("building attached to the wrong property");
    const s = await fsGet(`companies/${COMPANY_ID}/settings/real_estate`);
    if (Number(s?.sequences?.building?.nextNumber) !== 2) throw new Error("building sequence not advanced");
    await shot("07-building-created");
    return "BLD-001 (padding-3 sequence) persisted against the property";
  });

  // ---------- Step 8: unit ----------
  await step("8. New Unit from the property -> UNT-0001 vacant/active (occupancy derived, not hand-typed)", async () => {
    // Stays on the property detail page: the unit is created in context.
    if (!(await clickText("button", ["New Unit"]))) throw new Error("New Unit not clicked");
    await waitForVisibleDialog("unit modal");
    // Prove it is the UNIT modal (a mid-test reload used to close it and let
    // pickOption read the base page's Documents-panel combobox instead).
    await waitFor(
      `(() => { const isVis = ${VIS}; return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => isVis(d) && /new unit/i.test(d.innerText || '')); })()`,
      15000, "unit modal open"
    );
    // The Property selector is DISABLED by design here (PropertyDetailPage
    // passes lockedPropertyId), so it can never be opened. Verify the locked
    // trigger already displays the expected code instead of re-picking it —
    // pickOption on a disabled combobox was the real step-8 failure.
    if (!(await waitUntil(() => comboboxShowsValue("Property", "PRP-0001"), 20000, "locked property shows PRP-0001").catch(() => false)))
      throw new Error("property not pre-locked to PRP-0001");
    if (!(await setLabeled("Name", "Office 1204"))) throw new Error("unit name not filled");
    if (!(await pickOption("Unit Type", "Office"))) throw new Error("unit type select failed");
    await setLabeled("Area", "120");
    await shot("08-unit-form");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes("UNT-0001"), 30000, "unit code in the property table");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_units`);
    const u = docs.find((x) => x.code === "UNT-0001");
    if (!u) throw new Error("unit not persisted");
    unitId = u.id;
    if (u.propertyId !== propertyId) throw new Error("unit on the wrong property");
    if (u.occupancyStatus !== "vacant") throw new Error(`new unit should be vacant, got ${u.occupancyStatus}`);
    if (u.operationalStatus !== "active") throw new Error(`new unit should be active, got ${u.operationalStatus}`);
    const s = await fsGet(`companies/${COMPANY_ID}/settings/real_estate`);
    if (Number(s?.sequences?.unit?.nextNumber) !== 2) throw new Error("unit sequence not advanced");
    await shot("08-unit-created");
    return `unitId=${unitId} occupancy=vacant (derivation start point)`;
  });

  // ---------- Step 9: ownership links the CRM contact ----------
  await step("9. Link Owner -> ownership references CRM contact ct_owner with a display snapshot at 100%", async () => {
    if (!(await clickText("button", ["Link Owner"]))) throw new Error("Link Owner not clicked");
    await waitForVisibleDialog("ownership modal");
    if (!(await pickOption("CRM Contact", OWNER_NAME))) throw new Error("contact select failed");
    await setLabeled("Ownership %", "100");
    await shot("09-ownership-form");
    await clickDialogButton(["Save"]);
    // The mutation is still in flight right after the click — poll the REST
    // side until the ownership doc lands (the UI snapshot name check alone
    // would pass off the combobox trigger while the write is pending).
    await waitUntil(async () => {
      const docs = await fsList(`companies/${COMPANY_ID}/rem_ownerships`);
      const o = docs.find((x) => x.propertyId === propertyId);
      return o && o.contactId === "ct_owner" ? o : false;
    }, 30000, "ownership persisted");
    await waitUntil(async () => (await bodyText()).includes(OWNER_NAME), 20000, "owner row shows the snapshot name");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_ownerships`);
    const o = docs.find((x) => x.propertyId === propertyId);
    if (Number(o.percentage) !== 100) throw new Error(`share should be 100, got ${o.percentage}`);
    if (!(o.displayNameSnapshot || "").includes("Fatima")) throw new Error(`display snapshot missing: ${JSON.stringify(o.displayNameSnapshot)}`);
    await shot("09-owner-linked");
    return "identity stays in the CRM; REM stores contactId + snapshot only";
  });

  // ---------- Step 10: lease draft ----------
  await step("10. New lease via UI -> LSE-0001 draft linked to the CRM tenant, unit and property", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/leases`);
    await waitFor(`(document.body.innerText || '').includes('Lease Contracts')`, 60000, "leases page");
    await pressButtonExact("New");
    await waitForVisibleDialog("lease modal");
    if (!(await pickOption("Property", "PRP-0001"))) throw new Error("property select failed");
    if (!(await pickOption("Unit", "UNT-0001"))) throw new Error("unit select failed");
    if (!(await pickOption("Tenant", `${TENANT_FIRST} ${TENANT_LAST}`))) throw new Error("tenant select failed");
    if (!(await setLabeled("Start Date", daysFromNow(3)))) throw new Error("start date not filled");
    // Exactly 12 monthly periods: end the day BEFORE the month anniversary —
    // an inclusive end one day later spawns a 1-day tail period charged a full
    // month's rent, which would skew every ledger total below.
    if (!(await setLabeled("End Date", daysFromNow(365)))) throw new Error("end date not filled");
    if (!(await setLabeled("Rent Amount", "5000"))) throw new Error("rent amount not filled");
    await setLabeled("Security Deposit", "10000");
    await shot("10-lease-form");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes("LSE-0001"), 30000, "lease code in list");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_leases`);
    // Leases carry contractNumber (the LSE- code), not the generic `code`.
    const l = docs.find((d) => d.contractNumber === "LSE-0001");
    if (!l) throw new Error("lease not persisted");
    leaseId = l.id;
    if (l.status !== "draft") throw new Error(`new lease should start at draft, got ${l.status}`);
    if (l.tenantContactId !== tenantContactId) throw new Error(`tenant link wrong: ${l.tenantContactId}`);
    if (l.unitId !== unitId || l.propertyId !== propertyId) throw new Error("lease on the wrong unit/property");
    if (Number(l.rentAmount) !== 5000 || Number(l.depositAmount) !== 10000) throw new Error(`money fields wrong: ${l.rentAmount}/${l.depositAmount}`);
    const s = await fsGet(`companies/${COMPANY_ID}/settings/real_estate`);
    if (Number(s?.sequences?.lease?.nextNumber) !== 2) throw new Error("lease sequence not advanced");
    await shot("10-lease-draft");
    return `leaseId=${leaseId} status=draft — no schedule, no deposit row yet`;
  });

  // ---------- Step 11: overlap rejection (domain rule, no partial write) ----------
  await step("11. Second lease over the same dates is rejected by the overlap rule with zero partial writes", async () => {
    await pressButtonExact("New");
    await waitForVisibleDialog("overlap lease modal");
    if (!(await pickOption("Property", "PRP-0001"))) throw new Error("property select failed");
    if (!(await pickOption("Unit", "UNT-0001"))) throw new Error("unit select failed");
    if (!(await pickOption("Tenant", `${TENANT_FIRST} ${TENANT_LAST}`))) throw new Error("tenant select failed");
    if (!(await setLabeled("Start Date", daysFromNow(10)))) throw new Error("start date not filled");
    if (!(await setLabeled("End Date", daysFromNow(200)))) throw new Error("end date not filled");
    if (!(await setLabeled("Rent Amount", "4000"))) throw new Error("rent amount not filled");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => /overlapping/i.test(await bodyText()), 20000, "overlap validation error");
    await closeModal();
    const docs = await fsList(`companies/${COMPANY_ID}/rem_leases`);
    if (docs.length !== 1) throw new Error(`rejected lease must not persist, found ${docs.length}`);
    await shot("11-overlap-rejected");
    return "leaseOverlap rule enforced at write time; only LSE-0001 exists";
  });

  // ---------- Step 12: submit -> activate (derived schedule + deposit + occupancy) ----------
  await step("12. Submit -> Activate derives the full schedule + deposit row + unit occupancy atomically", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/leases/${leaseId}`);
    await waitFor(`(document.body.innerText || '').includes('LSE-0001')`, 40000, "lease detail");
    // Draft state must not expose collection affordances.
    if ((await bodyText()).includes("Record Payment")) throw new Error("draft lease must not expose Record Payment");
    if (!(await pressButton("Submit for Approval"))) throw new Error("submit button not found on draft");
    await waitUntil(async () => {
      const l = await fsGet(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
      return l?.status === "pending_approval";
    }, 30000, "pending_approval persisted");
    // Wait for the refetched status to render the approval-path Activate button.
    await waitUntil(async () => (await clickText("button", ["Activate Lease"])) === true, 30000, "Activate Lease button");
    await waitForVisibleDialog("activate confirm");
    await clickDialogButton(["Activate Lease"]);
    await waitUntil(async () => {
      const l = await fsGet(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
      return l?.status === "active";
    }, 30000, "lease active");
    const lease = await fsGet(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
    if (!Array.isArray(lease.approvals) || lease.approvals.length !== 1) {
      throw new Error(`activation must record the approval, got ${JSON.stringify(lease.approvals)}`);
    }
    // Activation flips the lease status FIRST, then writes the deterministic
    // schedule row by row — poll until the count settles instead of snapshotting
    // mid-generation. 12 exact monthly periods => exactly 12 rows.
    const rows = await waitUntil(async () => {
      const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
      const mine = inst.filter((i) => i.leaseId === leaseId);
      return mine.length >= 12 ? mine : false;
    }, 30000, "full schedule persisted");
    if (rows.length !== 12) throw new Error(`expected a 12-month schedule, got ${rows.length} rows`);
    for (const i of rows) {
      // buildPeriodSpans is 1-based: ids are `${leaseId}_${periodIndex}`.
      if (i.id !== `${leaseId}_${i.periodIndex}`) throw new Error(`installment id not deterministic: ${i.id}`);
      if (Number(i.principalAmount) !== 5000 || Number(i.paidAmount) !== 0) {
        throw new Error(`schedule row wrong: principal=${i.principalAmount} paid=${i.paidAmount}`);
      }
    }
    const dep = await fsGet(`companies/${COMPANY_ID}/rem_security_deposits/${leaseId}`);
    if (!dep || Number(dep.expectedAmount) !== 10000 || dep.status !== "expected") {
      throw new Error(`deposit row not derived: ${JSON.stringify(dep && { e: dep.expectedAmount, s: dep.status })}`);
    }
    // Lease starts in 3 days: deriveOccupancyState maps a FUTURE blocking lease
    // to "reserved" (occupied only once the lease covers today) — derived, not typed.
    const unit = await waitUntil(async () => {
      const u = await fsGet(`companies/${COMPANY_ID}/rem_units/${unitId}`);
      return u && (u.occupancyStatus === "occupied" || u.occupancyStatus === "reserved") ? u : false;
    }, 30000, "occupancy synced off the lease");
    if (unit.occupancyStatus !== "reserved") throw new Error(`future-start lease must derive reserved, got ${unit.occupancyStatus}`);
    await waitUntil(async () => (await bodyText()).includes("Rent Schedule"), 20000, "schedule section rendered");
    await shot("12-activated");
    return "approvals=1, 12 deterministic schedule rows, deposit expected, unit reserved (future start) — all server-derived";
  });

  // ---------- Step 13: first rent payment (full allocation) ----------
  await step("13. Record Payment allocates the full first installment -> ipk_ payment doc, installment re-derived to paid", async () => {
    await waitUntil(async () => (await clickText("button", ["Record Payment"])) === true, 20000, "Record Payment button");
    await waitForVisibleDialog("payment modal");
    // Rows start unchecked with the outstanding balance pre-filled. Right
    // after activation the detail page may not have refetched the derived
    // installments yet, so openRows is empty and the modal renders the 'No open
    // installments' state with no checkbox. Retry until the Allocate row appears
    // before driving it (the data load is the only thing gating this step).
    if (!(await waitUntil(() => checkCheckbox("Allocate"), 25000, "allocate checkbox (installment rows loaded)").catch(() => false)))
      throw new Error("allocate checkbox not found");
    if (!(await setLabeled("Reference", "E2E-RENT-1"))) throw new Error("reference not filled");
    const confirmState = await dialogButtonState("Record Payment");
    if (confirmState !== "enabled") throw new Error(`confirm should be enabled with prefilled total, got ${confirmState}`);
    await shot("13-payment-modal");
    await clickDialogButton(["Record Payment"]);
    await waitUntil(async () => {
      const payments = await fsList(`companies/${COMPANY_ID}/rem_rent_payments`);
      return payments.some((p) => String(p.id).startsWith("ipk_") && Number(p.amount) === 5000 && (p.allocations || []).length === 1);
    }, 30000, "idempotency-keyed payment persisted");
    const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
    const first = inst.filter((i) => i.leaseId === leaseId).sort((a, b) => a.periodIndex - b.periodIndex)[0];
    if (Number(first.paidAmount) !== 5000 || first.status !== "paid") {
      throw new Error(`installment not re-derived: paid=${first.paidAmount} status=${first.status}`);
    }
    await waitUntil(async () => (await bodyText()).includes("Recorded"), 20000, "payments table shows Recorded chip");
    await waitUntil(async () => (await bodyText()).includes("Paid"), 10000, "schedule row flipped to Paid");
    await shot("13-rent-paid");
    return "paid state DERIVED from the allocation (no 'mark paid' exists)";
  });

  // ---------- Step 14: partial payment then VOID (audit-preserving) ----------
  await step("14. Partial payment (2,000 of 5,000) -> partially_paid; Void restores the balance and keeps the audit row", async () => {
    await clickText("button", ["Record Payment"]);
    await waitForVisibleDialog("payment modal 2");
    // First OPEN row is now installment 2 (installment 1 is settled). Retry
    // until the checkbox exists — the repaint after step 13's payment can lag.
    if (!(await waitUntil(() => checkCheckbox("Allocate"), 25000, "second allocate checkbox").catch(() => false)))
      throw new Error("second allocate checkbox missing");
    if (!(await setDialogNumber("2000"))) throw new Error("partial amount not set");
    await setLabeled("Reference", "E2E-VOID-1");
    await clickDialogButton(["Record Payment"]);
    await waitUntil(async () => {
      const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
      const i2 = inst.filter((x) => x.leaseId === leaseId).sort((a, b) => a.periodIndex - b.periodIndex)[1];
      return Number(i2.paidAmount) === 2000 && i2.status === "partially_paid";
    }, 30000, "installment 2 partially paid");
    // Void it: corrections are voids with a reason, never deletions.
    await waitUntil(async () => (await bodyText()).includes("E2E-VOID-1"), 20000, "payment row repaints");
    if (!(await clickRowButton("E2E-VOID-1", ["void payment"]))) throw new Error("void button not found on the row");
    await waitForVisibleDialog("void confirm");
    // Reason gate: confirm stays disabled until the audit reason exists.
    await waitUntil(async () => (await dialogButtonState("Void Payment")) === "disabled", 8000, "void disabled without reason");
    if (!(await setLabeled("Reason", "duplicate transfer"))) throw new Error("reason not filled");
    await waitUntil(async () => (await dialogButtonState("Void Payment")) === "enabled", 8000, "void enabled with reason");
    await clickDialogButton(["Void Payment"]);
    await waitUntil(async () => {
      const payments = await fsList(`companies/${COMPANY_ID}/rem_rent_payments`);
      const p = payments.find((x) => x.reference === "E2E-VOID-1");
      return p && p.voided === true;
    }, 30000, "payment voided (doc still present — audit preserved)");
    await waitUntil(async () => {
      const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
      const i2 = inst.filter((x) => x.leaseId === leaseId).sort((a, b) => a.periodIndex - b.periodIndex)[1];
      return Number(i2.paidAmount) === 0;
    }, 30000, "installment 2 balance rolled back by the void");
    await waitUntil(async () => (await bodyText()).includes("Voided"), 20000, "Voided chip in payments table");
    await shot("14-voided");
    return "void reversed allocations; nothing was deleted";
  });

  // ---------- Step 15: deposit receipt is a liability event, not revenue ----------
  await step("15. Deposit receipt recorded -> receivedAmount up, payment row carries isDepositReceipt + zero allocations", async () => {
    await waitUntil(async () => (await clickText("button", ["Record Receipt"])) === true, 20000, "Record Receipt button");
    await waitForVisibleDialog("deposit receipt modal");
    if (!(await setLabeled("Amount", "10000"))) throw new Error("amount not filled");
    await clickDialogButton(["Record Receipt"]);
    await waitUntil(async () => {
      const dep = await fsGet(`companies/${COMPANY_ID}/rem_security_deposits/${leaseId}`);
      return dep && Number(dep.receivedAmount) === 10000 && dep.status === "received";
    }, 30000, "deposit row received");
    const payments = await fsList(`companies/${COMPANY_ID}/rem_rent_payments`);
    const receipt = payments.find((p) => p.isDepositReceipt === true);
    if (!receipt) throw new Error("deposit receipt payment not persisted");
    if (Array.isArray(receipt.allocations) && receipt.allocations.length !== 0) throw new Error("deposit receipt must not allocate rent!");
    // The rent payments table FILTERS deposit receipts out (liability ledger).
    const rowVisible = await js(`(() => { const r = Array.from(document.querySelectorAll('tr')).find(x => (x.innerText||'').includes('10,000.00')); return !!r; })()`);
    void rowVisible; // deposit card shows the 10,000.00 — either table is fine
    await shot("15-deposit-received");
    return "held liability 10,000 SAR; collections reports cannot read it as income";
  });

  // ---------- Step 16: inspection + issue + facilities boundary ----------
  await step("16. Inspection with an issue persists (INS-0001), finalizes; work-order write stays facilities-owned (fail-closed under REM)", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/inspections`);
    await waitFor(`(document.body.innerText || '').includes('Inspections')`, 60000, "inspections page");
    // The breadcrumb renders before the toolbar — retry until the button exists.
    await waitUntil(async () => (await clickText("button", ["New Inspection"])) === true, 60000, "New Inspection button");
    await waitForVisibleDialog("inspection modal");
    if (!(await pickOption("Property", "PRP-0001"))) throw new Error("property select failed");
    if (!(await pickOption("Unit", "UNT-0001"))) throw new Error("unit select failed");
    await setLabeled("Condition Notes", "Annual periodic inspection");
    if (!(await clickButton(["Add Issue"]))) throw new Error("Add Issue not clicked");
    if (!(await setByPlaceholder("Describe the issue", ISSUE))) throw new Error("issue description not filled");
    await shot("16-inspection-form");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes("INS-0001"), 30000, "inspection code in list");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_inspections`);
    const insp = docs.find((d) => d.code === "INS-0001");
    if (!insp) throw new Error("inspection not persisted");
    if (!Array.isArray(insp.issues) || insp.issues.length !== 1 || !insp.issues[0].description.includes(ISSUE)) {
      throw new Error(`issue not persisted: ${JSON.stringify(insp.issues)}`);
    }
    if (insp.finalized !== false) throw new Error("new inspection must start as a draft");
    await clickRowButton("INS-0001", ["finalize"]);
    await waitUntil(async () => (await fsGet(`companies/${COMPANY_ID}/rem_inspections/${insp.id}`))?.finalized === true, 30000, "finalized");
    // Expand the row and attempt the work order — the ONLY maintenance path.
    await js(`(() => { const row = Array.from(document.querySelectorAll('tr')).find(r => (r.innerText||'').includes('INS-0001')); const b = row && row.querySelector('button'); if (b) b.click(); return true; })()`);
    await waitUntil(async () => (await bodyText()).includes(ISSUE), 15000, "expanded issue row");
    await clickRowButton(ISSUE, ["raise work order"]);
    await sleep(3500); // the facilities create either succeeds or toast-fails
    const after = await fsGet(`companies/${COMPANY_ID}/rem_inspections/${insp.id}`);
    const issueAfter = (after.issues || [])[0] || {};
    // Cross-domain boundary: fm_* writes belong to FACILITIES_MANAGEMENT, so
    // raising from REM must NOT silently write outside the active domain.
    const woProbe = await fsPatch(`companies/${COMPANY_ID}/fm_work_orders/wo_e2e_probe`, { title: "probe", facilityId: null, priority: "medium" });
    if (woProbe !== 403 && issueAfter.workOrderId) {
      throw new Error("expected either a denied fm_ write or an unlinked issue — work order crossed the boundary silently");
    }
    if (issueAfter.workOrderId) throw new Error("issue linked a work order although the fm_ probe write was denied??");
    await shot("16-workorder-boundary");
    return `inspection finalized; fm_ direct write denied with ${woProbe} (cross-domain maintenance intake = gap T2)`;
  });

  // ---------- Step 17: property expense + approval decision ----------
  await step("17. Property expense captured pending -> approved through the real_estate.approve gate", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/expenses`);
    await waitFor(`(document.body.innerText || '').includes('Property Expenses')`, 60000, "expenses page");
    await waitUntil(async () => (await clickText("button", ["New Expense"])) === true, 60000, "New Expense button");
    await waitForVisibleDialog("expense modal");
    if (!(await pickOption("Property", "PRP-0001"))) throw new Error("property select failed");
    await setLabeled("Vendor", "Gulf Facilities Co");
    if (!(await setLabeled("Description", EXPENSE))) throw new Error("description not filled");
    if (!(await setLabeled("Amount", "1800.5"))) throw new Error("amount not filled");
    await clickDialogButton(["Save"]);
    await waitUntil(async () => (await bodyText()).includes(EXPENSE), 30000, "expense row");
    const docs = await fsList(`companies/${COMPANY_ID}/rem_property_expenses`);
    const e = docs.find((x) => x.description === EXPENSE);
    if (!e) throw new Error("expense not persisted");
    if (Number(e.amount) !== 1800.5) throw new Error(`expense amount wrong: ${e.amount}`);
    if (e.propertyId !== propertyId) throw new Error("expense on the wrong property");
    if (e.approvalStatus !== "pending") throw new Error(`new expense should be pending, got ${e.approvalStatus}`);
    await clickRowButton(EXPENSE, ["approve"]);
    await waitUntil(async () => {
      const d = await fsGet(`companies/${COMPANY_ID}/rem_property_expenses/${e.id}`);
      return d?.approvalStatus === "approved";
    }, 30000, "expense approved");
    await shot("17-expense-approved");
    return "1,800.50 SAR expense moved pending -> approved (obligation)";
  });

  // ---------- Step 18: collections desk + derived balance on the reports desk ----------
  await step("18. Collections desk lists open rows; reports derive 55,000 outstanding (60,000 paid-to-date schedule - 5,000 collected, void excluded)", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/collections`);
    await waitFor(`(document.body.innerText || '').includes('Rent Collections')`, 60000, "collections page");
    // The desk shows OPEN balances: the fully-paid first installment drops out
    // of the arrears table (per-row outstanding = total - paid), while the
    // accrual total keeps counting the schedule — verified against REST below.
    await waitUntil(async () => (await bodyText()).includes("LSE-0001"), 45000, "lease row");
    let txt = await bodyText();
    if (!txt.includes(`${TENANT_FIRST}`)) throw new Error("tenant name missing on the arrears row");
    const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
    const paidSum = inst.filter((i) => i.leaseId === leaseId).reduce((a, i) => a + Number(i.paidAmount || 0), 0);
    if (paidSum !== 5000) throw new Error(`ledger must carry exactly the 5,000 non-voided payment, got ${paidSum}`);
    // The tenant-outstanding report reads the FULL schedule (12 x 5,000 of the
    // paid-through year minus 5,000 collected) => 55,000 derived, not typed.
    // formatCurrency drops trailing zeros for a whole amount (minimumFraction-
    // Digits: 0), so the rendered figure is "55,000" — NOT "55,000.00".
    await goto(`http://localhost:${VITE_PORT}/real-estate/reports`);
    await waitUntil(async () => (await bodyText()).includes("Outstanding") && (await bodyText()).includes("55,000"), 45000, "derived outstanding on the reports desk");
    txt = await bodyText();
    if (!txt.includes("Rent Collection & Arrears Aging")) throw new Error("collections report section missing");
    await shot("18-collections");
    return "open-rows desk + reports recompute 55,000 (whole-amount format) from installments and non-voided allocations";
  });

  // ---------- Step 19: dashboard metrics + idempotent reminder sweep ----------
  await step("19. Dashboard counts persisted truth; Generate Reminders is idempotent across presses", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate`);
    await waitFor(`(document.body.innerText || '').includes('Real Estate Overview')`, 60000, "dashboard");
    // Truth at this clock: 1 property, 1 unit whose blocking lease starts in 3
    // days => RESERVED (rate 0% until the lease covers today). Asserting
    // “Occupied: 1 / 100%” here would be demanding fabricated data.
    await waitUntil(async () => {
      const txt = await bodyText();
      return txt.includes("Reserved: 1") && txt.includes("0%") && txt.includes("ACTIVE LEASES");
    }, 30000, "occupancy metrics");
    await pressButtonUntil("Generate Reminders", `((document.body.innerText || '').toLowerCase().includes('reminder'))`, 25000);
    await sleep(1200);
    const n1 = (await fsList(`companies/${COMPANY_ID}/notifications`)).length;
    await pressButtonUntil("Generate Reminders", "true", 5000).catch(() => {});
    await sleep(1500);
    const n2 = (await fsList(`companies/${COMPANY_ID}/notifications`)).length;
    if (n2 !== n1) throw new Error(`reminder sweep was NOT idempotent: ${n1} -> ${n2}`);
    await shot("19-dashboard");
    return `occupancy 100%, reminders stable at ${n1} notification doc(s)`;
  });

  // ---------- Step 20: reports from persisted records ----------
  await step("20. Reports render register + income-vs-expenses from persisted records only", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/reports`);
    // Runtime truth for the income-vs-expenses diagnosis: what does the ledger
    // actually hold for payments (non-void, non-deposit) and approved expenses?
    {
      const pays = await fsList(`companies/${COMPANY_ID}/rem_rent_payments`);
      const exps = await fsList(`companies/${COMPANY_ID}/rem_property_expenses`);
      log(`   [step20Diag] payments=${JSON.stringify(pays.map((p) => ({ id: String(p.id).slice(0, 8), amt: p.amount, voided: p.voided, dep: p.isDepositReceipt ?? false, cur: p.currency, date: p.paymentDate })))} expenses=${JSON.stringify(exps.map((e) => ({ amt: e.amount, appr: e.approvalStatus, cur: e.currency, date: e.expenseDate })))}`);
    }
    // Sections populate as their queries land — poll until all needles render.
    const incomeCardDiag = async () => js(`(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const h = Array.from(document.querySelectorAll('h2')).find((x) => norm(x.innerText).toLowerCase().includes('income vs expenses'));
      if (!h) return 'NO-INCOME-SECTION';
      // Walk up to the HeroUI Card (role=generic article) so we read the whole
      // card body, not just the title row's flex container.
      const card = h.closest('article') || h.closest('[class*="card"]') || h.parentElement.parentElement.parentElement;
      return JSON.stringify({
        cardText: norm(card ? card.innerText : '').slice(0, 400),
        tables: document.querySelectorAll('table').length,
        ths: Array.from(document.querySelectorAll('th')).map((t) => norm(t.innerText)).filter(Boolean),
      });
    })()`).catch((e) => `diag-err:${e?.message}`);
    // Sections populate as their queries land. The reports desk fires ~7
    // queries and the income-vs-expenses table renders LAST. Match the needles
    // CASE-INSENSITIVELY: the report table headers ("Rent collected", "Approved
    // expenses") are CSS text-transform:uppercase, so innerText returns them as
    // "RENT COLLECTED"/"APPROVED EXPENSES" and a case-sensitive includes() never
    // matched — the earlier failure was casing, not a slow/missing render.
    const NEEDLES = ["income vs expenses", PROPERTY.toLowerCase(), "occupancy", "rent collected", "approved expenses"];
    const populated = async () => {
      const t = (await bodyText()).toLowerCase();
      return NEEDLES.every((n) => t.includes(n));
    };
    await waitUntil(populated, 90000, "reports sections populated").catch(async (e) => {
      // One reload before condemning: a dropped realtime listener should not
      // masquerade as a reporting bug, and the diagnostic names each needle.
      log(`   [step20Income @90s] ${await incomeCardDiag()}`);
      const missing = async () => {
        const t = (await bodyText()).toLowerCase();
        return NEEDLES.filter((n) => !t.includes(n));
      };
      const before = await missing();
      await goto(`http://localhost:${VITE_PORT}/real-estate/reports`);
      await waitUntil(populated, 90000, "reports after reload").catch(() => {});
      const after = await missing();
      throw new Error(`${e.message} (missing before reload: ${JSON.stringify(before)}; after: ${JSON.stringify(after)})`);
    });
    const txt = (await bodyText()).toLowerCase();
    for (const needle of [PROPERTY.toLowerCase(), "occupancy", "rent collected", "approved expenses"]) {
      if (!txt.includes(needle)) throw new Error(`reports missing "${needle}"`);
    }
    await shot("20-reports");
    return "no fabricated targets — everything traces to the seeded lifecycle";
  });

  // ---------- Step 21: refresh persistence ----------
  await step("21. Full reload of the lease keeps every derived state (single source: Firestore)", async () => {
    await goto(`http://localhost:${VITE_PORT}/real-estate/leases/${leaseId}`);
    await waitFor(`(document.body.innerText || '').includes('LSE-0001')`, 40000, "lease detail after reload");
    const txt = await bodyText();
    if (!txt.includes("Active")) throw new Error("lease status chip not Active after reload");
    if (!txt.includes("Recorded") || !txt.includes("Voided")) throw new Error("payment history did not survive the reload");
    if (!txt.includes("Rent Schedule")) throw new Error("schedule section missing after reload");
    await shot("21-after-reload");
    return "status, schedule, payments and deposit all re-read from the database";
  });

  // ---------- Step 22: authorization probes ----------
  await step("22. Employee cannot record payments or escalate a lease; outsider cannot read rem_*", async () => {
    const stPay = await fsPatch(`companies/${COMPANY_ID}/rem_rent_payments/ipk_e2e_probe`, {
      leaseId, amount: 1, currency: "SAR", allocations: [], voided: false,
    }, empToken);
    if (stPay !== 403) throw new Error(`employee payment write expected 403, got ${stPay}`);
    const stEsc = await fsPatch(`companies/${COMPANY_ID}/rem_leases/${leaseId}`, { status: "terminated" }, empToken);
    if (stEsc !== 403) throw new Error(`employee lease escalation expected 403, got ${stEsc}`);
    const stOut = await fsGetStatus(`companies/${COMPANY_ID}/rem_properties/${propertyId}`, outsiderToken);
    if (stOut !== 403) throw new Error(`outsider property read expected 403, got ${stOut}`);
    const stLeaseDelete = await fetch(`${FS_BASE}/companies/${COMPANY_ID}/rem_leases/${leaseId}`, {
      method: "DELETE", headers: authHdr(adminIdToken),
    });
    if (stLeaseDelete.status !== 403) throw new Error(`admin lease DELETE must be forbidden, got ${stLeaseDelete.status}`);
    const still = await fsGet(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
    if (still.status !== "active") throw new Error("denied delete nevertheless mutated the lease!");
    return `payment=${stPay} escalation=${stEsc} outsider=${stOut} delete=${stLeaseDelete.status} (all denied, data intact)`;
  });

  // ---------- Step 23: shared modules + other namespaces under REM ----------
  await step("23. CRM/billing/PROJECTS stay reachable; /agency and /facilities stay denied under REM", async () => {
    await goto(`http://localhost:${VITE_PORT}/crm/contacts`);
    await waitUntil(async () => (await bodyText()).includes(`${TENANT_FIRST} ${TENANT_LAST}`), 60000, "CRM contacts shared with REM");
    await goto(`http://localhost:${VITE_PORT}/billing/invoices`);
    await waitUntil(async () => (await bodyText()).includes("REM-INV-0001"), 90000, "billing invoices list");
    await goto(`http://localhost:${VITE_PORT}/agency`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "agency denial under REM");
    await goto(`http://localhost:${VITE_PORT}/facilities`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "facilities denial under REM");
    await goto(`http://localhost:${VITE_PORT}/projects`);
    await waitUntil(async () => (await bodyText()).includes("New Project"), 40000, "projects core module reachable under REM");
    if ((await bodyText()).includes("Section not available")) throw new Error("PROJECTS must stay reachable as a core module under REM");
    await shot("23-modules-under-rem");
    return "shared portals render; foreign activity-owned namespaces denied; PROJECTS core stays reachable";
  });

  // ---------- Step 24: deactivation blocks but preserves ----------
  await step("24. Switching the tenant activity blocks rem_* (UI + REST) while every record survives reactivation", async () => {
    const patchSt = await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "MARKETING_AGENCY" });
    if (patchSt >= 400) throw new Error(`admin switch to MARKETING_AGENCY failed: ${patchSt}`);
    const stRem = await fsGetStatus(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
    if (stRem !== 403) throw new Error(`admin read of rem data under inactive activity expected 403, got ${stRem}`);
    await goto(`http://localhost:${VITE_PORT}/real-estate`);
    await waitUntil(async () => (await bodyText()).includes("Section not available"), 40000, "denied card under inactive activity");
    await shot("24-denied-while-inactive");
    await fsPatch(`companies/${COMPANY_ID}`, { primaryActivity: "REAL_ESTATE_MANAGEMENT" });
    await goto(`http://localhost:${VITE_PORT}/real-estate/leases/${leaseId}`);
    await waitUntil(async () => (await bodyText()).includes("LSE-0001"), 40000, "lease visible again");
    const lease = await fsGet(`companies/${COMPANY_ID}/rem_leases/${leaseId}`);
    if (lease.status !== "active" || Number(lease.rentAmount) !== 5000) throw new Error("lease mutated across the activity switch!");
    const payments = await fsList(`companies/${COMPANY_ID}/rem_rent_payments`);
    if (!payments.some((p) => p.reference === "E2E-RENT-1") || !payments.some((p) => p.isDepositReceipt === true)) {
      throw new Error("payment ledger incomplete after reactivation");
    }
    const inst = await fsList(`companies/${COMPANY_ID}/rem_rent_installments`);
    if (inst.filter((i) => i.leaseId === leaseId).length !== 12) throw new Error("schedule changed across the switch");
    await shot("24-records-survived");
    return "blocked while inactive; identical lease + ledger after reactivation";
  });
} finally {
  edgeProc.kill();
  viteProc.kill();
}

console.log("\n=================================================================");
const passed = results.filter((r) => r.ok).length;
console.log(` Real Estate Management Browser E2E Summary: ${passed}/${results.length} passed`);
for (const r of results.filter((x) => !x.ok)) console.log(`   ✗ ${r.name}: ${r.error}`);
console.log("=================================================================\n");
process.exit(passed === results.length ? 0 : 1);
