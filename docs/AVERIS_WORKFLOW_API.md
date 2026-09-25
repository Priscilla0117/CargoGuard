# Local workflow acceptance

Start the current build with **demo authentication and a separate local test database**. Do not use an employee workspace or production database. The script refuses remote hosts and non-demo authentication, creates its own workspace cookie, uses synthetic documents, and sends no email or AI requests.

From the repository root, point it at the already-running local server:

```powershell
node --import tsx scripts/test-averis-workflow-api.ts http://127.0.0.1:3066
```

It performs at most 45 HTTP requests and prints a JSON report with each completed assertion. A failed assertion exits with a nonzero status; no failed mutation is automatically retried. Test cases remain in the isolated demo workspace for inspection.

Coverage: immutable PDF downloads and fingerprints; unsupported reading corrections staying in review; correction retention on first pair selection; issuer BL replacement retaining only unchanged-source corrections; confirmed requests before Waiting and retained deadlines; completion with an unrelated invoice; deferred invoice/spam documents reparsed after explicit BL routing; import-key retry deduplication; private correction data excluded from inbox summaries.
