/**
 * Email intelligence that needs no external AI: shipment references, thread
 * grouping, mentioned deadlines and urgency wording. Everything here is
 * deterministic and explainable so an employee can see WHY two emails were
 * grouped or WHY a case is ranked first.
 */

export interface EmailRefs {
  /** Averis order / shipment numbers such as 5RFR-36541. */
  shipment: string[];
  po: string[];
  invoice: string[];
  /** Booking or bill of lading numbers such as SIJ4216073, MEDUUD104332. */
  booking: string[];
  container: string[];
}
export type DeadlineKind =
  | "Cut-off"
  | "ETD"
  | "ETA"
  | "Due"
  | "Deadline"
  | "Payment"
  | "Mentioned";
export interface MentionedDate {
  kind: DeadlineKind;
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  /** Short excerpt that shows where the date came from. */
  text: string;
}
export interface EmailInsight {
  refs: EmailRefs;
  dates: MentionedDate[];
  urgent_terms: string[];
  snippet: string;
  sender_name: string;
}

const SHIPMENT = /\b\d[A-Z]{3}-\d{5}\b/g;
const PO =
  /\bP\.?\s?O\.?(?:\s*(?:no\.?|number|#))?[\s_:#-]*(\d{2}[_-]\d{3,5}|\d{4,10})\b/gi;
const INVOICE_WORD =
  /\b(?:invoice|inv|debit note|credit note)(?:\s*(?:no\.?|number|#))?[\s_:#-]*([A-Z]{0,3}\d{6,12})\b/gi;
const INVOICE_NUMBER = /\b525\d{7}\b/g;
const BOOKING =
  /\b(?:SIJ|SINF|SIN|MEDU[A-Z]{0,2}|OOLU|YMJA[A-Z]?|EGLV|MCLSIN|COSU|HLCU|MAEU|CMDU|ONEY|HDMU|ZIMU|EISU|WHLC|KMTC|SMLM)[A-Z0-9]{5,14}\b/g;
const BOOKING_WORD =
  /\b(?:booking|bkg|b\/l|bl)(?:\s*(?:no\.?|number|#))?[\s:#-]+([A-Z]{2,6}\d{6,12})\b/gi;
const CONTAINER = /\b[A-Z]{3}[UJZ]\d{7}\b/g;

function unique(values: Iterable<string>) {
  return [...new Set(values)];
}
function all(text: string, pattern: RegExp, group = 0) {
  return unique(
    [...text.matchAll(pattern)].map((m) =>
      (m[group] ?? "").toUpperCase().replace(/[\s]+/g, ""),
    ),
  ).filter(Boolean);
}

/** Remove quoted history so urgency and dates reflect the newest message. */
export function latestMessagePart(body: string) {
  const markers = [
    /^_{8,}\s*$/m,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^From:\s.+$/m,
    /^On .{6,120} wrote:\s*$/m,
    /^>+/m,
  ];
  let end = body.length;
  for (const marker of markers) {
    const match = marker.exec(body);
    if (match && match.index > 0 && match.index < end) end = match.index;
  }
  return body.slice(0, end);
}

export function extractReferences(subject: string, body = ""): EmailRefs {
  const text = `${subject}\n${body}`.replace(/ /g, " ");
  const po = all(text, PO, 1).map((value) => value.replace(/-/g, "_"));
  const invoice = unique([
    ...all(text, INVOICE_WORD, 1),
    ...all(text, INVOICE_NUMBER),
  ]).filter((value) => !po.includes(value));
  const container = all(text, CONTAINER);
  const booking = unique([
    ...all(text, BOOKING),
    ...all(text, BOOKING_WORD, 1),
  ]).filter(
    (value) =>
      /\d{5,}/.test(value) &&
      !container.includes(value) &&
      !invoice.includes(value),
  );
  return {
    shipment: all(text, SHIPMENT),
    po,
    invoice,
    booking,
    container,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
function isoDate(year: number, month: number, day: number) {
  if (year < 100) year += 2000;
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  )
    return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}
const MONTH_NAME =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS: {
  pattern: RegExp;
  read: (m: RegExpExecArray, base: Date) => string | null;
}[] = [
  {
    // 2026-01-26
    pattern: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g,
    read: (m) => isoDate(+m[1], +m[2], +m[3]),
  },
  {
    // 26-Jan-26, 26 Jan 2026, 26th January
    pattern: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s_/-]+${MONTH_NAME}\\.?(?:[\\s_/,-]+(\\d{4}|\\d{2}))?\\b`,
      "gi",
    ),
    read: (m, base) =>
      isoDate(
        m[3] ? +m[3] : base.getUTCFullYear(),
        MONTHS[m[2].slice(0, 3).toLowerCase()],
        +m[1],
      ),
  },
  {
    // January 23, 2026 / Jan 23
    pattern: new RegExp(
      `\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
      "gi",
    ),
    read: (m, base) =>
      isoDate(
        m[3] ? +m[3] : base.getUTCFullYear(),
        MONTHS[m[1].slice(0, 3).toLowerCase()],
        +m[2],
      ),
  },
  {
    // 26/01/2026, 26.01.2026, 15_01_2026 (day first: Averis is in MY/UAE)
    pattern: /\b(\d{1,2})([/._-])(\d{1,2})\2(\d{4}|\d{2})\b/g,
    read: (m) => isoDate(+m[4], +m[3], +m[1]),
  },
];
const CONTEXT: [RegExp, DeadlineKind][] = [
  [/(?:cut[\s-]?off|closing|cy close|si close|vgm)/i, "Cut-off"],
  [/\b(?:etd|departure|sailing|sail)\b/i, "ETD"],
  [/\b(?:eta|arrival|arrive)\b/i, "ETA"],
  [/\b(?:payment|pay|remit)\b/i, "Payment"],
  [/\b(?:deadline|latest by|no later than)\b/i, "Deadline"],
  [/\b(?:due|by|before|until|submit|reply)\b/i, "Due"],
];

/** Dates mentioned in the newest part of the email, with their likely meaning. */
export function mentionedDates(
  text: string,
  base: Date = new Date(),
  relativeWords = true,
): MentionedDate[] {
  const found = new Map<string, MentionedDate>();
  for (const { pattern, read } of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const date = read(m, base);
      if (!date) continue;
      const before = text.slice(Math.max(0, m.index - 40), m.index);
      // The keyword closest to the date decides what the date means.
      let kind: DeadlineKind = "Mentioned";
      let closest = -1;
      for (const [words, label] of CONTEXT) {
        const global = new RegExp(words.source, "gi");
        for (const hit of before.matchAll(global))
          if ((hit.index ?? -1) > closest) {
            closest = hit.index ?? -1;
            kind = label;
          }
      }
      const excerpt = text
        .slice(Math.max(0, m.index - 30), m.index + m[0].length + 10)
        .replace(/\s+/g, " ")
        .trim();
      const key = `${kind}:${date}`;
      if (!found.has(key)) found.set(key, { kind, date, text: excerpt });
    }
  }
  // Relative wording is resolved against the email's own date.
  const relative: [RegExp, number][] = [
    [/\b(?:today|by eod|end of (?:the )?day|by cob|close of business)\b/i, 0],
    [/\btomorrow\b/i, 1],
  ];
  for (const [pattern, offset] of relativeWords ? relative : []) {
    const m = pattern.exec(text);
    if (!m) continue;
    const day = new Date(base.getTime() + offset * 86400000)
      .toISOString()
      .slice(0, 10);
    const key = `Due:${day}`;
    if (!found.has(key))
      found.set(key, {
        kind: "Due",
        date: day,
        text: text
          .slice(Math.max(0, m.index - 30), m.index + m[0].length + 10)
          .replace(/\s+/g, " ")
          .trim(),
      });
  }
  return [...found.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
}

const URGENT_TERMS: [RegExp, string][] = [
  [/\burgent(?:ly)?\b/i, "urgent"],
  [/\basap\b|as soon as possible/i, "ASAP"],
  [/\bimmediate(?:ly)?\b/i, "immediately"],
  [
    /\bfinal reminder\b|\b2nd reminder\b|\bsecond reminder\b/i,
    "final reminder",
  ],
  [/\breminder\b/i, "reminder"],
  [/\bcut[\s-]?off\b/i, "cut-off"],
  [/\bdeadline\b/i, "deadline"],
  [/\boverdue\b|\bpast due\b/i, "overdue"],
  [
    /\broll(?:ed|ing)?\s+(?:over|to next)\b|\bshort[\s-]?shipped\b/i,
    "risk of rollover",
  ],
  [
    /\bdemurrage\b|\bdetention\b|\bstorage charges?\b/i,
    "demurrage / detention",
  ],
  [/\bon hold\b|\bhold the (?:cargo|shipment|bl)\b/i, "on hold"],
  [/\btelex release\b|\bsurrender(?:ed)? bl\b/i, "release requested"],
  [/\bamend(?:ment)?\b|\bcorrection\b|\brevise[d]?\b/i, "amendment"],
  [/\btoday\b|\bby eod\b|\bend of (?:the )?day\b/i, "today"],
];
export function urgentTerms(text: string) {
  return URGENT_TERMS.filter(([pattern]) => pattern.test(text)).map(
    ([, label]) => label,
  );
}

export function senderName(from: string, text = "") {
  const body = text.replace(/\r\n?/g, "\n");
  const display = from.match(/^\s*"?([^"<]{2,60}?)"?\s*</)?.[1];
  if (display) return display.trim();
  // Signature lines such as "Best Regards,\nWilly Situmorang"
  const signature = body.match(
    /(?:regards|thanks|thank you|cheers|sincerely)[,!.]?[ \t]*\n+[ \t]*([A-Z][A-Za-z.'-]+(?:[ \t]+[A-Z][A-Za-z.'-]+){0,3})[ \t]*(?:\r?\n|$)/i,
  )?.[1];
  if (signature) return signature.trim();
  const local = from.split("@")[0] ?? from;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function emailSnippet(body: string, length = 160) {
  let text = latestMessagePart(body.replace(/\r\n?/g, "\n"));
  // Drop greetings and external-mail banners, in whatever order they appear.
  for (let i = 0; i < 3; i++)
    text = text
      .replace(
        /^\s*(?:hi|hello|dear|good (?:morning|afternoon|day))\b[^\n]*\n/i,
        "",
      )
      .replace(
        /^\s*(?:WARNING|CAUTION|EXTERNAL(?: EMAIL)?)\s*[:!-][^\n]*\n/i,
        "",
      );
  text = text.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function emailInsight(email: {
  from: string;
  subject: string;
  body?: string;
  received_at?: string;
}): EmailInsight {
  const body = (email.body ?? "").replace(/\r\n?/g, "\n");
  const latest = latestMessagePart(body);
  const parsed = email.received_at ? new Date(email.received_at) : null;
  const received = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  const base = received ?? new Date();
  const refs = extractReferences(email.subject, body);
  return {
    refs,
    // "today"/"tomorrow" only mean something when the email's date is known.
    dates: mentionedDates(`${email.subject}\n${latest}`, base, !!received),
    urgent_terms: urgentTerms(`${email.subject}\n${latest}`),
    snippet: emailSnippet(body),
    sender_name: senderName(email.from, latest),
  };
}

/** Subject without reply/forward prefixes, separators or case differences. */
export function normalizeSubject(subject: string) {
  let value = subject;
  for (let i = 0; i < 6; i++) {
    const next = value.replace(
      /^\s*(?:re|fw|fwd|aw|wg|tr|sv|vs|antw)\s*(?:\[\d+\])?\s*[:_]\s*/i,
      "",
    );
    if (next === value) break;
    value = next;
  }
  return value
    .replace(/^\s*\[(?:external|ext)\]\s*/i, "")
    .replace(/[_\s]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim()
    .toLowerCase();
}

export interface ThreadInput {
  id: string;
  subject: string;
  refs?: EmailRefs;
  message_id?: string;
  in_reply_to?: string;
  references?: string[];
  thread_hint?: string;
  excluded?: boolean;
}
export interface ThreadInfo {
  key: string;
  /** Human-readable reason the emails are grouped. */
  label: string;
  ids: string[];
}

/**
 * Groups related emails. Links, strongest first:
 *  1. Mail headers (Message-ID / In-Reply-To / References) and provider thread ids
 *  2. The same Averis shipment number in the subject (e.g. 5RFR-36541)
 *  3. The same shipment number in the body when it is the only one mentioned
 *  4. Identical normalised subjects that carry no reference at all
 */
export function groupThreads(items: ThreadInput[]): Map<string, ThreadInfo> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let node = id;
    while (parent.get(node) !== root) {
      const next = parent.get(node)!;
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const byKey = new Map<string, string>();
  const link = (id: string, key: string) => {
    const first = byKey.get(key);
    if (first) union(first, id);
    else byKey.set(key, id);
  };
  const usable = items.filter((item) => !item.excluded);
  for (const item of usable) parent.set(item.id, item.id);
  for (const item of usable) {
    const ids = [item.message_id, item.in_reply_to, ...(item.references ?? [])]
      .filter((value): value is string => !!value)
      .map((value) => value.trim().toLowerCase());
    for (const value of ids) link(item.id, `mid:${value}`);
    if (item.thread_hint) link(item.id, `hint:${item.thread_hint}`);
    const subjectRefs = [...item.subject.matchAll(SHIPMENT)].map((m) => m[0]);
    const refs = subjectRefs.length
      ? unique(subjectRefs)
      : item.refs?.shipment.length === 1
        ? item.refs.shipment
        : [];
    for (const ref of refs) link(item.id, `ref:${ref}`);
    if (!refs.length && !item.refs?.po.length && !item.refs?.invoice.length) {
      const normalized = normalizeSubject(item.subject);
      if (normalized.length >= 12) link(item.id, `subj:${normalized}`);
    }
  }
  const groups = new Map<string, string[]>();
  for (const item of usable) {
    const root = find(item.id);
    groups.set(root, [...(groups.get(root) ?? []), item.id]);
  }
  const result = new Map<string, ThreadInfo>();
  for (const [root, ids] of groups) {
    if (ids.length < 2) continue;
    const member = usable.find((item) => item.id === root)!;
    const ref =
      [...member.subject.matchAll(SHIPMENT)][0]?.[0] ??
      (member.refs?.shipment.length === 1 ? member.refs.shipment[0] : "");
    const info: ThreadInfo = {
      key: root,
      label: ref ? `Shipment ${ref}` : "Same conversation",
      ids: ids.sort(),
    };
    for (const id of ids) result.set(id, info);
  }
  return result;
}

export interface QuotedMessage {
  from: string;
  sent?: string;
  sent_text: string;
  subject: string;
  text: string;
}
const HEADER_BLOCK =
  /^[ \t>]*From:[ \t]*(.+)\r?\n(?:[ \t>]*(?:To|Cc):.*\r?\n)*[ \t>]*(?:Sent|Date):[ \t]*(.+)\r?\n(?:[ \t>]*(?:To|Cc):.*\r?\n)*(?:[ \t>]*Subject:[ \t]*(.*)\r?\n)?/gim;

/**
 * Earlier messages quoted inside one email ("From: … Sent: … Subject: …"
 * blocks, as Outlook and Gmail forward them). Newest first, as written.
 */
export function quotedHistory(body: string): QuotedMessage[] {
  const blocks: {
    index: number;
    end: number;
    from: string;
    sent: string;
    subject: string;
  }[] = [];
  HEADER_BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADER_BLOCK.exec(body)))
    blocks.push({
      index: match.index,
      end: match.index + match[0].length,
      from: match[1].trim(),
      sent: match[2].trim(),
      subject: (match[3] ?? "").trim(),
    });
  return blocks.slice(0, 30).map((block, i) => {
    const next = blocks[i + 1]?.index ?? body.length;
    const date = new Date(block.sent.replace(/\s+at\s+/i, " "));
    return {
      from:
        block.from
          .replace(/\s*<[^>]*>/, "")
          .replace(/"/g, "")
          .trim() || block.from,
      sent: Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
      sent_text: block.sent,
      subject: block.subject,
      text: body
        .slice(block.end, next)
        .replace(/^[ \t>]*_{5,}[ \t]*$/gm, "")
        .replace(/^>+ ?/gm, "")
        .trim()
        .slice(0, 600),
    };
  });
}
