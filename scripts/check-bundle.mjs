import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const bundle = JSON.parse(await fs.readFile("data/bundle.json", "utf8"));
const roots = ["../sdoc-hackathon-bundle", "../sdoc-hackathon-docker/data_v2"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let records = 0,
  documents = 0;
for (const email of bundle.emails) {
  const copies = await Promise.all(
    roots.map((root) =>
      fs.readFile(path.join(root, "inbox", `${email.email_id}.json`)),
    ),
  );
  assert.equal(hash(copies[0]), hash(copies[1]));
  for (const bytes of copies)
    assert.deepEqual(JSON.parse(bytes.toString("utf8")), email);
  records++;
}
for (const [name, encoded] of Object.entries(bundle.attachments)) {
  const expected = hash(Buffer.from(encoded, "base64"));
  for (const root of roots)
    assert.equal(hash(await fs.readFile(path.join(root, name))), expected);
  documents++;
}
const report = {
  passed: true,
  emails: records,
  documents,
  compared: roots,
  check:
    "Byte-identical organiser copies; embedded source records and attachment bytes match originals",
  generated_at: new Date().toISOString(),
};
await fs.mkdir("work/validation", { recursive: true });
await fs.writeFile(
  "work/validation/input-integrity.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
