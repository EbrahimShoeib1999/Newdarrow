// Minimal repro: does CDP geolocation override + permission grant make
// navigator.geolocation.getCurrentPosition resolve in headless Edge?
// Isolates the check-in hang (attendance.store → captureAttendanceGeo)
// from the rest of the app.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDir = path.join(os.tmpdir(), `edge_geo_${Date.now()}`);
const CDP_PORT = 9889;

const edgeProc = spawn(edgePath, [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profileDir}`,
  "about:blank",
]);

let target = null;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
    if (res.ok) {
      const pages = await res.json();
      target = pages.find((p) => p.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    }
  } catch {}
}
if (!target) { console.log("NO TARGET"); edgeProc.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let msgId = 1;
const pending = new Map();
ws.onmessage = (evt) => {
  const data = JSON.parse(evt.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
};
const send = (method, params = {}) =>
  new Promise((resolve) => { const id = msgId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const evalAwait = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return res?.result?.result?.value ?? res?.result;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Browser.grantPermissions", { origin: "http://localhost:5175", permissions: ["geolocation"] });
await send("Emulation.setGeolocationOverride", { latitude: 24.7136, longitude: 46.6753, accuracy: 15 });

// Navigate to a real origin (about:blank has no permission context) — use the vite port page even if 404-ish; geolocation needs a secure/localhost origin.
await send("Page.navigate", { url: "http://localhost:5175/" });
await new Promise((r) => setTimeout(r, 2500));

const t0 = Date.now();
const outcome = await evalAwait(`new Promise((res) => {
  let done = false;
  const finish = (v) => { if (!done) { done = true; res(v); } };
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => finish("OK:" + p.coords.latitude + "," + p.coords.longitude),
      (e) => finish("ERR:" + e.code + ":" + e.message),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  } catch (e) { finish("THROW:" + e.message); }
  setTimeout(() => finish("HUNG (no callback in 12s)"), 12000);
})`);
console.log(`geolocation outcome after ${Date.now() - t0}ms =>`, outcome);

try { ws.close(); } catch {}
try { edgeProc.kill(); } catch {}
process.exit(0);
