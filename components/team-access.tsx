"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { TeamIdentity, TeamRole } from "@/lib/auth";
import "@/app/team-access.css";

interface AuthStatus {
  mode: "demo" | "team";
  user: TeamIdentity | null;
  setup_available?: boolean;
}
interface Member {
  id: string;
  email: string;
  display_name: string;
  role: TeamRole;
  active: number;
  version: number;
}
interface TeamEvent {
  id: string;
  actor_id: string;
  action: string;
  target_id: string;
  detail: string;
  created_at: string;
}
const AccessContext = createContext<AuthStatus | null>(null);
export const useTeamAccess = () => useContext(AccessContext);
async function api<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal,
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "Request failed. Try again.");
  return result;
}
export function TeamAccess({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [setup, setSetup] = useState(false),
    [panel, setPanel] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const lastRefresh = useRef(0);
  const authRequest = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const refresh = useCallback((force = false): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    // Navigation and the focus/visibility pair can arrive together. Reuse one
    // check, but always replace a pre-login check after an identity mutation.
    if (!force && authRequest.current) return authRequest.current.promise;
    if (!force && Date.now() - lastRefresh.current < 2000)
      return Promise.resolve();
    authRequest.current?.controller.abort();
    const controller = new AbortController();
    const request = ++generation.current;
    lastRefresh.current = Date.now();
    const promise = api<AuthStatus>(
      "/api/auth",
      undefined,
      AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
    )
      .then((data) => {
        if (mounted.current && request === generation.current) {
          setStatus(data);
          setError("");
          if (!data.user) setPanel(false);
        }
      })
      .catch((failure: unknown) => {
        if (
          mounted.current &&
          request === generation.current &&
          !controller.signal.aborted
        ) {
          // An outage is not proof of logout. Keep the last confirmed identity
          // until a successful auth response reports an expired/revoked session.
          setError(
            failure instanceof Error
              ? failure.message
              : "Workspace access could not be refreshed. Try again.",
          );
        }
      })
      .finally(() => {
        if (request === generation.current) authRequest.current = null;
      });
    authRequest.current = { controller, promise };
    return promise;
  }, []);
  const cancelAuthRefresh = useCallback(() => {
    generation.current++;
    authRequest.current?.controller.abort();
    authRequest.current = null;
    lastRefresh.current = 0;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelAuthRefresh();
    };
  }, [cancelAuthRefresh]);
  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname, refresh]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      await api("/api/auth", {
        action: setup ? "bootstrap" : "login",
        email: data.get("email"),
        password: data.get("password"),
        ...(setup
          ? {
              display_name: data.get("display_name"),
              secret: data.get("secret"),
            }
          : {}),
      });
      form.reset();
      setSetup(false);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/api/auth", { action: "logout" });
      setPanel(false);
      await refresh(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!status)
    return (
      <main className="team-access-card" id="main-content" tabIndex={-1}>
        <h1>CargoGuard workspace</h1>
        <p>{error || "Checking workspace access…"}</p>
        {error && (
          <button
            type="button"
            onClick={() => {
              setError("");
              void refresh(true);
            }}
          >
            Retry connection
          </button>
        )}
      </main>
    );
  if (status.mode === "team" && !status.user)
    return (
      <main className="team-access-card" id="main-content" tabIndex={-1}>
        <p className="team-eyebrow">Shared team workspace</p>
        <h1>
          {setup ? "Create the first administrator" : "Sign in to CargoGuard"}
        </h1>
        <p>
          Team access is verified by the server. Your role controls review,
          approval and administration.
        </p>
        <form onSubmit={signIn}>
          {setup && (
            <label>
              Your name
              <input
                name="display_name"
                required
                minLength={2}
                maxLength={48}
                autoComplete="name"
              />
            </label>
          )}
          <label>
            Work email
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={setup ? 15 : 1}
              maxLength={128}
              autoComplete={setup ? "new-password" : "current-password"}
            />
          </label>
          {setup && (
            <>
              <label>
                Setup credential
                <input
                  name="secret"
                  type="password"
                  required
                  maxLength={512}
                  autoComplete="off"
                />
              </label>
              <p className="team-help">
                Obtain the one-time setup credential from your system
                administrator. It is never included in the app.
              </p>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} type="submit">
            {busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}
          </button>
        </form>
        {status.setup_available && (
          <button
            type="button"
            className="team-link"
            disabled={busy}
            onClick={() => {
              setSetup(!setup);
              setError("");
            }}
          >
            {setup ? "Back to sign in" : "First-time team setup"}
          </button>
        )}
      </main>
    );
  return (
    <AccessContext.Provider
      key={
        status.user ? `${status.user.workspace}:${status.user.id}` : status.mode
      }
      value={status}
    >
      <div className="team-access-banner">
        {status.mode === "demo" ? (
          <span>
            <strong>Isolated synthetic demo.</strong> Names are self-reported;
            no employee login is configured.
          </span>
        ) : (
          <>
            <span>
              <strong>{status.user!.display_name}</strong> · {status.user!.role}{" "}
              · shared team workspace
            </span>
            <div>
              <button type="button" onClick={() => setPanel(!panel)}>
                {panel ? "Close team access" : "Team access"}
              </button>
              <button disabled={busy} type="button" onClick={logout}>
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="team-access-error" role="alert">
          {error}
        </p>
      )}
      {panel && status.user && (
        <TeamPanel
          user={status.user}
          onSignedOut={async () => {
            setPanel(false);
            await refresh(true);
          }}
        />
      )}
      {children}
    </AccessContext.Provider>
  );
}
function TeamPanel({
  user,
  onSignedOut,
}: {
  user: TeamIdentity;
  onSignedOut: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<TeamEvent[]>([]),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ members: Member[]; audit: TeamEvent[] }>("/api/team")
      .then((data) => {
        if (active) {
          setMembers(data.members);
          setEvents(data.audit);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      await api("/api/auth", {
        action: "change_password",
        current_password: data.get("current_password"),
        password: data.get("password"),
      });
      form.reset();
      await onSignedOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Password change failed.");
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNote("");
    setBusy(true);
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      const result = await api<{ members: Member[]; audit: TeamEvent[] }>(
        "/api/team",
        {
          action: "create",
          email: data.get("email"),
          display_name: data.get("display_name"),
          password: data.get("password"),
          role: data.get("role"),
        },
      );
      setMembers(result.members);
      setEvents(result.audit);
      form.reset();
      setNote(
        "Member created. Give the initial password through your approved secure channel; they can change it after sign-in.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Member creation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function update(event: FormEvent<HTMLFormElement>, member: Member) {
    event.preventDefault();
    setError("");
    setNote("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await api<{ members: Member[]; audit: TeamEvent[] }>(
        "/api/team",
        {
          action: "update",
          id: member.id,
          version: member.version,
          role: data.get("role"),
          active: data.get("active") === "on",
        },
      );
      setMembers(result.members);
      setEvents(result.audit);
      setNote("Access updated and that member’s existing sessions revoked.");
      if (member.id === user.id) await onSignedOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Access change failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="team-access-panel" aria-label="Team access management">
      <h2>Team access</h2>
      <p>
        Operators process and organize work. Reviewers also confirm evidence and
        complete checks. Administrators additionally manage members and reusable
        policy.
      </p>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      <details>
        <summary>Change your password</summary>
        <form onSubmit={changePassword}>
          <label>
            Current password
            <input
              name="current_password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              required
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <p className="team-help">
            15–128 characters. Changing it signs you out on all devices.
          </p>
          <button disabled={busy}>Change password and sign out</button>
        </form>
      </details>
      <h3>Workspace members</h3>
      {members.map((member) => (
        <div className="team-member" key={`${member.id}-${member.version}`}>
          <strong>{member.display_name}</strong>
          <span>
            {member.role}
            {!member.active ? " · disabled" : ""}
          </span>
          {user.role === "admin" && (
            <form onSubmit={(event) => update(event, member)}>
              <label>
                Role for {member.display_name}
                <select name="role" defaultValue={member.role}>
                  <option value="operator">Operator</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              <label className="team-inline">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={!!member.active}
                />{" "}
                Active
              </label>
              <button disabled={busy}>Save access</button>
            </form>
          )}
        </div>
      ))}
      {user.role === "admin" && (
        <>
          <details>
            <summary>Add a team member</summary>
            <form onSubmit={create}>
              <label>
                Name
                <input
                  name="display_name"
                  required
                  minLength={2}
                  maxLength={48}
                />
              </label>
              <label>
                Work email
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="off"
                />
              </label>
              <label>
                Initial password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={15}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Role
                <select name="role" defaultValue="operator">
                  <option value="operator">Operator</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="admin">Administrator</option>
                </select>
              </label>
              <button disabled={busy}>Create member</button>
            </form>
          </details>
          <details>
            <summary>Security audit — latest 100 events</summary>
            <ol className="team-audit">
              {events.map((event) => (
                <li key={event.id}>
                  <strong>{event.action.replaceAll("_", " ")}</strong> ·{" "}
                  {new Date(event.created_at).toLocaleString()}
                  <small>
                    Actor{" "}
                    {members.find((member) => member.id === event.actor_id)
                      ?.display_name ?? event.actor_id}{" "}
                    · {event.detail}
                  </small>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
