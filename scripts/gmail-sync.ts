import { setTimeout as delay } from "node:timers/promises";
import { requireGmailOwner, gmailConfig } from "../lib/gmail-config";
import { storage } from "../lib/storage";
import { syncGmail } from "../lib/gmail-storage";

// Optional explicit worker entry point. Deploy it with the same persistent DB,
// encryption key and ownership configuration as the web server. Never sends mail.
const config = gmailConfig();
requireGmailOwner(config.workspace);
const loop = process.argv.includes("--loop");
const interval =
  Math.max(60, Number(process.env.CARGO_GMAIL_SYNC_INTERVAL_SECONDS) || 120) *
  1000;
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  try {
    let more = true;
    // Bound each tick; the persisted cursor continues after the next tick/restart.
    for (let pages = 0; pages < 5 && more && !stopping; pages++) {
      const result = await syncGmail(storage().DB, config.workspace);
      more = result.more;
      console.log(
        JSON.stringify({
          event: "gmail_sync",
          imported: result.imported,
          more,
        }),
      );
    }
  } catch {
    console.error(
      "Gmail sync unavailable; cursor retained. Check connection configuration in the app.",
    );
    if (!loop) process.exitCode = 1;
  }
  if (loop && !stopping) await delay(interval);
} while (loop && !stopping);
