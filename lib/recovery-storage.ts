import { HttpError } from "./http";
import { RECOVERY_LIMITS, type RecoveryProposal } from "./recovery-schema";

export async function cachedRecovery(
  db: D1Database,
  workspace: string,
  cacheKey: string,
  now = new Date(),
) {
  const row = await db
    .prepare(
      "SELECT payload FROM recovery_proposals WHERE workspace=? AND cache_key=? AND expires_at>?",
    )
    .bind(workspace, cacheKey, now.toISOString())
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as RecoveryProposal) : null;
}
export async function getRecoveryProposal(
  db: D1Database,
  workspace: string,
  id: string,
  now = new Date(),
) {
  const row = await db
    .prepare(
      "SELECT payload FROM recovery_proposals WHERE workspace=? AND id=? AND expires_at>?",
    )
    .bind(workspace, id, now.toISOString())
    .first<{ payload: string }>();
  if (!row)
    throw new HttpError(
      "The proposal expired or is not available in this workspace. Generate a fresh proposal.",
      409,
    );
  return JSON.parse(row.payload) as RecoveryProposal;
}
export async function reserveRecoveryAttempt(
  db: D1Database,
  workspace: string,
  cacheKey: string,
  reservedTokens: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(reservedTokens) || reservedTokens < 1)
    throw new HttpError("Invalid recovery budget reservation.", 400);
  const id = crypto.randomUUID(),
    day = now.toISOString().slice(0, 10);
  const result = await db
    .prepare(
      `INSERT INTO recovery_attempts(id,workspace,cache_key,quota_day,reserved_tokens,status,lease_until,created_at)
    SELECT ?,?,?,?,?,'pending',?,?
    WHERE (SELECT COUNT(*) FROM recovery_attempts WHERE workspace=? AND quota_day=?)<?
    AND (SELECT COUNT(*) FROM recovery_attempts WHERE quota_day=?)<?
    AND (SELECT COUNT(*) FROM recovery_attempts)<?
    AND COALESCE((SELECT SUM(reserved_tokens) FROM recovery_attempts WHERE quota_day=?),0)+?<=?
    AND (SELECT COUNT(*) FROM recovery_attempts WHERE status='pending' AND lease_until>?)<?
    AND NOT EXISTS(SELECT 1 FROM recovery_attempts WHERE workspace=? AND status='pending' AND lease_until>?)`,
    )
    .bind(
      id,
      workspace,
      cacheKey,
      day,
      reservedTokens,
      new Date(now.getTime() + 60000).toISOString(),
      now.toISOString(),
      workspace,
      day,
      RECOVERY_LIMITS.workspaceDailyCalls,
      day,
      RECOVERY_LIMITS.globalDailyCalls,
      RECOVERY_LIMITS.globalLifetimeCalls,
      day,
      reservedTokens,
      RECOVERY_LIMITS.globalDailyReservedTokens,
      now.toISOString(),
      RECOVERY_LIMITS.concurrentCalls,
      workspace,
      now.toISOString(),
    )
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(
      "The shared AI demo budget or concurrency limit has been reached. Chat and document recovery use the same allowance. Cached answers, Resolution guidance and manual review remain available. Retry later.",
      429,
    );
  return id;
}
export async function finishRecoveryAttempt(
  db: D1Database,
  id: string,
  status: "completed" | "failed",
) {
  await db
    .prepare(
      "UPDATE recovery_attempts SET status=? WHERE id=? AND status='pending'",
    )
    .bind(status, id)
    .run();
}
export async function persistRecoveryProposal(
  db: D1Database,
  workspace: string,
  cacheKey: string,
  proposal: RecoveryProposal,
  now = new Date(),
) {
  const payload = JSON.stringify(proposal);
  if (new TextEncoder().encode(payload).byteLength > 30000)
    throw new HttpError(
      "The evidence proposal exceeds the review limit. No decision changed.",
      503,
    );
  await db.batch([
    db
      .prepare("DELETE FROM recovery_proposals WHERE expires_at<=?")
      .bind(now.toISOString()),
    db
      .prepare(
        "INSERT INTO recovery_proposals(id,workspace,cache_key,payload,expires_at) VALUES(?,?,?,?,?)",
      )
      .bind(proposal.id, workspace, cacheKey, payload, proposal.expires_at),
  ]);
}
