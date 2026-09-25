"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { requestJson } from "@/lib/client-api";

interface Settings {
  auto_sync: boolean;
  interval_minutes: number;
  days: number;
  max_per_sync: number;
  gmail_query: string;
  mailbox: string;
}
interface Status {
  configured: boolean;
  missing?: string[];
  google_available?: boolean;
  imap_available?: boolean;
  custom_server?: boolean;
  send_enabled?: boolean;
  presets?: { id: string; label: string; help: string }[];
  connected: boolean;
  provider?: "gmail" | "imap" | null;
  account?: string | null;
  settings?: Settings;
  last_sync_at?: string | null;
  last_sync_note?: string | null;
  last_success_at?: string | null;
  last_sync_error?: string | null;
  worker?: { enabled: boolean; running: boolean; state: string };
  imported?: number;
}

export function MailDesk() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [preset, setPreset] = useState("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);

  const load = useCallback(async () => {
    try {
      const value = await requestJson<Status>("/api/mail", {
        cache: "no-store",
      });
      setStatus(value);
      setSettings(value.settings ?? null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function post(body: unknown, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await requestJson<Status & { authorize_url?: string }>(
        "/api/mail",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }
  async function google() {
    const value = await post({ action: "connect_google" }, "google");
    if (value?.authorize_url) window.location.assign(value.authorize_url);
  }
  async function imap(event: FormEvent) {
    event.preventDefault();
    const value = await post(
      {
        action: "connect_imap",
        login: { preset, email: email.trim(), password },
      },
      "imap",
    );
    if (value) {
      setPassword("");
      setStatus(value);
      setSettings(value.settings ?? null);
      setNotice(
        `Connected to ${value.account}. New email will be imported automatically.`,
      );
    }
  }
  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect this mailbox? Emails already imported stay in CargoGuard.",
      )
    )
      return;
    const value = await post({ action: "disconnect" }, "disconnect");
    if (value) {
      setStatus(value);
      setNotice("Mailbox disconnected. The saved login was deleted.");
    }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const value = await post({ action: "settings", settings }, "settings");
    if (value) {
      setStatus(value);
      setNotice("Settings saved.");
    }
  }
  async function sync() {
    setBusy("sync");
    setError("");
    try {
      const value = await requestJson<{ imported: string[]; note: string }>(
        "/api/mail/sync",
        { method: "POST" },
      );
      setNotice(value.note || "Checked.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const presetInfo = status?.presets?.find((item) => item.id === preset);

  return (
    <main id="main-content" tabIndex={-1} className="cg-page">
      <div className="cg-page-head">
        <div>
          <h1>Email accounts</h1>
          <p>
            Connect your mailbox once. New emails then arrive in the Inbox by
            themselves.
          </p>
        </div>
      </div>
      {error && (
        <div className="cg-notice error" role="alert">
          <TriangleAlert size={20} />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="cg-notice success" role="status">
          <CheckCircle2 size={20} />
          <p>{notice}</p>
        </div>
      )}
      {!status ? (
        <div className="cg-empty">
          <Loader2 size={28} className="cg-spin" />
          <h3>Loading…</h3>
        </div>
      ) : !status.configured ? (
        <section className="cg-card cg-card-pad">
          <h2>Email connection is not set up on this server</h2>
          <p className="cg-muted">
            An administrator must add a secret key that protects saved mailbox
            logins. Add this setting to the server environment and restart:
          </p>
          <ul>
            {status.missing?.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
          <p className="cg-small cg-muted">
            Until then you can still{" "}
            <Link className="cg-link" href="/">
              import saved .eml emails
            </Link>{" "}
            in the Inbox.
          </p>
        </section>
      ) : status.connected ? (
        <div className="cg-panel">
          <section className="cg-card cg-card-pad">
            <h2>
              <CheckCircle2 size={20} color="var(--cg-green)" /> Connected
            </h2>
            <dl className="cg-kv">
              <dt>Account</dt>
              <dd>{status.account}</dd>
              <dt>Method</dt>
              <dd>
                {status.provider === "gmail"
                  ? "Google sign-in (Gmail)"
                  : "Email and app password"}
              </dd>
              <dt>Last successful check</dt>
              <dd>
                {status.last_success_at
                  ? new Date(status.last_success_at).toLocaleString()
                  : "No successful check recorded yet"}
              </dd>
              <dt>Latest attempt</dt>
              <dd>
                {status.last_sync_at
                  ? new Date(status.last_sync_at).toLocaleString()
                  : "Not yet"}
                {status.last_sync_note ? ` — ${status.last_sync_note}` : ""}
              </dd>
              {status.last_sync_error && (
                <>
                  <dt>Needs attention</dt>
                  <dd role="alert">{status.last_sync_error}</dd>
                </>
              )}
              <dt>Automatic import</dt>
              <dd>
                {!status.settings?.auto_sync
                  ? "Automatic import is off for this mailbox. You can still check manually."
                  : status.worker?.enabled
                    ? status.worker.running
                      ? "Background service is running. It checks email even when your browser is closed."
                      : "Background service is not ready. Check manually now and ask an administrator to check the service."
                    : "Checks while the Inbox is open. An administrator can enable background import for team accounts."}
              </dd>
              <dt>Imported so far</dt>
              <dd>{status.imported ?? 0} emails</dd>
              <dt>Replies</dt>
              <dd>
                {status.send_enabled
                  ? "You can save replies as drafts or send them (always after you confirm)."
                  : "Replies are saved as drafts in your mailbox. Sending is turned off on this server."}
              </dd>
            </dl>
            <div className="cg-page-actions" style={{ marginTop: 16 }}>
              <button
                className="cg-btn primary"
                disabled={!!busy}
                onClick={() => void sync()}
              >
                {busy === "sync" ? (
                  <Loader2 size={18} className="cg-spin" />
                ) : (
                  <RefreshCw size={18} />
                )}
                Check for new email now
              </button>
              <Link className="cg-btn" href="/">
                Go to Inbox
              </Link>
              <button
                className="cg-btn danger"
                disabled={!!busy}
                onClick={() => void disconnect()}
              >
                <LogOut size={18} /> Disconnect
              </button>
            </div>
          </section>
          {settings && (
            <form className="cg-card cg-card-pad" onSubmit={saveSettings}>
              <h2>Automatic import</h2>
              <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
                <label className="cg-check">
                  <input
                    type="checkbox"
                    checked={settings.auto_sync}
                    onChange={(e) =>
                      setSettings({ ...settings, auto_sync: e.target.checked })
                    }
                  />
                  {status.worker?.enabled
                    ? "Check for new email automatically, including when my browser is closed"
                    : "Check for new email automatically while the Inbox is open"}
                </label>
                <div className="cg-grid-2">
                  <label className="cg-field">
                    Check every (minutes)
                    <input
                      type="number"
                      min={2}
                      max={120}
                      value={settings.interval_minutes}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          interval_minutes: Number(e.target.value) || 5,
                        })
                      }
                    />
                  </label>
                  <label className="cg-field">
                    Import emails from the last (days)
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={settings.days}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          days: Number(e.target.value) || 7,
                        })
                      }
                    />
                  </label>
                  <label className="cg-field">
                    Most emails per check
                    <input
                      type="number"
                      min={1}
                      max={25}
                      value={settings.max_per_sync}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          max_per_sync: Number(e.target.value) || 10,
                        })
                      }
                    />
                  </label>
                  {status.provider === "gmail" ? (
                    <label className="cg-field">
                      Gmail search words
                      <input
                        value={settings.gmail_query}
                        maxLength={300}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            gmail_query: e.target.value,
                          })
                        }
                      />
                      <small>
                        For example: has:attachment or label:shipping
                      </small>
                    </label>
                  ) : (
                    <label className="cg-field">
                      Folder
                      <input
                        value={settings.mailbox}
                        maxLength={120}
                        onChange={(e) =>
                          setSettings({ ...settings, mailbox: e.target.value })
                        }
                      />
                      <small>Usually INBOX</small>
                    </label>
                  )}
                </div>
                <div>
                  <button className="cg-btn primary" disabled={!!busy}>
                    {busy === "settings" && (
                      <Loader2 size={18} className="cg-spin" />
                    )}
                    Save settings
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="cg-connect-grid">
          <section className="cg-card cg-card-pad">
            <h2>
              <ShieldCheck size={20} /> Sign in with Google
            </h2>
            <p className="cg-muted">
              Recommended for Gmail and Google Workspace. You sign in on
              Google&apos;s own page; CargoGuard never sees your password.
            </p>
            <button
              className="cg-btn primary large"
              disabled={!status.google_available || !!busy}
              onClick={() => void google()}
            >
              {busy === "google" ? (
                <Loader2 size={20} className="cg-spin" />
              ) : (
                <Mail size={20} />
              )}
              Sign in with Google
            </button>
            {!status.google_available && (
              <p className="cg-small cg-muted" style={{ marginTop: 12 }}>
                Not set up yet — your IT administrator can switch it on. Until
                then, use the email & app password option.
              </p>
            )}
          </section>
          <form className="cg-card cg-card-pad" onSubmit={imap}>
            <h2>
              <KeyRound size={20} /> Sign in with email & app password
            </h2>
            {!status.imap_available ? (
              <p className="cg-muted">
                This option is turned off on this server.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <label className="cg-field">
                  Email provider
                  <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value)}
                  >
                    {status.presets?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                    {status.custom_server && (
                      <option value="custom">Company mail server</option>
                    )}
                  </select>
                </label>
                <label className="cg-field">
                  Email address
                  <input
                    type="email"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                  />
                </label>
                <label className="cg-field">
                  App password
                  <input
                    type="password"
                    required
                    minLength={4}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="16 letters from your Google account"
                  />
                  <small>
                    Not your normal password. {presetInfo?.help ?? ""}
                  </small>
                </label>
                {preset === "gmail" && (
                  <details className="cg-details" style={{ marginTop: 0 }}>
                    <summary>How do I get a Gmail app password?</summary>
                    <div>
                      <ol className="cg-steps">
                        <li>Open myaccount.google.com and choose Security.</li>
                        <li>Turn on 2-Step Verification (if it is off).</li>
                        <li>
                          Search for “App passwords”, create one named
                          CargoGuard.
                        </li>
                        <li>
                          Copy the 16 letters here. You can delete it at any
                          time.
                        </li>
                      </ol>
                    </div>
                  </details>
                )}
                <div>
                  <button className="cg-btn primary large" disabled={!!busy}>
                    {busy === "imap" ? (
                      <Loader2 size={20} className="cg-spin" />
                    ) : (
                      <KeyRound size={20} />
                    )}
                    Connect mailbox
                  </button>
                </div>
                <p className="cg-small cg-muted" style={{ margin: 0 }}>
                  The app password is encrypted before it is saved and is used
                  only to read new email and save your replies.
                </p>
              </div>
            )}
          </form>
          <section className="cg-card cg-card-pad">
            <h2>
              <Mail size={20} /> Other ways
            </h2>
            <ul
              style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 10 }}
            >
              <li>
                Save an email as <strong>.eml</strong> (Gmail: ⋮ → Download
                message) and drop it in{" "}
                <Link className="cg-link" href="/">
                  Inbox → Import email
                </Link>
                . Several at once is fine.
              </li>
              <li>
                Company Microsoft 365:{" "}
                <Link className="cg-link" href="/outlook">
                  Outlook connection
                </Link>{" "}
                (needs administrator setup).
              </li>
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
