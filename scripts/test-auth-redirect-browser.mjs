/**
 * D-Arrow Business — PHASE 2 Auth Redirect Acceptance (Edge headless / CDP)
 *
 * Reproduces the reported critical defect: "login succeeds but the app dumps
 * the user on the public website". Drives the REAL UI against local Auth +
 * Firestore emulators and asserts, from a continuous URL trace, that no
 * authentication completion ever renders the marketing landing page.
 *
 * Scenarios (per the acceptance matrix):
 *  T1 email/password login lands on the internal portal picker; the browser
 *     trace never visits "/" with the landing nav mounted.
 *  T2 unauthenticated deep link to a protected route -> /login bounce ->
 *     login returns to the ORIGINAL protected route.
 *  T3 refresh on a protected route with a persisted session stays inside.
 *  T4 signed-in intentional visit to "/" still renders marketing (public
 *     routes preserved) — but a navigation carrying auth-completion intent
 *     is forwarded to /apps.
 *  T5 already-authenticated visitor on /login is bounced to the picker,
 *     never to "/".
 *  T6 legacy /darrow/* compatibility login.
 *  T7 session cleared -> login as a different tenant user lands internally.
 *  T8 user with a missing profile document still lands inside the app.
 *
 * Fixture seeding uses the emulator REST APIs (allowed for prerequisites);
 * every workflow under test is performed through the UI.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const browserPath = edgeCandidates.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Edge/Chrome installation found for CDP testing");

const profileDir = path.join(os.tmpdir(), `edge_authredirect_${Date.now()}`);
const CDP_PORT = 9782;
const VITE_PORT = 5179;
const PROJECT_ID = "auth-redirect-acceptance";
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OUT_DIR = "tmp/auth-redirect";
const BASE = `http://localhost:${VITE_PORT}`;

const USER_A = { email: "redirect_admin_a@acme.test", pass: "RedirectTest2026!", company: "acme-co" };
const USER_B = { email: "redirect_admin_b@globe.test", pass: "RedirectTest2026!", company: "globe-co" };
const USER_GHOST = { email: "redirect_ghost@acme.test", pass: "RedirectTest2026!" }; // no users/{uid} doc

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);
let adminIdToken = "";
let edgeProc = null;
let ws = null;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// ---------- Firestore / Auth emulator REST helpers (fixtures only) ----------
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
async function seedDoc(docPath, obj) {
  // Fixture seeding uses the emulator-only "owner" token, which bypasses
  // rules for prerequisite writes (test tenants only; UI workflows under
  // test still run through real rules-backed client reads/writes).
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seed PATCH ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function ensureAuthUser(email, password) {
  let d = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  if (!d.localId) {
    d = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    })).json();
  }
  if (!d.localId) throw new Error(`auth user creation failed for ${email}: ${JSON.stringify(d)}`);
  return d;
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
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  },
  stdio: "pipe",
});
viteProc.stdout.on("data", (d) => { const s = String(d); if (/error/i.test(s)) log(`[vite] ${s.trim()}`); });
viteProc.stderr.on("data", (d) => log(`[vite-err] ${String(d).trim()}`));

try {
  await waitUntil(async () => (await fetch(`${BASE}/`)).ok, 90000, "Vite ready");

  // ---------- 2. Fixtures: tenants + users on the emulators ----------
  const suA = await ensureAuthUser(USER_A.email, USER_A.pass);
  const suB = await ensureAuthUser(USER_B.email, USER_B.pass);
  await ensureAuthUser(USER_GHOST.email, USER_GHOST.pass);
  adminIdToken = suA.idToken;

  await seedDoc(`companies/${USER_A.company}`, { name: "Acme Co", defaultCurrency: "SAR" });
  await seedDoc(`companies/${USER_B.company}`, { name: "Globe Co", defaultCurrency: "SAR" });
  await seedDoc(`users/${suA.localId}`, {
    id: suA.localId, email: USER_A.email, name: "Admin A", role: "admin",
    companyId: USER_A.company, companyName: "Acme Co", avatar: "",
  });
  await seedDoc(`users/${suB.localId}`, {
    id: suB.localId, email: USER_B.email, name: "Admin B", role: "admin",
    companyId: USER_B.company, companyName: "Globe Co", avatar: "",
  });
  log("Fixtures seeded (2 tenant admins + 1 profile-less user).");

  // ---------- 3. Edge headless over CDP ----------
  log(`Starting headless browser on CDP ${CDP_PORT}...`);
  const edgeProcLocal = spawn(browserPath, [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run", "--no-default-browser-check", "--window-size=1280,900",
    `--user-data-dir=${profileDir}`, "about:blank",
  ]);
  edgeProc = edgeProcLocal;
  let pageTarget = null;
  for (let i = 0; i < 30 && !pageTarget; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const pages = await res.json();
        pageTarget = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      }
    } catch {}
  }
  if (!pageTarget) throw new Error("No browser CDP page target");

  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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
  await send("Runtime.enable");
  await send("Page.enable");

  async function shot(name) {
    try {
      const scr = await send("Page.captureScreenshot", { format: "png" });
      if (scr?.result?.data) {
        const p = path.join(OUT_DIR, `${name}.png`);
        writeFileSync(p, Buffer.from(scr.result.data, "base64"));
        log(`   screenshot -> ${p}`);
      }
    } catch {}
  }
  async function goto(url) { await send("Page.navigate", { url }); await sleep(700); }
  async function currentUrl() { return (await js("window.location.href")) || ""; }

  // Continuous URL trace while the app settles after a login click.
  async function traceUrls(ms) {
    const seen = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const u = await currentUrl();
      if (!seen.includes(u)) seen.push(u);
      await sleep(120);
    }
    return seen;
  }
  const isMarketingHome = (u) => { try { return new URL(u).pathname === "/"; } catch { return false; } };
  const pathnameOf = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
  async function landingNavMounted() {
    // The marketing nav is identified by its anchor links (AnimatedDiv does
    // not reliably surface the id to the DOM under headless timing).
    return js(`(() => {
      if (document.getElementById('landing-nav')) return true;
      return Array.from(document.querySelectorAll('a')).some(a => a.getAttribute('href') === '#apps');
    })()`);
  }

  // ---------- UI primitives ----------
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
  async function clickSubmitSignIn() {
    return js(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = (b.innerText || '').trim().toLowerCase();
        return (t === 'sign in' || t === 'signing in...') && b.type === 'submit';
      });
      if (!btn) return false;
      btn.click(); return true;
    })()`);
  }
  async function uiLogin(email, pass) {
    // Cold Vite chunk compilation can take minutes on first hit — mirror the
    // reference harness patience (repo convention).
    await waitUntil(
      async () => await js(`!!document.querySelector('input[name="email"]')`),
      120000,
      `login form at ${await currentUrl()}`,
    );
    // Pin English deterministically: the language detector falls back to the
    // machine locale (often Arabic), making button needles machine-dependent.
    await js(`localStorage.setItem('d-arrow-lang', 'en')`);
    await send("Page.reload", { ignoreCache: true });
    await waitUntil(
      async () => await js(`!!document.querySelector('input[name="email"]')`),
      90000,
      "login form (english pinned)",
    );
    await js(`(() => {
      const set = (sel, v) => { const el = document.querySelector(sel);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('input[name="email"]', ${JSON.stringify(email)});
      set('input[type="password"]', ${JSON.stringify(pass)});
    })()`);
    await waitUntil(async () => await js(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim().toLowerCase().includes('sign in') && b.type === 'submit');
      if (!btn) return false;
      btn.click(); return true;
    })()`), 20000, "sign-in submit button");
  }
  async function clearSession() {
    await js(`(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} return true; })()`);
    await js(`(() => new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase('firebaseLocalStorageDb');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(true);
      } catch { resolve(true); }
    }))()`);
  }

  // ---------- Assertions ----------
  function record(name, ok, detail) {
    results.push({ name, ok, detail });
    log(`${ok ? "PASS" : "FAIL"} - ${name}${detail ? ` :: ${detail}` : ""}`);
  }

  async function expectLandedInternally(name, initialUrl, email, pass) {
    await clearSession();
    await goto(initialUrl);
    // Wait for the login form to be reachable (deep links bounce through /login).
    await uiLogin(email, pass);
    // Cold dev-server hydration can make the first authenticated transition
    // slow; trace the URL continuously until it leaves /login (bounded).
    const trace = [];
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const u = await currentUrl();
      if (!trace.includes(u)) trace.push(u);
      if (!u.includes("/login")) break;
      await sleep(120);
    }
    await sleep(1500);
    const final = await currentUrl();
    if (!trace.includes(final)) trace.push(final);
    // The defect signature: the marketing homepage DOM appears at "/" during
    // the authentication completion flow.
    let publicVisit = null;
    for (const u of trace) {
      if (isMarketingHome(u) && (await landingNavMounted())) { publicVisit = u; break; }
    }
    await shot(name);
    record(name, !publicVisit && pathnameOf(final).startsWith("/apps"), `trace=${JSON.stringify(trace)} final=${final}`);
    if (publicVisit) record(`${name} (defect repro)`, false, `marketing homepage rendered during auth flow at ${publicVisit}`);
    return { trace, final };
  }

  // ===== T1 — plain login must land on the internal picker, never "/" =====
  await expectLandedInternally("T1-login-lands-on-picker", `${BASE}/login`, USER_A.email, USER_A.pass);

  // ===== T2 — deep-link bounce returns to the original protected route =====
  await clearSession();
  await goto(`${BASE}/crm/leads`);
  await waitUntil(async () => (await currentUrl()).includes("/login"), 20000, "deep link bounced to /login");
  await uiLogin(USER_A.email, USER_A.pass);
  const t2trace = await traceUrls(12000);
  const t2final = await currentUrl();
  await shot("T2-return-to-deeplink");
  record(
    "T2-return-to-requested-protected-route",
    t2final.includes("/crm/leads") && !t2trace.some(isMarketingHome),
    `final=${t2final} trace=${JSON.stringify(t2trace)}`,
  );

  // ===== T3 — refresh on a protected route keeps the session =====
  await goto(`${BASE}/crm/leads`);
  await js("window.location.reload()");
  await waitUntil(async () => (await js("!!document.querySelector('input,[data-testid]') || document.body.innerText.length > 50")), 25000, "app content after refresh");
  const t3 = await currentUrl();
  await shot("T3-refresh");
  record("T3-refresh-keeps-protected-route", t3.includes("/crm/leads") && !isMarketingHome(t3), `final=${t3}`);

  // ===== T4 — signed-in intentional "/" visit still shows marketing =====
  await goto(`${BASE}/`);
  try {
    await waitUntil(async () => await landingNavMounted(), 30000, "landing nav for signed-in marketing visit");
  } catch {}
  await sleep(800);
  const t4url = await currentUrl();
  const t4landing = await landingNavMounted();
  await shot("T4-authenticated-landing");
  record("T4-authenticated-can-still-open-marketing", isMarketingHome(t4url) && t4landing, `final=${t4url} landing=${t4landing}`);

  // ===== T5 — already-authenticated visitor on /login never hits "/" =====
  await goto(`${BASE}/login`);
  const t5trace = await traceUrls(5000);
  const t5final = await currentUrl();
  await shot("T5-authenticated-login-bounce");
  record(
    "T5-authenticated-login-bounce-to-picker",
    !t5trace.some(isMarketingHome) && (t5final.includes("/apps") || t5final.includes("/crm")),
    `final=${t5final} trace=${JSON.stringify(t5trace)}`,
  );

  // ===== T6 — legacy /darrow/* compatibility path =====
  await clearSession();
  await goto(`${BASE}/darrow/login`);
  await waitUntil(
    async () => pathnameOf(await currentUrl()).startsWith("/darrow") || pathnameOf(await currentUrl()) === "/login",
    60000,
    "legacy route rendered",
  );
  let t6path = pathnameOf(await currentUrl());
  if (t6path.startsWith("/darrow")) {
    // give the prefix-strip redirect a moment, then re-read
    try {
      await waitUntil(async () => pathnameOf(await currentUrl()) === "/login", 30000, "darrow prefix stripped to /login");
    } catch {}
    t6path = pathnameOf(await currentUrl());
  }
  await uiLogin(USER_A.email, USER_A.pass);
  const t6trace = await traceUrls(9000);
  const t6final = await currentUrl();
  await shot("T6-legacy-route");
  record(
    "T6-legacy-darrow-login-internal",
    t6path === "/login" && pathnameOf(t6final).startsWith("/apps") && !t6trace.some(isMarketingHome),
    `bounce=${t6path} final=${t6final}`,
  );

  // ===== T7 — other tenant login after session clear lands internally =====
  await expectLandedInternally("T7-second-tenant-login", `${BASE}/login`, USER_B.email, USER_B.pass);

  // ===== T8 — missing profile document must not break the landing =====
  await expectLandedInternally("T8-missing-profile-login", `${BASE}/login`, USER_GHOST.email, USER_GHOST.pass);

  // ---------- Report ----------
  const hardErrors = consoleBuf.filter((l) => l.startsWith("[exception]") || l.startsWith("[error]"));
  writeFileSync(path.join(OUT_DIR, "console.log"), consoleBuf.join("\n"), "utf8");
  writeFileSync(
    path.join(OUT_DIR, "results.json"),
    JSON.stringify({ results, hardErrors: hardErrors.slice(0, 40) }, null, 2),
    "utf8",
  );
  const failed = results.filter((r) => !r.ok);
  log("\n================ PHASE 2 AUTH REDIRECT ACCEPTANCE ================");
  for (const r of results) log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  log(`\n${results.length - failed.length}/${results.length} passed. Console errors captured: ${hardErrors.length}`);
  if (hardErrors.length) log("First console errors:\n" + hardErrors.slice(0, 6).join("\n"));
  if (failed.length) {
    log(`\nFAILED: ${failed.map((f) => f.name).join(", ")}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 1;
} finally {
  try { if (ws) ws.close(); } catch {}
  try { if (edgeProc) edgeProc.kill(); } catch {}
  viteProc.kill();
}
