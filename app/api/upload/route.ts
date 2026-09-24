import { workspaceUploadLimit } from "@/lib/workspace-mode";
import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { parseDocument } from "@/lib/parsers";
import { applyLabelRules } from "@/lib/label-rules";
import { loadLabelRules } from "@/lib/label-rule-storage";
import { analyze } from "@/lib/compare";
import {
  requireMutation,
  respond,
  saveCase,
  getCase,
  storage,
  getPolicy,
} from "@/lib/storage";
import { z } from "zod";
import { readForm, HttpError } from "@/lib/http";
import { bundleBytes } from "@/lib/bundle";
import { blReplacementSources, replaceDraftBl } from "@/lib/bl-replacement";
import type { Email, ParsedDocument } from "@/lib/types";
import { parseEml, type ParsedEmail } from "@/lib/eml";

const messageId = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .regex(/^[^\s<>]+$/);
const emailList = z
  .string()
  .max(5000)
  .transform((value) =>
    value
      .split(/[,;\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().email().max(254)).max(50));
/** Optional mailbox metadata supplied by the import dialog or a mail connector. */
const metadataSchema = z
  .object({
    received_at: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value).toISOString())
      .optional(),
    message_id: messageId.optional(),
    in_reply_to: messageId.optional(),
    references: z
      .string()
      .max(20000)
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid references" });
          return z.NEVER;
        }
      })
      .pipe(z.array(messageId).max(50))
      .optional(),
    to: emailList.optional(),
    cc: emailList.optional(),
    source: z.enum(["upload", "eml", "gmail", "imap", "outlook"]).optional(),
    thread_hint: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_.:=-]+$/)
      .optional(),
  })
  .strict();
const METADATA_FIELDS = [
  "received_at",
  "message_id",
  "in_reply_to",
  "references",
  "to",
  "cc",
  "source",
  "thread_hint",
] as const;
type EmailMetadata = Pick<Email, (typeof METADATA_FIELDS)[number]>;
function metadataFrom(value: Partial<Email>): EmailMetadata {
  const meta: EmailMetadata = {};
  for (const key of METADATA_FIELDS)
    if (value[key] !== undefined && value[key] !== "")
      (meta as Record<string, unknown>)[key] = value[key];
  if (Array.isArray(meta.references) && !meta.references.length)
    delete meta.references;
  for (const key of ["to", "cc"] as const)
    if (Array.isArray(meta[key]) && !meta[key]!.length) delete meta[key];
  return meta;
}

