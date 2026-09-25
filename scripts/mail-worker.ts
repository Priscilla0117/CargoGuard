import "./load-env.mjs";
import { runtimeBindings } from "../lib/runtime-node";
import { mailConfiguration } from "../lib/mail-connector";
import { mailWorkerEnabled } from "../lib/mail-worker-config";
import { runMailWorkerLoop } from "../lib/mail-worker";

if (!mailWorkerEnabled()) {
  console.error(
    "Background intake requires team access and CARGO_MAIL_WORKER_ENABLED=true.",
  );
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("disconnect", stop);
  process.on("message", (message: { type?: string }) => {
    if (message?.type === "shutdown") stop();
  });
  try {
    await runMailWorkerLoop({
      db: runtimeBindings().DB,
      configuration: mailConfiguration,
      signal: controller.signal,
      diagnostic: (code) => console.error(code),
    });
  } finally {
    // The IPC message listener otherwise keeps a stopped worker alive until
    // its supervisor force-kills it at the shutdown deadline.
    if (process.connected) process.disconnect();
  }
}
