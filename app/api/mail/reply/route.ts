import { HttpError, readJson } from "@/lib/http";
import { mailError } from "@/lib/mail-request";
import { deliverReply, mailRequest, replyInput } from "@/lib/mail-storage";
import { getCase, respond } from "@/lib/storage";

/** Saves a reviewed reply as a mailbox draft, or sends it after confirmation. */
export async function POST(request: Request) {
  try {
    const context = await mailRequest(request, "operate", true);
    const input = replyInput.parse(await readJson(request, 96 * 1024));
    const saved = await getCase(context.workspace, input.case_id);
    if (!saved) throw new HttpError("This case is no longer available.", 404);
    return respond(
      await deliverReply(context, input, {
        message_id: saved.email.message_id,
        references: saved.email.references,
        thread_hint: saved.email.thread_hint,
      }),
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return mailError(request, error);
  }
}
