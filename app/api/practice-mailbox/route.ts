import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { parseEml } from "@/lib/eml";
import { FIELD_TEST, renderEml } from "@/lib/field-test";
import { parseDocument } from "@/lib/parsers";
import { analyze } from "@/lib/compare";
import { applyLabelRules } from "@/lib/label-rules";
import { loadLabelRules } from "@/lib/label-rule-storage";
import { workspaceConfiguration } from "@/lib/workspace-mode";
import {
  getCase,
  getPolicy,
  requireMutation,
  respond,
  saveCase,
  storage,
} from "@/lib/storage";
import type { Email } from "@/lib/types";

/**
 * Loads the team-authored practice mailbox (28 Averis-style emails, dated
 * relative to today) through the normal document pipeline. Training only:
 * disabled wherever organiser/sample data is disabled.
 */
export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "operate");
    requireMutation(request);
    if (!workspaceConfiguration().sample_data)
      throw new HttpError(
        "Practice emails are turned off in this workspace.",
        403,
      );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [labelRules, policy] = await Promise.all([
      loadLabelRules(session.id),
      getPolicy(session.id),
    ]);
    const actor = authenticatedActor(request, "Practice mailbox");
    let imported = 0,
      skipped = 0;
    for (const scenario of FIELD_TEST) {
      const id = `practice_${scenario.id}`;
      if (await getCase(session.id, id)) {
        skipped++;
        continue;
      }
      const mail = await parseEml(
        new TextEncoder().encode(renderEml(scenario, today)),
      );
      const existing = await storage()
        .DB.prepare(
          "SELECT email_id FROM cases WHERE workspace=? AND json_extract(payload,'$.email.message_id')=? LIMIT 1",
        )
        .bind(session.id, mail.message_id ?? "")
        .first<{ email_id: string }>();
      if (existing) {
        skipped++;
        continue;
      }
      const paths: string[] = [];
      const docs = [];
      for (let i = 0; i < mail.attachments.length; i++) {
        const file = mail.attachments[i];
        const safe = `${i + 1}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150)}`;
        await storage().BUCKET.put(`${session.id}/${id}/${safe}`, file.bytes, {
          httpMetadata: {
            contentType: file.type || "application/octet-stream",
          },
        });
        paths.push(`uploads/${safe}`);
        docs.push(await parseDocument(safe, file.bytes));
      }
      const email: Email = {
        email_id: id,
        from: mail.from,
        subject: mail.subject,
        body: mail.body,
        attachments: paths,
        received_at: mail.received_at,
        message_id: mail.message_id,
        in_reply_to: mail.in_reply_to,
        references: mail.references,
        to: mail.to,
        source: "eml",
      };
      const result = analyze(
        email,
        await applyLabelRules(docs, labelRules),
        0,
        undefined,
        policy,
      );
      await saveCase(
        session.id,
        result,
        0,
        "UPLOADED",
        actor,
        JSON.stringify({ summary: `Practice email loaded: ${result.summary}` }),
      );
      imported++;
    }
    return respond({ imported, skipped }, session);
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Practice emails could not be loaded. Try again.",
      },
      session,
      error instanceof HttpError ? error.status : 503,
    );
  }
}
