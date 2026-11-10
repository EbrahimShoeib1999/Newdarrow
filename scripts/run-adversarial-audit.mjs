import { spawn } from "node:child_process";

const firebaseCmd = "C:\\Users\\ibrah\\AppData\\Local\\npm-cache\\_npx\\a2c365da195827f4\\node_modules\\.bin\\firebase.cmd";
const cmd = `"${firebaseCmd}" emulators:exec --only firestore --project adversarial-audit-v2 "node scripts/test-adversarial-security-v2.mjs"`;

const child = spawn(cmd, { stdio: "inherit", shell: true });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
