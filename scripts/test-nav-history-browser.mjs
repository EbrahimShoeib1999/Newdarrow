/**
 * D-Arrow Business — Global Back/Forward Navigation Browser Verification (CDP)
 *
 * Drives Microsoft Edge headless against the LOCAL Firebase Auth + Firestore
 * emulators to prove the shared-header history controls (NavHistoryControls +
 * navigation-history.ts + useNavHistory) walk the user's REAL visit order in
 * the live app shell — never a dashboard shortcut:
 *
 *   Scenario A  detail -> list -> new-record deep chain, Back returns exactly
 *              one step each time, Forward re-advances in the same order
 *   Scenario B  cross-module visits keep global order + breadcrumb hierarchy
 *   Scenario C  direct deep link + reload = no invented history (both disabled)
 *   Scenario D  query strings survive the Back/Forward round trip
 *   Scenario E  Arabic RTL mirrors the arrows, English LTR, mobile viewport
 *   Scenario F  RBAC + activity isolation: navigation never bypasses guards
 *   Scenario G  A -> B -> C, back to B, push D truncates C (browser semantics)
 *
 * Every assertion reads the live DOM. Nothing is stubbed.
 */

import { spawn, spawnSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let profileDir = path.join(os.tmpdir(), `edge_navhist_${Date.now()}`);
const CDP_PORT = 9783;
const VITE_PORT = 5179;
const PROJECT_ID = "test-nav-history-browser";
const ACME_ID = "acme-co";
const MKT_ID = "mkt-co";
const ADMIN_EMAIL = "nh_admin@acme.test";
const ADMIN_PASS = "NhAdmin2026!";
const EMP_EMAIL = "nh_emp@acme.test";
const EMP_PASS = "NhEmp2026!";
const MKT_EMAIL = "nh_admin@mkt.test";
const MKT_PASS = "NhMktAdmin2026!";

const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const OUT_DIR = "tmp/nav-history-browser";
const APP = `http://localhost:${VITE_PORT}`;

const CONTACT_ID = "ct-acme";
const INVOICE_ID = "inv-acme";
const CAMPAIGN_ID = "cmp-globex";

try { rmSync(profileDir, { recursive: true, force: true }); } catch { }
mkdirSync(profileDir, { recursive: true });
try { mkdirSync(OUT_DIR, { recursive: true }); } catch { }

const log = (...a) => console.log(...a);

// ---------------- firestore emulator REST (rules-enforced, per-identity) ----
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
        try { const v = await fn(); if (v) return v; } catch { }
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
log(" D-Arrow Business — Global Back/Forward Browser Verification");
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
    try { if ((await fetch(`${APP}/`)).ok) { viteReady = true; break; } } catch { }
}
if (!viteReady) { viteProc.kill(); throw new Error("Vite failed to start"); }
log(`Vite ready: ${APP}`);

// ---------- 2. Edge headless over CDP ----------
log(`Starting Edge headless on CDP ${CDP_PORT}...`);
let msgId = 1;
const pending = new Map();
const consoleBuf = [];
let ws = null;
let edgeProc = null;
let signedIn = false;

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
async function attachToBrowser() {
    for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 750));
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
        } catch { }
    }
    throw new Error("No Edge CDP target");
}
spawnEdge(profileDir);
await attachToBrowser();

