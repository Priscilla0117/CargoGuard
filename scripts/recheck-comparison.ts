import fs from "node:fs/promises";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { classify } from "../lib/classifier";
const probes = JSON.parse(
  await fs.readFile(
    "../tmp/harborcheck-comparison-20260920/probe-cases.json",
    "utf8",
  ),
);
const results = [];
for (const probe of probes.document_cases) {
  const docs = await Promise.all(
    ["si", "bl"].map(async (side) => {
      const fields = [
        ["Shipper", "ALPHA EXPORT LTD"],
        ["Consignee", probe[`${side}_consignee`] ?? "BETA PAPER LTD"],
        ["Notify Party", probe[`${side}_notify`] ?? "BETA PAPER LTD"],
        ["Port of Loading", probe[`${side}_loading`] ?? "SINGAPORE"],
        ["Port of Discharge", "PORT KLANG"],
        ["No. of Containers", probe[`${side}_count`] ?? "2"],
        ["Gross Weight (KG)", probe[`${side}_weight`] ?? "1000 KG"],
      ];
      return parseDocument(
        `${side}.txt`,
        new TextEncoder().encode(
          `${side === "si" ? "SHIPPING INSTRUCTION" : "BILL OF LADING (DRAFT)"}\n${fields.map(([k, v]) => `${k}: ${v}`).join("\n")}`,
        ),
      );
    }),
  );
  const result = analyze(
    {
      email_id: probe.id,
      from: "test@example.invalid",
      subject: "Check draft BL",
      body: "Please compare the attached SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    docs,
  );
  results.push({
    id: probe.id,
    expected: probe.expect_status,
    actual: result.status,
    passed: result.status === probe.expect_status,
  });
}
for (const probe of probes.email_cases) {
  const result = classify({
    email_id: probe.id,
    from: "test@example.invalid",
    subject: probe.subject,
    body: probe.body,
    attachments: [],
  });
  results.push({
    id: probe.id,
    expected: probe.expect_category,
    actual: result.category,
    passed: result.category === probe.expect_category,
  });
}
const report = {
  engine: "3.0.0",
  scope:
    "Same 12 targeted diagnostic probes as the prior HarborCheck comparison; not an unbiased benchmark.",
  passed: results.every((r) => r.passed),
  results,
};
await fs.writeFile(
  "work/validation/v3/comparison-probes.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
if (!report.passed) process.exitCode = 1;
