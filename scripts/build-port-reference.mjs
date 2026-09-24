// Builds the compact UN/LOCODE reference used by lib/port-reference.ts.
// Input: code-list.csv and country-codes.csv from https://github.com/datasets/un-locode
// (a public-domain ODC-PDDL-1.0 packaging of the UNECE UN/LOCODE release).
// Usage: node scripts/build-port-reference.mjs <folder-with-csvs> <release, e.g. 2024-2>
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [folder, release] = process.argv.slice(2);
if (!folder || !/^\d{4}-\d$/.test(release ?? "")) {
  console.error(
    "Usage: node scripts/build-port-reference.mjs <folder> <release YYYY-N>",
  );
  process.exit(1);
}

/** RFC 4180 parser: quoted fields may contain commas and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((cells) => cells.some(Boolean));
  return body.map((cells) =>
    Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])),
  );
}

const codeBytes = await readFile(path.join(folder, "code-list.csv"));
const countryBytes = await readFile(path.join(folder, "country-codes.csv"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const countries = {};
for (const row of parseCsv(countryBytes.toString("utf8")))
  if (/^[A-Z]{2}$/.test(row.CountryCode))
    countries[row.CountryCode] = row.CountryName;

const ports = {};
const other = {};
let portEntries = 0,
  otherEntries = 0,
  skipped = 0;
for (const row of parseCsv(codeBytes.toString("utf8"))) {
  // "X" marks an entry for deletion; reference rows without a code are unusable.
  if (
    row.Change === "X" ||
    !/^[A-Z]{2}$/.test(row.Country) ||
    !/^[A-Z0-9]{3}$/.test(row.Location)
  ) {
    skipped++;
    continue;
  }
  const functionCode = row.Function.slice(0, 1);
  const name = (row.NameWoDiacritics || row.Name).replace(/[|\n]/g, " ").trim();
  if (functionCode === "1" || functionCode === "0") {
    (ports[row.Country] ??= []).push(`${row.Location}|${name}|${functionCode}`);
    portEntries++;
  } else {
    (other[row.Country] ??= []).push(row.Location);
    otherEntries++;
  }
}

const output = {
  dataset: "UN/LOCODE",
  release,
  publisher: "UNECE",
  packaging: "https://github.com/datasets/un-locode",
  license: "ODC-PDDL-1.0",
  source_sha256: {
    "code-list.csv": sha(codeBytes),
    "country-codes.csv": sha(countryBytes),
  },
  counts: {
    port_or_unknown_function: portEntries,
    other: otherEntries,
    skipped,
  },
  countries,
  ports: Object.fromEntries(
    Object.entries(ports).map(([country, rows]) => [country, rows.join("\n")]),
  ),
  other: Object.fromEntries(
    Object.entries(other).map(([country, codes]) => [
      country,
      [...new Set(codes)].join(" "),
    ]),
  ),
};
const target = new URL("../lib/reference/unlocode.json", import.meta.url);
await writeFile(target, JSON.stringify(output));
console.log(JSON.stringify({ release, ...output.counts }, null, 2));
