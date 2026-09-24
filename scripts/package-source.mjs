import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync } from "fflate";

// Export the working source, not Git history or local hosting credentials.
// The original checkout and earlier release artifacts are never modified.
const root = fileURLToPath(new URL("../", import.meta.url));
const allowedRoots = new Set([
  ".github",
  "app",
  "build",
  "components",
  "data",
  "db",
  "docs",
  "drizzle",
  "examples",
  "hooks",
  "lib",
  "public",
  "scripts",
  "tests",
  "vendor",
]);
const allowedFiles = new Set([
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  "README.md",
  "cloudflare-env.d.ts",
  "components.json",
  "drizzle.config.ts",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "render.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "wrangler.local.json",
]);
// These unused checkout scaffolds were deliberately absent from the published
// repository. Do not reintroduce mock identity, private publishing helpers or
// presentation preparation through a broad source-directory allowlist.
const excludedFiles = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "app/chatgpt-auth.ts",
  "build/sites-vite-plugin.ts",
  "db/index.ts",
  "scripts/install-pnpm.sh",
  "scripts/pnpm-install.mjs",
  "scripts/private-release-runner.mjs",
  "docs/DEMO_SCRIPT.md",
  "docs/REQUIREMENT_PROOF_CHECKLIST.md",
  "GITHUB_UPLOAD.md",
  "SOURCE_MANIFEST.json",
]);
const candidates = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean),
  ),
].sort();
const excluded = [],
  files = {},
  manifest = [];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const name of candidates) {
  const parts = name.split("/");
  const forbidden =
    parts.some((p) =>
      [
        ".git",
        ".openai",
        ".sites-runtime",
        ".agents",
        ".codex",
        ".wrangler",
        "node_modules",
        "work",
        ".next",
        "dist",
        ".vinext",
      ].includes(p),
    ) ||
    /(^|\/)\.env(?!\.example$)/.test(name) ||
    /\.(?:db|db-wal|db-shm|pem|key)$/i.test(name) ||
    /(^|\/)(?:ground_truth|submission)\.json$/i.test(name) ||
    name.startsWith("public/ocr/") ||
    name.startsWith("examples/d1/") ||
    /^(?:private-preparation|submission-prep|recordings|pitch-drafts)\//.test(
      name,
    ) ||
    /^docs\/RECORDING_.*\.md$/i.test(name) ||
    excludedFiles.has(name);
  if (forbidden || !(allowedFiles.has(name) || allowedRoots.has(parts[0]))) {
    excluded.push(name);
    continue;
  }
  const absolute = path.resolve(root, name);
  if (!absolute.startsWith(root) || parts.includes(".."))
    throw new Error(`Unsafe path: ${name}`);
  const info = await fs.lstat(absolute).catch((error) => {
    if (error.code === "ENOENT") return null; // A tracked, intentionally removed file.
    throw error;
  });
  if (!info) continue;
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Non-regular source: ${name}`);
  const bytes = await fs.readFile(absolute);
  // A narrow fail-closed check; not a substitute for reviewing a repository.
  const content = bytes.toString("utf8");
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(
      content,
    )
  ) {
    throw new Error(
      `Potential credential in ${name}; release stopped without printing it.`,
    );
  }
  files[name] = new Uint8Array(bytes);
  manifest.push({ path: name, bytes: bytes.byteLength, sha256: digest(bytes) });
}
for (const required of [
  "render.yaml",
  "package.json",
  "package-lock.json",
  "data/bundle.json",
  "lib/runtime-node.ts",
  "scripts/start-node.mjs",
])
  if (!files[required])
    throw new Error(`Missing required deployment file: ${required}`);
const archive = zipSync(files, { level: 6 });
const restored = unzipSync(archive);
if (
  Object.keys(restored).length !== manifest.length ||
  manifest.some((f) => digest(restored[f.path]) !== f.sha256)
)
  throw new Error("ZIP round-trip verification failed.");
const releaseDir = path.join(root, "work", "releases");
await fs.mkdir(releaseDir, { recursive: true });
const version = JSON.parse(
  Buffer.from(files["package.json"]).toString("utf8"),
).version;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stem = `CargoGuard-${version}-Source-${stamp}`;
const archivePath = path.join(releaseDir, `${stem}.zip`);
await fs.writeFile(archivePath, archive, { flag: "wx" });
await fs.writeFile(
  path.join(releaseDir, `${stem}.manifest.json`),
  JSON.stringify(
    {
      created_at: new Date().toISOString(),
      version,
      files: manifest,
      archive_sha256: digest(archive),
      excluded,
      checks:
        "Allowlisted source; no Git history/local hosting metadata; narrow credential scan; verified ZIP round-trip hashes. Not published or deployed.",
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    {
      archive: archivePath,
      files: manifest.length,
      bytes: archive.byteLength,
      sha256: digest(archive),
      excluded,
    },
    null,
    2,
  ),
);
