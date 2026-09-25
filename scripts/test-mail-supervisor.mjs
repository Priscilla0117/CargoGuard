// Local acceptance of the actual production supervisor. Never uses a user DB,
// connected mailbox or external AI. Run after npm run build.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";

const root = fileURLToPath(new URL("../", import.meta.url));
await fs.access(path.join(root, ".next", "BUILD_ID")).catch(() => {
  throw new Error(
    "Build the application before running the local supervisor acceptance check.",
  );
});
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "cargoguard-supervisor-"),
);
const database = path.join(temporary, "isolated.db").replaceAll("\\", "/");
const pidLog = path.join(temporary, "children.jsonl");
const networkLog = path.join(temporary, "blocked-network.jsonl");
const exitLog = path.join(temporary, "exits.jsonl");
const guard = path.join(temporary, "local-only.cjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(true)); // Timeout is not proof of closure.
  });
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
async function observedChildren() {
  const lines = await fs.readFile(pidLog, "utf8").catch(() => "");
  return lines
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
async function waitFor(probe, message, timeout = 45000) {
  const until = Date.now() + timeout;
  do {
    if (await probe()) return;
    await delay(150);
  } while (Date.now() < until);
  throw new Error(message);
}

let supervisor, db;
let supervisorError;
let output = "";
let exit;
let port;
let report;
try {
  // Loaded by wrapper, migration, Next and worker. It records only process IDs
  // and script paths and rejects external sockets before DNS/network access.
  await fs.writeFile(
    guard,
    `
const fs = require("node:fs");
const net = require("node:net");
process.loadEnvFile = () => {};
fs.appendFileSync(process.env.CARGO_SUPERVISOR_PID_LOG, JSON.stringify({ pid: process.pid, args: process.argv.slice(1) }) + "\\n");
process.once("exit", (code) => fs.appendFileSync(process.env.CARGO_SUPERVISOR_EXIT_LOG, JSON.stringify({ pid: process.pid, code }) + "\\n"));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const parameters = Array.isArray(args[0]) ? args[0] : args;
  const first = parameters[0];
  const host = typeof first === "object" && first !== null ? first.host : typeof parameters[1] === "string" ? parameters[1] : "localhost";
  const pipe = typeof first === "string" || (typeof first === "object" && first !== null && first.path);
  const pipePath = pipe ? (typeof first === "string" ? first : first.path) : "";
  const pipePrefix = pipePath.split(String.fromCharCode(92)).filter(Boolean).slice(0, 2).join("/");
  const localPipe = process.platform === "win32" ? ["?/pipe", "./pipe"].includes(pipePrefix) : pipePath.startsWith("/");
  if ((pipe && !localPipe) || (!pipe && ![undefined, "localhost", "127.0.0.1", "::1"].includes(host))) {
    fs.appendFileSync(process.env.CARGO_SUPERVISOR_NETWORK_LOG, JSON.stringify({ pid: process.pid, blocked: true, type: pipe ? "pipe" : "tcp", destination: pipe ? (typeof first === "string" ? first : first.path) : host }) + "\\n");
    throw new Error("External networking is disabled in supervisor acceptance");
  }
  return connect.apply(this, args);
};
`,
  );
  port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // Only OS/runtime necessities are inherited. Next's own dotenv loader sees
  // explicit empty values for names in local env files and cannot restore keys.
  const environment = {};
  for (const [key, value] of Object.entries(process.env))
    if (
      /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|LANG|LC_ALL)$/i.test(
        key,
      )
    )
      environment[key] = value;
  for (const name of [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ])
    for (const match of (
      await fs.readFile(path.join(root, name), "utf8").catch(() => "")
    ).matchAll(/^(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)\s*=/gm))
      environment[match[1]] ??= "";
  Object.assign(environment, {
    NODE_ENV: "production",
    NODE_OPTIONS: `--require "${guard.replaceAll("\\", "/")}"`,
    NEXT_TELEMETRY_DISABLED: "1",
    HOST: "127.0.0.1",
    PORT: String(port),
    RENDER: "",
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    CARGO_LOCAL_DB: database,
    CARGO_AUTH_MODE: "team",
    CARGO_PUBLIC_ORIGIN: origin,
    CARGO_INCLUDE_SAMPLE_DATA: "false",
    CARGO_MAX_WORKSPACE_UPLOADS: "30",
    CARGO_BOOTSTRAP_SECRET: randomBytes(32).toString("hex"),
    CARGO_MAIL_WORKER_ENABLED: "true",
    CARGO_MAIL_TOKEN_KEY: "invalid-local-test-key",
    CARGO_MAIL_IMAP_ENABLED: "false",
    CARGO_MAIL_ALLOW_SEND: "false",
    CARGO_GOOGLE_CLIENT_ID: "",
    CARGO_GOOGLE_CLIENT_SECRET: "",
    CARGO_MAIL_IMAP_HOST: "",
    CARGO_MAIL_SMTP_HOST: "",
    CARGO_MS_ALLOW_SEND: "false",
    CARGO_MS_ALERTS_ENABLED: "false",
    CARGO_MS_TOKEN_KEY: "",
    CARGO_MS_CLIENT_ID: "",
    CARGO_MS_CLIENT_SECRET: "",
    CARGO_AI_PROVIDER: "off",
    CARGO_AI_API_KEY: "",
    CARGO_REPLY_AI_PROVIDER: "off",
    CARGO_REPLY_AI_API_KEY: "",
    CARGO_COPILOT_UNDERSTAND: "off",
    OPENAI_API_KEY: "",
    CARGO_SUPERVISOR_PID_LOG: pidLog,
    CARGO_SUPERVISOR_NETWORK_LOG: networkLog,
    CARGO_SUPERVISOR_EXIT_LOG: exitLog,
  });
  const startedAt = Date.now();
  supervisor = fork(path.join(root, "scripts", "start-node.mjs"), [], {
    cwd: root,
    env: environment,
    execArgv: [],
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  supervisor.once("error", (error) => {
    supervisorError = error;
  });
  supervisor.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  for (const stream of [supervisor.stdout, supervisor.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-12000);
    });
  await waitFor(async () => {
    if (supervisorError) throw supervisorError;
    if (exit) throw new Error("Supervisor exited before HTTP readiness");
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      return response.ok && (await response.json()).status === "ready";
    } catch {
      return false;
    }
  }, "HTTP readiness did not succeed");
  db = new DatabaseSync(database, { readOnly: true });
  db.exec("PRAGMA busy_timeout=2000");
  let heartbeat;
  await waitFor(async () => {
    if (exit) throw new Error("Supervisor exited before the worker heartbeat");
    heartbeat = db
      .prepare(
        "SELECT state,heartbeat_at FROM mail_worker_state WHERE singleton=1",
      )
      .get();
    return (
      heartbeat?.state === "waiting_for_setup" &&
      Date.parse(heartbeat.heartbeat_at) >= startedAt
    );
  }, "Worker did not publish its waiting-for-setup heartbeat");
  for (const table of ["mail_connections", "mail_imports", "mail_operations"])
    assert.equal(
      Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n),
      0,
      `Isolated ${table} must remain empty`,
    );
  const children = await observedChildren();
  assert.ok(
    children.some((child) => child.args.some((arg) => /[\\/]next$/.test(arg))),
    "Actual Next server was not observed",
  );
  assert.ok(
    children.some((child) =>
      child.args.some((arg) => /mail-worker\.ts$/.test(arg)),
    ),
    "Actual mail worker was not observed",
  );
  assert.equal(
    await fs.readFile(networkLog, "utf8").catch(() => ""),
    "",
    "An external connection was attempted",
  );
  supervisor.send({ type: "shutdown" });
  await waitFor(
    () => !!exit,
    "Supervisor did not exit after IPC shutdown",
    15000,
  );
  assert.equal(exit.code, 0, "Supervisor shutdown must succeed");
  assert.equal(exit.signal, null, "Supervisor must exit normally");
  assert.equal(
    db.prepare("SELECT state FROM mail_worker_state WHERE singleton=1").get()
      ?.state,
    "stopped",
    "Worker must persist graceful shutdown",
  );
  await waitFor(
    async () => !(await portOpen(port)),
    "Next left the listening port open",
    3000,
  );
  const observed = await observedChildren();
  await waitFor(
    () => observed.every((child) => !alive(child.pid)),
    "A supervised child remains alive",
    3000,
  );
  const exits = (await fs.readFile(exitLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const worker = children.find((child) =>
    child.args.some((arg) => /mail-worker\.ts$/.test(arg)),
  );
  assert.ok(
    exits.some((entry) => entry.pid === worker.pid && entry.code === 0),
    "Worker was terminated instead of exiting normally after shutdown",
  );
  report = {
    passed: true,
    scope: "Local supervisor lifecycle; no live mailbox or AI calls",
    http_ready: true,
    worker_state_before_shutdown: heartbeat.state,
    worker_state_after_shutdown: "stopped",
    clean_exit: true,
    worker_clean_exit: true,
    port_closed: true,
    orphan_children: 0,
  };
} catch (error) {
  console.error(
    `Supervisor acceptance failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  if (supervisor && !exit) {
    if (supervisor.connected) supervisor.send({ type: "shutdown" }, () => {});
    await waitFor(() => !!exit, "cleanup timeout", 15000).catch(() => {});
  }
  // On a failed lifecycle check, terminate only PIDs recorded by our private
  // preload in this one invocation; never enumerate or kill unrelated servers.
  const cleanupPids = new Set(
    (await observedChildren()).map((child) => child.pid),
  );
  if (supervisor?.pid && !exit) cleanupPids.add(supervisor.pid);
  for (const pid of cleanupPids)
    if (alive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  db?.close();
  const resolved = await fs.realpath(temporary);
  const temporaryRoot = await fs.realpath(os.tmpdir());
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert.ok(path.basename(resolved).startsWith("cargoguard-supervisor-"));
  await fs.rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
if (report && !process.exitCode) console.log(JSON.stringify(report, null, 2));
