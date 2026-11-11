import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ID = "darrow-invites-ui";
const COMPANY_ID = "invites-ui-company";
const VITE_PORT = 5186;
const CDP_PORT = 9787;
const ORIGIN = `http://localhost:${VITE_PORT}`;
const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const EDGE_PATH =
  process.env.EDGE_PATH ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_invites_admin_${Date.now()}`);
const outputDir = path.join("tmp", "invites-admin-ui");
const buildDir = path.join("tmp", `invites-admin-build-${Date.now()}`);
const email = `admin.${Date.now()}@invites.example.test`;
const password = "Emulator-Invite-Admin-104!";
const inviteEmail = `new-hire.${Date.now()}@invites.example.test`;
const localHosts = new Set(["localhost", "127.0.0.1"]);
const results = [];
const consoleMessages = [];
const externalRequests = [];
const networkEvents = [];
const viteMessages = [];
let browser;
let vite;
let socket;
let commandId = 1;
const pendingCommands = new Map();

mkdirSync(outputDir, { recursive: true });

function encodeValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(value) } };
}

function encodeFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, encodeValue(item)])
  );
}

function decodeValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  return undefined;
}

function decodeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
}

async function waitFor(fn, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn().catch(() => null);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function seedDoc(idToken, documentPath, value) {
  const response = await fetch(`${FS_BASE}/${documentPath}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: encodeFields(value) }),
  });
  if (!response.ok) {
    throw new Error(`Emulator fixture write failed (${response.status})`);
  }
}

async function readDoc(idToken, documentPath) {
  const response = await fetch(`${FS_BASE}/${documentPath}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Emulator verification read failed (${response.status})`);
  }
  const document = await response.json();
  return decodeFields(document.fields || {});
}

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = commandId++;
    pendingCommands.set(id, resolve);
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
  return response.result?.result?.value;
}

async function navigate(url) {
  if (!url.startsWith(ORIGIN)) throw new Error("Non-local navigation refused");
  await send("Page.navigate", { url });
  await waitFor(
    async () => (await evaluate("window.location.pathname")) === new URL(url).pathname,
    30000,
    "local route"
  );
}

