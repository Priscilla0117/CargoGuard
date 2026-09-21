import { Eye, Inbox, ShieldCheck, BarChart3, History } from "lucide-react";

const guides = {
  inbox: {
    icon: Inbox,
    title: "From email to evidence",
    note: "SI is the reference. A clean comparison is not a shipment approval.",
    steps: ["Find the request", "Compare all 7 fields", "Inspect the source"],
  },
  review: {
    icon: Eye,
    title: "Uncertainty is a task, not a pass",
    note: "Keep the original evidence beside every correction. You make the final review decision.",
    steps: ["Check the blocker", "Confirm or correct", "Recheck the result"],
  },
  policies: {
    icon: ShieldCheck,
    title: "Try the rule before you activate it",
    note: "Tolerances add context. They never hide an exact mismatch or approve a shipment.",
    steps: ["Set the bounds", "Preview the impact", "Record the reason"],
  },
  performance: {
    icon: BarChart3,
    title: "Know what the numbers prove",
    note: "Workspace outcomes and supplied-data validation are separate. Neither guarantees unseen-data accuracy.",
    steps: ["Inspect outcomes", "Read test evidence", "Understand limitations"],
  },
  activity: {
    icon: History,
    title: "A traceable handover",
    note: "Follow processing and corrections in this workspace. Demo reviewer names are self-declared.",
    steps: ["Find the event", "Read the change", "Check who recorded it"],
  },
} as const;

export function WorkspaceGuide({ view }: { view: keyof typeof guides }) {
  const guide = guides[view],
    Icon = guide.icon;
  return (
    <section
      className={`workspace-guide guide-${view}`}
      aria-label="Workflow guide"
    >
      <div className="guide-heading">
        <span className="feature-icon">
          <Icon size={22} />
        </span>
        <div>
          <h2>{guide.title}</h2>
          <p>{guide.note}</p>
        </div>
      </div>
      <ol>
        {guide.steps.map((step, i) => (
          <li key={step}>
            <span>{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}
