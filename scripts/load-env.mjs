import { existsSync } from "node:fs";
// Host-injected variables take precedence; local secrets never enter source.
for (const path of [".env.local", ".env"])
  if (existsSync(path)) process.loadEnvFile(path);
