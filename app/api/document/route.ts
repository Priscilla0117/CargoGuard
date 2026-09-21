import { bundleBytes, emails } from "@/lib/bundle";
import { workspace, storage, getCase, getRevision } from "@/lib/storage";
import { HttpError, revisionNumber } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      id = u.searchParams.get("id") ?? "",
      name = u.searchParams.get("name") ?? "",
      s = workspace(request);
    const revision = revisionNumber(u.searchParams.get("revision"));
    const saved = revision
      ? await getRevision(s.id, id, revision)
      : await getCase(s.id, id);
    const e =
      saved?.email ??
      (revision ? undefined : emails.find((e) => e.email_id === id));
    const p = e?.attachments.find((a) => a.split("/").pop() === name);
    if (!p) return new Response("Document not found", { status: 404 });
    const bytes =
      bundleBytes(p) ??
      (await storage()
        .BUCKET.get(`${s.id}/${id}/${name}`)
        .then((o) =>
          o ? o.arrayBuffer().then((b) => new Uint8Array(b)) : null,
        ));
    if (!bytes) return new Response("Document not found", { status: 404 });
    const pdf = name.endsWith(".pdf"),
      txt = name.endsWith(".txt");
    return new Response(bytes.slice().buffer, {
      headers: {
        "Content-Type": pdf
          ? "application/pdf"
          : txt
            ? "text/plain; charset=utf-8"
            : "application/octet-stream",
        "Content-Disposition": `${pdf || txt ? "inline" : "attachment"}; filename="${name.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    if (error instanceof HttpError)
      return new Response(error.message, {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    return new Response("Document temporarily unavailable", { status: 503 });
  }
}
