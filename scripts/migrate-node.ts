import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Client } from "@libsql/client";
import { projectRoot } from "./load-env.mjs";
import { nodeClient } from "../lib/runtime-node";
import { migrateNode } from "../lib/migrations-node";
import {
  deploymentConfiguration,
  DeploymentConfigurationError,
  requireBootstrapConfiguration,
} from "../lib/deployment-config";
import { RUNTIME_SCHEMA_PROBE } from "../lib/runtime-schema";
let client: Client | undefined;
try {
  const config = deploymentConfiguration();
  if (!config.remote) {
    process.env.CARGO_LOCAL_DB = resolve(
      projectRoot,
      process.env.CARGO_LOCAL_DB!,
    ).replaceAll("\\", "/");
    await fs.mkdir(dirname(process.env.CARGO_LOCAL_DB), { recursive: true });
  }
  client = nodeClient();
  const migrations = [];
  for (const name of (await fs.readdir(join(projectRoot, "drizzle")))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()) {
    migrations.push({
      name,
      sql: await fs.readFile(join(projectRoot, "drizzle", name), "utf8"),
    });
  }
  await migrateNode(client, migrations, (name) =>
    console.log(`Schema ready: ${name}`),
  );
  await client.execute(RUNTIME_SCHEMA_PROBE);
  if (config.mode === "team") {
    const installed = await client.execute(
      "SELECT 1 FROM team_installation WHERE singleton=1",
    );
    requireBootstrapConfiguration(installed.rows.length > 0);
  }
  console.log(
    `Startup checks passed: ${config.mode} access; ${config.sample_data ? "synthetic samples enabled" : "imported records only"}.`,
  );
} catch (error) {
  // Driver errors can embed request details: never print credentials or SQL data.
  console.error(
    error instanceof DeploymentConfigurationError
      ? error.message
      : "Database startup check failed. Check database availability and retry; no local-storage fallback is used.",
  );
  process.exitCode = 1;
} finally {
  client?.close();
}
