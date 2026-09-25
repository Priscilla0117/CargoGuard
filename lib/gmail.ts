import { z } from "zod";
import { HttpError } from "./http";
import { fromBase64url, base64url, type MailConfig } from "./mail-connector";

/** Gmail REST adapter: fixed Google hosts, no redirects, bounded responses. */
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];
export type Fetcher = typeof fetch;
export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
export class MailProviderError extends HttpError {
  constructor(
    message: string,
    status = 502,
    public providerStatus?: number,
  ) {
    super(message, status);
  }
}

async function boundedJson(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new MailProviderError(
          "The mailbox returned a message that is too large to import.",
          413,
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new MailProviderError(
      "Gmail returned an unreadable response. Try again.",
    );
  }
}

export function googleAuthorizeUrl(
  config: MailConfig,
  state: string,
  challenge: string,
  hint?: string,
) {
  if (!config.google)
    throw new HttpError(
      "Google sign-in is not configured for this server.",
      503,
    );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.google.client,
    redirect_uri: config.google.redirect,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(hint ? { login_hint: hint } : {}),
  }).toString();
  return url.href;
}

const tokenSchema = z.object({
  access_token: z.string().min(1).max(10000),
  refresh_token: z.string().min(1).max(10000).optional(),
  expires_in: z.number().int().min(30).max(86400),
  id_token: z.string().max(20000).optional(),
});
export async function exchangeGoogleToken(
  config: MailConfig,
  input: { code: string; verifier: string } | { refresh: string },
  fetcher: Fetcher = fetch,
): Promise<GoogleTokens> {
  if (!config.google)
    throw new HttpError(
      "Google sign-in is not configured for this server.",
      503,
    );
  const body = new URLSearchParams({
    client_id: config.google.client,
    client_secret: config.google.secret,
    ...("code" in input
      ? {
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.verifier,
          redirect_uri: config.google.redirect,
        }
      : { grant_type: "refresh_token", refresh_token: input.refresh }),
  });
  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MailProviderError("Google could not be reached. Try again.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new MailProviderError(
      "Google did not accept the sign-in. Connect the Gmail account again.",
      response.status >= 500 ? 503 : 409,
    );
  }
  const parsed = tokenSchema.safeParse(await boundedJson(response, 64 * 1024));
  if (!parsed.success)
    throw new MailProviderError("Google returned an invalid sign-in response.");
  const refresh =
    parsed.data.refresh_token ?? ("refresh" in input ? input.refresh : "");
  if (!refresh)
    throw new MailProviderError(
      "Google did not grant offline access. Remove CargoGuard from your Google account permissions and connect again.",
      409,
    );
  return {
    access_token: parsed.data.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + parsed.data.expires_in * 1000,
  };
}

const ALLOWED_PATH =
  /^\/gmail\/v1\/users\/me\/(?:profile|messages(?:\/[A-Za-z0-9]{6,64})?|messages\/send|drafts)$/;
export async function gmailApi(
  token: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string>;
    limit?: number;
  } = {},
  fetcher: Fetcher = fetch,
) {
  if (!ALLOWED_PATH.test(path))
    throw new HttpError("Unsupported Gmail operation.", 400);
  const url = new URL(`https://gmail.googleapis.com${path}`);
  for (const [key, value] of Object.entries(options.query ?? {}))
    url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url.href, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new MailProviderError(
      "Gmail could not be reached. Try again shortly.",
      503,
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new MailProviderError(
      response.status === 401 || response.status === 403
        ? "Gmail refused access. Connect the account again and allow the requested permissions."
        : response.status === 429
          ? "Gmail is rate-limiting requests. Automatic import will retry later."
          : "Gmail could not complete the request. Try again shortly.",
      response.status === 401 || response.status === 403 ? 409 : 503,
      response.status,
    );
  }
  return boundedJson(response, options.limit ?? 256 * 1024);
}

export async function gmailProfile(token: string, fetcher?: Fetcher) {
  const parsed = z
    .object({ emailAddress: z.string().email().max(254) })
    .safeParse(
      await gmailApi(token, "/gmail/v1/users/me/profile", {}, fetcher),
    );
  if (!parsed.success)
    throw new MailProviderError("Gmail profile could not be read.");
  return parsed.data.emailAddress.toLowerCase();
}

