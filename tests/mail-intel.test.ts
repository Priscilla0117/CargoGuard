import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailInsight,
  extractReferences,
  groupThreads,
  latestMessagePart,
  mentionedDates,
  normalizeSubject,
  quotedHistory,
  senderName,
  urgentTerms,
} from "../lib/mail-intel";
import { emailSummaryOf } from "../lib/types";

test("Averis order, PO, invoice and booking references are extracted separately", () => {
  const refs = extractReferences(
    "AFEMY - MOMBASA_KENYA - CMA(SIJ4216073) - 5RFR-36541 - 5250074586 - ROXCEL TRADING GMBH",
    "Please prepare SI for PO_25_2186 and PO 26067. Invoice No: 5250070084. Container MSCU1234567. Port SINGAPORE.",
  );
  assert.deepEqual(refs.shipment, ["5RFR-36541"]);
  assert.deepEqual(refs.po, ["25_2186", "26067"]);
  assert.ok(refs.invoice.includes("5250074586"));
  assert.ok(refs.invoice.includes("5250070084"));
  assert.deepEqual(refs.booking, ["SIJ4216073"]);
  assert.deepEqual(refs.container, ["MSCU1234567"]);
  // Place names that start like carrier prefixes are never booking numbers.
  assert.ok(!refs.booking.includes("SINGAPORE"));
});

test("dates keep their meaning from the nearest keyword and relative words need a known email date", () => {
  const base = new Date("2026-01-20T00:00:00Z");
  const dates = mentionedDates(
    "Please submit SI before 26-Jan-26. ETD 28 January 2026, cut-off 27/01/2026. Reply by tomorrow",
    base,
  );
  assert.deepEqual(
    dates.map((d) => `${d.kind} ${d.date}`),
    [
      "Due 2026-01-21",
      "Due 2026-01-26",
      "Cut-off 2026-01-27",
      "ETD 2026-01-28",
    ],
  );
  assert.equal(
    mentionedDates("Please reply today", base, false).length,
    0,
    "An undated email cannot resolve 'today'",
  );
  assert.equal(mentionedDates("invalid 31/02/2026 date", base).length, 0);
  // Undated sample emails never become "due today".
  assert.equal(
    emailInsight({
      from: "a@b.test",
      subject: "Reminder",
      body: "Submit by end of day",
    }).dates.length,
    0,
  );
});

test("urgency words come from the newest message, not quoted history", () => {
  const body =
    "Thanks, noted.\n\n________________________________\nFrom: X <x@y.test>\nSent: Monday, January 5, 2026 9:00 AM\nSubject: RE: 5RFR-36541\n\nURGENT please send ASAP";
  assert.equal(latestMessagePart(body).trim(), "Thanks, noted.");
  assert.deepEqual(
    emailInsight({ from: "a@b.test", subject: "RE: docs", body }).urgent_terms,
    [],
  );
  assert.ok(
    urgentTerms("Final reminder: cargo on hold").includes("final reminder"),
  );
});

test("sender names come from the display name or the signature", () => {
  assert.equal(senderName('"Jasmine Tan" <docs@x.test>'), "Jasmine Tan");
  assert.equal(
    senderName(
      "docs.sg@x.test",
      "Please check.\r\n\r\nBest Regards,\r\nJasmine Tan\r\nDocumentation",
    ),
    "Jasmine Tan",
  );
  assert.equal(senderName("guancheng_lee@x.test"), "Guancheng Lee");
});

test("quoted From/Sent/Subject blocks become an earlier-message timeline", () => {
  const history = quotedHistory(
    "Dear Arlene,\nPlease check.\n\n______\nFrom: Chella Perumal <c@p.test>\nSent: Friday, January 1, 2026 3:26 AM\nSubject: RE: 5SUS-86999\n\nPlease follow the previous instruction.\nFrom: Mitchelle Ting <m@a.test>\nSent: Friday, December 24, 2026 2:40 PM\nSubject: RE: 5SUS-86999\n\nFirst message.",
  );
  assert.equal(history.length, 2);
  assert.equal(history[0].from, "Chella Perumal");
  assert.equal(history[0].subject, "RE: 5SUS-86999");
  assert.equal(history[0].text, "Please follow the previous instruction.");
  assert.equal(history[1].text, "First message.");
});

test("conversations group by order number, reply chain and subject but never spam", () => {
  const threads = groupThreads([
    {
      id: "a",
      subject: "REQUEST SI _ 5RFR-36541 _ MOMBASA",
      refs: extractReferences("REQUEST SI _ 5RFR-36541"),
    },
    { id: "b", subject: "RE: AFEMY - 5RFR-36541 - DRAFT BL" },
    {
      id: "c",
      subject: "Query on invoice",
      refs: extractReferences("Query on invoice", "for order 5RFR-36541"),
    },
    {
      id: "d",
      subject: "Draft BL MMSS 2507 V.257087E NHAVA SHEVA - amend BL 058",
      message_id: "m1@x",
    },
    { id: "e", subject: "Please see revised", in_reply_to: "m1@x" },
    { id: "f", subject: "Weekly berthing report Port Klang" },
    { id: "g", subject: "RE_ Weekly berthing report Port Klang" },
    { id: "h", subject: "Increase your shipping revenue now", excluded: true },
    { id: "i", subject: "Increase your shipping revenue now", excluded: true },
    { id: "j", subject: "TO CONFIRM DOCS _ 5AAT-03056" },
  ]);
  assert.deepEqual(threads.get("a")?.ids, ["a", "b", "c"]);
  assert.equal(threads.get("a")?.label, "Shipment 5RFR-36541");
  assert.deepEqual(threads.get("d")?.ids, ["d", "e"]);
  assert.deepEqual(threads.get("f")?.ids, ["f", "g"]);
  assert.equal(threads.get("h"), undefined);
  assert.equal(threads.get("j"), undefined);
  assert.equal(
    normalizeSubject("RE_ FW: RE_ TO CONFIRM DOCS _ 5AAT-03056"),
    "to confirm docs 5aat - 03056",
  );
});

test("summaries carry a short snippet and insight without the full body", () => {
  const summary = emailSummaryOf({
    email_id: "x",
    from: "a@b.test",
    subject: "TO CONFIRM DOCS _ 5RSG-00133",
    body:
      "Hi Najiha,\n\nWARNING: This email originated outside of our organisation.\nAttached are the SI and draft BL. " +
      "x".repeat(500),
    attachments: [],
    received_at: "2026-09-20T01:00:00.000Z",
  });
  assert.equal("body" in summary, false);
  assert.equal(summary.received_at, "2026-09-20T01:00:00.000Z");
  assert.ok(summary.insight!.snippet.startsWith("Attached are the SI"));
  assert.ok(summary.insight!.snippet.length <= 160);
  assert.deepEqual(summary.insight!.refs.shipment, ["5RSG-00133"]);
});
