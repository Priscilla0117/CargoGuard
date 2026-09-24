import { z } from "zod";
import { HttpError } from "./http";

export interface MicrosoftConfig {
  tenant: string;
  client: string;
  secret: string;
  redirect: string;
  origin: string;
  key: string;
  allowSend: boolean;
}
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requiredSettings = [
  "CARGO_MS_TENANT_ID",
  "CARGO_MS_CLIENT_ID",
  "CARGO_MS_CLIENT_SECRET",
  "CARGO_MS_REDIRECT_URI",
  "CARGO_MS_TOKEN_KEY",
  "CARGO_PUBLIC_ORIGIN",
] as const;
export function microsoftConfiguration(
  env: Record<string, string | undefined> = process.env,
): { configured: boolean; missing: string[]; config?: MicrosoftConfig } {
  const missing = requiredSettings.filter((name) => !env[name]);
  if (missing.length) return { configured: false, missing };
  try {
    const origin = new URL(env.CARGO_PUBLIC_ORIGIN!);
    const redirect = new URL(env.CARGO_MS_REDIRECT_URI!);
    const local = ["localhost", "127.0.0.1"].includes(origin.hostname);
    if (
      (!local && origin.protocol !== "https:") ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      redirect.origin !== origin.origin ||
      redirect.pathname !== "/api/microsoft/callback" ||
      redirect.search ||
      redirect.hash ||
      redirect.username ||
      redirect.password ||
      !guid.test(env.CARGO_MS_TENANT_ID!) ||
      !guid.test(env.CARGO_MS_CLIENT_ID!) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(env.CARGO_MS_TOKEN_KEY!) ||
      atob(env.CARGO_MS_TOKEN_KEY!).length !== 32 ||
      env.CARGO_MS_CLIENT_SECRET!.length < 8
    )
      throw new Error("Invalid connector configuration");
    return {
      configured: true,
      missing: [],
      config: {
        tenant: env.CARGO_MS_TENANT_ID!,
        client: env.CARGO_MS_CLIENT_ID!,
        secret: env.CARGO_MS_CLIENT_SECRET!,
        redirect: redirect.href,
        origin: origin.origin,
        key: env.CARGO_MS_TOKEN_KEY!,
        allowSend: env.CARGO_MS_ALLOW_SEND === "true",
      },
    };
  } catch {
    return {
      configured: false,
      missing: ["Valid Microsoft connector configuration"],
    };
  }
}
export function requireMicrosoftConfig() {
  const result = microsoftConfiguration();
  if (!result.config)
    throw new HttpError(
      "Microsoft integration is not configured. Ask an administrator to complete tenant and application setup.",
      503,
    );
  return result.config;
}
export const microsoftScopes = (config: MicrosoftConfig) =>
  [
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.ReadWrite",
    ...(config.allowSend ? ["https://graph.microsoft.com/Mail.Send"] : []),
  ].join(" ");
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
export const microsoftRandom = () =>
  base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function microsoftHash(value: string) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
function decode(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
}
async function encryptionKey(config: MicrosoftConfig) {
  return crypto.subtle.importKey("raw", decode(config.key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptMicrosoftSecret(
  config: MicrosoftConfig,
  value: string,
  binding: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(binding) },
    await encryptionKey(config),
    new TextEncoder().encode(value),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
export async function decryptMicrosoftSecret(
  config: MicrosoftConfig,
  value: string,
  binding: string,
) {
  try {
    const [version, iv, ciphertext, extra] = value.split(".");
    if (version !== "v1" || extra || decode(iv).length !== 12)
      throw new Error("Invalid cipher");
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: new TextEncoder().encode(binding),
      },
      await encryptionKey(config),
      decode(ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    throw new HttpError(
      "Microsoft connection credentials cannot be read. Reconnect the account.",
      409,
    );
  }
}

export type MicrosoftFetch = typeof fetch;
export class MicrosoftProviderError extends HttpError {
  constructor(readonly uncertain: boolean) {
    super(
      uncertain
        ? "Microsoft did not confirm the operation. Check the mailbox before retrying; no automatic retry was attempted."
        : "Microsoft rejected the request. Check connection permissions and reconnect if needed.",
      uncertain ? 503 : 502,
    );
  }
}
export async function boundedMicrosoftJson(
  response: Response,
  limit = 128 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new MicrosoftProviderError(true);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) return null;
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    all.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
  } catch {
    throw new MicrosoftProviderError(true);
  }
}
/** Fixed host, narrow /me paths, no redirects, provider bodies never become diagnostics. */
export async function microsoftGraph(
  accessToken: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; limit?: number } = {},
  fetcher: MicrosoftFetch = fetch,
) {
  if (/[\r\n#\\]/.test(path) || /%5c|%2e/i.test(path.split("?")[0]))
    throw new HttpError("Unsupported Microsoft Graph operation.", 400);
  const target = new URL(`https://graph.microsoft.com/v1.0${path}`);
  if (
    target.origin !== "https://graph.microsoft.com" ||
    !/^\/v1\.0\/me(?:\/messages(?:\/[A-Za-z0-9_%=-]+(?:\/send|\/attachments(?:\/[A-Za-z0-9_%=-]+)?)?)?)?$/.test(
      target.pathname,
    ) ||
    [...target.searchParams.keys()].some(
      (key) => !["$select", "$top"].includes(key),
    )
  )
    throw new HttpError("Unsupported Microsoft Graph destination.", 400);
  let response: Response;
  try {
    response = await fetcher(target.href, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"',
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new MicrosoftProviderError(true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MicrosoftProviderError(
      response.status >= 500 || response.status === 429,
    );
  }
  return boundedMicrosoftJson(response, options.limit);
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(30000),
  refresh_token: z.string().min(1).max(30000).optional(),
  expires_in: z.number().int().min(60).max(86400),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  scope: z.string().max(4000).optional(),
});
export interface MicrosoftTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}
export async function exchangeMicrosoftToken(
  config: MicrosoftConfig,
  input: { code: string; verifier: string } | { refresh: string },
  fetcher: MicrosoftFetch = fetch,
): Promise<MicrosoftTokens> {
  const params = new URLSearchParams({
    client_id: config.client,
    client_secret: config.secret,
    scope: microsoftScopes(config),
    ...("code" in input
      ? {
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: config.redirect,
          code_verifier: input.verifier,
        }
      : { grant_type: "refresh_token", refresh_token: input.refresh }),
  });
  let response: Response;
  try {
    response = await fetcher(
      `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch {
    throw new MicrosoftProviderError(true);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MicrosoftProviderError(false);
  }
  const parsed = tokenSchema.safeParse(await boundedMicrosoftJson(response));
  if (!parsed.success) throw new MicrosoftProviderError(false);
  const token = parsed.data,
    refresh = token.refresh_token ?? ("refresh" in input ? input.refresh : "");
  if (!refresh) throw new MicrosoftProviderError(false);
  return {
    access_token: token.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + token.expires_in * 1000,
    scope: token.scope ?? "",
  };
}
export const graphIdentifier = z
  .string()
  .min(1)
  .max(1000)
  .regex(/^[A-Za-z0-9_+=/-]+$/);
export function graphMessagePath(id: string) {
  return `/me/messages/${encodeURIComponent(graphIdentifier.parse(id))}`;
}
export const microsoftRecipient = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
