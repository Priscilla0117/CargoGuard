"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-api";
import { loadOfficeRuntime } from "@/lib/office-runtime";
import type { ShipmentTask } from "@/lib/shipments";
import type { MicrosoftDispatch } from "@/lib/microsoft-storage";
import type { MicrosoftMessagePreview } from "@/lib/microsoft-message";

type ConnectionStatus = {
  configured: boolean;
  missing: string[];
  team_required: boolean;
  connected: boolean;
  account: string | null;
  send_enabled: boolean;
};
const failure = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed. Refresh before retrying.";
async function post<T>(path: string, body: unknown) {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
export function MicrosoftConnection({
  onStatus,
}: {
  onStatus?: (status: ConnectionStatus) => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const current = await requestJson<ConnectionStatus>("/api/microsoft");
      if (request !== generation.current) return;
      setStatus(current);
      onStatus?.(current);
    } catch (error) {
      if (request === generation.current) setError(failure(error));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [onStatus]);
  useEffect(() => {
    const gate = generation;
    void Promise.resolve().then(refresh);
    return () => {
      gate.current++;
    };
  }, [refresh]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ authorize_url: string }>("/api/microsoft", {
        action: "connect",
      });
      const url = new URL(result.authorize_url);
      if (url.origin !== "https://login.microsoftonline.com")
        throw new Error("Invalid connection destination.");
      window.location.assign(url.href);
    } catch (error) {
      setError(failure(error));
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await post("/api/microsoft", { action: "disconnect" });
      await refresh();
    } catch (error) {
      setError(failure(error));
      setBusy(false);
    }
  }
  return (
    <section className="microsoft-connection" aria-label="Microsoft connection">
      <h3>Microsoft mailbox</h3>
      {status ? (
        <>
          <p>
            {status.connected
              ? `Connected: ${status.account}`
              : status.configured
                ? "Ready to connect your account."
                : "Not configured — no tenant or application connection is active."}
          </p>
          {status.team_required && (
            <p>
              Sign in to an authenticated team workspace before connecting a
              mailbox.
            </p>
          )}
          {!status.configured && (
            <details>
              <summary>Administrator setup required</summary>
              <p>
                Configure the Microsoft application, delegated permissions and
                server encryption key. See docs/MICROSOFT_SETUP.md.
              </p>
              <ul>
                {status.missing.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="microsoft-actions">
            {status.connected ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Disconnect account
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !status.configured || status.team_required}
                onClick={() => void connect()}
              >
                Connect Microsoft
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh connection
            </button>
          </div>
        </>
      ) : (
        <>
          <p role={busy ? "status" : undefined}>
            {busy
              ? "Checking connection…"
              : "Connection status is unavailable."}
          </p>
          {!busy && (
            <button type="button" onClick={() => void refresh()}>
              Retry connection
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="microsoft-error">
          {error}
        </p>
      )}
    </section>
  );
}
interface MicrosoftTaskProps {
  shipmentId: string;
  shipmentVersion: number;
  task: ShipmentTask;
  caseVersion: number;
}
export function MicrosoftTaskDraft(props: MicrosoftTaskProps) {
  return (
    <MicrosoftTaskDraftForm
      key={`${props.shipmentId}:${props.shipmentVersion}:${props.task.id}:${props.task.updated_at}:${props.caseVersion}`}
      {...props}
    />
  );
}
function MicrosoftTaskDraftForm({
  shipmentId,
  shipmentVersion,
  task,
  caseVersion,
}: MicrosoftTaskProps) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null),
    [recipient, setRecipient] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [dispatches, setDispatches] = useState<MicrosoftDispatch[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sendId, setSendId] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const connection = await requestJson<ConnectionStatus>("/api/microsoft");
      if (request !== generation.current) return;
      setStatus(connection);
      if (connection.connected) {
        const result = await requestJson<{ dispatches: MicrosoftDispatch[] }>(
          `/api/microsoft/drafts?shipment=${encodeURIComponent(shipmentId)}`,
        );
        if (request !== generation.current) return;
        setDispatches(
          result.dispatches.filter((record) => record.task_id === task.id),
        );
      } else setDispatches([]);
    } catch (error) {
      if (request === generation.current) setError(failure(error));
    }
  }, [shipmentId, task.id]);
  useEffect(() => {
    const gate = generation;
    void Promise.resolve().then(refresh);
    return () => {
      gate.current++;
    };
  }, [refresh]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      await post("/api/microsoft/drafts", {
        action: "create",
        input: {
          shipment_id: shipmentId,
          shipment_version: shipmentVersion,
          task_id: task.id,
          case_version: caseVersion,
          recipient,
          reviewed,
        },
      });
      setReviewed(false);
      await refresh();
    } catch (error) {
      setError(failure(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function send(record: MicrosoftDispatch) {
    setBusy(true);
    setError("");
    try {
      await post("/api/microsoft/drafts", {
        action: "send",
        input: { id: record.id, version: record.version, confirmed: true },
      });
      setSendId(null);
      await refresh();
    } catch (error) {
      setError(failure(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="microsoft-task">
      <summary>Create correspondence in Outlook</summary>
      <p>
        Creates a draft from this saved task. Review the recipient and content
        first. Draft creation sends no email.
      </p>
      {status && !status.connected && (
        <p>
          {status.configured
            ? "Connect your Microsoft account in the Outlook workspace."
            : "Microsoft integration is not configured. This task remains a local draft."}{" "}
          <a href="/outlook" target="_blank" rel="noreferrer">
            Open connection settings
          </a>
        </p>
      )}
      <label>
        Recipient
        <input
          type="email"
          value={recipient}
          onChange={(event) => {
            setRecipient(event.target.value);
            setReviewed(false);
            setSendId(null);
          }}
          maxLength={254}
          placeholder="Confirm the intended recipient"
          disabled={busy}
        />
      </label>
      <details>
        <summary>Review saved message content</summary>
        <strong>{task.title}</strong>
        <pre>{task.body}</pre>
      </details>
      <label className="microsoft-check">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
          disabled={busy}
        />
        <span>
          I reviewed this saved message, recipient and current source case.
        </span>
      </label>
      <button
        type="button"
        disabled={
          busy ||
          !status?.connected ||
          !reviewed ||
          !recipient ||
          task.state === "done"
        }
        onClick={() => void create()}
      >
        Create Outlook draft
      </button>
      {error && (
        <p role="alert" className="microsoft-error">
          {error}
        </p>
      )}
      {dispatches.length > 0 && (
        <ul className="microsoft-dispatches">
          {dispatches.map((record) => {
            const content = JSON.parse(record.payload) as {
              recipient: string;
              subject: string;
              body: string;
            };
            return (
              <li key={record.id}>
                <strong>
                  {record.status === "submitted"
                    ? "Submitted to Microsoft — delivery not confirmed"
                    : record.status === "unknown" ||
                        record.status === "sending" ||
                        record.status === "creating"
                      ? `${record.status} — check mailbox before retrying`
                      : record.status}
                </strong>
                <span>
                  {content.recipient} ·{" "}
                  {new Date(record.created_at).toLocaleString()}
                </span>
                <details>
                  <summary>Saved correspondence evidence</summary>
                  <p>{content.subject}</p>
                  <pre>{content.body}</pre>
                  <small>
                    Shipment v{record.shipment_version}; case v
                    {record.case_version}; operation {record.id}
                  </small>
                </details>
                {record.status === "draft" && status?.send_enabled && (
                  <>
                    {sendId === record.id ? (
                      <div className="microsoft-send-confirm">
                        <p>
                          Send this saved message to{" "}
                          <strong>{content.recipient}</strong> now? The server
                          will recheck source revisions and Outlook draft
                          content.
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void send(record)}
                        >
                          Confirm and send email
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setSendId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSendId(record.id)}
                      >
                        Review send action
                      </button>
                    )}
                  </>
                )}
                {record.status === "draft" && !status?.send_enabled && (
                  <p>
                    Application sending is disabled. Review the draft in
                    Outlook.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

interface OfficeApi {
  onReady: (callback: (info: { host?: string }) => void) => void;
  CoercionType: { Text: string };
  MailboxEnums: { RestVersion: { v2_0: string } };
  context: {
    mailbox?: {
      item?: {
        itemId?: string;
        subject?: string;
        from?: { emailAddress?: string };
        body?: {
          getAsync: (
            type: string,
            callback: (result: { status: string; value?: string }) => void,
          ) => void;
        };
      };
      convertToRestId: (id: string, version: string) => string;
    };
  };
}
type OfficeWindow = Window & { Office?: OfficeApi };
export function OutlookPane() {
  const [officeReady, setOfficeReady] = useState(false),
    [status, setStatus] = useState<ConnectionStatus | null>(null),
    [selected, setSelected] = useState<{
      id: string;
      subject: string;
      body: string;
      from: string;
    } | null>(null),
    [preview, setPreview] = useState<MicrosoftMessagePreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [caseId, setCaseId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadOfficeRuntime(window, document)
      .then(() => {
        if (!active) return;
        (window as OfficeWindow).Office?.onReady((info) => {
          if (active) setOfficeReady(info.host === "Outlook");
        });
      })
      .catch((error: unknown) => {
        if (active) setError(failure(error));
      });
    return () => {
      active = false;
    };
  }, []);
  async function readSelected() {
    setError("");
    setSelected(null);
    setPreview(null);
    setReviewed(false);
    setCaseId(null);
    const office = (window as OfficeWindow).Office,
      item = office?.context.mailbox?.item;
    if (!office || !item?.itemId || !item.body || !office.context.mailbox) {
      setError(
        "Open a saved email in Outlook to read its subject and plain-text body.",
      );
      return;
    }
    setBusy(true);
    try {
      const body = await new Promise<string>((resolve, reject) =>
        item.body!.getAsync(office.CoercionType.Text, (result) =>
          result.status === "succeeded" && typeof result.value === "string"
            ? resolve(result.value)
            : reject(new Error("Outlook could not read the selected message.")),
        ),
      );
      if (body.length > 20000)
        throw new Error(
          "Message exceeds the supported length. Import the required documents manually.",
        );
      setSelected({
        id: office.context.mailbox.convertToRestId(
          item.itemId,
          office.MailboxEnums.RestVersion.v2_0,
        ),
        subject: item.subject || "(No subject)",
        from: item.from?.emailAddress ?? "",
        body,
      });
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  async function loadPreview() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setReviewed(false);
    setCaseId(null);
    try {
      const response = await requestJson<{ message: MicrosoftMessagePreview }>(
        `/api/microsoft/message?id=${encodeURIComponent(selected.id)}`,
      );
      setPreview(response.message);
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  async function importMessage() {
    if (!preview || !reviewed) return;
    setBusy(true);
    setError("");
    try {
      const response = await post<{ case_id: string }>(
        "/api/microsoft/import",
        { id: preview.id, revision: preview.revision, reviewed: true },
      );
      setCaseId(response.case_id);
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="outlook-workspace" id="main-content" tabIndex={-1}>
      <header>
        <p className="outlook-eyebrow">CargoGuard · Outlook workspace</p>
        <h1>Review the selected shipment email</h1>
        <p>
          Read the current message, inspect its attachments, then import it into
          your authenticated team workspace.
        </p>
        <a href="/" target="_blank" rel="noreferrer">
          Open full CargoGuard workspace
        </a>
      </header>
      <MicrosoftConnection onStatus={setStatus} />
      <section className="outlook-selected">
        <h2>Selected email</h2>
        <p>
          {officeReady
            ? "Outlook is available. Select a message, then read it below."
            : "Open this page as the CargoGuard Outlook add-in to read the selected message. Mailbox connection alone does not grant access to a selected item."}
        </p>
        <button
          type="button"
          disabled={!officeReady || busy}
          onClick={() => void readSelected()}
        >
          Read selected email
        </button>
        {selected && (
          <>
            <h3>{selected.subject}</h3>
            <p>{selected.from}</p>
            <details>
              <summary>Plain-text email content</summary>
              <pre>{selected.body}</pre>
            </details>
            <p>
              Email text is untrusted source content. Links and instructions are
              not executed.
            </p>
            <button
              type="button"
              disabled={busy || !status?.connected}
              onClick={() => void loadPreview()}
            >
              Read mailbox source and attachment list
            </button>
          </>
        )}
        {preview && (
          <div className="outlook-preview">
            <h3>Confirm import</h3>
            <p>{preview.subject}</p>
            <p>{preview.attachments.length} attachment(s)</p>
            <ul>
              {preview.attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.name} · {Math.ceil(attachment.size / 1024)} KB ·{" "}
                  {attachment.supported
                    ? "Supported document"
                    : attachment.reason}
                </li>
              ))}
            </ul>
            <label className="microsoft-check">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                disabled={busy}
              />
              <span>
                I reviewed the selected source and attachments for this
                workspace.
              </span>
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !reviewed ||
                !!caseId ||
                preview.attachments.some((item) => !item.supported)
              }
              onClick={() => void importMessage()}
            >
              Import and run verification
            </button>
          </div>
        )}
        {caseId && (
          <p role="status">
            Email imported.{" "}
            <a
              href={`/?case=${encodeURIComponent(caseId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open this case and review its evidence
            </a>
            , then link it to the confirmed shipment.
          </p>
        )}
        {error && (
          <p className="microsoft-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <footer>
        Live Microsoft behavior requires administrator setup and validation in
        your organisation’s Outlook client. Shared mailboxes and unattended
        mailbox monitoring are not enabled by this task pane.
      </footer>
    </main>
  );
}
