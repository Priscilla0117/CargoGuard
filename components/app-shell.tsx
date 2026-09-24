"use client";
import Link from "next/link";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  BarChart3,
  Inbox,
  Mail,
  Menu,
  Package,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useTeamAccess } from "./team-access";

export type AppRoute =
  | "/"
  | "/shipments"
  | "/insights"
  | "/reports"
  | "/mail"
  | "/rules"
  | "/templates"
  | "/settings"
  | "/outlook";

const MAIN: { href: AppRoute; label: string; icon: typeof Inbox }[] = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/shipments", label: "Shipments", icon: Package },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];
const SETUP: { href: AppRoute; label: string; icon: typeof Inbox }[] = [
  { href: "/mail", label: "Email accounts", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
/** Occasional tools live under Settings; their pages highlight it. */
const UNDER: Partial<Record<AppRoute, AppRoute>> = {
  "/outlook": "/mail",
  "/rules": "/settings",
  "/templates": "/settings",
  "/insights": "/settings",
};

/** Averis wordmark (text-based, matches the Averis brand mark). */
export function AverisLogo({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`cg-averis-logo ${dark ? "dark" : ""}`}
      role="img"
      aria-label="Averis"
    >
      <i aria-hidden="true" />
      averis
    </span>
  );
}

const noSubscribe = () => () => {};
function readRememberedCount() {
  try {
    const saved = Number(sessionStorage.getItem("cg-inbox-count"));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

/** One navigation for every page: same place, same words, same order. */
export function AppShell({
  active,
  children,
  inboxCount,
}: {
  active: AppRoute;
  children: ReactNode;
  inboxCount?: number;
}) {
  const access = useTeamAccess();
  const [open, setOpen] = useState(false);
  // Pages outside the inbox show the last known to-do count (this tab only).
  const remembered = useSyncExternalStore(
    noSubscribe,
    readRememberedCount,
    () => null,
  );
  useEffect(() => {
    if (inboxCount === undefined) return;
    try {
      sessionStorage.setItem("cg-inbox-count", String(inboxCount));
    } catch {
      // Storage can be unavailable (private mode); the badge is optional.
    }
  }, [inboxCount]);
  const count = inboxCount ?? remembered ?? undefined;
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const current = UNDER[active] ?? active;
  const link = ({ href, label, icon: Icon }: (typeof MAIN)[number]) => (
    <Link
      key={href}
      href={href}
      className="cg-nav-link"
      aria-current={current === href ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      <Icon size={20} aria-hidden="true" />
      {label}
      {href === "/" && !!count && (
        <span className="cg-nav-count" aria-label={`${count} to do`}>
          {count > 999 ? "999+" : count}
        </span>
      )}
    </Link>
  );
  return (
    <div className="cg-shell">
      <aside
        className="cg-sidebar"
        data-open={open}
        aria-label="Main navigation"
      >
        <Link href="/" className="cg-brand" onClick={() => setOpen(false)}>
          <ShieldCheck size={28} aria-hidden="true" />
          <span>
            CargoGuard
            <small>Document desk</small>
          </span>
        </Link>
        <nav className="cg-nav-group" aria-label="Daily work">
          <span className="cg-nav-title">Daily work</span>
          {MAIN.map(link)}
        </nav>
        <nav className="cg-nav-group" aria-label="Setup">
          <span className="cg-nav-title">Setup</span>
          {SETUP.map(link)}
        </nav>
        <div className="cg-sidebar-foot">
          <div className="cg-user">
            <span className="cg-avatar" aria-hidden="true">
              {(access?.user?.display_name ?? "Demo")
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase()}
            </span>
            <span>
              <strong>{access?.user?.display_name ?? "Demo workspace"}</strong>
              <small>
                {access?.user
                  ? `${access.user.role[0].toUpperCase()}${access.user.role.slice(1)} · shared team`
                  : "Practice data only"}
              </small>
            </span>
          </div>
          <div className="cg-averis">
            <AverisLogo />
            <small>Built for Averis shipping operations</small>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="cg-backdrop"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="cg-main">
        <header className="cg-mobilebar">
          <button
            className="cg-icon-btn"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <ShieldCheck size={22} aria-hidden="true" />
          CargoGuard
          <span className="cg-spacer" />
          <AverisLogo />
        </header>
        <div className="cg-content">{children}</div>
      </div>
    </div>
  );
}
