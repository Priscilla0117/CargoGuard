> Historical release document retained from the existing repository. For the current employee feature branch, verified results and rollout requirements, see [EMPLOYEE_RELEASE.md](EMPLOYEE_RELEASE.md).

# CargoGuard — written responses

Expanded submission answers for judges and technical reviewers. [Back to the visual overview](../README.md).

## 1. Problem-solution alignment

Averis shipping operations staff receive a mixed inbox: document-checking requests, shipping instructions, invoice queries, general messages and spam. For checking requests, they must compare two documents that may use different headings and layouts, identify the precise differences and decide what to request next.

CargoGuard determines the email category before shipment-field extraction and comparison. Attachments may already be parsed for text and routing context, but only comparison requests continue to field extraction and checking. The SI is the reference for seven fields: **shipper, consignee, notify party, port of loading, port of discharge, container count and gross weight in kilograms**. The report identifies the email, displays the two values and their sources, and distinguishes mismatches from missing or unreadable evidence. A person can inspect, confirm or correct information and obtain an updated report.

Useful additions address handover and review: explicit source-pair selection, a linked-field correction preview, retained decision history, a checked amendment draft and evidence-linked case chat. Other email categories are classified only; the prototype does not fulfil invoice requests or generate shipping instructions.

## 2. AI and cloud infrastructure integration

The main email router is a trained **TF-IDF multinomial logistic regression model** with word, word-pair and character features. It runs on the server without an API key. Training uses independently authored synthetic examples, not the organiser answer key. Safety checks can abstain when intent is unclear.

On the 520 supplied development emails, the current router made 513 direct learned decisions and seven learned decisions corroborated by an agreeing rule. A rule cannot replace the learned category. These counts describe routing paths, not a separate benchmark score. See the [model evidence and limitations](MODEL_CARD.md).

**Render** runs the Next.js/Node.js server and document pipeline. **Turso/libSQL** persists case results, original small uploads, revisions and review events. **OpenAI** supports optional source-quoted field recovery and case-specific explanations through server-side calls after explicit consent. Recovery requires source validation and human confirmation; chat cannot change saved decisions. **Tesseract.js** offers browser-local English OCR suggestions for scans.

Deterministic rules perform the final comparison. This keeps the core workflow usable when OpenAI is unavailable. Cloud services perform real processing and persistence, not just static-page hosting.

## 3. User feedback and testing

We used automated unit/integration tests, organiser-supplied inputs, targeted synthetic challenges and browser walkthroughs. The recorded laptop checks cover multi-file intake, source selection, linked-field previews, saves, history, direct chat and layout at 1366 x 768 and 1280 x 720.

Development feedback led to changes: ambiguous company blocks now require review; a reproduced phishing-report routing error received a targeted fix; preview and save share the same calculation; stale saves are rejected; smaller queue responses and bounded read retries improve failure handling. These changes have regression coverage.

**We have not conducted an Averis employee usability study.** Developer/browser testing is not employee feedback, and no customer testimonial, adoption figure or time-saving percentage is claimed. A supervised pilot would observe staff completing real tasks with approved non-confidential documents, measure review time and missed differences, and record their feedback. See [test scope](REVIEW_WORKSPACE_V32.md#validation-and-limits).

## 4. Coding challenges / challenges faced

| Challenge | Implemented response | Evidence and boundary |
| --- | --- | --- |
| Several attachments could be the intended SI/BL pair | Explicit reviewer selection, file fingerprints, saved reason and visible exclusions | Intake/review tests; the reviewer still decides which draft is intended |
| One edit affects another field, such as “same as consignee” | Shared preview/save calculation and version-checked transactions | Dependent-field, preview/save-equivalence and stale-write tests |
| Database unavailability caused poor recovery behaviour | Separate process liveness from storage readiness; controlled failures and no automatic write replay | 12 recorded local fault checks; this does not remove provider outages |
| Large saved results made queue reads expensive | Fetch compact summaries and load full source evidence on demand | 706,990 versus 1,747,055 serialized bytes on supplied saved outputs: 59.5% smaller, not a claimed latency reduction |
| LLM recovery could select an incorrect or malformed value | Bounded output contract, verbatim source checks, unit validation and mandatory human confirmation | Dated real-provider development trials; quoting a source does not guarantee semantic correctness |

Implementation and incident details: [review workspace](REVIEW_WORKSPACE_V32.md), [AI recovery](MODEL_CARD.md), [failure handling and cloud validation](CLOUD_RELEASE.md).

## 5. Success metrics

The following are the **recorded 21 September 2026 release 3.2.1 results**, not a claim that all tests ran again today:

| Check | Recorded result |
| --- | --- |
| Actual cloud export, independently checked with the organiser scorer | 520/520 exact expected outputs on the supplied development corpus |
| Supplied edge cases | 46/46 defect cases and 20/20 review cases matched expected outputs |
| Unit tests | 350 passed; zero skipped |
| Local production HTTP checks | 228 passed |
| Local controlled storage-outage checks | 12 passed |
| Hosted checks | 170 HTTP acceptance checks plus seven retained-data checks = 177 |
| Original input integrity | 520 emails and 250 document byte sequences matched both organiser copies |

[Exact dated release evidence](CLOUD_RELEASE.md) separates local, hosted, provider and historical runs. [Verification report](SUBMISSION_CHECK.md) records the latest recheck without relabelling old results as new.

Four additional same-generator sets informed development. Including the original, 2,600 outputs matched, but they share templates and are **not independent real-world holdouts**. The separate 60-message routing challenge still exposes limitations, documented in [MODEL_CARD.md](MODEL_CARD.md). OCR and LLM proposals can be wrong.

We have not measured production ROI. Proposed pilot measures are median review time, missed discrepancies/false clearances, unnecessary review referrals, correction rounds and staff task completion. Organiser scoring is a development aid, not a judging score or a guarantee of unseen accuracy.

## 6. Scalability plans / future roadmap

| Phase | Proposed work | Acceptance evidence before expanding |
| --- | --- | --- |
| Supervised non-confidential pilot | Observe staff tasks; evaluate new document layouts and operator feedback | Review-time baseline, missed/false differences and documented task feedback |
| Controlled confidential use | Corporate SSO/RBAC, verified reviewer identity, malware checks, approved data-retention/deletion and provider data handling | Security/access tests, retention approval and operational ownership |
| Larger workloads | Durable job queues, retry/idempotency controls, managed object storage and monitored database capacity | Load tests with p95 latency, memory, backlog, recovery and cost measurements |
| Enterprise integration | Permissioned Outlook/SAP/carrier adapters and operational monitoring | Integration tests, auditability and business approval before any external action |

These are planned capabilities, not features already delivered. The current free-tier demo uses bounded batches and small-file database storage; it is not an always-on enterprise service.
