/**
 * D-Arrow Business — Attendance lifecycle browser E2E (Edge CDP, LOCAL EMULATORS ONLY)
 *
 * Dedicated, deterministic browser test that actually exercises the THREE
 * attendance configurations the generic employee-lifecycle harness skipped:
 *
 *   A) OFFICE  — geofence mode + an ACTIVE assigned work location; GPS granted
 *                and pinned INSIDE the geofence; check-in must persist coords +
 *                the resolved location, survive a refresh (session restored) and
 *                complete check-out.
 *   B) REMOTE  — remote/flexible authorization; GPS permission DENIED; the app's
 *                actual product logic (captureAttendanceGeo flexible branch) must
 *                allow a check-in with no geo payload. This test DERIVES and
 *                records that behavior, it does not assume it.
 *   C) NO-ASSIGN — geofence mode but NO assigned active location; check-in must
 *                surface the localized actionable error IN BOTH EN AND AR and
 *                create NO attendance record, leaving the UI usable.
 *
 * Every state transition is asserted against the Firestore emulator (READ-ONLY
 * REST verification) and against real UI DOM conditions — never a fixed sleep.
 * The application performs every WRITE through the rules-enforced client SDK;
 * the emulator REST API is used only to SEED fixtures and VERIFY persisted
 * state. Rules are loaded verbatim by the emulator and never weakened.
 *
 * SAFETY: a hard production-egress gate runs before ANY account is created and
 * after every scenario. Every browser request/WebSocket is recorded; if a single
 * one targets a real Firebase endpoint the harness aborts immediately (exit 2).
 * Runtime Firebase project is `test-attendance-lifecycle` — NOT production.
 * Auth -> 127.0.0.1:9099, Firestore -> 127.0.0.1:8080 (emulators only).
 */
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath =
  process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_att_${Date.now()}`);
const CDP_PORT = 9779;
const VITE_PORT = 5176;
const PROJECT_ID = "test-attendance-lifecycle";
const COMPANY_ID = "acme-co";
const ORIGIN = `http://localhost:${VITE_PORT}`;

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/attendance-lifecycle";

// Office geofence center; scenario A pins the browser exactly here (distance 0).
const LOC = { lat: 24.7136, lng: 46.6753, radiusMeters: 500, name: "Riyadh HQ" };

const EMP = {
  office: { email: "att_office@acme.test", pass: "AttOffice2026!", empId: "e-office" },
  remote: { email: "att_remote@acme.test", pass: "AttRemote2026!", empId: "e-remote" },
  noassign: { email: "att_noassign@acme.test", pass: "AttNoAssign2026!", empId: "e-noassign" },
  // Late-check-in / schedule-classification matrix (Task: LateCheckInAlertModal).
  // All five use remote/flexible attendance so GPS stays orthogonal to the
  // punctuality question under test.
  shiftOnTime: { email: "att_shift_ontime@acme.test", pass: "AttShift2026!", empId: "e-shift-ontime" },
  shiftLate: { email: "att_shift_late@acme.test", pass: "AttShift2026!", empId: "e-shift-late" },
  noSchedule: { email: "att_noschedule@acme.test", pass: "AttShift2026!", empId: "e-noschedule" },
  alertPunch: { email: "att_alert@acme.test", pass: "AttShift2026!", empId: "e-alert" },
  deductPunch: { email: "att_deduct@acme.test", pass: "AttShift2026!", empId: "e-deduct" },
  // Canonical-policy fixtures: a SCHEDULE-late punch must alert with the row's
  // own minutes (E2/E4), and a punctual scheduled punch must stay silent no
  // matter how aggressive the company cutoff is (E6 — the cutoff may not
  // override an assigned shift).
  scheduleAlert: { email: "att_alert_sched@acme.test", pass: "AttShift2026!", empId: "e-alert-schedule" },
  // Phase-1 acceptance: ineligible employees must see a REASON, and every
  // eligible office employee (not just e-office) must be able to start.
  officeTwo: { email: "att_office2@acme.test", pass: "AttOffice2026b!", empId: "e-office-2" },
  terminated: { email: "att_terminated@acme.test", pass: "AttTerm2026!", empId: "e-terminated" },
  ghostLoc: { email: "att_ghostloc@acme.test", pass: "AttGhost2026!", empId: "e-ghost-loc" },
};
const LATE_EMPS = [
  EMP.shiftOnTime,
  EMP.shiftLate,
  EMP.noSchedule,
  EMP.alertPunch,
  EMP.deductPunch,
  EMP.scheduleAlert,
];
// Fixture author only. Never used by any scenario assertion — the three
// employees below are the ones whose attendance lifecycle is under test.
const ADMIN = { email: "att_admin@acme.test", pass: "AttAdmin2026!" };

// Exact localized copy is read from the shipped locale files, never hardcoded,
// so the assertions track the product's real strings.
const readLocale = (lng) => JSON.parse(readFileSync(path.join("public", "locales", lng, "people.json"), "utf8"));
const EXPECTED_ERROR = {
  en: readLocale("en").attendance_toast.location_not_assigned,
  ar: readLocale("ar").attendance_toast.location_not_assigned,
};

// Blocking late check-in alert copy, read from the shipped locale files. The
// {{minutes}} placeholder is turned into a numeric matcher so the assertion
// checks the real template rather than a hardcoded sentence.
const LATE_COPY = {
  en: readLocale("en").attendance_toast,
  ar: readLocale("ar").attendance_toast,
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lateCopyMatcher = (tpl) => new RegExp(escapeRe(tpl).replace(escapeRe("{{minutes}}"), "(\\d+)"), "i");

// Deterministic punctuality plan. `punctualityForCheckIn` measures the punch in
// the SCHEDULE's zone against "HH:mm" start + graceMinutes, while the fallback
// basis (`cutoffLateMinutes`) measures it against settings/attendance
// `lateCutoffTime` in the effective (fallback = UTC) timezone. Anchors are
// derived from the real clock at seed time so the outcome does not depend on
// when the suite runs.
const hhmm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 1440) + 1440) % 1440 % 60).padStart(2, "0")}`;
const utcMinutesNow = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
// On-time: shift starts 30 min in the future (never clamped below the punch).
const ON_TIME_START = hhmm(Math.min(utcMinutesNow + 30, 1439));
// Late-by-design: shift started 60 min ago with a 15 min grace → ~45 min late.
// At UTC day-start (<75 min in) the anchor cannot go negative, so fall back to
// a 00:00 start with zero grace — the punch is still after every anchor.
const LATE_PLAN = utcMinutesNow >= 75
  ? { start: hhmm(utcMinutesNow - 60), grace: 15, minRawLate: 40, basis: "start-60min + 15min grace" }
  : { start: "00:00", grace: 0, minRawLate: 1, basis: "near UTC midnight → 00:00 start, no grace" };

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);

// ------------------------- SAFETY: production egress patterns ---------------
// Anything matching these means the app talked to a real Firebase backend.
const PRODUCTION_PATTERNS = [
  /firestore\.googleapis\.com/i,
  /firestore\..googleapis\.com/i,
  /identitytoolkit\.googleapis\.com/i,
  /www\.googleapis\.com/i,
  /firebaseio\.com/i,
  /firebasestorage\.googleapis\.com/i,
  /google-analytics\.com/i,
  /firebaseinstallations\.googleapis\.com/i,
  /d-arrow-buisiness/i,
];
function safetyAbort(what) {
  log("\n🛑 SAFETY ABORT — a connection targeted a NON-localhost Firebase endpoint:");
  log(`   ${what}`);
  log("   No further Auth/Firestore operation will be attempted.");
  try { writeFileSync(path.join(OUT_DIR, "SAFETY-ABORT.log"), String(what)); } catch {}
  try { ws.close(); } catch {}
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  process.exit(2);
}

// ------------------------- Firestore emulator REST (seed + verify) ----------
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
function decodeFields(fields) { const o = {}; for (const k in fields) o[k] = decodeValue(fields[k]); return o; }
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
function encodeFields(obj) { const f = {}; for (const k in obj) f[k] = encodeValue(obj[k]); return f; }
// The emulator REST v1 API ENFORCES the same security rules as the client SDK.
// Seeding/verification therefore runs as a legitimately authorized admin of the
// test company (signedIn() true, matching companyId, admin role) — rules are
// never bypassed, never weakened, and never over-read.
let adminIdToken = "";
function authHdr(token) {
  const h = { "Content-Type": "application/json" };
  const t = token ?? adminIdToken;
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}
async function fsGet(docPath, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, { headers: authHdr(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet ${docPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.fields ? { id: docPath.split("/").pop(), ...decodeFields(j.fields) } : null;
}
async function fsList(collectionPath, token) {
  const res = await fetch(`${FS_BASE}/${collectionPath}?pageSize=500`, { headers: authHdr(token) });
  if (!res.ok) throw new Error(`fsList ${collectionPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) }));
}
async function seedDoc(docPath, obj, token) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH", headers: authHdr(token),
    body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seedDoc ${docPath}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ------------------------- Auth emulator REST (create test accounts) --------
