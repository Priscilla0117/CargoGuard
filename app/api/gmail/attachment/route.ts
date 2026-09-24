import { workspace, storage } from "@/lib/storage";
import { requireGmailOwner } from "@/lib/gmail-config";
import { gmailAttachment } from "@/lib/gmail-storage";
import { HttpError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const session = workspace(request);
    requireGmailOwner(session.id);
    const url = new URL(request.url);
    const { attachment, bytes } = await gmailAttachment(
      storage().DB,
      session.id,
      url.searchParams.get("messageId") ?? "",
      url.searchParams.get("attachmentId") ?? "",
    );
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof HttpError ? error.message : "Attachment unavailable.",
      {
        status: error instanceof HttpError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
