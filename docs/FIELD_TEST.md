# Field-test mailbox (our own dataset)

The organiser inbox is produced by one generator, so every team scores close
to 100% on it. To see how CargoGuard behaves on email that looks like Averis's
real traffic, we wrote our own mailbox: **28 emails** in `lib/field-test.ts`.

## What it contains

| Situation | Emails |
| --- | --- |
| One order discussed over 5 emails (`5RFR-36541`: SI request → draft BL with 2 errors → revised BL with a new error → final BL → invoice question) | ft_01–ft_05 |
| Urgent SI chase with a cut-off tomorrow, then a second reminder | ft_06–ft_07 |
| Same values written differently (`TWO (2) X 40' HC` vs `2 x 40HC`, `18.5 MT` vs `18,500 KGS`) | ft_08, ft_27 |
| BL missing, then resent with a real difference | ft_09–ft_10 |
| PDF where the label and value are one text run (common PDF writer output) | ft_11 |
| Invoice questions and chases ("cargo is on hold", "advise today") | ft_05, ft_12–ft_14, ft_28 |
| Scanned PDF with no text | ft_15 |
| Conversation linked only by reply headers (no order number in the subject) | ft_16–ft_17 |
| Weight also changed in the BL remarks | ft_18 |
| Extra commercial invoice attached next to the SI and BL | ft_19 |
| Berthing report, office closure, planning mail | ft_20–ft_22 |
| Phishing, spam and a fake "invoice overdue" | ft_23–ft_25 |
| SI request with a PO number and deadline; a very short informal request | ft_26–ft_27 |

Every email is a real `.eml` message with `Date`, `Message-ID`, `In-Reply-To`
and `References` headers and real PDF/Word/text attachments. Dates are written
relative to "today", so the practice inbox always looks current.

## Try it

- **In the app:** Inbox → *Import email* → *Load 28 practice emails*.
- **As files:** drag any of `examples/field-test/mailbox/*.eml` into *Import email*.
- **Measure:** `node --import tsx scripts/evaluate-field-test.ts --write`
  (writes `public/field-test.json`, shown under *Reports → Accuracy tests*).

## Results (engine 3.3.1 plus the changes in this branch)

| Check | Result |
| --- | --- |
| Email files read (date, headers, attachments) | 28 / 28 |
| Email type correct | 28 / 28 |
| Email type correct **without** asking a person | 26 / 28 |
| Document check outcome (OK / mismatch / needs review) | 13 / 13 |
| Exact set of differing fields | 4 / 5 |
| No false alarm on matching documents | 5 / 5 |
| Conversation pairs grouped / wrongly joined | 14 / 14 · 0 |
| Urgent emails ranked at the top of the plan | 4 / 4 |
| Deadline found in the email text | 6 / 6 |

### Mistakes we still make (not hidden)

1. **ft_02** — the BL has the wrong consignee and its notify party says
   "SAME AS CONSIGNEE". CargoGuard resolves that phrase to the (wrong)
   consignee, so it also flags *notify party*. Defensible, but it double-counts
   one error. The comparison and the reply draft now say so plainly ("will be
   correct once the consignee is amended") instead of asking to change
   identical text.
2. **ft_06, ft_14** — short chase emails ("still waiting…", "SI needed ASAP").
   The type is right, but the router asks a person to confirm it. Safe, slower.

### What this dataset made us fix

The first run scored **9 / 13** on document outcomes and **1 / 5** on
matching documents. It exposed real weaknesses, which we fixed without changing
a single one of the 520 organiser results (checked with a before/after
comparison of every output):

- `TWO (2) X 40' HC` style container counts are now read (words and digits
  must agree, otherwise the value is flagged).
- PDF rows such as `Gross Weight (KG)   42,500 KG` (label and value in one text
  run) are now split into label and value.
- One readable SI plus one readable draft BL now settles an uncertain email
  type between close candidates (never overriding spam or mixed requests).
- A recognised commercial invoice or packing list next to the SI and BL no
  longer blocks the check; it is kept and named, and the check still stops if
  that extra document states a different weight or container count.

Two failures in the first run were mistakes in **our test data** (a tonnes value
printed under a "(KG)" heading, which is genuinely contradictory). The system
was right to flag them; we fixed the data.

## Honest limits

Because we used this set to find and fix problems, it is no longer a blind
test. The next step is a held-out set: export 30–50 real, anonymised Averis
emails as `.eml`, write the expected outcome for each, and run the same script.
