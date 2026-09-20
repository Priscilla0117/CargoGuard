import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import type { CaseResult, AuditEvent } from "./types";
import { HttpError } from "./http";
type Bindings = { DB: D1Database; BUCKET: R2Bucket };
export function storage() {
  const e = env as unknown as Bindings;
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
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin)
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
export async function saveCases(ws: string, writes: CaseWrite[]) {
  if (!writes.length)
    return { results: [] as CaseResult[], conflicts: [] as string[] };
  const db = storage().DB,
    now = new Date().toISOString();
  const statements = writes.flatMap((w) => {
    const version = w.expected + 1,
      payload = JSON.stringify({ ...w.result, version });
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
    if (saved[i * 2].meta.changes === 1)
      results.push({ ...writes[i].result, version: writes[i].expected + 1 });
    else conflicts.push(writes[i].result.email.email_id);
  }
  return { results, conflicts };
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
