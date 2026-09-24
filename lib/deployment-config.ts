import { workspaceConfiguration } from "./workspace-mode";

export class DeploymentConfigurationError extends Error {}

/** Validate before opening a database or serving requests. Never echo secrets. */
export function deploymentConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  let workspace;
  try {
    workspace = workspaceConfiguration(env);
  } catch {
    throw new DeploymentConfigurationError(
      "Check CARGO_AUTH_MODE, CARGO_INCLUDE_SAMPLE_DATA and CARGO_MAX_WORKSPACE_UPLOADS.",
    );
  }
  const remote = env.TURSO_DATABASE_URL?.trim() || undefined;
  if (remote) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new DeploymentConfigurationError("TURSO_DATABASE_URL is invalid.");
    }
    if (
      !["libsql:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new DeploymentConfigurationError(
        "TURSO_DATABASE_URL must be a libsql:// or https:// endpoint without embedded credentials or query parameters.",
      );
    if (!env.TURSO_AUTH_TOKEN?.trim())
      throw new DeploymentConfigurationError(
        "Set TURSO_AUTH_TOKEN for the persistent database.",
      );
  } else if (env.RENDER || !env.CARGO_LOCAL_DB?.trim()) {
    throw new DeploymentConfigurationError(
      "Set a persistent Turso database; local development requires an explicit CARGO_LOCAL_DB file.",
    );
  } else if (/:memory:|[?#\x00]/i.test(env.CARGO_LOCAL_DB)) {
    throw new DeploymentConfigurationError(
      "CARGO_LOCAL_DB must be a persistent file path.",
    );
  }
  const port = env.PORT ?? "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new DeploymentConfigurationError(
      "PORT must be an integer from 1 to 65535.",
    );
  const rawOrigin = env.CARGO_PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL;
  let origin: string | null = null;
  if (workspace.mode === "team" || rawOrigin !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(rawOrigin ?? "");
    } catch {
      throw new DeploymentConfigurationError(
        "Set CARGO_PUBLIC_ORIGIN to the public HTTPS origin for team access.",
      );
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      parsed.hostname,
    );
    if (
      !(
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" && loopback)
      ) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new DeploymentConfigurationError(
        "CARGO_PUBLIC_ORIGIN must be an HTTPS origin without a path; HTTP is allowed only on loopback for local tests.",
      );
    origin = parsed.origin;
  }
  return { ...workspace, origin, remote: !!remote };
}

export function requireBootstrapConfiguration(
  initialized: boolean,
  env: Record<string, string | undefined> = process.env,
) {
  if (
    env.CARGO_AUTH_MODE === "team" &&
    !initialized &&
    (env.CARGO_BOOTSTRAP_SECRET?.length ?? 0) < 32
  )
    throw new DeploymentConfigurationError(
      "An uninitialized team requires CARGO_BOOTSTRAP_SECRET with at least 32 random characters. Remove it after the first administrator is created.",
    );
}
