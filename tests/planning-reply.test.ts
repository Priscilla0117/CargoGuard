import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { analyze, inlineLabelSplit } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { normalize } from "../lib/normalization";
import {
  comparePlanned,
  dateWindow,
  inDateWindow,
  planFor,
} from "../lib/priority";
import { caseStatus, rowStatus } from "../lib/case-status";
import {
  draftReply,
  gmailComposeUrl,
  mailtoUrl,
  missingFacts,
  suggestedIntent,
} from "../lib/reply";
import { buildRawMessage } from "../lib/mail-mime";
import { parseEml, htmlToText } from "../lib/eml";
import { renderEml, FIELD_TEST, renderPdf } from "../lib/field-test";
import { summaryOf, type CaseResult, type Email } from "../lib/types";
import type { FollowUp } from "../lib/follow-up";

const doc = (role: "SI" | "BL", weight: string, consignee = "BETA LTD") =>
  parseDocument(
    `${role}.txt`,
    strToU8(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        "Shipper: ALPHA LTD",
        `Consignee: ${consignee}`,
        "Notify Party: SAME AS CONSIGNEE",
        "Port of Loading: SINGAPORE",
        "Port of Discharge: ROTTERDAM",
        "Container Count: 2 x 40HC",
        `Gross Weight: ${weight}`,
      ].join("\n"),
    ),
  );
async function caseWith(
  weight: string,
  email: Partial<Email> = {},
): Promise<CaseResult> {
  const docs = [await doc("SI", "42,000 KG"), await doc("BL", weight)];
  return analyze(
    {
      email_id: "case-1",
      from: "jasmine.tan@carrier.test",
      subject: "TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM",
      body: "Please check the draft BL against the SI.\n\nBest Regards,\nJasmine Tan",
      attachments: ["SI.txt", "BL.txt"],
      ...email,
    },
    docs,
  );
}

test("buckets: differences are to-do, matches are done, waiting follow-ups are parked", async () => {
  const now = Date.parse("2026-09-21T04:00:00Z");
  const mismatch = summaryOf(await caseWith("43,000 KG"));
  const match = summaryOf(await caseWith("42000 KG"));
  const plan = planFor(mismatch, undefined, now);
  assert.equal(plan.bucket, "todo");
  assert.equal(plan.reason, "differences");
  assert.equal(planFor(match, undefined, now).bucket, "done");
  const waiting: FollowUp = {
    email_id: "case-1",
    version: 1,
    case_version: mismatch.result!.version,
    owner: "Najiha",
    shipment_reference: "",
    due_at: "2026-09-25T00:00:00Z",
    state: "waiting",
    note: "Asked carrier",
    actor: "Najiha",
    updated_at: "",
    created_at: "",
    completed_at: null,
  };
  assert.equal(planFor(mismatch, waiting, now).bucket, "waiting");
  const overdue = { ...waiting, due_at: "2026-09-20T00:00:00Z" };
  const overduePlan = planFor(mismatch, overdue, now);
  assert.equal(overduePlan.bucket, "todo");
  assert.ok(overduePlan.reasons.includes("Follow-up is overdue"));
});

test("an urgent email with a deadline tomorrow outranks an older quiet difference", async () => {
  const now = Date.parse("2026-09-21T04:00:00Z");
  const quiet = summaryOf(
    await caseWith("43,000 KG", {
      email_id: "quiet",
      received_at: "2026-09-20T02:00:00Z",
    }),
  );
  const urgent = summaryOf(
    await caseWith("43,000 KG", {
      email_id: "urgent",
      received_at: "2026-09-21T01:00:00Z",
      body: "URGENT: SI cut-off is 22 Sep 2026. Please check the draft BL against the SI asap.",
    }),
  );
  const a = { row: quiet, plan: planFor(quiet, undefined, now) };
  const b = { row: urgent, plan: planFor(urgent, undefined, now) };
  assert.equal(b.plan.level, "urgent");
  assert.equal(b.plan.deadline, "2026-09-22");
  assert.ok(comparePlanned(b, a, "priority") < 0);
  assert.ok(comparePlanned(a, b, "newest") > 0);
  assert.ok(comparePlanned(a, b, "oldest") < 0);
});

