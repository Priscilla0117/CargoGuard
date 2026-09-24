import { BarChart3 } from "lucide-react";
import { operationsSnapshot } from "@/lib/operations";
import { FIELDS, FIELD_LABELS, type CaseSummary } from "@/lib/types";

export function WorkloadInsights({ cases }: { cases: CaseSummary[] }) {
  const snapshot = operationsSnapshot(cases);
  const maximum = Math.max(1, ...Object.values(snapshot.fieldCounts));
  return (
    <section className="content-card wide workload-insights">
      <div className="card-title">
        <BarChart3 size={19} />
        <h2>Discrepancies by field</h2>
        <span className="count-pill">
          {snapshot.lanes.amend.length} discrepancy cases
        </span>
      </div>
      <div className="ops-patterns">
        {FIELDS.map((field) => (
          <div key={field}>
            <span>
              {FIELD_LABELS[field]}
              <b>{snapshot.fieldCounts[field]}</b>
            </span>
            <div aria-hidden="true">
              <i
                style={{
                  width: `${(snapshot.fieldCounts[field] / maximum) * 100}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="report-scope-note">
        Completed, current-engine discrepancy cases only. Review cases may
        contain further differences. Counts show workload—not root causes,
        supplier performance or measured savings.
      </p>
    </section>
  );
}
