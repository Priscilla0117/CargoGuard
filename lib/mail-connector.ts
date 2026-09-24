import { z } from "zod";
import { HttpError } from "./http";

/**
 * Mailbox connector for Gmail (Google sign-in) and IMAP app-password login.
 * Tokens and passwords are AES-GCM encrypted and bound to one workspace user.
 * Email content is imported as untrusted evidence; nothing is sent without an
 * explicit, confirmed employee action.
 */
export type MailProvider = "gmail" | "imap";
export const IMAP_PRESETS = {
  gmail: {
    label: "Gmail / Google Workspace",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    help: "Use a Google App Password (Google Account → Security → 2-Step Verification → App passwords).",
  },
  outlook: {
    label: "Outlook.com / Microsoft 365",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    help: "Requires IMAP and an app password to be allowed by your administrator.",
  },
  yahoo: {
    label: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    help: "Generate an app password in Yahoo Account Security.",
  },
} as const;
export type ImapPreset = keyof typeof IMAP_PRESETS | "custom";

export interface MailConfig {
  key: string;
  origin: string | null;
  google: { client: string; secret: string; redirect: string } | null;
  imap: boolean;
  custom: {
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  } | null;
  allowSend: boolean;
}

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
let generatedKey: string | undefined;

/** Local demo convenience: persist a random key under work/ (git-ignored). */
async function localDevelopmentKey(env: Record<string, string | undefined>) {
  if (generatedKey) return generatedKey;
  if (
    (env.CARGO_AUTH_MODE ?? "demo") !== "demo" ||
    !env.CARGO_LOCAL_DB ||
    env.RENDER ||
    env.TURSO_DATABASE_URL
  )
    return undefined;
  try {
    const fs = await import("node:fs/promises");
    const path = "work/.mail-token-key";
    const existing = await fs.readFile(path, "utf8").catch(() => "");
    if (KEY_PATTERN.test(existing.trim()))
      return (generatedKey = existing.trim());
    const value = btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    );
    await fs.mkdir("work", { recursive: true });
    await fs.writeFile(path, value, { mode: 0o600 });
    return (generatedKey = value);
  } catch {
    return undefined;
  }
}

export async function mailConfiguration(
  env: Record<string, string | undefined> = process.env,
): Promise<{ configured: boolean; missing: string[]; config?: MailConfig }> {
  const key =
    env.CARGO_MAIL_TOKEN_KEY?.trim() || (await localDevelopmentKey(env));
  if (!key || !KEY_PATTERN.test(key) || atob(key).length !== 32)
    return {
      configured: false,
      missing: [
        "CARGO_MAIL_TOKEN_KEY (base64-encoded random 32-byte key for encrypting mailbox credentials)",
      ],
    };
  let origin: string | null = null;
  try {
    origin = env.CARGO_PUBLIC_ORIGIN
      ? new URL(env.CARGO_PUBLIC_ORIGIN).origin
      : null;
  } catch {
    origin = null;
  }
  const google =
    env.CARGO_GOOGLE_CLIENT_ID?.trim() &&
    env.CARGO_GOOGLE_CLIENT_SECRET?.trim() &&
    origin
      ? {
          client: env.CARGO_GOOGLE_CLIENT_ID.trim(),
          secret: env.CARGO_GOOGLE_CLIENT_SECRET.trim(),
          redirect: `${origin}/api/mail/callback`,
        }
      : null;
  let custom: MailConfig["custom"] = null;
  if (env.CARGO_MAIL_IMAP_HOST && env.CARGO_MAIL_SMTP_HOST) {
    const host = /^[a-z0-9.-]{3,253}$/i;
    if (
      host.test(env.CARGO_MAIL_IMAP_HOST) &&
      host.test(env.CARGO_MAIL_SMTP_HOST)
    )
      custom = {
        imap: {
          host: env.CARGO_MAIL_IMAP_HOST,
          port: Number(env.CARGO_MAIL_IMAP_PORT ?? 993) || 993,
          secure: env.CARGO_MAIL_IMAP_SECURE !== "false",
        },
        smtp: {
          host: env.CARGO_MAIL_SMTP_HOST,
          port: Number(env.CARGO_MAIL_SMTP_PORT ?? 465) || 465,
          secure: env.CARGO_MAIL_SMTP_SECURE !== "false",
        },
      };
  }
  return {
    configured: true,
    missing: [],
    config: {
      key,
      origin,
      google,
      imap: env.CARGO_MAIL_IMAP_ENABLED !== "false",
      custom,
      allowSend: env.CARGO_MAIL_ALLOW_SEND !== "false",
    },
  };
}

export function base64url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export function fromBase64url(value: string) {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(normal + "=".repeat((4 - (normal.length % 4)) % 4)),
    (char) => char.charCodeAt(0),
  );
}
export const randomToken = () =>
  base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(value: string) {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
async function aesKey(config: MailConfig) {
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(config.key), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function sealSecret(
  config: MailConfig,
  value: string,
  binding: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(binding) },
    await aesKey(config),
    new TextEncoder().encode(value),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function openSecret(
  config: MailConfig,
  value: string,
  binding: string,
) {
  try {
    const [version, iv, cipher, extra] = value.split(".");
    if (version !== "v1" || extra) throw new Error("format");
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64url(iv),
        additionalData: new TextEncoder().encode(binding),
      },
      await aesKey(config),
      fromBase64url(cipher),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    throw new HttpError(
      "Saved mailbox credentials cannot be read. Disconnect and connect the mailbox again.",
      409,
    );
  }
}

export const mailSettingsSchema = z
  .object({
    auto_sync: z.boolean(),
    /** Minutes between automatic checks while CargoGuard is open. */
    interval_minutes: z.number().int().min(2).max(120),
    /** Only import mail received within this many days. */
    days: z.number().int().min(1).max(60),
    max_per_sync: z.number().int().min(1).max(25),
    /** Gmail search words, for example "has:attachment" or "label:shipping". */
    gmail_query: z
      .string()
      .trim()
      .max(300)
      .refine((value) => !/[\r\n]/.test(value)),
    mailbox: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !/[\r\n"\\]/.test(value)),
  })
  .strict();
export type MailSettings = z.infer<typeof mailSettingsSchema>;
export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  auto_sync: true,
  interval_minutes: 5,
  days: 7,
  max_per_sync: 10,
  gmail_query: "-category:promotions -category:social",
  mailbox: "INBOX",
};