test("date filters use the received time and exclude undated emails", async () => {
  const now = new Date(2026, 8, 21, 12).getTime();
  const today = summaryOf(
    await caseWith("42,000 KG", {
      received_at: new Date(2026, 8, 21, 9).toISOString(),
    }),
  );
  const old = summaryOf(
    await caseWith("42,000 KG", {
      received_at: new Date(2026, 8, 1, 9).toISOString(),
    }),
  );
  const undated = summaryOf(await caseWith("42,000 KG"));
  const todayWindow = dateWindow("today", now);
  assert.ok(inDateWindow(today, todayWindow));
  assert.ok(!inDateWindow(old, todayWindow));
  assert.ok(!inDateWindow(undated, todayWindow));
  assert.ok(inDateWindow(undated, dateWindow("any", now)));
  const custom = dateWindow("custom", now, "2026-09-01", "2026-09-01");
  assert.ok(inDateWindow(old, custom));
  assert.ok(!inDateWindow(today, custom));
  assert.equal(dateWindow("custom", now, "", ""), null);
});

test("status wording gives one plain next step", async () => {
  const mismatch = await caseWith("43,000 KG");
  const status = caseStatus(mismatch);
  assert.equal(status.tone, "differences");
  assert.equal(status.title, "1 detail does not match the SI");
  assert.equal(status.action?.target, "reply");
  assert.equal(rowStatus(summaryOf(mismatch)).text, "1 difference");
  assert.equal(
    caseStatus(await caseWith("42000 KG")).title,
    "No mismatch detected",
  );
});

test("reply drafts quote the SI and BL values and keep references", async () => {
  const mismatch = await caseWith("43,000 KG", {
    message_id: "orig@carrier.test",
    references: ["first@carrier.test"],
  });
  assert.equal(suggestedIntent(mismatch), "request_correction");
  const draft = draftReply(mismatch, {
    tone: "formal",
    signature: "Najiha\nDocs team",
  });
  assert.equal(draft.to, "jasmine.tan@carrier.test");
  assert.equal(draft.subject, "RE: TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM");
  assert.match(draft.body, /^Dear Jasmine,/);
  assert.match(draft.body, /Order 5RFR-36541/);
  assert.match(draft.body, /Per our SI: +42,000 KG/);
  assert.match(draft.body, /Draft BL shows: 43,000 KG/);
  assert.match(draft.body, /Najiha\nDocs team$/);
  assert.equal(draft.in_reply_to, "orig@carrier.test");
  assert.deepEqual(draft.references, [
    "first@carrier.test",
    "orig@carrier.test",
  ]);
  const short = draftReply(mismatch, { tone: "short" });
  assert.match(short.body, /^Hi Jasmine,/);
  assert.match(short.body, /should be "42,000 KG"/);
  // AI polishing may not drop a checked value.
  assert.deepEqual(missingFacts(draft.body, draft.body), []);
  assert.ok(
    missingFacts(
      draft.body,
      draft.body.replace("42,000 KG", "42,500 KG"),
    ).includes("42,000 KG"),
  );
  const confirm = draftReply(await caseWith("42000 KG"));
  assert.equal(confirm.intent, "confirm_match");
  assert.match(confirm.body, /all match/);
  assert.match(
    gmailComposeUrl(draft),
    /^https:\/\/mail\.google\.com\/mail\/\?view=cm/,
  );
  assert.ok(!mailtoUrl(draft).includes("+"));
});

test("outgoing replies are valid, threaded RFC 5322 messages", async () => {
  const { raw } = buildRawMessage({
    from: "najiha@april.test",
    to: ["jasmine@carrier.test"],
    cc: [],
    subject: "RE: Überprüfung 5RFR-36541",
    body: "Line one\nLine two",
    in_reply_to: "orig@carrier.test",
    references: ["first@carrier.test", "orig@carrier.test"],
  });
  assert.match(raw, /^From: najiha@april\.test\r\n/);
  assert.match(raw, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /\r\nIn-Reply-To: <orig@carrier\.test>\r\n/);
  const parsed = await parseEml(raw);
  assert.equal(parsed.subject, "RE: Überprüfung 5RFR-36541");
  assert.equal(parsed.body, "Line one\nLine two");
  assert.equal(parsed.in_reply_to, "orig@carrier.test");
});