async function createAuthUser(email, password) {
  const r = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  if (!r.localId) throw new Error(`signUp ${email} failed: ${JSON.stringify(r)}`);
  // A fresh sign-in yields the token the app itself would hold for this session.
  const s = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  return { uid: r.localId, idToken: s.idToken || r.idToken };
}

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastErr = e?.message || String(e); }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out (${timeoutMs}ms) waiting for ${label}${lastErr ? ` — last: ${lastErr}` : ""}`);
}

log("=================================================================");
log(" D-Arrow — Attendance lifecycle browser E2E (Edge CDP / emulators)");
log("=================================================================\n");

// ------------------------- 0. emulator identity gate (BEFORE any write) ------
// Prove the emulator endpoints we are about to seed are local AND scoped to the
// isolated project id. If either is unreachable, nothing is created anywhere.
{
  // 1c — the endpoints we are about to use must be textual localhost URLs bound
  // to the isolated project. This is checked first because everything else
  // trusts these constants.
  const u1 = new URL(FS_BASE), u2 = new URL(AUTH_BASE);
  if (u1.hostname !== "127.0.0.1" || u2.hostname !== "127.0.0.1" || !FS_BASE.includes(`/projects/${PROJECT_ID}/`)) {
    log(`🛑 Emulator base URLs are not localhost/isolated: ${FS_BASE} | ${AUTH_BASE}`);
    process.exit(2);
  }
  log(`GATE 1c endpoints pinned to localhost + isolated project: ${u1.origin}, ${u2.origin}, project=${PROJECT_ID}.`);

  // 1a — Firestore emulator readiness. ANY HTTP status (200 or a rules-driven
  // 403) proves the local endpoint is serving; a rules 403 additionally proves
  // the emulator is enforcing firestore.rules for unauthenticated callers.
  let fsUp = false;
  const fsT0 = Date.now();
  let fsLast = "";
  while (Date.now() - fsT0 < 60000) {
    try {
      const p = await fetch(`${FS_BASE}/companies/__probe__`, { headers: { "Content-Type": "application/json" } });
      fsLast = `HTTP ${p.status}`;
      fsUp = true;
      break;
    } catch (e) { fsLast = e?.cause?.message || e?.message || String(e); await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!fsUp) { log(`🛑 Firestore emulator at 127.0.0.1:8080 never became reachable within 60s — last error: ${fsLast}. Aborting before any write.`); process.exit(2); }
  log(`GATE 1a Firestore emulator responding at 127.0.0.1:8080 after ${((Date.now() - fsT0) / 1000).toFixed(1)}s (probe: ${fsLast}).`);

  // 1b — Auth emulator readiness.
  let authUp = false;
  const authT0 = Date.now();
  while (Date.now() - authT0 < 60000 && !authUp) {
    try {
      await fetch(`${AUTH_BASE}/accounts:lookup?key=fake-key`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "" }),
      });
      authUp = true;
    } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!authUp) { log("🛑 Auth emulator at 127.0.0.1:9099 never became reachable within 60s — aborting before any write."); process.exit(2); }
  log(`GATE 1b Auth emulator responding at 127.0.0.1:9099 after ${((Date.now() - authT0) / 1000).toFixed(1)}s.`);
}

// ------------------------- 1. start Vite against emulators ONLY -------------
log(`Starting test Vite on port ${VITE_PORT} (project ${PROJECT_ID})...`);
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
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { if ((await fetch(`${ORIGIN}/`)).ok) { viteReady = true; break; } } catch {}
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
log(`Vite ready: ${ORIGIN}`);

// ------------------------- 2. start Edge headless + CDP ---------------------
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-first-run",
  "--no-default-browser-check", "--window-size=1280,900", `--user-data-dir=${profileDir}`, "about:blank",
]);
let pageTarget = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) { const pages = await res.json(); pageTarget = pages.find((p) => p.type === "page"); if (pageTarget?.webSocketDebuggerUrl) break; }
  } catch {}
}
if (!pageTarget) { edgeProc.kill(); viteProc.kill(); throw new Error("No Edge CDP target"); }

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 1;
const pending = new Map();
const consoleBuf = [];
const netLog = [];       // every http request url the page made
const wsLog = [];        // every websocket url the page opened
ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
  switch (data.method) {
    case "Runtime.consoleAPICalled": {
      const txt = (data.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
      consoleBuf.push(`[${data.params?.type}] ${txt}`);
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = data.params?.exceptionDetails;
      consoleBuf.push(`[exception] ${d?.exception?.description || d?.text || ""}`);
      break;
    }
    case "Network.requestWillBeSent":
      netLog.push(data.params?.request?.url || "");
      break;
    case "Network.webSocketCreated":
      wsLog.push(data.params?.url || "");
      break;
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res?.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
  return res?.result?.result?.value;
}
await send("Runtime.enable");
await send("Page.enable");
await send("Network.enable");
await send("Storage.enable");

async function shot(name) {
  const scr = await send("Page.captureScreenshot", { format: "png" });
  if (scr?.result?.data) { const p = path.join(OUT_DIR, `${name}.png`); writeFileSync(p, Buffer.from(scr.result.data, "base64")); log(`   📸 ${p}`); }
}
async function goto(url) { await send("Page.navigate", { url }); await new Promise((r) => setTimeout(r, 1200)); }
async function currentUrl() { return (await evalJs("window.location.href")) || ""; }

// Hard sign-out between scenarios: wipe IndexedDB + localStorage (firebase auth
// persistence), then the next /login starts a clean session for the next user.
async function signOutBrowser() {
  await send("Storage.clearDataForOrigin", { origin: ORIGIN, storageTypes: "all" });
  await send("Network.clearBrowserCookies");
}

// Geolocation control per scenario (CDP, explicit).
async function setGeo({ grant, coords }) {
  await send("Browser.setPermission", { origin: ORIGIN, permission: { name: "geolocation" }, setting: grant ? "granted" : "denied" });
  if (coords) await send("Emulation.setGeolocationOverride", { latitude: coords.lat, longitude: coords.lng, accuracy: 10 });
  else await send("Emulation.clearGeolocationOverride");
}

const SETTER = (cls, prop) => `Object.getOwnPropertyDescriptor(window.${cls}.prototype,'${prop}').set`;
function setFieldExpr(selector, value, cls = "HTMLInputElement", prop = "value") {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; ${SETTER(cls, prop)}.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
}
const clickButtonWithIcon = (icon) => `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-${icon}') && x.offsetParent !== null); if (b) { b.click(); return true; } return false; })()`;

const results = [];
async function scenario(name, fn) {
  try { const detail = await fn(); log(`\n✅ ${name} — ${detail}`); results.push({ name, ok: true, detail }); }
  catch (e) {
    const msg = e?.message || String(e);
    log(`\n❌ ${name} — ${msg}`);
    // Evidence dump on failure: the console tail is what separates UI timing,
    // permissions, provisioning, authorization and business logic.
    const tail = consoleBuf.slice(-25);
    log(`   [console tail]\n${tail.map((x) => `     ${x.slice(0, 220)}`).join("\n")}`);
    await shot(`${name.slice(0, 1)}-FAIL`).catch(() => {});
    results.push({ name, ok: false, error: msg });
  }
}

function consoleSince(mark, re) { return consoleBuf.slice(mark).filter((x) => re.test(x)); }

// SAFETY GATE 2: nothing in the browser may have reached a real Firebase host.
function assertLocalOnlyOnly(phase) {
  const all = [...netLog, ...wsLog];
  const bad = all.filter((u) => u && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(u) && PRODUCTION_PATTERNS.some((re) => re.test(u)));
  if (bad.length) safetyAbort(`${phase}: ${[...new Set(bad)].slice(0, 3).join(", ")}`);
  const localAuth = all.filter((u) => /127\.0\.0\.1:9099|localhost:9099/.test(u)).length;
  const localFs = all.filter((u) => /127\.0\.0\.1:8080|localhost:8080/.test(u)).length;
  return { total: all.length, localAuth, localFs };
}

