import { runtimeBindings } from "./runtime";
import { HttpError, sameRequestOrigin } from "./http";

export type TeamRole = "operator" | "reviewer" | "admin";
export type Capability = "read" | "operate" | "review" | "admin";
export interface TeamIdentity {
  id: string;
  email: string;
  display_name: string;
  role: TeamRole;
  workspace: string;
  membership_version: number;
}
export interface WorkspaceSession {
  id: string;
  fresh: boolean;
  user?: TeamIdentity;
}
const resolved = new WeakMap<Request, WorkspaceSession>();
export const SESSION_COOKIE = "cargo_team_session";
export const SESSION_SECONDS = 8 * 60 * 60;
const IDLE_MINUTES = 30;
export function teamMode() {
  const mode = process.env.CARGO_AUTH_MODE ?? "demo";
  if (mode !== "demo" && mode !== "team")
    throw new HttpError("Authentication configuration is unavailable.", 503);
  return mode === "team";
}
export function authDatabase() {
  return runtimeBindings().DB;
}
export function demoWorkspace(request: Request): WorkspaceSession {
  const value = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)cargo_workspace=([a-f0-9-]{36})(?:;|$)/)?.[1];
  return { id: value ?? crypto.randomUUID(), fresh: !value };
}
/** Only the capability guard can bind a real team workspace to a request. */
export function requestWorkspace(request: Request): WorkspaceSession {
  if (!teamMode()) return resolved.get(request) ?? demoWorkspace(request);
  const session = resolved.get(request);
  if (!session?.user)
    throw new HttpError("Sign in to access this workspace.", 401);
  return session;
}
/** Error responses must not mint an anonymous workspace in team mode. */
export function errorSession(request: Request): WorkspaceSession {
  return process.env.CARGO_AUTH_MODE && process.env.CARGO_AUTH_MODE !== "demo"
    ? { id: "", fresh: false }
    : demoWorkspace(request);
}
export function tokenFromRequest(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)cargo_team_session=([a-f0-9]{64})(?:;|$)/)?.[1] ?? null
  );
}
export function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function permitted(role: TeamRole, capability: Capability) {
  return (
    capability === "read" ||
    capability === "operate" ||
    role === "admin" ||
    (role === "reviewer" && capability === "review")
  );
}
export function requireAuthOrigin(request: Request) {
  if (
    !sameRequestOrigin(
      request,
      process.env.CARGO_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL,
    ) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError("Cross-origin writes are not allowed.", 403);
  // Team browser writes require explicit origin; JSON/non-browser clients may
  // use the matching public origin too. Cookie possession alone is insufficient.
  if (teamMode() && !request.headers.get("origin"))
    throw new HttpError("A same-origin request is required.", 403);
}
export async function requireCapability(
  request: Request,
  capability: Capability,
  database?: D1Database,
): Promise<WorkspaceSession> {
  if (!teamMode()) {
    const session = resolved.get(request) ?? demoWorkspace(request);
    resolved.set(request, session);
    return session;
  }
  const db = database ?? authDatabase();
  const token = tokenFromRequest(request);
  if (!token) throw new HttpError("Sign in to access this workspace.", 401);
  const now = new Date(),
    hash = await digest(token);
  const user = await db
    .prepare(
      `SELECT u.id,u.email,u.display_name,m.role,m.workspace,m.version AS membership_version
    FROM team_sessions s JOIN team_users u ON u.id=s.user_id
    JOIN team_memberships m ON m.user_id=s.user_id AND m.workspace=s.workspace
    WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen_at>? AND m.active=1`,
    )
    .bind(
      hash,
      now.toISOString(),
      new Date(now.getTime() - IDLE_MINUTES * 60000).toISOString(),
    )
    .first<TeamIdentity>();
  if (!user)
    throw new HttpError(
      "Session expired or access was revoked. Sign in again.",
      401,
    );
  if (!permitted(user.role, capability))
    throw new HttpError("Your team role does not permit this action.", 403);
  await db
    .prepare("UPDATE team_sessions SET last_seen_at=? WHERE token_hash=?")
    .bind(now.toISOString(), hash)
    .run();
  const session = { id: user.workspace, fresh: false, user };
  resolved.set(request, session);
  return session;
}
export function authenticatedActor(
  request: Request,
  fallback = "Workspace user",
) {
  if (!teamMode()) return fallback;
  const user = requestWorkspace(request).user!;
  return `${user.display_name.slice(0, 32)} [${user.id}]`;
}
/** Avoid raw provider, SQL, request, document or email data in diagnostic logs. */
export function securityDiagnostic(code: string) {
  console.error(
    "CargoGuard operation failed",
    code.replace(/[^A-Z0-9_]/g, "").slice(0, 64),
  );
}
