import { test } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitive,
  sensitiveFindings,
  sensitiveMessage,
} from "../lib/assistant-privacy";

test("secrets and personal identifiers are detected and removed", () => {
  for (const [question, kind] of [
    ["my password is Hunter2024", "password or one-time code"],
    ["token sk-proj-abcdefghijklmnopqrstuv123", "access key or token"],
    ["client secret GOCSPX-abcdEFGHijkl123456", "access key or token"],
    ["card 4111 1111 1111 1111", "payment card number"],
    ["my IC 050604-10-1234", "IC or passport number"],
    ["bank account 1234567890", "bank account number"],
  ] as const) {
    assert.deepEqual(sensitiveFindings(question), [kind], question);
    const redacted = redactSensitive(question);
    assert.match(redacted, /\[removed\]/, question);
    assert.doesNotMatch(
      redacted,
      /Hunter2024|sk-proj|GOCSPX|4111|050604|1234567890/,
      question,
    );
  }
});

test("shipping references and ordinary questions are not mistaken for secrets", () => {
  for (const safe of [
    "invoice 5250074586",
    "EGLV754781291428",
    "OOLU5310033092",
    "what password is required for the portal",
    "PO_25_2186 and PO 26067",
    "5RFR-36541 gross weight 22,000 KGS",
    "which customer keeps sending wrong BLs lately?",
  ])
    assert.deepEqual(sensitiveFindings(safe), [], safe);
  assert.equal(redactSensitive("no secrets here"), "no secrets here");
});

test("the refusal message names what was found and where it stopped", () => {
  assert.match(
    sensitiveMessage(["IC or passport number"]),
    /^This looks like it contains an IC or passport number, so it was not used, saved or sent anywhere\./,
  );
  assert.match(
    sensitiveMessage(["payment card number", "access key or token"], "server"),
    /a payment card number and access key or token, so nothing was sent to AI or saved/,
  );
});
