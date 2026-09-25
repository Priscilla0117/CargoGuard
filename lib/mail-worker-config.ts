/** Explicit opt-in; anonymous browser workspaces never grant unattended access. */
export function mailWorkerEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.CARGO_AUTH_MODE === "team" && env.CARGO_MAIL_WORKER_ENABLED === "true"
  );
}

export async function mailWorkerStatus(db: D1Database) {
  const enabled = mailWorkerEnabled();
  const row = enabled
    ? await db
        .prepare(
          "SELECT heartbeat_at,state FROM mail_worker_state WHERE singleton=1",
        )
        .first<{ heartbeat_at: string; state: string }>()
    : null;
  return {
    enabled,
    running:
      !!row &&
      row.state === "running" &&
      Date.now() - Date.parse(row.heartbeat_at) < 90000,
    last_heartbeat_at: row?.heartbeat_at ?? null,
    state: row?.state ?? "not_started",
  };
}
