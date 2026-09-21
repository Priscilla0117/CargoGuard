import { HttpError } from "./http";
import { RECOVERY_LIMITS, type RecoveryProposal } from "./recovery-schema";

export async function recoveryBudget(
  db: D1Database,
  workspace: string,
  now = new Date(),
) {
  const day = now.toISOString().slice(0, 10);
  const row = await db
    .prepare(
      `SELECT
    COUNT(*) AS lifetime_calls,
    COALESCE(SUM(reserved_tokens),0) AS lifetime_tokens,
    COALESCE(SUM(CASE WHEN quota_day=? THEN 1 ELSE 0 END),0) AS daily_calls,
    COALESCE(SUM(CASE WHEN quota_day=? THEN reserved_tokens ELSE 0 END),0) AS daily_tokens,
    COALESCE(SUM(CASE WHEN quota_day=? AND workspace=? THEN 1 ELSE 0 END),0) AS workspace_calls,
    COALESCE(SUM(CASE WHEN status='pending' AND lease_until>? THEN 1 ELSE 0 END),0) AS active_calls,
    COALESCE(SUM(CASE WHEN status='pending' AND lease_until>? AND workspace=? THEN 1 ELSE 0 END),0) AS workspace_active
    FROM recovery_attempts`,
    )
    .bind(
      day,
      day,
      day,
      workspace,
      now.toISOString(),
      now.toISOString(),
      workspace,
    )
    .first<Record<string, number>>();
  if (!row)
    throw new HttpError(
      "AI budget is temporarily unavailable. No request was sent.",
      503,
    );
  return {
    workspaceRemaining: Math.max(
      0,
      RECOVERY_LIMITS.workspaceDailyCalls - Number(row.workspace_calls),
    ),
    dailyRemaining: Math.max(
      0,
      RECOVERY_LIMITS.globalDailyCalls - Number(row.daily_calls),
    ),
    lifetimeRemaining: Math.max(
      0,
      RECOVERY_LIMITS.globalLifetimeCalls - Number(row.lifetime_calls),
    ),
    dailyTokensRemaining: Math.max(
      0,
      RECOVERY_LIMITS.globalDailyReservedTokens - Number(row.daily_tokens),
    ),
    lifetimeTokensRemaining: Math.max(
      0,
      RECOVERY_LIMITS.globalLifetimeReservedTokens -
        Number(row.lifetime_tokens),
    ),
    busy:
      Number(row.active_calls) >= RECOVERY_LIMITS.concurrentCalls ||
      Number(row.workspace_active) > 0,
    resetsAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString(),
  };
}
export function recoveryBudgetReason(
  budget: Awaited<ReturnType<typeof recoveryBudget>>,
  tokens: number,
) {
  if (!budget.lifetimeRemaining || budget.lifetimeTokensRemaining < tokens)
    return "The demo's lifetime AI budget is exhausted. It does not reset automatically; the owner must review the allowance.";
  if (!budget.workspaceRemaining)
    return `This workspace's daily AI request limit is reached. Daily limits reset at ${budget.resetsAt}.`;
  if (!budget.dailyRemaining || budget.dailyTokensRemaining < tokens)
    return `The shared daily AI budget cannot fit this request. Daily limits reset at ${budget.resetsAt}.`;
  if (budget.busy)
    return "An AI request is already running in this workspace or both shared slots are occupied. Wait for it to finish before trying again.";
  return "The shared AI budget changed while reserving this request. Try again later.";
}

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
    AND COALESCE((SELECT SUM(reserved_tokens) FROM recovery_attempts),0)+?<=?
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
      reservedTokens,
      RECOVERY_LIMITS.globalLifetimeReservedTokens,
      now.toISOString(),
      RECOVERY_LIMITS.concurrentCalls,
      workspace,
      now.toISOString(),
    )
    .run();
  if (result.meta.changes !== 1) {
    const budget = await recoveryBudget(db, workspace, now);
    throw new HttpError(
      `${recoveryBudgetReason(budget, reservedTokens)} Chat and document recovery share this budget. Cached answers, Resolution guidance and manual review remain available.`,
      429,
    );
  }
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
