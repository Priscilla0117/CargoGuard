"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  FileStack,
  Inbox,
  Mail,
  Menu,
  Settings2,
  ShieldCheck,
  Ship,
  Tags,
  X,
} from "lucide-react";
import { useTeamAccess } from "./team-access";
import {
  parseWorkbenchSearch,
  workbenchHref,
} from "@/lib/workspace-navigation";

const destinations = [
  { href: "/", label: "Work queue", icon: Inbox, group: "Operations" },
  { href: "/shipments", label: "Shipments", icon: Ship, group: "Operations" },
  {
    href: "/insights",
    label: "Insights",
    icon: BarChart3,
    group: "Operations",
  },
  { href: "/outlook", label: "Outlook", icon: Mail, group: "Operations" },
  { href: "/rules", label: "Label rules", icon: Tags, group: "Workspace" },
  {
    href: "/templates",
    label: "SI templates",
    icon: FileStack,
    group: "Workspace",
  },
  {
    href: workbenchHref("performance"),
    label: "Reports",
    icon: BookOpen,
    group: "Workspace",
  },
  {
    href: workbenchHref("policies"),
    label: "Settings",
    icon: Settings2,
    group: "Workspace",
  },
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { view } = parseWorkbenchSearch(useSearchParams());
  const access = useTeamAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuOpen) firstLink.current?.focus();
  }, [menuOpen]);
  const currentHref =
    pathname === "/"
      ? workbenchHref(view === "activity" ? "performance" : view)
      : pathname;
  const current = destinations.find((item) => item.href === currentHref);
  const name = access?.user?.display_name ?? "Operations";
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");

  return (
    <div className="workspace-shell">
      <aside
        className={`workspace-sidebar${menuOpen ? " is-open" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            setMenuOpen(false);
            menuToggle.current?.focus();
          }
        }}
      >
        <Link
          href="/"
          className="workspace-brand"
          aria-label="CargoGuard home"
          onClick={() => setMenuOpen(false)}
        >
          <span className="workspace-brand-symbol">
            <ShieldCheck size={25} />
          </span>
          <span>
            CargoGuard<small>SHIPPING INTELLIGENCE</small>
          </span>
        </Link>
        <nav id="workspace-destinations" aria-label="Workspace navigation">
          {["Operations", "Workspace"].map((group) => (
            <div className="workspace-nav-group" key={group}>
              <p>{group}</p>
              {destinations
                .filter((item) => item.group === group)
                .map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    ref={href === "/" ? firstLink : undefined}
                    aria-current={currentHref === href ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
            </div>
          ))}
        </nav>
        <div className="workspace-sidebar-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Evidence before action</strong>
            <p>Review uncertainty. Keep every decision traceable.</p>
          </div>
        </div>
        <div className="workspace-identity">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <div>
            <strong>{name}</strong>
            <small>
              {access?.user
                ? `${access.user.role} · Shared team`
                : "Isolated working session"}
            </small>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button
            ref={menuToggle}
            className="workspace-menu-toggle"
            aria-label={
              menuOpen ? "Close workspace menu" : "Open workspace menu"
            }
            aria-expanded={menuOpen}
            aria-controls="workspace-destinations"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="workspace-breadcrumb">
            <span>{current?.group ?? "Workspace"}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{current?.label ?? "CargoGuard"}</strong>
          </div>
          <span className="workspace-mode">
            <span aria-hidden="true" />
            {access?.mode === "team" ? "Team workspace" : "Sample workspace"}
          </span>
          <Link
            className="workspace-mobile-queue"
            href="/"
            onClick={() => setMenuOpen(false)}
          >
            <Inbox size={17} aria-hidden="true" />
            Work queue
          </Link>
        </header>
        <div className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
