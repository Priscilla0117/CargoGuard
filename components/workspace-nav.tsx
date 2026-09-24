import Link from "next/link";
import "@/app/workspace-nav.css";

export type WorkspaceRoute =
  | "/"
  | "/shipments"
  | "/insights"
  | "/rules"
  | "/templates"
  | "/outlook";

const destinations: { href: WorkspaceRoute; label: string }[] = [
  { href: "/", label: "Work queue" },
  { href: "/shipments", label: "Shipments" },
  { href: "/insights", label: "Insights" },
  { href: "/rules", label: "Label rules" },
  { href: "/templates", label: "SI templates" },
  { href: "/outlook", label: "Outlook" },
];

/** Explicit active route also works on pages rendered without a router hook. */
export function WorkspaceNav({ active }: { active: WorkspaceRoute }) {
  return (
    <nav className="workspace-nav" aria-label="Workspace navigation">
      <span className="workspace-nav-label">Workspace</span>
      <div className="workspace-nav-links">
        {destinations.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
