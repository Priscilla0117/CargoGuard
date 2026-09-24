import {
  CircleCheck,
  CircleHelp,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type {
  IntegrityAssessment,
  IntegrityStatus,
} from "@/lib/integrity-checks";

const labels: Record<IntegrityStatus, string> = {
  blocking: "Issue found",
  review: "Review",
  passed: "Check passed",
  not_checked: "Not checked",
};
const icons = {
  blocking: ShieldAlert,
  review: TriangleAlert,
  passed: CircleCheck,
  not_checked: CircleHelp,
};

export function IntegrityChecks({
  assessment,
  heading = "Independent document checks",
  description = "Catch source inconsistencies even when SI and BL agree. These findings are separate from the seven-field comparison.",
  limit = "A passed check covers only the stated rule and evidence. It is not equipment certification, shipment release or compliance clearance. Missing or incomplete evidence stays “Not checked”.",
}: {
  assessment: IntegrityAssessment;
  heading?: string;
  description?: string;
  limit?: string;
}) {
  const ordered = [...assessment.findings].sort(
    (a, b) =>
      ["blocking", "review", "not_checked", "passed"].indexOf(a.status) -
      ["blocking", "review", "not_checked", "passed"].indexOf(b.status),
  );
  return (
    <section className="integrity-panel" aria-label={heading}>
      <div className="integrity-panel-heading">
        <div>
          <h3>{heading}</h3>
          <p>{description}</p>
        </div>
        <span className="integrity-rule-version">
          Rules {assessment.rule_version}
        </span>
      </div>
      <div className="integrity-counts" aria-label={`${heading} totals`}>
        {(["blocking", "review", "passed", "not_checked"] as const).map(
          (status) => (
            <span key={status} className={`integrity-count ${status}`}>
              <strong>{assessment.counts[status]}</strong> {labels[status]}
            </span>
          ),
        )}
      </div>
      <p className="integrity-limit">{limit}</p>
      <div className="integrity-findings">
        {ordered.map((finding) => {
          const Icon = icons[finding.status];
          return (
            <details
              key={finding.id}
              className={`integrity-finding ${finding.status}`}
              open={
                finding.status === "blocking" || finding.status === "review"
              }
            >
              <summary>
                <Icon size={16} aria-hidden="true" />
                <span className="integrity-finding-title">
                  {finding.title}
                  <small>{finding.document}</small>
                </span>
                <span className="integrity-status">
                  {labels[finding.status]}
                </span>
              </summary>
              <div className="integrity-finding-body">
                <p>{finding.detail}</p>
                {finding.evidence.length > 0 ? (
                  <ul className="integrity-evidence">
                    {finding.evidence.map((item, index) => (
                      <li key={`${item.location}-${index}`}>
                        <span>{item.location}</span>
                        <blockquote>{item.quote}</blockquote>
                        <small
                          title={item.source_sha256 ?? "No source fingerprint"}
                        >
                          Source SHA-256: {item.source_sha256 ?? "unavailable"}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="integrity-no-evidence">
                    No usable source evidence was located for this check.
                  </p>
                )}
                <small className="integrity-rule-version">
                  {finding.rule} · rule {finding.rule_version}
                </small>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
