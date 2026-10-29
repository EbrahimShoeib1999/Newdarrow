/**
 * D-Arrow Business — Phase 6b Navigation Runtime Verification (Browser / CDP)
 *
 * Drives Microsoft Edge headless against the local Firebase Auth + Firestore
 * emulators to prove the unified back navigation works in the REAL app shell
 * (router + AppLayout origin tracker + PortalPageShell BackBar), not just in the
 * pure registry:
 *
 *   direct entry      -> back falls to the registry parent, never to itself
 *   in-app entry      -> back returns to the page the user actually came from,
 *                        with its query string intact
 *   nested settings   -> trail walks hub -> section, portal ownership respected
 *   owned controls    -> pages that already render their own back/breadcrumbs
 *                        get NO central bar (no duplicates)
 *   authorization     -> a target the user may not open is never offered
 *   activity boundary -> another activity's module stays denied
 *   Arabic + RTL      -> labels and direction come out localized
 *
 * Every assertion reads the live DOM. Nothing is stubbed.
 */

import { spawn, spawnSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_nav_${Date.now()}`);
const CDP_PORT = 9781;
const VITE_PORT = 5177;
const PROJECT_ID = "test-navigation-6b";
const COMPANY_ID = "acme-co";
const FAC_COMPANY_ID = "fac-co";
const ADMIN_EMAIL = "nav_admin@acme.test";
const ADMIN_PASS = "NavAdmin2026!";
const EMP_EMAIL = "nav_emp@acme.test";
const EMP_PASS = "NavEmp2026!";
const FAC_EMAIL = "nav_admin@fac.test";
const FAC_PASS = "NavFacAdmin2026!";

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/navigation-browser";

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);

// ---------------- firestore emulator REST (rules-enforced, per-identity) ----
// Seeding obeys the SAME rules the UI obeys: a users/{uid} profile is written
// with THAT user's own id token (rules/users match: create allowed only when
// request.auth.uid == userId, exactly like register / invite-accept in the app),
// and tenant/company fixtures are written with the admin token (the same path
// scripts/test-employee-lifecycle-browser.mjs uses). Nothing is bypassed.
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
async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label}`);
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

log("=================================================================");
log(" D-Arrow Business — Phase 6b Navigation Runtime Verification");
log("=================================================================\n");

// ---------- 1. isolated Vite against the emulators ----------
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
  await new Promise((r) => setTimeout(r, 1000));
  try { if ((await fetch(`http://localhost:${VITE_PORT}/`)).ok) { viteReady = true; break; } } catch {}
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
log(`Vite ready: http://localhost:${VITE_PORT}`);

// ---------- 2. Edge headless over CDP ----------
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
let msgId = 1;
const pending = new Map();
const consoleBuf = [];
let ws = null;
let edgeProc = null;

function spawnEdge(dir) {
  edgeProc = spawn(edgePath, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-first-run",
    "--no-default-browser-check", "--window-size=1280,900",
    `--user-data-dir=${dir}`, "about:blank",
  ]);
}

function wireMessages(sock) {
  sock.onmessage = (evt) => {
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
}

// The page target's socket dies with the document it belongs to, so reconnect
// by discovering the target over HTTP each time the browser (re)starts.
async function attachToBrowser() {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const pages = await res.json();
        const target = pages.find((p) => p.type === "page");
        if (target?.webSocketDebuggerUrl) {
          const sock = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = reject; });
          wireMessages(sock);
          ws = sock;
          return;
        }
      }
    } catch {}
  }
  throw new Error("No Edge CDP target");
}

spawnEdge(profileDir);
await attachToBrowser();

