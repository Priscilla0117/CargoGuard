import { z } from "zod";
import {
  authDatabase,
  digest,
  randomToken,
  SESSION_SECONDS,
  type TeamIdentity,
  type TeamRole,
} from "./auth";
import { constantEqual, hashPassword, verifyPassword } from "./auth-password";
import { HttpError } from "./http";

export const memberFields = {
  email: z.string().trim().toLowerCase().email().max(254),
  display_name: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .refine((s) => !/[\x00-\x1f\x7f]/.test(s)),
  password: z.string().min(15).max(128),
};
export const roles = z.enum(["operator", "reviewer", "admin"]);
export type NewMember = z.infer<ReturnType<typeof newMemberSchema>>;
export const newMemberSchema = () =>
  z.object({ ...memberFields, role: roles }).strict();
const nowString = () => new Date().toISOString();
function event(
  db: D1Database,
  workspace: string,
  actor: string,
  action: string,
  target: string,
  detail: string,
  conditional = false,
) {
  return db
    .prepare(
      `INSERT INTO team_events(id,workspace,actor_id,action,target_id,detail,created_at) SELECT ?,?,?,?,?,?,? ${conditional ? "WHERE changes()=1" : ""}`,
    )
    .bind(
      crypto.randomUUID(),
      workspace,
      actor,
      action,
      target,
      detail,
      nowString(),
    );
}
/** Database-backed reservations also limit concurrent requests and restarts. */
export async function reserveLoginAttempt(
  identity: string,
  db = authDatabase(),
) {
  const window = Math.floor(Date.now() / 900000);
  const account = `account:${await digest(identity.trim().toLowerCase())}`;
  const results = await db.batch([
    db.prepare("DELETE FROM team_login_limits WHERE window<?").bind(window - 1),
    ...[
      ["global", 60],
      [account, 6],
    ].map(([key, limit]) =>
      db
        .prepare(
          `INSERT INTO team_login_limits(key,window,attempts) VALUES(?,?,1)
      ON CONFLICT(key) DO UPDATE SET window=excluded.window,attempts=CASE WHEN team_login_limits.window<>excluded.window THEN 1 ELSE team_login_limits.attempts+1 END
      WHERE team_login_limits.window<>excluded.window OR team_login_limits.attempts<?`,
        )
        .bind(key, window, limit),
    ),
  ]);
  if (results.slice(1).some((r) => r.meta.changes !== 1))
    throw new HttpError(
      "Too many sign-in attempts. Try again in 15 minutes.",
      429,
    );
}
export async function bootstrapTeam(
  input: {
    email: string;
    display_name: string;
    password: string;
    secret: string;
  },
  db = authDatabase(),
) {
  await reserveLoginAttempt("bootstrap", db);
  const secret = process.env.CARGO_BOOTSTRAP_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    !constantEqual(await digest(input.secret), await digest(secret))
  )
    throw new HttpError(
      "Team setup is unavailable or the setup credential is invalid.",
      403,
    );
  const userId = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    created = nowString(),
    passwordHash = await hashPassword(input.password);
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO team_installation(singleton,workspace,bootstrap_user,created_at) VALUES(1,?,?,?) ON CONFLICT(singleton) DO NOTHING",
      )
      .bind(workspace, userId, created),
    db
      .prepare(
        "INSERT INTO team_users(id,email,display_name,password_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM team_installation WHERE bootstrap_user=?)",
      )
      .bind(
        userId,
        input.email,
        input.display_name,
        passwordHash,
        created,
        userId,
      ),
    db
      .prepare(
        "INSERT INTO team_memberships(workspace,user_id,role,active,version) SELECT ?,?,'admin',1,1 WHERE EXISTS(SELECT 1 FROM team_installation WHERE bootstrap_user=?)",
      )
      .bind(workspace, userId, userId),
    event(
      db,
      workspace,
      userId,
      "TEAM_BOOTSTRAPPED",
      userId,
      "First administrator created",
      true,
    ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError("Team setup has already been completed. Sign in.", 409);
  return { userId, workspace };
}
export async function loginTeam(
  email: string,
  password: string,
  db = authDatabase(),
) {
  await reserveLoginAttempt(email, db);
  const user = await db
    .prepare(
      `SELECT u.id,u.password_hash,m.workspace FROM team_users u JOIN team_memberships m ON m.user_id=u.id
    WHERE u.email=? AND m.active=1 LIMIT 1`,
    )
    .bind(email)
    .first<{ id: string; password_hash: string; workspace: string }>();
  const valid = await verifyPassword(password, user?.password_hash ?? null);
  if (!valid || !user)
    throw new HttpError(
      "Email or password is incorrect, or access is unavailable.",
      401,
    );
  const token = randomToken(),
    created = nowString(),
    expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const result = await db.batch([
    db
      .prepare(
        "DELETE FROM team_sessions WHERE expires_at<=? OR last_seen_at<=?",
      )
      .bind(created, new Date(Date.now() - 30 * 60000).toISOString()),
    db
      .prepare(
        `INSERT INTO team_sessions(token_hash,user_id,workspace,created_at,expires_at,last_seen_at) SELECT ?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM team_memberships WHERE workspace=? AND user_id=? AND active=1)
      AND EXISTS(SELECT 1 FROM team_users WHERE id=? AND password_hash=?)`,
      )
      .bind(
        await digest(token),
        user.id,
        user.workspace,
        created,
        expires,
        created,
        user.workspace,
        user.id,
        user.id,
        user.password_hash,
      ),
    event(
      db,
      user.workspace,
      user.id,
      "SIGNED_IN",
      user.id,
      "Opaque session created",
      true,
    ),
  ]);
  if (result[1].meta.changes !== 1)
    throw new HttpError(
      "Email or password is incorrect, or access is unavailable.",
      401,
    );
  return { token, expires };
}
export async function logoutTeam(token: string | null, db = authDatabase()) {
  if (!token) return;
  const hash = await digest(token);
  const session = await db
    .prepare("SELECT user_id,workspace FROM team_sessions WHERE token_hash=?")
    .bind(hash)
    .first<{ user_id: string; workspace: string }>();
  if (!session) return;
  await db.batch([
    db.prepare("DELETE FROM team_sessions WHERE token_hash=?").bind(hash),
    event(
      db,
      session.workspace,
      session.user_id,
      "SIGNED_OUT",
      session.user_id,
      "Session revoked",
      true,
    ),
  ]);
}
export async function changePassword(
  user: TeamIdentity,
  current: string,
  next: string,
  db = authDatabase(),
) {
  await reserveLoginAttempt(`password:${user.id}`, db);
  const row = await db
    .prepare("SELECT password_hash FROM team_users WHERE id=?")
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash)))
    throw new HttpError("Current password is incorrect.", 403);
  const result = await db.batch([
    db
      .prepare(
        "UPDATE team_users SET password_hash=? WHERE id=? AND password_hash=?",
      )
      .bind(await hashPassword(next), user.id, row.password_hash),
    event(
      db,
      user.workspace,
      user.id,
      "PASSWORD_CHANGED",
      user.id,
      "All sessions revoked",
      true,
    ),
    db
      .prepare("DELETE FROM team_sessions WHERE user_id=? AND changes()=1")
      .bind(user.id),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError("Account changed. Sign in again before retrying.", 409);
}
export async function listTeam(workspace: string, db = authDatabase()) {
  return (
    await db
      .prepare(
        `SELECT u.id,u.email,u.display_name,m.role,m.active,m.version FROM team_users u JOIN team_memberships m ON m.user_id=u.id
    WHERE m.workspace=? ORDER BY u.display_name,u.id`,
      )
      .bind(workspace)
      .all()
  ).results;
}
export async function teamHistory(workspace: string, db = authDatabase()) {
  return (
    await db
      .prepare(
        "SELECT id,actor_id,action,target_id,detail,created_at FROM team_events WHERE workspace=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(workspace)
      .all()
  ).results;
}
export async function createMember(
  actor: TeamIdentity,
  input: NewMember,
  db = authDatabase(),
) {
  const id = crypto.randomUUID(),
    hash = await hashPassword(input.password),
    created = nowString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO team_users(id,email,display_name,password_hash,created_at) SELECT ?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM team_memberships WHERE user_id=? AND workspace=? AND role='admin' AND active=1)
      ON CONFLICT(email) DO NOTHING`,
      )
      .bind(
        id,
        input.email,
        input.display_name,
        hash,
        created,
        actor.id,
        actor.workspace,
      ),
    db
      .prepare(
        "INSERT INTO team_memberships(workspace,user_id,role,active,version) SELECT ?,?,?,1,1 WHERE EXISTS(SELECT 1 FROM team_users WHERE id=?)",
      )
      .bind(actor.workspace, id, input.role, id),
    event(
      db,
      actor.workspace,
      actor.id,
      "MEMBER_CREATED",
      id,
      JSON.stringify({ role: input.role }),
      true,
    ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      "Member could not be created. Check the account details and your access.",
      409,
    );
  return id;
}
export async function updateMember(
  actor: TeamIdentity,
  input: { id: string; version: number; role: TeamRole; active: boolean },
  db = authDatabase(),
) {
  const result = await db.batch([
    db
      .prepare(
        `UPDATE team_memberships SET role=?,active=?,version=version+1 WHERE workspace=? AND user_id=? AND version=?
      AND EXISTS(SELECT 1 FROM team_memberships a WHERE a.workspace=? AND a.user_id=? AND a.active=1 AND a.role='admin')
      AND (role<>'admin' OR active=0 OR (?='admin' AND ?=1) OR EXISTS(SELECT 1 FROM team_memberships b WHERE b.workspace=? AND b.user_id<>? AND b.active=1 AND b.role='admin'))`,
      )
      .bind(
        input.role,
        input.active ? 1 : 0,
        actor.workspace,
        input.id,
        input.version,
        actor.workspace,
        actor.id,
        input.role,
        input.active ? 1 : 0,
        actor.workspace,
        input.id,
      ),
    event(
      db,
      actor.workspace,
      actor.id,
      "MEMBER_ACCESS_CHANGED",
      input.id,
      JSON.stringify({ role: input.role, active: input.active }),
      true,
    ),
    db
      .prepare(
        "DELETE FROM team_sessions WHERE changes()=1 AND workspace=? AND user_id=? AND EXISTS(SELECT 1 FROM team_memberships WHERE workspace=? AND user_id=? AND version=?)",
      )
      .bind(
        actor.workspace,
        input.id,
        actor.workspace,
        input.id,
        input.version + 1,
      ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      "Member changed, access was revoked, or this would remove the last active administrator. Reload the team.",
      409,
    );
}
