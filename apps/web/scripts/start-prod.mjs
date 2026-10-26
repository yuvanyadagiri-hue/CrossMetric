// Serves the production build in .next-build (see `NEXT_DIST_DIR=.next-build next build`)
// on port 3300, for measuring real performance next to a dev server.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = path.resolve(web, "..", "..", "node_modules", "next", "dist", "bin", "next");
const port = process.env.PORT || "3300";
const child = spawn(process.execPath, [next, "start", "-p", port], { cwd: web, stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-build" } });
child.on("exit", (code) => process.exit(code ?? 0));
