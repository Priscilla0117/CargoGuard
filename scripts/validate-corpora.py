"""Offline scoring only. Never imported by the deployed application."""
import importlib.util
import json
from pathlib import Path
from datetime import datetime, timezone

project = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("scoring", project.parent / "sdoc-hackathon-docker/server/scoring.py")
scoring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoring)
sets = [
    ("supplied-development", project.parent / "sdoc-hackathon-docker/data_v2", project / "work/evaluation"),
    ("prior-challenge-seed-7", project / "work/audit-seed-7", project / "work/validation/seed-7"),
    ("prior-challenge-seed-20260920", project / "work/audit-seed-20260920", project / "work/validation/seed-20260920"),
    ("new-same-generator-seed-20260921", project / "work/validation-seed-20260921", project / "work/validation/seed-20260921"),
]
report = {"generated_at": datetime.now(timezone.utc).isoformat(), "pipeline": "2.0.0", "limitation": "Synthetic development and same-generator challenge sets, not independent real-world holdout data. Extra uncertain-category reviews are deliberately counted as differences.", "datasets": []}
for name, root, output in sets:
    truth = json.loads((root / "ground_truth.json").read_text(encoding="utf-8"))
    pred = json.loads((output / "submission.json").read_text(encoding="utf-8"))
    results = {r["email"]["email_id"]: r for r in json.loads((output / "results.json").read_text(encoding="utf-8"))}
    assert set(truth) == set(pred)
    differences = [{"id": eid, "expected": t, "actual": pred[eid], "email": results[eid]["email"], "classification": results[eid]["classification"]} for eid, t in truth.items() if any(t[k] != pred[eid][k] for k in ("category", "status", "review_reason", "has_defect")) or set(t["defect_fields"]) != set(pred[eid]["defect_fields"])]
    score = scoring.score_all(truth, pred)
    false_clearances = [eid for eid, t in truth.items() if (t["has_defect"] or t["status"] == "NEEDS_REVIEW") and results[eid]["workflow"] == "verified"]
    report["datasets"].append({"name": name, "score": score, "false_clearances": false_clearances, "differences": differences})
(project / "work/validation/corpus-report.json").write_text(json.dumps(report, indent=2))
print(json.dumps([{ "name": d["name"], "classification_accuracy": d["score"]["stage1"]["accuracy"], "defects": d["score"]["end_to_end"], "extra_or_incorrect_decisions": len(d["differences"]), "false_clearances": len(d["false_clearances"])} for d in report["datasets"]], indent=2))
