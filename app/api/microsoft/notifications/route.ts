import { requireCapability } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { microsoftConfiguration } from "@/lib/microsoft";
import {
  deliverMicrosoftAlert,
  microsoftAlertConfiguration,
  previewMicrosoftAlerts,
} from "@/lib/microsoft-notifications";
import { microsoftError, microsoftRequest } from "@/lib/microsoft-request";
import { respond } from "@/lib/storage";

export async function GET(request: Request) {
  try {
    const session = await requireCapability(request, "read"),
      settings = microsoftAlertConfiguration(),
      config = microsoftConfiguration();
    if (!session.user || !config.configured || !settings.enabled)
      return respond(
        {
          enabled: false,
          reason:
            "Configure authenticated team mode, a Microsoft connection and approved alert recipients before email dispatch.",
          recipients: [],
          previews: [],
          deliveries: [],
        },
        session,
      );
    const context = await microsoftRequest(request, "read");
    return respond(
      {
        enabled: context.config.allowSend,
        recipients: settings.recipients,
        ...(await previewMicrosoftAlerts(context)),
      },
      session,
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
export async function POST(request: Request) {
  try {
    const context = await microsoftRequest(request, "review", true);
    return respond(
      await deliverMicrosoftAlert(
        context,
        (await readJson(request)) as Parameters<
          typeof deliverMicrosoftAlert
        >[1],
      ),
      { id: context.workspace, fresh: false },
    );
  } catch (error) {
    return microsoftError(request, error);
  }
}
