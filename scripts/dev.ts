import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const VITE_PORT = 5173;
const PAGES_PORT = 8788;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wranglerDirectory = join(projectRoot, ".wrangler");
await mkdir(wranglerDirectory, { recursive: true });
const workspace = await mkdtemp(join(wranglerDirectory, "vite-proxy-"));
const vite = await createServer({
  server: { host: "127.0.0.1", port: VITE_PORT, strictPort: true },
});
try {
  const configuration = await readFile(join(projectRoot, "wrangler.toml"), "utf8");
  await writeFile(
    join(workspace, "wrangler.toml"),
    configuration.replace(/^pages_build_output_dir\s*=.*\r?\n/m, ""),
  );
  await symlink(join(projectRoot, "functions"), join(workspace, "functions"), "dir");
  await symlink(join(projectRoot, ".dev.vars"), join(workspace, ".dev.vars"));
  await vite.listen();
  const wrangler = spawn(
    process.execPath,
    [
      join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
      "pages",
      "dev",
      "--port",
      String(PAGES_PORT),
      "--proxy",
      String(VITE_PORT),
    ],
    { cwd: workspace, stdio: "inherit" },
  );
  const stop = (signal: NodeJS.Signals) => {
    wrangler.kill(signal);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await new Promise<number>((resolve, reject) => {
      wrangler.once("error", reject);
      wrangler.once("exit", (exitCode, signal) => {
        resolve(exitCode ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1));
      });
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
} finally {
  await vite.close();
  await rm(workspace, { recursive: true, force: true });
}
