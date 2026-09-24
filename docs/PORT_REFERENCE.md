# UN/LOCODE port-code reference check

**External dataset:** UN/LOCODE release **2024-2**, published by UNECE. It is loaded from the public-domain packaging at [datasets/un-locode](https://github.com/datasets/un-locode) (licence ODC-PDDL-1.0). The compact snapshot is `lib/reference/unlocode.json` (≈710 KB). It holds 18,506 entries with a port or unknown function, including names, plus 97,707 other codes listed without names. The file records the SHA-256 of both source CSVs. Rebuild it with:

```sh
node scripts/build-port-reference.mjs <folder containing code-list.csv and country-codes.csv> 2024-2
```

## Why it exists

The SI is the reference for the seven-field check. So if the SI itself carries a wrong port code, a comparison can only confirm that the BL copied it. Most port entries include a five-character UN/LOCODE, e.g. `PORT KLANG (WESTPORT), MALAYSIA (MYPKG)`. That code is a second, independent statement of the port, and it can be checked against a public register.

## What each result means

| Result | Rule | Why this status |
|---|---|---|
| **Issue found** | The code's country prefix differs from the stated country, e.g. `TUTICORIN, INDIA (KEMBA)`: KE is Kenya, and UN/LOCODE lists KEMBA as Mombasa | This is an internal contradiction in one document, not a matter of opinion. It is the only port-reference result that stops batch completion. |
| **Review** | The code is not in the snapshot (`JOAQB`), or the listed name differs from the stated name (`IDBUA` is listed as *Bula*, not Buatan) | These are advisories. A snapshot can be older than a new code, and local terminal names can differ. They do not block batch completion. |
| **Check passed** | The code exists with a port function, its country agrees, and one of its listed names appears in the stated name | This confirms consistency with the register only. It does not validate routing, carrier service or booking. |
| **Not checked** | No code stated; the parenthesis does not start with a country code; the value is unavailable; or the code is listed **without** a seaport function (e.g. `CNSHA`, which UN/LOCODE 2024-2 lists as Shanghai Hongqiao airport while trade documents commonly use it for Shanghai port) | The check does not guess. A missing comparison is never reported as a pass. |

Findings sit in their own panel under **Independent checks**, both in the work queue and on the shipment desk. They never change the seven-field result, the organiser submission output or the frozen operations-challenge expectations. `checkDocumentIntegrity` and its rule version `1.0.0` are unchanged.

## Result on the organiser inbox

`node --import tsx scripts/evaluate-port-reference.ts` reads only inbox records and attachments; no answer key is used.

| Measure | Value |
|---|---:|
| Cases with an SI/BL comparison | 114 |
| Port values checked (SI and BL, loading and discharge) | 456 |
| Check passed | 287 |
| Issue found (country contradiction) | 16 |
| Review (unknown code or reference-name difference) | 23 |
| Not checked | 130 |
| Issues on cases the seven-field check verified | **0** |
| Issues outside a seven-field port mismatch | **0** |

All 16 contradictions are in draft BLs whose port already mismatched the SI. For those rows, the check adds a diagnosis: whether the BL changed the name but kept the SI's code, or the reverse. That tells the employee exactly which part of the port to ask the issuer to correct.

The 23 review advisories are data observations, not claimed errors:

- `JOAQB` (Aqaba) is used by both SI and BL in 2 values. It is absent from UN/LOCODE 2024-2, whose Aqaba entry is `JOAQJ` (Al 'Aqabah).
- `IDBUA` is used for Buatan in 21 values, including 8 verified cases where both the SI and BL say it. UN/LOCODE lists `IDBUA` as Bula, Indonesia.

Neither advisory changes a verdict or blocks batch completion.

## Known limits

- Name agreement is lenient: any listed name, or part of one, of at least four characters must appear in the stated name, or the other way round. A wrong code that shares such a fragment with the stated name can pass.
- A five-character parenthesis whose first two letters form a country code is read as a code. For example, `(NORTH)` would be read as Norway plus `RTH`. Such a code is then reported as not found, which is an advisory.
- Only a trailing `(CODE)` or a value that is only a code is read. Codes written elsewhere are not checked.
- Country names are resolved from the register plus common trade spellings (US, UAE, South Korea, Vietnam, Turkey, …). Ambiguous short forms such as “Korea” or “Congo” are deliberately left unresolved.
- Tests: `tests/port-reference.test.ts` and `tests/batch-review.test.ts`.
