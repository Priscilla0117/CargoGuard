import { env } from "cloudflare:workers";
export function runtimeBindings() {
  return env as unknown as { DB: D1Database; BUCKET: R2Bucket };
}
