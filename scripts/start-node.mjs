import { spawnSync, spawn } from "node:child_process";
import "./load-env.mjs";
const migration = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate-node.ts"],
  {
    stdio: "inherit",
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
  { stdio: "inherit", windowsHide: true },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