export async function POST(request: Request) {
  let s = errorSession(request);
  const keys: string[] = [];
  let persistAttempted = false;
  try {
    s = await requireCapability(request, "operate");
    requireMutation(request);
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
      "bl",
      "eml",
      ...METADATA_FIELDS,
    ])
      if (form.getAll(field).length > 1)
        throw new HttpError(`Only one ${field} field is allowed.`);
    // A saved .eml message carries its own sender, subject, date and files.
    let parsedEml: ParsedEmail | null = null;
    if (form.has("eml")) {
      const eml = form.get("eml");
      if (!(eml instanceof File) || !eml.size)
        throw new HttpError("Choose a nonempty .eml email file.");
      if (
        [...form.keys()].some(
          (key) => !["eml", "source", "thread_hint"].includes(key),
        )
      )
        throw new HttpError(
          "Import an .eml email on its own. Its attachments are read from the message.",
        );
      parsedEml = await parseEml(new Uint8Array(await eml.arrayBuffer()));
      if (parsedEml.attachments.length > 10)
        throw new HttpError(
          "This email has more than 10 supported attachments. Import the needed documents manually.",
        );
    }
    const mode = form.get("mode");
    if (mode !== null && mode !== "replace_bl")
      throw new HttpError("Unknown document replacement mode.");
    const blOnly = mode === "replace_bl";
    if (blOnly) {
      const allowed = new Set([
        "mode",
        "id",
        "version",
        "actor",
        "reason",
        "bl",
      ]);
      if ([...form.keys()].some((key) => !allowed.has(key)))
        throw new HttpError(
          "BL-only replacement accepts only the revised BL and review details. The SI comes from the saved case.",
        );
      const bl = form.get("bl");
      if (!(bl instanceof File) || !bl.name || !bl.size)
        throw new HttpError("Choose exactly one nonempty revised BL file.");
      if (!form.get("id"))
        throw new HttpError(
          "Select an existing comparison case before replacing its BL.",
        );
    } else if (form.has("bl"))
      throw new HttpError(
        "Use BL-only replacement mode for a revised BL file.",
      );
    if (form.getAll("files").some((x) => !(x instanceof File)))
      throw new HttpError("The attachment field must contain files.");
    const files = parsedEml
      ? parsedEml.attachments.map(
          (item) =>
            new File([item.bytes.slice().buffer], item.name, {
              type: item.type || "application/octet-stream",
            }),
        )
      : form
          .getAll(blOnly ? "bl" : "files")
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
            version: z.coerce.number().int().positive().safe(),
            actor: z.string().trim().min(2).max(80),
            reason: z.string().trim().min(5).max(2000),
          })
          .parse(Object.fromEntries(form))
      : null;
    if (replacement)
      replacement.actor = authenticatedActor(request, replacement.actor);
    const previous = replacement ? await getCase(s.id, replacement.id) : null;
    if (replacement && (!previous || previous.version !== replacement.version))
      return respond(
        { error: "Case changed. Refresh it before replacing documents." },
        s,
        409,
      );
    if (blOnly && previous) blReplacementSources(previous);
    if (replacement && !blOnly && files.length < 2)
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
          parsedEml?.from ??
          form.get("from") ??
          "uploaded@workspace.local",
        subject:
          previous?.email.subject ?? parsedEml?.subject ?? form.get("subject"),
        body: previous?.email.body ?? parsedEml?.body ?? form.get("body"),
      });
    const metadata: EmailMetadata = previous
      ? metadataFrom(previous.email)
      : parsedEml
        ? metadataFrom({
            received_at: parsedEml.received_at,
            message_id: parsedEml.message_id,
            in_reply_to: parsedEml.in_reply_to,
            references: parsedEml.references,
            to: parsedEml.to,
            cc: parsedEml.cc,
            ...metadataSchema.pick({ source: true, thread_hint: true }).parse({
              source:
                form.get("source") === "gmail" || form.get("source") === "imap"
                  ? form.get("source")
                  : "eml",
              thread_hint: form.get("thread_hint") || undefined,
            }),
          })
        : metadataFrom(
            metadataSchema.parse(
              Object.fromEntries(
                METADATA_FIELDS.flatMap((key) => {
                  const value = form.get(key);
                  return typeof value === "string" && value.trim()
                    ? [[key, value]]
                    : [];
                }),
              ),
            ),
          );
    if (!previous && metadata.message_id) {
      // The same message imported twice (file, Gmail or Outlook) opens the saved case.
      const existing = await storage()
        .DB.prepare(
          "SELECT email_id FROM cases WHERE workspace=? AND json_extract(payload,'$.email.message_id')=? LIMIT 1",
        )
        .bind(s.id, metadata.message_id)
        .first<{ email_id: string }>();
      if (existing) {
        const saved = await getCase(s.id, existing.email_id);
        if (saved)
          return respond(
            {
              result: saved,
              duplicate: true,
              skipped: parsedEml?.skipped ?? [],
            },
            s,
          );
      }
    }
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
    if ((uploaded ?? 0) >= workspaceUploadLimit())
      throw new HttpError(
        `This workspace has reached its limit of ${workspaceUploadLimit()} imported cases. Ask your administrator to review capacity.`,
        429,
      );
    const id = previous?.email.email_id ?? `upload_${crypto.randomUUID()}`,
      docs: ParsedDocument[] = [],
      paths: string[] = [];
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
    const email: Email = {
      ...metadata,
      email_id: id,
      from,
      subject,
      body,
      attachments: paths,
    };
    if (!previous && !email.received_at)
      email.received_at = new Date().toISOString();
    if (!previous && !email.source) email.source = "upload";
    const labelRules = await loadLabelRules(s.id);
    const partial =
      blOnly && previous
        ? await replaceDraftBl(
            previous,
            docs[0],
            async (path) =>
              bundleBytes(path) ??
              (await storage()
                .BUCKET.get(`${s.id}/${id}/${path.split("/").pop()}`)
                .then((object) =>
                  object
                    ? object
                        .arrayBuffer()
                        .then((bytes) => new Uint8Array(bytes))
                    : null,
                )),
            { actor: replacement!.actor, reason: replacement!.reason },
            labelRules,
          )
        : null;
    const r =
      partial?.result ??
      analyze(
        email,
        await applyLabelRules(docs, labelRules),
        0,
        previous?.category_override,
        previous?.policy ?? (await getPolicy(s.id)),
      );
    if (previous) {
      r.reviewed = true;
      r.source_replaced = true;
    }
    if (r.documents.some((doc) => doc.label_rules)) r.reviewed = true;
    r.duration_ms = Math.round(performance.now() - started);
    const detail = JSON.stringify({
      summary: r.summary,
      reason: replacement?.reason,
      previousAttachments: previous?.email.attachments,
      attachments: docs.map((d) => ({ name: d.name, sha256: d.sha256 })),
      ...(partial
        ? {
            mode: "replace_bl",
            retainedSi: partial.retainedSi,
            replacedBl: partial.replacedBl,
            retainedSiCorrections: partial.retainedCorrections,
            excludedAttachments: r.documents
              .filter(
                (doc) =>
                  ![partial.retainedSi.name, docs[0].name].includes(doc.name),
              )
              .map((doc) => ({ name: doc.name, sha256: doc.sha256 })),
          }
        : {}),
    });
    persistAttempted = true;
    const result = await saveCase(
      s.id,
      r,
      previous?.version ?? 0,
      previous ? "DOCUMENTS_REPLACED" : "UPLOADED",
      authenticatedActor(request, replacement?.actor ?? "Workspace user"),
      detail,
    );
    return respond({ result, skipped: parsedEml?.skipped ?? [] }, s);
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
