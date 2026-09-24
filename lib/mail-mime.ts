/** Minimal, standards-compliant RFC 5322 builder for plain-text replies. */
export interface OutgoingMessage {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  in_reply_to?: string;
  references?: string[];
}

function encodeWord(value: string) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}
function wrapBase64(value: string) {
  return value.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}
const header = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const angle = (id: string) => `<${id.replace(/[<>\s]/g, "")}>`;

export function buildRawMessage(message: OutgoingMessage, now = new Date()) {
  const domain =
    message.from.split("@")[1]?.replace(/[^a-z0-9.-]/gi, "") ||
    "cargoguard.local";
  const id = `${crypto.randomUUID()}@${domain}`;
  const bytes = new TextEncoder().encode(
    message.body.replace(/\r?\n/g, "\r\n"),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const lines = [
    `From: ${header(message.from)}`,
    `To: ${message.to.map(header).join(", ")}`,
    ...(message.cc.length ? [`Cc: ${message.cc.map(header).join(", ")}`] : []),
    `Subject: ${encodeWord(header(message.subject))}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}>`,
    ...(message.in_reply_to
      ? [`In-Reply-To: ${angle(message.in_reply_to)}`]
      : []),
    ...(message.references?.length
      ? [`References: ${message.references.slice(-20).map(angle).join(" ")}`]
      : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Mailer: CargoGuard",
    "",
    wrapBase64(btoa(binary)),
    "",
  ];
  return { raw: lines.join("\r\n"), message_id: id };
}
