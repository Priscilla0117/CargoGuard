# CargoGuard 3 — technical upgrade and remaining release gate

Date: 20 September 2026. This is an implementation addendum to the earlier CargoGuard v2 versus HarborCheck review. It does not replace that historical comparison or claim that HarborCheck has been retested or changed.

**Historical pre-deployment report.** The deployment status below records this report's original date. The independent public deployment subsequently succeeded on 21 September; see [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for current hosted evidence and remaining limits.

## Bottom line

CargoGuard is stronger than its previously reviewed version: the reproduced classification and port-comparison defects are fixed, decisions now retain complete revision evidence, business-tolerance settings are versioned and previewed safely, and the default application can run independently of ChatGPT Sites.

The new version is **locally verified, not independently deployed yet**. Render and Turso accounts, a real deployment, and the hosted acceptance gate remain required. The old public v2 site and its saved data were not changed. No provider account, paid service, GitHub push, or new public URL was created in this upgrade.

No honest test report can guarantee first place, zero future bugs, or correctness on every unseen shipping document. This report records what passed and what still needs evidence.

## What changed and why it matters to Averis

| Earlier weakness | CargoGuard 3 implementation | Business benefit and boundary |
| --- | --- | --- |
| Misleading invoice/reminder subjects could override the current message; a promotional message was misrouted in the comparison seed. | Strong current-body intent and promotional evidence are handled before stale subject cues. | Fewer avoidable queue mistakes on the reproduced cases; unknown requests still need human review. |
| A matching optional port code could cause a false discrepancy. | Field-specific equivalence for a small, explicit set of matching port-name/code pairs. Unknown or contradictory codes are not discarded. | Avoids unnecessary rework without treating every similar-looking location as equal. |
| Audit events were not a complete view of historical decisions. | A successful case write, full result snapshot and audit event commit together. Read-only history includes source hashes, values, policy and original source links. | A reviewer can explain what changed, who claimed to change it, and which evidence supported the decision. Reviewer names are self-declared, not verified corporate identities. |
| Tolerance settings and their effect were not visible as a controlled workflow. | Policy laboratory with preview, required reviewer/reason, immutable versions, stale-preview rejection and concurrency checks. | Operations can explore bounded weight tolerances while seeing their effect before activation. |
| Business exceptions risk obscuring objective mismatches. | Strict seven-field results remain intact; a separate policy annotation describes any eligible weight exception. Missing or uncertain evidence is never covered by tolerance. | A tolerance is not a false “verified” result or an automatic release approval. |
| Human-reviewed results could be confused with automatic benchmark performance. | Separate automatic-baseline and explicitly labelled reviewed-evidence exports. Full automatic export requires all 520 untouched current-engine baseline records. | Judges can distinguish engine accuracy from human-assisted correction. Old missing history is never invented. |
| Deployment depended on the previous hosting integration. | Standard Next.js/Node runtime, persistent libSQL adapter, migrations, health check and Render configuration. | A separately hosted URL is possible; actual cloud persistence and capacity still need remote verification. |

Retained capabilities include original-source upload and replacement, PDF/DOCX/XLSX/TXT extraction, conservative uncertainty handling, browser OCR with explicit human confirmation, workspace isolation, stale-edit protection, and exportable evidence. HarborCheck's code was not copied or modified.

## Verified results

The checks below ran on the local production build with a persistent local libSQL database, except the explicitly offline dataset evaluation. They are not tests of Render or a remote Turso service.

| Check | Result | Evidence |
| --- | --- | --- |
| Unit and regression suite | 126 passed | `work/validation/unit-tests.log` |
| Baseline HTTP integration | 72 passed | `work/api-test-report.json` |
| HTTP hardening | 35 passed across 73 requests | `work/validation/local-hardening-api.json` |
| Governance HTTP integration | 23 passed | `work/validation/v3/governance-api.json` |
| Original organiser dataset | 520/520 exact output matches | `work/validation/v3/original/score.json`, `submission.json` |
| Original plus four generated development datasets | 2,600/2,600 exact matches; no false clearances in these sets | `work/validation/v3/exact-evaluation.json` |
| Same targeted probes used in the earlier comparison | 12/12 passed, versus v2's recorded 9/12 | `work/validation/v3/comparison-probes.json` |
| Organiser input integrity | 520 emails and 250 documents checked against both supplied copies and embedded app data | `work/validation/input-integrity.log` |
| Type checking, lint, OCR asset staging and production build | Passed | `work/validation/quality-gate.json` and step logs |

