import { readJson } from "@/lib/http";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import {
  createMicrosoftDraft,
  listMicrosoftDispatches,
  sendMicrosoftDraft,
} from "@/lib/microsoft-storage";
import { respond } from "@/lib/storage";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const context = await microsoftRequest(request, "read");
    const id = new URL(request.url).searchParams.get("shipment") ?? undefined;
    if (id) z.string().max(80).parse(id);
    return respond(
      { dispatches: await listMicrosoftDispatches(context, id) },
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
export async function POST(request: Request) {
  try {
    const body = z
      .object({ action: z.enum(["create", "send"]), input: z.unknown() })
      .strict()
      .parse(await readJson(request));
    const context = await microsoftRequest(
      request,
      body.action === "send" ? "review" : "operate",
      true,
    );
    const result =
      body.action === "create"
        ? await createMicrosoftDraft(
            context,
            body.input as Parameters<typeof createMicrosoftDraft>[1],
          )
        : await sendMicrosoftDraft(
            context,
            body.input as Parameters<typeof sendMicrosoftDraft>[1],
          );
    return respond(result, { id: context.workspace, fresh: false });
  } catch (error) {
    return microsoftError(request, error);
  }
}
