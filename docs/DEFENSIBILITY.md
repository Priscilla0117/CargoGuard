# CargoGuard 3.0.1 — technical defensibility record

21 September 2026. This is an engineering release record, not a promise of first place or zero future bugs. See CLOUD_RELEASE.md for the actually deployed version and hosted checks.

## Concrete failures repaired

| Failure mode | Change and regression evidence |
| --- | --- |
| `Gross Weight (MT): 42` could compare as 42 kg | Preserve header units; 42 MT vs 42 KG is a discrepancy, 42 MT vs 42,000 KG matches, conflicting/unsupported units require review. |
| Punctuation-only or unit-suffixed blanks could look like valid matching values | Treat them as unknown, not verified. |
| Cached Excel formulas might be stale | Formula/error cells require an inspected values-only export. The app does not pretend to recalculate workbooks. |
| Extra unidentified attachments could be ignored | Unknown companion documents require review. |
| Parcel-payment phishing could borrow an invoice subject | Added a specific body-based quarantine signal with legitimate-message controls. |
| Unauthorized writes consumed request bodies first | Origin/workspace checks now precede buffering; unsupported upload media types rejected early. |
| Duplicate multipart fields disagreed about upload versus replacement | Reject duplicate scalar control fields. |
| Huge revision selectors caused database failures | Validate safe positive integer revisions before database access. |
| Delayed case/revision responses could replace a newer selection | Request-generation guards; closing a drawer invalidates responses. Inbox result merges cannot downgrade newer revisions. |
| Uploading before the first inbox response could hide the rest of the workspace | New verification and Run inbox require a successfully loaded inbox; failed initialization remains blocked until Refresh succeeds. |
| Repeated policy-load retries could overwrite newer edits | Single-flight loading prevents overlapping policy initialization/retries. |
| Original-file links could fetch a newer source than the displayed decision | Pin original downloads and OCR reads to the displayed revision. |
| PDF standard-font/CMap resources were absent, and default file-URL paths failed in Node | Install the PDF resources and resolve native paths explicitly. An isolated Symbol-font regression checks real extraction without resource warnings; source PDFs are not altered. |
| Failed policy loading displayed default v0 as if it were confirmed | Display “not yet loaded,” disable preview until loaded, offer retry. |
| The 45-second client deadline was shorter than a normal free-host wake-up | Allow 90 seconds while retaining explicit error handling and no automatic write retries. This does not eliminate cold starts or guarantee availability. |
| Previous quality gate omitted an inherited test file | Discover every `.test.ts` file. Record exact file list and fail closed. Conflicting inherited expectations were reconciled conservatively, not silently ignored. |
| Local/hosted agreement was insufficient proof of accuracy | New independent gate checks exact ID/schema/outputs against the supplied answer key and invokes the unmodified organiser scorer; failures exit nonzero. Actual HTTP exports are retained for separate scoring. |
| Known dependency advisories remained installed | Patch React/DOM/RSC to 19.2.8, Vite to 8.0.16, `ws` to 8.21.0 and compatible affected transitives. Production npm audit: zero known vulnerabilities; full development tree: six affected packages (four moderate, two low), no high/critical. This is not a penetration-test certificate. |

The ws update follows the maintainer's [memory-exhaustion advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) and [memory-disclosure advisory](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx).

