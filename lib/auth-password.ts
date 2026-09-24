import { HttpError } from "./http";
import { randomToken } from "./auth";

const ITERATIONS = 600000;
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
const unhex = (text: string) =>
  new Uint8Array(text.match(/../g)!.map((n) => parseInt(n, 16)));
export function validPassword(password: string) {
  if (password.length < 15 || password.length > 128)
    throw new HttpError(
      "Use a password or passphrase between 15 and 128 characters.",
    );
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: ITERATIONS,
        salt: unhex(salt),
      },
      key,
      256,
    ),
  );
}
export async function hashPassword(password: string) {
  validPassword(password);
  const salt = randomToken();
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${await derive(password, salt)}`;
}
export function constantEqual(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export async function verifyPassword(password: string, encoded: string | null) {
  // Missing accounts incur the same expensive derivation as a real account.
  const parts = encoded?.match(
    /^pbkdf2-sha256\$600000\$([a-f0-9]{64})\$([a-f0-9]{64})$/,
  );
  const actual = await derive(
    password.slice(0, 128),
    parts?.[1] ?? "0".repeat(64),
  );
  return !!parts && password.length <= 128 && constantEqual(actual, parts[2]);
}
