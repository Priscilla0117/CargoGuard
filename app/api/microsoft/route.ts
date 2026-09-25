import { requireCapability, teamMode } from "@/lib/auth";
import { microsoftConfiguration } from "@/lib/microsoft";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import {
  connectionStatus,
  disconnectMicrosoft,
  startMicrosoftConnect,
} from "@/lib/microsoft-storage";
import { readJson } from "@/lib/http";
import { respond, storage } from "@/lib/storage";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const session = await requireCapability(request, "read"),
      configuration = microsoftConfiguration();
    const connection =
      configuration.configured && session.user
        ? await connectionStatus({
            db: storage().DB,
            workspace: session.id,
            user: session.user,
          })
        : { connected: false, account: null, updated_at: null };
    return respond(
      {
        configured: configuration.configured,
        missing: configuration.missing,
        team_required: !teamMode(),
        send_enabled: configuration.config?.allowSend ?? false,
        ...connection,
      },
      session,
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
export async function POST(request: Request) {
  try {
    const context = await microsoftRequest(request, "operate", true);
    const input = z
      .object({ action: z.enum(["connect", "disconnect"]) })
      .strict()
      .parse(await readJson(request));
    if (input.action === "disconnect") {
      await disconnectMicrosoft(context);
      return respond(
        { connected: false },
        { id: context.workspace, fresh: false },
      );
    }
    return respond(await startMicrosoftConnect(context), {
      id: context.workspace,
      fresh: false,
    });
  } catch (error) {
    return microsoftError(request, error);
  }
}
