import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { outlookManifest } from "../lib/microsoft-manifest";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const origin = value("--origin") ?? process.env.CARGO_PUBLIC_ORIGIN;
const id = value("--id") ?? process.env.CARGO_MS_ADDIN_ID;
if (!origin || !id)
  throw new Error(
    "Provide --origin https://your-host and --id <stable-addin-guid>. No tenant is created by this script.",
  );
const output = resolve(value("--output") ?? "work/outlook-manifest.xml");
const template = await readFile(
  new URL("../public/outlook/manifest.template.xml", import.meta.url),
  "utf8",
);
const manifest = outlookManifest(template, origin, id);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, manifest, "utf8");
console.log(
  `Wrote ${output}. Validate and sideload with your Microsoft administrator; this does not deploy or connect a mailbox.`,
);
