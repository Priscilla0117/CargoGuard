import { PIPELINE_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

// Render restarts the whole process on a failed probe. An external database
// outage cannot be repaired by restarting this process. Keep readiness separate:
// /api/health still probes storage and returns 503 when it cannot be reached.
// Startup migrations must succeed before this HTTP server is started.
export async function GET() {
  return Response.json(
    {
      status: "alive",
      engine: PIPELINE_VERSION,
      database_checked: false,
      readiness_endpoint: "/api/health",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
