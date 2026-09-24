import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { emails, bundleBytes } from "@/lib/bundle";
import { includeSampleData } from "@/lib/workspace-mode";
import {
  analyze,
  deriveResult,
  recomputeRows,
  submissionEntry,
} from "@/lib/compare";
import {
  CATEGORIES,
  FIELDS,
  PIPELINE_VERSION,
  type CaseResult,
} from "@/lib/types";
import {
  getCase,
  getCases,
  saveCase,
  saveCases,
  audit,
  respond,
  requireMutation,
  listCases,
  storage,
  getPolicy,
  revisions,
  getRevision,
  automaticBaselines,
  type CaseWrite,
} from "@/lib/storage";
import { mapLimited, processEmail } from "@/lib/processing";
import { isUnopenedAttachment } from "@/lib/intake-gate";
import { loadLabelRules } from "@/lib/label-rule-storage";
import { z } from "zod";
import { readJson, HttpError, revisionNumber } from "@/lib/http";
import { applyTranscript, type Transcript } from "@/lib/transcription";
import { correctField } from "@/lib/corrections";
import { selectedDocuments } from "@/lib/document-selection";
import { requireCurrentEngine } from "@/lib/review-guard";
const transcriptField = z.object({
  value: z.string().trim().min(1).max(1500),
  page: z.number().int().min(1).max(5),
  confirmed: z.literal(true),
});
const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select_documents"),
    id: z.string().min(1).max(80),
    version: z.number().int().positive(),
    si: z.string().min(1).max(180),
    bl: z.string().min(1).max(180),
    actor: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(5).max(2000),
  }),
  z.object({
    action: z.literal("process"),
    ids: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length),
    skipSaved: z.boolean().optional(),
    policyVersion: z.number().int().nonnegative().optional(),
  }),
  z.object({
    action: z.literal("review"),
    id: z.string().max(80),
    version: z.number().int().positive(),
    actor: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(5).max(2000),
    field: z.enum(FIELDS),
    side: z.enum(["si", "bl"]),
    value: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("route"),
    id: z.string().min(1).max(80),
    version: z.number().int().positive(),
    actor: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(5).max(2000),
    category: z.enum(CATEGORIES),
  }),
  z.object({
    action: z.literal("transcribe"),
    id: z.string().min(1).max(80),
    version: z.number().int().positive(),
    name: z.string().min(1).max(180),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    role: z.enum(["SI", "BL"]),
    actor: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(5).max(2000),
    fields: z.object({
      shipper: transcriptField,
      consignee: transcriptField,
      notify_party: transcriptField,
      port_of_loading: transcriptField,
      port_of_discharge: transcriptField,
      container_count: transcriptField,
      gross_weight_kg: transcriptField,
    }),
  }),
]);
export async function GET(request: Request) {
  let s = errorSession(request);
  const url = new URL(request.url);
  try {
    s = await requireCapability(request, "read");
    if (url.searchParams.get("export") === "1") {
      const mode = url.searchParams.get("mode") ?? "baseline";
      if (mode === "baseline" && !includeSampleData())
        throw new HttpError(
          "Organiser benchmark export is disabled in this workspace. Use the reviewed evidence export for your imported records.",
          409,
        );
      if (!["baseline", "reviewed"].includes(mode))
        throw new HttpError("Unknown export mode.");
      const all =
          mode === "baseline"
            ? await automaticBaselines(s.id)
            : await listCases(s.id),
        map = new Map(all.map((r) => [r.email.email_id, r]));
      if (mode === "baseline" && emails.some((e) => !map.has(e.email_id)))
        return respond(
          {
            error:
              "A complete, current-engine automatic baseline is required. Run the full inbox first. If only reviewed, replaced-source or legacy results exist, use a fresh private-browser workspace for an untouched baseline; existing reviews are retained.",
          },
          s,
          409,
        );
      const result =
        mode === "baseline"
          ? Object.fromEntries(
              emails.map((e) => [
                e.email_id,
                submissionEntry(map.get(e.email_id)!),
              ]),
            )
          : null;
      const output =
        mode === "baseline"
          ? result
          : {
              format: "cargoguard-reviewed-evidence-v3",
              generated_at: new Date().toISOString(),
              warning:
                "Reviewed operational evidence, NOT untouched automatic model accuracy. Strict mismatches remain visible regardless of business policy.",
              cases: all.map((r) => ({
                ...r,
                strict_verdict: submissionEntry(r),
              })),
            };
      return new Response(JSON.stringify(output, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename=cargoguard-${mode}.json`,
          "Cache-Control": "no-store",
        },
      });
    }
    const id = url.searchParams.get("id") ?? "";
    const v = revisionNumber(url.searchParams.get("revision"));
    const result = v ? await getRevision(s.id, id, v) : await getCase(s.id, id);
    if (!result)
      return respond({ error: "Case has not been processed yet." }, s, 404);
    return respond(
      {
        result,
        audit: await audit(s.id, id),
        revisions: await revisions(s.id, id),
        historical: !!v,
      },
      s,
    );
  } catch (e) {
    return respond(
      {
        error:
          e instanceof HttpError
            ? e.message
            : "Unable to load case. Retry shortly.",
      },
      s,
      e instanceof HttpError ? e.status : 503,
    );
  }
}
export async function POST(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "operate");
    requireMutation(request);
    const payload = await readJson(request);
    const input = action.parse(payload);
    if (input.action !== "process") {
      await requireCapability(request, "review");
      input.actor = authenticatedActor(request, input.actor);
    }
    if (input.action === "process") {
      const policy = await getPolicy(s.id, input.policyVersion);
      const labelRules = await loadLabelRules(s.id);
      const started = performance.now(),
        saved = new Map(
          (await getCases(s.id, input.ids)).map((r) => [r.email.email_id, r]),
        );
      const jobs = input.ids.map((id) => ({
        id,
        previous: saved.get(id),
        email:
          saved.get(id)?.email ??
          (includeSampleData()
            ? emails.find((e) => e.email_id === id)
            : undefined),
      }));
      if (jobs.some((j) => !j.email)) throw new HttpError("Unknown email ID.");
      const cached: CaseResult[] = [],
        errors: { id: string; error: string }[] = [],
        writes: CaseWrite[] = [];
      await mapLimited(jobs, 2, async (job) => {
        if (
          input.skipSaved &&
          job.previous?.pipeline_version === PIPELINE_VERSION &&
          (job.previous?.policy?.version ?? 0) === policy.version
        ) {
          cached.push(job.previous);
          return;
        }
        try {
          const read = async (path: string) =>
            bundleBytes(path) ??
            (await storage()
              .BUCKET.get(`${s.id}/${job.id}/${path.split("/").pop()}`)
              .then((o) =>
                o ? o.arrayBuffer().then((b) => new Uint8Array(b)) : null,
              ));
          const result = await processEmail(
            job.email!,
            read,
            job.previous,
            !!input.skipSaved,
            policy,
            labelRules,
          );
          writes.push({
            result,
            expected: job.previous?.version ?? 0,
            action: job.previous ? "REPROCESSED" : "PROCESSED",
            actor: authenticatedActor(request, "CargoGuard"),
            detail: JSON.stringify({
              summary: result.summary,
              pipeline: PIPELINE_VERSION,
              preservedCorrections: !!(input.skipSaved && result.reviewed),
            }),
          });
        } catch {
          errors.push({
            id: job.id,
            error:
              "Document processing failed. The prior result was not replaced. Retry this case.",
          });
        }
      });
      const committed = await saveCases(s.id, writes);
      // A concurrent idempotent resume can reuse the winner, never create a second event.
      if (input.skipSaved && committed.conflicts.length) {
        const latest = await getCases(s.id, committed.conflicts);
        for (const id of committed.conflicts) {
          const winner = latest.find(
            (r) =>
              r.email.email_id === id &&
              r.pipeline_version === PIPELINE_VERSION &&
              (r.policy?.version ?? 0) === policy.version,
          );
          if (winner) cached.push(winner);
          else
            errors.push({
              id,
              error: "Case changed concurrently. Refresh and retry.",
            });
        }
      } else
        for (const id of committed.conflicts)
          errors.push({
            id,
            error: "Case changed concurrently. Refresh before reprocessing.",
          });
      const results = [...cached, ...committed.results].sort(
        (a, b) =>
          input.ids.indexOf(a.email.email_id) -
          input.ids.indexOf(b.email.email_id),
      );
      return respond(
        {
          results,
          errors,
          server_ms: Math.round(performance.now() - started),
          pipeline_version: PIPELINE_VERSION,
        },
        s,
      );
    }
    const previous = await getCase(s.id, input.id);
    if (!previous || previous.version !== input.version)
      throw new HttpError("Case changed. Refresh it before saving.", 409);
    requireCurrentEngine(previous);
    if (input.action === "select_documents") {
      if (previous.category !== "BL_COMPARISON")
        throw new HttpError(
          "Confirm the BL comparison category before selecting a document pair.",
          422,
        );
      const selection = {
        si: {
          name: input.si,
          sha256:
            previous.documents.find((d) => d.name === input.si)?.sha256 ?? "",
        },
        bl: {
          name: input.bl,
          sha256:
            previous.documents.find((d) => d.name === input.bl)?.sha256 ?? "",
        },
        actor: input.actor,
        reason: input.reason,
        selected_at: new Date().toISOString(),
      };
      selectedDocuments(previous.documents, selection);
      if (
        previous.document_selection?.si.name === input.si &&
        previous.document_selection?.bl.name === input.bl
      )
        throw new HttpError(
          "This pair is already selected. Existing corrections have been retained.",
          422,
        );
      const result = {
        ...analyze(
          previous.email,
          previous.documents,
          previous.duration_ms,
          previous.category_override,
          previous.policy,
          selection,
        ),
        reviewed: true,
        source_replaced: previous.source_replaced,
      };
      const updated = await saveCase(
        s.id,
        result,
        input.version,
        "DOCUMENT_PAIR_SELECTED",
        input.actor,
        JSON.stringify({
          selection,
          excluded: previous.documents
            .filter((d) => ![input.si, input.bl].includes(d.name))
            .map((d) => d.name),
          previousSelection: previous.document_selection,
          correctionsReset: previous.reviewed === true,
        }),
      );
      return respond(
        { result: updated, audit: await audit(s.id, input.id) },
        s,
      );
    }
    if (input.action === "transcribe") {
      const transcript: Transcript = {
        role: input.role,
        fields: input.fields,
        actor: input.actor,
        reason: input.reason,
        confirmed_at: new Date().toISOString(),
      };
      const result = applyTranscript(
        previous,
        input.name,
        input.sha256,
        transcript,
      );
      const updated = await saveCase(
        s.id,
        result,
        input.version,
        "SCAN_TRANSCRIPTION_CONFIRMED",
        input.actor,
        JSON.stringify({
          document: input.name,
          sha256: input.sha256,
          transcript,
        }),
      );
      return respond(
        { result: updated, audit: await audit(s.id, input.id) },
        s,
      );
    }
    if (input.action === "route") {
      // A confirmed non-spam route is an explicit instruction to inspect the
      // retained source files. Analyzing old placeholders would strand this
      // case in "wrong document type" until an unrelated reprocess action.
      const reopened =
        input.category !== "SPAM" &&
        previous.documents.some(isUnopenedAttachment)
          ? await processEmail(
              previous.email,
              async (path) =>
                bundleBytes(path) ??
                (await storage()
                  .BUCKET.get(`${s.id}/${input.id}/${path.split("/").pop()}`)
                  .then((object) =>
                    object
                      ? object
                          .arrayBuffer()
                          .then((bytes) => new Uint8Array(bytes))
                      : null,
                  )),
              { ...previous, category_override: input.category },
              true,
              previous.policy,
              await loadLabelRules(s.id),
            )
          : null;
      let result: CaseResult = {
        ...(reopened ??
          analyze(
            previous.email,
            previous.documents,
            previous.duration_ms,
            input.category,
            previous.policy,
            previous.document_selection,
          )),
        reviewed: true,
        source_replaced: previous.source_replaced,
      };
      if (
        input.category === previous.category &&
        previous.comparison.length &&
        result.comparison.length
      ) {
        result = {
          ...deriveResult(result, recomputeRows(previous.comparison)),
          reviewed: true,
        };
      }
      const updated = await saveCase(
        s.id,
        result,
        input.version,
        "CATEGORY_CONFIRMED",
        input.actor,
        JSON.stringify({
          before: previous.category,
          after: input.category,
          reason: input.reason,
        }),
      );
      return respond(
        { result: updated, audit: await audit(s.id, input.id) },
        s,
      );
    }
    const old = previous.comparison.find((r) => r.field === input.field)?.[
      input.side
    ].raw;
    const result = correctField(previous, input, input.actor);
    const updated = await saveCase(
      s.id,
      result,
      input.version,
      "FIELD_CORRECTED",
      input.actor,
      JSON.stringify({
        field: input.field,
        side: input.side,
        before: old,
        after: input.value,
        reason: input.reason,
      }),
    );
    return respond({ result: updated, audit: await audit(s.id, input.id) }, s);
  } catch (e) {
    if (e instanceof HttpError)
      return respond({ error: e.message }, s, e.status);
    if (e instanceof z.ZodError)
      return respond(
        { error: "Invalid request. Check the required fields." },
        s,
        400,
      );
    console.error(
      "Case operation failed",
      e instanceof Error ? e.name : "unknown",
    );
    return respond(
      {
        error:
          "Storage or processing is temporarily unavailable. Refresh and retry; saved decisions are retained.",
      },
      s,
      503,
    );
  }
}
