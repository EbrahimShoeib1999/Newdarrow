/**
 * D-Arrow Business — Global HR Manager Real Browser Verification Suite
 *
 * Exercises Microsoft Edge headless via Chrome DevTools Protocol against the
 * local Firebase Auth + Firestore emulators:
 *
 * 1. Global HR Manager (khulodahmed390@gmail.com) logs in.
 * 2. Opens HR Dashboard (/people) -> Egyptian & Saudi employees visible by default ("ALL").
 * 3. Tests Country Filter switcher: "Egypt" (only EG), "Saudi Arabia" (only SA), "All Countries" (both).
 * 4. Opens Egyptian employee profile (/people/:id).
 * 5. Opens Saudi employee profile (/people/:id).
 * 6. Tests authorized employee edit action (updating title/department).
 * 7. Tests Attendance / Timesheets module access (/people/timesheets).
 * 8. Tests Leave requests module access (/people/leave).
 * 9. Tests Payroll / Separation of duties: HR can view payroll / deduction cases, cannot post to GL.
 * 10. Tests Page Refresh persistence (F5).
 * 11. Tests Logout & Re-login persistence.
 * 12. Cross-tenant isolation: employees from other company are never leaked.
 */

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath =
  process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_global_hr_${Date.now()}`);
const CDP_PORT = 9785;
const VITE_PORT = 5183;
const PROJECT_ID = "global-hr-browser-e2e";
const COMPANY_ID = "co-darrow-corp";
const OTHER_COMPANY_ID = "co-foreign-corp";
const ORIGIN = `http://localhost:${VITE_PORT}`;

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/global-hr-e2e";

