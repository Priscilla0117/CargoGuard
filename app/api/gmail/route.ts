import { z } from "zod";
import { requireMutation, workspace, respond, storage } from "@/lib/storage";
import { HttpError, readJson } from "@/lib/http";
import { gmailConfig, requireGmailOwner } from "@/lib/gmail-config";
import { gmailConnection, messageList, syncGmail } from "@/lib/gmail-storage";
import {
  draftList,
  linkMessage,
  saveReplyDraft,
  sendReply,
  reconcileReply,
} from "@/lib/correspondence";
import { importGmailMessage } from "@/lib/gmail-import";
import { beginGmailConnect } from "@/lib/gmail-oauth";

export const runtime = "nodejs";
const id = z.string().min(1).max(100),
  version = z.number().int().positive().safe();
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect") }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z.object({ action: z.literal("sync") }).strict(),
  z.object({ action: z.literal("import_message"), messageId: id }).strict(),
  z
    .object({
      action: z.literal("link_message"),
      messageId: id,
      caseId: id,
      version,
    })
    .strict(),
  z
    .object({
      action: z.literal("save_draft"),
      caseId: id,
      version,
      replyToMessageId: id,
      to: z.string().max(2540),
      cc: z.string().max(2540),
      body: z.string().min(1).max(20000),
      draftId: id.optional(),
      draftVersion: version.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("send"),
      draftId: id,
      draftVersion: version,
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal("reconcile"), draftId: id }).strict(),
]);
export async function GET(request: Request) {
  const session = workspace(request),
    config = gmailConfig();
  if (!config.enabled || config.workspace !== session.id)
    return respond(
      {
        enabled: false,
        connected: false,
        reason:
          "Gmail requires an owner-configured workspace and mailbox pilot.",
        messages: [],
        drafts: [],
      },
      session,
    );
  try {
    const db = storage().DB,
      connection = await gmailConnection(db, session.id),
      caseId = new URL(request.url).searchParams.get("caseId") ?? undefined;
    return respond(
      {
        enabled: true,
        connected: !!connection,
        accountEmail: connection?.account_email,
        messages: await messageList(db, session.id, caseId),
        drafts: await draftList(db, session.id, caseId),
      },
      session,
    );
  } catch {
    return respond({ error: "Mailbox storage is unavailable." }, session, 503);
  }
}
export async function POST(request: Request) {
  let session = workspace(request);
  try {
    session = requireMutation(request);
    const config = requireGmailOwner(session.id);
    const input = inputSchema.parse(await readJson(request, 100000)),
      db = storage().DB;
    if (input.action === "connect") {
      const { authorizeUrl, nonce } = await beginGmailConnect(db, session.id);
      const result = respond({ authorizeUrl }, session);
      result.cookies.set("cargo_gmail_oauth", nonce, {
        httpOnly: true,
        secure: config.origin.startsWith("https:"),
        sameSite: "lax",
        path: "/api/gmail/callback",
        maxAge: 600,
      });
      return result;
    }
    if (input.action === "disconnect") {
      await db.batch([
        db
          .prepare("DELETE FROM gmail_connections WHERE workspace=?")
          .bind(session.id),
        db
          .prepare("DELETE FROM gmail_oauth_states WHERE workspace=?")
          .bind(session.id),
      ]);
      return respond(
        {
          connected: false,
          notice:
            "Local credentials removed. Previously imported evidence is retained. Revoke CargoGuard in your Google Account to revoke Google's grant too.",
        },
        session,
      );
    }
    if (input.action === "sync")
      return respond(await syncGmail(db, session.id), session);
    if (input.action === "import_message")
      return respond(
        { result: await importGmailMessage(session.id, input.messageId) },
        session,
      );
    if (input.action === "link_message")
      return respond(
        {
          message: await linkMessage(
            db,
            session.id,
            input.messageId,
            input.caseId,
            input.version,
          ),
        },
        session,
      );
    if (input.action === "save_draft")
      return respond(
        { draft: await saveReplyDraft(db, session.id, input) },
        session,
      );
    if (input.action === "send")
      return respond(
        {
          draft: await sendReply(
            db,
            session.id,
            input.draftId,
            input.draftVersion,
          ),
        },
        session,
      );
    return respond(
      { draft: await reconcileReply(db, session.id, input.draftId) },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the mailbox action, recipients, draft version and explicit send confirmation."
              : "Gmail operation is unavailable. Refresh saved state before retrying.",
      },
      session,
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