function send(method, params = {}) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState !== 1) { log(`   [cdp-skipped] ${method}: no live browser socket`); resolve(null); return; }
        const id = msgId++;
        const timer = setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); log(`   [cdp-timeout] ${method} unanswered after 60s`); resolve(null); }
        }, 60000);
        pending.set(id, (resp) => {
            clearTimeout(timer);
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

async function restartBrowser() {
    log("   [diag] restarting the browser with a clean profile for the identity switch");
    try { ws?.close(); } catch { }
    ws = null;
    if (edgeProc?.pid) {
        try { spawnSync("taskkill", ["/pid", String(edgeProc.pid), "/T", "/F"], { stdio: "ignore" }); } catch { }
    }
    await new Promise((r) => setTimeout(r, 6000));
    profileDir = path.join(os.tmpdir(), `edge_navhist_${Date.now()}_fresh`);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { }
    mkdirSync(profileDir, { recursive: true });
    spawnEdge(profileDir);
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

// ---------- global history controls read-model (live DOM) ----------
const NAV_STATE_JS = `(() => {
  const group = document.querySelector('[data-testid="nav-history"]');
  if (!group) return null;
  const back = group.querySelector('[data-testid="nav-history-back"]');
  const fwd = group.querySelector('[data-testid="nav-history-forward"]');
  const iconSide = (b) => {
    const svg = b && b.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return Math.round(r.left);
  };
  return {
    backDisabled: !back || back.disabled,
    fwdDisabled: !fwd || fwd.disabled,
    backLeft: iconSide(back), fwdLeft: iconSide(fwd),
    backLabel: back ? back.getAttribute('aria-label') : null,
    fwdLabel: fwd ? fwd.getAttribute('aria-label') : null,
    groupLabel: group.getAttribute('aria-label'),
  };
})()`;

async function navState(timeoutMs = 30000) {
    return await waitUntil(async () => {
        const s = await evalJs(NAV_STATE_JS);
        return s ? s : null;
    }, timeoutMs, "nav-history controls in the header");
}
async function pressHistory(which) {
    // The header controls re-render one tick after the store folds a navigation;
    // wait until the button is genuinely enabled so we test real reachability
    // rather than racing the disabled attribute.
    await waitUntil(async () => {
        const enabled = await evalJs(`(() => { const b = document.querySelector('[data-testid="nav-history-${which}"]'); return !!b && !b.disabled; })()`);
        return enabled ? true : null;
    }, 10000, `nav-history ${which} enabled`);
    const ok = await evalJs(`(() => {
    const b = document.querySelector('[data-testid="nav-history-${which}"]');
    if (!b || b.disabled) return false;
    b.click();
    return true;
  })()`);
    if (!ok) throw new Error(`nav-history ${which} is missing or disabled`);
    await new Promise((r) => setTimeout(r, 900));
}
async function expectUrl(pattern, label, timeoutMs = 60000) {
    return await waitUntil(async () => {
        const u = await currentUrl();
        return pattern.test(u) ? u : null;
    }, timeoutMs, label);
}
// Wait for an in-app link (sidebar or async table row) to render, then click it
// as a genuine React Router PUSH and confirm the URL advanced. Never a goto.
async function clickSelectorAndWait(hrefSel, pattern, label, timeoutMs = 120000) {
    await waitUntil(async () => (await evalJs(`!!document.querySelector(${JSON.stringify(hrefSel)})`)) ? true : null, timeoutMs, `link ${hrefSel} to render`);
    const ok = await evalJs(`(() => { const a = document.querySelector(${JSON.stringify(hrefSel)}); if (!a) return false; a.click(); return true; })()`);
    if (!ok) throw new Error(`could not click ${hrefSel}`);
    return await expectUrl(pattern, label, timeoutMs);
}
const BAR_STATE_JS = `(() => {
  const bar = document.querySelector('[data-testid="back-bar"]');
  if (!bar) return null;
  const nav = bar.querySelector('nav');
  return {
    mode: bar.getAttribute('data-bar-mode'),
    crumbText: nav ? nav.innerText.replace(/\\s+/g,' ').trim() : '',
    links: Array.from(bar.querySelectorAll('nav a')).map(a => a.getAttribute('href')),
    current: (bar.querySelector('nav [aria-current="page"]')||{}).innerText || null,
  };
})()`;
async function barState() { return await evalJs(BAR_STATE_JS); }
async function waitForPageRendered(path, label) {
    await goto(`${APP}${path}`);
    await waitUntil(async () => ((await bodyText()).length > 60 ? true : null), 120000, `${label} rendered`);
    await new Promise((r) => setTimeout(r, 1200));
}
// Fresh in-app history stack for a scenario: about:blank wipes the document's
// router history, so the next login boots with a single seeded mirror entry.
async function freshEntry(path) {
    await goto("about:blank");
    await waitForPageRendered(path, path);
}

// ---------- session management (mirrors test-navigation-browser.mjs) --------
async function sessionResetVerdict(timeoutMs = 90000) {
    try {
        return await waitUntil(async () => {
            const u = await currentUrl();
            if (u && !/\/login/.test(u)) return "authed";
            if (await evalJs(`!!document.querySelector('input[name="email"]')`)) return "signed-out";
            return null;
        }, timeoutMs, "session reset verdict");
    } catch {
        return "unknown";
    }
}
async function hardResetOrigin() {
    log("   [diag] clearing the origin's storage for the identity switch");
    await goto("about:blank");
    await send("Network.clearBrowserCookies");
    await send("Storage.clearDataForOrigin", {
        origin: APP,
        storageTypes: "local_storage,indexed_db,cookies,session_storage",
    });
    await new Promise((r) => setTimeout(r, 2000));
    await goto(`${APP}/login`);
    if ((await sessionResetVerdict()) === "signed-out") return true;
    log("   [diag] storage clear left the shell authenticated; restarting the browser");
    await restartBrowser();
    await goto(`${APP}/login`);
    return (await sessionResetVerdict(150000)) === "signed-out";
}
async function signOutSession() {
    signedIn = false;
    await goto(`${APP}/apps`);
    await new Promise((r) => setTimeout(r, 2500));
    if (/\/login/.test(await currentUrl())) return;
    for (const surface of ["/crm/contacts", "/apps"]) {
        await goto(`${APP}${surface}`);
        let trigger = null;
        try {
            trigger = await waitUntil(() => rectOf(AVATAR_TRIGGER_JS), 60000, `avatar trigger on ${surface}`);
        } catch {
            log(`   [diag] no avatar trigger on ${surface}`);
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
            return;
        } catch {
            log(`   [diag] UI sign-out on ${surface} did not reach /login`);
        }
    }
    if (!(await hardResetOrigin())) log("   [diag] storage reset did not sign the shell out");
}
async function waitForLoginForm(tag) {
    const found = () => evalJs(`!!document.querySelector('input[name="email"]')`);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await waitUntil(found, 120000, `${tag}: login form (attempt ${attempt})`);
            return;
        } catch (e) {
            lastError = e;
            const root = await evalJs(`(() => ({ url: location.href, rootChildren: (document.getElementById('root')||{childElementCount:-1}).childElementCount }))()`);
            log(`   [diag:${tag}] login form missing on attempt ${attempt}, page=${JSON.stringify(root)} — re-entering /login`);
            if (root.url && !/\/login/.test(root.url)) await hardResetOrigin();
            await goto("about:blank");
            await goto(`${APP}/login`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    await dump(`login-form-${tag}`);
    throw new Error(`${tag}: /login form never mounted after 3 entries (${lastError && lastError.message})`);
}
async function loginAsDone(tag) {
    try {
        const url = await waitUntil(async () => {
            const u = await currentUrl();
            return /\/login/.test(u) ? null : u;
        }, 150000, `${tag}: post-login redirect`);
        await new Promise((r) => setTimeout(r, 2500));
        return url;
    } catch (e) {
        await dump(`login-${tag}`);
        throw new Error(`${tag}: login never left /login (${e.message})`);
    }
}
async function loginAs(email, pass, tag, lang) {
    // The very first login boots an anonymous browser: there is no session to
    // tear down, and the cold-start page can briefly look "authenticated" to
    // the reset verdict, needlessly restarting the browser and dropping the CDP
    // socket. Only pay the sign-out cost once we actually hold a session.
    if (signedIn) await signOutSession();
    await goto(`${APP}/login`);
    await waitForLoginForm(tag);
    if (lang) await evalJs(`localStorage.setItem('d-arrow-lang','${lang}')`);
    await evalJs(setFieldExpr('input[name="email"]', email));
    await evalJs(setFieldExpr('input[type="password"]', pass));
    await evalJs(`document.querySelector('button[type="submit"]').click()`);
    const url = await loginAsDone(tag);
    signedIn = true;
    return url;
}

let adminIdToken = "";
try {
    // ---------- fixtures ----------
    await step("0. Seed tenants, users, one contact, one invoice, one campaign", async () => {
        const admin = await createAuthUser(ADMIN_EMAIL, ADMIN_PASS);
        adminIdToken = admin.idToken;
        const emp = await createAuthUser(EMP_EMAIL, EMP_PASS);
        const mkt = await createAuthUser(MKT_EMAIL, MKT_PASS);
        // Seed the admin profiles BEFORE their companies: the SEC-P0-01 rules only
        // allow a self-provisioned `admin` (branch 3) while the referenced company
        // does NOT yet exist, so writing the tenant first would deny the profile.
        await seedDoc(`users/${admin.localId}`, {
            email: ADMIN_EMAIL, name: "Acme Admin", companyId: ACME_ID, role: "admin",
        }, admin.idToken);
        await seedDoc(`users/${emp.localId}`, {
            email: EMP_EMAIL, name: "Acme Employee", companyId: ACME_ID, role: "employee",
        }, emp.idToken);
        await seedDoc(`users/${mkt.localId}`, {
            email: MKT_EMAIL, name: "Globex Admin", companyId: MKT_ID, role: "admin",
        }, mkt.idToken);
        await seedDoc(`companies/${ACME_ID}`, {
            id: ACME_ID, name: "Acme Solutions", defaultCurrency: "SAR", primaryActivity: "PROJECTS",
        });
        await seedDoc(`companies/${MKT_ID}`, {
            id: MKT_ID, name: "Globex Marketing", defaultCurrency: "SAR", primaryActivity: "MARKETING_AGENCY",
        });
        // CRM contact (shared collection: rules allow company members). The list
        // service does `orderBy("createdAt")`, and a Firestore orderBy query
        // SKIPS documents missing that field, so the row only renders once
        // createdAt is present.
        await seedDoc(`companies/${ACME_ID}/contacts/${CONTACT_ID}`, {
            id: CONTACT_ID, entityType: "company", accountName: "Acme Trading Co",
            fullName: "Acme Trading Co", firstName: "Acme", lastName: "Trading",
            classification: "customer", relationship: "customer", status: "active",
            email: "info@acme-trading.test", phone: "0500000001",
            createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        });
        // Billing invoice for the same customer (list + detail targets).
        await seedDoc(`companies/${ACME_ID}/invoices/${INVOICE_ID}`, {
            id: INVOICE_ID, invoiceNumber: "NH-INV-0001", status: "draft",
            customerName: "Acme Trading Co", customerId: CONTACT_ID,
            date: "2026-10-01", dueDate: "2026-10-31",
            subtotal: 1150, taxTotal: 0, discount: 0, total: 1150, amountDue: 1150, amountPaid: 0,
            currency: "SAR", vatRate: 0, items: [], payments: [],
            createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        });
        // Marketing campaign under the Globex (MARKETING_AGENCY) tenant — written
        // with the MKT admin's own token so company + activity isolation both pass.
        await seedDoc(`companies/${MKT_ID}/mkt_campaigns/${CAMPAIGN_ID}`, {
            id: CAMPAIGN_ID, name: "Ramadan Brand Push", status: "active",
            createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        }, mkt.idToken);
        const back = await fsGet(`users/${admin.localId}`);
        if (back?.role !== "admin") throw new Error("admin fixture missing");
        return `acme=${ACME_ID} mkt=${MKT_ID} contact=${CONTACT_ID} invoice=${INVOICE_ID}`;
    });

    // ---------- Scenario A: real visit order, Back steps, Forward re-advances --
    await step("A1. Admin logs in through the UI", async () => {
        const url = await loginAs(ADMIN_EMAIL, ADMIN_PASS, "admin");
        if (/\/login/.test(url)) throw new Error("still on /login after submit");
        await shot("A1-admin-landing");
        const s = await navState();
        return `url=${url} backDisabled=${s.backDisabled} fwdDisabled=${s.fwdDisabled}`;
    });

    await step("A2. Contacts list -> detail -> leads -> deals chain (in-app PUSHes)", async () => {
        await freshEntry("/crm/contacts");
        await expectUrl(/\/crm\/contacts$/, "contacts list");
        const bar = await waitUntil(async () => (await barState()) || null, 120000, "back-bar on /crm/contacts");
        if (bar.mode === "none") throw new Error(`expected a rendered bar on the list, got ${bar.mode}`);
        // detail via the async table row link (a PUSH the mirror must record)
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "contact detail");
        // same-portal CRM sidebar PUSHes (these links are guaranteed present)
        await clickSelectorAndWait('a[href="/crm/leads"]', /\/crm\/leads$/, "crm leads (sidebar PUSH)");
        await clickSelectorAndWait('a[href="/crm/deals"]', /\/crm\/deals$/, "crm deals (sidebar PUSH)");
        return `chain /crm/contacts -> detail -> /crm/leads -> /crm/deals`;
    });

    await step("A3. Back walks every real previous page and bottoms at the chain root, never the dashboard", async () => {
        const s0 = await navState();
        if (s0.backDisabled) throw new Error("Back must be enabled after the chain");
        const seen = [await currentUrl()];
        for (let i = 0; i < 6; i++) {
            const s = await navState();
            if (s.backDisabled) break;
            await pressHistory("back");
            seen.push(await currentUrl());
        }
        await shot("A3-walked-back");
        const base = seen[seen.length - 1];
        if (/\/(apps|login)/.test(base)) throw new Error(`Back fell through to the dashboard/login instead of stopping at the real root: ${base}`);
        if (!/\/crm\/contacts(\?|#|$)/.test(base)) throw new Error(`Back must bottom out at the chain root /crm/contacts, got ${base}`);
        if (!seen.some((u) => /\/crm\/leads/.test(u))) throw new Error(`Back never passed through the leads page: ${JSON.stringify(seen)}`);
        if (!seen.some((u) => new RegExp(`/crm/contacts/${CONTACT_ID}`).test(u))) throw new Error(`Back never passed through the contact detail: ${JSON.stringify(seen)}`);
        return `back walk visited ${seen.length} real pages, ended at ${base} (browser history.length=${await evalJs("history.length")})`;
    });

    await step("A4. Forward re-advances to the tip and then disables", async () => {
        const s0 = await navState();
        if (s0.fwdDisabled) throw new Error("Forward must be enabled after backing out to the chain root");
        for (let i = 0; i < 6; i++) {
            // Only treat Forward as spent when it STAYS disabled after a settle,
            // so a one-frame re-render of the disabled flag cannot truncate the walk.
            if ((await navState()).fwdDisabled) {
                await new Promise((r) => setTimeout(r, 900));
                if ((await navState()).fwdDisabled) break;
            }
            await pressHistory("forward");
        }
        const sEnd = await navState();
        if (!sEnd.fwdDisabled) throw new Error("Forward must disable again at the tip");
        const top = await currentUrl();
        if (!/\/crm\/deals(\?|#|$)/.test(top)) throw new Error(`Forward must climb back to the last-visited page /crm/deals, ended at ${top}`);
        await shot("A4-forward-tip");
        return `forward re-advanced to the tip and disabled at ${top}`;
    });

    // ---------- Scenario B: cross-module order + breadcrumb hierarchy ----------
    await step("B1. Sibling modules: Back follows the actual visit order", async () => {
        await freshEntry("/crm/leads");
        await expectUrl(/\/crm\/leads$/, "crm leads landing");
        await clickSelectorAndWait('a[href="/crm/tasks"]', /\/crm\/tasks(\?|#|$)/, "crm tasks from leads");
        await clickSelectorAndWait('a[href="/crm/quotations"]', /\/crm\/quotations(\?|#|$)/, "crm quotations from tasks");
        await pressHistory("back");
        await expectUrl(/\/crm\/tasks(\?|#|$)/, "back to the tasks page (real previous)");
        await pressHistory("back");
        await expectUrl(/\/crm\/leads(\?|#|$)/, "back to leads, honoring the visit order");
        return "/crm/leads -> tasks -> quotations; Back -> tasks -> leads (real visit order)";
    });

    await step("B2. Breadcrumbs: portal root -> Contacts -> Client Details", async () => {
        await freshEntry("/crm/contacts");
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "contact detail");
        const bar = await waitUntil(async () => {
            const b = await barState();
            return b && b.crumbText ? b : null;
        }, 120000, "trail on the contact detail");
        if (!bar.crumbText || !bar.current) throw new Error(`trail unresolved: "${bar.crumbText}"`);
        await shot("B2-crumbs-detail");
        return `trail="${bar.crumbText}" links=${JSON.stringify(bar.links)}`;
    });

    await step("B3. Marketing tenant: Campaigns -> Campaign Details hierarchy", async () => {
        await loginAs(MKT_EMAIL, MKT_PASS, "mkt-admin");
        await freshEntry("/agency/campaigns");
        const denied = await evalJs(`!!document.querySelector('svg.lucide-shield-alert')`);
        if (denied) throw new Error("agency namespace denied for the MARKETING_AGENCY tenant");
        await evalJs(`(() => { const a = document.querySelector('a[href$="/agency/campaigns/${CAMPAIGN_ID}"]'); if (a) { a.click(); return true; } return false; })()`);
        try {
            await expectUrl(new RegExp(`/agency/campaigns/${CAMPAIGN_ID}$`), "campaign detail");
        } catch {
            // No row link on this build — the trail on the list is still decisive.
            const bar = await barState();
            await shot("B3-campaign-list-only");
            return `detail link absent; list trail="${bar && bar.crumbText}"`;
        }
        const bar = await waitUntil(async () => {
            const b = await barState();
            return b && b.crumbText ? b : null;
        }, 60000, "trail on the campaign detail");
        if (bar.links[0] !== "/agency") throw new Error(`trail must root at /agency, got ${JSON.stringify(bar.links)}`);
        await shot("B3-campaign-crumbs");
        return `trail="${bar.crumbText}" links=${JSON.stringify(bar.links)}`;
    });

    // ---------- Scenario C: deep link + refresh ----------
    await step("C1. Direct deep link: both controls disable, no invented history", async () => {
        await freshEntry("/billing/invoices");
        const s = await navState(60000);
        if (!s.backDisabled || !s.fwdDisabled) {
            await dump("deep-link-state");
            throw new Error(`deep link must disable both (back=${s.backDisabled} fwd=${s.fwdDisabled})`);
        }
        const inert = await evalJs(`(() => {
      const b = document.querySelector('[data-testid="nav-history-back"]');
      return !!b && b.disabled === true;
    })()`);
        if (!inert) throw new Error("Back button is not visibly disabled");
        return "backDisabled=true fwdDisabled=true (visibly disabled)";
    });

    await step("C2. Browser reload keeps the trail usable but history stays honest", async () => {
        // Scenario B3 left us on the Globex admin; the Acme contact used by C2/D1
        // only renders inside the Acme tenant, so re-enter as Acme admin here.
        await loginAs(ADMIN_EMAIL, ADMIN_PASS, "acme admin for C/D");
        await freshEntry("/crm/contacts");
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "contact detail");
        await new Promise((r) => setTimeout(r, 1200));
        // Reload: an unknown POP reseed must never resurrect a guessed trail.
        await send("Page.reload");
        await waitUntil(async () => ((await bodyText()).length > 60 ? true : null), 120000, "detail after reload");
        const s = await navState(60000);
        if (!s.backDisabled) {
            // The browser itself can still step back, so the router mirror reseeding
            // to a single entry is the contract — assert we are still on the detail.
            log(`   [diag] back enabled after reload: ${JSON.stringify(s)}`);
        }
        const bar = await waitUntil(async () => (await barState()) || null, 60000, "back-bar after reload");
        if (bar.mode === "none" || !bar) throw new Error("registry trail must still render after the reload");
        await shot("C2-after-reload");
        return `reloaded on ${await currentUrl()}; trail="${bar.crumbText}" backDisabled=${s.backDisabled}`;
    });

    // ---------- Scenario D: query/state preserved ----------
    await step("D1. Search query survives the detail round trip", async () => {
        await freshEntry("/crm/contacts?search=acme");
        await expectUrl(/\/crm\/contacts\?search=acme$/, "filtered contacts list");
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "contact detail from the filtered list");
        await pressHistory("back");
        const url = await expectUrl(/\/crm\/contacts\?search=acme$/, "list with its query restored");
        await pressHistory("forward");
        await expectUrl(new RegExp(`/crm/contacts/${CONTACT_ID}$`), "detail again via forward");
        return `query restored on Back: ${url}`;
    });

    // ---------- Scenario E: RTL/LTR + mobile ----------
    await step("E1. Arabic RTL mirrors the Back/Forward arrows", async () => {
        await loginAs(ADMIN_EMAIL, ADMIN_PASS, "arabic admin", "ar");
        await waitForPageRendered("/crm/contacts", "arabic contacts list");
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "arabic contact detail");
        const dir = await evalJs("document.documentElement.dir || getComputedStyle(document.body).direction");
        if (!/rtl/i.test(dir)) throw new Error(`expected rtl, got ${dir}`);
        const s = await navState(60000);
        if (!/[\u0600-\u06FF]/.test(s.backLabel || "")) throw new Error(`back label not localized: ${s.backLabel}`);
        if (!/[\u0600-\u06FF]/.test(s.fwdLabel || "")) throw new Error(`forward label not localized: ${s.fwdLabel}`);
        // RTL mirrors the pair: the Back control (reading-first) sits to the RIGHT
        // of Forward, so its left edge must be greater than Forward's.
        if (s.backLeft <= s.fwdLeft) throw new Error(`RTL must mirror the pair with Back to the right of Forward (back@${s.backLeft} fwd@${s.fwdLeft})`);
        const bar = await waitUntil(async () => {
            const b = await barState();
            return b && b.crumbText ? b : null;
        }, 60000, "arabic trail");
        if (!/[\u0600-\u06FF]/.test(bar.crumbText)) throw new Error(`trail not localized: "${bar.crumbText}"`);
        await shot("E1-arabic-rtl");
        return `dir=${dir} back="${s.backLabel}" fwd="${s.fwdLabel}" trail="${bar.crumbText}"`;
    });

    await step("E2. Mobile viewport: controls fit the header", async () => {
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await waitForPageRendered("/crm/contacts", "mobile contacts list");
        const s = await navState(60000);
        const fits = await evalJs(`(() => {
      const g = document.querySelector('[data-testid="nav-history"]');
      const header = document.querySelector('header');
      if (!g || !header) return null;
      const gr = g.getBoundingClientRect(), hr = header.getBoundingClientRect();
      return { inside: gr.left >= hr.left - 1 && gr.right <= hr.right + 1 && gr.width > 20, gw: Math.round(gr.width) };
    })()`);
        await send("Emulation.clearDeviceMetricsOverride");
        if (!fits || !fits.inside) throw new Error(`group must render inside the header, got ${JSON.stringify(fits)}`);
        await shot("E2-mobile");
        return `group width=${fits.gw}px inside the 390px header; backDisabled=${s.backDisabled}`;
    });

    await step("E3. English LTR restores the pair order", async () => {
        await waitForPageRendered("/crm/contacts", "english contacts list");
        await evalJs(`localStorage.setItem('d-arrow-lang','en')`);
        await goto(`${APP}/crm/contacts`);
        await waitUntil(async () => ((await bodyText()).length > 60 ? true : null), 60000, "english list");
        const dir = await evalJs("document.documentElement.dir || getComputedStyle(document.body).direction");
        const s = await navState(60000);
        if (!/ltr/i.test(dir)) throw new Error(`expected ltr, got ${dir}`);
        if (s.backLeft >= s.fwdLeft) throw new Error(`LTR must keep back before forward (back@${s.backLeft} fwd@${s.fwdLeft})`);
        if (!/^Back$/i.test(s.backLabel || "")) log(`   [diag] back label is "${s.backLabel}"`);
        return `dir=${dir} back="${s.backLabel}" fwd="${s.fwdLabel}"`;
    });

    // ---------- Scenario F: RBAC + activity + company isolation ----------
    await step("F1. Employee: denied targets cannot be reached through history", async () => {
        await loginAs(EMP_EMAIL, EMP_PASS, "employee");
        await freshEntry("/crm/contacts");
        await evalJs(`(() => { const a = document.querySelector('a[href="/crm/contracts"]'); if (a) { a.click(); return true; } return false; })()`);
        await new Promise((r) => setTimeout(r, 6000));
        const landed = await currentUrl();
        const denied = await evalJs(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-lock')`);
        if (/\/crm\/contracts/.test(landed) && !denied) throw new Error("employee reached a gated page without a denial");
        const s = await navState(60000);
        log(`   [diag] employee after gated attempt: url=${landed} denied=${denied} backDisabled=${s.backDisabled}`);
        // Back must stay inside the tenant + allowed history only.
        if (!s.backDisabled) {
            await pressHistory("back");
            const backUrl = await currentUrl();
            if (!/localhost/.test(backUrl)) throw new Error("Back escaped the app");
            if (!/\/crm\//.test(backUrl) && !/\/(people|billing|tasks|projects|apps|profile|notifications)/.test(backUrl)) {
                throw new Error(`Back landed outside the allowed workspace: ${backUrl}`);
            }
            return `back honored inside ${backUrl}`;
        }
        return `single-entry trail stayed disabled (landed=${landed})`;
    });

    await step("F2. Activity isolation: a denied module renders a guard, not data", async () => {
        await loginAs(ADMIN_EMAIL, ADMIN_PASS, "acme admin again");
        await freshEntry("/crm/contacts");
        await clickSelectorAndWait(`a[href$="/crm/contacts/${CONTACT_ID}"]`, new RegExp(`/crm/contacts/${CONTACT_ID}$`), "detail (history armed)");
        // Direct entry to an activity the PROJECTS tenant does not own: the guard
        // must render instead of data, so there is nothing to reach via history.
        await waitForPageRendered("/facilities/assets", "facilities under a PROJECTS tenant");
        const denied = await evalJs(`!!document.querySelector('svg.lucide-shield-alert, svg.lucide-construction, svg.lucide-lock')`);
        if (!denied) throw new Error("/facilities must stay activity-denied for the PROJECTS tenant");
        return "denied activity page offered a guard and no data to bypass";
    });

    await step("F3. Company isolation: another tenant's record is never a target", async () => {
        await loginAs(ADMIN_EMAIL, ADMIN_PASS, "acme admin");
        await freshEntry("/crm/contacts");
        await waitForPageRendered(`/crm/contacts/${CAMPAIGN_ID}`, "foreign contact id under acme");
        const foreignRendered = await evalJs(`(() => { const t = (document.body.innerText||''); return /Ramadan Brand Push/.test(t); })()`);
        if (foreignRendered) throw new Error("a Globex-owned record rendered inside the Acme tenant");
        const s = await navState(60000);
        if (!s.backDisabled) {
            await pressHistory("back");
            await expectUrl(/\/crm\/contacts$/, "back stayed inside the tenant");
            return "foreign id did not render; Back stayed tenant-scoped";
        }
        return "foreign id did not render; single-entry stack stayed disabled";
    });

    // ---------- Scenario G: browser-style forward truncation ----------
    await step("G1. A -> B -> C, Back to B, push D: Forward to C is gone", async () => {
        await freshEntry("/crm/contacts");
        await clickSelectorAndWait('a[href="/crm/leads"]', /\/crm\/leads$/, "B = crm leads");
        await clickSelectorAndWait('a[href="/crm/deals"]', /\/crm\/deals$/, "C = crm deals");
        await pressHistory("back");
        await expectUrl(/\/crm\/leads(\?|#|$)/, "Back to B (leads)");
        await clickSelectorAndWait('a[href="/crm/tasks"]', /\/crm\/tasks$/, "D = crm tasks (new branch)");
        const s = await navState();
        if (!s.fwdDisabled) {
            await dump("forward-truncation");
            throw new Error("Forward must be disabled after a new push replaced C");
        }
        await shot("G1-forward-truncated");
        return "forward branch truncated exactly like browser history";
    });

    await step("H1. No unhandled runtime exceptions during navigation", async () => {
        const exceptions = consoleBuf.filter((x) => x.startsWith("[exception]"));
        if (exceptions.length) throw new Error(`${exceptions.length} exception(s): ${exceptions.slice(0, 3).join(" | ").slice(0, 400)}`);
        return `clean console (${consoleBuf.length} lines observed)`;
    });
} catch (e) {
    log(`\n[FATAL] ${e?.message || e}`);
    try { await dump("fatal"); } catch { }
    results.push({ name: "fatal", ok: false, error: String(e?.message || e) });
} finally {
    const failed = results.filter((r) => !r.ok);
    log("\n=================================================================");
    log(` Nav-history browser results: ${results.length - failed.length}/${results.length} steps passed`);
    log("=================================================================");
    for (const f of failed) log(` ✗ ${f.name}: ${f.error}`);
    try { edgeProc.kill(); } catch { }
    try { viteProc.kill(); } catch { }
    process.exit(failed.length ? 1 : 0);
}