function send(method, params = {}) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) { log(`   [cdp-skipped] ${method}: no live browser socket`); resolve(null); return; }
    const id = msgId++;
    // A response tied to a document that gets replaced is never delivered; an
    // unbounded await here used to hang the whole suite.
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); log(`   [cdp-timeout] ${method} unanswered after 60s`); resolve(null); }
    }, 60000);
    pending.set(id, (resp) => {
      clearTimeout(timer);
      // Silent CDP failures were the reason a session reset looked successful:
      // a rejected Storage.clearDataForOrigin must be visible in the log.
      if (resp && resp.error) log(`   [cdp-error] ${method}: ${resp.error.code} ${resp.error.message}`);
      resolve(resp);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (res?.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
  return res?.result?.result?.value;
}
async function enableCdpDomains() {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.clearBrowserCookies");
}
await enableCdpDomains();

// A brand-new profile is the only session reset that cannot race the SDK: the
// whole browsing context (cookies, localStorage, IndexedDB) is replaced instead
// of deleted under a live page that would just write the token back.
async function restartBrowser() {
  log("   [diag] restarting the browser with a clean profile for the identity switch");
  try { ws?.close(); } catch {}
  ws = null;
  if (edgeProc?.pid) {
    try { spawnSync("taskkill", ["/pid", String(edgeProc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  }
  await new Promise((r) => setTimeout(r, 4000));
  const freshDir = path.join(os.tmpdir(), `edge_nav_${Date.now()}_fresh`);
  try { rmSync(freshDir, { recursive: true, force: true }); } catch {}
  mkdirSync(freshDir, { recursive: true });
  spawnEdge(freshDir);
  await attachToBrowser();
  await enableCdpDomains();
}

async function shot(name) {
  const scr = await send("Page.captureScreenshot", { format: "png" });
  if (scr?.result?.data) writeFileSync(path.join(OUT_DIR, `${name}.png`), Buffer.from(scr.result.data, "base64"));
}
async function goto(url) {
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 800));
}
async function currentUrl() { return (await evalJs("window.location.href")) || ""; }

// Trusted input beats synthetic events: the header avatar dropdown is built on
// react-aria, which ignores a dispatched .click()/PointerEvent, so the in-page
// sign-out attempt in earlier runs never opened the menu at all.
async function trustedClick(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, pointerType: "mouse" });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, pointerType: "mouse" });
}
async function rectOf(expr) { return await evalJs(expr); }

