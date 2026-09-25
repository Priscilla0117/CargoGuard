import { HttpError, readJson } from "@/lib/http";
import { mailError } from "@/lib/mail-request";
import {
  deliverReply,
  mailRequest,
  replyInput,
  listMailOperations,
  checkMailOperation,
  resolveMailOperation,
  checkOperationInput,
  resolveOperationInput,
} from "@/lib/mail-storage";
import { getCase, respond } from "@/lib/storage";

/** Saves a reviewed reply as a mailbox draft, or sends it after confirmation. */
export async function POST(request: Request) {
  try {
    const context = await mailRequest(request, "operate", true);
    const raw = await readJson(request, 96 * 1024);
    if (raw && typeof raw === "object" && "action" in raw) {
      if (raw.action === "check") {
        const input = checkOperationInput.parse(raw);
        return respond(
          await checkMailOperation(context, input.operation_id, input.case_id),
          { id: context.workspace, fresh: false },
        );
      }
      const input = resolveOperationInput.parse(raw);
      return respond(await resolveMailOperation(context, input), {
        id: context.workspace,
        fresh: false,
      });
    }
    const input = replyInput.parse(raw);
    const saved = await getCase(context.workspace, input.case_id);
    if (!saved) throw new HttpError("This case is no longer available.", 404);
    return respond(await deliverReply(context, input, saved), {
      id: context.workspace,
      fresh: false,
    });
  } catch (error) {
    return mailError(request, error);
  }
}

/** Recover pending operations after reload without resubmitting message content. */
export async function GET(request: Request) {
  try {
    const context = await mailRequest(request, "read");
    const caseId = new URL(request.url).searchParams.get("case_id");
    if (!caseId || caseId.length > 120)
      throw new HttpError("Choose a case.", 400);
    return respond(await listMailOperations(context, caseId), {
      id: context.workspace,
      fresh: false,
    });
  } catch (error) {
    return mailError(request, error);
  }
}
