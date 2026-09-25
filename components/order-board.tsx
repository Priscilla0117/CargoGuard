"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { requestJson } from "@/lib/client-api";
import {
  buildOrders,
  weekAhead,
  type Order,
  type StepState,
} from "@/lib/orders";
import { displayStatus } from "@/lib/case-status";
import type { FollowUp } from "@/lib/follow-up";
import type { CaseSummary } from "@/lib/types";
import { formatReceived } from "./inbox-view";

type View = "todo" | "waiting" | "done" | "all";
const VIEW_LABELS: Record<View, string> = {
  todo: "Needs action",
  waiting: "Waiting for reply",
  done: "Done",
  all: "All orders",
};

function dueText(date: string, label: string, now: number) {
  const target = new Date(date.length === 10 ? `${date}T12:00:00` : date);
  if (!Number.isFinite(target.getTime())) return null;
  const days = Math.round(
    (new Date(target.toDateString()).getTime() -
      new Date(new Date(now).toDateString()).getTime()) /
      86400000,
  );
  const when =
    days < 0
      ? `${-days} day${days === -1 ? "" : "s"} ago`
      : days === 0
        ? "today"
        : days === 1
          ? "tomorrow"
          : days < 7
            ? `in ${days} days`
            : target.toLocaleDateString([], { day: "numeric", month: "short" });
  return { text: `${label} ${when}`, late: days < 0, soon: days <= 1 };
}

const STEP_ICON: Record<StepState, React.ReactNode> = {
  done: <Check size={14} />,
  problem: <TriangleAlert size={14} />,
  waiting: <Clock3 size={14} />,
  active: <ArrowRight size={14} />,
  none: null,
};

