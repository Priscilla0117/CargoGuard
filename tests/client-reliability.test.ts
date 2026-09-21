import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestGate } from "../lib/request-gate";
import { mergeCaseSummaries } from "../lib/case-state";
import type { CaseSummary } from "../lib/types";

test("only the latest case or revision request may update the view", async () => {
  const gate = createRequestGate();
  const visible: string[] = [];
  let finishOld!: () => void;
  const old = gate.next();
  const pending = new Promise<void>((resolve) => { finishOld = resolve; })
    .then(() => { if (gate.isCurrent(old)) visible.push("old case"); });
  const recent = gate.next();
  if (gate.isCurrent(recent)) visible.push("new case");
  finishOld();
  await pending;
  assert.deepEqual(visible, ["new case"]);
});

test("closing or leaving a case invalidates pending success and failure responses", () => {
  const gate = createRequestGate();
  const pending = gate.next();
  gate.cancel();
  assert.equal(gate.isCurrent(pending), false);
  const reopened = gate.next();
  assert.equal(gate.isCurrent(pending), false);
  assert.equal(gate.isCurrent(reopened), true);
});

const row = (id: string, version: number | null) => ({
  email: { email_id: id }, result: version === null ? null : { version },
}) as CaseSummary;

test("late batch and inbox reads cannot downgrade corrected cases", () => {
  const corrected = row("shipment", 2);
  assert.deepEqual(mergeCaseSummaries([corrected], [row("shipment", 1)]), [corrected]);
  assert.deepEqual(mergeCaseSummaries([corrected], [row("shipment", null)]), [corrected]);
});

test("new revisions and new uploads are merged without losing unrelated cases", () => {
  const saved = row("shipment", 2), other = row("other", 1), upload = row("upload", 1);
  assert.deepEqual(mergeCaseSummaries([row("shipment", 1), other], [saved, upload]), [saved, other, upload]);
});
