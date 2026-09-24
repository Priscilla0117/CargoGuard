# Gmail / Google Workspace pilot

The integration reads actual Gmail messages, imports selected messages as cases, keeps replies associated with their original Gmail thread, and sends a locally edited draft only after a separate human confirmation. Gmail synchronization and sending do not change the comparison verdict. AI text generation remains the optional, consented Ask CargoGuard workflow.

## Configure the pilot

1. In your Google Cloud project enable the Gmail API and create a **Web application** OAuth client. Configure the consent screen and allowed test users or your Workspace organization. Request only `gmail.readonly` and `gmail.send`. Do not add Gmail compose/modify scopes: drafts are stored locally and this application does not change mailbox labels.
2. Register the exact redirect URI `https://YOUR_HOST/api/gmail/callback`. Local testing can use `http://localhost:PORT/api/gmail/callback` or `http://127.0.0.1:PORT/api/gmail/callback` consistently with the configured public origin.
3. Set the following server environment variables through your hosting secret manager:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `CARGO_PUBLIC_ORIGIN` (exact public origin, no trailing slash)
   - `CARGO_GMAIL_ENCRYPTION_KEY`: a cryptographically random 32-byte key encoded as base64. Keep it stable across restarts; losing or changing it requires reconnection. Do not use the Google client secret as this key.
   - `CARGO_GMAIL_PILOT_WORKSPACE`: the specific existing browser workspace UUID approved by the owner.
   - `CARGO_GMAIL_PILOT_EMAIL`: the exact permitted Google mailbox email address.
   - `CARGO_GMAIL_ENABLED=true` only after setting the values above.
   - Optional `CARGO_GMAIL_LABEL_ID`: the Gmail label ID to use for intake, default `INBOX`. Use the label's provider ID (for example `Label_123`), not its display name. Reconnect to restart the initial scan after changing it.

4. Apply SQL migrations using `npm run db:migrate`, then deploy. Open the permitted workspace, choose **Connect Gmail**, and complete Google's consent screen. Other anonymous workspaces cannot access the mailbox endpoints. Missing configuration disables integration rather than falling back to an unprotected mailbox.

This deliberately bounded pilot does not implement app login. The authentication teammate must replace the explicit pilot ownership gate in `requireGmailOwner` with the application's durable user/workspace/mailbox authorization contract before enabling multiple staff accounts. Do not simply remove the gate. OAuth state is one-time, expires after ten minutes, uses PKCE and is bound to a same-browser HttpOnly callback cookie. Refresh/access tokens are encrypted with AES-256-GCM and workspace-bound associated data; tokens never go to browser code or logs.

Google may require app verification and Workspace administrator approval for these scopes; the Cloud consent configuration determines who can connect. A test-mode refresh grant may expire. The app reports a reconnect requirement rather than silently retrying sends.

## Operational flow

- **Sync now** fetches one page at a time. Initial synchronization covers the most recent 30 days of messages carrying the configured intake label. Continue while `more` is true. A durable history cursor resumes subsequent synchronization. New unrelated messages must carry that label; follow-ups in a thread already associated with a case are also captured when archived or sent. An expired history cursor or reconnection starts an idempotent recent-label sync, followed by recovery of every known case thread using its original Gmail thread ID, including archived replies and returned attachments outside the 30-day window. Recovery reads at most twenty messages from one thread per call, persists its thread/message position across restarts, and retains the pre-scan history cursor to catch changes arriving during recovery. Older unrelated messages outside the initial window are not recovered by this bounded pilot. Missing source timestamps remain unknown; import time is tracked separately.
- Select an unlinked message and **Import as new case**, or link it to an existing case using its current revision. Imports parse supported attachments and save genuine case results and originals. Import is idempotent; the case key is independent of Gmail message/thread IDs. The existing 30-upload-case quota also covers Gmail-imported cases.
- A uniquely associated Gmail thread links later messages to its existing case. Threads associated with multiple cases remain ambiguous and require manual linking. Association does not automatically replace documents or clear discrepancies. Review returned attachments and explicitly append or replace a selected source through the existing intake workflow.
- Choose an incoming message, edit recipients and draft body, then save. Reply subjects and RFC reply/reference headers come from that original message. Recipients accept comma-separated bare email addresses. The AI never chooses the sending mailbox or dispatches a message.
- Confirm the saved draft separately to send. Changing source evidence invalidates older drafts through the case revision check. Mail send state lives independently of `OK`, `MISMATCH` and `NEEDS_REVIEW`.
- A send timeout/5xx is **uncertain**, because Gmail might have accepted the message. The saved operation is never automatically replayed. **Reconcile** searches sent mail for the exact generated Message-ID and original thread. Search indexing can lag: no result is not proof that nothing was sent. Inspect Gmail before taking any manual action. A definitive provider rejection requires editing/saving the draft again before another attempt.
- Disconnect deletes local connection credentials and outstanding OAuth state but preserves imported evidence and correspondence records. Revoke the application in the Google Account security settings to revoke the provider grant too.

## Scheduling and deployment limits

The web app provides user-triggered synchronization with durable cursors. An optional worker is included: run `node --import tsx scripts/gmail-sync.ts` for one bounded tick (up to five pages), or add `--loop` on a host supporting continuously running workers. Configure the same database, encryption key, approved workspace/mailbox and label as the web app. `CARGO_GMAIL_SYNC_INTERVAL_SECONDS` defaults to 120 with a minimum of 60. This worker only synchronizes; it never sends mail or changes source documents. The database lease prevents overlapping worker/web syncs. A scheduled job may invoke the one-tick command instead.

No host scheduler or worker is provisioned automatically, and a sleeping free web service cannot provide continuous monitoring by itself. Gmail watch/Pub/Sub can be added later as a wakeup signal with watch renewal and the same idempotent history processing. Never expose an unauthenticated cron endpoint.

Attachment originals are retained by CargoGuard after importing/appending/replacing them. A staged attachment candidate is fetched from Gmail when requested, so deleting it from Gmail before import can make it unavailable. Imports support TXT/PDF/DOCX/XLSX, at most ten attachments, 5 MB each and 20 MB combined. Unsupported attachments require manual intake of the relevant sources.

## API and validation

`GET /api/gmail?caseId=…` lists correspondence and drafts. `POST /api/gmail` supports `connect`, `disconnect`, `sync`, `import_message`, `link_message`, `save_draft`, `send`, and `reconcile`. `GET /api/gmail/attachment?messageId=…&attachmentId=…` retrieves a workspace-owned candidate. The application sends only on the `send` action with `confirmed:true` and the saved draft version.

Run `node --import tsx --test tests/gmail.test.ts` for mocked-provider tests. They make no Google/OpenAI calls and send no messages. Live connection and a user-approved test email still require the owner's configured Google account; passing mock tests is not proof of live OAuth or Gmail delivery.

References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync), [Gmail threads and reply headers](https://developers.google.com/workspace/gmail/api/guides/threads).
