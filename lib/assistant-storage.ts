import { HttpError } from "./http";
import type { AssistantReply } from "./assistant";

export async function assistantReply(
  db: D1Database,
  workspace: string,
  selector: { id: string } | { key: string },
  now = new Date(),
) {
  const row = await db
    .prepare(
      `SELECT payload FROM assistant_replies WHERE workspace=? AND ${"id" in selector ? "id" : "cache_key"}=? AND expires_at>?`,
    )
    .bind(
      workspace,
      "id" in selector ? selector.id : selector.key,
      now.toISOString(),
    )
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as AssistantReply) : null;
}
export async function persistAssistantReply(
  db: D1Database,
  workspace: string,
  key: string,
  reply: AssistantReply,
) {
  const payload = JSON.stringify(reply);
  if (new TextEncoder().encode(payload).byteLength > 45000)
    throw new HttpError(
      "Conversation storage limit reached. Nothing changed.",
      503,
    );
  await db.batch([
    db
      .prepare("DELETE FROM assistant_replies WHERE expires_at<=?")
      .bind(new Date().toISOString()),
    db
      .prepare(
        "INSERT INTO assistant_replies(id,workspace,cache_key,payload,expires_at) VALUES(?,?,?,?,?)",
      )
      .bind(reply.id, workspace, key, payload, reply.expires_at),
  ]);
}
