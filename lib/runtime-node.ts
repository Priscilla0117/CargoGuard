import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
} from "@libsql/client";
import { HttpError } from "./http";
import { databaseFetch } from "./database-fetch";

// Implement only the small storage API CargoGuard uses. Multi-statement writes
// remain one SQLite/libSQL transaction, including CAS, revision and event.
export function createNodeBindings(client: Client) {
  const resultOf = (r: ResultSet) => ({
    results: r.rows.map((row) => ({ ...row })),
    success: true,
    meta: { changes: r.rowsAffected },
  });
  class Statement {
    constructor(
      readonly sql: string,
      readonly args: InValue[] = [],
    ) {}
    bind(...args: InValue[]) {
      return new Statement(this.sql, args);
    }
    async all() {
      return resultOf(await client.execute({ sql: this.sql, args: this.args }));
    }
    async first(column?: string) {
      const r = await this.all();
      const row = r.results[0];
      return row ? (column ? row[column] : row) : null;
    }
    async run() {
      return this.all();
    }
  }
  const DB = {
    prepare(sql: string) {
      return new Statement(sql);
    },
    async batch(statements: Statement[]) {
      return (
        await client.batch(
          statements.map((s) => ({ sql: s.sql, args: s.args })),
          "write",
        )
      ).map(resultOf);
    },
  };
  const BUCKET = {
    async put(key: string, bytes: Uint8Array) {
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new HttpError("Each file must be 5 MB or smaller.", 413);
      const r = await client.execute({
        sql: `INSERT INTO attachment_blobs(object_key,bytes,size) SELECT ?,?,?
        WHERE COALESCE((SELECT SUM(size) FROM attachment_blobs),0)+?<=268435456`,
        args: [key, bytes, bytes.byteLength, bytes.byteLength],
      });
      if (r.rowsAffected !== 1)
        throw new HttpError(
          "The demo's 256 MB upload storage limit has been reached. Existing evidence is retained.",
          429,
        );
      return null;
    },
    async get(key: string) {
      const r = await client.execute({
        sql: "SELECT bytes FROM attachment_blobs WHERE object_key=?",
        args: [key],
      });
      if (!r.rows[0]) return null;
      const bytes = r.rows[0].bytes;
      if (!(bytes instanceof ArrayBuffer))
        throw new Error("Invalid attachment storage format");
      return {
        async arrayBuffer() {
          return bytes.slice(0);
        },
      };
    },
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.length)
        await client.batch(
          list.map((key) => ({
            sql: "DELETE FROM attachment_blobs WHERE object_key=?",
            args: [key],
          })),
          "write",
        );
    },
  };
  return {
    DB: DB as unknown as D1Database,
    BUCKET: BUCKET as unknown as R2Bucket,
  };
}
export function nodeClient(timeoutMs = 15000) {
  const url = process.env.TURSO_DATABASE_URL;
  if (url && !/^(libsql|https):\/\//.test(url))
    throw new Error("Cloud database URL must use libsql:// or https://.");
  if (!url && (!process.env.CARGO_LOCAL_DB || process.env.RENDER))
    throw new Error(
      "Configure a persistent Turso libSQL database. Cloud deployment cannot use temporary local storage.",
    );
  if (url && !process.env.TURSO_AUTH_TOKEN)
    throw new Error("Database authentication is missing.");
  return createClient({
    url: url ?? `file:${process.env.CARGO_LOCAL_DB}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
    intMode: "number",
    ...(url ? { fetch: databaseFetch(timeoutMs), concurrency: 8 } : {}),
  });
}
/** Independent short connection: health checks cannot queue behind user writes. */
export async function databaseReady() {
  const client = nodeClient(2000);
  try {
    await client.execute("SELECT version FROM result_revisions LIMIT 1");
  } finally {
    client.close();
  }
}
let bindings: ReturnType<typeof createNodeBindings> | undefined;
export function runtimeBindings() {
  return (bindings ??= createNodeBindings(nodeClient()));
}
