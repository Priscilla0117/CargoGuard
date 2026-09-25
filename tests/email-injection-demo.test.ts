import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { processEmail } from "../lib/processing";
import type { Email } from "../lib/types";
test("credential phishing with instructions to override routing remains SPAM and never reads a URL", async () => {
  const email = JSON.parse(
    await fs.readFile("examples/security/phishing-email.json", "utf8"),
  ) as Email;
  let reads = 0;
  const result = await processEmail(email, async () => {
    reads++;
    throw new Error("No external source should be requested");
  });
  assert.equal(result.category, "SPAM");
  assert.equal(result.workflow, "review");
  assert.equal(result.classification.needs_review, true);
  assert.equal(result.comparison.length, 0);
  assert.equal(reads, 0);
});
