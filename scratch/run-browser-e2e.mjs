// Runs the projects browser E2E under the auth+firestore emulators, piping
// all output to tmp/e2e-extended.log (PowerShell quoting around the nested
// emulators:exec command is fragile, so we build argv here instead).
import { spawn } from "node:child_process";
import { createWriteStream, appendFileSync, existsSync } from "node:fs";

const LOG = "tmp/e2e-extended.log";
const out = createWriteStream(LOG);
const args = [
  "-y", "firebase-tools@13.35.1", "emulators:exec",
  "--only", "auth,firestore",
  "--project", "test-projects-lifecycle",
  "npx tsx scripts/test-projects-lifecycle-browser.mjs",
];
process.on("uncaughtException", (e) => {
  appendFileSync(LOG, `[RUNNER UNCAUGHT] ${e?.stack || e}\n`);
});
appendFileSync(LOG, `[RUNNER START] ${new Date().toISOString()} args=${args.join(" ")}\n`);
const child = spawn("npx", args, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
appendFileSync(LOG, `[RUNNER SPAWNED] pid=${child.pid}\n`);
child.stdout?.pipe(out);
child.stderr?.pipe(out);
child.on("error", (e) => appendFileSync(LOG, `[RUNNER SPAWN ERROR] ${e?.message}\n`));
child.on("exit", (code) => {
  appendFileSync(LOG, `\n[RUNNER EXIT CODE] ${code}\n`);
  out.end();
});
