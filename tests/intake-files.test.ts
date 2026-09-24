import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addIntakeFiles,
  intakeFilesError,
  intakeSubmissionError,
  setIntakeFormFiles,
} from "../lib/intake-files";

const file = (name: string, text = name) =>
  new File([text], name, { lastModified: 1 });
test("sequential selections retain SI and BL and submit the retained list", async () => {
  const si = file("si.txt"),
    bl = file("bl.txt");
  const first = await addIntakeFiles([], [si]);
  const second = await addIntakeFiles(first.files, [bl]);
  const form = new FormData();
  form.append("files", file("native-picker-only.txt"));
  form.set("subject", "Shipment check");
  setIntakeFormFiles(form, second.files);
  assert.deepEqual(
    form.getAll("files").map((f) => (f as File).name),
    ["si.txt", "bl.txt"],
  );
  assert.equal(form.get("subject"), "Shipment check");
});

test("adding a missing source accepts one file and requires at least one addition", () => {
  assert.equal(
    intakeSubmissionError([file("missing-bl.txt")], "append", [
      { size_bytes: 20 },
    ]),
    null,
  );
  assert.match(
    intakeSubmissionError([], "append", [{ size_bytes: 20 }])!,
    /at least one/,
  );
  assert.match(
    intakeSubmissionError([file("only-si.txt")], "replace_all")!,
    /both/,
  );
  assert.equal(
    intakeSubmissionError([file("new-bl.txt")], "replace_one", [
      { size_bytes: 20 },
    ]),
    null,
  );
});

test("existing case attachment counts and bytes constrain additional uploads", () => {
  const retained = Array.from({ length: 9 }, () => ({ size_bytes: 1024 }));
  assert.equal(
    intakeSubmissionError([file("tenth.txt")], "append", retained),
    null,
  );
  assert.match(
    intakeSubmissionError(
      [file("tenth.txt"), file("eleventh.txt")],
      "append",
      retained,
    )!,
    /resulting case/,
  );
  assert.match(
    intakeSubmissionError([file("extra.txt")], "append", [
      { size_bytes: 20 * 1024 * 1024 },
    ])!,
    /20 MB/,
  );
  assert.equal(
    intakeSubmissionError([file("extra.txt")], "append", [{}]),
    null,
  );
});
test("duplicate picks are skipped but same-name revised bytes and different filenames are retained", async () => {
  const original = file("bl.txt", "draft one");
  const merged = await addIntakeFiles(
    [original],
    [
      file("bl.txt", "draft one"),
      file("bl.txt", "draft two"),
      file("si.txt", "draft one"),
    ],
  );
  assert.equal(merged.files.length, 3);
  assert.equal(merged.duplicates, 1);
});
test("removal changes submitted attachments, including clearing the final file", () => {
  const selected = [file("si.txt"), file("bl.txt")];
  const form = setIntakeFormFiles(
    new FormData(),
    selected.filter((_, index) => index !== 0),
  );
  assert.deepEqual(
    form.getAll("files").map((f) => (f as File).name),
    ["bl.txt"],
  );
  setIntakeFormFiles(form, []);
  assert.equal(form.getAll("files").length, 0);
});
test("limits apply to the combined list and failed additions preserve prior selections", async () => {
  const current = Array.from({ length: 10 }, (_, n) => file(`${n}.txt`));
  const rejected = await addIntakeFiles(current, [file("eleven.txt")]);
  assert.match(rejected.error!, /at most 10/);
  assert.deepEqual(rejected.files, current);
  assert.equal((await addIntakeFiles(current, [file("0.txt")])).error, null);
  assert.match(
    intakeFilesError([
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"),
    ])!,
    /5 MB/,
  );
  assert.match(
    intakeFilesError(
      Array.from(
        { length: 5 },
        (_, n) => new File([new Uint8Array(5 * 1024 * 1024)], `${n}.pdf`),
      ),
    )!,
    /20 MB/,
  );
  assert.match(
    (await addIntakeFiles([], [file("unexpected.exe")])).error!,
    /TXT/,
  );
  assert.match(
    intakeFilesError([file("si.txt"), file("bl.txt")], 1)!,
    /one replacement/,
  );
});
