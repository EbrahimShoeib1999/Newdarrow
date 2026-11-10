import { spawn } from "node:child_process";

const scriptToRun = process.argv[2] || "scripts/test-firestore-rules.mjs";
const project = process.argv[3] || "test-suite";
const emulators = process.argv[4] || "firestore";
const firebaseCmd = "C:\\Users\\ibrah\\AppData\\Local\\npm-cache\\_npx\\a2c365da195827f4\\node_modules\\.bin\\firebase.cmd";
const cmd = `"${firebaseCmd}" emulators:exec --only ${emulators} --project ${project} "node ${scriptToRun}"`;

console.log(`Starting emulator (${emulators}) test: ${scriptToRun}`);
const child = spawn(cmd, { stdio: "inherit", shell: true });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
