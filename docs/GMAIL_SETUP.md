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
through the normal checks. A message is never imported twice: repeats are
recognised by Gmail id and by `Message-ID`, including files imported by hand.

## Replies

On the **Reply** tab: *Send* (asks for confirmation), *Save to Gmail drafts*
(appears in the same Gmail conversation), *Open in Gmail*, *Copy* or
*Download .eml*. To allow only drafts, set `CARGO_MAIL_ALLOW_SEND=false`.

## Optional AI wording help

Replies are written from the checked values without AI. An administrator can
enable "Improve wording" (the user must tick consent each time):

```dotenv
CARGO_REPLY_AI_PROVIDER=anthropic     # or openai
CARGO_REPLY_AI_API_KEY=<key>          # falls back to CARGO_AI_API_KEY
CARGO_REPLY_AI_MODEL=claude-sonnet-5  # optional
```

Any AI rewrite that changes or drops a value, reference or date is rejected and
the original draft is kept. Limited to 30 uses per workspace per hour.
