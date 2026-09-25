import { HttpError } from "./http";
import {
  IMAP_PRESETS,
  type ImapPreset,
  type MailConfig,
} from "./mail-connector";

/**
 * IMAP/SMTP login with an app password. Node-only: libraries are loaded
 * lazily so other runtimes never bundle socket code. Only preset providers
 * or the administrator-configured host can be contacted (no user-chosen hosts).
 */
export interface ImapSecret {
  preset: ImapPreset;
  email: string;
  password: string;
}
export interface ImapServer {
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}
export function imapServer(config: MailConfig, preset: ImapPreset): ImapServer {
  if (preset === "custom") {
    if (!config.custom)
      throw new HttpError(
        "No custom mail server is configured on this server.",
        400,
      );
    return config.custom;
  }
  const value = IMAP_PRESETS[preset];
  if (!value) throw new HttpError("Choose a supported email provider.", 400);
  return { imap: { ...value.imap }, smtp: { ...value.smtp } };
}

type Client = import("imapflow").ImapFlow;
async function withClient<T>(
  server: ImapServer,
  secret: ImapSecret,
  task: (client: Client) => Promise<T>,
) {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: server.imap.host,
    port: server.imap.port,
    secure: server.imap.secure,
    auth: { user: secret.email, pass: secret.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  try {
    await client.connect();
  } catch (error) {
    const auth =
      error &&
      typeof error === "object" &&
      ("authenticationFailed" in error ||
        /auth|credential|password|login/i.test(
          String((error as Error).message),
        ));
    throw new HttpError(
      auth
        ? "The mail server rejected the email or app password. For Gmail, turn on 2-Step Verification and create an App Password, then try again."
        : "The mail server could not be reached. Check your internet connection and try again.",
      auth ? 401 : 503,
    );
  }
  try {
    return await task(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function verifyImapLogin(server: ImapServer, secret: ImapSecret) {
  await withClient(server, secret, async (client) => {
    await client.mailboxOpen("INBOX", { readOnly: true });
  });
}

export interface ImapCandidate {
  key: string;
  raw: Uint8Array;
  received_at?: string;
  thread?: string;
}
/** Newest messages first, up to `max`, skipping keys already imported. */
export async function imapFetchNew(
  server: ImapServer,
  secret: ImapSecret,
  options: { mailbox: string; days: number; max: number },
  known: (keys: string[]) => Promise<Set<string>>,
) {
  return withClient(server, secret, async (client) => {
    const lock = await client.getMailboxLock(options.mailbox, {
      readOnly: true,
    });
    try {
      const since = new Date(Date.now() - options.days * 86400000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const newestFirst = [...uids].reverse();
      const selected: {
        uid: number;
        key: string;
        date?: string;
        thread?: string;
      }[] = [];
      let more = false;
      // Walk from the newest message back in pages of 100, skipping mail
      // that is already imported, until `max` new messages are found.
      for (
        let start = 0;
        start < Math.min(newestFirst.length, 1000);
        start += 100
      ) {
        const page = newestFirst.slice(start, start + 100);
        const envelopes: typeof selected = [];
        for await (const message of client.fetch(
          page.join(","),
          {
            uid: true,
            envelope: true,
            internalDate: true,
            size: true,
            threadId: true,
          },
          { uid: true },
        )) {
          if ((message.size ?? 0) > 20 * 1024 * 1024) continue;
          const id = message.envelope?.messageId?.replace(/[<>\s]/g, "");
          const date =
            message.internalDate instanceof Date
              ? message.internalDate
              : message.internalDate
                ? new Date(message.internalDate)
                : message.envelope?.date;
          envelopes.push({
            uid: message.uid,
            key: id
              ? `mid:${id.toLowerCase()}`
              : `uid:${client.mailbox && typeof client.mailbox === "object" ? String(client.mailbox.uidValidity) : "0"}:${message.uid}`,
            date:
              date && Number.isFinite(new Date(date).getTime())
                ? new Date(date).toISOString()
                : undefined,
            thread: message.threadId,
          });
        }
        const seen = await known(envelopes.map((item) => item.key));
        const fresh = envelopes
          .filter((item) => !seen.has(item.key))
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        for (const item of fresh)
          if (selected.length < options.max) selected.push(item);
          else more = true;
        if (selected.length >= options.max) {
          if (start + 100 < newestFirst.length) more = true;
          break;
        }
      }
      if (newestFirst.length > 1000 && selected.length < options.max)
        more = true;
      if (!selected.length)
        return Object.assign([] as ImapCandidate[], { more });
      const results: ImapCandidate[] = [];
      for (const item of selected) {
        const message = await client.fetchOne(
          String(item.uid),
          { source: true },
          { uid: true },
        );
        if (message && message.source)
          results.push({
            key: item.key,
            raw: new Uint8Array(message.source),
            received_at: item.date,
            thread: item.thread,
          });
      }
      return Object.assign(results, { more });
    } finally {
      lock.release();
    }
  });
}

export async function imapSaveDraft(
  server: ImapServer,
  secret: ImapSecret,
  raw: string,
) {
  return withClient(server, secret, async (client) => {
    const boxes = await client.list();
    const drafts =
      boxes.find((box) => box.specialUse === "\\Drafts")?.path ??
      boxes.find((box) => /^(\[gmail\]\/)?drafts$/i.test(box.path))?.path;
    if (!drafts)
      throw new HttpError("No Drafts folder was found in this mailbox.", 409);
    const saved = await client.append(drafts, raw, ["\\Draft", "\\Seen"]);
    if (!saved)
      throw new HttpError(
        "The mail server did not confirm the draft. Check your Drafts folder.",
        503,
      );
    return drafts;
  });
}

export async function smtpSend(
  server: ImapServer,
  secret: ImapSecret,
  raw: string,
  envelope: { from: string; to: string[] },
) {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: server.smtp.host,
    port: server.smtp.port,
    secure: server.smtp.secure,
    requireTLS: !server.smtp.secure,
    auth: { user: secret.email, pass: secret.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });
  try {
    const info = await transport.sendMail({ envelope, raw });
    if (!info.accepted?.length)
      throw new HttpError("The mail server did not accept any recipient.", 502);
    return info.messageId ?? "";
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      "Sending failed. Check your Sent folder before trying again; nothing was retried automatically.",
      503,
    );
  } finally {
    transport.close();
  }
}
