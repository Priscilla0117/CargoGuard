import { POST as uploadDocuments } from "@/app/api/upload/route";
import { HttpError, readJson } from "@/lib/http";
import { graphIdentifier } from "@/lib/microsoft";
import {
  microsoftImportForm,
  readMicrosoftMessage,
} from "@/lib/microsoft-message";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import { respond } from "@/lib/storage";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    const context = await microsoftRequest(request, "operate", true),
      input = z
        .object({
          id: graphIdentifier,
          revision: z.string().min(1).max(60),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(await readJson(request));
    const preview = await readMicrosoftMessage(context, input.id);
    if (preview.revision !== input.revision)
      throw new HttpError(
        "Message changed after your preview. Read it again before importing.",
        409,
      );
    const existing = await context.db
      .prepare(
        "SELECT status,case_id FROM microsoft_imports WHERE workspace=? AND user_id=? AND message_key=?",
      )
      .bind(context.workspace, context.user.id, preview.message_key)
      .first<{ status: string; case_id: string | null }>();
    if (existing) {
      if (existing.status === "imported")
        return respond(
          { case_id: existing.case_id, duplicate: true },
          { id: context.workspace, fresh: false },
        );
      throw new HttpError(
        "An import is pending or its outcome is uncertain. Check existing cases before importing this message again.",
        409,
      );
    }
    const form = await microsoftImportForm(context, preview);
    const current = await readMicrosoftMessage(context, preview.id);
    if (
      current.revision !== preview.revision ||
      JSON.stringify(current.attachments) !==
        JSON.stringify(preview.attachments)
    )
      throw new HttpError(
        "Message or attachment list changed during import preparation. Review it again.",
        409,
      );
    const reserved = await context.db
      .prepare(
        "INSERT INTO microsoft_imports(workspace,user_id,message_key,status,created_at) VALUES(?,?,?,'importing',?) ON CONFLICT(workspace,user_id,message_key) DO NOTHING",
      )
      .bind(
        context.workspace,
        context.user.id,
        preview.message_key,
        new Date().toISOString(),
      )
      .run();
    if (reserved.meta.changes !== 1)
      throw new HttpError(
        "This message is already being imported. Refresh status.",
        409,
      );
    const internal = new Request(
      new URL("/api/upload", context.config.origin),
      {
        method: "POST",
        headers: {
          cookie: request.headers.get("cookie") ?? "",
          origin: context.config.origin,
        },
        body: form,
      },
    );
    const response = await uploadDocuments(internal),
      value = z
        .object({
          result: z.object({
            email: z.object({ email_id: z.string().min(1).max(120) }),
          }),
        })
        .safeParse(await response.json());
    if (!response.ok || !value.success) {
      await context.db
        .prepare(
          "UPDATE microsoft_imports SET status='unknown' WHERE workspace=? AND user_id=? AND message_key=?",
        )
        .bind(context.workspace, context.user.id, preview.message_key)
        .run();
      throw new HttpError(
        "Import could not be confirmed. Check the case list and original message before retrying.",
        409,
      );
    }
    const id = value.data.result.email.email_id;
    await context.db.batch([
      context.db
        .prepare(
          "UPDATE microsoft_imports SET status='imported',case_id=? WHERE workspace=? AND user_id=? AND message_key=? AND status='importing'",
        )
        .bind(id, context.workspace, context.user.id, preview.message_key),
      context.db
        .prepare(
          "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          context.workspace,
          context.user.id,
          "MESSAGE_IMPORTED",
          id,
          new Date().toISOString(),
        ),
    ]);
    return respond(
      { case_id: id, duplicate: false },
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
