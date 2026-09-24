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
import { attachmentPlan, deferredDocument } from "@/lib/processing";
import {
  replacementSources,
  analyzeReplacement,
} from "@/lib/source-replacement";
import { bundleBytes } from "@/lib/bundle";
import type { Email, ParsedDocument } from "@/lib/types";

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
      "mode",
      "targetName",
      "targetSha256",
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
    const mode = z
      .enum(["replace_all", "replace_one", "append"])
      .parse(form.get("mode") ?? "replace_all");
    if (!replacement && mode !== "replace_all")
      throw new HttpError(
        "Choose an existing case for this attachment operation.",
      );
    if (replacement && mode === "replace_one" && files.length !== 1)
      throw new HttpError("Choose exactly one replacement file.");
    if (replacement && mode === "append" && files.length < 1)
      throw new HttpError("Choose at least one attachment to add.");
    if (replacement && mode === "replace_all" && files.length < 2)
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
    const id = previous?.email.email_id ?? `upload_${crypto.randomUUID()}`;
    const retained = previous
      ? replacementSources(
          previous,
          mode,
          typeof form.get("targetName") === "string"
            ? String(form.get("targetName"))
            : undefined,
          typeof form.get("targetSha256") === "string"
            ? String(form.get("targetSha256"))
            : undefined,
        )
      : { documents: [] as ParsedDocument[], paths: [] as string[] };
    const docs: ParsedDocument[] = [...retained.documents],
      paths = [...retained.paths];
    if (docs.length + files.length > 10)
      throw new HttpError(
        "The resulting case may contain at most 10 attachments.",
      );
    let combinedSize = files.reduce((sum, f) => sum + f.size, 0);
    for (const path of retained.paths) {
      const bytes =
        bundleBytes(path) ??
        (await storage()
          .BUCKET.get(`${s.id}/${id}/${path.split("/").pop()}`)
          .then((o) =>
            o ? o.arrayBuffer().then((b) => new Uint8Array(b)) : null,
          ));
      if (!bytes)
        throw new HttpError(
          "An unchanged source is unavailable. Restore it before replacing another document.",
          409,
        );
      combinedSize += bytes.length;
    }
    if (combinedSize > 20 * 1024 * 1024)
      throw new HttpError(
        "The resulting attachments must be 20 MB or smaller.",
        413,
      );
    const email: Email = {
      ...(previous?.email ?? {}),
      email_id: id,
      from,
      subject,
      body,
      attachments: paths,
      imported_at: previous?.email.imported_at ?? new Date().toISOString(),
    };
    const plan = attachmentPlan(email, previous?.category_override);
    const started = performance.now();
    for (let i = 0; i < files.length; i++) {
      const f = files[i],
        safe = `${crypto.randomUUID().slice(0, 8)}_${i + 1}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150)}`,
        bytes = new Uint8Array(await f.arrayBuffer());
      const doc = plan.parse
        ? await parseDocument(safe, bytes)
        : deferredDocument(safe);
      doc.size_bytes = bytes.length;
      if (!doc.sha256)
        doc.sha256 = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
          ),
        )
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      docs.push(doc);
      paths.push(`uploads/${safe}`);
      const key = `${s.id}/${id}/${safe}`;
      await storage().BUCKET.put(key, bytes, {
        httpMetadata: { contentType: f.type || "application/octet-stream" },
      });
      keys.push(key);
    }
    const r = previous
      ? analyzeReplacement(previous, docs, paths, plan.classification)
      : analyze(
          email,
          docs,
          0,
          undefined,
          await getPolicy(s.id),
          undefined,
          plan.classification,
        );
    if (previous) {
      r.reviewed = true;
      r.source_replaced = true;
    }
    r.duration_ms = Math.round(performance.now() - started);
    const detail = JSON.stringify({
      summary: r.summary,
      reason: replacement?.reason,
      mode,
      targetName: form.get("targetName"),
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
