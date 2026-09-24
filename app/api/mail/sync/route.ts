import { mailError } from "@/lib/mail-request";
import { mailRequest, syncMailbox } from "@/lib/mail-storage";
import { respond } from "@/lib/storage";

/** Checks the connected mailbox for new email and imports it as cases. */
export async function POST(request: Request) {
  try {
    const context = await mailRequest(request, "operate", true);
    return respond(await syncMailbox(context), {
      id: context.workspace,
      fresh: false,
    });
  } catch (error) {
    return mailError(request, error);
  }
}
