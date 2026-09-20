import { storage } from "@/lib/storage";
import { PIPELINE_VERSION } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await storage()
      .DB.prepare("SELECT version FROM result_revisions LIMIT 1")
      .all();
    return Response.json(
      { status: "ready", engine: PIPELINE_VERSION },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
