import { test } from "node:test";
import assert from "node:assert/strict";
import { processEmail, attachmentPlan } from "../lib/processing";
import { emails } from "../lib/bundle";
import type { Email } from "../lib/types";

const text = (role: string) =>
  new TextEncoder().encode(
    `${role}\nShipper: EXPORT LTD\nConsignee: IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: PORT KLANG\nPort of Discharge: SINGAPORE\nContainer Count: 2\nGross Weight: 42000 KG`,
  );
test("confident unrelated mail never reads attached bytes; original attachments remain available", async () => {
  const original = emails.find((e) => {
    const p = attachmentPlan(e);
    return !p.parse && p.classification.category === "INVOICE_QUERY";
  });
  assert.ok(original);
  const email = { ...original, attachments: ["broken.pdf", "unknown.xlsx"] };
  let reads = 0;
  const result = await processEmail(email, async () => {
    reads++;
    throw new Error("Must not inspect");
  });
  assert.equal(reads, 0);
  assert.equal(result.workflow, "routed");
  assert.deepEqual(result.email.attachments, email.attachments);
  assert.ok(result.documents.every((d) => d.deferred && !d.lines.length));
  assert.match(result.summary, /without parsing/);
  const rerouted = await processEmail(
    email,
    async (p) =>
      text(p === "broken.pdf" ? "SHIPPING INSTRUCTION" : "BILL OF LADING"),
    { ...result, category_override: "BL_COMPARISON" },
  );
  assert.ok(rerouted.documents.every((d) => !d.deferred));
  // The byte format is intentionally wrong: selecting comparison must inspect and detect it.
  assert.equal(rerouted.status, "NEEDS_REVIEW");
});
test("comparison override loads deferred sources and produces complete evidence", async () => {
  const email: Email = {
    email_id: "route-one",
    from: "sender@example.test",
    subject: "Invoice payment status",
    body: "Please confirm payment for this invoice.",
    attachments: ["si.txt", "bl.txt"],
  };
  const before = await processEmail(email, async () => null);
  const after = await processEmail(
    email,
    async (p) =>
      text(p.startsWith("si") ? "SHIPPING INSTRUCTION" : "BILL OF LADING"),
    { ...before, category_override: "BL_COMPARISON" },
  );
  assert.equal(after.comparison.length, 7);
  assert.equal(after.workflow, "verified");
  assert.ok(after.documents.every((d) => d.sha256 && !d.deferred));
});
test("uncertain routing is not silently treated as confidently irrelevant", () => {
  const email: Email = {
    email_id: "uncertain",
    from: "x@example.test",
    subject: "qzxv",
    body: "qzxv",
    attachments: ["unknown.pdf"],
  };
  assert.equal(attachmentPlan(email).classification.needs_review, true);
  assert.equal(attachmentPlan(email).parse, true);
});
