import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { HttpError } from "./http";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
export function gmailConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const origin = env.CARGO_PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL ?? "";
  const key = env.CARGO_GMAIL_ENCRYPTION_KEY ?? "";
  const enabled =
    env.CARGO_GMAIL_ENABLED === "true" &&
    !!env.GOOGLE_CLIENT_ID &&
    !!env.GOOGLE_CLIENT_SECRET &&
    /^[a-f0-9-]{36}$/.test(env.CARGO_GMAIL_PILOT_WORKSPACE ?? "") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.CARGO_GMAIL_PILOT_EMAIL ?? "") &&
    Buffer.from(key, "base64").length === 32 &&
    /^https:\/\/[^/?#]+$|^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(
      origin,
    );
  return {
    enabled,
    origin,
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: `${origin}/api/gmail/callback`,
    key,
    workspace: env.CARGO_GMAIL_PILOT_WORKSPACE ?? "",
    email: (env.CARGO_GMAIL_PILOT_EMAIL ?? "").toLowerCase(),
  };
}
/** Deliberately fail closed until the application-auth teammate supplies a durable ownership contract.
 * This explicit, one-workspace/one-mailbox pilot is never enabled for every anonymous visitor.
 */
export function requireGmailOwner(
  workspace: string,
  env: Record<string, string | undefined> = process.env,
) {
  const config = gmailConfig(env);
  if (!config.enabled || config.workspace !== workspace)
    throw new HttpError(
      "Gmail is not enabled for this workspace. The owner must configure the mailbox pilot.",
      403,
    );
  return config;
}
export const gmailHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function sealGmail(
  value: unknown,
  workspace: string,
  key = gmailConfig().key,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(Buffer.from(workspace));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}
export function openGmail<T>(
  value: string,
  workspace: string,
  key = gmailConfig().key,
): T {
  const [iv, tag, bytes] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64"),
    iv,
  );
  decipher.setAAD(Buffer.from(workspace));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8"),
  ) as T;
}
