// Independent inline generalization probes. Name-only vs full address and
// bare port-code equivalence are deliberately conservative: incomplete identity
// evidence must not be auto-cleared. No runtime answer-key lookup is involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { classify } from "../lib/classifier";
import { parseDocument } from "../lib/parsers";
import { normalize } from "../lib/normalization";
import type { Email } from "../lib/types";

const enc = (s: string) => new TextEncoder().encode(s);
const email: Email = {
  email_id: "generalization-case",
  from: "ops@example.test",
  subject: "TO CONFIRM DOCS _ 5XYZ-00001 _ SAVANNAH_US",
  body: "Please compare the SI and draft BL for 46294639 and confirm.",
  attachments: ["si.txt", "bl.txt"],
};
const SI = (o: Record<string, string> = {}) =>
  [
    "SHIPPING INSTRUCTION",
    `Shipper: ${o.shipper ?? "APRIL FINE PAPER TRADING (MIDDLE EAST) FZE"}`,
    o.shipper_address ??
      "  #813, 4 EA, DUBAI AIRPORT FREE ZONE; P.O. BOX: 293775, DUBAI, UNITED ARAB EMIRATES",
    `Consignee: ${o.consignee ?? "AL GURG STATIONERY LLC"}`,
    o.consignee_address ?? "  P.O. BOX 5069; DUBAI, UNITED ARAB EMIRATES",
    `Notify: ${o.notify ?? "AL GURG STATIONERY LLC"}`,
    `Port of Loading (POL): ${o.pol ?? "SINGAPORE"}`,
    `PORT OF DISCHARGE: ${o.pod ?? "SAVANNAH, US (USSAV)"}`,
    `Total Containers: ${o.count ?? "1 x 20'FCL"}`,
    `Gross Wt (kgs): ${o.weight ?? "20,913 KG"}`,
  ].join("\n");
const BL = (o: Record<string, string> = {}) =>
  [
    "BILL OF LADING (DRAFT)",
    `Shipper/Exporter: ${o.shipper ?? "APRIL FINE PAPER TRADING (MIDDLE EAST) FZE"}`,
    "  #813, 4 EA, DUBAI AIRPORT FREE ZONE; P.O. BOX: 293775, DUBAI, UNITED ARAB EMIRATES",
    `To the Order of: ${o.consignee ?? "AL GURG STATIONERY LLC"}`,
    "  P.O. BOX 5069; DUBAI, UNITED ARAB EMIRATES",
    `Notify Party: ${o.notify ?? "AL GURG STATIONERY LLC"}`,
    `PORT OF LOADING: ${o.pol ?? "SINGAPORE (SGSIN)"}`,
    `Port of Discharge (POD): ${o.pod ?? "SAVANNAH, US (USSAV)"}`,
    `No. of Containers: ${o.count ?? "1 x 20'FCL"}`,
    `GROSS WEIGHT: ${o.weight ?? "20,913 KG"}`,
  ].join("\n");
async function run(si: string, bl: string) {
  const docs = [
    await parseDocument("si.txt", enc(si)),
    await parseDocument("bl.txt", enc(bl)),
  ];
  return analyze(email, docs);
}
const flagged = (r: Awaited<ReturnType<typeof run>>) =>
  r.comparison
    .filter((c) => c.result === "mismatch")
    .map((c) => c.field)
    .sort();

test("complete matching party/address blocks are verified", async () => {
  const r = await run(SI(), BL());
  assert.deepEqual(flagged(r), []);
  assert.equal(r.workflow, "verified");
});

test("name-only SI does not silently clear additional BL address claims", async () => {
  const r = await run(SI({ shipper_address: "", consignee_address: "" }), BL());
  assert.deepEqual(flagged(r), ["consignee", "shipper"]);
  assert.equal(r.workflow, "discrepancy");
});

test("known optional port code is equivalent but code-only identity is not inferred", async () => {
  const r = await run(
    SI({ pol: "SINGAPORE" }),
    BL({ pol: "SINGAPORE (SGSIN)" }),
  );
  assert.ok(!flagged(r).includes("port_of_loading"));
  const code = await run(
    SI({ pol: "SGSIN" }),
    BL({ pol: "SINGAPORE (SGSIN)" }),
  );
  assert.deepEqual(flagged(code), ["port_of_loading"]);
  assert.equal(code.workflow, "discrepancy");
});

