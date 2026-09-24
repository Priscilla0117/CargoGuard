import { readMicrosoftMessage } from "@/lib/microsoft-message";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import { respond } from "@/lib/storage";
import { graphIdentifier } from "@/lib/microsoft";

export async function GET(request: Request) {
  try {
    const context = await microsoftRequest(request, "operate"),
      id = graphIdentifier.parse(new URL(request.url).searchParams.get("id"));
    return respond(
      { message: await readMicrosoftMessage(context, id) },
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
