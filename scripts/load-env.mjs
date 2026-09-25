import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// Host-injected variables take precedence; local secrets never enter source.
for (const name of [".env.local", ".env"]) {
  const path = join(projectRoot, name);
  if (existsSync(path)) process.loadEnvFile(path);
}
