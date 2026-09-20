import { emails, bundleBytes } from "@/lib/bundle";
import {
  analyze,
  deriveResult,
  normalize,
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
  workspace,
  respond,
  requireMutation,
  listCases,
  storage,
  type CaseWrite,
} from "@/lib/storage";
import { mapLimited, processEmail } from "@/lib/processing";
import { z } from "zod";
import { readJson, HttpError } from "@/lib/http";
import { applyTranscript, type Transcript } from "@/lib/transcription";
const transcriptField = z.object({
  value: z.string().trim().min(1).max(1500),
  page: z.number().int().min(1).max(5),
  confirmed: z.literal(true),
});
const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("process"),
    ids: z
      .array(z.string().min(1).max(80))
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length),
    skipSaved: z.boolean().optional(),
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
  const s = workspace(request),
    url = new URL(request.url);
  try {
    if (url.searchParams.get("export") === "1") {
      const all = await listCases(s.id),
        map = new Map(all.map((r) => [r.email.email_id, r]));
      if (emails.some((e) => !map.has(e.email_id)))
        return respond(
          {
            error:
              "Process all organiser emails before exporting the complete submission.",
          },
          s,
          409,
        );
      const result = Object.fromEntries(
        emails.map((e) => [e.email_id, submissionEntry(map.get(e.email_id)!)]),
      );
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition":
            "attachment; filename=cargoguard-submission.json",
          "Cache-Control": "no-store",
        },
      });
    }
    const id = url.searchParams.get("id") ?? "",
      result = await getCase(s.id, id);
    if (!result)
      return respond({ error: "Case has not been processed yet." }, s, 404);
    return respond({ result, audit: await audit(s.id, id) }, s);
  } catch (e) {
    return respond(
      { error: e instanceof Error ? e.message : "Unable to load case." },
      s,
      503,
    );
  }
}
export async function POST(request: Request) {
  let s = workspace(request);
  try {
    const payload = await readJson(request);
    s = requireMutation(request);
    const input = action.parse(payload);
    if (input.action === "process") {
      const started = performance.now(),
        saved = new Map(
          (await getCases(s.id, input.ids)).map((r) => [r.email.email_id, r]),
        );
      const jobs = input.ids.map((id) => ({
        id,
        previous: saved.get(id),
        email: saved.get(id)?.email ?? emails.find((e) => e.email_id === id),
      }));
      if (jobs.some((j) => !j.email)) throw new HttpError("Unknown email ID.");
      const cached: CaseResult[] = [],
        errors: { id: string; error: string }[] = [],
        writes: CaseWrite[] = [];
      await mapLimited(jobs, 2, async (job) => {
        if (
          input.skipSaved &&
          job.previous?.pipeline_version === PIPELINE_VERSION
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
          );
          writes.push({
            result,
            expected: job.previous?.version ?? 0,
            action: job.previous ? "REPROCESSED" : "PROCESSED",
            actor: "CargoGuard",
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
              r.pipeline_version === PIPELINE_VERSION,
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
      let result = {
        ...analyze(
          previous.email,
          previous.documents,
          previous.duration_ms,
          input.category,
        ),
        reviewed: true,
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
    if (!previous.comparison.length)
      throw new HttpError(
        "This case requires readable SI and BL documents before field correction.",
        422,
      );
    const rows = structuredClone(previous.comparison),
      row = rows.find((r) => r.field === input.field)!;
    if (normalize(input.field, input.value) === null)
      throw new HttpError(
        "Enter a complete, unambiguous field value. Use kilograms for ambiguous weights.",
        422,
      );
    const old = row[input.side].raw;
    row[input.side] = {
      ...row[input.side],
      raw: input.value,
      extraction_issue: undefined,
      issue: undefined,
      method: `Human correction by ${input.actor}`,
      evidence: `Reviewer confirmed; original source: ${row[input.side].evidence}`,
    };
    const result = deriveResult(
      { ...previous, reviewed: true, pipeline_version: PIPELINE_VERSION },
      recomputeRows(rows),
    );
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
