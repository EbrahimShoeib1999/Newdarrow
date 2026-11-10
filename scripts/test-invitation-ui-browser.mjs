/**
 * Invitation acceptance UI E2E against Firebase Auth and Firestore emulators.
 * Auth accounts and Firestore fixtures are seeded only on localhost; the
 * invitation acceptance itself is performed through the real application UI.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = "invitation-ui-emulator";
const COMPANY_ID = "darrow";
const VITE_PORT = 5183;
const CDP_PORT = 9784;
const ORIGIN = `http://localhost:${VITE_PORT}`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const edgePath =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_invite_ui_${Date.now()}`);
const outputDir = path.join("tmp", "invitation-ui");
const password = "Emulator-Existing-Account-104!";
const runId = Date.now().toString(36);

assert.notEqual(PROJECT_ID, "d-arrow-buisiness");
assert.equal(new URL(AUTH_BASE).hostname, "127.0.0.1");
assert.equal(new URL(FS_BASE).hostname, "127.0.0.1");
mkdirSync(outputDir, { recursive: true });

const encode = (value) => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  throw new TypeError("Unsupported emulator fixture value");
};
function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
}
function decode(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return undefined;
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, decode(item)]));
}

async function seedDoc(documentPath, data) {
  const response = await fetch(`${FS_BASE}/${documentPath}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer owner",
    },
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!response.ok) {
    throw new Error(`Firestore Emulator fixture seed failed (${response.status})`);
  }
}
async function readDoc(documentPath) {
  const response = await fetch(`${FS_BASE}/${documentPath}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore Emulator read failed (${response.status})`);
  const document = await response.json();
  return decodeFields(document.fields || {});
}
async function listCollection(collectionPath) {
  const response = await fetch(`${FS_BASE}/${collectionPath}?pageSize=500`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (!response.ok) throw new Error(`Firestore Emulator list failed (${response.status})`);
  const result = await response.json();
  return (result.documents || []).map((document) => ({
    id: document.name.split("/").pop(),
    ...decodeFields(document.fields || {}),
  }));
}
async function createAuthUser(email) {
  const response = await fetch(`${AUTH_BASE}/accounts:signUp?key=emulator-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const result = await response.json();
  if (!response.ok || !result.localId) {
    throw new Error(`Firebase Auth Emulator account setup failed (${response.status})`);
  }
  const profileResponse = await fetch(`${AUTH_BASE}/accounts:update?key=emulator-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken: result.idToken,
      displayName: "Emulator Invitee",
      photoUrl: `${ORIGIN}/favicon.ico`,
      returnSecureToken: true,
    }),
  });
  if (!profileResponse.ok) {
    throw new Error(`Firebase Auth Emulator profile setup failed (${profileResponse.status})`);
  }
  return result.localId;
}
async function waitFor(fn, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"],
  {
    env: {
      ...process.env,
      VITE_USE_FIREBASE_EMULATORS: "true",
      VITE_USE_FIREBASE_EMULATOR: "true",
      VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
      VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
      VITE_FIRESTORE_EMULATOR_PORT: "8080",
      VITE_DISABLE_EMAIL_DELIVERY: "true",
    },
    stdio: "pipe",
  }
);
vite.stdout.on("data", (chunk) => viteMessages.push(String(chunk)));
vite.stderr.on("data", (chunk) => viteMessages.push(String(chunk)));
let browser;
let socket;
const externalRequests = [];
const consoleMessages = [];
const networkEvents = [];
const viteMessages = [];
const results = [];
let inspectPage;

try {
  const authProbe = await fetch(`${AUTH_BASE}/accounts:lookup?key=emulator-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: "" }),
  });
  const firestoreProbe = await fetch(`${FS_BASE}/__emulator_probe__`);
  if (!authProbe.url.startsWith("http://127.0.0.1:9099/") ||
      ![400, 401].includes(authProbe.status) ||
      !firestoreProbe.url.startsWith("http://127.0.0.1:8080/")) {
    throw new Error("Local Firebase Emulator safety preflight failed");
  }
  await waitFor(async () => (await fetch(ORIGIN)).ok, 60000, "local Vite server");

  await seedDoc(`companies/${COMPANY_ID}`, {
    id: COMPANY_ID,
    name: "DArrow",
    defaultCurrency: "SAR",
  });
  const originalCompanyCount = (await listCollection("companies")).length;

  const scenarios = [
    { label: "existing Gmail Auth account", email: `invite.gmail.${runId}@gmail.com`, suffix: "gmail" },
    { label: "existing Outlook Auth account", email: `invite.outlook.${runId}@outlook.com`, suffix: "outlook" },
  ];
  for (const scenario of scenarios) {
    scenario.uid = await createAuthUser(scenario.email);
    scenario.employeeId = `employee-${scenario.suffix}-${runId}`;
    scenario.token = `invite-${scenario.suffix}-${runId}`;
    await seedDoc(`companies/${COMPANY_ID}/employees/${scenario.employeeId}`, {
      id: scenario.employeeId,
      userId: "",
      companyId: COMPANY_ID,
      email: scenario.email,
      role: "employee",
      status: "active",
      country: "Egypt",
      workMode: scenario.suffix === "gmail" ? "office" : "remote",
      firstName: "UI",
      lastName: "Invite",
    });
    await seedDoc(`invites/${scenario.token}`, {
      token: scenario.token,
      email: scenario.email,
      companyId: COMPANY_ID,
      companyName: "DArrow",
      role: "employee",
      status: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      portalAccess: [],
      portalSubRoles: {},
      employeeId: scenario.employeeId,
    });
  }

  browser = spawn(edgePath, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ]);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const pages = await response.json();
    return pages.find((page) => page.type === "page" && page.webSocketDebuggerUrl);
  }, 30000, "browser CDP page");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let commandId = 1;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      consoleMessages.push(
        (message.params.args || []).map((item) => item.value ?? "").join(" ")
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      consoleMessages.push(
        `[exception] ${details.exception?.description || details.text || "unknown"}`
      );
    }
    if (
      message.method === "Network.requestWillBeSent" ||
      message.method === "Network.loadingFailed" ||
      message.method === "Network.responseReceived"
    ) {
      networkEvents.push({
        method: message.method,
        url: message.params.request?.url || message.params.response?.url || "",
        error: message.params.errorText || "",
      });
    }
    if (message.method === "Fetch.requestPaused") {
      const request = message.params.request;
      const url = new URL(request.url);
      const allowed =
        (url.hostname === "localhost" && url.port === String(VITE_PORT)) ||
        (url.hostname === "127.0.0.1" && ["8080", "9099"].includes(url.port));
      const firebaseEndpoint =
        /^(firestore|identitytoolkit|securetoken|firebasestorage|firebaseinstallations|firebaseappcheck)\.googleapis\.com$/i.test(url.hostname) ||
        /(^|\.)firebaseio\.com$/i.test(url.hostname) ||
        /firebasestorage|firebaseinstallations|d-arrow-buisiness/i.test(request.url);
      const shouldBlock = firebaseEndpoint && !allowed;
      if (shouldBlock) externalRequests.push(request.url);
      const method = shouldBlock ? "Fetch.failRequest" : "Fetch.continueRequest";
      void send(method, shouldBlock
        ? { requestId: message.params.requestId, errorReason: "BlockedByClient" }
        : { requestId: message.params.requestId });
    }
    if (message.method === "Network.webSocketCreated") {
      const url = new URL(message.params.url);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) &&
        (/^(firestore|identitytoolkit|securetoken|firebasestorage|firebaseinstallations|firebaseappcheck)\.googleapis\.com$/i.test(url.hostname) ||
          /(^|\.)firebaseio\.com$/i.test(url.hostname) ||
          /firebasestorage|firebaseinstallations|d-arrow-buisiness/i.test(message.params.url))
      ) {
        externalRequests.push(message.params.url);
      }
    }
  };
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = commandId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const response = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.text);
    }
    inspectPage = () => evaluate(`({
      url: window.location.origin + window.location.pathname,
      body: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 500)
    })`);
    return response.result?.result?.value;
  }
  async function navigate(url) {
    if (!url.startsWith(ORIGIN)) throw new Error("Refusing non-local browser navigation");
    await send("Page.navigate", { url });
    await waitFor(
      async () => (await evaluate("window.location.pathname")) === new URL(url).pathname
        ? true
        : null,
      30000,
      "local route navigation"
    );
  }
  async function enterInput(selector, value) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
  }
  async function clearBrowserSession() {
    await send("Storage.clearDataForOrigin", {
      origin: ORIGIN,
      storageTypes: "all",
    });
    await send("Network.clearBrowserCookies");
  }
  async function assertNoExternalRequests() {
    assert.deepEqual(externalRequests, [], "browser attempted a non-local network request");
  }

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*://*/*" }] });

  for (const scenario of scenarios) {
    await clearBrowserSession();
    await navigate(`${ORIGIN}/invite/${scenario.token}`);
    await waitFor(
      async () =>
        (await evaluate(`!!document.querySelector('input[type="password"]')`))
          ? true
          : null,
      180000,
      `${scenario.label} invitation password form`
    );
    const passwordFields = await evaluate(
      `document.querySelectorAll('input[type="password"]').length`
    );
    assert.equal(passwordFields, 2, "invite flow should show password + confirmation");
    assert.equal(await enterInput('input[name="password"]', password), true);
    assert.equal(await enterInput('input[name="confirmPassword"]', password), true);
    await evaluate(`document.querySelector('button[type="submit"]').click()`);
    await waitFor(
      async () =>
        !(await evaluate("window.location.pathname")).startsWith("/invite/")
          ? true
          : null,
      60000,
      `${scenario.label} acceptance redirect`
    );
    await assertNoExternalRequests();

    const [profile, employee, invite] = await Promise.all([
      readDoc(`users/${scenario.uid}`),
      readDoc(`companies/${COMPANY_ID}/employees/${scenario.employeeId}`),
      readDoc(`invites/${scenario.token}`),
    ]);
    assert.equal(profile?.id, scenario.uid, "existing Auth UID must be preserved");
    assert.equal(profile?.email, scenario.email);
    assert.equal(profile?.companyId, COMPANY_ID);
    assert.equal(profile?.role, "employee");
    assert.equal(profile?.onboardingStatus, "active");
    assert.equal(employee?.userId, scenario.uid);
    assert.equal(employee?.email, scenario.email);
    assert.equal(employee?.companyId, COMPANY_ID);
    assert.equal(employee?.role, "employee");
    assert.equal(employee?.country, "Egypt");
    assert.equal(employee?.workMode, scenario.suffix === "gmail" ? "office" : "remote");
    assert.equal(invite?.status, "accepted");
    assert.equal(invite?.acceptedBy, scenario.uid);
    const matchingEmployees = (await listCollection(
      `companies/${COMPANY_ID}/employees`
    )).filter((entry) => entry.email === scenario.email);
    assert.equal(matchingEmployees.length, 1, "employee record must not be duplicated");
    results.push(`${scenario.label}: accepted; UID preserved; single employee record`);

    const beforeDuplicate = JSON.stringify({ profile, employee, invite });
    await navigate(`${ORIGIN}/invite/${scenario.token}`);
    await waitFor(async () => (await evaluate("document.readyState")) === "complete", 30000, "duplicate invite page");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const duplicatePage = await evaluate(`({
      hasAccept: Array.from(document.querySelectorAll("button")).some((button) => /accept invitation|join company/i.test(button.innerText || "")),
      hasPassword: !!document.querySelector('input[type="password"]')
    })`);
    assert.equal(duplicatePage.hasAccept, false);
    assert.equal(duplicatePage.hasPassword, false);
    const afterDuplicate = JSON.stringify({
      profile: await readDoc(`users/${scenario.uid}`),
      employee: await readDoc(`companies/${COMPANY_ID}/employees/${scenario.employeeId}`),
      invite: await readDoc(`invites/${scenario.token}`),
    });
    assert.equal(afterDuplicate, beforeDuplicate, "duplicate attempt must not mutate onboarding records");
    results.push(`${scenario.label}: duplicate acceptance denied without writes`);
  }

  const statusCases = [
    { status: "revoked", suffix: "revoked" },
    { status: "accepted", suffix: "accepted" },
    { status: "pending", suffix: "expired", expiresAt: new Date(Date.now() - 60_000) },
  ];
  for (const item of statusCases) {
    const token = `invite-${item.suffix}-${runId}`;
    await seedDoc(`invites/${token}`, {
      token,
      email: scenarios[0].email,
      companyId: COMPANY_ID,
      companyName: "DArrow",
      role: "employee",
      status: item.status,
      expiresAt: item.expiresAt || new Date(Date.now() + 60 * 60 * 1000),
      portalAccess: [],
      portalSubRoles: {},
    });
    await navigate(`${ORIGIN}/invite/${token}`);
    await waitFor(async () => (await evaluate("document.readyState")) === "complete", 30000, `${item.suffix} invitation page`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pageState = await evaluate(`({
      hasAccept: Array.from(document.querySelectorAll("button")).some((button) => /accept invitation|join company/i.test(button.innerText || "")),
      hasPassword: !!document.querySelector('input[type="password"]')
    })`);
    assert.equal(pageState.hasAccept, false, `${item.suffix} invite must not expose acceptance`);
    assert.equal(pageState.hasPassword, false, `${item.suffix} invite must not expose password onboarding`);
    assert.equal((await readDoc(`invites/${token}`))?.status, item.status);
    results.push(`${item.suffix} invitation: no acceptance action exposed`);
  }

  await assertNoExternalRequests();
  const finalCompanyCount = (await listCollection("companies")).length;
  assert.equal(finalCompanyCount, originalCompanyCount, "onboarding must not create another company");
  writeFileSync(
    path.join(outputDir, "results.json"),
    JSON.stringify({ project: PROJECT_ID, scenarios: results }, null, 2)
  );
  writeFileSync(path.join(outputDir, "console.log"), consoleMessages.join("\n"));
  console.log(`RESULT ${results.length}/${results.length} browser UI invitation scenarios passed`);
  for (const result of results) console.log(`PASS ${result}`);
} catch (error) {
  console.error("INVITATION UI E2E FAILED:", error instanceof Error ? error.message : String(error));
  if (externalRequests.length) {
    const safeTargets = externalRequests.map((target) => {
      try {
        const url = new URL(target);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "(unparseable blocked target)";
      }
    });
    console.error(`Blocked Firebase browser targets: ${safeTargets.join(", ")}`);
  }
  console.error("Browser console tail:", consoleMessages.slice(-12).join("\n") || "(empty)");
  console.error("Vite output tail:", viteMessages.slice(-12).join("").slice(-3000) || "(empty)");
  const safeNetworkTail = networkEvents.slice(-20).map((event) => {
    try {
      const url = new URL(event.url);
      return {
        method: event.method,
        url: `${url.origin}${url.pathname.replace(/\/invite\/[^/]+/, "/invite/[redacted]")}`,
        error: event.error,
      };
    } catch {
      return { method: event.method, url: "(unparseable)", error: event.error };
    }
  });
  console.error("Browser network tail:", JSON.stringify(safeNetworkTail));
  try {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    if (screenshot.result?.data) {
      writeFileSync(
        path.join(outputDir, "failure.png"),
        Buffer.from(screenshot.result.data, "base64")
      );
    }
  } catch {}
  try { console.error("Browser page:", JSON.stringify(await inspectPage?.())); } catch {}
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { browser?.kill(); } catch {}
  try { vite.kill(); } catch {}
}
