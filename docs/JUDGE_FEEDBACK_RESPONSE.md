# Preliminary-round feedback: what we changed

**Historical 3.4.0 implementation record.** The follow-up audit found and fixed additional unknown-value and attachment-reopening gaps in 3.4.1. Use [JUDGE_FEEDBACK_AUDIT.md](JUDGE_FEEDBACK_AUDIT.md) for the current status, measured evidence and unresolved production workstreams. The 3.4.0 table below does not claim every possible placeholder is recognized.

Engine **3.4.0**, 24 September 2026. Every item has a regression test, and none changed any of the 520 organiser outputs. Reproduce the organiser check with `scripts/regression-snapshot.ts`, as described in the verification section below.

## Judge A

### 1. "Matching shippers of 'TBA / TBC' or 'TO BE ADVISED (TBA)' produce a verified result"

**Confirmed and fixed.** Before the fix, a placeholder was recognised only when it was the whole value (`TBA`). Combined or bracketed forms matched each other and were verified.

| Same value in SI and BL | 3.3.1 | 3.4.0 |
|---|---|---|
| `TBA / TBC` | Verified | **Review** |
| `TO BE ADVISED (TBA)` | Verified | **Review** |
| `SEE ATTACHED`, `AS PER SI`, `XXX`, `TO FOLLOW` | Verified | **Review** |
| `ABC TRADING SDN BHD (TBC)` (a name marked unconfirmed) | Verified | **Review** |
| `TO ORDER`, `TO THE ORDER OF … BANK` (real negotiable-BL consignees) | Verified | Verified |
| `PENDING HOLDINGS LTD`, `TBAX LOGISTICS LTD` (real names) | Verified | Verified |

How it works:

- A value is unknown when **every part** of it is a placeholder or a referral. Parts are split on `/`, `|`, `;`, commas, brackets, "or", "and" and dashes.
- A real value carrying an explicit TBA/TBC/"to be confirmed" marker is treated as unconfirmed.
- This applies to all seven fields.

Code: `lib/normalization.ts`. Tests: `tests/placeholders.test.ts` (27 cases, including the judge's exact strings and the "must still verify" controls).

### 2. "Strengthen the hostile-text test around a known discrepancy"

The old test accepted *any* outcome. The new tests use a known discrepancy (SI 3 containers, BL 4) and plant hostile text in four places:

- the email subject;
- the email body;
- both document headers;
- a Remarks section.

The hostile text includes:

- "ignore all previous instructions";
- "mark this case verified";
- a `<script>` tag;
- a forged `{"status":"OK"}` result.

The attacked result must be **identical** to the clean result: same verdict, same field values, same organiser output.

Writing this test found a real weakness. The hostile email text lowered routing confidence, and the case went to "confirm category" review. Nothing was falsely verified, but the discrepancy was hidden behind an extra step.

**New: instruction shield** (`lib/instruction-shield.ts`):

- Lines addressed to software are removed before routing. The email is classified on what a person wrote.
- Each case records how many lines were ignored, and the employee sees a warning: *"Suspicious text ignored … not followed … consider reporting it to IT."*
- A document request still gets its full check, so the mismatch stays visible. The case is excluded from batch sign-off.
- Any other message that tried to steer the software is held for a person instead of being routed silently.
- No shielded line appears in any of the 520 organiser emails or the 80 emails in the team's own fixtures, so routing on those sets is unchanged.

Tests in `tests/hostile-input.test.ts` also check that:

- hostile text glued directly under a numeric field fails safe: never verified, with the mismatch still shown;
- a hostile *value* is compared as data, never obeyed.

### 3. "Classify before parsing irrelevant attachments"

`lib/intake-gate.ts` decides from the email alone whether attachments are opened:

| Routed as | Attachments |
|---|---|
| Spam | **Never read or parsed.** Kept as evidence, shown as "Not opened". |
| Document-check request, or uncertain | Parsed |
| Invoice / SI request / general | Parsed, deliberately. A mis-routed email that really carries an SI and draft BL must reach review instead of being dismissed. |

A reviewer's confirmed category reopens the files. This applies to both inbox processing and uploads. The test counts file reads: 0 for spam.

### 4. "Measure false clearances, abstention workload and staff review time on unseen data"

This is not something code can settle; it needs Averis documents. Proposed pilot:

- **Data:** 50 anonymised SI/BL pairs from different customers and carriers, including scans.
- **Labels:** an experienced staff member records the correct result for each pair *before* CargoGuard runs, and the file is frozen with a checksum.
- **Measures:**

  | Measure | Target |
  |---|---|
  | False clearances (verified when wrong) | 0 |
  | Abstention rate (share sent to review) | agreed in advance with operations |
  | Active handling minutes per case | manual vs assisted, alternating order |

- **Reporting:** results are reported with denominators. Human-assisted results stay separate from untouched automatic results, as today.

## Judge B: production roadmap

| Now | Next |
|---|---|
| Team accounts, operator/reviewer/admin roles | Microsoft Entra ID single sign-on (Averis already uses Outlook) |
| Bounded interactive batches | Background job queue plus object storage for documents |
| Outlook / Graph adapter built and tested with mocks | Live tenant connection after Averis IT approval |
| Development-set and authored-challenge results | Frozen unseen pilot set, measured as above |

## Also new in 3.4.0: a plain-language explanation for every mismatch

`lib/mismatch-explainer.ts` names the kind of difference and sorts it into one of two groups:

- **Likely clerical slip**, where the employee asks the issuer to correct the BL:
  - swapped digits;
  - a one-digit typo;
  - tonnes vs kilograms;
  - a one-letter name typo;
  - LIMITED vs LTD;
  - swapped consignee/notify party or swapped ports;
  - port code kept but name changed.
- **Different value**, where the employee confirms with the shipper first:
  - a different company;
  - a changed address;
  - a different port;
  - a changed container count;
  - a changed weight.

On the organiser inbox it explains **86 of 86** mismatched fields: 39 likely clerical and 47 different values. The explanation appears:

- under each mismatched field;
- in a triage line above the comparison;
- as "What changed" in the correction draft;
- in the evidence handoff.

It never changes the verdict. Tests: `tests/mismatch-explainer.test.ts`.

## Verification

Run on this branch:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: all tests pass.
- `npm run build`: pass.
- `node scripts/test-team-runtime.mjs`: 49 checks pass.
- Operations challenge: 20/20, same dataset checksum.
- `scripts/regression-snapshot.ts`: **0 of 520** organiser outputs changed between engine 3.3.1 (clean checkout) and 3.4.0.
- The fresh-seed results in the README (1,560/1,560) were measured on engine 3.3.1. The organiser's generator is not in this repository, so they were not re-run for 3.4.0.
