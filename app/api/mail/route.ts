import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { mailConfiguration, mailSettingsSchema } from "@/lib/mail-connector";
import { mailError } from "@/lib/mail-request";
import {
  connectImap,
  disconnectMail,
  imapInput,
  mailRequest,
  mailStatus,
  startGoogleConnect,
  updateMailSettings,
} from "@/lib/mail-storage";
import { respond } from "@/lib/storage";

export async function GET(request: Request) {
  try {
    const configuration = await mailConfiguration();
    if (!configuration.configured) {
      const session = await requireCapability(request, "read");
      return respond(
        { configured: false, missing: configuration.missing, connected: false },
        session,
      );
    }
    const context = await mailRequest(request, "read");
    return respond(await mailStatus(context), {
      id: context.workspace,
      fresh: false,
    });
  } catch (error) {
    return mailError(request, error);
  }
}

const action = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("connect_google"),
      hint: z.string().trim().email().max(254).optional(),
    })
    .strict(),
  z.object({ action: z.literal("connect_imap"), login: imapInput }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z
    .object({ action: z.literal("settings"), settings: mailSettingsSchema })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    const context = await mailRequest(request, "operate", true);
    const input = action.parse(await readJson(request));
    const session = { id: context.workspace, fresh: false };
    if (input.action === "connect_google")
      return respond(await startGoogleConnect(context, input.hint), session);
    if (input.action === "connect_imap")
      return respond(await connectImap(context, input.login), session);
    if (input.action === "settings")
      return respond(
        await updateMailSettings(context, input.settings),
        session,
      );
    await disconnectMail(context);
    return respond(await mailStatus(context), session);
  } catch (error) {
    return mailError(request, error);
  }
}
