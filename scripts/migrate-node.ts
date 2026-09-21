import fs from "node:fs/promises";
import "./load-env.mjs";
import { nodeClient } from "../lib/runtime-node";
import { migrateNode } from "../lib/migrations-node";
const client = nodeClient();
try {
  const migrations = [];
  for (const name of (await fs.readdir("drizzle"))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()) {
    migrations.push({
      name,
      sql: await fs.readFile(`drizzle/${name}`, "utf8"),
    });
  }
  await migrateNode(client, migrations, (name) =>
    console.log(`Schema ready: ${name}`),
  );
} catch {
  // Driver errors can embed request details: never print credentials or SQL data.
  console.error(
    "Database startup check failed. Check database availability and retry; no local-storage fallback is used.",
  );
  process.exitCode = 1;
} finally {
  client.close();
}