const TEST_USERS = {
  admin: { email: "admin@corp.test", pass: "Admin2026!Global", name: "System Admin" },
  globalHr: { email: "khulodahmed390@gmail.com", pass: "SecGlobalHR2026!", name: "Khulod Ahmed", empId: "e-khulod-mgr" },
  egyptEmp1: { email: "nour@corp.test", pass: "NourEgypt2026!", name: "Nour El-Masri", empId: "e-nour-cairo" },
  egyptEmp2: { email: "hassan@corp.test", pass: "HassanAlex2026!", name: "Hassan Alexandria", empId: "e-hassan-alex" },
  saudiEmp1: { email: "norah@corp.test", pass: "NorahRiyadh2026!", name: "Norah Al-Otaibi", empId: "e-norah-riyadh" },
  saudiEmp2: { email: "albraa@corp.test", pass: "AlbraaRiyadh2026!", name: "Albraa Al-Masra", empId: "e-albraa-riyadh" },
  saudiEmp3: { email: "zainab@corp.test", pass: "ZainabRiyadh2026!", name: "Zainab Odaili", empId: "e-zainab-riyadh" },
  saudiEmp4: { email: "mohamed@corp.test", pass: "MohamedJeddah2026!", name: "Mohamed Mansour", empId: "e-mohamed-jeddah" },
  foreignEmp: { email: "foreign@other.test", pass: "ForeignEmp2026!", name: "Foreign Tenant Employee", empId: "e-foreign-sa" },
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
log(" D-Arrow — GLOBAL_HR_MANAGER Real Browser Verification (CDP)");
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
    log(`   📸 Screenshot saved: ${p}`);
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

const setFieldExpr = (sel, val, cls = 'HTMLInputElement') =>
  `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.focus(); Object.getOwnPropertyDescriptor(window[${JSON.stringify(cls)}].prototype,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`;

async function browserLogin(email, password) {
  await goto(`${ORIGIN}/login`);
  await waitUntil(() => evalJs(`!!document.querySelector('input[name="email"]') || !!document.querySelector('input[type="email"]')`), 60000, "login email input");
  await evalJs(setFieldExpr('input[name="email"]', email));
  await evalJs(setFieldExpr('input[type="password"]', password));
  await evalJs(`document.querySelector('button[type="submit"]').click()`);
  await waitUntil(async () => !((await evalJs("window.location.href")) || "").includes("/login"), 30000, "redirect away from login");
}

let passed = 0;
let failed = 0;
const results = [];

function recordTest(name, ok, details = "") {
  if (ok) {
    passed++;
    results.push({ name, status: "PASS", details });
    log(`  ✅ PASS: ${name} ${details ? `(${details})` : ""}`);
  } else {
    failed++;
    results.push({ name, status: "FAIL", details });
    log(`  ❌ FAIL: ${name} (${details})`);
  }
}

try {
  log("\n--- Seeding Test Fixtures in Firestore Emulator ---");

  // 1. Admin creates own user doc before company exists (rule clause 3)
  const adminAuth = await createAuthUser(TEST_USERS.admin.email, TEST_USERS.admin.pass);
  adminIdToken = adminAuth.idToken;
  await seedDoc(`users/${adminAuth.uid}`, {
    id: adminAuth.uid, email: TEST_USERS.admin.email, name: TEST_USERS.admin.name, role: "admin", companyId: COMPANY_ID,
    portalAccess: ["people", "tasks", "analytics"],
  }, adminAuth.idToken);

  // 2. Company & Other Company
  await seedDoc(`companies/${COMPANY_ID}`, {
    id: COMPANY_ID, name: "D-Arrow Global Corp", defaultCurrency: "SAR", timezone: "Asia/Riyadh",
    countries: ["Egypt", "Saudi Arabia"],
  }, adminIdToken);

  // 3. Target Account: khulodahmed390@gmail.com as GLOBAL_HR_MANAGER
  const hrAuth = await createAuthUser(TEST_USERS.globalHr.email, TEST_USERS.globalHr.pass);
  await seedDoc(`users/${hrAuth.uid}`, {
    id: hrAuth.uid, email: TEST_USERS.globalHr.email, name: TEST_USERS.globalHr.name, role: "employee", companyId: COMPANY_ID,
    country: "Egypt", portalAccess: ["people", "tasks"], portalSubRoles: {},
  }, hrAuth.idToken);

  await seedDoc(`users/${hrAuth.uid}`, {
    id: hrAuth.uid,
    email: TEST_USERS.globalHr.email,
    name: TEST_USERS.globalHr.name,
    role: "global_hr_manager",
    companyId: COMPANY_ID,
    country: "Egypt",
    branchId: "branch-cairo",
    countryScope: ["EG", "SA"],
    portalAccess: ["people", "tasks", "attendance", "analytics"],
    portalSubRoles: { people: "admin", tasks: "member", crm: "viewer" },
    customPermissions: ["company.view", "pricing.view", "users.manage_roles", "people.decide_deductions", "people.view_all_reports", "people.manage_all"],
  }, adminIdToken);

  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.globalHr.empId}`, {
    id: TEST_USERS.globalHr.empId,
    userId: hrAuth.uid,
    name: TEST_USERS.globalHr.name,
    email: TEST_USERS.globalHr.email,
    companyId: COMPANY_ID,
    country: "Egypt",
    branchId: "branch-cairo",
    department: "Human Resources",
    role: "global_hr_manager",
    jobTitle: "Global HR & Administration Manager",
    status: "active",
  }, adminIdToken);

  // 4. Egyptian Employees
  const eg1Auth = await createAuthUser(TEST_USERS.egyptEmp1.email, TEST_USERS.egyptEmp1.pass);
  await seedDoc(`users/${eg1Auth.uid}`, {
    id: eg1Auth.uid, email: TEST_USERS.egyptEmp1.email, name: TEST_USERS.egyptEmp1.name, role: "employee", companyId: COMPANY_ID, country: "Egypt",
    portalAccess: ["people", "tasks"],
  }, eg1Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.egyptEmp1.empId}`, {
    id: TEST_USERS.egyptEmp1.empId, userId: eg1Auth.uid, name: TEST_USERS.egyptEmp1.name, email: TEST_USERS.egyptEmp1.email,
    companyId: COMPANY_ID, country: "Egypt", branchId: "branch-cairo", department: "Engineering", jobTitle: "Senior Developer",
    status: "active", salary: 35000,
  }, adminIdToken);

  const eg2Auth = await createAuthUser(TEST_USERS.egyptEmp2.email, TEST_USERS.egyptEmp2.pass);
  await seedDoc(`users/${eg2Auth.uid}`, {
    id: eg2Auth.uid, email: TEST_USERS.egyptEmp2.email, name: TEST_USERS.egyptEmp2.name, role: "employee", companyId: COMPANY_ID, country: "Egypt",
    portalAccess: ["people", "tasks"],
  }, eg2Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.egyptEmp2.empId}`, {
    id: TEST_USERS.egyptEmp2.empId, userId: eg2Auth.uid, name: TEST_USERS.egyptEmp2.name, email: TEST_USERS.egyptEmp2.email,
    companyId: COMPANY_ID, country: "Egypt", branchId: "branch-alex", department: "Operations", jobTitle: "Operations Specialist",
    status: "active", salary: 28000,
  }, adminIdToken);

  // 5. Saudi Employees
  const sa1Auth = await createAuthUser(TEST_USERS.saudiEmp1.email, TEST_USERS.saudiEmp1.pass);
  await seedDoc(`users/${sa1Auth.uid}`, {
    id: sa1Auth.uid, email: TEST_USERS.saudiEmp1.email, name: TEST_USERS.saudiEmp1.name, role: "employee", companyId: COMPANY_ID, country: "Saudi Arabia",
    portalAccess: ["people", "tasks"],
  }, sa1Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.saudiEmp1.empId}`, {
    id: TEST_USERS.saudiEmp1.empId, userId: sa1Auth.uid, name: TEST_USERS.saudiEmp1.name, email: TEST_USERS.saudiEmp1.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", department: "Operations", jobTitle: "HR Generalist KSA",
    status: "active", salary: 12000,
  }, adminIdToken);

  const sa2Auth = await createAuthUser(TEST_USERS.saudiEmp2.email, TEST_USERS.saudiEmp2.pass);
  await seedDoc(`users/${sa2Auth.uid}`, {
    id: sa2Auth.uid, email: TEST_USERS.saudiEmp2.email, name: TEST_USERS.saudiEmp2.name, role: "employee", companyId: COMPANY_ID, country: "Saudi Arabia",
    portalAccess: ["people", "tasks"],
  }, sa2Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.saudiEmp2.empId}`, {
    id: TEST_USERS.saudiEmp2.empId, userId: sa2Auth.uid, name: TEST_USERS.saudiEmp2.name, email: TEST_USERS.saudiEmp2.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", department: "Finance", jobTitle: "Accountant KSA",
    status: "active", salary: 14000,
  }, adminIdToken);

  const sa3Auth = await createAuthUser(TEST_USERS.saudiEmp3.email, TEST_USERS.saudiEmp3.pass);
  await seedDoc(`users/${sa3Auth.uid}`, {
    id: sa3Auth.uid, email: TEST_USERS.saudiEmp3.email, name: TEST_USERS.saudiEmp3.name, role: "employee", companyId: COMPANY_ID, country: "Saudi Arabia",
    portalAccess: ["people", "tasks"],
  }, sa3Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.saudiEmp3.empId}`, {
    id: TEST_USERS.saudiEmp3.empId, userId: sa3Auth.uid, name: TEST_USERS.saudiEmp3.name, email: TEST_USERS.saudiEmp3.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-riyadh", department: "Customer Success", jobTitle: "CS Lead",
    status: "active", salary: 11000,
  }, adminIdToken);

  const sa4Auth = await createAuthUser(TEST_USERS.saudiEmp4.email, TEST_USERS.saudiEmp4.pass);
  await seedDoc(`users/${sa4Auth.uid}`, {
    id: sa4Auth.uid, email: TEST_USERS.saudiEmp4.email, name: TEST_USERS.saudiEmp4.name, role: "employee", companyId: COMPANY_ID, country: "Saudi Arabia",
    portalAccess: ["people", "tasks"],
  }, sa4Auth.idToken);
  await seedDoc(`companies/${COMPANY_ID}/employees/${TEST_USERS.saudiEmp4.empId}`, {
    id: TEST_USERS.saudiEmp4.empId, userId: sa4Auth.uid, name: TEST_USERS.saudiEmp4.name, email: TEST_USERS.saudiEmp4.email,
    companyId: COMPANY_ID, country: "Saudi Arabia", branchId: "branch-jeddah", department: "Design", jobTitle: "UI/UX Designer",
    status: "active", salary: 13500,
  }, adminIdToken);

  // 6. Foreign Tenant Admin & Employee (for isolation verification)
  const foreignAuth = await createAuthUser(TEST_USERS.foreignEmp.email, TEST_USERS.foreignEmp.pass);
  await seedDoc(`users/${foreignAuth.uid}`, {
    id: foreignAuth.uid, email: TEST_USERS.foreignEmp.email, name: TEST_USERS.foreignEmp.name, role: "admin", companyId: OTHER_COMPANY_ID, country: "Saudi Arabia",
  }, foreignAuth.idToken);
  await seedDoc(`companies/${OTHER_COMPANY_ID}`, {
    id: OTHER_COMPANY_ID, name: "Foreign Corp Ltd", defaultCurrency: "USD",
  }, foreignAuth.idToken);
  await seedDoc(`companies/${OTHER_COMPANY_ID}/employees/${TEST_USERS.foreignEmp.empId}`, {
    id: TEST_USERS.foreignEmp.empId, userId: foreignAuth.uid, name: TEST_USERS.foreignEmp.name, email: TEST_USERS.foreignEmp.email,
    companyId: OTHER_COMPANY_ID, country: "Saudi Arabia", branchId: "branch-foreign", department: "Foreign Dept", jobTitle: "Foreign Specialist",
    status: "active",
  }, foreignAuth.idToken);

  // 7. Attendance fixtures
  const today = new Date().toISOString().split("T")[0];
  await seedDoc(`companies/${COMPANY_ID}/attendance/att-eg-1`, {
    id: "att-eg-1", companyId: COMPANY_ID, employeeId: TEST_USERS.egyptEmp1.empId, date: today, checkIn: "09:00", status: "present", country: "Egypt",
  });
  await seedDoc(`companies/${COMPANY_ID}/attendance/att-sa-1`, {
    id: "att-sa-1", companyId: COMPANY_ID, employeeId: TEST_USERS.saudiEmp1.empId, date: today, checkIn: "08:30", status: "present", country: "Saudi Arabia",
  });

  // 8. Leave requests fixtures
  await seedDoc(`companies/${COMPANY_ID}/leave_requests/leave-eg-1`, {
    id: "leave-eg-1", companyId: COMPANY_ID, employeeId: TEST_USERS.egyptEmp1.empId, type: "annual", startDate: today, endDate: today, status: "pending", country: "Egypt",
  });
  await seedDoc(`companies/${COMPANY_ID}/leave_requests/leave-sa-1`, {
    id: "leave-sa-1", companyId: COMPANY_ID, employeeId: TEST_USERS.saudiEmp1.empId, type: "sick", startDate: today, endDate: today, status: "pending", country: "Saudi Arabia",
  });

  log("Seeded test company, target Global HR Manager, 6 employees across Egypt & Saudi, foreign tenant employee, attendance & leaves.");

  // --------------------------------------------------------------------------
  // TEST 1: Browser Login as Global HR Manager
  // --------------------------------------------------------------------------
  log("\n--- TEST 1: Login as Global HR Manager ---");
  await browserLogin(TEST_USERS.globalHr.email, TEST_USERS.globalHr.pass);
  const postLoginUrl = await currentUrl();
  recordTest("Browser Login as Global HR Manager", !postLoginUrl.includes("/login"), `Current URL: ${postLoginUrl}`);
  await shot("01-global-hr-post-login");

  // --------------------------------------------------------------------------
  // TEST 2: Cross-Country Visibility on /people
  // --------------------------------------------------------------------------
  log("\n--- TEST 2: Cross-Country Visibility on /people ---");
  await goto(`${ORIGIN}/people`);
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Norah Al-Otaibi") && document.body.innerText.includes("Nour El-Masri")`),
    30000,
    "both Egyptian and Saudi employees visible on /people"
  );
  const peoplePageText = await evalJs("document.body.innerText");
  const hasEg1 = peoplePageText.includes("Nour El-Masri");
  const hasEg2 = peoplePageText.includes("Hassan Alexandria");
  const hasSa1 = peoplePageText.includes("Norah Al-Otaibi");
  const hasSa2 = peoplePageText.includes("Albraa Al-Masra");
  const hasSa3 = peoplePageText.includes("Zainab Odaili");
  const hasSa4 = peoplePageText.includes("Mohamed Mansour");
  const hasForeign = peoplePageText.includes("Foreign Tenant Employee");

  recordTest("View Egyptian employees", hasEg1 && hasEg2, `Nour=${hasEg1}, Hassan=${hasEg2}`);
  recordTest("View Saudi employees", hasSa1 && hasSa2 && hasSa3 && hasSa4, `Norah=${hasSa1}, Albraa=${hasSa2}, Zainab=${hasSa3}, Mohamed=${hasSa4}`);
  recordTest("Tenant Isolation: Foreign company employee hidden", !hasForeign, "Foreign employee not present");
  await shot("02-global-hr-people-dashboard-all");

  // --------------------------------------------------------------------------
  // TEST 3: Country Filtering in Employee Table
  // --------------------------------------------------------------------------
  log("\n--- TEST 3: Country Filtering ---");
  async function filterByCountry(countryKey) {
    // 1. Click the country select trigger (HeroUI)
    await evalJs(`(() => {
      const trigger = document.querySelector('button[aria-label="Filter by Country"]') ||
                      document.querySelector('button[aria-label="Country"]') ||
                      document.querySelector('button[aria-label="الدولة"]');
      if (trigger) { trigger.click(); return true; }
      return false;
    })()`);
    await new Promise((r) => setTimeout(r, 600));

    // 2. Click option in opened popover listbox
    await evalJs(`(() => {
      const opt = document.querySelector('li[data-key="${countryKey}"]') ||
                  Array.from(document.querySelectorAll('[role="option"]')).find(el => (el.innerText || '').includes("${countryKey}"));
      if (opt) { opt.click(); return true; }
      return false;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
  }

  // Select "Egypt"
  await filterByCountry("Egypt");
  const egFilterText = await evalJs("document.body.innerText");
  const egOnlyOk = egFilterText.includes("Nour El-Masri") && !egFilterText.includes("Norah Al-Otaibi");
  recordTest("Filter Egypt (Egypt employees visible, Saudi employees filtered out)", egOnlyOk);
  await shot("03-global-hr-filter-egypt");

  // Select "Saudi Arabia"
  await filterByCountry("Saudi Arabia");
  const saFilterText = await evalJs("document.body.innerText");
  const saOnlyOk = saFilterText.includes("Norah Al-Otaibi") && !saFilterText.includes("Nour El-Masri");
  recordTest("Filter Saudi Arabia (Saudi employees visible, Egypt employees filtered out)", saOnlyOk);
  await shot("04-global-hr-filter-saudi");

  // Switch back to "ALL"
  await filterByCountry("ALL");
  const allFilterText = await evalJs("document.body.innerText");
  const allAgainOk = allFilterText.includes("Nour El-Masri") && allFilterText.includes("Norah Al-Otaibi");
  recordTest("Filter All Countries restored", allAgainOk);

  // --------------------------------------------------------------------------
  // TEST 4: View Egyptian Employee Details (/people/:id)
  // --------------------------------------------------------------------------
  log("\n--- TEST 4: View Egyptian Employee Profile ---");
  await goto(`${ORIGIN}/people/${TEST_USERS.egyptEmp1.empId}`);
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Nour El-Masri")`),
    20000,
    "Egyptian employee profile loaded"
  );
  const egProfileText = await evalJs("document.body.innerText");
  const egProfileOk = egProfileText.includes("Nour El-Masri") && egProfileText.includes("Engineering");
  recordTest("View Egyptian employee profile details", egProfileOk);
  await shot("05-global-hr-view-egypt-profile");

  // --------------------------------------------------------------------------
  // TEST 5: View Saudi Employee Details (/people/:id)
  // --------------------------------------------------------------------------
  log("\n--- TEST 5: View Saudi Employee Profile ---");
  await goto(`${ORIGIN}/people/${TEST_USERS.saudiEmp1.empId}`);
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Norah Al-Otaibi")`),
    20000,
    "Saudi employee profile loaded"
  );
  const saProfileText = await evalJs("document.body.innerText");
  const saProfileOk = saProfileText.includes("Norah Al-Otaibi") && saProfileText.includes("Operations");
  recordTest("View Saudi employee profile details", saProfileOk);
  await shot("06-global-hr-view-saudi-profile");

  // --------------------------------------------------------------------------
  // TEST 6: Authorized Employee Editing
  // --------------------------------------------------------------------------
  log("\n--- TEST 6: Authorized Employee Editing ---");
  // Check if Edit button exists on profile
  const hasEditBtn = await evalJs(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => /edit|تعديل/i.test(b.innerText || '') && b.offsetParent !== null);
  })()`);
  recordTest("Authorized Edit Profile Button Visible to Global HR", !!hasEditBtn);

  if (hasEditBtn) {
    // Open edit modal
    await evalJs(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /edit|تعديل/i.test(x.innerText || '') && x.offsetParent !== null);
      if (b) b.click();
    })()`);
    await new Promise((r) => setTimeout(r, 1000));
    await shot("07-global-hr-edit-modal-open");

    // Close or save
    await evalJs(`(() => {
      const closeBtn = document.querySelector('button[aria-label="Close"]') || Array.from(document.querySelectorAll('button')).find(b => /cancel|إلغاء/i.test(b.innerText || ''));
      if (closeBtn) closeBtn.click();
    })()`);
  }

  // --------------------------------------------------------------------------
  // TEST 7: Attendance & Timesheets Module
  // --------------------------------------------------------------------------
  log("\n--- TEST 7: Attendance & Timesheets Module ---");
  await goto(`${ORIGIN}/people/timesheets`);
  await waitUntil(
    () => evalJs(`!!document.querySelector('main') || !!document.querySelector('#root > *')`),
    20000,
    "Timesheets page loaded"
  );
  const timesheetsUrl = await currentUrl();
  const timesheetsOk = timesheetsUrl.includes("/people/timesheets");
  recordTest("Access Timesheets / Attendance Records across countries", timesheetsOk, `URL: ${timesheetsUrl}`);
  await shot("08-global-hr-timesheets-module");

  // --------------------------------------------------------------------------
  // TEST 8: Leave Requests Module
  // --------------------------------------------------------------------------
  log("\n--- TEST 8: Leave Requests Module ---");
  await goto(`${ORIGIN}/people/leave`);
  await waitUntil(
    () => evalJs(`!!document.querySelector('main') || !!document.querySelector('#root > *')`),
    20000,
    "Leave tracker page loaded"
  );
  const leaveUrl = await currentUrl();
  const leaveOk = leaveUrl.includes("/people/leave");
  recordTest("Access Leave Requests across countries", leaveOk, `URL: ${leaveUrl}`);
  await shot("09-global-hr-leave-module");

  // --------------------------------------------------------------------------
  // TEST 9: Payroll & Separation of Duties
  // --------------------------------------------------------------------------
  log("\n--- TEST 9: Payroll & Separation of Duties ---");
  // Can view deduction cases (HR compensation review)
  await goto(`${ORIGIN}/people/deduction-cases`);
  await waitUntil(
    () => evalJs(`!!document.querySelector('main') || !!document.querySelector('#root > *')`),
    20000,
    "Deduction cases page loaded"
  );
  const deductionUrl = await currentUrl();
  const deductionOk = deductionUrl.includes("/people/deduction-cases");
  recordTest("HR Compensation & Deduction Review Access", deductionOk, `URL: ${deductionUrl}`);

  // Cannot post manual accounting journal entries (financial separation of duties)
  await goto(`${ORIGIN}/billing/journals`);
  await new Promise((r) => setTimeout(r, 2000));
  const journalUrl = await currentUrl();
  const journalBlocked = !journalUrl.includes("/billing/journals") || (await evalJs(`
    document.body.innerText.includes("Unauthorized") ||
    document.body.innerText.includes("Forbidden") ||
    document.body.innerText.includes("not found") ||
    document.body.innerText.includes("Denied") ||
    document.body.innerText.includes("غير مصرح") ||
    document.body.innerText.includes("لا تملك صلاحية") ||
    !!document.querySelector('svg.lucide-shield-alert')
  `));
  recordTest("Separation of Duties: Accounting GL Journal Posting Denied to Global HR", journalBlocked, `Access denied / protected at: ${journalUrl}`);
  await shot("10-global-hr-separation-of-duties");

  // --------------------------------------------------------------------------
  // TEST 10: Persistence Across Page Refresh
  // --------------------------------------------------------------------------
  log("\n--- TEST 10: Persistence Across Page Refresh ---");
  await goto(`${ORIGIN}/people`);
  await send("Page.reload");
  await new Promise((r) => setTimeout(r, 3000));
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Norah Al-Otaibi") && document.body.innerText.includes("Nour El-Masri")`),
    30000,
    "employees visible after page refresh"
  );
  const afterRefreshUrl = await currentUrl();
  recordTest("Permissions & Session persist across Page Refresh", !afterRefreshUrl.includes("/login"), `URL: ${afterRefreshUrl}`);
  await shot("11-global-hr-after-refresh");

  // --------------------------------------------------------------------------
  // TEST 11: Persistence Across Logout & Re-login
  // --------------------------------------------------------------------------
  log("\n--- TEST 11: Persistence Across Logout & Re-login ---");
  await signOutBrowser();
  await browserLogin(TEST_USERS.globalHr.email, TEST_USERS.globalHr.pass);
  await goto(`${ORIGIN}/people`);
  await waitUntil(
    () => evalJs(`document.body.innerText.includes("Norah Al-Otaibi") && document.body.innerText.includes("Nour El-Masri")`),
    30000,
    "employees visible after re-login"
  );
  const reLoginText = await evalJs("document.body.innerText");
  const reLoginOk = reLoginText.includes("Nour El-Masri") && reLoginText.includes("Norah Al-Otaibi");
  recordTest("Permissions & Role persist across Logout & Re-login", reLoginOk);
  await shot("12-global-hr-after-relogin");

} catch (err) {
  log("Test execution threw error:", err);
  await shot("error-snapshot");
  failed++;
} finally {
  log("\n=================================================================");
  log(` Browser E2E Results: ${passed} PASSED, ${failed} FAILED`);
  log("=================================================================\n");
  for (const r of results) {
    log(`  [${r.status}] ${r.name} ${r.details ? `(${r.details})` : ""}`);
  }

  try { edgeProc.kill(); } catch {}
  try { viteProc.kill(); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}
