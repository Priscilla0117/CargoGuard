/** Read a short-lived credential without terminal echo or writing it to disk.
 * Only for owner-authorized private Sites publishing / isolated synthetic tests. */
import { spawn } from "node:child_process";
const [mode, origin] = process.argv.slice(2);
if (!["push", "hosted-tests"].includes(mode))
  throw new Error("Expected push or hosted-tests mode.");
if (!process.stdin.isTTY)
  throw new Error(
    "Use an interactive terminal so credential echo can be disabled.",
  );
process.stdin.setRawMode(true);
process.stdout.write(
  "Ready for short-lived credential (input is not echoed).\n",
);
const secret = await new Promise((resolve, reject) => {
  let input = "";
  const receive = (chunk) => {
    input += chunk.toString();
    if (input.includes("\u0003")) {
      process.stdin.removeListener("data", receive);
      reject(new Error("Cancelled"));
    } else if (/[\r\n]/.test(input)) {
      process.stdin.removeListener("data", receive);
      resolve(input.trim());
    } else if (input.length > 32000) {
      process.stdin.removeListener("data", receive);
      reject(new Error("Credential input too long"));
    }
  };
  process.stdin.on("data", receive);
  process.stdin.resume();
}).finally(() => {
  process.stdin.setRawMode(false);
  process.stdin.pause();
});
if (!secret) throw new Error("Empty credential.");
const run = (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${code})`)),
    );
  });
if (mode === "push") {
  if (
    !origin ||
    new URL(origin).protocol !== "https:" ||
    new URL(origin).hostname !== "git.chatgpt-team.site"
  )
    throw new Error("Use the verified private Sites repository URL.");
  await run(
    "git",
    [
      "-c",
      `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
      "-c",
      "credential.helper=",
      "push",
      origin,
      "HEAD:main",
    ],
    {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${secret}`,
    },
  );
} else {
  if (origin !== "https://cargoguard-averis-workbench.ngernchi.chatgpt.site")
    throw new Error("Unexpected test destination.");
  await run(process.execPath, ["scripts/test-hardening-api.mjs", origin], {
    CARGO_SITE_AUTH: secret,
  });
  await run(process.execPath, ["scripts/test-api.mjs", origin], {
    CARGO_SITE_AUTH: secret,
  });
}
console.log("Authorized operation completed. Credential was not stored.");
