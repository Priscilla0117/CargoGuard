import { z } from "zod";
import { HttpError } from "./http";
import {
  graphIdentifier,
  graphMessagePath,
  microsoftGraph,
  microsoftHash,
} from "./microsoft";
import {
  microsoftAccessToken,
  type MicrosoftContext,
} from "./microsoft-storage";

const messageSchema = z.object({
  id: graphIdentifier,
  subject: z.string().max(500),
  internetMessageId: z.string().max(1000).optional(),
  conversationId: z.string().max(1000).optional(),
  lastModifiedDateTime: z.string().max(60),
  body: z.object({ contentType: z.string(), content: z.string().max(20000) }),
  from: z.object({
    emailAddress: z.object({ address: z.string().email().max(254) }),
  }),
  hasAttachments: z.boolean(),
});
const attachmentSchema = z.object({
  id: graphIdentifier,
  name: z.string().min(1).max(200),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(100 * 1024 * 1024),
  isInline: z.boolean().optional(),
  "@odata.type": z.string().optional(),
  contentType: z.string().max(200).optional(),
});
export interface MicrosoftMessagePreview {
  id: string;
  subject: string;
  from: string;
  body: string;
  revision: string;
  message_key: string;
  attachments: {
    id: string;
    name: string;
    size: number;
    supported: boolean;
    reason: string;
  }[];
}
export async function readMicrosoftMessage(
  context: MicrosoftContext,
  id: string,
): Promise<MicrosoftMessagePreview> {
  graphIdentifier.parse(id);
  const token = await microsoftAccessToken(context);
  const parsed = messageSchema.safeParse(
    await microsoftGraph(
      token,
      `${graphMessagePath(id)}?$select=id,subject,internetMessageId,conversationId,lastModifiedDateTime,body,from,hasAttachments`,
      {},
      context.fetcher,
    ),
  );
  if (!parsed.success || parsed.data.body.contentType.toLowerCase() !== "text")
    throw new HttpError(
      "Message is unavailable, too large or not readable as plain text. Import the original documents manually.",
      422,
    );
  const message = parsed.data;
  const attachments: MicrosoftMessagePreview["attachments"] = [];
  if (message.hasAttachments) {
    const response = z
      .object({
        value: z.array(attachmentSchema).max(10),
        "@odata.nextLink": z.string().optional(),
      })
      .safeParse(
        await microsoftGraph(
          token,
          `${graphMessagePath(message.id)}/attachments?$top=11&$select=id,name,size,isInline,contentType`,
          {},
          context.fetcher,
        ),
      );
    if (!response.success || response.data["@odata.nextLink"])
      throw new HttpError(
        "This message has too many attachments. Select at most ten supported documents for manual import.",
        422,
      );
    for (const item of response.data.value) {
      const reason = item.isInline
        ? "Inline image is not imported"
        : item["@odata.type"] &&
            item["@odata.type"] !== "#microsoft.graph.fileAttachment"
          ? "Linked or embedded message attachment is unsupported"
          : item.size > 5 * 1024 * 1024
            ? "Exceeds the 5 MB file limit"
            : !/\.(txt|pdf|docx|xlsx)$/i.test(item.name)
              ? "Use TXT, PDF, DOCX or XLSX"
              : "";
      attachments.push({
        id: item.id,
        name: item.name,
        size: item.size,
        supported: !reason,
        reason,
      });
    }
  }
  return {
    id: message.id,
    subject: message.subject || "(No subject)",
    from: message.from.emailAddress.address,
    body: message.body.content || "(Empty email body)",
    revision: message.lastModifiedDateTime,
    message_key: await microsoftHash(message.internetMessageId || message.id),
    attachments,
  };
}
export async function microsoftImportForm(
  context: MicrosoftContext,
  preview: MicrosoftMessagePreview,
) {
  if (preview.attachments.some((attachment) => !attachment.supported))
    throw new HttpError(
      "Some attachments cannot be safely imported. Use manual import to choose the required source files; nothing is silently discarded.",
      422,
    );
  if (
    preview.attachments.reduce(
      (total, attachment) => total + attachment.size,
      0,
    ) >
    20 * 1024 * 1024
  )
    throw new HttpError(
      "Combined attachments exceed the 20 MB import limit.",
      413,
    );
  const token = await microsoftAccessToken(context),
    form = new FormData();
  form.set("subject", preview.subject);
  form.set("from", preview.from);
  form.set("body", preview.body);
  for (const attachment of preview.attachments) {
    const result = z
      .object({
        "@odata.type": z.literal("#microsoft.graph.fileAttachment"),
        name: z.string().max(200),
        contentBytes: z.string().max(7 * 1024 * 1024),
      })
      .safeParse(
        await microsoftGraph(
          token,
          `${graphMessagePath(preview.id)}/attachments/${encodeURIComponent(attachment.id)}`,
          { limit: 7 * 1024 * 1024 + 1024 },
          context.fetcher,
        ),
      );
    if (
      !result.success ||
      result.data.name !== attachment.name ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        result.data.contentBytes,
      )
    )
      throw new HttpError(
        "Attachment changed or could not be read safely. Refresh the message.",
        409,
      );
    const bytes = Uint8Array.from(atob(result.data.contentBytes), (char) =>
      char.charCodeAt(0),
    );
    if (bytes.byteLength > 5 * 1024 * 1024)
      throw new HttpError("Attachment exceeds the 5 MB limit.", 413);
    // Source parser will retain empty/corrupt file errors for review, not verify them.
    form.append(
      "files",
      new File([bytes], attachment.name, { type: "application/octet-stream" }),
    );
  }
  return form;
}
