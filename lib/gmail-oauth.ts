import { randomBytes } from "node:crypto";
import {
  gmailConfig,
  requireGmailOwner,
  GMAIL_SCOPES,
  gmailHash,
  sealGmail,
  openGmail,
} from "./gmail-config";
import { exchangeGmailToken, GmailClient } from "./gmail-client";
import { HttpError } from "./http";

export async function beginGmailConnect(db: D1Database, workspace: string) {
  const config = requireGmailOwner(workspace);
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  await db.batch([
    db
      .prepare(
        "DELETE FROM gmail_oauth_states WHERE expires_at<? OR workspace=?",
      )
      .bind(new Date().toISOString(), workspace),
    db
      .prepare(
        "INSERT INTO gmail_oauth_states(state_hash,workspace,nonce_hash,verifier,expires_at) VALUES(?,?,?,?,?)",
      )
      .bind(
        gmailHash(state),
        workspace,
        gmailHash(nonce),
        sealGmail(verifier, workspace),
        new Date(Date.now() + 600000).toISOString(),
      ),
  ]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    login_hint: config.email,
    code_challenge: Buffer.from(gmailHash(verifier), "hex").toString(
      "base64url",
    ),
    code_challenge_method: "S256",
  }).toString();
  return { authorizeUrl: url.href, nonce };
}
export async function finishGmailConnect(
  db: D1Database,
  state: string,
  nonce: string,
  code: string,
  fetcher: typeof fetch = fetch,
) {
  if (!state || !nonce || !code)
    throw new HttpError("Invalid OAuth callback.", 400);
  const config = gmailConfig();
  // A failed nonce does not consume someone else's state. A valid state is consumed
  // atomically before the code exchange so callback replay cannot reconnect a mailbox.
  const row = await db
    .prepare(
      "DELETE FROM gmail_oauth_states WHERE state_hash=? AND nonce_hash=? AND expires_at>? RETURNING workspace,verifier",
    )
    .bind(gmailHash(state), gmailHash(nonce), new Date().toISOString())
    .first<{ workspace: string; verifier: string }>();
  if (!row)
    throw new HttpError(
      "OAuth state expired or does not match this browser.",
      400,
    );
  requireGmailOwner(row.workspace);
  const tokens = await exchangeGmailToken(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: openGmail<string>(row.verifier, row.workspace),
    },
    fetcher,
  );
  if (!tokens.refresh_token)
    throw new HttpError("Reconnect Gmail and grant offline access.", 400);
  const profile = await new GmailClient(tokens.access_token, fetcher).profile();
  if (profile.emailAddress.toLowerCase() !== config.email)
    throw new HttpError(
      "This mailbox is not approved for the configured pilot.",
      403,
    );
  await db
    .prepare(
      "INSERT INTO gmail_connections(workspace,account_email,credentials,connected_at) VALUES(?,?,?,?) ON CONFLICT(workspace) DO UPDATE SET account_email=excluded.account_email,credentials=excluded.credentials,connected_at=excluded.connected_at,sync_mode='initial',history_id=NULL,page_token=NULL,sync_until=NULL",
    )
    .bind(
      row.workspace,
      profile.emailAddress.toLowerCase(),
      sealGmail(tokens, row.workspace),
      new Date().toISOString(),
    )
    .run();
  return row.workspace;
}