test(".eml parsing reads headers, dates and supported attachments only", async () => {
  const scenario = FIELD_TEST.find((s) => s.id === "ft_03")!;
  const mail = await parseEml(
    renderEml(scenario, new Date("2026-09-21T00:00:00Z")),
  );
  assert.equal(mail.from, "docs.sg@cma-demo-lines.com");
  assert.equal(mail.received_at, "2026-09-18T02:05:00.000Z");
  assert.equal(mail.message_id, "ft_03.fieldtest@cargoguard-demo.invalid");
  assert.equal(mail.in_reply_to, "ft_02.fieldtest@cargoguard-demo.invalid");
  assert.equal(mail.references.length, 2);
  assert.deepEqual(
    mail.attachments.map((a) => a.name),
    ["SI_5RFR-36541.pdf", "DRAFT_BL_SIJ4216073_REV1.pdf"],
  );
  const withImage = await parseEml(
    [
      "From: A <a@b.test>",
      "Subject: HTML only",
      "Date: Mon, 21 Sep 2026 08:00:00 +0800",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="x"',
      "",
      "--x",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<p>Hello&nbsp;team</p><p>Please check</p>",
      "--x",
      'Content-Type: application/zip; name="docs.zip"',
      'Content-Disposition: attachment; filename="docs.zip"',
      "Content-Transfer-Encoding: base64",
      "",
      "UEsDBA==",
      "--x--",
    ].join("\r\n"),
  );
  assert.equal(withImage.body, "Hello team\nPlease check");
  assert.equal(withImage.received_at, "2026-09-21T00:00:00.000Z");
  assert.deepEqual(withImage.skipped, [
    { name: "docs.zip", reason: "Not a TXT, PDF, DOCX or XLSX file" },
  ]);
  await assert.rejects(() => parseEml(""), /empty/);
  assert.equal(htmlToText("<style>x</style>A<br>B &amp; C"), "A\nB & C");
});

test("PDF table rows with label and value in one text run are read correctly", async () => {
  assert.deepEqual(
    [...(inlineLabelSplit("Gross Weight (KG)   42,500 KG") ?? [])].slice(1),
    ["Gross Weight (KG)", "42,500 KG"],
  );
  assert.equal(inlineLabelSplit("Shipper: ALPHA"), null);
  assert.equal(inlineLabelSplit("PORT KLANG, MALAYSIA"), null);
  const rows = (weight: string) => [
    { x: 50, y: 790, text: "DRAFT BILL OF LADING" },
    { x: 50, y: 760, text: "Shipper   ALPHA LTD" },
    { x: 50, y: 740, text: "Consignee   BETA LTD" },
    { x: 50, y: 720, text: "Notify Party   SAME AS CONSIGNEE" },
    { x: 50, y: 700, text: "Port of Loading   SINGAPORE" },
    { x: 50, y: 680, text: "Port of Discharge (POD)   ROTTERDAM" },
    { x: 50, y: 660, text: "Container Count   TWO (2) X 40' HC" },
    { x: 50, y: 640, text: `Gross Weight (KG)   ${weight}` },
  ];
  const si = await doc("SI", "42,000 KG");
  const bl = await parseDocument("bl.pdf", renderPdf(rows("42,000 KG")));
  const result = analyze(
    {
      email_id: "pdf",
      from: "a@b.test",
      subject: "TO CONFIRM DOCS",
      body: "Please check the draft BL against the SI.",
      attachments: ["SI.txt", "bl.pdf"],
    },
    [si, bl],
  );
  assert.equal(result.status, "OK", result.summary);
  assert.equal(normalize("container_count", "TWO (2) X 40' HC"), 2);
  assert.equal(normalize("container_count", "THREE (2) X 40HC"), null);
  assert.equal(normalize("gross_weight_kg", "18.5 MT"), 18500);
});

