import data from "@/data/bundle.json";
import type { Email } from "./types";
export const emails: Email[] = data.emails;
export const bundleBytes = (path: string): Uint8Array | null => {
  const value = (data.attachments as Record<string, string>)[path];
  return value ? Uint8Array.from(atob(value), (c) => c.charCodeAt(0)) : null;
};