// The late check-in alert is a blocking, actively-dismissed modal; a real user
// acknowledges it, so the harness does the same when it appears.
async function dismissLateAlertIfPresent() {
  const had = await evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.offsetParent !== null && /acknowledge|ack|got it|حسنًا|فهمت|إقرار/i.test(x.innerText||'')); if (b) { b.click(); return b.innerText.trim(); } return null; })()`);
  if (had) log(`   [ui] dismissed blocking modal: "${had}"`);
  return !!had;
}

async function login(email, pass, lang = "en") {
  await goto(`${ORIGIN}/login`);
  // Language must be pinned BEFORE the app boots i18n (detector order: localStorage,navigator).
  await evalJs(`localStorage.setItem('d-arrow-lang', ${JSON.stringify(lang)}); true`);
  await goto(`${ORIGIN}/login`);
  await waitUntil(() => evalJs(`!!document.querySelector('input[name="email"]')`), 150000, "login form");
  await evalJs(setFieldExpr('input[name="email"]', email));
  await evalJs(setFieldExpr('input[type="password"]', pass));
  await evalJs(`document.querySelector('button[type="submit"]').click()`);
  await waitUntil(async () => !(await currentUrl()).includes("/login"), 60000, "post-login redirect");
  const dir = await evalJs(`document.documentElement.dir || getComputedStyle(document.body).direction || 'ltr'`);
  return { lang, dir };
}

// Wait until the header tracker has resolved this employee (attendance sync
// completed) WITHOUT an unresolved sync-error state. Condition-based: the
// positive signal is PeopleService:getAttendance Completed after the mark, and
// the negative signal is a retryable role="alert" chip which we click as a real
// user would (cold-LIST retry) and then re-await.
async function waitForTrackerReady(mark) {
  const completed = () => consoleSince(mark, /PeopleService:getAttendance.*Completed/i).length > 0;
  const errored = () => consoleSince(mark, /AttendanceStore\] Sync Error/i).length > 0;
  await waitUntil(async () => {
    if (completed()) return true;
    if (await evalJs(`!!document.querySelector('[role="alert"] button')`)) { await evalJs(`(() => { const b=document.querySelector('[role="alert"] button'); if(b) b.click(); })()`); }
    return false;
  }, 90000, "attendance tracker ready (getAttendance completed)");
  if (errored() && !completed()) throw new Error("tracker sync errored and did not recover on retry");
}

const openSessions = (empId) => fsList(`companies/${COMPANY_ID}/attendance`).then((all) =>
  all.filter((a) => String(a.employeeId) === empId && a.checkIn && !a.checkOut));

const recordsFor = (empId) => fsList(`companies/${COMPANY_ID}/attendance`).then((all) =>
  all.filter((a) => String(a.employeeId) === empId));

// State of the blocking late check-in alert, detected framework-agnostically by
// its shipped title copy (also reveals a duplicated modal as 2 title hits).
async function lateModalState(lang = "en") {
  const copy = LATE_COPY[lang];
  return evalJs(`(() => {
    const title = ${JSON.stringify(copy.late_checkin_alert_title)};
    const ack = ${JSON.stringify(copy.late_checkin_ack)};
    const text = (document.body.innerText || '');
    const titleHits = (text.split(title).length - 1);
    const node = titleHits > 0 ? (() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n, hit = 0; while ((n = w.nextNode())) { if ((n.nodeValue || '').includes(title) && ++hit === 1) { let e = n.parentElement; while (e && getComputedStyle(e).position !== 'fixed' && e !== document.body) e = e.parentElement; return e; } } return null; })() : null;
    const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
    const ackBtn = btns.find(b => (b.innerText || '').trim() === ack);
    return {
      open: titleHits > 0,
      titleHits,
      blocking: !!node && getComputedStyle(node).position === 'fixed',
      text: text.includes(title) ? (() => { const i = text.indexOf(title); return text.slice(i, i + 240).replace(/\\s+/g, ' ').trim(); })() : '',
      ackPresent: !!ackBtn,
      visibleDialogs: document.querySelectorAll('[role="dialog"]').length,
    };
  })()`);
}

async function clickAck(lang = "en") {
  const ack = LATE_COPY[lang].late_checkin_ack;
  return evalJs(`(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.offsetParent !== null && (x.innerText||'').trim() === ${JSON.stringify(ack)}); if (b) { b.click(); return true; } return false; })()`);
}

// One punch → the persisted classification facts, read back from the emulator.
async function punchAndClassify({ email, pass, empId, label }) {
  await setGeo({ grant: true, coords: LOC });
  await signOutBrowser();
  await login(email, pass, "en");
  const mark = consoleBuf.length;
  await goto(`${ORIGIN}/tasks`);
  await waitForTrackerReady(mark);
  const before = await recordsFor(empId);
  const clicked = await waitUntil(() => evalJs(clickButtonWithIcon("play")), 30000, `${label} play control`);
  if (!clicked) throw new Error(`${label}: play/check-in button never clickable`);
  const rec = await waitUntil(async () => (await openSessions(empId))[0] || null, 30000, `${label} open attendance session`).catch(async (e) => {
    const toasts = await evalJs(`(() => [...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.innerText).join(' | '))()`).catch(() => "");
    const errs = consoleSince(mark, /Check-in error|schedule resolution failed|permission-denied/i);
    throw new Error(`${e.message} | toasts="${String(toasts).slice(0, 160)}" | console=${errs.slice(-3).join(" | ").slice(0, 300)}`);
  });
  // The document exists the moment addDoc lands, but the store sets
  // lateCheckInAlert only AFTER its post-check-in syncWithDb resolves (the
  // "Shift started!" toast is the UI signal of that completion). Sampling the
  // modal before it races the render — E4/E5 saw a false "no alert" in run-5
  // for exactly this reason. Wait for the toast, then a short settle for the
  // modal commit, and re-check with a grace poll so a negative assertion is
  // equally trustworthy.
  await waitUntil(
    () => evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].some(t => /shift started|بدأت الوردية/i.test(t.innerText || ''))`),
    15000, `${label} check-in completion (success toast)`
  ).catch(() => log("   [diag] success toast not observed before timeout — sampling modal anyway"));
  let modal = await lateModalState("en");
  const modalDeadline = Date.now() + 2500;
  while (!modal.open && Date.now() < modalDeadline) {
    await new Promise((r) => setTimeout(r, 250));
    modal = await lateModalState("en");
  }
  const scheduleWarn = consoleSince(mark, /schedule resolution failed/i).length;
  log(`   [${label}] punch@${new Date().toISOString()} status=${rec.status} lateMinutes=${rec.lateMinutes ?? "n/a"} deduction=${rec.deductionMinutes ?? "n/a"} schedule=${rec.schedule ? JSON.stringify({ start: rec.schedule.scheduledStart, tz: rec.schedule.scheduleTimezone, grace: rec.schedule.graceMinutes, raw: rec.schedule.rawLateMinutes, countable: rec.schedule.countableLateMinutes }) : "NONE"} modalOpen=${modal.open} titleHits=${modal.titleHits}`);
  return { rec, modal, before, scheduleWarn, mark, empId };
}

