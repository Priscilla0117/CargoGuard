import { HttpError } from "./http";
import { GMAIL_SCOPES, gmailConfig } from "./gmail-config";

export interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}
export interface GmailPart {
  partId?: string;
  filename?: string;
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailRawMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}
export class GmailError extends HttpError {
  constructor(public providerStatus: number) {
    super(
      providerStatus === 401
        ? "Reconnect Gmail: mailbox authorization expired."
        : "Gmail is temporarily unavailable. Check saved state before retrying.",
      503,
    );
  }
}
export async function gmailJson<T>(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GmailError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError("Gmail returned an empty response.", 503);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 28 * 1024 * 1024) {
        await reader.cancel();
        throw new HttpError("Gmail message exceeds the import limit.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
export async function exchangeGmailToken(
  parameters: Record<string, string>,
  fetcher: typeof fetch = fetch,
) {
  const config = gmailConfig();
  const data = await gmailJson<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...parameters,
      }),
    },
    fetcher,
  );
  if (
    !data.access_token ||
    !Number.isFinite(data.expires_in) ||
    (data.scope &&
      GMAIL_SCOPES.some((s) => !data.scope!.split(" ").includes(s)))
  )
    throw new HttpError(
      "Grant both Gmail read and send permissions before connecting.",
      400,
    );
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  } as GmailTokens;
}
export class GmailClient {
  constructor(
    readonly token: string,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  request<T>(path: string, body?: unknown) {
    return gmailJson<T>(
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      this.fetcher,
    );
  }
  profile() {
    return this.request<{ emailAddress: string; historyId: string }>("profile");
  }
  message(id: string) {
    return this.request<GmailRawMessage>(
      `messages/${encodeURIComponent(id)}?format=full`,
    );
  }
  thread(id: string) {
    return this.request<{ id: string; messages?: { id: string }[] }>(
      `threads/${encodeURIComponent(id)}?format=minimal`,
    );
  }
  list(query: string, pageToken?: string, labelId?: string) {
    return this.request<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    }>(
      `messages?${new URLSearchParams({ q: query, maxResults: "20", ...(pageToken ? { pageToken } : {}), ...(labelId ? { labelIds: labelId } : {}) })}`,
    );
  }
  history(id: string, pageToken?: string) {
    return this.request<{
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      historyId: string;
      nextPageToken?: string;
    }>(
      `history?${new URLSearchParams({ startHistoryId: id, historyTypes: "messageAdded", maxResults: "20", ...(pageToken ? { pageToken } : {}) })}`,
    );
  }
  attachment(messageId: string, attachmentId: string) {
    return this.request<{ data: string; size: number }>(
      `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }
  send(raw: string, threadId: string) {
    return this.request<{ id: string; threadId: string }>("messages/send", {
      raw,
      threadId,
    });
  }
}
