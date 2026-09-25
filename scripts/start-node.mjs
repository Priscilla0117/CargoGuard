import { spawnSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./load-env.mjs";
// Relative database paths and Next assets always belong to this checkout.
process.chdir(projectRoot);
if (!existsSync(join(projectRoot, ".next", "BUILD_ID"))) {
  console.error(
    "Production build is missing. Run npm ci and npm run build before npm start.",
  );
  process.exit(1);
}
const migration = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate-node.ts"],
  {
    stdio: "inherit",
    cwd: projectRoot,
    windowsHide: true,
    timeout: 60000,
    killSignal: "SIGKILL",
  },
);
if (migration.error) {
  console.error(
    "Database startup did not complete within its bounded check. Exiting so the host can recover; saved data is unchanged.",
  );
}
if (migration.status !== 0) process.exit(migration.status ?? 1);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    process.env.HOST ?? "0.0.0.0",
    "--port",
    process.env.PORT ?? "3000",
  ],
  { stdio: "inherit", windowsHide: true, cwd: projectRoot },
);
const worker =
  process.env.CARGO_AUTH_MODE === "team" &&
  process.env.CARGO_MAIL_WORKER_ENABLED === "true"
    ? spawn(process.execPath, ["--import", "tsx", "scripts/mail-worker.ts"], {
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        windowsHide: true,
        cwd: projectRoot,
      })
    : null;
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill("SIGTERM");
  if (worker?.connected) worker.send({ type: "shutdown" }, () => {});
  else worker?.kill("SIGTERM");
  const deadline = setTimeout(() => {
    child.kill("SIGKILL");
    worker?.kill("SIGKILL");
  }, 10000);
  deadline.unref();
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, shutdown);
// A local acceptance runner can close the exact child it started on Windows,
// where terminating the wrapper would otherwise leave Next orphaned.
process.on("message", (message) => {
  if (message?.type === "shutdown") shutdown();
});
process.on("disconnect", shutdown);
child.on("error", () => {
  console.error(
    "The web server could not start. Check the Node installation and production build.",
  );
  process.exitCode = 1;
  shutdown();
  if (process.connected) process.disconnect();
});
child.on("exit", (code) => {
  const expected = shuttingDown;
  shutdown();
  process.exitCode = expected ? (process.exitCode ?? 0) : (code ?? 1);
  if (process.connected) process.disconnect();
});
worker?.on("error", () => {
  console.error(
    "Background email intake could not start. Restarting the service is required.",
  );
  process.exitCode = 1;
  shutdown();
});
worker?.on("exit", () => {
  if (!shuttingDown) {
    console.error(
      "Background email intake stopped unexpectedly. Restarting the service is required.",
    );
    process.exitCode = 1;
    shutdown();
  }
});