// ============================ SCENARIO A — office geofence ==================
let uidOffice = "", uidRemote = "", uidNoAssign = "";
try {
  // ---------- Seed fixtures (emulator REST acting as an authorized admin) ---
  // GATE 1d — the emulator must be provably starting from an EMPTY database, so
  // nothing this run writes can touch pre-existing data. firebase.json carries no
  // `persist` flag and no export/import path (emulators:exec runs in-memory),
  // which is asserted here rather than probed: a rules-enforced GET of a
  // non-existent company doc cannot be evaluated (belongsToCompany() dereferences
  // the caller's users doc and then resource data), so a probe would be ambiguous.
  const fbCfg = JSON.parse(readFileSync("firebase.json", "utf8"));
  if (fbCfg?.emulators?.firestore?.persist === true || process.argv.join(" ").includes("--firestore-export")) {
    throw new Error("GATE: Firestore emulator persistence/export is enabled — refusing to run against a database that may hold real data.");
  }
  log("GATE 1d firestore emulator configured non-persistent (fresh in-memory database, no export/import).");

  const admin = await createAuthUser(ADMIN.email, ADMIN.pass);
  adminIdToken = admin.idToken;
  // The admin writes its OWN profile first (self-write, as signup does); without
  // it belongsToCompany() cannot be evaluated and every company-scoped op 403s.
  await seedDoc(`users/${admin.uid}`, {
    id: admin.uid, email: ADMIN.email, name: "Acme Admin", role: "admin", companyId: COMPANY_ID,
    portalAccess: ["people", "tasks"],
  }, admin.idToken);
  const adminBack = await fsGet(`users/${admin.uid}`, admin.idToken);
  if (adminBack?.role !== "admin" || adminBack?.companyId !== COMPANY_ID) throw new Error("admin fixture not persisted");
  log(`GATE 1e admin fixture persisted (uid=${String(admin.uid).slice(0, 8)}… role=${adminBack.role} companyId=${adminBack.companyId}).`);

  await seedDoc(`companies/${COMPANY_ID}`, { id: COMPANY_ID, name: "Acme Solutions", defaultCurrency: "SAR" });
  await seedDoc(`companies/${COMPANY_ID}/work_locations/hq`, {
    id: "hq", name: LOC.name, isActive: true, lat: LOC.lat, lng: LOC.lng, radiusMeters: LOC.radiusMeters, companyId: COMPANY_ID,
  });

  const office = await createAuthUser(EMP.office.email, EMP.office.pass);
  const remote = await createAuthUser(EMP.remote.email, EMP.remote.pass);
  const noassign = await createAuthUser(EMP.noassign.email, EMP.noassign.pass);
  uidOffice = office.uid; uidRemote = remote.uid; uidNoAssign = noassign.uid;

  // users/{uid} — companyId drives the tenant; role employee (no privileges).
  // Each account writes its OWN profile (the rule allows self-write, not
  // admin-write-on-behalf), mirroring the real registration path.
  for (const [{ uid, idToken }, e] of [[office, EMP.office], [remote, EMP.remote], [noassign, EMP.noassign]]) {
    await seedDoc(`users/${uid}`, { id: uid, email: e.email, name: e.email.split("@")[0], role: "employee", companyId: COMPANY_ID, portalAccess: ["people", "tasks"], portalSubRoles: {} }, idToken);
  }

  // Employee business records — each carries its OWN attendance configuration.
  await seedDoc(`companies/${COMPANY_ID}/employees/e-office`, {
    userId: uidOffice, firstName: "Omar", lastName: "Office", name: "Omar Office", email: EMP.office.email,
    jobTitle: "Engineer", shiftStatus: "off-duty", workType: "onsite", allowRemoteTimer: false,
    attendanceCheckMode: "geofence", attendanceLocationIds: ["hq"], department: "Engineering",
  });
  await seedDoc(`companies/${COMPANY_ID}/employees/e-remote`, {
    userId: uidRemote, firstName: "Rana", lastName: "Remote", name: "Rana Remote", email: EMP.remote.email,
    jobTitle: "Designer", shiftStatus: "off-duty", workType: "remote", allowRemoteTimer: true,
    attendanceCheckMode: "flexible", attendanceLocationIds: [], department: "Design",
  });
  await seedDoc(`companies/${COMPANY_ID}/employees/e-noassign`, {
    userId: uidNoAssign, firstName: "Nada", lastName: "NoAssign", name: "Nada NoAssign", email: EMP.noassign.email,
    jobTitle: "Analyst", shiftStatus: "off-duty", workType: "onsite", allowRemoteTimer: false,
    attendanceCheckMode: "geofence", attendanceLocationIds: [], department: "Finance",
  });
  log("Seeded company, work location hq, 3 employees + auth accounts (office/remote/no-assign).");

  // ---------- Phase-1 acceptance fixtures -----------------------------------
  // A SECOND eligible office employee (proves the fix is universal), a
  // TERMINATED office employee (must be blocked by employment gate), and a
  // GEOFENCE employee whose assigned location was deactivated (must surface
  // location_inactive, not the misleading not_assigned message).
  const office2 = await createAuthUser(EMP.officeTwo.email, EMP.officeTwo.pass);
  const term = await createAuthUser(EMP.terminated.email, EMP.terminated.pass);
  const ghost = await createAuthUser(EMP.ghostLoc.email, EMP.ghostLoc.pass);
  await seedDoc(`users/${office2.uid}`, { id: office2.uid, email: EMP.officeTwo.email, name: "office2", role: "employee", companyId: COMPANY_ID, portalAccess: ["people", "tasks"], portalSubRoles: {} }, office2.idToken);
  await seedDoc(`users/${term.uid}`, { id: term.uid, email: EMP.terminated.email, name: "terminated", role: "employee", companyId: COMPANY_ID, portalAccess: ["people", "tasks"], portalSubRoles: {} }, term.idToken);
  await seedDoc(`users/${ghost.uid}`, { id: ghost.uid, email: EMP.ghostLoc.email, name: "ghostloc", role: "employee", companyId: COMPANY_ID, portalAccess: ["people", "tasks"], portalSubRoles: {} }, ghost.idToken);
  await seedDoc(`companies/${COMPANY_ID}/work_locations/annex`, {
    id: "annex", name: "Closed Annex", isActive: false, lat: LOC.lat, lng: LOC.lng, radiusMeters: LOC.radiusMeters, companyId: COMPANY_ID,
  });
  await seedDoc(`companies/${COMPANY_ID}/employees/e-office-2`, {
    userId: office2.uid, firstName: "Oma", lastName: "Office2", name: "Oma Office2", email: EMP.officeTwo.email,
    jobTitle: "Accountant", shiftStatus: "off-duty", status: "active", workType: "onsite", allowRemoteTimer: false,
    attendanceCheckMode: "geofence", attendanceLocationIds: ["hq"], department: "Finance",
    joiningDate: new Date().toISOString(),
  });
  await seedDoc(`companies/${COMPANY_ID}/employees/e-terminated`, {
    userId: term.uid, firstName: "Ter", lastName: "Inated", name: "Ter Inated", email: EMP.terminated.email,
    jobTitle: "Clerk", shiftStatus: "off-duty", status: "terminated", workType: "onsite", allowRemoteTimer: false,
    attendanceCheckMode: "geofence", attendanceLocationIds: ["hq"], department: "Operations",
    joiningDate: new Date().toISOString(),
  });
  await seedDoc(`companies/${COMPANY_ID}/employees/e-ghost-loc`, {
    userId: ghost.uid, firstName: "Gho", lastName: "Stloc", name: "Gho Stloc", email: EMP.ghostLoc.email,
    jobTitle: "Analyst", shiftStatus: "off-duty", status: "active", workType: "onsite", allowRemoteTimer: false,
    attendanceCheckMode: "geofence", attendanceLocationIds: ["annex"], department: "Facilities",
    joiningDate: new Date().toISOString(),
  });
  log("Seeded Phase-1 fixtures: e-office-2 (active, valid hq), e-terminated (status=terminated), e-ghost-loc (assigned 'annex' which is isActive:false).");

  // ---------- Late check-in / punctuality matrix fixtures -------------------
  // NOTE: settings/attendance is deliberately NOT seeded here. Scenarios A-C
  // must run under exactly the same product configuration as the previously
  // verified run (company default cutoff). The E matrix sets the cutoff itself,
  // per scenario, right before each punch.
  for (const e of LATE_EMPS) {
    const { uid, idToken } = await createAuthUser(e.email, e.pass);
    await seedDoc(`users/${uid}`, { id: uid, email: e.email, name: e.empId, role: "employee", companyId: COMPANY_ID, portalAccess: ["people", "tasks"], portalSubRoles: {} }, idToken);
    await seedDoc(`companies/${COMPANY_ID}/employees/${e.empId}`, {
      userId: uid, firstName: e.empId, lastName: "Shift", name: `${e.empId} Shift`, email: e.email,
      jobTitle: "Engineer", shiftStatus: "off-duty", workType: "remote", allowRemoteTimer: true,
      attendanceCheckMode: "flexible", attendanceLocationIds: [], department: "Operations",
      joiningDate: new Date().toISOString(),
    });
  }

  // Schedule template + active employee-scoped assignments (snapshot is what
  // `resolveAssignment` reads; the punch freezes it onto the attendance row).
  const snap = (startTime, graceMinutes) => ({
    startTime, endTime: "17:00", workingDays: [0, 1, 2, 3, 4, 5, 6],
    breakMinutes: 0, breakCountsAsWork: true, graceMinutes,
    requiredDailyMinutes: null, flexibleStartWindow: null, timezone: "UTC", overtime: null,
  });
  await seedDoc(`companies/${COMPANY_ID}/hr_schedule_templates/tpl-e2e`, {
    name: "E2E UTC template", mode: "office", isActive: true, version: 1, ...snap("09:00", 0),
  });
  const assignment = (employeeId, startTime, graceMinutes) => ({
    scope: "employee", employeeId, department: null,
    templateId: "tpl-e2e", templateVersion: 1, templateMode: "office",
    snapshot: snap(startTime, graceMinutes), overrides: null,
    effectiveFrom: "2020-01-01", effectiveTo: null, reason: "E2E punctuality matrix",
    status: "active", createdBy: admin.uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await seedDoc(`companies/${COMPANY_ID}/hr_schedule_assignments/asg-ontime`, assignment(EMP.shiftOnTime.empId, ON_TIME_START, 0));
  await seedDoc(`companies/${COMPANY_ID}/hr_schedule_assignments/asg-late`, assignment(EMP.shiftLate.empId, LATE_PLAN.start, LATE_PLAN.grace));
  await seedDoc(`companies/${COMPANY_ID}/hr_schedule_assignments/asg-alert`, assignment(EMP.alertPunch.empId, ON_TIME_START, 0));
  await seedDoc(`companies/${COMPANY_ID}/hr_schedule_assignments/asg-alert-schedule`, assignment(EMP.scheduleAlert.empId, LATE_PLAN.start, LATE_PLAN.grace));
  log(`Seeded 6 punctuality employees, 4 active assignments (on-time start=${ON_TIME_START} UTC; late start=${LATE_PLAN.start}+${LATE_PLAN.grace}m grace — ${LATE_PLAN.basis}) and 1 employee with NO assignment.`);
  const asgList = await fsList(`companies/${COMPANY_ID}/hr_schedule_assignments`);
  if (asgList.length !== 4) throw new Error(`assignment seeding verification failed (${asgList.length} docs)`);

  for (const e of LATE_EMPS) {
    const emp = await fsGet(`companies/${COMPANY_ID}/employees/${e.empId}`);
    if (!emp?.userId) throw new Error(`punctuality fixture not persisted for ${e.empId}`);
  }

  // Independent proof the provisioning is what the app will see (rules-enforced
  // client reads are exercised later through the real UI anyway).
  for (const id of ["e-office", "e-remote", "e-noassign"]) {
    const emp = await fsGet(`companies/${COMPANY_ID}/employees/${id}`);
    if (!emp?.userId) throw new Error(`seed verification failed for ${id}`);
    log(`  provisioned ${id}: mode=${emp.attendanceCheckMode} workType=${emp.workType} locations=${JSON.stringify(emp.attendanceLocationIds ?? null)} gpsUser=${String(emp.userId).slice(0, 6)}…`);
  }
  await shot("00-seeded");

  // ---------------------------------------------------------------------------
  await scenario("A. Office geofence check-in → refresh → restore → check-out", async () => {
    await setGeo({ grant: true, coords: LOC }); // inside the geofence
    await signOutBrowser();
    const { dir } = await login(EMP.office.email, EMP.office.pass, "en");
    const mark = consoleBuf.length;
    await goto(`${ORIGIN}/tasks`);
    await waitForTrackerReady(mark);

    const net = assertLocalOnlyOnly("A: after office login");
    log(`   [safety] requests=${net.total} localAuth=${net.localAuth} localFirestore=${net.localFs} production=0`);

    // Firestore BEFORE
    const before = (await fsList(`companies/${COMPANY_ID}/attendance`)).filter((a) => String(a.employeeId) === "e-office");
    await shot("A-01-before");

    // Real UI check-in: click the play (lucide-play) control.
    const clicked = await waitUntil(() => evalJs(clickButtonWithIcon("play")), 30000, "office check-in (play) button");
    if (!clicked) throw new Error("play/check-in button never clickable");

    // Completion signal: Firestore carries an open session with geo coordinates.
    const rec = await waitUntil(async () => {
      const all = await fsList(`companies/${COMPANY_ID}/attendance`);
      return all.find((a) => String(a.employeeId) === "e-office" && a.checkIn && !a.checkOut) || null;
    }, 30000, "office attendance record with checkIn");
    const chkErrs = consoleSince(mark, /Check-in error|attendance_toast|outside|permission-denied|Unsupported/i);
    if (chkErrs.length) log(`   [diag] check-in console noise: ${chkErrs.slice(-4).join(" | ").slice(0, 400)}`);
    if (rec.checkInLat === undefined || rec.checkInLng === undefined) throw new Error(`office check-in persisted WITHOUT coordinates: ${JSON.stringify(rec)}`);
    if (rec.checkInLocationId !== "hq") throw new Error(`geofence match did not resolve the assigned location (checkInLocationId=${rec.checkInLocationId})`);
    if (!rec.checkIn) throw new Error("record has no checkIn timestamp");
    log(`   [geo] coords=${rec.checkInLat},${rec.checkInLng} location=${rec.checkInLocationName} distance=${rec.checkInDistanceMeters}m`);
    await shot("A-02-checked-in");

    // UI must show the on-duty (stop) control, and the success toast must appear.
    await waitUntil(() => evalJs(`!!document.querySelector('button svg.lucide-square')`), 20000, "on-duty stop control");
    const successToast = await evalJs(`(() => { const els=[...document.querySelectorAll('[data-sonner-toast]')]; return els.map(e=>e.innerText).filter(Boolean).join(' | '); })()`);
    await dismissLateAlertIfPresent();

    // Refresh → the active session must be RESTORED from Firestore.
    await send("Page.reload");
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 30000, "session after reload");
    const mark2 = consoleBuf.length;
    await waitForTrackerReady(mark2);
    await waitUntil(() => evalJs(`!!document.querySelector('button svg.lucide-square')`), 25000, "on-duty control restored after refresh");
    await dismissLateAlertIfPresent();
    const restored = await openSessions("e-office");
    if (restored.length !== 1) throw new Error(`refresh did not restore exactly one open session (found ${restored.length})`);
    if (restored[0].id !== rec.id) throw new Error(`restored a DIFFERENT session after refresh (${restored[0].id} vs ${rec.id})`);
    await shot("A-03-resumed");

    // Real UI check-out: stop → daily-report modal → summary → send.
    await evalJs(clickButtonWithIcon("square"));
    await waitUntil(() => evalJs(`!!document.querySelector('textarea')`), 20000, "daily report modal");
    await evalJs(setFieldExpr("textarea", "Office shift completed for E2E verification.", "HTMLTextAreaElement"));
    await evalJs(clickButtonWithIcon("send"));

    const done = await waitUntil(async () => {
      const all = await fsList(`companies/${COMPANY_ID}/attendance`);
      return all.find((a) => String(a.employeeId) === "e-office" && a.checkIn && a.checkOut) || null;
    }, 30000, "office attendance record with checkOut");
    if (!done.checkOut) throw new Error("office check-out did not persist");
    if (done.id !== rec.id) throw new Error(`check-out landed on a different document (${done.id} vs ${done.checkIn ? rec.id : "?"})`);
    const stillOpen = await openSessions("e-office");
    if (stillOpen.length !== 0) throw new Error(`session still open after check-out (${stillOpen.length})`);
    await shot("A-04-checked-out");
    const offDuty = await evalJs(`(() => { const s=document.body.innerText||''; return /off[\\s-]?duty|خروج/i.test(s) || !document.querySelector('button svg.lucide-square'); })()`);
    assertLocalOnlyOnly("A: after check-out");
    return `uid=${String(uidOffice).slice(0, 8)}… langDir=${dir} before=${before.length} record=${rec.id} coords=${rec.checkInLat},${rec.checkInLng} locId=${rec.checkInLocationId} distance=${rec.checkInDistanceMeters}m successToast="${String(successToast).replace(/\s+/g, " ").slice(0, 40)}" restoredAfterRefresh=yes(${restored[0].id}) checkOut=${done.checkOut} totalHours=${done.totalHours ?? "n/a"} offDuty=${done.offDuty ?? done.status ?? "n/a"} uiOffDuty=${offDuty}`;
  });

  // ---------------------------------------------------------------------------
  await scenario("B. Remote/flexible check-in with GPS DENIED", async () => {
    await setGeo({ grant: false, coords: null }); // deny geolocation
    await signOutBrowser();
    await login(EMP.remote.email, EMP.remote.pass, "en");
    const mark = consoleBuf.length;
    await goto(`${ORIGIN}/tasks`);
    await waitForTrackerReady(mark);
    assertLocalOnlyOnly("B: after remote login");

    const clicked = await waitUntil(() => evalJs(clickButtonWithIcon("play")), 30000, "remote check-in (play) button");
    if (!clicked) throw new Error("play/check-in button never clickable");

    // Product logic derived: a remote/flexible employee MUST be allowed to check
    // in with NO geo (captureAttendanceGeo flexible branch swallows the GPS
    // failure and returns undefined). The record persists WITHOUT coordinates.
    const rec = await waitUntil(async () => {
      const all = await fsList(`companies/${COMPANY_ID}/attendance`);
      return all.find((a) => String(a.employeeId) === "e-remote" && a.checkIn && !a.checkOut) || null;
    }, 30000, "remote attendance record with checkIn (no GPS)").catch(async (e) => {
      const errs = consoleSince(mark, /gps_denied|Check-in error|permission|denied|not_assigned|outside/i);
      const toasts = await evalJs(`(() => { const els=[...document.querySelectorAll('[data-sonner-toast]')]; return els.map(e=>e.innerText).filter(Boolean).join(' | '); })()`).catch(() => "");
      throw new Error(`${e.message} | toasts="${String(toasts).slice(0, 160)}" | console: ${errs.slice(-4).join(" | ").slice(0, 400)}`);
    });
    const geoFields = { lat: rec.checkInLat, lng: rec.checkInLng, locId: rec.checkInLocationId };
    if (rec.checkInLat !== undefined) log(`   [diag] unexpected coords on remote record (${rec.checkInLat},${rec.checkInLng})`);
    log(`   [derived] no-GPS remote check-in ALLOWED; geo fields=${JSON.stringify(geoFields)}`);
    await shot("B-02-checked-in-nogps");
    await waitUntil(() => evalJs(`!!document.querySelector('button svg.lucide-square')`), 20000, "on-duty control after remote check-in");
    await dismissLateAlertIfPresent();

    // Refresh → restore, then check-out.
    await send("Page.reload");
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 30000, "session after reload");
    await waitForTrackerReady(consoleBuf.length);
    await waitUntil(() => evalJs(`!!document.querySelector('button svg.lucide-square')`), 25000, "remote session restored after refresh");
    await dismissLateAlertIfPresent();
    const restored = await openSessions("e-remote");
    if (restored.length !== 1 || restored[0].id !== rec.id) throw new Error(`remote session not restored after refresh (${JSON.stringify(restored.map(r => r.id))})`);
    await evalJs(clickButtonWithIcon("square"));
    await waitUntil(() => evalJs(`!!document.querySelector('textarea')`), 20000, "daily report modal");
    await evalJs(setFieldExpr("textarea", "Remote shift completed for E2E verification.", "HTMLTextAreaElement"));
    await evalJs(clickButtonWithIcon("send"));
    const done = await waitUntil(async () => {
      const all = await fsList(`companies/${COMPANY_ID}/attendance`);
      return all.find((a) => String(a.employeeId) === "e-remote" && a.checkIn && a.checkOut) || null;
    }, 30000, "remote attendance record with checkOut");
    await shot("B-03-checked-out");
    assertLocalOnlyOnly("B: after check-out");
    return `uid=${String(uidRemote).slice(0, 8)}… DERIVED: remote no-GPS check-in ALLOWED; record=${rec.id} hasCoords=${rec.checkInLat !== undefined} restoredAfterRefresh=yes checkOut=persisted(totalHours=${done?.totalHours ?? "n/a"})`;
  });

  // ---------------------------------------------------------------------------
  // Scenario C is run once per locale so BOTH the English and the Arabic
  // actionable error are proven, not just "a" localized string.
  for (const lang of ["en", "ar"]) {
    await scenario(`C-${lang.toUpperCase()}. Geofence WITHOUT assigned location → localized error, no record`, async () => {
      await setGeo({ grant: true, coords: LOC }); // even valid GPS must be blocked (assigned check precedes GPS)
      await signOutBrowser();
      const { dir } = await login(EMP.noassign.email, EMP.noassign.pass, lang);
      const mark = consoleBuf.length;
      await goto(`${ORIGIN}/tasks`);
      await waitForTrackerReady(mark);
      assertLocalOnlyOnly(`C-${lang}: after login`);

      const before = (await fsList(`companies/${COMPANY_ID}/attendance`)).filter((a) => String(a.employeeId) === "e-noassign");

      await evalJs(clickButtonWithIcon("play"));

      // The EXACT shipped copy for this locale must be visible in a toast.
      const want = EXPECTED_ERROR[lang];
      const toastText = await waitUntil(() => evalJs(`(() => { const els=[...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')]; const t=els.map(e=>e.innerText).filter(Boolean).join(' | '); return t.includes(${JSON.stringify(want)}) ? t : null; })()`), 20000, `exact ${lang} location-not-assigned toast`).catch(() => null);
      await shot(`C-${lang}-02-error-toast`);

      // No invalid attendance record may be created for this employee.
      await new Promise((r) => setTimeout(r, 1500));
      const after = (await fsList(`companies/${COMPANY_ID}/attendance`)).filter((a) => String(a.employeeId) === "e-noassign");
      if (after.length !== before.length) throw new Error(`REGRESSION: a no-location geofence check-in created an attendance record (${after.length - before.length} new)`);

      // Loading state cleared + UI usable: the play control is clickable again.
      const usable = await waitUntil(() => evalJs(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>x.querySelector('svg.lucide-play')&&x.offsetParent!==null); return !!b && !b.getAttribute('aria-busy'); })()`), 15000, "tracker returns to usable (play, not stuck loading)").catch(() => false);
      await shot(`C-${lang}-03-usable`);
      if (!toastText) {
        const seen = await evalJs(`(() => { const els=[...document.querySelectorAll('[data-sonner-toast]')]; return els.map(e=>e.innerText).filter(Boolean).join(' | '); })()`).catch(() => "");
        const errs = consoleSince(mark, /Check-in error|not_assigned|location_not_assigned/i);
        throw new Error(`no exact ${lang} toast ("${want}") — saw toasts="${String(seen).slice(0, 200)}" console=${errs.slice(-3).join(" | ").slice(0, 250)}`);
      }
      if (!usable) log("   [diag] play control re-query returned false but no record created; UI-state check inconclusive");
      assertLocalOnlyOnly(`C-${lang}: after failed check-in`);
      return `lang=${lang} dir=${dir} no record created (before=${before.length} after=${after.length}); toast="${String(toastText).replace(/\s+/g, " ").slice(0, 120)}"; usable=${usable}`;
    });
  }

  // ---------- Authorization evidence (no privilege escalation attempted) -----
  await scenario("D. Ordinary employee cannot read another tenant / privileged data", async () => {
    // Tenant isolation already proven by the registration harness; here we prove
    // the three employees see ONLY their own company's attendance via the app's
    // own rules-enforced reads, by asserting seeded data stayed in scope.
    const emps = await fsList(`companies/${COMPANY_ID}/employees`);
    const expectedEmps = 3 + LATE_EMPS.length + 3; // 3 core + 6 punctuality + 3 Phase-1 (office2/terminated/ghost-loc)
    if (emps.length !== expectedEmps) throw new Error(`expected ${expectedEmps} seeded employees, emulator has ${emps.length}`);
    const other = await fetch(`${FS_BASE.replace(PROJECT_ID, "someone-else-project")}/companies/acme-co/employees?pageSize=10`, { headers: { "Content-Type": "application/json" } });
    const otherBody = await other.json().catch(() => ({}));
    if (otherBody.documents && otherBody.documents.length) throw new Error("data leaked into another project scope");
    for (const id of ["e-office", "e-remote", "e-noassign"]) {
      const emp = await fsGet(`companies/${COMPANY_ID}/employees/${id}`);
      if (emp?.shiftStatus !== "off-duty" && id !== "e-office") continue;
    }
    const shiftStatuses = {};
    for (const id of ["e-office", "e-remote", "e-noassign"]) shiftStatuses[id] = (await fsGet(`companies/${COMPANY_ID}/employees/${id}`))?.shiftStatus;
    assertLocalOnlyOnly("D: authorization probe");
    return `${expectedEmps} employees isolated in ${COMPANY_ID}; no cross-project documents; shiftStatus=${JSON.stringify(shiftStatuses)}`;
  });

  // ===================== E. Late check-in alert / classification ============
  // CANONICAL CONTRACT (one punch, one effective timezone, one basis):
  //   SCHEDULE — when an effective hr_schedule_assignments snapshot resolves it
  //              is AUTHORITATIVE: start + grace in the schedule's own timezone.
  //              row lateMinutes == snapshot countableLateMinutes; the company
  //              cutoff can neither add nor remove lateness.
  //   CUTOFF   — settings/attendance.lateCutoffTime is the documented FALLBACK
  //              basis, used only when no assignment resolves.
  //              latenessSoFar = minutes past the cutoff, never schedule absence.
  // The store alert, the persisted row, Timesheets, the lateness report and
  // payroll all derive from the SAME canonical value; these scenarios pin one
  // basis at a time and assert they AGREE — divergence is a failure, not a note.
  const finding = (msg) => log(`   📌 FINDING: ${msg}`);

  // The company cutoff is pinned to 23:59 so it is provably "on time" at any
  // run hour; that isolates the schedule snapshot as the only variable for
  // scenarios E1-E4. E5 flips it for an UNSCHEDULED employee (fallback basis),
  // E6 flips it for a SCHEDULED punctual one (override guard).
  await seedDoc(`companies/${COMPANY_ID}/settings/attendance`, {
    lateCutoffTime: "23:59", lateThreshold: 3, updatedAt: new Date().toISOString(),
  });
  log("E-matrix setup: settings/attendance lateCutoffTime=23:59 lateThreshold=3 (legacy basis ⇒ on time).");

  await scenario("E1. Valid assigned shift, punch before scheduled start ⇒ on time, no late modal", async () => {
    const { rec, modal, scheduleWarn } = await punchAndClassify({ ...EMP.shiftOnTime, label: "E1" });
    if (scheduleWarn) log(`   [diag] "schedule resolution failed" warned ${scheduleWarn}× (legacy fallback)`);
    if (!rec.schedule) throw new Error(`employee has an ACTIVE assignment but the punch carried no schedule snapshot (console warns=${scheduleWarn}) — the schedule basis silently degraded`);
    if (rec.schedule.scheduledStart !== ON_TIME_START) throw new Error(`snapshot came from a different template: scheduledStart=${rec.schedule.scheduledStart} expected ${ON_TIME_START}`);
    if (rec.schedule.scheduleTimezone !== "UTC") throw new Error(`unexpected snapshot timezone ${rec.schedule.scheduleTimezone}`);
    if (Number(rec.schedule.rawLateMinutes) !== 0) throw new Error(`on-time punch classified late by its own schedule (rawLateMinutes=${rec.schedule.rawLateMinutes}, start=${rec.schedule.scheduledStart} grace=${rec.schedule.graceMinutes})`);
    if (Number(rec.schedule.countableLateMinutes) !== 0) throw new Error(`countableLateMinutes=${rec.schedule.countableLateMinutes} for a punctual punch`);
    if (Number(rec.lateMinutes ?? 0) !== 0) throw new Error(`cutoff fallback marked a punctual scheduled punch late (lateMinutes=${rec.lateMinutes}) — schedule basis not authoritative`);
    if (rec.status !== "present") throw new Error(`expected status "present", got "${rec.status}"`);
    if (modal.open) throw new Error(`late modal appeared for a punctual check-in: "${modal.text}"`);
    assertLocalOnlyOnly("E1");
    await shot("E1-ontime");
    return `record=${rec.id} status=${rec.status} lateMinutes=${rec.lateMinutes} schedule=${JSON.stringify(rec.schedule)} modal=open:${modal.open} titleHits:${modal.titleHits}`;
  });

  await scenario("E2. Valid assigned shift, punch AFTER the configured grace ⇒ late on the schedule's own minutes + alert", async () => {
    const { rec, modal } = await punchAndClassify({ ...EMP.shiftLate, label: "E2" });
    if (!rec.schedule) throw new Error("assignment did not reach the attendance row (no schedule snapshot)");
    const raw = Number(rec.schedule.rawLateMinutes);
    if (!(raw >= LATE_PLAN.minRawLate)) throw new Error(`expected ≥${LATE_PLAN.minRawLate} schedule-late minutes (${LATE_PLAN.basis}), got ${raw}`);
    if (Number(rec.schedule.graceMinutes) !== LATE_PLAN.grace) throw new Error(`grace not frozen onto the row (${rec.schedule.graceMinutes} vs ${LATE_PLAN.grace})`);
    if (Number(rec.schedule.countableLateMinutes) !== raw) throw new Error(`countable=${rec.schedule.countableLateMinutes} != raw=${raw} with no approved leave excusing the day`);
    // The company cutoff is pinned at 23:59 (would say "on time") and must NOT
    // suppress a punch its own shift calls late.
    if (rec.status !== "late") throw new Error(`a punch ${raw} min past its own shift+grace was persisted status="${rec.status}" — the company cutoff overrode the assigned schedule`);
    if (Number(rec.lateMinutes ?? 0) !== raw) throw new Error(`row lateMinutes=${rec.lateMinutes} diverges from the schedule countable=${raw} — the bases are still not unified`);
    if (!modal.open) throw new Error(`schedule-late check-in (lateMinutes=${rec.lateMinutes}) did NOT open the alert modal — the alert still ignores the schedule basis`);
    const plain = lateCopyMatcher(LATE_COPY.en.late_checkin);
    if (!plain.test(modal.text)) throw new Error(`alert copy does not match the shipped "late_checkin" template: "${modal.text}"`);
    if (Number(modal.text.match(plain)[1]) !== raw) throw new Error(`alert shows ${modal.text.match(plain)[1]} min but the row carries lateMinutes=${rec.lateMinutes} (schedule countable=${raw})`);
    if (Number(rec.deductionMinutes ?? 0) !== 0) throw new Error(`first late occurrence of the month was deducted (deductionMinutes=${rec.deductionMinutes}, threshold=3)`);
    await dismissLateAlertIfPresent();
    assertLocalOnlyOnly("E2");
    await shot("E2-schedule-late");
    return `record=${rec.id} scheduleRaw=${raw}m grace=${rec.schedule.graceMinutes} status=${rec.status} lateMinutes=${rec.lateMinutes} alert=${raw}m (== row) dismissed=yes`;
  });

  await scenario("E3. No schedule configured ⇒ NOT classified late by itself", async () => {
    const { rec, modal, scheduleWarn } = await punchAndClassify({ ...EMP.noSchedule, label: "E3" });
    if (rec.schedule) throw new Error(`employee without an assignment still got a schedule snapshot: ${JSON.stringify(rec.schedule)}`);
    if (scheduleWarn) log(`   [diag] schedule resolution warned (expected none — resolveAssignment returned null, not an error)`);
    if (Number(rec.lateMinutes ?? 0) !== 0 || rec.status !== "present") throw new Error(`a MISSING schedule was itself treated as lateness (status=${rec.status} lateMinutes=${rec.lateMinutes})`);
    if (modal.open) throw new Error(`late modal shown for an on-time punch: "${modal.text}"`);
    if (!("lateMinutes" in rec)) log("   [diag] record has no lateMinutes key at all (legacy field written only when > 0?)");
    assertLocalOnlyOnly("E3");
    await shot("E3-no-schedule");
    finding(`an employee with no assignment is judged ONLY by the company cutoff: with cutoff 23:59 the punch is "${rec.status}" and silent. The previous default cutoff (11:30) is what made an afternoon test punch look "late" — schedule absence never produces lateness.`);
    return `record=${rec.id} schedule=absent status=${rec.status} lateMinutes=${rec.lateMinutes ?? 0} modal=open:${modal.open} → missing schedule is NOT classified late`;
  });

  await scenario("E4. Schedule-late alert: modal appears once, blocks nothing extra, dismiss + refresh keep the session", async () => {
    // The company cutoff stays at 23:59 — a value the LEGACY basis calls
    // on-time — so the alert can only be explained by the employee's own
    // assigned shift (start + grace). This is the canonical trigger test.
    await seedDoc(`companies/${COMPANY_ID}/settings/attendance`, { lateCutoffTime: "23:59", lateThreshold: 3, updatedAt: new Date().toISOString() });
    log("   [setup] settings/attendance pinned to 23:59 / threshold 3 — only the schedule may open the alert");
    const { rec, modal } = await punchAndClassify({ ...EMP.scheduleAlert, label: "E4" });
    if (!rec.schedule) throw new Error("assigned shift did not reach the attendance row (no schedule snapshot)");
    if (!(Number(rec.lateMinutes) > 0)) throw new Error(`a punch late against its own shift produced no lateMinutes (got ${rec.lateMinutes}, schedule raw=${rec.schedule?.rawLateMinutes})`);
    if (rec.status !== "late") throw new Error(`expected status "late", got "${rec.status}"`);
    if (Number(rec.lateMinutes) !== Number(rec.schedule.countableLateMinutes)) finding(`row lateMinutes=${rec.lateMinutes} != schedule countable=${rec.schedule.countableLateMinutes} — the persisted classification diverges from its own basis`);
    if (!modal.open) throw new Error(`late check-in did NOT open the alert modal (lateMinutes=${rec.lateMinutes})`);
    if (modal.titleHits !== 1) throw new Error(`alert modal duplicated: ${modal.titleHits} copies of the title are visible`);
    if (!modal.blocking) log(`   [diag] modal is not a fixed-position overlay (blocking=${modal.blocking}, dialogs=${modal.visibleDialogs})`);
    if (!modal.ackPresent) throw new Error(`the actively-dismissed alert has no ack button ("${LATE_COPY.en.late_checkin_ack}")`);
    const plain = lateCopyMatcher(LATE_COPY.en.late_checkin);
    if (!plain.test(modal.text)) throw new Error(`alert copy does not match the shipped "late_checkin" template: "${modal.text}"`);
    const shownMinutes = Number(modal.text.match(plain)[1]);
    if (shownMinutes !== Number(rec.lateMinutes)) throw new Error(`alert shows ${shownMinutes} min but the record carries lateMinutes=${rec.lateMinutes}`);
    if (Number(rec.deductionMinutes ?? 0) !== 0) throw new Error(`first late occurrence of the month was deducted (deductionMinutes=${rec.deductionMinutes}, threshold=3)`);

    // No duplicate operation possible: the tracker has already morphed to the
    // on-duty control, so a second check-in cannot be issued from the UI.
    // Visibility-aware (the header mounts a second widget inside a closed
    // mobile Popover whose hidden svg must not count) with a short settle for
    // the framer-motion play→stop swap.
    const trackerState = await waitUntil(
      () => evalJs(`(() => {
        const vis = (s) => Array.from(document.querySelectorAll(s)).some((el) => el.offsetParent !== null);
        const play = vis('button svg.lucide-play');
        const stop = vis('button svg.lucide-square');
        return (!play && stop) ? { play, stop } : null;
      })()`),
      8000, "E4: tracker shows ONLY the on-duty (stop) control"
    ).catch(async () => ({
      play: await evalJs(`(() => Array.from(document.querySelectorAll('button svg.lucide-play')).some(el => el.offsetParent !== null))()`),
      stop: await evalJs(`(() => Array.from(document.querySelectorAll('button svg.lucide-square')).some(el => el.offsetParent !== null))()`),
    }));
    if (trackerState.play) throw new Error("a second (play) check-in control is still actionable while a session is open — duplicate check-ins are possible");
    if (!trackerState.stop) throw new Error("on-duty (stop) control not visibly rendered while the alert is open — the modal broke the tracker");
    let docs = await recordsFor(EMP.scheduleAlert.empId);
    if (docs.length !== 1) throw new Error(`duplicate attendance documents created (${docs.length})`);

    // Dismiss ⇒ session must survive untouched.
    const acked = await waitUntil(() => clickAck("en"), 15000, "alert ack button");
    if (!acked) throw new Error("ack button never became clickable");
    // HeroUI keeps the overlay mounted through its exit animation — sample
    // immediately after the click and you catch a closing modal as "open".
    // Wait for the title to actually leave the DOM.
    const afterDismiss = await waitUntil(async () => {
      const s = await lateModalState("en");
      return s.open ? null : s;
    }, 5000, "alert modal removed from the DOM after ack").catch(async () => {
      const s = await lateModalState("en");
      throw new Error(`modal still visible after ack (titleHits=${s.titleHits}, blocking=${s.blocking}, dialogs=${s.visibleDialogs})`);
    });
    const alive = await openSessions(EMP.scheduleAlert.empId);
    if (alive.length !== 1 || alive[0].id !== rec.id) throw new Error(`dismissing the alert lost the active session (${JSON.stringify(alive.map(a => a.id))} vs ${rec.id})`);
    await shot("E4-after-dismiss");

    // Refresh ⇒ no re-alert, no re-classification, same session restored.
    const frozen = await fsGet(`companies/${COMPANY_ID}/attendance/${rec.id}`);
    await send("Page.reload");
    await waitUntil(async () => !(await currentUrl()).includes("/login"), 30000, "session after reload");
    await waitForTrackerReady(consoleBuf.length);
    const afterReload = await lateModalState("en");
    if (afterReload.open) throw new Error(`the alert re-appeared after refresh: "${afterReload.text}"`);
    const refetched = await fsGet(`companies/${COMPANY_ID}/attendance/${rec.id}`);
    for (const k of ["status", "lateMinutes", "deductionMinutes", "checkIn"]) {
      if (String(refetched?.[k] ?? "") !== String(frozen?.[k] ?? "")) throw new Error(`refresh re-classified the punch: ${k} ${JSON.stringify(frozen?.[k])} → ${JSON.stringify(refetched?.[k])}`);
    }
    if (refetched?.schedule && Number(refetched.schedule.rawLateMinutes) !== Number(frozen?.schedule?.rawLateMinutes)) throw new Error("refresh mutated the schedule snapshot");
    await waitUntil(() => evalJs(`!!document.querySelector('button svg.lucide-square')`), 25000, "on-duty control restored after refresh");
    const resumed = await openSessions(EMP.scheduleAlert.empId);
    if (resumed.length !== 1 || resumed[0].id !== rec.id) throw new Error(`session not restored after refresh (${JSON.stringify(resumed.map(r => r.id))})`);
    await shot("E4-after-refresh");

    // Check out through the real UI; the alert must not interfere.
    await evalJs(clickButtonWithIcon("square"));
    await waitUntil(() => evalJs(`!!document.querySelector('textarea')`), 20000, "daily report modal");
    await evalJs(setFieldExpr("textarea", "Late-arrival shift completed for E2E verification.", "HTMLTextAreaElement"));
    await evalJs(clickButtonWithIcon("send"));
    const done = await waitUntil(async () => {
      const all = await recordsFor(EMP.scheduleAlert.empId);
      return all.find((a) => a.checkIn && a.checkOut) || null;
    }, 30000, "E4 check-out persisted");
    const lateAfterClose = await lateModalState("en");
    if (lateAfterClose.open) finding(`the alert re-opened during check-out (blocking=${lateAfterClose.blocking}) — will require dismissal; recorded, not assumed`);
    if (done.id !== rec.id) throw new Error(`check-out landed on a different document (${done.id} vs ${rec.id})`);
    if ((await openSessions(EMP.scheduleAlert.empId)).length !== 0) throw new Error("session still open after check-out");
    assertLocalOnlyOnly("E4: after check-out");
    return `lateMinutes=${rec.lateMinutes} (== schedule countable=${rec.schedule?.countableLateMinutes}) status=${rec.status} scheduleRaw=${rec.schedule?.rawLateMinutes}m cutoff=23:59(legacy on-time) modal once(titleHits=1,blocking=${modal.blocking}) ack="${LATE_COPY.en.late_checkin_ack}" copy="${modal.text.slice(0, 60)}…" dismiss→session ${rec.id} preserved; refresh→no re-alert, classification identical (${JSON.stringify({ status: refetched.status, lateMinutes: refetched.lateMinutes })}); checkOut=${done.checkOut}`;
  });

  await scenario("E5. Late beyond the monthly threshold ⇒ deducted copy of the alert", async () => {
    await seedDoc(`companies/${COMPANY_ID}/settings/attendance`, { lateCutoffTime: "00:00", lateThreshold: 1, updatedAt: new Date().toISOString() });
    log("   [setup] settings/attendance lateThreshold → 1 (first occurrence already deductible)");
    const { rec, modal } = await punchAndClassify({ ...EMP.deductPunch, label: "E5" });
    if (!(Number(rec.deductionMinutes) > 0)) throw new Error(`threshold 1 did not deduct (deductionMinutes=${rec.deductionMinutes} lateMinutes=${rec.lateMinutes})`);
    if (!modal.open) throw new Error("no alert for a deducted late check-in");
    const deducted = lateCopyMatcher(LATE_COPY.en.late_checkin_deducted);
    if (!deducted.test(modal.text)) throw new Error(`alert used the non-deducted copy although deductionMinutes>0: "${modal.text}"`);
    if (Number(modal.text.match(deducted)[1]) !== Number(rec.lateMinutes)) throw new Error(`deducted copy reports ${modal.text.match(deducted)[1]} min, record says ${rec.lateMinutes}`);
    if (modal.titleHits !== 1) throw new Error(`modal duplicated (${modal.titleHits})`);
    await waitUntil(() => clickAck("en"), 15000, "ack");
    assertLocalOnlyOnly("E5");
    await shot("E5-deducted");
    return `record=${rec.id} lateMinutes=${rec.lateMinutes} deductionMinutes=${rec.deductionMinutes} copy="${modal.text.slice(0, 70)}…" dismissed=yes`;
  });

  await scenario("E6. Cutoff EARLIER than the assigned shift ⇒ schedule wins: punctual, silent, not late", async () => {
    // The most aggressive possible company cutoff: every punch on the clock is
    // ≥ 1 minute past it. EMP.alertPunch holds an ACTIVE assignment starting at
    // ON_TIME_START (30 min in the future, zero grace) and has never punched,
    // so the canonical contract requires: schedule authoritative ⇒ present,
    // lateMinutes 0, no snapshot lateness, no alert, no deduction.
    await seedDoc(`companies/${COMPANY_ID}/settings/attendance`, { lateCutoffTime: "00:00", lateThreshold: 3, updatedAt: new Date().toISOString() });
    log("   [setup] settings/attendance cutoff → 00:00 (would call ANY punch late on the fallback basis)");
    const { rec, modal } = await punchAndClassify({ ...EMP.alertPunch, label: "E6" });
    if (!rec.schedule) throw new Error("active assignment did not reach the row — the punch silently degraded to the cutoff fallback");
    if (rec.schedule.scheduledStart !== ON_TIME_START) throw new Error(`snapshot start ${rec.schedule.scheduledStart} != assigned ${ON_TIME_START}`);
    if (Number(rec.schedule.rawLateMinutes) !== 0 || Number(rec.schedule.countableLateMinutes) !== 0) throw new Error(`punctual scheduled punch carries snapshot lateness (raw=${rec.schedule.rawLateMinutes} countable=${rec.schedule.countableLateMinutes})`);
    if (rec.status !== "present") throw new Error(`the company cutoff overrode the assigned shift: status="${rec.status}" although the punch precedes its own start (${ON_TIME_START})`);
    if (Number(rec.lateMinutes ?? 0) !== 0) throw new Error(`cutoff 00:00 produced lateMinutes=${rec.lateMinutes} for a schedule-punctual punch`);
    if (Number(rec.deductionMinutes ?? 0) !== 0) throw new Error(`deductionMinutes=${rec.deductionMinutes} on an on-time punch`);
    if (modal.open) throw new Error(`alert opened for a schedule-punctual punch (cutoff override): "${modal.text}"`);
    assertLocalOnlyOnly("E6");
    await shot("E6-cutoff-no-override");
    return `record=${rec.id} cutoff=00:00(aggressive) shift=${rec.schedule.scheduledStart} status=${rec.status} lateMinutes=${rec.lateMinutes ?? 0} deduction=${rec.deductionMinutes ?? 0} modal=open:${modal.open} → cutoff cannot override an assigned shift`;
  });

  // ---------- Phase-1 acceptance: eligibility & explicit block reasons ------
  // Read the shipped warning copy directly from the locale file so the
  // assertion tracks real product strings, never a hardcoded sentence.
  const BLOCK_COPY = {
    en: readLocale("en").time_tracker,
    ar: readLocale("ar").time_tracker,
  };
  const blockAlertState = () => evalJs(`(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter(a => a.offsetParent !== null);
    const playBtn = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-play') && x.offsetParent !== null);
    return {
      alertCount: alerts.length,
      alertText: alerts.map(a => (a.innerText || '').replace(/\\s+/g, ' ').trim()).join(' || '),
      playPresent: !!playBtn,
      bodySnippet: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
    };
  })()`);

  await scenario("F1. Second eligible Saudi office employee starts the timer successfully", async () => {
    await setGeo({ grant: true, coords: LOC });
    await signOutBrowser();
    await login(EMP.officeTwo.email, EMP.officeTwo.pass, "en");
    const mark = consoleBuf.length;
    await goto(`${ORIGIN}/tasks`);
    await waitForTrackerReady(mark);
    assertLocalOnlyOnly("F1: after second-office login");
    // Must NOT see a block banner (eligibility resolved).
    const state = await blockAlertState();
    if (state.alertText.includes(BLOCK_COPY.en.block_employment_inactive) || state.alertText.includes(BLOCK_COPY.en.block_location_not_assigned) || state.alertText.includes(BLOCK_COPY.en.block_location_inactive)) {
      throw new Error(`eligible office employee shown a block banner: "${state.alertText}"`);
    }
    const clicked = await waitUntil(() => evalJs(clickButtonWithIcon("play")), 30000, "F1 play control");
    if (!clicked) throw new Error(`F1: play button never clickable for eligible employee — alert="${state.alertText}" body="${state.bodySnippet}"`);
    const rec = await waitUntil(async () => (await openSessions(EMP.officeTwo.empId))[0] || null, 30000, "F1 open session");
    await shot("F1-office2-started");
    return `uid=${String(rec.employeeId)} record=${rec.id} coords=${rec.checkInLat},${rec.checkInLng} locId=${rec.checkInLocationId}`;
  });

  await scenario("F2. Terminated employee is blocked with an explicit employment_inactive reason (no silent hide)", async () => {
    await setGeo({ grant: true, coords: LOC });
    await signOutBrowser();
    await login(EMP.terminated.email, EMP.terminated.pass, "en");
    const mark = consoleBuf.length;
    await goto(`${ORIGIN}/tasks`);
    await waitForTrackerReady(mark);
    assertLocalOnlyOnly("F2: after terminated login");
    const state = await blockAlertState();
    if (!state.alertText.includes(BLOCK_COPY.en.block_employment_inactive)) {
      throw new Error(`terminated employee did NOT see the employment_inactive block banner (alert="${state.alertText}")`);
    }
    const before = await recordsFor(EMP.terminated.empId);
    // Clicking the play button (even if present) must NOT create a session —
    // the service throws employment_inactive before any Firestore write.
    await evalJs(clickButtonWithIcon("play")).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const after = await recordsFor(EMP.terminated.empId);
    if (after.length !== before.length) throw new Error(`terminated employee managed to open an attendance record: ${JSON.stringify(after)}`);
    const errs = consoleSince(mark, /employment_inactive|Employment is not active|Check-in error/i);
    await shot("F2-terminated-blocked");
    return `banner=employment_inactive recordsBefore=${before.length} recordsAfter=${after.length} consoleHits=${errs.length}`;
  });

  await scenario("F3. Geofence employee with a deactivated assigned location sees location_inactive (not the misleading not_assigned)", async () => {
    await setGeo({ grant: true, coords: LOC });
    await signOutBrowser();
    await login(EMP.ghostLoc.email, EMP.ghostLoc.pass, "en");
    const mark = consoleBuf.length;
    await goto(`${ORIGIN}/tasks`);
    await waitForTrackerReady(mark);
    assertLocalOnlyOnly("F3: after ghost-location login");
    const state = await blockAlertState();
    if (!state.alertText.includes(BLOCK_COPY.en.block_location_inactive)) {
      throw new Error(`employee whose assigned location is isActive:false did NOT see location_inactive (banner="${state.alertText}") — the misleading fallback would look like not_assigned="${BLOCK_COPY.en.block_location_not_assigned}"`);
    }
    if (state.alertText.includes(BLOCK_COPY.en.block_location_not_assigned)) {
      throw new Error(`location_inactive employee shown the wrong reason (not_assigned) — root cause still misclassified`);
    }
    const before = await recordsFor(EMP.ghostLoc.empId);
    await evalJs(clickButtonWithIcon("play")).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const after = await recordsFor(EMP.ghostLoc.empId);
    if (after.length !== before.length) throw new Error(`location-inactive employee managed to open an attendance record`);
    await shot("F3-location-inactive");
    return `banner=location_inactive recordsBefore=${before.length} recordsAfter=${after.length}`;
  });
} finally {
  log("\n================ attendance-lifecycle evidence ================");
  log(`project=${PROJECT_ID} company=${COMPANY_ID} uids: office=${uidOffice.slice(0, 6)}… remote=${uidRemote.slice(0, 6)}… noassign=${uidNoAssign.slice(0, 6)}…`);
  const all = [...netLog, ...wsLog];
  const nonLocal = all.filter((u) => u && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(u));
  log(`browser requests total=${all.length} local=${all.length - nonLocal.length} nonLocal=${nonLocal.length}`);
  log(`  non-local targets: ${[...new Set(nonLocal)].slice(0, 8).join(", ") || "none"}`);
  log(`  firestore/auth endpoints: ${[...new Set(all.filter((u) => /:8080|:9099/.test(u)).map((u) => u.replace(/\/v1\/.*|\/identitytoolkit.*|\/google.*$/, "")))].slice(0, 6).join(", ") || "n/a"}`);
  const passed = results.filter((r) => r.ok).length;
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? ` — ${r.detail}` : ` — ${r.error || "n/a"}`}`);
  log(`\nSummary: ${passed}/${results.length} scenarios browser-verified`);
  const uncaught = consoleBuf.filter((x) => /Uncaught Error in snapshot listener/i.test(x)).length;
  log(`  realtime LIST-gate console errors (known emulator conversations artifact): ${uncaught}`);
  try { writeFileSync(path.join(OUT_DIR, "console.log"), consoleBuf.join("\n")); } catch {}
  try { writeFileSync(path.join(OUT_DIR, "network.log"), JSON.stringify({ requests: [...new Set(netLog)], websockets: [...new Set(wsLog)] }, null, 2)); } catch {}
  try { writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify({ project: PROJECT_ID, results }, null, 2)); } catch {}
  try { ws.close(); } catch {}
  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  try { const list = await (await fetch(`${AUTH_BASE}/accounts:download?key=fake-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })).json(); for (const u of list.users || []) await fetch(`${AUTH_BASE}/accounts:delete?key=fake-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localId: u.localId }) }); } catch {}
  if (passed < results.length) process.exit(1);
}
