import {
  ChevronDown,
  CircleCheck,
  CircleHelp,
  FileSearch,
  Info,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type {
  IntegrityAssessment,
  IntegrityFinding,
  IntegrityStatus,
} from "@/lib/integrity-checks";

const labels: Record<IntegrityStatus, string> = {
  blocking: "Issue found",
  review: "Review needed",
  passed: "Check passed",
  not_checked: "Not checked",
};
const icons = {
  blocking: ShieldAlert,
  review: TriangleAlert,
  passed: CircleCheck,
  not_checked: CircleHelp,
};

function Finding({ finding }: { finding: IntegrityFinding }) {
  const Icon = icons[finding.status];
  return (
    <details
      key={finding.id}
      className={`integrity-finding ${finding.status}`}
      open={finding.status === "blocking" || finding.status === "review"}
    >
      <summary>
        <Icon size={16} aria-hidden="true" />
        <span className="integrity-finding-title">
          {finding.title}
          <small>{finding.document}</small>
        </span>
        <span className="integrity-status">{labels[finding.status]}</span>
        <ChevronDown
          className="integrity-chevron"
          size={16}
          aria-hidden="true"
        />
      </summary>
      <div className="integrity-finding-body">
        <p>{finding.detail}</p>
        {finding.evidence.length > 0 ? (
          <ul className="integrity-evidence">
            {finding.evidence.map((item, index) => (
              <li key={`${item.location}-${index}`}>
                <span>{item.location}</span>
                <blockquote>{item.quote}</blockquote>
                {item.source_sha256 ? (
                  <details className="integrity-fingerprint">
                    <summary>Source fingerprint · SHA-256</summary>
                    <code>{item.source_sha256}</code>
                  </details>
                ) : (
                  <small>Source fingerprint unavailable</small>
                )}
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
}

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
  const unchecked = ordered.filter(
    (finding) => finding.status === "not_checked",
  );
  const groupUnchecked = unchecked.length >= 3;
  const visible = groupUnchecked
    ? ordered.filter((finding) => finding.status !== "not_checked")
    : ordered;
  const attention = assessment.counts.blocking + assessment.counts.review;
  return (
    <section className="integrity-panel" aria-label={heading}>
      <div className="integrity-panel-heading">
        <span className="integrity-panel-icon">
          <FileSearch size={20} aria-hidden="true" />
        </span>
        <div className="integrity-panel-intro">
          <span className="integrity-eyebrow">BEYOND DOCUMENT MATCHING</span>
          <h3>{heading}</h3>
          <p>{description}</p>
        </div>
      </div>
      <dl className="integrity-counts" aria-label={`${heading} totals`}>
        {(["blocking", "review", "passed", "not_checked"] as const).map(
          (status) => (
            <div key={status} className={`integrity-count ${status}`}>
              <dt>{labels[status]}</dt>
              <dd>{assessment.counts[status]}</dd>
            </div>
          ),
        )}
      </dl>
      <p className="integrity-findings-guide">
        {attention > 0
          ? `${attention} ${attention === 1 ? "finding needs" : "findings need"} attention. Open a check to inspect its source evidence.`
          : "Open a check to inspect the evidence and its limits."}
      </p>
      <div className="integrity-findings">
        {ordered.length === 0 && (
          <p className="integrity-no-evidence">
            No checks are available for this case. This is not a passed
            assessment.
          </p>
        )}
        {visible.map((finding) => (
          <Finding key={finding.id} finding={finding} />
        ))}
        {groupUnchecked && (
          <details className="integrity-unchecked-group">
            <summary>
              <CircleHelp size={17} aria-hidden="true" />
              <span>
                <strong>{unchecked.length} checks not completed</strong>
                <small>Inspect missing evidence</small>
              </span>
              <ChevronDown
                className="integrity-chevron"
                size={16}
                aria-hidden="true"
              />
            </summary>
            <div className="integrity-unchecked-body">
              <p>
                These checks remain unassessed. Open each one to see what
                evidence is missing; none counts as a passed check.
              </p>
              <div className="integrity-findings">
                {unchecked.map((finding) => (
                  <Finding key={finding.id} finding={finding} />
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
      <div className="integrity-scope" role="note">
        <Info size={15} aria-hidden="true" />
        <p>{limit}</p>
      </div>
      <p className="integrity-version">Rules {assessment.rule_version}</p>
    </section>
  );
}
