import { env } from "cloudflare:workers";
export function runtimeBindings() {
  return env as unknown as { DB: D1Database; BUCKET: R2Bucket };
}
export async function databaseReady() {
  await runtimeBindings()
    .DB.prepare("SELECT version FROM result_revisions LIMIT 1")
    .all();
}
