import { HttpError } from "./http";
import { mailWorkerEnabled } from "./mail-worker-config";
import type { MailProvider } from "./mail-connector";
import type { WorkspaceSession, TeamIdentity } from "./auth";

/** Internal worker authority. Never accepted from an HTTP header or request body. */
export interface MailboxAuthority {
  workspace: string;
  userId: string;
  account: string;
  provider: MailProvider;
  connectionVersion: number;
  membershipVersion: number;
  lease?: string;
}

export async function requireMailboxIntake(
  db: D1Database,
  authority: MailboxAuthority,
): Promise<{
  session: WorkspaceSession;
  actor: string;
}> {
  if (!mailWorkerEnabled())
    throw new HttpError("Background email import is disabled.", 403);
  const user = await db
    .prepare(
      `SELECT u.id,u.email,u.display_name,m.role,m.workspace,m.version AS membership_version
     FROM team_users u JOIN team_memberships m ON m.user_id=u.id
     JOIN mail_connections c ON c.user_id=u.id AND c.workspace=m.workspace
     WHERE m.workspace=? AND m.user_id=? AND m.active=1 AND m.version=?
       AND c.account=? AND c.provider=? AND c.version=?
       AND json_valid(c.settings) AND json_extract(c.settings,'$.auto_sync')=1
       AND (? IS NULL OR (c.sync_lease=? AND c.sync_lease_until>?))`,
    )
    .bind(
      authority.workspace,
      authority.userId,
      authority.membershipVersion,
      authority.account,
      authority.provider,
      authority.connectionVersion,
      authority.lease ?? null,
      authority.lease ?? null,
      new Date().toISOString(),
    )
    .first<TeamIdentity>();
  if (!user)
    throw new HttpError(
      "Background import stopped: mailbox or team access changed.",
      403,
    );
  return {
    session: { id: user.workspace, fresh: false, user },
    actor: `Email import for ${user.display_name.slice(0, 24)} [${user.id}]`,
  };
}
