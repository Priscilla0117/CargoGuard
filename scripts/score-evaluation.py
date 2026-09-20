"""Evaluation boundary: this script reads the organiser key. Application code does not."""
import importlib.util
import json
import sys
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

project = Path(__file__).resolve().parents[1]
organiser = project.parent / "sdoc-hackathon-docker"
spec = importlib.util.spec_from_file_location("organiser_scoring", organiser / "server" / "scoring.py")
scoring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoring)
sys.stdout.reconfigure(encoding="utf-8")
truth = json.loads((organiser / "data_v2" / "ground_truth.json").read_text(encoding="utf-8"))
evaluation = project / "work" / "evaluation"
pred = json.loads((evaluation / "submission.json").read_text(encoding="utf-8"))
results = {r["email"]["email_id"]: r for r in json.loads((evaluation / "results.json").read_text(encoding="utf-8"))}
assert set(truth) == set(pred), "Submission IDs must match exactly"
score = scoring.score_all(truth, pred)
diff = []
for eid, t in truth.items():
    p = pred[eid]
    if any(p.get(k) != t.get(k) for k in ("category", "status", "review_reason", "has_defect")) or set(p["defect_fields"]) != set(t["defect_fields"]):
        diff.append({"id": eid, "gold": t, "prediction": p, "summary": results[eid]["summary"]})
(evaluation / "score.json").write_text(json.dumps(score, indent=2))
(evaluation / "differences.json").write_text(json.dumps(diff, indent=2))
report = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "version": "Full organiser development corpus; not a held-out benchmark",
    "metrics": {"classification_macro_f1": score["stage1"]["macro_f1"], "defect_f1": score["stage3"]["defect_f1"], "exact_defect_catch": score["end_to_end"]["rate"], "review_recall": score["reliability"]["escalation_recall"]},
    "score": score,
    "note": "Measured on the supplied synthetic development data. Ground truth is read only by this offline evaluation script, not by the deployed application. This is not a forecast of unseen-document accuracy or judging results. Awaiting-document requests remain visibly unverified even where the organiser schema assigns status OK.",
}
evidence = project / "work" / "validation"
if (evidence / "corpus-report.json").exists():
    corpus = json.loads((evidence / "corpus-report.json").read_text(encoding="utf-8"))
    report["challenge_sets"] = [{"name": d["name"], "emails": d["score"]["n_emails"], "classification_accuracy": d["score"]["stage1"]["accuracy"], "exact_defect_catch": d["score"]["end_to_end"], "output_differences": len(d["differences"]), "false_clearances": len(d["false_clearances"])} for d in corpus["datasets"]]
    report["challenge_limitations"] = "All synthetic sets were used during development. Same generator, not an independent real-world or novel-template holdout."
if (evidence / "unit-tests.log").exists():
    log = (evidence / "unit-tests.log").read_text(encoding="utf-8")
    count = re.search(r"tests (\d+)", log)
    report["engineering"] = {"regression_tests": int(count[1]) if count else None, "unit_suite_passed": bool(re.search(r"fail 0\b", log)), "pipeline": "2.0.0"}
if (evidence / "ablation.json").exists():
    report["routing_ablation"] = json.loads((evidence / "ablation.json").read_text(encoding="utf-8"))
(project / "public" / "validation.json").write_text(json.dumps(report, indent=2))
print(json.dumps(score, indent=2))
print("DIFFERENCES", len(diff))
print(json.dumps(diff[:16], indent=2))