The original official scorer reports a composite of 1.0, with 46/46 defective BL cases detected and 20/20 review cases identified. That is a dataset score, **not** a hackathon judging score.

The five datasets are supplied or generated from the same organiser generator. The extra comparison seed helped diagnose a defect before this release, so it is development data, not an untouched holdout. The 12 probes are targeted diagnostic cases, not an unbiased head-to-head benchmark. These results do not establish real-world 100% accuracy or overall superiority over every other team.

Browser checks covered all 520 cases, policy preview and activation, preservation of the old policy on existing results, full historical evidence, and scanned-document OCR. OCR suggestions remained unconfirmed and could not be saved without the required human checks. After stopping and restarting the production server, the same browser retained all 520 processed cases and the activated test policy. All 130 HTTP checks also passed again against the restarted final build. No browser warning/error logs were recorded in the checked workflow. This is not exhaustive browser/device certification or evidence of remote-cloud persistence.

## How this supports the judging criteria

- **Core functionality and effectiveness:** five-category triage, all seven comparison fields, safe treatment of missing/unreadable data, and measurable organiser-data performance.
- **Architecture and integration:** transactional storage, versioned policies, explicit exports, durable-source design and an independent deployment path. Cloud integration remains provisional until the live gate passes.
- **Robustness and validation:** reproducible tests for concurrency, cross-workspace access, stale edits, replacement, malformed uploads, OCR confirmation and immutable history.
- **User experience and differentiation:** source-linked evidence, controlled policy experiments and transparent separation between automatic decisions and human intervention.
- **Business impact:** a credible workflow for reducing manual checking and avoiding unsafe clearance. Monetary savings, staff time saved and production throughput must be measured in a pilot, not invented from synthetic accuracy.

The public repository, README, required video/slides and submission steps remain separate deliverables. Technical improvements do not waive the organiser's submission rules.

## Free hosting decision

For this version, the recommended trial deployment is **Render Free + Turso Free with a libSQL-compatible database**. This is a fit-for-current-design recommendation, not a claim that it is universally the best provider.

Vercel is a capable Next.js host, but [Hobby restricts use to personal, non-commercial projects](https://vercel.com/docs/plans/hobby), and [Functions have a 4.5 MB request/response limit](https://vercel.com/docs/functions/limitations). CargoGuard accepts paired uploads of up to 5 MB each. Vercel therefore needs an upload-path redesign and a plan-eligibility check; unchanged deployment would not justify claiming the current upload contract works.

[Render Free](https://render.com/docs/free) avoids that particular function payload constraint but sleeps after 15 minutes of inactivity and can take about a minute to wake. Its disk is temporary, which is why live data must go to the external database. [Turso Free](https://turso.tech/pricing) has quotas: do not enable paid upgrades or overages. No free-tier recommendation is an uptime guarantee.

## What must happen before sharing the new link

Follow [DEPLOYMENT.md](DEPLOYMENT.md). You must create/sign in to the provider accounts and accept their terms yourself. Keep passwords and database tokens out of chat and source control.

The acceptance gate must verify all three HTTP suites against the real HTTPS URL, all 520 cases in the browser, remote transaction behavior, maximum-size binary uploads/downloads, browser OCR, two-workspace isolation, stored evidence after restart/redeploy/idle wake-up, and actual latency/memory. A local SQLite/libSQL pass does not prove those remote properties.

The demo is not an enterprise production release: it still lacks corporate SSO, verified role permissions, antivirus, a durable job queue, formal retention/backup guarantees and comprehensive global abuse protection. Database revision triggers are not certified tamper-proof storage against database administrators. Use synthetic/organiser examples, not confidential live cargo documents.

Keep the old site until the independent deployment passes. Do not silently migrate or discard its saved work; browser workspaces do not transfer across domains. A neutral URL is appropriate, but retain licences and answer questions about AI-assisted development honestly.