test("a recognised invoice beside the SI and BL is kept, not compared, unless it contradicts", async () => {
  const email: Email = {
    email_id: "extra",
    from: "a@b.test",
    subject: "TO CONFIRM DOCS",
    body: "Please check the draft BL against the SI.",
    attachments: ["SI.txt", "BL.txt", "CI.txt"],
  };
  const invoice = (text: string) =>
    parseDocument("CI.txt", strToU8(`COMMERCIAL INVOICE\n${text}`));
  const ok = analyze(email, [
    await doc("SI", "42,000 KG"),
    await doc("BL", "42,000 KG"),
    await invoice("Amount: USD 100"),
  ]);
  assert.equal(ok.status, "OK");
  assert.match(ok.summary, /CI\.txt\) kept but not compared/);
  const conflict = analyze(email, [
    await doc("SI", "42,000 KG"),
    await doc("BL", "42,000 KG"),
    await invoice("Gross Weight: 40,000 KG"),
  ]);
  assert.equal(conflict.status, "NEEDS_REVIEW");
  assert.equal(conflict.review_reason, "wrong_doc_type");
});

test("today's plan lists open work first with its reasons", async () => {
  const { planText } = await import("../lib/priority");
  const now = Date.parse("2026-09-21T04:00:00Z");
  const rows = [
    summaryOf(await caseWith("42000 KG", { email_id: "done" })),
    summaryOf(
      await caseWith("43,000 KG", {
        email_id: "open",
        received_at: "2026-09-21T01:00:00Z",
        body: "URGENT please check the draft BL against the SI. Cut-off 22 Sep 2026.",
      }),
    ),
  ].map((row) => ({ row, plan: planFor(row, undefined, now) }));
  const text = planText(rows, new Date(now));
  assert.match(text, /1 emails to do · 0 waiting/);
  assert.match(text, /1\. \[URGENT\] TO CONFIRM DOCS/);
  assert.match(text, /Why: Documents do not match; Cut-off tomorrow/);
  assert.match(text, /Cut-off: 2026-09-22/);
});

test("SI requests and invoice questions are to-do work and can be closed when handled", async () => {
  const { completionBlocker } = await import("../lib/follow-up");
  const now = Date.parse("2026-09-21T04:00:00Z");
  const request = analyze(
    {
      email_id: "si-req",
      from: "customer@example.test",
      subject: "REQUEST SI _ 5RCY-60883 _ CONAKRY",
      body: "Please prepare the shipping instruction for this booking. SI cut-off 22 Sep 2026.",
      attachments: [],
      received_at: "2026-09-21T00:00:00Z",
    },
    [],
  );
  assert.equal(request.category, "SI_REQUEST");
  const plan = planFor(summaryOf(request), undefined, now);
  assert.equal(plan.bucket, "todo");
  assert.equal(plan.reason, "si_request");
  assert.equal(rowStatus(summaryOf(request)).text, "Send SI");
  assert.equal(caseStatus(request).secondary?.target, "followup");
  assert.equal(completionBlocker(request), null);
  const done: FollowUp = {
    email_id: "si-req",
    version: 1,
    case_version: request.version,
    owner: "Najiha",
    shipment_reference: "5RCY-60883",
    due_at: null,
    state: "completed",
    note: "SI sent to carrier",
    actor: "Najiha",
    updated_at: "",
    created_at: "",
    completed_at: "2026-09-21T05:00:00Z",
  };
  assert.equal(planFor(summaryOf(request), done, now).bucket, "done");
  // A document case routed elsewhere still cannot be closed by a follow-up.
  const docs = await caseWith("42000 KG");
  assert.ok(completionBlocker({ ...docs, category: "GENERAL" }));
});

test("a notify party that only follows a wrong consignee is explained, not listed", async () => {
  const mismatch = analyze(
    {
      email_id: "notify",
      from: "a@b.test",
      subject: "TO CONFIRM DOCS",
      body: "Please check the draft BL against the SI.",
      attachments: ["SI.txt", "BL.txt"],
    },
    [await doc("SI", "42,000 KG"), await doc("BL", "42,000 KG", "GAMMA LTD")],
  );
  assert.deepEqual([...mismatch.defect_fields].sort(), [
    "consignee",
    "notify_party",
  ]);
  const draft = draftReply(mismatch);
  assert.match(draft.body, /The following detail does not match/);
  assert.match(draft.body, /1\. Consignee/);
  assert.doesNotMatch(draft.body, /2\. Notify party/);
  assert.match(
    draft.body,
    /Notify party \(“SAME AS CONSIGNEE”\) will be correct once the above is amended/,
  );
});