function OrderCard({
  order,
  now,
  trackedId,
  onTrack,
  onOpenTracked,
}: {
  order: Order;
  now: number;
  trackedId?: string;
  onTrack: (order: Order) => Promise<void>;
  onOpenTracked?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(false);
  const last = order.last_at
    ? formatReceived(new Date(order.last_at).toISOString(), now)
    : null;
  const due = order.deadline
    ? dueText(order.deadline.date, order.deadline.label, now)
    : null;
  return (
    <article className={`cg-order ${order.status} level-${order.level}`}>
      <header className="cg-order-head">
        <div className="cg-order-title">
          <h3>
            Order {order.ref}
            {order.status === "todo" &&
              (order.level === "urgent" || order.level === "high") && (
                <span className={`cg-tag ${order.level}`}>
                  {order.level === "urgent" ? "Urgent" : "High priority"}
                </span>
              )}
          </h3>
          <p>
            {[
              order.destination && `To ${order.destination}`,
              order.carrier && `Carrier ${order.carrier}`,
              `${order.emails.length} email${order.emails.length === 1 ? "" : "s"}`,
              last && `last ${last.day} ${last.time}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {due && (
          <span
            className={`cg-deadline-chip ${due.late ? "late" : due.soon ? "soon" : ""}`}
          >
            {due.text}
          </span>
        )}
        <Link
          className={`cg-btn ${order.status === "todo" ? "primary" : ""}`}
          href={`/?case=${encodeURIComponent(order.next_id)}`}
        >
          {order.status === "todo"
            ? `Open next email${order.todo > 1 ? ` (${order.todo} to do)` : ""}`
            : "Open latest email"}
          <ArrowRight size={17} />
        </Link>
      </header>
      <p className={`cg-order-summary ${order.status}`}>{order.summary}</p>
      <ol className="cg-steps" aria-label={`Progress of order ${order.ref}`}>
        {order.steps.map((step) => (
          <li key={step.key} className={`cg-step ${step.state}`}>
            <span className="cg-step-dot" aria-hidden="true">
              {STEP_ICON[step.state]}
            </span>
            <span className="cg-step-text">
              <b>{step.label}</b>
              <small>{step.note}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="cg-order-foot">
        <button
          type="button"
          className="cg-link cg-small cg-order-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {open ? "Hide" : "Show"} the {order.emails.length} email
          {order.emails.length === 1 ? "" : "s"} about this order
        </button>
        {trackedId ? (
          <button
            type="button"
            className="cg-link cg-small cg-order-tracked"
            onClick={() => onOpenTracked?.(trackedId)}
          >
            <Check size={15} /> Tracked — owner, deadlines and amendments
          </button>
        ) : (
          <button
            type="button"
            className="cg-btn small"
            disabled={tracking}
            title="Adds this order to Tracked shipments with its emails, so you can set an owner, confirmed deadlines and amendments."
            onClick={() => {
              setTracking(true);
              void onTrack(order).finally(() => setTracking(false));
            }}
          >
            {tracking ? <Loader2 size={15} className="cg-spin" /> : null}
            Track this order
          </button>
        )}
      </div>
      {open && (
        <ol className="cg-order-emails">
          {order.emails.map((row) => {
            const when = formatReceived(row.email.received_at, now);
            const status = displayStatus(row, order.plans[row.email.email_id]);
            return (
              <li key={row.email.email_id}>
                <Link href={`/?case=${encodeURIComponent(row.email.email_id)}`}>
                  <span className="cg-order-email-when">
                    {when ? `${when.day} ${when.time}` : "No date"}
                  </span>
                  <span className="cg-order-email-subject">
                    <strong>
                      {row.email.insight?.sender_name || row.email.from}
                    </strong>
                    <small>{row.email.subject}</small>
                  </span>
                  <span className={`cg-pill ${status.tone}`}>
                    {status.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

/** Orders built automatically from the inbox — no setup needed. */
export function OrderBoard({
  onOpenTracked,
}: {
  /** Show one tracked shipment (switches to the Tracked shipments tab). */
  onOpenTracked?: (id: string) => void;
} = {}) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [followups, setFollowups] = useState<Record<string, FollowUp>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("todo");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [now, setNow] = useState(() => Date.now());
  const [tracked, setTracked] = useState<Record<string, string>>({});
  const loadTracked = useCallback(async () => {
    try {
      const data = await requestJson<{
        shipments: { id: string; references: string[] }[];
      }>("/api/shipments", { cache: "no-store" });
      const map: Record<string, string> = {};
      for (const shipment of data.shipments)
        for (const ref of shipment.references)
          map[ref.toUpperCase()] ??= shipment.id;
      setTracked(map);
    } catch {
      // Tracking is optional; the automatic orders still work.
    }
  }, []);
  /** Promote an automatic order to a tracked shipment with its emails linked. */
  async function track(order: Order) {
    setError("");
    let actor = "Document desk";
    try {
      actor = localStorage.getItem("cg-reviewer-name")?.trim() || actor;
    } catch {
      // Private windows may block storage.
    }
    if (actor.length < 2) actor = "Document desk";
    try {
      const created = await requestJson<{
        shipment: { id: string; version: number };
      }>("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title:
            `Order ${order.ref}${order.destination ? ` to ${order.destination}` : ""}`.slice(
              0,
              180,
            ),
          customer: "",
          carrier: order.carrier.slice(0, 120),
          references: [order.ref],
          actor,
        }),
      });
      let shipment = created.shipment;
      for (const row of order.emails) {
        if (!row.result) continue;
        const linked = await requestJson<{
          shipment: { id: string; version: number };
        }>("/api/shipments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "link",
            id: shipment.id,
            version: shipment.version,
            case_id: row.email.email_id,
            case_version: row.result.version,
            reason: `Same order number ${order.ref} in this email.`,
            unlink: false,
            actor,
          }),
        });
        shipment = linked.shipment;
      }
      onOpenTracked?.(shipment.id);
    } catch (e) {
      setError(
        `Order ${order.ref} could not be tracked: ${e instanceof Error ? e.message : "please retry."}`,
      );
      void loadTracked();
    }
  }
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [inbox, follow] = await Promise.all([
        requestJson<{ cases: CaseSummary[] }>("/api/inbox", {
          cache: "no-store",
        }),
        requestJson<{ followups: FollowUp[] }>("/api/follow-ups", {
          cache: "no-store",
        }),
      ]);
      setCases(inbox.cases);
      setFollowups(
        Object.fromEntries(
          follow.followups.map((item) => [item.email_id, item]),
        ),
      );
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the orders.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadTracked();
  }, [load, loadTracked]);
  const orders = useMemo(
    () => buildOrders(cases, followups, now),
    [cases, followups, now],
  );
  const unchecked = cases.filter((row) => !row.result).length;
  const week = useMemo(() => weekAhead(orders, now), [orders, now]);
  const weekTotal = week.reduce((sum, day) => sum + day.items.length, 0);
  const counts = useMemo(() => {
    const value: Record<View, number> = {
      todo: 0,
      waiting: 0,
      done: 0,
      all: orders.length,
    };
    for (const order of orders) value[order.status]++;
    return value;
  }, [orders]);
  const needle = query.trim().toLowerCase();
  const visible = orders.filter(
    (order) =>
      (view === "all" || order.status === view) &&
      (!needle ||
        [
          order.ref,
          order.destination,
          order.carrier,
          ...order.emails.flatMap((row) => [
            row.email.subject,
            row.email.from,
            ...(row.email.insight
              ? Object.values(row.email.insight.refs).flat()
              : []),
          ]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );

  return (
    <div className="cg-panel">
      {error && (
        <div className="cg-notice error" role="alert">
          <TriangleAlert size={20} />
          <p>{error}</p>
          <button className="cg-btn small" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {unchecked > 0 && !loading && (
        <div className="cg-notice warn" role="status">
          <TriangleAlert size={20} />
          <p>
            {unchecked} email{unchecked === 1 ? " is" : "s are"} not checked
            yet. Open the{" "}
            <Link className="cg-link" href="/">
              Inbox
            </Link>{" "}
            to check them — they will then appear here.
          </p>
        </div>
      )}
      {weekTotal > 0 && (
        <section
          className="cg-card cg-card-pad"
          aria-label="Deadlines this week"
        >
          <h2 className="cg-section-title">
            <Clock3 size={18} /> This week
            <span className="cg-muted cg-small">
              {" "}
              · dates found in the emails and your reply reminders
            </span>
          </h2>
          <div className="cg-week">
            {week.map((day) => (
              <div
                key={day.key}
                className={`cg-week-day ${day.key === "late" ? "late" : ""}`}
              >
                <strong>{day.title}</strong>
                {day.items.length ? (
                  <ul>
                    {day.items.slice(0, 4).map((item) => (
                      <li key={`${item.id}-${item.label}`}>
                        <Link
                          className={`cg-week-item ${item.level}`}
                          href={`/?case=${encodeURIComponent(item.id)}`}
                        >
                          <b>{item.ref}</b>
                          <small>{item.label}</small>
                        </Link>
                      </li>
                    ))}
                    {day.items.length > 4 && (
                      <li className="cg-muted cg-small">
                        +{day.items.length - 4} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <small className="cg-muted">Nothing due</small>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="cg-queue" aria-label="Orders">
        <div className="cg-qtabs" role="tablist" aria-label="Order lists">
          {(Object.keys(VIEW_LABELS) as View[]).map((key) => (
            <button
              key={key}
              role="tab"
              className="cg-qtab"
              aria-selected={view === key}
              onClick={() => {
                setView(key);
                setLimit(30);
              }}
            >
              {VIEW_LABELS[key]}
              <span className="cg-qcount">{loading ? "–" : counts[key]}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="cg-toolbar cg-order-toolbar">
        <label className="cg-search">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an order, PO, invoice, port or carrier…"
            aria-label="Find an order"
          />
        </label>
        <button
          className="cg-btn"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={17} className={loading ? "cg-spin" : ""} /> Refresh
        </button>
      </div>
      {loading && !orders.length ? (
        <div className="cg-empty">
          <Loader2 size={30} className="cg-spin" />
          <h3>Finding your orders…</h3>
        </div>
      ) : !visible.length ? (
        <div className="cg-empty">
          <h3>
            {orders.length
              ? needle
                ? "No order matches this search"
                : `No orders in “${VIEW_LABELS[view]}”`
              : "No orders yet"}
          </h3>
          <p>
            Orders appear here by themselves when an email mentions an order
            number such as 5RFR-36541.
          </p>
        </div>
      ) : (
        <div className="cg-orders">
          {visible.slice(0, limit).map((order) => (
            <OrderCard
              key={order.ref}
              order={order}
              now={now}
              trackedId={tracked[order.ref.toUpperCase()]}
              onTrack={track}
              onOpenTracked={onOpenTracked}
            />
          ))}
          {visible.length > limit && (
            <div className="cg-list-foot">
              <button className="cg-btn" onClick={() => setLimit(limit + 30)}>
                Show 30 more ({visible.length - limit} left)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
