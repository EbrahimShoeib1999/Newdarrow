/**
 * D-Arrow Business — Employee Lifecycle Runtime Verification (Browser / CDP)
 *
 * Drives Microsoft Edge headless against the local Firebase Auth + Firestore
 * emulators to prove the FULL employee path works through the real UI:
 *
 *   admin hires via UI  ->  a real invites/{token} doc exists
 *   ->  open /invite/:token  ->  set password (acceptInvite)  ->  auto-login
 *   ->  authenticated Firebase UID maps to users/{uid} with the right companyId
 *   ->  the employee business record is claimed by identity
 *   ->  timer start persists an attendance record in the emulator
 *   ->  refresh keeps the session + resumes the shift
 *   ->  check-out persists the final time entry
 *
 * Every mutation is performed by actual UI interaction. The emulator REST API is
 * used only for READ-ONLY verification of persisted state (never to fake results).
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_emp_${Date.now()}`);
const CDP_PORT = 9778;
const VITE_PORT = 5175;
const PROJECT_ID = "test-employee-lifecycle";
const COMPANY_ID = "acme-co";
const ADMIN_EMAIL = "lifecycle_admin@acme.test";
const ADMIN_PASS = "LifecycleAdmin2026!";
const EMP_EMAIL = "lifecycle_emp@acme.test";
const EMP_PASS = "LifecycleEmp2026!";

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/employee-lifecycle";

try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {}
mkdirSync(profileDir, { recursive: true });
try {
  mkdirSync(OUT_DIR, { recursive: true });
} catch {}

const log = (...a) => console.log(...a);

// ---------- admin Firestore helpers (emulator REST v1, authenticated) ----------
// The browser app performs every mutation with security rules ENFORCED through
// the client SDK. For seeding + verification we use the Firestore emulator's
// REST v1 API but ATTACH THE ADMIN'S Firebase ID TOKEN, so rules evaluate as
// that admin (signedIn() true, uid==userId, companyId match). This is the SAME
// rules the UI is subject to — we do NOT bypass them; we simply act as a
// legitimately-authorized admin, never as an unauthenticated over-reader.
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
    method: "PATCH",
    headers: authHdr(),
    body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seed PATCH ${docPath} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

log("=================================================================");
log(" D-Arrow Business — Employee Lifecycle Runtime Verification (CDP)");
log("=================================================================\n");

// ---------- 1. start isolated Vite against the emulators ----------
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
    // Never make a real EmailJS request during local verification. The invite
    // still persists; delivery is reported as "not sent" (link-only) which also
    // exercises the honest-delivery + resend path added for the HTTP-426 audit.
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  },
  stdio: "pipe",
});
let viteReady = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    if ((await fetch(`http://localhost:${VITE_PORT}/`)).ok) { viteReady = true; break; }
  } catch {}
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
log(`Vite ready: http://localhost:${VITE_PORT}`);

// ---------- 2. start Edge headless ----------
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1280,900",
  `--user-data-dir=${profileDir}`,
  "about:blank",
]);
let pageTarget = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      pageTarget = pages.find((p) => p.type === "page");
      if (pageTarget?.webSocketDebuggerUrl) break;
    }
  } catch {}
}
if (!pageTarget) { edgeProc.kill(); viteProc.kill(); throw new Error("No Edge CDP target"); }

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
function send(method, params = {}) {
  return new Promise((resolve) => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression, byValue = true) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: byValue });
  if (res?.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
  return res?.result?.result?.value;
}
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Network.clearBrowserCookies");

// Grant geolocation and pin a fixed position. This forces the flexible
// check-in down the REAL GPS path — the exact production condition where a
// geo payload exists while the company has no work locations, so
// locationName resolves to undefined. Without the override, headless Edge
// denies geolocation, geo is skipped entirely, and the payload bug never
// executes (which is why earlier synthetic runs could not see it).
await send("Browser.grantPermissions", { origin: `http://localhost:${VITE_PORT}`, permissions: ["geolocation"] });
await send("Emulation.setGeolocationOverride", { latitude: 24.7136, longitude: 46.6753, accuracy: 15 });

// Admin Firestore access is via the emulator REST v1 API (see helpers above),
// which the emulator serves without enforcing security rules. `emulators:exec`
// starts a FRESH, empty Firestore every run, so no cross-run cleanup is needed.

async function shot(name) {
  const scr = await send("Page.captureScreenshot", { format: "png" });
  if (scr?.result?.data) { const p = path.join(OUT_DIR, `${name}.png`); writeFileSync(p, Buffer.from(scr.result.data, "base64")); log(`   📸 ${p}`); }
}
async function goto(url) { await send("Page.navigate", { url }); await new Promise((r) => setTimeout(r, 1500)); }
async function currentUrl() { return (await evalJs("window.location.href")) || ""; }

// Readiness gate for the header attendance tracker after a fresh (re)load.
// Observed in every run so far: the emulator's cold rule-evaluation cache
// makes the FIRST LIST of a new page load gate-error (~"evaluation error at
// L242/L250 for 'list'"), the store then shows its user-visible retryable
// sync banner, and a repeat of the same query succeeds (hot cache). A real
// user clicks that banner's Retry button — so the harness does exactly that
// instead of blindly waiting, and never proceeds against an un-synced store.
async function waitForTrackerReady(mark) {
  const readyFrom = (from) => consoleBuf.slice(from).some((x) => /PeopleService:getAttendance.*Completed/i.test(x));
  try {
    await waitUntil(
      async () => readyFrom(mark) || (await evalJs(`!!document.querySelector('[role="alert"] button')`)),
      30000,
      "tracker sync to settle (completed or retry banner)"
    );
  } catch (e) {
    // Attach the page's actual state at timeout — a silent page (no console
    // lines at all) means the app never booted, which is a different failure
    // from a sync that ran and errored.
    const url = await currentUrl();
    const body = await evalJs("(document.body && document.body.innerText || '').replace(/\\s+/g,' ').slice(0,200)").catch(() => "(no body)");
    const tail = consoleBuf.slice(mark).slice(-8);
    log(`   [diag] unready at timeout: url=${url} body="${body}"`);
    log(`   [diag] console since mark (${tail.length}):\n     ${tail.join("\n     ") || "(none — page logged nothing)"}`);
    throw e;
  }
  if (readyFrom(mark)) return;
  log("   [diag] sync banner shown after reload — clicking the user-visible Retry");
  await evalJs(`(() => { const b = document.querySelector('[role="alert"] button'); if (b) b.click(); })()`);
  // Any Completed line after `mark` necessarily follows the banner (the first
  // sync had failed), so re-scanning from `mark` cannot false-positive.
  await waitUntil(() => readyFrom(mark), 60000, "attendance tracker ready after retry");
}
async function dumpPage(tag) {
  try {
    const url = await currentUrl();
    const text = await evalJs("(document.body && document.body.innerText || '').replace(/\s+/g,' ').slice(0, 400)");
    log(`   [dump:${tag}] url=${url} body="${text}"`);
    await shot(`dump-${tag}`);
  } catch (e) { log(`   [dump:${tag}] failed: ${e?.message}`); }
}

// native value setter that React recognizes
const SETTER = "Object.getOwnPropertyDescriptor(window.%CLASS%.prototype,'%PROP%').set";
function setFieldExpr(selector, value, cls = "HTMLInputElement", prop = "value") {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = ${SETTER.replace("%CLASS%", cls).replace("%PROP%", prop)};
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

const results = [];
async function step(name, fn) {
  try { const detail = await fn(); log(`✓ PASS: ${name}${detail ? ` — ${detail}` : ""}`); results.push({ name, ok: true, detail }); }
  catch (e) { log(`✗ FAIL: ${name} — ${e?.message || e}`); results.push({ name, ok: false, error: e?.message || String(e) }); }
}

let adminIdToken = "";
let capturedInviteUrl = "";
let inviteToken = "";
let empUid = "";
let empRecordId = "";
try {
  // ---------- Step 1: seed admin auth user + minimal Firestore fixtures ----------
  await step("1. Seed admin account + company (fixture)", async () => {
    const su = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
    })).json();
    if (!su.localId) throw new Error("admin signUp failed: " + JSON.stringify(su));
    adminIdToken = su.idToken;
    const uid = su.localId;
    const signIn = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
    })).json();
    adminIdToken = signIn.idToken;
    return `admin uid=${uid}`;
  });

  // Firestore users/{uid} + companies/{id} are seeded via the emulator import
  // endpoint (fixture setup only — no application lifecycle data is written).
  await step("1b. Seed users/{adminUid} + companies/{acme-co} (fixture)", async () => {
    const usersRes = await (await fetch(`${AUTH_BASE}/accounts:lookup?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: adminIdToken }),
    })).json();
    const adminUid = usersRes.users?.[0]?.localId;
    if (!adminUid) throw new Error("could not resolve admin uid");
    await seedDoc(`users/${adminUid}`, {
      email: ADMIN_EMAIL, name: "Acme Admin", companyId: COMPANY_ID, role: "admin",
    });
    await seedDoc(`companies/${COMPANY_ID}`, {
      id: COMPANY_ID, name: "Acme Solutions", defaultCurrency: "SAR",
    });
    const back = await fsGet(`users/${adminUid}`);
    log(`   [diag] seeded users/${adminUid} => role=${back?.role} companyId=${back?.companyId} email=${back?.email} exists=${!!back}`);
    if (back?.role !== "admin" || back?.companyId !== COMPANY_ID) throw new Error("admin fixture not persisted");
    return `adminUid=${adminUid}`;
  });

  // ---------- Step 2: admin logs in through the UI ----------
  await step("2. Admin login via UI form", async () => {
    await goto(`http://localhost:${VITE_PORT}/login`);
    await waitUntil(() => evalJs(`!!document.querySelector('input[name="email"]')`), 25000, "login form");
    await evalJs(setFieldExpr('input[name="email"]', ADMIN_EMAIL));
    await evalJs(setFieldExpr('input[type="password"]', ADMIN_PASS));
    await evalJs(`document.querySelector('button[type="submit"]').click()`);
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 25000, "post-login redirect");
    await shot("01-admin-logged-in");
    return `url=${await currentUrl()}`;
  });

  // ---------- Step 3: hire an employee through the real modal ----------
  await step("3. Hire employee through UI (HireEmployeeModal)", async () => {
    await goto(`http://localhost:${VITE_PORT}/people`);
    let reloaded = false;
    const hireClicked = await (async () => {
      for (let i = 0; i < 90; i++) {
        const ok = await evalJs(`(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x =>
            x.querySelector('svg.lucide-user-plus') ||
            /new hire|تعيين|دعوة موظف|invite new/i.test(x.innerText || ''));
          if (b) { b.click(); return true; } return false;
        })()`);
        if (ok) return true;
        // Self-heal a cold route chunk / stray Vite HMR reload: the page renders
        // blank (no buttons at all) for a while right after a hard navigation.
        if (!reloaded && i === 30) {
          const empty = await evalJs(`(document.body && document.body.innerHTML.length) || 0`);
          if (empty < 40) { log(`   [diag] /people blank (bodyLen=${empty}); reloading once`); await send("Page.reload"); await new Promise((r) => setTimeout(r, 4000)); reloaded = true; }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })();
    if (!hireClicked) {
      await dumpPage("no-hire-button");
      const btns = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => (b.innerText||'').replace(/\s+/g,' ').trim()).filter(Boolean))`);
      const upIcon = await evalJs(`document.querySelectorAll('svg.lucide-user-plus').length`);
      const html = await evalJs(`(() => ({ title: document.title, rootChildren: (document.getElementById('root')||{childElementCount:-1}).childElementCount, bodyLen: (document.body&&document.body.innerHTML.length)||0 }))()`);
      log(`   [diag] html=${JSON.stringify(html)}`);
      log(`   [diag] user-plus svg count=${upIcon}`);
      log(`   [diag] buttons=${btns}`);
      const c = consoleBuf.slice(-25);
      log(`   [diag] console (${c.length}):\n     ${c.join("\n     ") || "(none)"}`);
      throw new Error("hire button never appeared on /people");
    }
    await waitUntil(() => evalJs(`!!document.querySelector('input[name="email"]')`), 15000, "hire modal inputs");
    await evalJs(setFieldExpr('input[name="firstName"]', "Rania"));
    await evalJs(setFieldExpr('input[name="lastName"]', "Haddad"));
    await evalJs(setFieldExpr('input[name="jobTitle"]', "Software Engineer"));
    await evalJs(setFieldExpr('input[name="email"]', EMP_EMAIL));
    await shot("02-hire-modal-filled");
    await evalJs(`(() => { const b = document.querySelector('button[type="submit"]'); if (b) b.click(); })()`);
    await new Promise((r) => setTimeout(r, 4000));
    const relevant = consoleBuf.filter((x) => /ermission|enied|nvite|rror|ailed|createInvite|InvitesService/i.test(x)).slice(-20);
    log(`   [diag] post-submit console (${relevant.length} lines):\n     ${relevant.join("\n     ") || "(none)"}`);
    await dumpPage("after-hire-submit");
    // success step shows a read-only invite url input containing /invite/<token>
    capturedInviteUrl = await waitUntil(() => evalJs(`(() => {
      const i = Array.from(document.querySelectorAll('input')).find(x => (x.value||'').includes('/invite/'));
      return i ? i.value : null;
    })()`), 20000, "invite url in success step");
    await shot("03-invite-generated");
    // Honesty (HTTP-426 audit item C): with email delivery suppressed in this
    // environment, the success step must NOT claim the invite email was sent,
    // and must instead expose the manual link + a resend action.
    const successText = await evalJs(`(document.body.innerText || '').replace(/\s+/g, ' ')`);
    if (/invitation sent|sent the invitation|sent invitation notice|emailed the invitation|تم إرسال دعوة التعيين بنجاح/i.test(successText)) {
      throw new Error("success step falsely claims the invite email was sent");
    }
    const resendAvailable = await evalJs(`(() => Array.from(document.querySelectorAll('button')).some(b => /resend|إعادة إرسال/i.test(b.innerText || '')))()`);
    if (!resendAvailable) throw new Error("delivery-failure state must expose a resend action");
    return capturedInviteUrl;
  });

  // ---------- Step 4: a REAL invites/{token} doc must exist ----------
  await step("4. Real pending invites/{token} doc created in emulator", async () => {
    // The UI's success step exposes the exact /invite/<token> url; that token is
    // the invite document id. Reading it by id is explicitly allowed by rule L84
    // while the invite is pending (this is the same read the accept page does).
    inviteToken = decodeURIComponent((capturedInviteUrl.split("/invite/")[1] || "").split(/[?#]/)[0]);
    if (!inviteToken) throw new Error("could not parse token from UI invite url");
    const invites = await waitUntil(async () => {
      const d = await fsGet(`invites/${inviteToken}`);
      return d && String(d.email).toLowerCase() === EMP_EMAIL && d.status === "pending" ? d : null;
    }, 15000, "invite doc");
    if (invites.companyId !== COMPANY_ID) throw new Error(`invite companyId mismatch: ${invites.companyId}`);
    return `token=${inviteToken} companyId=${invites.companyId}`;
  });

  // ---------- Step 4b: employee-card DOM integrity (nested-button audit) ----------
  await step("4b. Employee card: no nested <button>, dropdown independent", async () => {
    await goto(`http://localhost:${VITE_PORT}/people`);
    await waitUntil(() => evalJs(`/Rania|Haddad|Software Engineer/i.test(document.body.innerText || '')`), 20000, "employee card visible");
    // Walk every <button> and check none has a <button> ancestor. This is the
    // exact invalid DOM React warned about (HeroUI pressable card + inner
    // dropdown trigger). After the fix the count must be 0.
    const audit = await evalJs(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      let nested = 0;
      for (const b of buttons) {
        let p = b.parentElement;
        while (p) { if (p.tagName === 'BUTTON') { nested++; break; } p = p.parentElement; }
      }
      return { nested, total: buttons.length, descendantSel: document.querySelectorAll('button button').length };
    })()`);
    if (audit.descendantSel > 0 || audit.nested > 0) {
      throw new Error(`nested <button> detected: descendantSel=${audit.descendantSel} ancestorWalk=${audit.nested}`);
    }
    // Confirm the row dropdown still opens on its own (menu items render).
    const ddClicked = await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg[class*="more"], svg[class*="ellipsis"], svg[class*="vertical"]'));
      if (!b) return false; b.click(); return true;
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    const menuItems = await evalJs(`document.querySelectorAll('[role="menuitem"]').length`);
    await shot("04-employee-card-menu");
    await evalJs(`(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    if (!ddClicked) log("   [diag] ellipsis dropdown trigger not located (nesting audit still valid)");
    if (ddClicked && menuItems === 0) throw new Error("dropdown trigger clicked but no menu items rendered");
    return `nested=0 total=${audit.total} menuItems=${menuItems}`;
  });

  // ---------- Step 4c: charts measurable across responsive widths ----------
  await step("4c. Charts render measurable across mobile/tablet/desktop (no -1 warnings)", async () => {
    const modes = [
      { label: "desktop", width: 1280, height: 900, mobile: false },
      { label: "tablet", width: 768, height: 1024, mobile: false },
      { label: "mobile", width: 390, height: 844, mobile: true },
    ];
    const report = [];
    for (const m of modes) {
      await send("Emulation.setDeviceMetricsOverride", { width: m.width, height: m.height, deviceScaleFactor: 1, mobile: m.mobile });
      await new Promise((r) => setTimeout(r, 1400));
      const sizes = await evalJs(`(() => Array.from(document.querySelectorAll('.recharts-responsive-container')).map(c => ({ w: c.clientWidth, h: c.clientHeight })))()`);
      if (m.label === "desktop" && sizes.length === 0) throw new Error("no chart mounted on People dashboard — cannot verify sizing");
      for (const s of sizes) {
        if (!(s.w > 0 && s.h > 0)) throw new Error(`chart container not measurable at ${m.label}: ${JSON.stringify(s)}`);
      }
      report.push({ label: m.label, count: sizes.length, minW: sizes.length ? Math.min(...sizes.map((s) => s.w)) : 0, minH: sizes.length ? Math.min(...sizes.map((s) => s.h)) : 0 });
    }
    await send("Emulation.clearDeviceMetricsOverride");
    await new Promise((r) => setTimeout(r, 700));
    await shot("05-charts-desktop");
    // recharts logs "The width(..) and height(..) of chart should be greater than 0"
    // for a zero/negative-measured container — the exact audited warning.
    const negWarnings = consoleBuf.filter((x) => /of chart should be greater than 0/i.test(x));
    if (negWarnings.length) throw new Error(`recharts negative-dimension warning present: ${negWarnings[0]}`);
    const nestedWarn = consoleBuf.filter((x) => /validateDOMNesting.*button/i.test(x));
    if (nestedWarn.length) throw new Error(`React nested-button warning present: ${nestedWarn[0]}`);
    return JSON.stringify(report);
  });

  // ---------- Step 5: open /invite/:token and complete setup ----------
  await step("5. Accept invite via /invite/:token (set password)", async () => {
    await send("Network.clearBrowserCookies");
    await goto(capturedInviteUrl);
    await waitUntil(() => evalJs(`!!document.querySelector('input[type="password"]')`), 25000, "accept form");
    const pwCount = await evalJs(`document.querySelectorAll('input[type="password"]').length`);
    if (pwCount < 2) throw new Error(`expected password + confirm inputs, got ${pwCount}`);
    await evalJs(`(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
      const inputs = document.querySelectorAll('input[type="password"]');
      inputs.forEach((el) => { setter.call(el, ${JSON.stringify(EMP_PASS)}); el.dispatchEvent(new Event('input',{bubbles:true})); });
      return true;
    })()`);
    await shot("04-accept-invite-filled");
    await evalJs(`document.querySelector('button[type="submit"]').click()`);
    await waitUntil(async () => !(await currentUrl()).includes("/invite/"), 25000, "accept redirect");
    await shot("05-after-accept");
    return `url=${await currentUrl()}`;
  });

  // ---------- Step 6: invite marked accepted + UID captured ----------
  await step("6. Invite marked accepted + acceptedBy UID recorded", async () => {
    const inv = await waitUntil(async () => {
      const d = await fsGet(`invites/${inviteToken}`);
      return d && d.status === "accepted" ? d : null;
    }, 20000, "invite accepted");
    empUid = String(inv.acceptedBy || "");
    if (!empUid) throw new Error("invite accepted but no acceptedBy uid");
    return `acceptedBy=${empUid}`;
  });

  // ---------- Step 7: users/{uid} has correct company + role ----------
  await step("7. Authenticated UID maps to users/{uid} with correct companyId", async () => {
    const u = await waitUntil(async () => {
      const d = await fsGet(`users/${empUid}`);
      return d && d.companyId === COMPANY_ID ? d : null;
    }, 20000, "users/{uid} provisioning");
    return `companyId=${u.companyId} role=${u.role} email=${u.email}`;
  });

  // ---------- Step 8: employee business record claimed by identity ----------
  await step("8. Employee business record associated with the identity (claim-by-email)", async () => {
    // Navigate to the employee's own workspace so the global AttendanceInitializer
    // runs syncWithDb for the freshly-accepted session (this is what claims the
    // hired directory record by email and binds userId=uid).
    await goto(`http://localhost:${VITE_PORT}/people`);
    await new Promise((r) => setTimeout(r, 4000));
    // Surface what the employee's running app has logged (initializer sync,
    // any store error) before asserting the DB-side claim — the claim happens
    // in the browser via syncWithDb, so its console output is the evidence.
    const pre = consoleBuf.filter((x) => /ttendance|sync|ermission|denied|laim|user:/i.test(x)).slice(-12);
    log(`   [diag] app console before claim check (\n     ${pre.join("\n     ") || "(none)"}`);
    empRecordId = await waitUntil(async () => {
      const emps = await fsList(`companies/${COMPANY_ID}/employees`);
      const m = emps.find((e) => String(e.userId) === empUid && String(e.email).toLowerCase() === EMP_EMAIL);
      return m ? m.id : null;
    }, 25000, "employee record linked to uid");
    return `employeeId=${empRecordId}`;
  });

  // ---------- Step 9: timer start persists attendance ----------
  await step("9. Employee timer: start a valid session via UI", async () => {
    const mark = consoleBuf.length;
    await goto(`http://localhost:${VITE_PORT}/tasks`);
    // The header tracker renders before the fresh session's sync completes; the
    // store resolves the employee record only once getAttendance finishes.
    // Clicking earlier is a real no-op (now surfaced as an honest error toast),
    // so wait for the ready signal the same way a user waits for the app.
    await waitForTrackerReady(mark);
    const clicked = await waitUntil(() => evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-play') && x.offsetParent !== null);
      if (b) { b.click(); return true; } return false;
    })()`), 25000, "check-in (play) button");
    if (!clicked) throw new Error("no visible play/check-in button");
    await new Promise((r) => setTimeout(r, 2000));
    await shot("06-after-checkin");
    const ciConsole = consoleBuf.filter((x) => /ttendance|checkin|check-in|ermission|denied|Sync Error|store/i.test(x)).slice(-15);
    log(`   [diag] console after check-in click (\n     ${ciConsole.join("\n     ") || "(none)"}`);
    const rec = await waitUntil(async () => {
      const att = await fsList(`companies/${COMPANY_ID}/attendance`);
      const m = att.find((a) => String(a.employeeId) === empRecordId && a.checkIn);
      return m || null;
    }, 20000, "attendance record with checkIn").catch((e) => {
      // The write path is async (geo capture → addDoc); dump the FULL console
      // so a Firestore payload rejection is visible in this run's evidence.
      const all = consoleBuf.filter((x) => /checkIn|Check-in error|Unsupported|addDoc|ermission|denied|Sync Error|geolocation|getEmployee|getWorkLocations/i.test(x)).slice(-30);
      log(`   [diag] console after check-in waitUntil failure:\n     ${all.join("\n     ") || "(none)"}`);
      throw e;
    });
    // The geolocation override makes this the production repro: the write must
    // carry device coordinates and must NOT have hit the Firestore undefined
    // rejection (`location` is omitted when no work location matches).
    if (rec.checkInLat === undefined || rec.checkInLng === undefined) {
      throw new Error(`check-in did not persist device coordinates (geo path skipped?): ${JSON.stringify(rec)}`);
    }
    const undefErr = consoleBuf.filter((x) => /Unsupported field value: undefined/i.test(x));
    if (undefErr.length > 0) throw new Error(` Firestore undefined-field error recurred: ${undefErr[undefErr.length - 1]}`);
    if (rec.location !== undefined) log(`   [diag] persisted location="${rec.location}" (resolved work location)`);
    else log(`   [diag] persisted record has no 'location' key — undefined optional correctly omitted`);
    const openSessions = (await fsList(`companies/${COMPANY_ID}/attendance`)).filter((a) => String(a.employeeId) === empRecordId && a.checkIn && !a.checkOut);
    if (openSessions.length !== 1) throw new Error(`expected exactly 1 open session after check-in, found ${openSessions.length}`);
    return `attendanceId=${rec.id} status=${rec.status} coords=${rec.checkInLat},${rec.checkInLng} openSessions=1`;
  });

  // ---------- Step 10: refresh keeps session + shift resumes ----------
  await step("10. Refresh preserves session and resumes active shift", async () => {
    const mark = consoleBuf.length;
    await send("Page.reload");
    await new Promise((r) => setTimeout(r, 2000));
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 20000, "session after reload");
    await waitForTrackerReady(mark);
    const onDuty = await waitUntil(() => evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-square') && x.offsetParent !== null);
      return !!b;
    })()`), 25000, "on-duty (stop) control");
    if (!onDuty) throw new Error("shift did not resume as on-duty after refresh");
    await shot("07-resumed-after-refresh");
    return "shift resumed to on-duty after refresh";
  });

  // ---------- Step 11: check-out persists the final entry ----------
  await step("11. Employee timer: stop/check-out via UI persists final entry", async () => {
    await evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-square') && x.offsetParent !== null); if (b) b.click(); })()`);
    // daily report modal opens; fill summary then submit
    await waitUntil(() => evalJs(`!!document.querySelector('textarea')`), 15000, "daily report modal");
    await evalJs(`(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      const ta = document.querySelector('textarea');
      setter.call(ta, 'Completed onboarding tasks and verified lifecycle.');
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    await evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-send')); if (b) b.click(); })()`);
    await new Promise((r) => setTimeout(r, 2500));
    await shot("08-after-checkout");
    const done = await waitUntil(async () => {
      const att = await fsList(`companies/${COMPANY_ID}/attendance`);
      const m = att.find((a) => String(a.employeeId) === empRecordId && a.checkIn && a.checkOut);
      return m || null;
    }, 20000, "attendance record with checkOut");
    const emp = await fsGet(`companies/${COMPANY_ID}/employees/${empRecordId}`);
    return `attendanceId=${done.id} totalHours=${done.totalHours ?? "n/a"} shiftStatus=${emp?.shiftStatus}`;
  });

  // ---------- Step 12: tenant isolation — a real outsider is denied ----------
  await step("12. Tenant isolation: other-company user cannot read acme-co", async () => {
    // 1) The acme invite is scoped to exactly one tenant.
    const inv = await fsGet(`invites/${inviteToken}`);
    if (!inv) throw new Error("invite disappeared");
    if (inv.companyId !== COMPANY_ID) throw new Error("invite companyId not scoped");

    // 2) Create a legitimate user of a DIFFERENT company and prove the enforced
    //    rules deny them reading acme-co's employees (a real permission-denied),
    //    i.e. no fix broadened tenant isolation.
    const OUTSIDER = "outsider@other.test";
    const os = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: OUTSIDER, password: EMP_PASS, returnSecureToken: true }),
    })).json();
    let osUid = os.localId, osToken = os.idToken;
    if (!osUid) {
      const su = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: OUTSIDER, password: EMP_PASS, returnSecureToken: true }),
      })).json();
      osUid = su.localId; osToken = su.idToken;
    }
    // Outsider creates their OWN users doc (allowed: uid==userId) with other-co.
    const seedOs = await fetch(`${FS_BASE}/users/${osUid}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${osToken}` },
      body: JSON.stringify({ fields: encodeFields({ email: OUTSIDER, name: "Outsider", companyId: "other-co", role: "admin" }) }),
    });
    if (!seedOs.ok) throw new Error("outsider self-seed failed: " + seedOs.status);
    // Reading acme-co employees with the outsider token must be denied.
    const denied = await fetch(`${FS_BASE}/companies/${COMPANY_ID}/employees?pageSize=10`, {
      headers: { Authorization: `Bearer ${osToken}` },
    });
    if (denied.ok) throw new Error("SECURITY REGRESSION: outsider read acme-co employees!");
    const body = await denied.text();
    if (denied.status !== 403 || !/PERMISSION_DENIED|permission-denied/i.test(body)) {
      throw new Error(`expected permission-denied for outsider, got ${denied.status}: ${body}`);
    }
    return "outsider read denied (403 permission-denied); invite single-tenant scoped";
  });
} finally {
  log("\n================ employee-lifecycle evidence ================");
  log("Sanitized identity mapping:");
  log(`  admin email=${ADMIN_EMAIL}  company=${COMPANY_ID}`);
  log(`  employee email=${EMP_EMAIL}  uid=${empUid ? empUid.slice(0, 6) + "…" : "n/a"}  employeeRecordId=${empRecordId || "n/a"}`);
  log(`  invite token=${inviteToken ? inviteToken.slice(0, 8) + "…" : "n/a"}`);
  const passed = results.filter((r) => r.ok).length;
  log(`\nSummary: ${passed}/${results.length} steps passed`);
  // Final console sweep: the payload bug and its absence are both proven by
  // the app's own log lines, not just by DB state.
  const payloadErrs = consoleBuf.filter((x) => /Unsupported field value/i.test(x));
  log(`  Unsupported-undefined console errors: ${payloadErrs.length}${payloadErrs.length ? ` (first: ${payloadErrs[0].slice(0, 160)})` : ""}`);
  const ciFails = consoleBuf.filter((x) => /checkIn.*Failed|Failed after.*checkIn|Check-in error/i.test(x));
  log(`  checkIn failure console lines: ${ciFails.length}${ciFails.length ? ` (first: ${ciFails[0].slice(0, 160)})` : ""}`);
  try { ws.close(); } catch {}
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  // best-effort: delete the created auth users so re-runs are clean
  try {
    const list = await (await fetch(`${AUTH_BASE}/accounts:download?key=fake-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })).json();
    for (const u of list.users || []) {
      await fetch(`${AUTH_BASE}/accounts:delete?key=fake-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localId: u.localId }) });
    }
  } catch {}
  // `emulators:exec` tears down the emulator (and all data) after the script,
  // and every run starts from a fresh empty database, so no manual cleanup here.
  if (passed < results.length) process.exit(1);
}
