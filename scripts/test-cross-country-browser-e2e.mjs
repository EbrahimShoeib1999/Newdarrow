/**
 * D-Arrow Business — Multi-Country Workforce & Shift Start Browser E2E
 *
 * Exercises Microsoft Edge headless via Chrome DevTools Protocol against the
 * local Firebase Auth + Firestore emulators:
 *
 * 1. Single Company / Multi-Country: Egypt Manager with people.view_all_reports
 *    logs in and sees BOTH Saudi Office and Egypt Remote employees on /people.
 * 2. Office Shift Start: Saudi Office employee with Geofence disabled starts
 *    shift, verifies timer persistence across page refresh, and checks out.
 * 3. Mandatory GPS Protection: Strict GPS employee pinned outside geofence is
 *    blocked with an actionable error and creates no active attendance record.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath =
  process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_cross_${Date.now()}`);
const CDP_PORT = 9781;
const VITE_PORT = 5178;
const PROJECT_ID = "cross-country-browser-e2e";
const COMPANY_ID = "co-darrow-global";
const ORIGIN = `http://localhost:${VITE_PORT}`;

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/cross-country-e2e";

const HQ_LOC = { lat: 24.7136, lng: 46.6753, radiusMeters: 500, name: "Riyadh HQ" };

const USERS = {
  admin: { email: "admin@global.test", pass: "GlobalAdmin2026!", name: "Global Admin" },
  egyptMgr: { email: "khulodahmed390@gmail.com", pass: "KhulodMgr2026!", name: "Khulod Ahmed", empId: "e-egypt-mgr" },
  restrictedMgr: { email: "restricted_mgr@global.test", pass: "RestrictedMgr2026!", name: "Hassan Cairo Manager", empId: "e-restricted-mgr" },
  saudiOffice: { email: "norahn892@gmail.com", pass: "NorahOffice2026!", name: "Norah Al-Otaibi", empId: "e-saudi-office" },
  albraa: { email: "albrahymasra39@gmail.com", pass: "AlbraaOffice2026!", name: "Albraa Al-Masra", empId: "e-albraa" },
  zainab: { email: "Zainabodaili@gmail.com", pass: "ZainabRemote2026!", name: "Zainab Odaili", empId: "e-zainab" },
  mohamed: { email: "mm7811238@gmail.com", pass: "MohamedFreelance2026!", name: "Mohamed Mansour", empId: "e-mohamed" },
  egyptRemote: { email: "egypt_emp@global.test", pass: "EgyptRemote2026!", name: "Nour El-Masri", empId: "e-egypt-remote" },
  strictGps: { email: "strict_gps@global.test", pass: "StrictGps2026!", name: "Fahad Strict GPS", empId: "e-strict-gps" },
};

try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch {}

const log = (...a) => console.log(...a);

let adminIdToken = "";
function authHdr(token = adminIdToken) {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
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
async function seedDoc(docPath, obj, token = adminIdToken) {
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: "PATCH",
    headers: authHdr(token),
    body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  if (!res.ok) throw new Error(`seed PATCH ${docPath} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function fsList(collectionPath, token = adminIdToken) {
  const res = await fetch(`${FS_BASE}/${collectionPath}?pageSize=500`, { headers: authHdr(token) });
  if (!res.ok) throw new Error(`fsList ${collectionPath}: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.documents || []).map((d) => ({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) }));
}

async function createAuthUser(email, password) {
  const r = await (await fetch(`${AUTH_BASE}/accounts:signUp?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  if (!r.localId) throw new Error(`signUp ${email} failed: ${JSON.stringify(r)}`);
  const s = await (await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=fake-key`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json();
  return { uid: r.localId, idToken: s.idToken || r.idToken };
}

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

log("=================================================================");
log(" D-Arrow — Multi-Country Workforce & Shift Start Browser E2E");
log("=================================================================\n");

// 1. Verify emulators reachable
let fsUp = false;
const fsT0 = Date.now();
while (Date.now() - fsT0 < 30000) {
  try {
    const p = await fetch(`${FS_BASE}/companies/__probe__`);
    if (p.status) { fsUp = true; break; }
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!fsUp) throw new Error("Firestore emulator not reachable at 127.0.0.1:8080");

let authUp = false;
const authT0 = Date.now();
while (Date.now() - authT0 < 30000) {
  try {
    const a = await fetch(`${AUTH_BASE}/accounts:lookup?key=fake-key`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "" }),
    });
    if (a.status) { authUp = true; break; }
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!authUp) throw new Error("Auth emulator not reachable at 127.0.0.1:9099");
log("GATE: Local Firestore (8080) and Auth (9099) emulators responding.");

// 2. Start Vite
log(`Starting test Vite on port ${VITE_PORT}...`);
const viteProc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"], {
  env: {
    ...process.env,
    E2E_NO_HMR: "1",
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
const viteLogs = [];
viteProc.stdout.on("data", (d) => { const s = d.toString(); if (/error|warn|fail/i.test(s)) viteLogs.push(s); });
viteProc.stderr.on("data", (d) => { viteLogs.push(d.toString()); });
let viteReady = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { if ((await fetch(`${ORIGIN}/`)).ok) { viteReady = true; break; } } catch {}
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
log(`Vite ready: ${ORIGIN}`);

// 3. Start Edge Headless + CDP
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
const edgeProc = spawn(edgePath, [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-first-run",
  "--no-default-browser-check", "--disable-sync", "--window-size=1280,900", `--user-data-dir=${profileDir}`, "about:blank",
]);
let pageTarget = null;
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      pageTarget = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl && !p.url.startsWith("edge://") && !p.url.startsWith("chrome://"));
      if (pageTarget) break;
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
  }
  if (data.method === "Runtime.exceptionThrown") {
    const ex = data.params?.exceptionDetails;
    consoleBuf.push(`[UNCAUGHT] ${ex?.text || ""} ${ex?.exception?.description || ""}`);
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
  if (scr?.result?.data) {
    const p = path.join(OUT_DIR, `${name}.png`);
    writeFileSync(p, Buffer.from(scr.result.data, "base64"));
    log(`   📸 ${p}`);
  }
}
async function currentUrl() {
  return (await evalJs("window.location.href")) || "";
}
async function goto(url) {
  const cur = await currentUrl();
  if (cur === url) return;
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 2000));
}
async function signOutBrowser() {
  await evalJs(`(async () => {
    try {
      if (window.__darrowAuth) {
        await window.__darrowAuth.signOut();
      }
    } catch {}
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 500));
}
async function setGeo({ grant, coords }) {
  await send("Browser.setPermission", { origin: ORIGIN, permission: { name: "geolocation" }, setting: grant ? "granted" : "denied" });
  if (grant && coords) {
    await send("Emulation.setGeolocationOverride", { latitude: coords.lat, longitude: coords.lng, accuracy: 15 });
  } else {
    await send("Emulation.clearGeolocationOverride");
  }
}

const setFieldExpr = (sel, val, cls = 'HTMLInputElement') =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.focus(); Object.getOwnPropertyDescriptor(window[${JSON.stringify(cls)}].prototype,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`;

const clickButtonWithIcon = (icon) =>
  `(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.querySelector('svg.lucide-${icon}') && x.offsetParent !== null); if (b) { b.click(); return true; } return false; })()`;

async function dismissLateAlertIfPresent() {
  await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const ack = btns.find(x => x.offsetParent !== null && /acknowledge|ack|got it|فهمت|موافق|تأكيد/i.test(x.innerText || ''));
    if (ack) ack.click();
  })()`);
}

async function browserLogin(email, password) {
  await goto(`${ORIGIN}/login`);
  try {
    await waitUntil(() => evalJs(`!!document.querySelector('input[name="email"]') || !!document.querySelector('input[type="email"]')`), 150000, "login email input");
  } catch (err) {
    const url = await currentUrl();
    const body = await evalJs("document.body.innerText || document.documentElement.innerHTML").catch(() => "(eval failed)");
    log(`[login diag] currentUrl=${url}`);
    log(`[login diag] body=${body.slice(0, 500)}`);
    log(`[login diag] consoleBuf=\n${consoleBuf.slice(-10).join("\n")}`);
    await shot("diag-login-failed");
    throw err;
  }
  await evalJs(setFieldExpr('input[name="email"]', email));
  await evalJs(setFieldExpr('input[type="password"]', password));
  await evalJs(`document.querySelector('button[type="submit"]').click()`);
  await waitUntil(async () => !((await evalJs("window.location.href")) || "").includes("/login"), 30000, "redirect away from login");
}

let passed = 0;
let failed = 0;

try {
  // --------------------------------------------------------------------------
  // Seed fixtures in Firestore Emulator
  // --------------------------------------------------------------------------
  log("\n--- Seeding Test Fixtures in Emulator ---");

  const adminAuth = await createAuthUser(USERS.admin.email, USERS.admin.pass);
  adminIdToken = adminAuth.idToken;

  await seedDoc(`users/${adminAuth.uid}`, {
    id: adminAuth.uid, email: USERS.admin.email, name: USERS.admin.name, role: "admin", companyId: COMPANY_ID,
    portalAccess: ["people", "tasks", "analytics"],
  }, adminAuth.idToken);

  await seedDoc(`companies/${COMPANY_ID}`, {
    id: COMPANY_ID, name: "D-Arrow Global Corp", defaultCurrency: "SAR", timezone: "Asia/Riyadh",
  });

  await seedDoc(`companies/${COMPANY_ID}/work_locations/loc-riyadh-hq`, {
    id: "loc-riyadh-hq", name: HQ_LOC.name, isActive: true, lat: HQ_LOC.lat, lng: HQ_LOC.lng, radiusMeters: HQ_LOC.radiusMeters, companyId: COMPANY_ID,
  });

  // Egypt Manager: self-creates as employee first, then admin elevates to manager with custom permissions
  const mgrAuth = await createAuthUser(USERS.egyptMgr.email, USERS.egyptMgr.pass);
  await seedDoc(`users/${mgrAuth.uid}`, {
    id: mgrAuth.uid, email: USERS.egyptMgr.email, name: USERS.egyptMgr.name, role: "employee", companyId: COMPANY_ID,
    portalAccess: ["people", "tasks"], portalSubRoles: {},
  }, mgrAuth.idToken);

  // Admin update with permissions
  await seedDoc(`users/${mgrAuth.uid}`, {
    id: mgrAuth.uid, email: USERS.egyptMgr.email, name: USERS.egyptMgr.name, role: "manager", companyId: COMPANY_ID,
    country: "Egypt", branchId: "branch-cairo",
    portalAccess: ["people", "tasks"], portalSubRoles: {},
    customPermissions: ["people.view_all_reports", "people.manage_all"],
  }, adminIdToken);

  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.egyptMgr.empId}`, {
    id: USERS.egyptMgr.empId, userId: mgrAuth.uid, name: USERS.egyptMgr.name, email: USERS.egyptMgr.email,
    companyId: COMPANY_ID, country: "Egypt", branchId: "branch-cairo", workMode: "remote", role: "manager",
    department: "Management", status: "active",
  }, adminIdToken);

  // Restricted Egypt Branch Manager (branch-cairo only, NO view_all_reports)
  const restMgrAuth = await createAuthUser(USERS.restrictedMgr.email, USERS.restrictedMgr.pass);
  await seedDoc(`users/${restMgrAuth.uid}`, {
    id: restMgrAuth.uid, email: USERS.restrictedMgr.email, name: USERS.restrictedMgr.name, role: "employee", companyId: COMPANY_ID,
    portalAccess: ["people", "tasks"], portalSubRoles: {},
  }, restMgrAuth.idToken);

  await seedDoc(`users/${restMgrAuth.uid}`, {
    id: restMgrAuth.uid, email: USERS.restrictedMgr.email, name: USERS.restrictedMgr.name, role: "manager", companyId: COMPANY_ID,
    country: "Egypt", branchId: "branch-cairo",
    portalAccess: ["people", "tasks"], portalSubRoles: { people: "employee" },
    customPermissions: [], // No people.view_all_reports
  }, adminIdToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.restrictedMgr.empId}`, {
    id: USERS.restrictedMgr.empId, userId: restMgrAuth.uid, name: USERS.restrictedMgr.name, email: USERS.restrictedMgr.email,
    companyId: COMPANY_ID, country: "Egypt", branchId: "branch-cairo", workMode: "remote", role: "manager",
    department: "Management", status: "active",
  }, adminIdToken);

  // Saudi Office Employee: norahn892@gmail.com (geofence disabled, non-mandatory GPS)
  const saudiAuth = await createAuthUser(USERS.saudiOffice.email, USERS.saudiOffice.pass);
  await seedDoc(`users/${saudiAuth.uid}`, {
    id: saudiAuth.uid, email: USERS.saudiOffice.email, name: USERS.saudiOffice.name, role: "employee", companyId: COMPANY_ID,
    country: "Saudi Arabia", branchId: "branch-riyadh",
    portalAccess: ["people", "tasks"],
  }, saudiAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.saudiOffice.empId}`, {
    id: USERS.saudiOffice.empId, userId: saudiAuth.uid, name: USERS.saudiOffice.name, email: USERS.saudiOffice.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", workLocationId: "loc-riyadh-hq",
    officeLocation: "Riyadh HQ", workMode: "office", workType: "onsite", role: "employee",
    department: "Operations", status: "active",
    attendanceLocationIds: ["loc-riyadh-hq"],
    geofenceEnabled: false,
    requireGps: false,
  });

  // Saudi Office Employee: albrahymasra39@gmail.com
  const albraaAuth = await createAuthUser(USERS.albraa.email, USERS.albraa.pass);
  await seedDoc(`users/${albraaAuth.uid}`, {
    id: albraaAuth.uid, email: USERS.albraa.email, name: USERS.albraa.name, role: "employee", companyId: COMPANY_ID,
    country: "Saudi Arabia", branchId: "branch-riyadh",
    portalAccess: ["people", "tasks"],
  }, albraaAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.albraa.empId}`, {
    id: USERS.albraa.empId, userId: albraaAuth.uid, name: USERS.albraa.name, email: USERS.albraa.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", workLocationId: "loc-riyadh-hq",
    officeLocation: "Riyadh HQ", workMode: "office", workType: "onsite", role: "employee",
    department: "Engineering", status: "active",
    attendanceLocationIds: ["loc-riyadh-hq"],
    geofenceEnabled: false,
    requireGps: false,
  });

  // Saudi Remote Employee: Zainabodaili@gmail.com
  const zainabAuth = await createAuthUser(USERS.zainab.email, USERS.zainab.pass);
  await seedDoc(`users/${zainabAuth.uid}`, {
    id: zainabAuth.uid, email: USERS.zainab.email, name: USERS.zainab.name, role: "employee", companyId: COMPANY_ID,
    country: "Saudi Arabia", branchId: "branch-riyadh",
    portalAccess: ["people", "tasks"],
  }, zainabAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.zainab.empId}`, {
    id: USERS.zainab.empId, userId: zainabAuth.uid, name: USERS.zainab.name, email: USERS.zainab.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", workLocationId: "loc-remote",
    officeLocation: "Remote KSA", workMode: "remote", workType: "remote", role: "employee",
    department: "Finance", status: "active",
    geofenceEnabled: false,
    requireGps: false,
  });

  // Saudi Freelancer Employee: mm7811238@gmail.com
  const mohamedAuth = await createAuthUser(USERS.mohamed.email, USERS.mohamed.pass);
  await seedDoc(`users/${mohamedAuth.uid}`, {
    id: mohamedAuth.uid, email: USERS.mohamed.email, name: USERS.mohamed.name, role: "employee", companyId: COMPANY_ID,
    country: "Saudi Arabia", branchId: "branch-jeddah",
    portalAccess: ["people", "tasks"],
  }, mohamedAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.mohamed.empId}`, {
    id: USERS.mohamed.empId, userId: mohamedAuth.uid, name: USERS.mohamed.name, email: USERS.mohamed.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-jeddah", workLocationId: "loc-jeddah",
    officeLocation: "Jeddah Branch", workMode: "freelancer", workType: "freelance", attendanceCheckMode: "flexible",
    role: "employee", department: "Design", status: "active",
    geofenceEnabled: false,
    requireGps: false,
  });

  // Egypt Remote Employee
  const egyptAuth = await createAuthUser(USERS.egyptRemote.email, USERS.egyptRemote.pass);
  await seedDoc(`users/${egyptAuth.uid}`, {
    id: egyptAuth.uid, email: USERS.egyptRemote.email, name: USERS.egyptRemote.name, role: "employee", companyId: COMPANY_ID,
    country: "Egypt", branchId: "branch-cairo",
    portalAccess: ["people", "tasks"],
  }, egyptAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.egyptRemote.empId}`, {
    id: USERS.egyptRemote.empId, userId: egyptAuth.uid, name: USERS.egyptRemote.name, email: USERS.egyptRemote.email,
    companyId: COMPANY_ID, country: "Egypt", branchId: "branch-cairo", workLocationId: "loc-cairo",
    officeLocation: "Remote Egypt", workMode: "remote", workType: "remote", role: "employee",
    department: "Marketing", status: "active",
  });

  // Strict GPS Employee (mandatory GPS + geofence)
  const strictAuth = await createAuthUser(USERS.strictGps.email, USERS.strictGps.pass);
  await seedDoc(`users/${strictAuth.uid}`, {
    id: strictAuth.uid, email: USERS.strictGps.email, name: USERS.strictGps.name, role: "employee", companyId: COMPANY_ID,
    country: "Saudi Arabia", branchId: "branch-riyadh",
    portalAccess: ["people", "tasks"],
  }, strictAuth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${USERS.strictGps.empId}`, {
    id: USERS.strictGps.empId, userId: strictAuth.uid, name: USERS.strictGps.name, email: USERS.strictGps.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", workLocationId: "loc-riyadh-hq",
    officeLocation: "Riyadh HQ", workMode: "office", workType: "onsite", role: "employee",
    department: "Operations", status: "active",
    attendanceLocationIds: ["loc-riyadh-hq"],
    geofenceEnabled: true,
    requireGps: true, // Mandatory GPS!
  });

  log("Seeded company, locations, and 5 users (admin, egyptMgr, saudiOffice, egyptRemote, strictGps).");

  // --------------------------------------------------------------------------
  // Scenario 1: Egypt Manager sees Saudi Office & Egypt Remote employees
  // --------------------------------------------------------------------------
  log("\n--- Scenario 1: Egypt Manager Cross-Branch Visibility ---");
  await browserLogin(USERS.egyptMgr.email, USERS.egyptMgr.pass);
  await goto(`${ORIGIN}/people`);

  // Wait for the employee table/grid to load
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Norah Al-Otaibi") && document.body.innerText.includes("Nour El-Masri")`),
    30000,
    "both Saudi Office and Egypt Remote employees visible on /people"
  );

  const pageText = await evalJs("document.body.innerText");
  const hasNorah = pageText.includes("Norah Al-Otaibi");
  const hasAlbraa = pageText.includes("Albraa Al-Masra");
  const hasZainab = pageText.includes("Zainab Odaili");
  const hasMohamed = pageText.includes("Mohamed Mansour");
  const hasNour = pageText.includes("Nour El-Masri");
  const hasSaudiCountry = pageText.includes("Saudi Arabia");
  const hasEgyptCountry = pageText.includes("Egypt");

  if (hasNorah && hasAlbraa && hasZainab && hasMohamed && hasNour && hasSaudiCountry && hasEgyptCountry) {
    passed++;
    log("  PASS: Scenario 1 - Khulod sees all Saudi employees (Norah, Albraa, Zainab, Mohamed) and Egypt Remote employees");
    await shot("01-egypt-mgr-cross-country-visibility");
  } else {
    failed++;
    log(`  FAIL: Scenario 1 - Visibility check failed (norah=${hasNorah}, albraa=${hasAlbraa}, zainab=${hasZainab}, mohamed=${hasMohamed}, nour=${hasNour})`);
  }

  // --------------------------------------------------------------------------
  // Scenario 1b: Restricted Branch Manager Visibility Scope
  // --------------------------------------------------------------------------
  log("\n--- Scenario 1b: Egypt Restricted Manager Visibility Scope ---");
  await signOutBrowser();
  await browserLogin(USERS.restrictedMgr.email, USERS.restrictedMgr.pass);
  await goto(`${ORIGIN}/people`);
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Nour El-Masri")`),
    30000,
    "Cairo remote employee visible to branch manager"
  );
  const restPageText = await evalJs("document.body.innerText");
  const restHasCairo = restPageText.includes("Nour El-Masri");
  const restHasSaudi = restPageText.includes("Norah Al-Otaibi") || restPageText.includes("Albraa Al-Masra") || restPageText.includes("Zainab Odaili");
  if (restHasCairo && !restHasSaudi) {
    passed++;
    log("  PASS: Scenario 1b - Restricted Manager sees only branch-cairo and CANNOT see Saudi employees");
    await shot("01b-restricted-mgr-branch-scope");
  } else {
    failed++;
    log(`  FAIL: Scenario 1b - Restricted manager scope violation (hasCairo=${restHasCairo}, hasSaudi=${restHasSaudi})`);
  }

  // --------------------------------------------------------------------------
  // Scenario 2: Saudi Office Employee starts shift with Geofence disabled
  // --------------------------------------------------------------------------
  log("\n--- Scenario 2: Saudi Office Employee Shift Lifecycle (Geofence Disabled) ---");
  await signOutBrowser();
  // Geolocation DENIED — proves office employee can start without active geofence/GPS
  await setGeo({ grant: false, coords: null });
  await browserLogin(USERS.saudiOffice.email, USERS.saudiOffice.pass);
  await goto(`${ORIGIN}/tasks`);

  // Wait for the app layout to mount
  await waitUntil(
    () => evalJs("!!document.querySelector('header') || !!document.querySelector('#root > *')"),
    60000,
    "app layout mounted"
  );

  // Find and click the Start Shift play button
  const startBtn = await waitUntil(
    () => evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(btn => btn.querySelector('svg.lucide-play') && btn.offsetParent !== null);
      if (b) { b.click(); return true; }
      return false;
    })()`),
    60000,
    "start shift play button clicked"
  );

  // Wait for shift to become active (stop/pause button visible or toast)
  await waitUntil(
    () => evalJs(`(() => {
      const hasStop = Array.from(document.querySelectorAll('button')).some(btn => btn.querySelector('svg.lucide-square') && btn.offsetParent !== null);
      const hasToast = document.body.innerText.includes("Shift started") || document.body.innerText.includes("بدء");
      return hasStop || hasToast;
    })()`),
    30000,
    "shift started successfully"
  );
  await shot("02-saudi-office-shift-active");

  // Check Firestore emulator for the active attendance record
  const recordsAfterStart = await fsList(`companies/${COMPANY_ID}/attendance`);
  const saudiRecord = recordsAfterStart.find((r) => r.employeeId === USERS.saudiOffice.empId && r.checkIn && !r.checkOut);
  if (saudiRecord) {
    passed++;
    log(`  PASS: Scenario 2a - Shift started without GPS; record=${saudiRecord.id} loc=${saudiRecord.checkInLocationName || saudiRecord.location}`);
  } else {
    failed++;
    log("  FAIL: Scenario 2a - No active attendance record found in Firestore emulator");
  }

  // Break and Resume micro-actions:
  log("   Testing Take Break micro-action...");
  await dismissLateAlertIfPresent();
  await evalJs(clickButtonWithIcon("coffee"));
  await new Promise((r) => setTimeout(r, 1000));
  const onBreakEmployee = await waitUntil(async () => {
    const emps = await fsList(`companies/${COMPANY_ID}/employees`);
    return emps.find((e) => e.id === USERS.saudiOffice.empId && e.shiftStatus === "on-break") || null;
  }, 15000, "employee shiftStatus on-break");
  passed++;
  log(`  PASS: Scenario 2b - Break started; shiftStatus=${onBreakEmployee.shiftStatus}`);
  await shot("02b-saudi-office-on-break");

  log("   Testing Resume Work micro-action...");
  await dismissLateAlertIfPresent();
  await evalJs(clickButtonWithIcon("coffee"));
  await new Promise((r) => setTimeout(r, 1000));
  const resumedEmployee = await waitUntil(async () => {
    const emps = await fsList(`companies/${COMPANY_ID}/employees`);
    return emps.find((e) => e.id === USERS.saudiOffice.empId && (e.shiftStatus === "working" || e.shiftStatus === "on-duty" || e.shiftStatus === "present")) || null;
  }, 15000, "employee shiftStatus resumed to working");
  passed++;
  log(`  PASS: Scenario 2c - Work resumed; shiftStatus=${resumedEmployee.shiftStatus}`);
  await shot("02c-saudi-office-resumed");

  // Reload page to test timer persistence across refresh
  log("   Testing timer persistence across page refresh...");
  await dismissLateAlertIfPresent();
  await send("Page.reload");
  await new Promise((r) => setTimeout(r, 1500));
  await dismissLateAlertIfPresent();
  await waitUntil(
    () => evalJs(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const ack = btns.find(x => x.offsetParent !== null && /acknowledge|ack|got it|فهمت|موافق|تأكيد/i.test(x.innerText || ''));
      if (ack) ack.click();
      return btns.some(btn => btn.querySelector('svg.lucide-square') && btn.offsetParent !== null);
    })()`),
    30000,
    "on-duty stop button visible after page refresh"
  );
  await shot("03-saudi-office-timer-persisted");
  passed++;
  log("  PASS: Scenario 2d - Timer persisted across page reload");

  // Real UI check-out: stop -> daily-report modal -> textarea -> send
  await dismissLateAlertIfPresent();
  await evalJs(clickButtonWithIcon("square"));
  await waitUntil(() => evalJs(`!!document.querySelector('textarea')`), 20000, "daily report modal");
  await evalJs(setFieldExpr("textarea", "Office shift completed for E2E verification.", "HTMLTextAreaElement"));
  await evalJs(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => (x.querySelector('svg.lucide-send') || /submit|إرسال|تسجيل الخروج/i.test(x.innerText || '')) && x.offsetParent !== null);
    if (b) { b.click(); return true; }
    return false;
  })()`);

  const closedRecord = await waitUntil(async () => {
    const all = await fsList(`companies/${COMPANY_ID}/attendance`);
    return all.find((r) => r.employeeId === USERS.saudiOffice.empId && r.checkIn && r.checkOut) || null;
  }, 30000, "saudi office attendance record with checkOut");

  await shot("04-saudi-office-shift-ended");
  passed++;
  log(`  PASS: Scenario 2e - Shift completed and checkOut timestamp persisted; record=${closedRecord.id}`);

  // --------------------------------------------------------------------------
  // Scenario 3: Strict GPS Employee is blocked outside allowed zone
  // --------------------------------------------------------------------------
  log("\n--- Scenario 3: Mandatory GPS Employee Blocked Outside Geofence ---");
  await signOutBrowser();
  // Pin geolocation 100km away from Riyadh HQ
  await setGeo({ grant: true, coords: { lat: 25.5000, lng: 47.0000 } });
  await browserLogin(USERS.strictGps.email, USERS.strictGps.pass);
  await goto(`${ORIGIN}/tasks`);

  await waitUntil(() => evalJs(clickButtonWithIcon("play")), 30000, "strict GPS play button clicked");

  // Wait for error toast / rejection message
  await waitUntil(
    () => evalJs(`(() => {
      const text = document.body.innerText;
      return /outside|خارج|failed|فشل/i.test(text);
    })()`),
    30000,
    "error toast indicating outside allowed zone"
  );
  await shot("05-strict-gps-outside-blocked");

  // Confirm NO attendance record created for strict GPS employee
  const recordsStrict = await fsList(`companies/${COMPANY_ID}/attendance`);
  const strictRec = recordsStrict.find((r) => r.employeeId === USERS.strictGps.empId);
  if (!strictRec) {
    passed++;
    log("  PASS: Scenario 3 - Strict GPS employee blocked outside geofence; 0 attendance records created");
  } else {
    failed++;
    log("  FAIL: Scenario 3 - Unexpected attendance record created for out-of-bounds employee");
  }

  // --------------------------------------------------------------------------
  // Scenario 4: Attendance Record & Timesheet Consistency Verification
  // --------------------------------------------------------------------------
  log("\n--- Scenario 4: Attendance Record & Timesheet Consistency ---");
  const finalRecords = await fsList(`companies/${COMPANY_ID}/attendance`);
  const finalSaudiRec = finalRecords.find((r) => r.employeeId === USERS.saudiOffice.empId && r.checkIn && r.checkOut);
  const saudiEmpDoc = (await fsList(`companies/${COMPANY_ID}/employees`)).find((e) => e.id === USERS.saudiOffice.empId);
  const egyptEmpDoc = (await fsList(`companies/${COMPANY_ID}/employees`)).find((e) => e.id === USERS.egyptRemote.empId);

  const recValid = !!(
    finalSaudiRec &&
    finalSaudiRec.checkIn &&
    finalSaudiRec.checkOut &&
    (finalSaudiRec.checkInLocationId === "loc-riyadh-hq" ||
      finalSaudiRec.workLocationId === "loc-riyadh-hq" ||
      finalSaudiRec.location === "Riyadh Head Office")
  );
  const attrsPreserved = (
    saudiEmpDoc?.country === "Saudi Arabia" &&
    saudiEmpDoc?.workMode === "office" &&
    saudiEmpDoc?.branchId === "branch-riyadh" &&
    egyptEmpDoc?.country === "Egypt" &&
    egyptEmpDoc?.workMode === "remote" &&
    egyptEmpDoc?.branchId === "branch-cairo"
  );

  if (recValid && attrsPreserved) {
    passed++;
    log("  PASS: Scenario 4 - Attendance record consistent (checkIn/Out verified, location=loc-riyadh-hq, employee attrs preserved)");
  } else {
    failed++;
    log(`  FAIL: Scenario 4 - Consistency check failed (recValid=${recValid}, attrsPreserved=${attrsPreserved})`);
  }

  log("\n=================================================================");
  log(` Browser E2E Summary: ${passed} passed, ${failed} failed`);
  log("=================================================================\n");

} catch (err) {
  log(`\n❌ Error during browser E2E execution: ${err?.message}\n${err?.stack}`);
  try {
    const url = await currentUrl();
    const body = await evalJs("document.body.innerText");
    const html = await evalJs("document.getElementById('root')?.innerHTML || document.body.innerHTML || ''");
    log(`[ERROR DIAG] URL: ${url}`);
    log(`[ERROR DIAG] Body: ${body?.slice(0, 500)}`);
    log(`[ERROR DIAG] HTML: ${html?.slice(0, 800)}`);
    log(`[ERROR DIAG] ConsoleBuf: \n${consoleBuf.slice(-25).join("\n")}`);
    log(`[ERROR DIAG] ViteLogs: \n${viteLogs.slice(-10).join("\n")}`);
    await shot("diag-error-state");
  } catch (diagErr) {
    log(`[ERROR DIAG FAILED] ${diagErr.message}`);
  }
  failed++;
} finally {
  edgeProc.kill();
  viteProc.kill();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  if (failed > 0) process.exit(1);
}

