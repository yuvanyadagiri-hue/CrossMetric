// Starts a second dev server on port 3100 with its own build folder, so it can
// run beside a regular `npm run dev` (port 3000) without sharing `.next`.
// Another port (PORT env) gets its own build folder, `.next-preview-<port>`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = path.resolve(web, "..", "..", "node_modules", "next", "dist", "bin", "next");
const port = process.env.PORT || "3100";
const child = spawn(process.execPath, [next, "dev", "-p", port], {
  cwd: web,
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: port === "3100" ? ".next-preview" : `.next-preview-${port}` },
});
child.on("exit", (code) => process.exit(code ?? 0));
