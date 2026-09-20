import fs from "node:fs/promises";
import "./load-env.mjs";
import { nodeClient } from "../lib/runtime-node";
const client = nodeClient();
try {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS cargo_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const name of (await fs.readdir("drizzle"))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort()) {
    const tx = await client.transaction("write");
    try {
      if (
        !(
          await tx.execute({
            sql: "SELECT name FROM cargo_migrations WHERE name=?",
            args: [name],
          })
        ).rows.length
      ) {
        await tx.executeMultiple(await fs.readFile(`drizzle/${name}`, "utf8"));
        await tx.execute({
          sql: "INSERT INTO cargo_migrations(name,applied_at) VALUES(?,?)",
          args: [name, new Date().toISOString()],
        });
      }
      await tx.commit();
      console.log(`Schema ready: ${name}`);
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }
} finally {
  client.close();
}