export async function gmailList(
  token: string,
  query: string,
  max: number,
  fetcher?: Fetcher,
  pageToken?: string,
) {
  const parsed = z
    .object({
      messages: z
        .array(
          z.object({
            id: z.string().regex(/^[A-Za-z0-9]{6,64}$/),
            threadId: z.string().max(64),
          }),
        )
        .optional(),
      nextPageToken: z.string().max(512).optional(),
    })
    .safeParse(
      await gmailApi(
        token,
        "/gmail/v1/users/me/messages",
        {
          query: {
            q: query,
            maxResults: String(max),
            ...(pageToken ? { pageToken } : {}),
          },
        },
        fetcher,
      ),
    );
  if (!parsed.success)
    throw new MailProviderError("Gmail message list could not be read.");
  return Object.assign(parsed.data.messages ?? [], {
    next: parsed.data.nextPageToken ?? null,
  });
}

/**
 * Newest messages first that CargoGuard has not seen yet. Walks Gmail's
 * pages (newest to oldest) until `max` new messages are found or the search
 * range ends, so a full first page of known mail never hides older ones.
 */
export async function gmailUnseen(
  token: string,
  query: string,
  max: number,
  isKnown: (keys: string[]) => Promise<Set<string>>,
  fetcher?: Fetcher,
  pageLimit = 10,
  startPageToken?: string,
) {
  const found: { id: string; threadId: string }[] = [];
  let pageToken = startPageToken;
  let nextPageToken: string | null = null;
  let more = false;
  for (let page = 0; page < pageLimit; page++) {
    const list = await gmailList(token, query, 100, fetcher, pageToken);
    const seen = await isKnown(list.map((item) => `gmail:${item.id}`));
    const fresh = list.filter((item) => !seen.has(`gmail:${item.id}`));
    for (const item of fresh) {
      if (found.length < max) found.push(item);
      else more = true;
    }
    if (found.length >= max) {
      more = more || !!list.next;
      // Revisit a partly consumed page; knownKeys removes committed imports.
      nextPageToken = more ? (pageToken ?? "") : null;
      break;
    }
    if (!list.next) break;
    pageToken = list.next;
    if (page === pageLimit - 1) {
      more = true;
      nextPageToken = pageToken;
    }
  }
  return { messages: found, more, nextPageToken };
}

/** Read-only reconciliation after an uncertain send; never sends again. */
export async function gmailFindSent(
  token: string,
  messageId: string,
  fetcher?: Fetcher,
) {
  const found = await gmailList(
    token,
    `in:sent rfc822msgid:${messageId}`,
    2,
    fetcher,
  );
  return found.length === 1 ? found[0].id : null;
}

/** Provider thread IDs belong to one mailbox, even when cases are shared. */
export async function gmailReplyThread(
  token: string,
  parentMessageId: string,
  fetcher?: Fetcher,
) {
  const found = await gmailList(
    token,
    `in:anywhere rfc822msgid:${parentMessageId}`,
    2,
    fetcher,
  );
  return found.length === 1 ? found[0].threadId : undefined;
}

export async function gmailRaw(token: string, id: string, fetcher?: Fetcher) {
  const parsed = z
    .object({
      id: z.string(),
      threadId: z.string().max(64),
      raw: z.string().max(28 * 1024 * 1024),
      internalDate: z
        .string()
        .regex(/^\d{1,16}$/)
        .optional(),
    })
    .safeParse(
      await gmailApi(
        token,
        `/gmail/v1/users/me/messages/${id}`,
        { query: { format: "raw" }, limit: 29 * 1024 * 1024 },
        fetcher,
      ),
    );
  if (!parsed.success || parsed.data.id !== id)
    throw new MailProviderError("A Gmail message could not be read.");
  return {
    bytes: fromBase64url(parsed.data.raw),
    thread: parsed.data.threadId,
    received_at: parsed.data.internalDate
      ? new Date(Number(parsed.data.internalDate)).toISOString()
      : undefined,
  };
}

export async function gmailDeliver(
  token: string,
  raw: string,
  mode: "draft" | "send",
  threadId: string | undefined,
  fetcher?: Fetcher,
) {
  const encoded = base64url(new TextEncoder().encode(raw));
  const message = { raw: encoded, ...(threadId ? { threadId } : {}) };
  const result = z
    .object({ id: z.string().max(200) })
    .safeParse(
      await gmailApi(
        token,
        mode === "draft"
          ? "/gmail/v1/users/me/drafts"
          : "/gmail/v1/users/me/messages/send",
        { method: "POST", body: mode === "draft" ? { message } : message },
        fetcher,
      ),
    );
  if (!result.success)
    throw new MailProviderError(
      "Gmail did not confirm the message. Check your Gmail Drafts/Sent folder before retrying.",
      503,
    );
  return result.data.id;
}
