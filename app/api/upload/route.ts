import { parseDocument } from "@/lib/parsers";
import { analyze } from "@/lib/compare";
import {
  requireMutation,
  respond,
  workspace,
  saveCase,
  getCase,
  storage,
  getPolicy,
} from "@/lib/storage";
import { z } from "zod";
import { readForm, HttpError } from "@/lib/http";

export async function POST(request: Request) {
  let s = workspace(request);
  const keys: string[] = [];
  let persistAttempted = false;
  try {
    s = requireMutation(request);
    const form = await readForm(request, 21 * 1024 * 1024);
    // FormData.get() reads the first value but Object.fromEntries() keeps the
    // last. Reject ambiguous control fields before choosing upload vs replace.
    for (const field of [
      "id",
      "version",
      "actor",
      "reason",
      "from",
      "subject",
      "body",
    ])
      if (form.getAll(field).length > 1)
        throw new HttpError(`Only one ${field} field is allowed.`);
    if (form.getAll("files").some((x) => !(x instanceof File)))
      throw new HttpError("The attachment field must contain files.");
    const files = form
      .getAll("files")
      .filter((x): x is File => x instanceof File && !!x.name);
    if (files.length > 10)
      throw new HttpError("Attach at most 10 documents per email.");
    if (files.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024)
      throw new HttpError(
        "The combined attachments must be 20 MB or smaller.",
        413,
      );
    const replacement = form.get("id")
      ? z
          .object({
            id: z.string().min(1).max(80),
            version: z.coerce.number().int().positive(),
            actor: z.string().trim().min(2).max(80),
            reason: z.string().trim().min(5).max(2000),
          })
          .parse(Object.fromEntries(form))
      : null;
    const previous = replacement ? await getCase(s.id, replacement.id) : null;
    if (replacement && (!previous || previous.version !== replacement.version))
      return respond(
        { error: "Case changed. Refresh it before replacing documents." },
        s,
        409,
      );
    if (replacement && files.length < 2)
      throw new HttpError(
        "Supply both replacement documents: the SI and draft BL.",
      );
    const { subject, body, from } = z
      .object({
        from: z.string().trim().email().max(254),
        subject: z.string().trim().min(1).max(500),
        body: z.string().trim().min(1).max(20000),
      })
      .parse({
        from:
          previous?.email.from ??
          form.get("from") ??
          "uploaded@workspace.local",
        subject: previous?.email.subject ?? form.get("subject"),
        body: previous?.email.body ?? form.get("body"),
      });
    if (files.some((f) => f.size > 5 * 1024 * 1024))
      throw new HttpError("Each file must be 5 MB or smaller.");
    if (files.some((f) => !/\.(txt|pdf|docx|xlsx)$/i.test(f.name)))
      throw new HttpError("Use TXT, PDF, DOCX or XLSX files.");
    const uploaded = previous
      ? 0
      : await storage()
          .DB.prepare(
            "SELECT COUNT(*) AS n FROM cases WHERE workspace=? AND email_id GLOB 'upload_*'",
          )
          .bind(s.id)
          .first<number>("n");
    if ((uploaded ?? 0) >= 30)
      throw new HttpError(
        "This demo allows 30 uploaded cases per workspace.",
        429,
      );
    const id = previous?.email.email_id ?? `upload_${crypto.randomUUID()}`,
      docs = [],
      paths = [];
    const started = performance.now();
    for (let i = 0; i < files.length; i++) {
      const f = files[i],
        safe = `${crypto.randomUUID().slice(0, 8)}_${i + 1}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150)}`,
        bytes = new Uint8Array(await f.arrayBuffer());
      docs.push(await parseDocument(safe, bytes));
      paths.push(`uploads/${safe}`);
      const key = `${s.id}/${id}/${safe}`;
      await storage().BUCKET.put(key, bytes, {
        httpMetadata: { contentType: f.type || "application/octet-stream" },
      });
      keys.push(key);
    }
    const email = {
        email_id: id,
        from,
        subject,
        body,
        attachments: paths,
      },
      r = analyze(
        email,
        docs,
        0,
        previous?.category_override,
        previous?.policy ?? (await getPolicy(s.id)),
      );
    if (previous) {
      r.reviewed = true;
      r.source_replaced = true;
    }
    r.duration_ms = Math.round(performance.now() - started);
    const detail = JSON.stringify({
      summary: r.summary,
      reason: replacement?.reason,
      previousAttachments: previous?.email.attachments,
      attachments: docs.map((d) => ({ name: d.name, sha256: d.sha256 })),
    });
    persistAttempted = true;
    const result = await saveCase(
      s.id,
      r,
      previous?.version ?? 0,
      previous ? "DOCUMENTS_REPLACED" : "UPLOADED",
      replacement?.actor ?? "Workspace user",
      detail,
    );
    return respond({ result }, s);
  } catch (e) {
    if (keys.length) {
      // A lost database response is not proof of rollback. Never delete bytes
      // that a committed case might reference; retain uncertain orphans for cleanup.
      // A subsequent replacement can move the committed bytes into history.
      // Looking only at the current case is insufficient proof of orphanhood.
      const safeToRemove =
        !persistAttempted ||
        (e instanceof HttpError && [409, 429].includes(e.status));
      if (safeToRemove)
        await storage()
          .BUCKET.delete(keys)
          .catch(() => {});
    }
    if (e instanceof HttpError)
      return respond({ error: e.message }, s, e.status);
    if (e instanceof z.ZodError)
      return respond(
        {
          error:
            "Complete the email, reviewer fields and case version within the displayed limits.",
        },
        s,
        400,
      );
    console.error(
      "Upload storage failed",
      e instanceof Error ? e.name : "unknown",
    );
    return respond(
      {
        error:
          "Upload storage is unavailable. Refresh the inbox before retrying to check whether the case was saved.",
      },
      s,
      503,
    );
  }
}
