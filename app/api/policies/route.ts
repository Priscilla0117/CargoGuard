import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { z } from "zod";
import { policyRules, previewPolicy, type PolicySnapshot } from "@/lib/policy";
import {
  storage,
  requireMutation,
  respond,
  getPolicy,
  listCases,
} from "@/lib/storage";
import { readJson, HttpError } from "@/lib/http";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), rules: policyRules }),
  z.object({
    action: z.literal("activate"),
    token: z.string().uuid(),
    actor: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(5).max(2000),
  }),
]);
export async function GET(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "read");
    const history = (
      await storage()
        .DB.prepare(
          "SELECT payload FROM policies WHERE workspace=? ORDER BY version DESC LIMIT 100",
        )
        .bind(s.id)
        .all<{ payload: string }>()
    ).results.map((r) => JSON.parse(r.payload));
    return respond({ policy: await getPolicy(s.id), history }, s);
  } catch (error) {
    if (error instanceof HttpError)
      return respond({ error: error.message }, s, error.status);
    return respond(
      { error: "Policy storage is unavailable. Retry shortly." },
      s,
      503,
    );
  }
}
export async function POST(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "admin");
    requireMutation(request);
    const input = action.parse(await readJson(request));
    if (input.action === "activate")
      input.actor = authenticatedActor(request, input.actor);
    const db = storage().DB;
    if (input.action === "preview") {
      const policy = await getPolicy(s.id),
        results = await listCases(s.id),
        token = crypto.randomUUID();
      const impact = previewPolicy(results, input.rules);
      const now = new Date().toISOString(),
        expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await db.batch([
        db.prepare("DELETE FROM policy_previews WHERE expires_at<?").bind(now),
        db
          .prepare(
            "INSERT INTO policy_previews(id,workspace,rules,expected_version,case_version_sum,expires_at) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            token,
            s.id,
            JSON.stringify(input.rules),
            policy.version,
            results.reduce((n, r) => n + r.version, 0),
            expires,
          ),
      ]);
      return respond(
        {
          token,
          policy,
          impact,
          caseCount: results.length,
          expires_at: expires,
          note: "Preview only; no case verdict has changed. All seven exact checks stay mandatory. Both enabled tolerance limits must be met.",
        },
        s,
      );
    }
    const preview = await db
      .prepare(
        "SELECT * FROM policy_previews WHERE id=? AND workspace=? AND expires_at>?",
      )
      .bind(input.token, s.id, new Date().toISOString())
      .first<{
        rules: string;
        expected_version: number;
        case_version_sum: number;
      }>();
    if (!preview)
      throw new HttpError(
        "Preview expired or belongs to another workspace. Preview again.",
        409,
      );
    const policy: PolicySnapshot = {
      version: preview.expected_version + 1,
      rules: policyRules.parse(JSON.parse(preview.rules)),
      actor: input.actor,
      reason: input.reason,
      created_at: new Date().toISOString(),
    };
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO policies(workspace,version,payload) SELECT ?,?,?
        WHERE COALESCE((SELECT MAX(version) FROM policies WHERE workspace=?),0)=?
        AND COALESCE((SELECT SUM(version) FROM cases WHERE workspace=?),0)=?`,
        )
        .bind(
          s.id,
          policy.version,
          JSON.stringify(policy),
          s.id,
          preview.expected_version,
          s.id,
          preview.case_version_sum,
        ),
      db
        .prepare(
          "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,'workspace','POLICY_ACTIVATED',?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          s.id,
          input.actor,
          JSON.stringify(policy),
          policy.created_at,
        ),
    ]);
    if (result[0].meta.changes !== 1)
      throw new HttpError(
        "Cases or policy changed after preview. Preview the latest state before activating.",
        409,
      );
    return respond(
      {
        policy,
        note: "Policy recorded for new processing. Existing case policy snapshots and exact verdicts are unchanged.",
      },
      s,
    );
  } catch (e) {
    return respond(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? "Check the policy values and required reviewer information."
              : "Policy operation failed; refresh before retrying.",
      },
      s,
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 503,
    );
  }
}