const AVATAR_TRIGGER_JS = `(() => {
  const header = document.querySelector('header');
  if (!header) return null;
  const cands = Array.from(header.querySelectorAll('.cursor-pointer'));
  const hit = cands.find((el) => el.querySelector('[class*="avatar"], [class*="ring-primary"], img')) || cands[cands.length - 1];
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const LOGOUT_ITEM_JS = `(() => {
  const item = Array.from(document.querySelectorAll('[role="menuitem"], button, a'))
    .find((x) => x.querySelector('svg.lucide-log-out') || /log ?out|sign ?out|خروج|تسجيل الخروج/i.test((x.innerText || '').trim()));
  if (!item) return null;
  const r = item.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;
async function bodyText() {
  return (await evalJs("(document.body && document.body.innerText || '').replace(/\\s+/g,' ')")) || "";
}
async function dump(tag) {
  log(`   [dump:${tag}] url=${await currentUrl()}`);
  log(`   [dump:${tag}] body="${(await bodyText()).slice(0, 220)}"`);
  const tail = consoleBuf.slice(-8);
  log(`   [dump:${tag}] console:\n     ${tail.join("\n     ") || "(none)"}`);
  await shot(`dump-${tag}`);
}

const SETTER = "Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set";
function setFieldExpr(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    ${SETTER}.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

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

// Read the bar the shell actually rendered.
async function barState() {
  return await evalJs(`(() => {
    const bar = document.querySelector('[data-testid="back-bar"]');
    if (!bar) return { present: false };
    const back = bar.querySelector('[data-testid="back-button"]');
    const links = Array.from(bar.querySelectorAll('nav a')).map(a => ({ href: a.getAttribute('href'), text: (a.innerText||'').trim() }));
    const current = bar.querySelector('nav [aria-current="page"]');
    return {
      present: true,
      mode: bar.getAttribute('data-bar-mode'),
      hasBack: !!back,
      backLabel: back ? (back.innerText||'').trim() : null,
      links,
      crumbText: (bar.querySelector('nav')||{}).innerText ? bar.querySelector('nav').innerText.replace(/\\s+/g,' ').trim() : '',
      currentCrumbs: current ? current.innerText.trim() : null,
      backControlsInPage: Array.from(document.querySelectorAll('button, a')).filter(b => /(^|\\s)back\\s*$|إرجاع|رجوع/i.test((b.innerText||'').trim())).length,
    };
  })()`);
}
async function pressBack() {
  const ok = await evalJs(`(() => { const b = document.querySelector('[data-testid="back-button"]'); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error("no back button rendered");
}
async function clickSidebarLink(href) {
  const ok = await evalJs(`(() => { const a = document.querySelector('a[href="${href}"]'); if (!a) return false; a.click(); return true; })()`);
  if (!ok) throw new Error(`sidebar link ${href} not present`);
  await new Promise((r) => setTimeout(r, 800));
}
async function expectUrl(pattern, label) {
  const url = await waitUntil(async () => {
    const u = await currentUrl();
    return pattern.test(u) ? u : null;
  }, 30000, label);
  return url;
}

const APP = `http://localhost:${VITE_PORT}`;

// Switching identities honestly: /login redirects an already-authenticated
// browser to the portal picker, so each login starts from a signed-out shell.
// The user's own Sign-out menu item is pressed with trusted mouse events (the
// SDK drops its own session); only if that path fails do we clear the origin's
// storage over CDP — and then we verify the next document really boots signed
// out, because a live page re-persists its auth state after a wipe.
// Did the session really end? /login booted signed-in redirects to the picker,
// so either signal is decisive: an off-/login url means a session survived, a
// mounted form means it is gone.
async function sessionResetVerdict(timeoutMs = 90000) {
  try {
    const verdict = await waitUntil(async () => {
      const u = await currentUrl();
      if (u && !/\/login/.test(u)) return "authed";
      if (await evalJs(`!!document.querySelector('input[name="email"]')`)) return "signed-out";
      return null;
    }, timeoutMs, "session reset verdict");
    return verdict;
  } catch {
    return "unknown";
  }
}

async function hardResetOrigin() {
  log("   [diag] clearing the origin's storage for the identity switch");
  // Tear the document down first so no running SDK can write the session back
  // after the clear.
  await goto("about:blank");
  await send("Network.clearBrowserCookies");
  await send("Storage.clearDataForOrigin", {
    origin: APP,
    storageTypes: "local_storage,indexed_db,cookies,session_storage",
  });
  await new Promise((r) => setTimeout(r, 2000));
  await goto(`${APP}/login`);
  if ((await sessionResetVerdict()) === "signed-out") return true;
  // Deleting storage under a live SDK proved unreliable here: replace the whole
  // browsing context instead of guessing which store the token came back from.
  log("   [diag] storage clear left the shell authenticated; restarting the browser");
  await restartBrowser();
  await goto(`${APP}/login`);
  return (await sessionResetVerdict(150000)) === "signed-out";
}

async function signOutSession() {
  // Nothing to do when the shell is already signed out (first login of the run).
  await goto(`${APP}/apps`);
  await new Promise((r) => setTimeout(r, 2500));
  if (/\/login/.test(await currentUrl())) return;
  for (const surface of ["/people", "/apps"]) {
    await goto(`${APP}${surface}`);
    // The shell renders late on a cold route graph, so wait for the trigger
    // instead of probing once against a still-blank document.
    let trigger = null;
    try {
      trigger = await waitUntil(() => rectOf(AVATAR_TRIGGER_JS), 60000, `avatar trigger on ${surface}`);
    } catch {
      log(`   [diag] no avatar trigger on ${surface} (shell never offered the header)`);
      continue;
    }
    await trustedClick(trigger.x, trigger.y);
    let item = null;
    try {
      item = await waitUntil(() => rectOf(LOGOUT_ITEM_JS), 15000, `sign-out menu item on ${surface}`);
    } catch {
      log(`   [diag] sign-out menu never opened on ${surface}`);
      continue;
    }
    await trustedClick(item.x, item.y);
    try {
      await waitUntil(async () => (/\/login/.test(await currentUrl()) ? true : null), 45000, "sign-out landed on /login");
      log(`   [diag] signed out through the header menu on ${surface}`);
      return;
    } catch {
      log(`   [diag] UI sign-out on ${surface} did not reach /login`);
    }
  }
  if (!(await hardResetOrigin())) log("   [diag] storage reset did not sign the shell out");
}

// Sign in through the real form and wait for the router to move off /login.
// The first post-login route graph is transformed by Vite on demand (react
// compiler included), so the redirect can take tens of seconds on a cold run;
// a fixed short sleep here produced false "still on /login" failures.
async function loginAs(email, pass, tag) {
  await signOutSession();
  await goto(`${APP}/login`);
  await waitForLoginForm(tag);
  await evalJs(setFieldExpr('input[name="email"]', email));
  await evalJs(setFieldExpr('input[type="password"]', pass));
  await evalJs(`document.querySelector('button[type="submit"]').click()`);
  return loginAsDone(tag);
}

// The very first document request makes Vite transform the whole app graph
// (react-compiler included), and a session reset can leave the SDK booting
// against a deleted store. Wait long, re-enter the document when it stays blank,
// and dump the real page state when it still fails — never proceed against an
// unauthenticated shell.
async function waitForLoginForm(tag) {
  const found = () => evalJs(`!!document.querySelector('input[name="email"]')`);
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await waitUntil(found, 120000, `${tag}: login form (attempt ${attempt})`);
      return;
    } catch (e) {
      lastError = e;
      const root = await evalJs(`(() => ({ url: location.href, rootChildren: (document.getElementById('root')||{childElementCount:-1}).childElementCount, bodyLen: (document.body&&document.body.innerHTML.length)||0, title: document.title }))()`);
      log(`   [diag:${tag}] login form missing on attempt ${attempt}, page=${JSON.stringify(root)} — re-entering /login`);
      // An authenticated shell redirects /login to the picker, so the form can
      // never mount: reset the session before re-entering the document.
      if (root.url && !/\/login/.test(root.url)) await hardResetOrigin();
      await goto("about:blank");
      await goto(`${APP}/login`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await dump(`login-form-${tag}`);
  const txt = await bodyText();
  throw new Error(`${tag}: /login form never mounted after 3 entries — body="${txt.slice(0, 160)}" (${lastError && lastError.message})`);
}

// Same redirect wait for callers that must drive the form themselves.
async function loginAsDone(tag) {
  let url = "";
  try {
    url = await waitUntil(async () => {
      const u = await currentUrl();
      return /\/login/.test(u) ? null : u;
    }, 150000, `${tag}: post-login redirect`);
  } catch (e) {
    await dump(`login-${tag}`);
    const said = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('p,[role="alert"],small'))
      .map(x => (x.innerText||'').trim()).filter(Boolean).slice(0,8))`);
    throw new Error(`${tag}: login never left /login — page says ${said}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
  return url;
}

// Arabic pass: the language preference is set on the login document before the
// SPA boots, so every label the bar renders comes from the ar resources.
async function loginArabicAdmin() {
  await signOutSession();
  await goto(`${APP}/login`);
  await waitForLoginForm("arabic admin");
  await evalJs(`localStorage.setItem('d-arrow-lang','ar')`);
  await evalJs(setFieldExpr('input[name="email"]', ADMIN_EMAIL));
  await evalJs(setFieldExpr('input[type="password"]', ADMIN_PASS));
  await evalJs(`document.querySelector('button[type="submit"]').click()`);
  return loginAsDone("arabic admin");
}

// Wait until the page actually rendered something, so an absence assertion is a
// decision the shell made and not a race against a blank cold route.
async function waitForRenderedPage(path, label) {
  await goto(`${APP}${path}`);
  await waitUntil(async () => ((await bodyText()).length > 60 ? true : null), 120000, `${label} rendered`);
  await new Promise((r) => setTimeout(r, 1500));
}

let adminIdToken = "";
try {
  // ---------- fixtures ----------
  await step("0. Seed two tenants (projects + facilities) and two acme users", async () => {
    const admin = await createAuthUser(ADMIN_EMAIL, ADMIN_PASS);
    adminIdToken = admin.idToken;
    const emp = await createAuthUser(EMP_EMAIL, EMP_PASS);
    const fac = await createAuthUser(FAC_EMAIL, FAC_PASS);
    // Companies first, so the profile writes are evaluated against a tenant that
    // already exists (the app never creates a profile for an unknown company).
    await seedDoc(`companies/${COMPANY_ID}`, {
      id: COMPANY_ID, name: "Acme Solutions", defaultCurrency: "SAR", primaryActivity: "PROJECTS",
    });
    await seedDoc(`companies/${FAC_COMPANY_ID}`, {
      id: FAC_COMPANY_ID, name: "Facilities Co", defaultCurrency: "SAR", primaryActivity: "FACILITIES_MANAGEMENT",
    });
    // Each profile is self-created with its OWN token (rules-enforced).
    await seedDoc(`users/${admin.localId}`, {
      email: ADMIN_EMAIL, name: "Acme Admin", companyId: COMPANY_ID, role: "admin",
    }, admin.idToken);
    await seedDoc(`users/${emp.localId}`, {
      email: EMP_EMAIL, name: "Acme Employee", companyId: COMPANY_ID, role: "employee",
    }, emp.idToken);
    await seedDoc(`users/${fac.localId}`, {
      email: FAC_EMAIL, name: "Fac Admin", companyId: FAC_COMPANY_ID, role: "admin",
    }, fac.idToken);
    const back = await fsGet(`users/${admin.localId}`);
    if (back?.role !== "admin") throw new Error("admin fixture missing");
    return `admin=${admin.localId} emp=${emp.localId} fac=${fac.localId}`;
  });

  // ---------- admin session ----------
  await step("1. Admin logs in through the UI", async () => {
    const url = await loginAs(ADMIN_EMAIL, ADMIN_PASS, "admin");
    if (/\/login/.test(url)) throw new Error("still on /login after submit");
    await shot("01-admin-landing");
    return `url=${url}`;
  });

  // ---------- direct entry: registry parent, never itself ----------
  await step("2. Direct entry to /people/leave offers the portal landing and a working Back", async () => {
    await waitForRenderedPage("/people/leave", "leave page");
    await waitUntil(async () => (await barState()).present, 120000, "back bar on /people/leave");
    const bar = await barState();
    if (bar.mode !== "full") throw new Error(`expected full bar, got ${bar.mode}`);
    if (!bar.hasBack) throw new Error("full-mode bar must render the back button");
    if (!bar.links.some((l) => l.href === "/people")) throw new Error(`landing crumb missing: ${JSON.stringify(bar.links)}`);
    await shot("02-leave-direct-entry");
    await pressBack();
    const url = await expectUrl(/\/people($|\?)/, "back to the people landing");
    return `crumbs="${bar.crumbText}" -> ${url}`;
  });

  await step("3. People landing itself renders no central bar", async () => {
    await waitUntil(async () => ((await bodyText()).length > 60 ? true : null), 120000, "people landing rendered");
    await new Promise((r) => setTimeout(r, 2000));
    const bar = await barState();
    if (bar.present) { await dump("landing-bar-dup"); throw new Error("landing page must not duplicate its own header"); }
    return "no back-bar on /people";
  });

  // ---------- in-app origin beats the registry parent, query preserved ----------
  await step("4. In-app origin wins over the registry parent and keeps its query", async () => {
    await waitForRenderedPage("/people/leave?view=weekly", "filtered leave view");
    await waitUntil(async () => (await barState()).present, 120000, "leave page bar");
    const from = await currentUrl();
    await clickSidebarLink("/people/approvals");
    await waitUntil(async () => /\/people\/approvals/.test(await currentUrl()), 60000, "approvals rendered");
    await waitUntil(async () => (await barState()).hasBack, 60000, "approvals back button");
    const bar = await barState();
    if (!bar.hasBack) throw new Error("approvals page must offer a back control");
    await pressBack();
    // Record where the app actually lands: an origin that was not remembered
    // shows up as the registry parent (/people), a stripped query as /people/leave.
    const trail = [];
    for (let i = 0; i < 25; i++) {
      const u = await currentUrl();
      if (!trail.includes(u)) trail.push(u);
      if (/\/people\/leave\?view=weekly$/.test(u)) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    const url = trail[trail.length - 1];
    if (!/\/people\/leave\?view=weekly$/.test(url)) {
      await dump("origin-back");
      throw new Error(`back from approvals landed on ${url} (came from ${from}); url trail=${JSON.stringify(trail)}`);
    }
    return `origin honored: ${url}`;
  });

  // ---------- nested settings: ownership + trail ----------
  await step("5. Nested settings route shows the hub trail under the People portal", async () => {
    await waitForRenderedPage("/settings/team", "settings/team");
    await waitUntil(async () => (await barState()).present, 120000, "settings/team bar");
    const bar = await barState();
    const hrefs = bar.links.map((l) => l.href);
    if (hrefs[0] !== "/people") throw new Error(`trail must start at the owning portal landing, got ${JSON.stringify(hrefs)}`);
    if (!hrefs.includes("/settings/company")) throw new Error(`hub crumb missing: ${JSON.stringify(hrefs)}`);
    if (!/Company Settings/i.test(bar.crumbText)) throw new Error(`hub crumb mislabeled: "${bar.crumbText}"`);
    await shot("05-nested-settings-trail");
    await pressBack();
    const url = await expectUrl(/\/settings\/company$/, "back stays inside the settings section");
    return `trail="${bar.crumbText}" -> ${url}`;
  });

  // ---------- no duplicate controls on pages that own them ----------
  await step("6. Pages that own their back/breadcrumbs get no central bar", async () => {
    const checked = [];
    for (const p of ["/billing/invoices", "/crm/deals", "/tasks/work"]) {
      await waitForRenderedPage(p, p);
      const url = await currentUrl();
      if (!url.includes(p)) throw new Error(`${p} navigated away to ${url}`);
      const bar = await barState();
      if (bar.present) { await dump(`dup-${p.replace(/\W+/g, "-")}`); throw new Error(`${p} rendered a duplicate central bar`); }
      checked.push(p);
    }
    return `no bar on ${checked.join(", ")}`;
  });

  await step("7. The leave page exposes exactly one back affordance", async () => {
    await waitForRenderedPage("/people/leave", "leave page (dup check)");
    await waitUntil(async () => (await barState()).present, 120000, "leave bar");
    const bar = await barState();
    if (bar.backControlsInPage !== 1) {
      await dump("back-affordances");
      throw new Error(`expected exactly one back affordance, found ${bar.backControlsInPage}`);
    }
    return `back affordances=${bar.backControlsInPage}`;
  });

  // ---------- activity boundary: another activity's module ----------
  await step("8. Facility tenant: own module navigable, other activity denied", async () => {
    await loginAs(FAC_EMAIL, FAC_PASS, "fac-admin");

    await waitForRenderedPage("/facilities/assets", "facilities assets");
    await waitUntil(async () => (await barState()).present, 120000, "facilities/assets bar");
    const bar = await barState();
    if (!bar.links.some((l) => l.href === "/facilities")) throw new Error(`facilities landing missing: ${JSON.stringify(bar.links)}`);
    await pressBack();
    const url = await expectUrl(/\/facilities($|\?)/, "back stays in the facilities portal");

    await waitForRenderedPage("/agency/campaigns", "agency route (facility tenant)");
    const denied = await evalJs(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-construction')`);
    const barOnDenied = (await barState()).present;
    if (!denied) { await dump("fac-agency"); throw new Error("inactive-activity route did not render its denied state"); }
    if (barOnDenied) throw new Error("the bar must not offer navigation on a denied activity page");
    return `assets -> ${url}; /agency denied and bar-free`;
  });

  // ---------- permission boundary ----------
  await step("9. Employee: permission-gated pages offer no shared navigation", async () => {
    await loginAs(EMP_EMAIL, EMP_PASS, "employee");
    // ROLE_PERMISSIONS.employee has no users.manage_roles / people.view_schedules,
    // so both registry targets are gated for this user (portal-access.ts and the
    // sidebar keep their own rules; here we only assert the bar never advertises
    // a route the user may not open).
    const notes = [];
    for (const p of ["/settings/team", "/people/schedules"]) {
      await goto(`${APP}${p}`);
      await new Promise((r) => setTimeout(r, 8000)); // let the gate / redirect settle
      const bar = await barState();
      if (bar.present) {
        await dump(`emp-gated-${p.replace(/\W+/g, "-")}`);
        throw new Error(`${p} rendered the shared bar for a user who lacks its permission`);
      }
      const url = await currentUrl();
      const denied = await evalJs(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-lock')`);
      notes.push(`${url}${denied ? " (denied state)" : ""}`);
    }
    // Sidebar filtering is pre-existing behavior, reported as a diagnostic rather
    // than asserted here — the registry contract under test is that the shared bar
    // never offers a gated target.
    const linkVisible = await evalJs(`!!document.querySelector('a[href="/people/schedules"]')`);
    log(`   [diag] employee sidebar offers the gated schedules link: ${linkVisible}`);
    return `no bar on ${notes.join(", ")}${linkVisible ? " (gated link still listed in the sidebar — pre-existing)" : "; gated link hidden"}`;
  });

  await step("10. Employee: people navigation stays on allowed targets only", async () => {
    await waitForRenderedPage("/people/leave", "employee leave page");
    await waitUntil(async () => (await barState()).present, 120000, "employee leave bar");
    const bar = await barState();
    const hrefs = bar.links.map((l) => l.href);
    // Permission-gated modules the employee cannot open must never appear.
    for (const forbidden of ["/people/schedules", "/people/lateness-policies", "/people/lateness-report", "/people/team", "/people/roles"]) {
      if (hrefs.includes(forbidden)) throw new Error(`trail offers a target the employee cannot open: ${forbidden}`);
    }
    await pressBack();
    const url = await expectUrl(/\/people($|\?)/, "employee back lands on the portal landing");
    return `trail="${bar.crumbText}" -> ${url}`;
  });

  // ---------- Arabic + RTL ----------
  await step("11. Arabic locale: localized trail inside an RTL document", async () => {
    await loginArabicAdmin();

    await waitForRenderedPage("/settings/team", "arabic settings/team");
    await waitUntil(async () => (await barState()).present, 120000, "arabic settings/team bar");
    const dir = await evalJs("document.documentElement.dir || document.body.dir || getComputedStyle(document.body).direction");
    const bar = await barState();
    if (!/rtl/i.test(dir)) throw new Error(`document direction is ${dir}, expected rtl`);
    if (!/[\u0600-\u06FF]/.test(bar.crumbText)) throw new Error(`crumbs are not localized: "${bar.crumbText}"`);
    if (!/[\u0600-\u06FF]/.test(bar.backLabel || "")) throw new Error(`back label not localized: "${bar.backLabel}"`);
    await shot("11-arabic-rtl");
    return `dir=${dir} trail="${bar.crumbText}" back="${bar.backLabel}"`;
  });

  await step("12. No unhandled runtime exceptions during navigation", async () => {
    const exceptions = consoleBuf.filter((x) => x.startsWith("[exception]"));
    if (exceptions.length) throw new Error(`${exceptions.length} exception(s): ${exceptions.slice(0, 3).join(" | ").slice(0, 400)}`);
    return `clean console (${consoleBuf.length} lines observed)`;
  });
} catch (e) {
  log(`\n[FATAL] ${e?.message || e}`);
  await dump("fatal").catch(() => {});
  results.push({ name: "fatal", ok: false, error: String(e?.message || e) });
} finally {
  const failed = results.filter((r) => !r.ok);
  log("\n=================================================================");
  log(` Navigation browser results: ${results.length - failed.length}/${results.length} steps passed`);
  log("=================================================================");
  for (const f of failed) log(` ✗ ${f.name}: ${f.error}`);
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  process.exit(failed.length ? 1 : 0);
}
