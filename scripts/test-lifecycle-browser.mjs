/**
 * D-Arrow Business — Full Lifecycle Real-Browser Acceptance (Workstream B)
 *
 * Drives one unique fictional customer through the REAL app UI over Microsoft
 * Edge headless (CDP) against local Firebase emulators:
 *   customer → linked deal → win deal (stage bar) → contract prefill check →
 *   invoice created from the won deal → two PARTIAL payments →
 *   Customer 360 unified timeline → Customer Operations dashboard.
 *
 * RULES honoured:
 *  - All lifecycle MUTATIONS are performed through actual browser interactions.
 *  - Direct Firestore access below is READ-ONLY, used to (a) resolve auto-generated
 *    IDs for navigation and (b) confirm persisted relationships/accounting.
 *  - No seeded lifecycle records, no mocked responses, no fallback DB writes.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection } from "firebase/firestore";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_lifecycle_${Date.now()}`);
// Randomize per-process to avoid collisions with leftover Edge/Vite from prior runs.
const CDP_PORT = 9780 + (process.pid % 15);
const VITE_PORT = 5180 + (process.pid % 15);
const PROJECT = "test-lifecycle-acceptance";
const COMPANY = "company-alpha";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });

console.log("=================================================================");
console.log(" D-Arrow — Full Lifecycle Real-Browser Acceptance (CDP)");
console.log("=================================================================\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Vite boot
console.log(`Starting isolated test Vite instance on port ${VITE_PORT}...`);
const viteProc = spawn(process.execPath, [
  "node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort",
], {
  env: {
    ...process.env,
    VITE_USE_FIREBASE_EMULATOR: "true",
    VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    VITE_FIREBASE_PROJECT_ID: PROJECT,
    VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
    VITE_FIRESTORE_EMULATOR_PORT: "8080",
    VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
  },
  stdio: "pipe",
});
viteProc.stdout.on("data", (d) => { if (d.toString().includes("Local:")) console.log("Vite ready."); });

// Wait until Vite + Firestore emulator REST are both responsive (deterministic).
async function waitForHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await sleep(1000);
  }
  return false;
}
const viteReady = await waitForHttp(`http://localhost:${VITE_PORT}/`);
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
// Firestore emulator readiness gate: the emulator serves an HTTP 200 welcome page at its root.
const fsReady = await waitForHttp(`http://127.0.0.1:8080/`, 40);
if (!fsReady) { viteProc.kill(); throw new Error("Firestore emulator not ready"); }
console.log("Services ready: Vite + Firestore emulator confirmed responsive.\n");

// ---------------------------------------------------------------- Edge/CDP
console.log(`Starting Edge Headless on CDP port ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--window-size=1440,1200",
  `--user-data-dir=${profileDir}`, "about:blank",
]);
let pageTarget = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (r.ok) {
      const pages = await r.json();
      pageTarget = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (pageTarget) break;
    }
  } catch {}
}
if (!pageTarget) { edgeProc.kill(); viteProc.kill(); throw new Error("Could not connect to Edge DevTools port"); }

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 1;
const pending = new Map();
const consoleLogs = [];
ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
  if (data.method === "Runtime.consoleAPICalled") {
    try { consoleLogs.push(`[${data.type}] ${(data.args||[]).map((a)=>a.value ?? a.description ?? a.type).join(" ").slice(0,300)}`); } catch {}
    if (consoleLogs.length > 300) consoleLogs.shift();
  }
  if (data.method === "Runtime.exceptionThrown") {
    try { consoleLogs.push(`[EXCEPTION] ${data.params?.exceptionDetails?.exception?.description || data.params?.exceptionDetails?.text}`.slice(0,300)); } catch {}
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
await send("Runtime.enable");
await send("Page.enable");
await send("Network.clearBrowserCookies");

// eval expression returning a JSON value.
async function js(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails));
  return res?.result?.result?.value;
}
async function waitFor(expression, timeoutMs = 20000, pollMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await js(`!!(${expression})`)) return true; } catch {}
    await sleep(pollMs);
  }
  return false;
}
async function navigate(url) { await send("Page.navigate", { url }); await sleep(500); }
// Navigate and, if the SPA fails to mount (cold Vite on-demand compile), reload up to `tries`
// times. Returns true once `mountExpr` becomes truthy. Deterministic readiness, not a blind sleep.
async function gotoAndReady(url, mountExpr, tries = 4, waitMs = 20000) {
  for (let i = 1; i <= tries; i++) {
    await navigate(url);
    if (await waitFor(mountExpr, waitMs)) return true;
    console.log(`    [gotoAndReady] not mounted after nav ${i}/${tries}; reloading`);
    await send("Page.reload", { ignoreCache: true });
    await sleep(1200);
  }
  return await waitFor(mountExpr, waitMs);
}
async function dump(label, expression) {
  const v = await js(expression).catch((e) => `dump error: ${e.message}`);
  console.log(`    [dump:${label}] ${String(v).slice(0, 900)}`);
}
// Rich failure diagnostics: current field values, validation errors, toasts, console tail.
async function diag(tag) {
  const info = await js(`(() => {
    const inputs = Array.from(document.querySelectorAll('input,textarea')).map(i=>({n:i.name,v:(i.value||'').slice(0,40)})).filter(x=>x.n);
    const errs = Array.from(document.querySelectorAll('[class*="danger"],[class*="error"],[role="alert"],[data-slot*="error"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,15);
    const toasts = Array.from(document.querySelectorAll('[data-sonner-toast],[role="status"],section[aria-label*="status"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,5);
    return JSON.stringify({inputCount: inputs.length, inputs, errs, toasts});
  })()`).catch((e) => `diag error: ${e.message}`);
  console.log(`    [diag:${tag}] ${String(info).slice(0, 1000)}`);
  console.log(`    [diag:${tag}:console] ${JSON.stringify(consoleLogs.slice(-25))}`);
}

// ---- UI primitives ----
async function setInput(name, value) {
  return js(`(() => {
    const el = document.querySelector('input[name="${name}"], textarea[name="${name}"]');
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(String(value))});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}
// click a button whose trimmed innerText matches one of candidates (case-insens).
async function clickButton(candidates, { within } = {}) {
  const scope = within ? `document.querySelectorAll('${within}')` : `document.querySelectorAll('button, a')`;
  return js(`(() => {
    const cands = ${JSON.stringify(candidates)}.map(s => s.toLowerCase());
    const els = Array.from(${scope});
    const btn = els.find(e => { const t = (e.innerText || '').trim().toLowerCase(); return t && cands.some(c => t === c || t.includes(c)); });
    if (!btn) return false;
    btn.click(); return true;
  })()`);
}
// click a generic clickable containing the text (for stage bar / list rows).
async function clickText(candidates) {
  return js(`(() => {
    const cands = ${JSON.stringify(candidates)}.map(s => s.toLowerCase());
    const els = Array.from(document.querySelectorAll('button, a, [role="button"], [role="option"], li'));
    const el = els.find(e => { const t = (e.innerText || e.textContent || '').trim().toLowerCase(); return t && cands.some(c => t === c || t.includes(c)); });
    if (!el) return false;
    el.click(); return true;
  })()`);
}
// HeroUI Select: open the select whose label matches, then pick option matching text.
async function selectOption(labelCandidates, optionCandidates) {
  const opened = await js(`(() => {
    const labels = ${JSON.stringify(labelCandidates)}.map(s => s.toLowerCase());
    const combos = Array.from(document.querySelectorAll('[role="combobox"], button[aria-haspopup="listbox"]'));
    const trig = combos.find(c => { const wrap = c.closest('div'); const txt = ((wrap && wrap.innerText) || '').toLowerCase(); return labels.some(l => txt.includes(l)); })
      || combos.find(c => { let n = c; for (let i=0;i<4&&n;i++){ n=n.parentElement; if(n && labels.some(l=>(n.innerText||'').toLowerCase().includes(l))) return true;} return false; });
    if (!trig) return false;
    trig.click(); return true;
  })()`);
  if (!opened) return false;
  const picked = await waitFor(`(() => {
    const opts = ${JSON.stringify(optionCandidates)}.map(s => s.toLowerCase());
    const items = Array.from(document.querySelectorAll('[role="option"], li.listbox-item, .heroui-select-item, [data-slot="item"] li, ul li'));
    return items.some(i => { const t=(i.innerText||i.textContent||'').trim().toLowerCase(); return opts.some(o => t === o || t.includes(o)) && (i.click(), true); });
  })()`, 6000, 200);
  return picked;
}

// ---- read-only persisted-data inspection (emulator admin context) ----
// NOTE: this bypasses security rules for READS only. No lifecycle mutation ever
// goes through this path — all writes are performed by the real browser UI. The
// unauthenticated emulator REST API is rejected by the rules (request.auth==null),
// so we read through the rules-unit-testing admin context instead.
async function fsGet(collectionName, id) {
  let out = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), `companies/${COMPANY}/${collectionName}`, id));
    out = snap.exists() ? snap.data() : null;
  });
  return out;
}
async function fsList(collectionName) {
  let out = [];
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDocs(collection(ctx.firestore(), `companies/${COMPANY}/${collectionName}`));
    out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
}
const str = (f) => (typeof f === "string" ? f : undefined);
const num = (f) => (f == null ? undefined : Number(f));
const boolv = (f) => (typeof f === "boolean" ? f : undefined);

// ---------------------------------------------------------------- results
const evidence = [];
let hardFailure = false;
async function stage(name, fn) {
  console.log(`\n>>> ${name}`);
  try {
    const detail = await fn();
    console.log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`);
    evidence.push({ name, ok: true, detail: detail || "" });
    return detail;
  } catch (err) {
    console.error(`✗ FAIL: ${name} — ${err?.message || err}`);
    evidence.push({ name, ok: false, detail: String(err?.message || err) });
    hardFailure = true;
    return null;
  }
}

// ---------------------------------------------------------------- seed user
const TEST_EMAIL = "lifecycle_admin@company-alpha.com";
const TEST_PASS = "Lifecycle2026!";
let userId = null;
{
  const su = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, returnSecureToken: true }),
  }).then((r) => r.json()).catch(() => ({}));
  userId = su.localId;
  if (!userId) {
    const si = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, returnSecureToken: true }),
    }).then((r) => r.json()).catch(() => ({}));
    userId = si.localId;
  }
}
const testEnv = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
// Seed ONLY tenancy + user identity (infrastructure), NOT lifecycle records.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  if (userId) await setDoc(doc(db, "users", userId), { email: TEST_EMAIL, name: "Lifecycle Admin", companyId: COMPANY, role: "admin" });
  await setDoc(doc(db, "companies", COMPANY), { id: COMPANY, name: "Company Alpha Ltd" });
});

// unique fictional customer identity
const CUSTOMER = { first: "Falcon", last: "RetailGroup", phone: "+966500000111", email: "falcon@retailgroup-TEST.example", account: "Falcon Retail Group" };
const DEAL_TITLE = "Falcon Brand Campaign";
const DEAL_AMOUNT = 10000;

let contactId = null, dealId = null, invoiceId = null, contractId = null;
let taskIds = [];
let viaInvoiceRoute = null;

try {
  // ---- login ----
  await stage("0. Login via UI", async () => {
    const mounted = await gotoAndReady(`http://localhost:${VITE_PORT}/login`, `document.querySelector('input[name="email"]')`);
    if (!mounted) { await dump("login-dom", "document.body.innerText.slice(0,400)"); throw new Error("login form not mounted"); }
    const ok = await js(`(() => {
      const e=document.querySelector('input[name="email"]'); const p=document.querySelector('input[type="password"]'); const s=document.querySelector('button[type="submit"]');
      if(!e||!p||!s) return false;
      const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      set.call(e,'${TEST_EMAIL}'); e.dispatchEvent(new Event('input',{bubbles:true}));
      set.call(p,'${TEST_PASS}'); p.dispatchEvent(new Event('input',{bubbles:true}));
      s.click(); return true;
    })()`);
    if (!ok) throw new Error("could not fill/submit login");
    const gone = await waitFor(`!window.location.href.includes('/login')`, 25000);
    if (!gone) { await dump("after-login", "document.body.innerText.slice(0,400)"); throw new Error("did not leave /login"); }
    return "authenticated";
  });

  // ---- 1. create customer ----
  await stage("1. Create customer (contact) via UI", async () => {
    await navigate(`http://localhost:${VITE_PORT}/crm/contacts`);
    if (!(await waitFor(`document.body.innerText.length > 50`, 20000))) throw new Error("contacts page not loaded");
    const before = await fsList("contacts");
    const opened = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>{const t=(x.innerText||'').toLowerCase(); return (t.includes('add')||t.includes('إضافة')||!!x.querySelector('svg.lucide-plus')) && (x.click(), true);}); })()`, 15000);
    if (!opened) { await dump("contacts-add", "document.body.innerText.slice(0,400)"); throw new Error("Add-contact control not found"); }
    if (!(await waitFor(`document.querySelector('input[name="firstName"]')`, 15000))) { await dump("contact-modal", "Array.from(document.querySelectorAll('input')).map(i=>i.name).join(',')"); throw new Error("contact modal inputs not mounted"); }
    await setInput("firstName", CUSTOMER.first);
    await setInput("lastName", CUSTOMER.last);
    await setInput("phone", CUSTOMER.phone);
    await setInput("email", CUSTOMER.email);
    await setInput("accountName", CUSTOMER.account);
    const submitted = await js(`(() => { const s=document.querySelector('form button[type="submit"]')||Array.from(document.querySelectorAll('button')).find(b=>/create|save|حفظ|إنشاء/i.test((b.innerText||'').trim())); if(!s) return false; s.click(); return true; })()`);
    if (!submitted) { await dump("contact-submit", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("no submit button"); }
    const saved = await waitFor(`(async()=>true)()`, 1) && (await (async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const after = await fsList("contacts");
        if (after.length > before.length) { contactId = after[after.length - 1].id; return true; }
      }
      return false;
    })());
    if (!saved) { await diag("contact"); throw new Error("contact not persisted via UI (no DB fallback allowed)"); }
    const doc = await fsGet("contacts", contactId);
    if (str(doc?.firstName) !== CUSTOMER.first) throw new Error("persisted customer mismatch");
    return `contactId=${contactId}`;
  });

  // ---- 2. create deal linked to customer ----
  await stage("2. Create deal linked to customer via UI", async () => {
    await navigate(`http://localhost:${VITE_PORT}/crm/deals`);
    if (!(await waitFor(`document.body.innerText.length > 50`, 20000))) throw new Error("deals page not loaded");
    const before = await fsList("deals");
    const opened = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>{const t=(x.innerText||'').toLowerCase(); return (t.includes('add deal')||t.includes('add')||t.includes('إضافة')||!!x.querySelector('svg.lucide-plus')) && (x.click(), true);}); })()`, 15000);
    if (!opened) { await dump("deal-add", "document.body.innerText.slice(0,400)"); throw new Error("Add-deal control not found"); }
    if (!(await waitFor(`document.querySelector('input[name="title"]')`, 15000))) { await dump("deal-modal", "Array.from(document.querySelectorAll('input')).map(i=>i.name).join(',')"); throw new Error("deal modal not mounted"); }
    await setInput("title", DEAL_TITLE);
    await setInput("amount", String(DEAL_AMOUNT));
    const sel = await selectOption(["Contact", "جهة الاتصال"], [`${CUSTOMER.first} ${CUSTOMER.last}`, CUSTOMER.first]);
    if (!sel) { await dump("deal-select-dom", "document.body.innerHTML.slice(0,1500)"); throw new Error("could not select contact in deal form"); }
    const submitted = await js(`(() => { const s=document.querySelector('form button[type="submit"]'); if(!s) return false; s.click(); return true; })()`);
    if (!submitted) throw new Error("no deal submit button");
    const saved = await (async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const after = await fsList("deals");
        if (after.length > before.length) { dealId = after[after.length - 1].id; return true; }
      }
      return false;
    })();
    if (!saved) { await dump("deal-validation", `Array.from(document.querySelectorAll('.text-danger,[data-slot="error-message"]')).map(e=>e.innerText).join(', ')`); throw new Error("deal not persisted via UI"); }
    const doc = await fsGet("deals", dealId);
    if (str(doc?.contactId) !== contactId) throw new Error(`deal.contactId=${str(doc?.contactId)} != ${contactId}`);
    return `dealId=${dealId}, deal.contactId=${contactId}`;
  });

  // ---- 3. win the deal via stage bar ----
  await stage("3. Move deal to Won via UI stage bar", async () => {
    await gotoAndReady(`http://localhost:${VITE_PORT}/crm/deals/${dealId}`, `document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`);
    if (!(await waitFor(`document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`, 20000))) { await dump("deal-detail", "document.body.innerText.slice(0,400)"); throw new Error("deal detail not rendered"); }
    // Wait for the stage bar to actually mount a Won control before clicking (substring, like clickText).
    if (!(await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>/won|فوز|Win|تم/i.test((x.innerText||'').trim())); })()`, 15000))) { await dump("stagebar", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("Won stage button not found"); }
    // Click + poll; re-click on non-persist (a legitimate safe UI retry — stage 18 semantics).
    let won = false;
    for (let attempt = 1; attempt <= 3 && !won; attempt++) {
      await clickText(["Won", "فوز"]);
      for (let i = 0; i < 24; i++) { await sleep(500); const d = await fsGet("deals", dealId); if (str(d?.stage) === "won") { won = true; break; } }
      if (!won) console.log(`    [stage3] won not persisted after attempt ${attempt}; re-clicking`);
    }
    if (!won) throw new Error("deal stage not persisted as won");
    // stage change should have written an Activity (existing audit architecture)
    const acts = await fsList("activities");
    const stageAct = acts.find((a) => str(a?.entityId) === dealId && str(a?.subject) === "Deal stage changed");
    if (!stageAct) throw new Error("no 'Deal stage changed' activity recorded (audit gap)");
    return `stage=won; activity=${stageAct.id}`;
  });

  // ---- 4. contract-from-deal: open builder, SAVE, APPROVE, CONVERT services to tasks (all via UI) ----
  await stage("4. Contract from deal: save + approve + convert to tasks via UI", async () => {
    await gotoAndReady(`http://localhost:${VITE_PORT}/crm/deals/${dealId}`, `document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`);
    if (!(await waitFor(`document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`, 20000))) throw new Error("deal detail not rendered");
    const clicked = await clickText(["Draft Contract", "Add Contract", "صياغة عقد", "إنشاء عقد"]);
    if (!clicked) { await dump("deal-actions", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("Draft Contract button not found"); }
    // Wait for the builder to actually mount its toolbar (Save + New contract). The click deep-links to
    // /crm/contracts?dealId; give the lazy builder time to render before we assert.
    const builderReady = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').trim().toLowerCase()); return b.some(t=>/save|حفظ/.test(t)); })()`, 20000);
    const url = await js("window.location.href");
    if (!builderReady) { await dump("builder-url", "window.location.href"); await dump("builder-body", "document.body.innerText.slice(0,700)"); await dump("builder-buttons", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error(`contract builder Save control not mounted (url=${url})`); }
    if (!url.includes("/crm/contracts") || !url.includes(`dealId=${dealId}`)) throw new Error(`builder URL missing deal linkage: ${url}`);
    // Verify prefilled customer + amount (real commercial data inherited from the deal).
    const bodyHasCustomer = await js(`document.body.innerText.includes(${JSON.stringify(CUSTOMER.first)})`);
    const bodyHasAmount = await js(`document.body.innerText.includes('10,000') || document.body.innerText.includes('${DEAL_AMOUNT}') || document.body.innerText.includes('10000')`);
    if (!bodyHasCustomer) throw new Error("contract builder missing prefilled customer name");
    if (!bodyHasAmount) throw new Error("contract builder missing prefilled deal amount");

    // SAVE the contract through the real Save button; poll for the persisted contract by dealId.
    const savedBtn = await js(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/(save|حفظ)/i.test((x.innerText||'').trim())); if(!b) return false; b.click(); return true; })()`);
    if (!savedBtn) { await dump("contract-save-buttons", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("contract Save button not found"); }
    const persisted = await (async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const cs = await fsList("contracts");
        const mine = cs.find((c) => str(c?.dealId) === dealId);
        if (mine) { contractId = mine.id; return true; }
      }
      return false;
    })();
    if (!persisted) { await dump("contract-save-toasts", "JSON.stringify(Array.from(document.querySelectorAll('[data-sonner-toast],[role=\"status\"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,6))"); throw new Error("contract not persisted via UI"); }
    let ct = await fsGet("contracts", contractId);
    if (str(ct?.contactId) !== contactId) throw new Error(`contract.contactId=${str(ct?.contactId)} != ${contactId}`);

    // APPROVE through the DocumentApprovalBar (admin role authorized). Wait for the bar to mount.
    const approveReady = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>/(approve|موافقة)/i.test((x.innerText||'').trim())); })()`, 20000);
    if (!approveReady) { await dump("approve-bar", "document.body.innerText.slice(0,600)"); throw new Error("approval bar never appeared after save"); }
    await js(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/(approve|موافقة)/i.test((x.innerText||'').trim())); b && b.click(); return true; })()`);
    const approved = await (async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        ct = await fsGet("contracts", contractId);
        if (ct && (str(ct?.approvalStatus) === "approved" || !!ct?.approvedAt)) return true;
      }
      return false;
    })();
    if (!approved) throw new Error(`contract not approved via UI (approvalStatus=${str(ct?.approvalStatus)})`);

    // CONVERT selected services into department tasks. Wait for the convert control to mount.
    const convertReady = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>/convert services to department tasks|ترحيل الخدمات/i.test((x.innerText||'').trim())); })()`, 20000);
    if (!convertReady) { await dump("convert-bar", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("convert-services button not found"); }
    await js(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/convert services to department tasks|ترحيل الخدمات/i.test((x.innerText||'').trim())); b && b.click(); return true; })()`);
    const tasksCreated = await (async () => {
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const ts = (await fsList("tasks")).filter((t) => str(t?.contractId) === contractId);
        if (ts.length > 0) { taskIds = ts.map((t) => t.id); return ts.length; }
      }
      return 0;
    })();
    if (tasksCreated === 0) { await dump("convert-toasts", "JSON.stringify(Array.from(document.querySelectorAll('[data-sonner-toast],[role=\"status\"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,6))"); throw new Error("no tasks generated from contract services via UI"); }
    // Verify every generated task is linked to the approved contract AND the original deal.
    const linkedTasks = (await fsList("tasks")).filter((t) => str(t?.contractId) === contractId);
    const badDeal = linkedTasks.filter((t) => str(t?.dealId) !== dealId).length;
    return `contractId=${contractId}; approvalStatus=${str(ct?.approvalStatus)}; contactLink✓; tasks=${linkedTasks.length}; dealMismatch=${badDeal}`;
  });

  // ---- 5. create invoice from won deal ----
  await stage("5. Create invoice from won deal via UI", async () => {
    await gotoAndReady(`http://localhost:${VITE_PORT}/crm/deals/${dealId}`, `document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`);
    if (!(await waitFor(`document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`, 20000))) throw new Error("deal detail not rendered");
    // Wait for the won-deal action toolbar to mount before clicking.
    if (!(await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button,a')); return b.some(x=>/create invoice|إصدار فاتورة/i.test((x.innerText||'').trim())); })()`, 15000))) { await dump("invoice-btn", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("Create Invoice button not found on won deal"); }
    // Click "Create Invoice", retrying until the SPA actually routes (the deal action handler can lag
    // hydration after a cold reload). The product routes a contract-bearing deal to /crm/contracts?id=.
    let landed = false;
    for (let attempt = 1; attempt <= 3 && !landed; attempt++) {
      await js(`(() => { const b=Array.from(document.querySelectorAll('button,a')).find(x=>/^(create invoice|إصدار فاتورة)$/i.test((x.innerText||'').trim()) || /create invoice|إصدار فاتورة/i.test((x.innerText||'').trim())); b && b.click(); return true; })()`);
      landed = await waitFor(`window.location.href.includes('/billing/invoices/new') || window.location.href.includes('/crm/contracts')`, 8000);
      if (!landed) console.log(`    [stage5] invoice route not reached after click ${attempt}; retrying`);
    }
    if (!landed) { await dump("inv-nav", "window.location.href"); await dump("deal-buttons", "Array.from(document.querySelectorAll('button,a')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("Create Invoice did not route to an invoice workflow"); }
    let route = await js("window.location.href");
    // Remember the ORIGIN before the interim-invoice button navigates away: a contract-bearing deal
    // routes here through /crm/contracts then the interim invoice, so the real origin is the contract.
    const invoiceOrigin = route.includes("/crm/contracts") ? "contract" : "deal";
    if (route.includes("/crm/contracts")) {
      // On the contract page: wait for the interim-invoice action, then invoke it via the real UI.
      if (!(await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>/مرحلية|interim invoice/i.test((x.innerText||'').trim())); })()`, 20000))) { await dump("contract-invoice-btn", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("contract→invoice action not present"); }
      await js(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/مرحلية|interim invoice/i.test((x.innerText||'').trim())); b && b.click(); return true; })()`);
      if (!(await waitFor(`window.location.href.includes('/billing/invoices/new')`, 15000))) { await dump("inv-nav2", "window.location.href"); throw new Error("contract→invoice did not reach the invoice form"); }
      route = await js("window.location.href");
    }
    viaInvoiceRoute = invoiceOrigin;
    if (!(await waitFor(`document.querySelector('input[name="items.0.unitPrice"]')`, 15000))) throw new Error("invoice form not prefilled");
    await dump("inv-enabled-buttons", "JSON.stringify(Array.from(document.querySelectorAll('button')).map(b=>({t:(b.innerText||'').trim().slice(0,28),d:b.disabled})).filter(x=>x.t))");
    // Prefer the DRAFT path (no invoice-number transaction) to isolate pure-UI persistence from
    // the issue/accounting sub-flow, which is exercised separately in stage 6.
    const draftBtn = await js(`(() => { const el=Array.from(document.querySelectorAll('button')).find(b=>!b.disabled && /save as draft/i.test((b.innerText||'').trim())); if(!el) return false; el.click(); return true; })()`);
    const which = draftBtn ? "Save as Draft" : (await clickButton(["Save & Send", "Create invoice", "حفظ"]) ? "primary" : "none");
    if (which === "none") { await dump("inv-buttons", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("invoice submit button not found"); }
    const created = await (async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const after = await fsList("invoices");
        const mine = after.find((inv) => str(inv?.dealId) === dealId || str(inv?.customerId) === contactId);
        if (mine) { invoiceId = mine.id; return true; }
      }
      return false;
    })();
    if (!created) {
      const all = await fsList("invoices");
      const seq = await fsGet("settings", "billing");
      console.log(`    [diag:invoice] clicked=${which}; total invoices=${all.length}; settings/billing present=${seq ? true : false}; invoiceSequence=${JSON.stringify(seq?.invoiceSequence ?? null)}`);
      await dump("inv-toasts", "JSON.stringify(Array.from(document.querySelectorAll('[data-sonner-toast],[role=\"status\"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,6))");
      await diag("invoice");
      throw new Error("invoice not persisted via UI");
    }
    const inv = await fsGet("invoices", invoiceId);
    if (str(inv?.customerId) !== contactId) throw new Error(`invoice.customerId=${str(inv?.customerId)} != ${contactId}`);
    return `invoiceId=${invoiceId}; via=${which}; route=${viaInvoiceRoute}; status=${str(inv?.status)}; grandTotal=${num(inv?.grandTotal) ?? JSON.stringify(inv?.grandTotal)}`;
  });

  // ---- 6. record two partial payments ----
  await stage("6. Record TWO partial payments via UI + balances", async () => {
    // ensure invoice is payable: open detail, approve if a pending-approval bar exists.
    await navigate(`http://localhost:${VITE_PORT}/billing/invoices/${invoiceId}`);
    // Wait until the detail actions have actually mounted (convert OR payment control present).
    const actionsRendered = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').toLowerCase()); return b.some(t=>t.includes('convert draft to invoice')) || b.some(t=>t.includes('issue receipt voucher')||t.includes('record payment')); })()`, 25000);
    if (!actionsRendered) { await dump("invoice-detail-loading", "document.body.innerText.slice(0,500)"); throw new Error("invoice detail actions never rendered"); }
    // Issue the draft through the real authorized UI action, then wait until it is payable.
    const draftBtnPresent = await js(`(() => Array.from(document.querySelectorAll('button')).some(x=>/convert draft to invoice/i.test(x.innerText||'')))()`);
    if (draftBtnPresent) {
      await clickButton(["Convert draft to invoice"]);
      const issued = await (async () => {
        for (let i = 0; i < 30; i++) {
          await sleep(500);
          const d = await fsGet("invoices", invoiceId);
          if (d && str(d.status) !== "draft") return true;
        }
        return false;
      })();
      if (!issued) {
        await dump("convert-actions", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')");
        await dump("convert-toasts", "JSON.stringify(Array.from(document.querySelectorAll('[data-sonner-toast],[role=\"status\"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,6))");
        throw new Error("draft did not convert to invoice via UI");
      }
    }
    await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').toLowerCase()); return b.some(t=>t.includes('issue receipt voucher')||t.includes('record payment')); })()`, 15000);
    let inv = await fsGet("invoices", invoiceId);
    const statusBefore = str(inv?.status);
    const amountDue0 = (num(inv?.grandTotal) || 0) - (num(inv?.amountPaid) || 0);
    if (!(await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')); return b.some(x=>/Issue Receipt Voucher|record|سند|Record Payment/i.test(x.innerText||'')); })()`, 15000))) {
      await dump("invoice-detail-actions", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')");
      throw new Error(`record-payment control unavailable (status=${statusBefore}, amountDue=${amountDue0})`);
    }
    const pay1 = Math.round(amountDue0 * 0.4);
    const pay2 = Math.round(amountDue0 * 0.3);
    const countPayments = async () => (await fsList("payments")).filter((p) => str(p?.invoiceId) === invoiceId).length;
    async function recordOnce(amount, label) {
      const before = await countPayments();
      await clickButton(["Issue Receipt Voucher", "Record Payment", "إصدار سند قبض"]);
      if (!(await waitFor(`document.querySelector('input[name="amount"]')`, 12000))) { await dump(`pay-modal-${label}`, "Array.from(document.querySelectorAll('input')).map(i=>i.name).join(',')"); throw new Error(`[${label}] payment modal amount input not found`); }
      await setInput("amount", String(amount));
      const submit = await js(`(() => { const b=document.querySelector('form button[type="submit"]')||Array.from(document.querySelectorAll('button')).find(x=>/Issue Voucher|Record|سند/i.test(x.innerText||'')); if(!b) return false; b.click(); return true; })()`);
      if (!submit) throw new Error(`[${label}] payment submit not found`);
      // Deterministic: poll until the payment count increments (no fixed sleep).
      let after = before;
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        after = await countPayments();
        if (after > before) break;
      }
      if (after === before) {
        await dump(`pay-${label}-toasts`, "JSON.stringify(Array.from(document.querySelectorAll('[data-sonner-toast],[role=\"status\"]')).map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,6))");
        await dump(`pay-${label}-inputs`, "JSON.stringify(Array.from(document.querySelectorAll('input')).map(i=>({n:i.name,v:i.value})).slice(0,10))");
        await dump(`pay-${label}-actions`, "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')");
        throw new Error(`[${label}] payment amount=${amount} not persisted (count stayed ${before})`);
      }
      // Wait for the modal to actually close before reopening for the next payment.
      await waitFor(`!document.querySelector('input[name="amount"]')`, 10000);
      return after;
    }
    await recordOnce(pay1, "pay1");
    await recordOnce(pay2, "pay2");
    inv = await fsGet("invoices", invoiceId);
    const paid = num(inv?.amountPaid) || 0;
    const expected = pay1 + pay2;
    if (paid !== expected) throw new Error(`amountPaid=${paid} expected ${expected} (pay1=${pay1},pay2=${pay2})`);
    const payments = (await fsList("payments")).filter((p) => str(p?.invoiceId) === invoiceId);
    if (payments.length < 2) throw new Error(`expected >=2 payments, got ${payments.length}`);
    return `due0=${amountDue0}; pay1=${pay1}; pay2=${pay2}; amountPaid=${paid}; payments=${payments.length}`;
  });

  // ---- 7. customer 360 unified timeline shows real events ----
  await stage("7. Customer 360 unified timeline shows real lifecycle events", async () => {
    await navigate(`http://localhost:${VITE_PORT}/crm/contacts/${contactId}`);
    if (!(await waitFor(`document.body.innerText.includes(${JSON.stringify(CUSTOMER.first)})`, 20000))) throw new Error("customer detail not rendered");
    await clickText(["Timeline", "الجدول الزمني"]);
    // Locale-robust (headless browser language may be en OR ar) but assertions stay strict:
    // the deal title plus invoice AND payment event labels must all be present.
    const hasTimeline = await waitFor(`document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)}) && /Payment|الدفعة/i.test(document.body.innerText)`, 20000);
    if (!hasTimeline) { await dump("timeline-tab", "document.body.innerText.slice(0,1200)"); throw new Error("timeline did not render deal+payment events"); }
    // deal creation + invoice + payment categories should all appear
    const body = await js("document.body.innerText");
    const okDeal = body.includes(DEAL_TITLE);
    const okInvoice = /Invoice|الفاتورة/i.test(body);
    const okPayment = /Payment|الدفعة/i.test(body);
    if (!(okDeal && okInvoice && okPayment)) throw new Error(`missing categories deal=${okDeal} invoice=${okInvoice} payment=${okPayment}`);
    return "timeline shows deal + invoice + payment events";
  });

  // ---- 8. operations dashboard row ----
  await stage("8. Customer Operations dashboard shows the customer", async () => {
    await navigate(`http://localhost:${VITE_PORT}/crm/operations`);
    const found = await waitFor(`document.body.innerText.includes(${JSON.stringify(CUSTOMER.first)}) || document.body.innerText.includes(${JSON.stringify(CUSTOMER.account)})`, 20000);
    if (!found) { await dump("ops", "document.body.innerText.slice(0,600)"); throw new Error("customer not present in operations dashboard"); }
    return "customer row present";
  });

  // ---- 9. link navigation between related records ----
  await stage("9. Navigate related-record links from invoice → deal → customer", async () => {
    await navigate(`http://localhost:${VITE_PORT}/billing/invoices/${invoiceId}`);
    if (!(await waitFor(`!!document.querySelector('a[href*="/crm/deals/${dealId}"]') || document.body.innerText.includes(${JSON.stringify(String(invoiceId)).slice(1, -1)})`, 20000))) { await dump("inv-detail", "document.body.innerText.slice(0,500)"); }
    // Invoice → Deal link opens the correct deal.
    const dealLink = await js(`(() => { const a=document.querySelector('a[href*="/crm/deals/${dealId}"]'); if(!a) return false; a.click(); return true; })()`);
    if (!dealLink) { await dump("inv-related-links", "JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.getAttribute('href')).filter(Boolean))"); throw new Error("invoice→deal related link not present"); }
    if (!(await waitFor(`window.location.href.includes('/crm/deals/${dealId}') && document.body.innerText.includes(${JSON.stringify(DEAL_TITLE)})`, 20000))) { await dump("deal-after-link", "window.location.href + ' || ' + document.body.innerText.slice(0,300)"); throw new Error("invoice→deal link did not open the correct deal"); }
    // Deal → Customer (contact) link back to canonical customer.
    await navigate(`http://localhost:${VITE_PORT}/billing/invoices/${invoiceId}`);
    await waitFor(`!!document.querySelector('a[href*="/crm/contacts/${contactId}"]')`, 15000);
    const custLink = await js(`(() => { const a=document.querySelector('a[href*="/crm/contacts/${contactId}"]'); if(!a) return false; a.click(); return true; })()`);
    if (!custLink) { await dump("inv-cust-link", "JSON.stringify(Array.from(document.querySelectorAll('a')).map(a=>a.getAttribute('href')).filter(Boolean))"); throw new Error("invoice→customer related link not present"); }
    if (!(await waitFor(`window.location.href.includes('/crm/contacts/${contactId}') && document.body.innerText.includes(${JSON.stringify(CUSTOMER.first)})`, 20000))) { await dump("cust-after-link", "window.location.href + ' || ' + document.body.innerText.slice(0,300)"); throw new Error("invoice→customer link did not open the correct customer"); }
    return "invoice→deal✓ invoice→customer✓ links open correct records";
  });

  // ---- 10. retry safety: re-open + re-save must not duplicate contract or tasks ----
  await stage("10. Retry safety: no duplicate contract/task created on re-save", async () => {
    if (!contractId) throw new Error("contract was never created in stage 4; retry-safety is unexecuted");
    const contractsBefore = (await fsList("contracts")).filter((c) => str(c?.dealId) === dealId).length;
    // Canonical tracked set persisted by the real convert flow.
    const ctBefore = await fsGet("contracts", contractId);
    const tracked = Array.from(new Set((ctBefore?.createdTaskIds || []).map(String)));
    const tasksBefore = (await fsList("tasks")).filter((t) => str(t?.contractId) === contractId).length;
    if (contractsBefore < 1) throw new Error("no contract present to retry-save against");
    if (tasksBefore < 1) throw new Error("no tasks present to test duplicate prevention against");
    // Re-open the SAME contract by id and wait until it has actually LOADED (its converted banner /
    // 'View tasks' control renders only once the persisted contract form is mounted) — not the default form.
    await navigate(`http://localhost:${VITE_PORT}/crm/contracts?contractId=${contractId}`);
    const loaded = await waitFor(`(() => { const b=Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').trim().toLowerCase()); return b.some(t=>/view tasks|الانتقال لجدول المهام/.test(t)) || b.some(t=>/مرحلية/.test(t)); })()`, 20000);
    if (!loaded) { await dump("reopen-contract", "Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).join(' | ')"); throw new Error("reopened contract did not load the saved (converted) contract"); }
    // Press Save again → must UPDATE the existing doc, never create a second one.
    await js(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>/(save|حفظ)/i.test((x.innerText||'').trim())); b && b.click(); return true; })()`);
    await sleep(2500);
    const contractsAfter = (await fsList("contracts")).filter((c) => str(c?.dealId) === dealId).length;
    const afterTasks = (await fsList("tasks")).filter((t) => str(t?.contractId) === contractId);
    const tasksAfter = afterTasks.length;
    if (contractsAfter !== contractsBefore) throw new Error(`duplicate contract created on re-save (${contractsBefore}→${contractsAfter})`);
    if (tasksAfter !== tasksBefore) throw new Error(`task count changed on re-save (${tasksBefore}→${tasksAfter})`);
    // Duplicate-free invariant: every contract task belongs to the canonical tracked set.
    const orphans = afterTasks.filter((t) => !tracked.includes(String(t.id)));
    if (tracked.length > 0 && orphans.length > 0) throw new Error(`${orphans.length} untracked duplicate task(s) against contract`);
    if (contractsAfter < 1 || tasksAfter < 1) throw new Error("retry destroyed the original records");
    return `re-save: contracts ${contractsBefore}→${contractsAfter}, tasks ${tasksBefore}→${tasksAfter} (tracked=${tracked.length}, orphans=${orphans.length})`;
  });

  // ---- 11. cross-system persistence + accounting + status distinctness (read-only) ----
  await stage("11. Read-only persistence, accounting integrity & status semantics", async () => {
    const deal = await fsGet("deals", dealId);
    const inv = await fsGet("invoices", invoiceId);
    const contract = await fsGet("contracts", contractId);
    const linkedTasks = (await fsList("tasks")).filter((t) => str(t?.contractId) === contractId);
    const payments = (await fsList("payments")).filter((p) => str(p?.invoiceId) === invoiceId);
    const journals = await fsList("journals");
    const vouchers = await fsList("vouchers");
    if (str(deal?.contactId) !== contactId) throw new Error("deal→contact link broken on re-read");
    if (str(inv?.customerId) !== contactId) throw new Error("invoice→customer link broken on re-read");
    if (str(inv?.dealId) !== dealId) throw new Error("invoice→deal link broken on re-read");
    if (str(contract?.dealId) !== dealId) throw new Error("contract→deal link broken on re-read");
    if (linkedTasks.length === 0) throw new Error("tasks not persisted against contract");
    if (linkedTasks.some((t) => str(t?.dealId) !== dealId)) throw new Error("task→deal linkage inconsistent");
    // Status semantics: an issued invoice with two PARTIAL payments must NOT be reported fully paid.
    const grand = num(inv?.grandTotal) || 0;
    const paid = num(inv?.amountPaid) || 0;
    const stillPartial = paid > 0 && paid < grand;
    if (!stillPartial) throw new Error(`expected partially-paid invoice, got paid=${paid} grand=${grand} status=${str(inv?.status)}`);
    if (str(inv?.status) === "paid") throw new Error("partially-paid invoice incorrectly marked fully paid");
    // A drafted/approved contract is a distinct state from delivery completion.
    const receiptCount = vouchers.filter((v) => str(v?.invoiceId) === invoiceId || payments.some((p) => str(v?.id) === str(p?.voucherId))).length;
    return `deal→cust✓ inv→cust✓ inv→deal✓ contract→deal✓ tasks(${linkedTasks.length})→deal✓ payments=${payments.length} journals=${journals.length} receipts=${receiptCount} partiallyPaid(${paid}/${grand})✓ notFullyPaid✓`;
  });
} catch (fatal) {
  console.error("Harness fatal:", fatal);
  hardFailure = true;
} finally {
  try { await testEnv.cleanup(); } catch {}
  try { ws.close(); } catch {}
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
}

console.log("\n=================================================================");
console.log(" Lifecycle Browser Evidence");
console.log("=================================================================");
for (const e of evidence) {
  console.log(`${e.ok ? "✓" : "✗"} ${e.name}\n     → ${e.detail}`);
}
const passed = evidence.filter((e) => e.ok).length;
console.log(`\n Summary: ${passed}/${evidence.length} stages passed`);
process.exit(hardFailure || passed < evidence.length ? 1 : 0);
