import { HttpError } from "./http";
import { PIPELINE_VERSION, type CaseResult } from "./types";

/** Manual review must not relabel old parser output as a current-engine check. */
export function requireCurrentEngine(
  result: Pick<CaseResult, "pipeline_version">,
) {
  if (result.pipeline_version !== PIPELINE_VERSION)
    throw new HttpError(
      "This case uses an older verification engine. Run inbox to recheck its original documents before reviewing or confirming evidence.",
      409,
    );
}
