"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  FileStack,
  Inbox,
  Lightbulb,
  Mail,
  Menu,
  Package,
  Settings2,
  ShieldCheck,
  Tags,
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
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];
const SETUP: { href: AppRoute; label: string; icon: typeof Inbox }[] = [
  { href: "/mail", label: "Email accounts", icon: Mail },
  { href: "/rules", label: "Label rules", icon: Tags },
  { href: "/templates", label: "SI templates", icon: FileStack },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

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
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const current = active === "/outlook" ? "/mail" : active;
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
      {href === "/" && !!inboxCount && (
        <span className="cg-nav-count" aria-label={`${inboxCount} to do`}>
          {inboxCount > 999 ? "999+" : inboxCount}
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
            <small>Shipping document desk</small>
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
          <strong>{access?.user?.display_name ?? "Demo workspace"}</strong>
          <span>
            {access?.user
              ? `${access.user.role[0].toUpperCase()}${access.user.role.slice(1)} · shared team`
              : "Practice data only · names are self-reported"}
          </span>
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
        </header>
        <div className="cg-content">{children}</div>
      </div>
    </div>
  );
}
