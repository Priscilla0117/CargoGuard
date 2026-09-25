# Connecting Gmail

CargoGuard can import new email automatically and save or send replies from
the case screen. There are two ways to connect; both are on **Setup → Email
accounts**.

## Required for both: an encryption key

Saved logins are encrypted with AES-GCM. Set a random 32-byte key (base64) in
the server environment:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```dotenv
CARGO_MAIL_TOKEN_KEY=<the printed value>
```

Local demo mode (`CARGO_AUTH_MODE=demo` with `CARGO_LOCAL_DB`) creates one
automatically in `work/.mail-token-key` (git-ignored), so you can try it
without configuration. Never commit the key; losing it means users reconnect.

## Option A — Sign in with Google (recommended)

The user signs in on Google's page; CargoGuard never sees the password.

1. In Google Cloud Console create a project → *APIs & Services* → enable the
   **Gmail API**.
2. *OAuth consent screen*: External (or Internal for Google Workspace), add the
   scopes `gmail.readonly` and `gmail.compose`, and add test users while the app
   is in testing.
3. *Credentials* → *Create OAuth client ID* → Web application. Authorised
   redirect URI: `https://<your-host>/api/mail/callback`
   (locally: `http://localhost:3000/api/mail/callback`).
4. Set:

```dotenv
CARGO_PUBLIC_ORIGIN=https://<your-host>        # or http://localhost:3000
CARGO_GOOGLE_CLIENT_ID=<client id>
CARGO_GOOGLE_CLIENT_SECRET=<client secret>
```

Security: PKCE + a single-use, 10-minute state bound to the signed-in session;
tokens are encrypted per user; disconnecting deletes them and revokes access.

## Option B — Sign in with email and app password

Works for Gmail, Outlook.com/Microsoft 365 (if IMAP is allowed) and Yahoo, with
no developer console.

1. The user turns on 2-Step Verification in their Google account.
2. Google Account → Security → *App passwords* → create one called CargoGuard.
3. In CargoGuard enter the Gmail address and the 16-letter app password.

CargoGuard reads new mail over IMAP (TLS) and saves drafts into the mailbox's
Drafts folder; sending uses SMTP. Only the listed providers, or one
administrator-configured server, can be contacted:

```dotenv
CARGO_MAIL_IMAP_HOST=imap.company.com   # optional company server
CARGO_MAIL_SMTP_HOST=smtp.company.com
CARGO_MAIL_IMAP_PORT=993
CARGO_MAIL_SMTP_PORT=465
CARGO_MAIL_IMAP_ENABLED=true            # false hides option B
```

## Automatic import

While CargoGuard is open it checks every 5 minutes (configurable 2–120), for
mail from the last 7 days, at most 10 messages per check. Every message goes
through the normal checks. Mailbox imports have a durable identity scoped to
the connected account, so interrupted attempts reopen the committed case even
when the email lacks `Message-ID`. Standard message IDs also recognize repeat
manual imports. Gmail and IMAP scans save their continuation cursor: reaching
the per-check scanning limit means "scan continues", not "no new email".
Gmail/IMAP receipt timestamps determine the received day; the sender's Date
header is retained separately as `sent_at`. Importing a standalone `.eml`
continues to use its Date header because no provider receipt is available.

Apply migration `0013_mail_reliability.sql` before starting this release.
Expired import leases can be reclaimed; lease tokens fence late workers and
the case import identity prevents a crash between case creation and receipt
recording from creating a second case. Original attached files remain intact.

This is **browser-triggered polling**, not an unattended background service.
It stops when no signed-in browser is checking. A Node cron process or
Cloudflare scheduled Worker cannot safely reuse the browser-session upload
route without a dedicated service identity and intake authorization boundary.
Neither has been installed or activated by this change. Before adding one,
validate connection ownership against active team membership, give it only
intake authority, retain these leases/cursors, and exercise logout, revocation,
deployment restart, quotas, and cursor expiry in the target runtime.

## Replies

On the **Reply** tab: *Send* (asks for confirmation), *Save to Gmail drafts*
(appears in the same Gmail conversation), *Open in Gmail*, *Copy* or
*Download .eml*. To allow only drafts, set `CARGO_MAIL_ALLOW_SEND=false`.

Every outbound request includes the reviewed case revision and a stable
operation UUID. CargoGuard reserves the operation before contacting the
provider, stores the provider receipt, and returns an existing receipt for
repeated identical requests. Changing the case blocks a new stale reply.
"Submitted" means provider acceptance, not delivery to the recipient.
For shared cases, reply threading resolves the parent Message-ID in the
replying employee's connected Gmail account. Another employee's imported
thread ID is never reused. If there is no unique local match, the reply keeps
its `In-Reply-To`/`References` headers without supplying a provider thread ID.

A network failure or interrupted operation remains **unknown** and cannot be
resent, including by editing the body and obtaining a new UUID. Check status
from the reply panel. Gmail checks Sent using the stable RFC Message-ID. For
SMTP or an outcome Gmail cannot confirm, inspect the original mailbox/provider
records and explicitly record a decision with a note. Confirming that nothing
was submitted cancels the old operation; a new send then needs fresh employee
authorization. An interrupted pending operation becomes eligible for this
reconciliation after ten minutes. Lack of a search result alone never proves
that sending failed. SMTP delivery is not guaranteed to create a Sent copy;
check server records or the recipient when necessary.
Partial SMTP acceptance retains both accepted and rejected recipients and
does not start response tracking. A provider acceptance receipt cannot be
cleared by claiming that nothing was submitted; handle rejected recipients
separately and keep the original receipt in the audit history.
An employee's manual confirmation without a provider acceptance receipt is
labelled as employee confirmation and does not automatically start waiting.
Use the deliberate follow-up action to record that externally verified request.

Only an explicitly selected document/correction request starts response
tracking, and only after confirmed submission. Drafts, acknowledgements, and
unknown sends do not start waiting. If tracking fails after submission, check
status to retry tracking; CargoGuard does not send the message again.

Mocked checks cover backlog continuation beyond 1,000 messages, abandoned
imports, duplicate and concurrent submissions, database failure after provider
acceptance, stale evidence, SMTP uncertainty, and Gmail reconciliation. They
do not validate live OAuth, provider threading, SMTP acceptance/delivery, or
production deployment behavior; complete those checks before enabling a pilot.

## Optional AI wording help

Replies are written from the checked values without AI. An administrator can
enable "Improve wording" (the user must tick consent each time):

```dotenv
CARGO_REPLY_AI_PROVIDER=openai
CARGO_REPLY_AI_API_KEY=<key>          # falls back to CARGO_AI_API_KEY
CARGO_REPLY_AI_MODEL=gpt-5.4-mini     # optional
```

Any AI rewrite that changes or drops a value, reference or date is rejected and
the original draft is kept. Limited to 30 uses per workspace per hour.
