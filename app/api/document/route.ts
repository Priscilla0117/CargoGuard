import { bundleBytes, emails } from "@/lib/bundle";
import { workspace, storage, getCase } from "@/lib/storage";
export async function GET(request: Request) {
  try {
    const u = new URL(request.url),
      id = u.searchParams.get("id") ?? "",
      name = u.searchParams.get("name") ?? "",
      s = workspace(request);
    const e =
      (await getCase(s.id, id))?.email ?? emails.find((e) => e.email_id === id);
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
  } catch {
    return new Response("Document temporarily unavailable", { status: 503 });
  }
}