async function setInputValue(selector, value) {
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`;
  if (!(await evaluate(expression))) throw new Error(`Missing input ${selector}`);
}

async function startBrowser() {
  browser = spawn(EDGE_PATH, [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ]);
  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    const pages = await response.json();
    return pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  }, 30000, "headless Edge");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pendingCommands.has(message.id)) {
        pendingCommands.get(message.id)(message);
        pendingCommands.delete(message.id);
      } else if (message.method === "Runtime.consoleAPICalled") {
        consoleMessages.push(
          (message.params.args || []).map((item) => item.value ?? "").join(" ")
        );
      } else if (message.method === "Runtime.exceptionThrown") {
        consoleMessages.push("[exception] " + (
          message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text ||
          "unknown"
        ));
      } else if (message.method === "Network.requestWillBeSent") {
        const url = new URL(message.params.request.url);
        networkEvents.push(`request ${url.origin}${url.pathname}`);
        const local = localHosts.has(url.hostname) &&
          (url.port === String(VITE_PORT) || ["8080", "9099"].includes(url.port));
        if (!local && !["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
          externalRequests.push(`${url.origin}${url.pathname}`);
        }
      } else if (message.method === "Network.loadingFailed") {
        networkEvents.push(
          `failed ${message.params.requestId}: ${message.params.errorText}`
        );
      }
    };
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'localStorage.setItem("i18nextLng", "en");',
  });
}

try {
  assert.notEqual(PROJECT_ID, "d-arrow-buisiness");
  assert.equal(new URL(AUTH_BASE).hostname, "127.0.0.1");
  assert.equal(new URL(FS_BASE).hostname, "127.0.0.1");

  const authResponse = await fetch(`${AUTH_BASE}/accounts:signUp?key=emulator-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const authAccount = await authResponse.json();
  if (!authResponse.ok || !authAccount.localId || !authAccount.idToken) {
    throw new Error("Could not create isolated Firebase Auth emulator account");
  }

  await seedDoc(authAccount.idToken, `users/${authAccount.localId}`, {
    id: authAccount.localId,
    email,
    name: "Invites Admin",
    nameAr: "",
    avatar: "",
    role: "admin",
    companyId: COMPANY_ID,
    companyName: "Invites Test Company",
    onboardingStatus: "active",
  });
  await seedDoc(authAccount.idToken, `companies/${COMPANY_ID}`, {
    id: COMPANY_ID,
    name: "Invites Test Company",
    defaultCurrency: "SAR",
  });

  const viteEnv = {
    ...process.env,
    E2E_NO_HMR: "1",
    VITE_USE_FIREBASE_EMULATORS: "true",
    VITE_USE_FIREBASE_EMULATOR: "true",
    VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
    VITE_FIRESTORE_EMULATOR_PORT: "8080",
    VITE_ENABLE_MOCKS: "false",
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  };
  const build = spawnSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build", "--outDir", buildDir],
    { env: viteEnv, encoding: "utf8" }
  );
  viteMessages.push(build.stdout || "", build.stderr || "");
  if (build.status !== 0) {
    throw new Error(`Local E2E bundle build failed (exit ${build.status})`);
  }
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      buildDir,
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
    { env: viteEnv, stdio: "pipe" }
  );
  vite.stdout.on("data", (chunk) => viteMessages.push(String(chunk)));
  vite.stderr.on("data", (chunk) => viteMessages.push(String(chunk)));
  await waitFor(async () => (await fetch(ORIGIN)).ok, 60000, "Vite server");
  await startBrowser();

  await navigate(`${ORIGIN}/login`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log("Login page diagnostic:", JSON.stringify(await evaluate(`({
    url: window.location.href,
    readyState: document.readyState,
    body: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 400),
    html: document.documentElement?.outerHTML.slice(0, 700),
    resources: performance.getEntriesByType("resource").map((item) => item.name).slice(-12),
    inputs: Array.from(document.querySelectorAll("input")).map((item) => ({
      type: item.type,
      name: item.name,
      label: item.getAttribute("aria-label")
    }))
  })`)));
  await waitFor(
    async () => evaluate(`!!document.querySelector('input[name="email"]')`),
    30000,
    "login form"
  );
  await setInputValue('input[name="email"]', email);
  await setInputValue('input[name="password"]', password);
  await evaluate(`document.querySelector('button[type="submit"]').click()`);
  await waitFor(
    async () => !(await evaluate("window.location.pathname")).includes("/login"),
    60000,
    "authenticated session"
  );
  console.log("PASS browser login");

  await navigate(`${ORIGIN}/people/team`);
  await waitFor(
    async () => (await evaluate("document.body.innerText")).includes("Team members"),
    60000,
    "Employee Management page"
  );
  console.log("PASS Employee Management access and roster loaded");

  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) =>
      /invite member/i.test(item.innerText || "")
    );
    if (!button) throw new Error("Invite button is not available");
    button.click();
  })()`);
  await waitFor(
    async () => (await evaluate("document.body.innerText")).includes("Invite team member"),
    30000,
    "invite modal"
  );
  await setInputValue('input[type="email"]', inviteEmail);

  await evaluate(`(() => {
    const trigger = Array.from(document.querySelectorAll("button")).find((item) =>
      item.getAttribute("aria-haspopup") === "listbox" &&
      /employee|viewer|manager/i.test(item.innerText || "")
    );
    if (!trigger) throw new Error("Invite role selector is not available");
    trigger.click();
  })()`);
  await waitFor(
    async () => evaluate(`!!document.querySelector('[role="listbox"]')`),
    10000,
    "invite role choices"
  );
  const roleOptions = await evaluate(`Array.from(document.querySelectorAll('[role="option"]'))
    .map((item) => (item.innerText || "").trim())
    .filter(Boolean)`);
  assert.ok(roleOptions.length > 0, "invite role options should be visible");
  assert.equal(roleOptions.some((role) => /super admin|^admin$/i.test(role)), false);
  const viewerOption = await evaluate(`Array.from(document.querySelectorAll('[role="option"]'))
    .find((item) => /viewer/i.test(item.innerText || ""))?.innerText || null`);
  assert.ok(viewerOption, "Viewer must be an allowed invite role");
  await evaluate(`Array.from(document.querySelectorAll('[role="option"]'))
    .find((item) => /viewer/i.test(item.innerText || ""))?.click()`);

  await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button")).find((item) =>
      /send invite email/i.test(item.innerText || "")
    );
    if (!button) throw new Error("Submit invitation button is not available");
    button.click();
  })()`);
  await waitFor(
    async () => (await evaluate("document.body.innerText")).includes(inviteEmail),
    60000,
    "pending invitation in team list"
  );
  const inviteUrl = await evaluate(`Array.from(document.querySelectorAll("code"))
    .map((item) => (item.innerText || "").trim())
    .find((value) => value.includes("/invite/")) || null`);
  assert.ok(inviteUrl, "created invite link should be shown in the modal");
  const token = new URL(inviteUrl).pathname.split("/").pop();
  const inviteDocument = await readDoc(authAccount.idToken, `invites/${token}`);
  assert.equal(inviteDocument?.email, inviteEmail);
  assert.equal(inviteDocument?.role, "viewer");
  assert.equal(inviteDocument?.status, "pending");
  results.push("create invite through UI");
  console.log("PASS create allowed Viewer invitation; pending row persisted");

  await evaluate(`(() => {
    const row = Array.from(document.querySelectorAll("tr")).find((item) =>
      (item.innerText || "").includes(${JSON.stringify(inviteEmail)})
    );
    const button = row?.querySelector('button[aria-label="Delete"]');
    if (!button) throw new Error("Revoke action is not available for admin");
    button.click();
  })()`);
  await waitFor(
    async () => !(await evaluate("document.body.innerText")).includes(inviteEmail),
    60000,
    "pending invitation removal"
  );
  const pendingListCount = consoleMessages.filter((message) =>
    /InvitesService:listPending.*Completed/i.test(message)
  ).length;
  await send("Page.reload", { ignoreCache: true });
  await waitFor(
    async () =>
      (await evaluate("document.body.innerText")).includes("Team members") &&
      consoleMessages.filter((message) =>
        /InvitesService:listPending.*Completed/i.test(message)
      ).length > pendingListCount,
    60000,
    "refreshed pending invitation list"
  );
  assert.equal(
    (await evaluate("document.body.innerText")).includes(inviteEmail),
    false,
    "revoked invitation should remain absent after a fresh server query"
  );
  results.push("revoke invite through UI");
  console.log("PASS admin revoked invitation; refreshed pending list excludes it");

  assert.deepEqual(externalRequests, [], "browser must not contact a production Firebase endpoint");
  const inviteErrors = consoleMessages.filter((message) =>
    /INVITE_ROLE_NOT_ALLOWED|InvitesService.*(?:Failed|permission-denied|missing or insufficient permissions)/i.test(message)
  );
  assert.deepEqual(inviteErrors, [], "invite flow must not produce permission or role errors");
  const unrelatedPermissionErrors = consoleMessages.filter((message) =>
    /permission-denied|missing or insufficient permissions/i.test(message)
  );
  if (unrelatedPermissionErrors.length > 0) {
    console.warn("UNRELATED application permission errors:", unrelatedPermissionErrors.join("\n"));
  }
  writeFileSync(
    path.join(outputDir, "results.json"),
    JSON.stringify({ project: PROJECT_ID, tests: results }, null, 2)
  );
  writeFileSync(path.join(outputDir, "console.log"), consoleMessages.join("\n"));
  console.log("PASS no external Firebase requests or invite authorization errors");
  console.log(`RESULT ${results.length}/${results.length} browser scenarios passed`);
} catch (error) {
  console.error(
    "INVITES ADMIN BROWSER E2E FAILED:",
    error instanceof Error ? error.message : String(error)
  );
  console.error("Browser console tail:", consoleMessages.slice(-15).join("\n") || "(empty)");
  console.error("Browser network tail:", networkEvents.slice(-30).join("\n") || "(empty)");
  console.error("Vite output tail:", viteMessages.slice(-15).join("").slice(-3000) || "(empty)");
  try {
    console.error("Browser page state:", JSON.stringify(await evaluate(`({
      url: window.location.href,
      readyState: document.readyState,
      body: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 500)
    })`)));
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    if (screenshot.result?.data) {
      writeFileSync(
        path.join(outputDir, "failure.png"),
        Buffer.from(screenshot.result.data, "base64")
      );
    }
  } catch {}
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { browser?.kill(); } catch {}
  try { vite?.kill(); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
  try { rmSync(buildDir, { recursive: true, force: true }); } catch {}
}
