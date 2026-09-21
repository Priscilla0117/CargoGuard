import type { Client } from "@libsql/client";

export async function migrateNode(
  client: Client,
  migrations: { name: string; sql: string }[],
  report: (name: string) => void = () => {},
) {
  const exists = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='cargo_migrations'",
  );
  if (!exists.rows.length) {
    await client.execute(
      "CREATE TABLE IF NOT EXISTS cargo_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
  }
  const applied = new Set(
    (await client.execute("SELECT name FROM cargo_migrations")).rows.map(
      (row) => row.name,
    ),
  );
  for (const { name, sql } of migrations) {
    // Normal restart is read-only: no write transaction for an existing migration.
    if (applied.has(name)) {
      report(name);
      continue;
    }
    const tx = await client.transaction("write");
    try {
      // Recheck inside the write transaction for concurrent deployment starts.
      if (
        !(
          await tx.execute({
            sql: "SELECT name FROM cargo_migrations WHERE name=?",
            args: [name],
          })
        ).rows.length
      ) {
        await tx.executeMultiple(sql);
        await tx.execute({
          sql: "INSERT INTO cargo_migrations(name,applied_at) VALUES(?,?)",
          args: [name, new Date().toISOString()],
        });
      }
      await tx.commit();
      report(name);
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    } finally {
      tx.close();
    }
  }
}