The remaining development-only findings come from esbuild in the deprecated Drizzle loader and legacy Wrangler toolchain: [development-server response exposure](https://github.com/advisories/GHSA-67mh-4wv8-2f99) and [Windows dev-server source exposure](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). These servers are not the deployed Next.js runtime. Do not expose them. Breaking downgrades, major overrides and an alpha Cloudflare dependency chain were deliberately not used merely to silence audit output. Audit findings are time-specific and need rechecking before each release.

PDF resources are pinned to `pdfjs-dist` 6.2.108. Its 16 standard-font files and 169 CMaps were checked byte-for-byte against the resource version expected by `unpdf`. The latest installed `unpdf` 1.8.1 still vendors PDF.js 6.1.200; npm audit does not enumerate that embedded engine. The [Mozilla scripting advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) requires enabled PDF viewer scripting. Current CargoGuard calls text extraction and canvas rendering only: it does not import PDFViewer/ScriptingManager or execute PDF JavaScript actions. This is a code-path assessment, not a penetration test or a claim that the embedded engine was upgraded. Do not add viewer scripting without a patched engine and renewed review. The two intentionally malformed organiser PDFs still emit recovery diagnostics and correctly require review; logs are not claimed to be warning-free.

## What the evidence means

- 197 tests in eleven files passed with zero failures/skips, including 21 new parser/comparison probes, 23 API-boundary tests, four client-ordering checks, six evaluation-gate tests and two PDF resource tests. The earlier “126 tests passed” described an incomplete selection, not every inherited test.
- All 770 organiser inputs (520 email records and 250 documents) were checked against both supplied copies.
- Original development corpus: 520/520 exact output records, 46/46 defect cases and 20/20 review cases; the supplied official composite scorer returned 1.0.
- Original plus four previously used generator seeds: 2,600/2,600 exact output records, zero false-OK decisions in these checks. These are development sets, not an independent real-world holdout.
- Learned-model-only macro-F1 is 0.7282; hybrid macro-F1 is 1.0 on the supplied corpus. The hybrid uses 391 rule decisions and 129 model decisions. Do not call the hybrid result “AI-only 100%.”
- Scanned PDFs still require seven human confirmations. OCR confidence is not proven transcription accuracy.
- Unit tests cover ordering primitives; browser checks must separately confirm the integrated UI. No sustained public-load, penetration-test or enterprise security certification is claimed.

## Reproduce the acceptance gate

Install the locked dependencies with `npm ci`. Keep the supplied organiser folders outside the app repository. From the app root, set `CARGO_ORGANISER_BUNDLE` to the supplied bundle folder and `CARGO_ORGANISER_DOCKER_DATA` to the Docker `data_v2` folder if they are not sibling defaults. Set `CARGO_PYTHON` if `python` is not on PATH. Then run:

```text
npm run quality -- --build
node scripts/test-api.mjs https://YOUR-HOST
node scripts/test-hardening-api.mjs https://YOUR-HOST
node scripts/test-governance-api.mjs https://YOUR-HOST
node scripts/test-release-api.mjs https://YOUR-HOST
node scripts/verify-evaluation.mjs --predictions work/validation/http-submission.json --truth /path/to/data_v2/ground_truth.json --scorer /path/to/server/scoring.py --python /path/to/python --engine 3.0.1 --report work/validation/hosted-accuracy-gate.json
```

The gate stores logs, enumerated tests and hashed aggregate evidence under ignored `work/validation/`. The HTTP scripts create synthetic test workspaces; run only against an authorized host. Answer keys and per-ID predictions are not application runtime inputs. The public report contains only aggregate evidence and hashes.

Do not claim release acceptance from an old report: verify `complete: true`, every step passed, the current engine version, input hashes and actual hosted health. A failed command is a failed gate even if an older report remains on disk.

## What a defensible demo demonstrates

Show a real discrepancy and its original source; recover an unreadable case without auto-approval; make a reasoned correction; inspect the previous revision and exact original file; preview a weight tolerance and show that it never changes the strict defect verdict. Export the automatic baseline separately from human-reviewed evidence. This supports end-to-end behavior, robustness and traceability without inventing production ROI.

## Remaining boundaries

Free hosting may sleep. Database access depends on a renewable 30-day token. Workspaces use browser cookies, not corporate SSO; reviewer identities are self-declared. There is no comprehensive global abuse prevention, antivirus, guaranteed backup, durable processing queue or corporate-email connector. Only organiser/synthetic data belongs in this public demo. Real deployment needs authenticated staff roles, approved data handling and a frozen independently labeled holdout before further tuning.

Repository visibility, permitted development timing, required AI/third-party attribution, video and final submission remain team responsibilities. Strong technical evidence improves the case; it cannot determine judges' rankings.
