import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const chromePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const userDataDir = mkdtempSync(path.join(tmpdir(), 'edge-crm-live-session-'));
const port = 9334;

console.log(`[BROWSER SUPERVISOR] Launching headed Edge browser on port ${port}...`);
console.log(`[BROWSER SUPERVISOR] Profile directory: ${userDataDir}`);

const browser = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,920',
  'http://localhost:5173/login',
], { stdio: 'inherit' });

browser.on('exit', (code) => {
  console.log(`[BROWSER] Browser exited with code ${code}`);
  process.exit(code ?? 0);
});

async function pollCDP() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const data = await res.json();
        console.log(`[BROWSER READY] Connected to: ${data.Browser}`);
        console.log(`[BROWSER READY] Visible browser open at http://localhost:5173/login`);
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
}

pollCDP();

// Keep supervisor alive indefinitely
setInterval(() => {}, 60000);
