import { databaseReady } from "@/lib/runtime";
import { createReadinessCheck } from "@/lib/readiness";
import { PIPELINE_VERSION } from "@/lib/types";
export const dynamic = "force-dynamic";
const readiness = createReadinessCheck(databaseReady);
export async function GET() {
  if (await readiness()) {
    return Response.json(
      { status: "ready", engine: PIPELINE_VERSION },
      { headers: { "Cache-Control": "no-store" } },
    );
  } else {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      },
    );
  }
}