test("changed party names are still caught when the address is unchanged", async () => {
  const r = await run(
    SI(),
    BL({ consignee: "UAB NOVAKOPA", notify: "UAB NOVAKOPA" }),
  );
  assert.deepEqual(flagged(r), ["consignee", "notify_party"]);
});

test("a changed port is still caught with or without codes", async () => {
  const r = await run(
    SI({ pod: "SAVANNAH, US" }),
    BL({ pod: "HOUSTON, US (USHOU)" }),
  );
  assert.deepEqual(flagged(r), ["port_of_discharge"]);
  const codes = await run(
    SI({ pod: "SAVANNAH, US (USSAV)" }),
    BL({ pod: "SAVANNAH, US (USHOU)" }),
  );
  // A known name with a contradictory code is invalid source evidence, even
  // before comparing it with the SI. Keep it visible as an uncertain field.
  assert.equal(codes.status, "NEEDS_REVIEW");
  assert.equal(
    codes.comparison.find((row) => row.field === "port_of_discharge")?.result,
    "uncertain",
  );
  assert.match(
    codes.comparison.find((row) => row.field === "port_of_discharge")?.bl
      .issue ?? "",
    /port name and location code do not agree/,
  );
});

for (const blank of [
  "____MT",
  "__ MT",
  "??? KGS",
  "_______",
  "???",
  "TBA",
  "TBC",
  "N/A",
]) {
  test(`blank placeholder "${blank}" escalates as missing_value, never a mismatch`, async () => {
    assert.equal(normalize("port_of_discharge", blank), null);
    const r = await run(SI({ pod: blank }), BL());
    assert.equal(r.status, "NEEDS_REVIEW");
    assert.equal(r.review_reason, "missing_value");
    assert.deepEqual(flagged(r), []);
  });
}

// Organiser-style spam: every subject is paired with every body (10 x 6 = 60).
const SPAM_SUBJECTS = [
  "Congratulations! You have WON a $1,000 Gift Card - CLAIM NOW",
  "Your parcel is on hold - confirm payment of $2.99 to release",
  "URGENT: Your email storage is full - verify account immediately",
  "Exclusive offer: 90% OFF premium logistics software this week only",
  "Re: Invoice payment - kindly confirm your bank details",
  "You have (3) undelivered messages in your mailbox",
  "Increase your shipping revenue with this ONE weird trick",
  "Dear Valued Customer, update your account to avoid suspension",
  "Hot singles in your area want to connect",
  "Bitcoin investment opportunity - guaranteed 300% returns",
];
const SPAM_BODIES = [
  "CONGRATULATIONS!!! Your email address has been selected in our monthly draw. Click here to claim your $1,000 gift card now: http://bit.ly/claim-prize-now",
  "Your package could not be delivered due to unpaid customs fee of $2.99. Confirm payment within 24 hours or your parcel will be returned: http://track-parcel.info",
  "Dear user, your mailbox has exceeded its storage limit. Verify your account within 24 hours to avoid deactivation: http://webmail-verify.co",
  "LIMITED TIME OFFER! Get 90% off the #1 logistics automation suite. Trusted by 10,000+ companies. Buy now before this deal expires!",
  "Hello Dear, I am a bank officer with an urgent business proposal involving USD 4.5 million. Please reply with your bank details to proceed.",
  "You have won a brand new iPhone! To claim, simply complete this short survey and pay $1 shipping: http://free-iphone-winner.net",
];
test("every spam subject x body combination is classified SPAM (60 cases)", () => {
  const misses: string[] = [];
  for (const subject of SPAM_SUBJECTS)
    for (const body of SPAM_BODIES) {
      const c = classify({
        email_id: "s",
        from: "x@spam.test",
        subject,
        body,
        attachments: [],
      });
      if (c.category !== "SPAM")
        misses.push(`${subject} | ${body.slice(0, 40)} -> ${c.category}`);
    }
  assert.deepEqual(misses, []);
});

test("legitimate invoice query about payment is not treated as spam", () => {
  const c = classify({
    email_id: "i",
    from: "billing@example.test",
    subject: "BILLING - MISSING GR - INV 5250074688",
    body: "Hi team, the invoice for OC 5APH-30960 cannot be paid because the GR is missing. Please check and advise.",
    attachments: [],
  });
  assert.equal(c.category, "INVOICE_QUERY");
});
