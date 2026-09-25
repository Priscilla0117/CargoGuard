import { HttpError } from "./http";

/** Runtime workspace policy; organiser fixtures are opt-in for employee teams. */
export function workspaceConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const mode = env.CARGO_AUTH_MODE ?? "demo";
  if (mode !== "demo" && mode !== "team")
    throw new HttpError("Authentication configuration is unavailable.", 503);
  const samples = env.CARGO_INCLUDE_SAMPLE_DATA;
  if (samples !== undefined && samples !== "true" && samples !== "false")
    throw new HttpError(
      "Sample-data configuration must be true or false.",
      503,
    );
  const rawLimit = env.CARGO_MAX_WORKSPACE_UPLOADS;
  const limit =
    rawLimit === undefined ? (mode === "team" ? 1000 : 30) : Number(rawLimit);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10000 ||
    (rawLimit !== undefined && !/^\d+$/.test(rawLimit))
  )
    throw new HttpError(
      "Workspace upload limit must be an integer from 1 to 10000.",
      503,
    );
  return {
    mode,
    sample_data: samples === undefined ? mode === "demo" : samples === "true",
    upload_limit: limit,
  };
}

export const includeSampleData = () => workspaceConfiguration().sample_data;
export const workspaceUploadLimit = () => workspaceConfiguration().upload_limit;
