// Minimal diagnostic: spawn Vite with the same env as the browser harness and
// fetch the entry HTML + main module to see whether the graph compiles.
import { spawn } from "node:child_process";

const VITE_PORT = 5178;
const viteProc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(VITE_PORT), "--strictPort"], {
  env: {
    ...process.env,
    VITE_USE_FIREBASE_EMULATOR: "true",
    VITE_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    VITE_FIREBASE_PROJECT_ID: "test-projects-lifecycle",
    VITE_FIREBASE_AUTH_EMULATOR_PORT: "9099",
    VITE_FIRESTORE_EMULATOR_PORT: "8080",
    VITE_FIREBASE_STORAGE_EMULATOR_PORT: "9199",
    VITE_DISABLE_EMAIL_DELIVERY: "true",
  },
  stdio: "pipe",
});
viteProc.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
viteProc.stderr.on("data", (d) => process.stdout.write(`[vite!] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = false;
for (let i = 0; i < 60 && !ok; i++) {
  await sleep(500);
  try { ok = (await fetch(`http://localhost:${VITE_PORT}/`)).ok; } catch {}
}
if (!ok) { console.log("VITE NEVER READY"); viteProc.kill(); process.exit(1); }

const html = await (await fetch(`http://localhost:${VITE_PORT}/login`)).text();
console.log("HTML length:", html.length);
console.log(html.slice(0, 1200));

// Fetch the entry module the way the browser would
for (const mod of ["/src/main.tsx", "/src/app/App.tsx", "/src/lib/firebase.ts"]) {
  const res = await fetch(`http://localhost:${VITE_PORT}${mod}`);
  const body = await res.text();
  console.log(`\n=== ${mod} -> ${res.status} (${body.length} bytes)`);
  if (!res.ok || body.includes("Error")) console.log(body.slice(0, 800));
}
viteProc.kill();
process.exit(0);
