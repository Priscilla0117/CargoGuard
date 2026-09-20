import { runtimeBindings } from "@/lib/runtime";
import { NextResponse } from "next/server";
import { PIPELINE_VERSION, type CaseResult, type AuditEvent } from "./types";
import { HttpError, sameRequestOrigin } from "./http";
import { DEFAULT_POLICY, withPolicy, type PolicySnapshot } from "./policy";
type Bindings = { DB: D1Database; BUCKET: R2Bucket };
export function storage() {
  const e = runtimeBindings() as Bindings;
  if (!e.DB || !e.BUCKET)
    throw new Error("Cloud storage is unavailable. Please retry shortly.");
  return e;
}
export function workspace(request: Request) {
  const value = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)cargo_workspace=([a-f0-9-]{36})(?:;|$)/)?.[1];
  return { id: value ?? crypto.randomUUID(), fresh: !value };
}
export function respond(
  data: unknown,
  session: { id: string; fresh: boolean },
  status = 200,
) {
  const r = NextResponse.json(data, { status });
  r.headers.set("Cache-Control", "no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  if (session.fresh)
    r.cookies.set("cargo_workspace", session.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });
  return r;
}
export function requireMutation(request: Request) {
  // Next's internal URL can use localhost while the actual Host is 127.0.0.1.
  // Render terminates HTTPS at its proxy; use its trusted configured public URL.
  if (
    !sameRequestOrigin(
      request,
      process.env.CARGO_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL,
    )
  )
    throw new HttpError("Cross-origin writes are not allowed.", 403);
  const s = workspace(request);
  if (s.fresh)
    throw new HttpError(
      "Workspace session expired. Refresh the page and retry.",
    );
  return s;
}
export async function getCase(ws: string, id: string) {
  const row = await storage()
    .DB.prepare(
      "SELECT payload, version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(ws, id)
    .first<{ payload: string; version: number }>();
  return row
    ? ({ ...JSON.parse(row.payload), version: row.version } as CaseResult)
    : null;
}
export async function listCases(ws: string) {
  const rows = await storage()
    .DB.prepare(
      "SELECT payload, version FROM cases WHERE workspace=? ORDER BY email_id",
    )
    .bind(ws)
    .all<{ payload: string; version: number }>();
  return rows.results.map(
    (r) => ({ ...JSON.parse(r.payload), version: r.version }) as CaseResult,
  );
}
export async function getCases(ws: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await storage()
    .DB.prepare(
      `SELECT payload, version FROM cases WHERE workspace=? AND email_id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(ws, ...ids)
    .all<{ payload: string; version: number }>();
  return rows.results.map(
    (r) => ({ ...JSON.parse(r.payload), version: r.version }) as CaseResult,
  );
}
export interface CaseWrite {
  result: CaseResult;
  expected: number;
  action: string;
  actor: string;
  detail: string;
}
export async function saveCases(
  ws: string,
  writes: CaseWrite[],
  db = storage().DB,
) {
  if (!writes.length)
    return { results: [] as CaseResult[], conflicts: [] as string[] };
  const now = new Date().toISOString();
  const statements = writes.flatMap((w) => {
    const version = w.expected + 1,
      payload = JSON.stringify({ ...withPolicy(w.result), version });
    const origin =
      !w.result.reviewed &&
      !w.result.source_replaced &&
      !w.result.category_override &&
      !w.result.documents.some((d) => d.transcription) &&
      ["PROCESSED", "REPROCESSED", "UPLOADED"].includes(w.action)
        ? "automatic"
        : "reviewed";
    const mutation =
      w.expected === 0
        ? db
            .prepare(
              "INSERT INTO cases(workspace,email_id,payload,version,updated_at) SELECT ?,?,?,?,? WHERE (? NOT GLOB 'upload_*' OR (SELECT COUNT(*) FROM cases WHERE workspace=? AND email_id GLOB 'upload_*') < 30) ON CONFLICT(workspace,email_id) DO NOTHING",
            )
            .bind(
              ws,
              w.result.email.email_id,
              payload,
              version,
              now,
              w.result.email.email_id,
              ws,
            )
        : db
            .prepare(
              "UPDATE cases SET payload=?,version=?,updated_at=? WHERE workspace=? AND email_id=? AND version=?",
            )
            .bind(
              payload,
              version,
              now,
              ws,
              w.result.email.email_id,
              w.expected,
            );
    return [
      mutation,
      db
        .prepare(
          "INSERT INTO result_revisions(workspace,email_id,version,payload,origin,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1",
        )
        .bind(
          ws,
          w.result.email.email_id,
          version,
          payload,
          origin,
          w.action,
          w.actor,
          w.detail,
          now,
        ),
      db
        .prepare(
          "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          ws,
          w.result.email.email_id,
          w.action,
          w.actor,
          w.detail,
          now,
        ),
    ];
  });
  const saved = await db.batch(statements),
    results: CaseResult[] = [],
    conflicts: string[] = [];
  for (let i = 0; i < writes.length; i++) {
    if (saved[i * 3].meta.changes === 1)
      results.push({
        ...withPolicy(writes[i].result),
        version: writes[i].expected + 1,
      });
    else conflicts.push(writes[i].result.email.email_id);
  }
  return { results, conflicts };
}

export async function getPolicy(
  ws: string,
  version?: number,
): Promise<PolicySnapshot> {
  if (version === 0) return structuredClone(DEFAULT_POLICY);
  const row = await storage()
    .DB.prepare(
      version === undefined
        ? "SELECT payload FROM policies WHERE workspace=? ORDER BY version DESC LIMIT 1"
        : "SELECT payload FROM policies WHERE workspace=? AND version=?",
    )
    .bind(...(version === undefined ? [ws] : [ws, version]))
    .first<{ payload: string }>();
  if (!row && version !== undefined)
    throw new HttpError(
      "Policy version does not exist in this workspace.",
      404,
    );
  return row ? JSON.parse(row.payload) : structuredClone(DEFAULT_POLICY);
}
export async function revisions(ws: string, id: string) {
  return (
    await storage()
      .DB.prepare(
        "SELECT version,origin,action,actor,detail,created_at FROM result_revisions WHERE workspace=? AND email_id=? ORDER BY version DESC LIMIT 100",
      )
      .bind(ws, id)
      .all()
  ).results;
}
export async function getRevision(ws: string, id: string, version: number) {
  const row = await storage()
    .DB.prepare(
      "SELECT payload FROM result_revisions WHERE workspace=? AND email_id=? AND version=?",
    )
    .bind(ws, id, version)
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as CaseResult) : null;
}
export async function automaticBaselines(ws: string) {
  // Export the earliest genuinely automatic revision from the CURRENT engine,
  // never a human-corrected, replaced-source or undocumented legacy snapshot.
  const rows = await storage()
    .DB.prepare(
      `SELECT r.payload FROM result_revisions r
    WHERE r.workspace=? AND r.origin='automatic'
    AND json_extract(r.payload,'$.pipeline_version')=?
    AND r.version=(SELECT MIN(b.version) FROM result_revisions b WHERE b.workspace=r.workspace
      AND b.email_id=r.email_id AND b.origin='automatic' AND json_extract(b.payload,'$.pipeline_version')=?)`,
    )
    .bind(ws, PIPELINE_VERSION, PIPELINE_VERSION)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload) as CaseResult);
}
export async function saveCase(
  ws: string,
  r: CaseResult,
  expected: number,
  action: string,
  actor: string,
  detail: string,
) {
  const saved = await saveCases(ws, [
    { result: r, expected, action, actor, detail },
  ]);
  if (!saved.results.length) {
    if (expected === 0 && r.email.email_id.startsWith("upload_"))
      throw new HttpError(
        "This demo allows 30 uploaded cases per workspace.",
        429,
      );
    throw new HttpError(
      "This case changed in another tab. Refresh before saving.",
      409,
    );
  }
  return saved.results[0];
}
export async function audit(ws: string, id?: string): Promise<AuditEvent[]> {
  const q = id
    ? storage()
        .DB.prepare(
          "SELECT id,email_id,action,actor,detail,created_at FROM events WHERE workspace=? AND email_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(ws, id)
    : storage()
        .DB.prepare(
          "SELECT id,email_id,action,actor,detail,created_at FROM events WHERE workspace=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(ws);
  return (await q.all<AuditEvent>()).results;
}
