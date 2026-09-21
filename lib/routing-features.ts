import type { Email } from "./types";

export const ROUTING_FEATURE_VERSION = "request-channels-v1";

/** Remove recognizable quoted mail/signatures; document/email text is never instructions. */
export function currentRoutingMessage(body: string) {
  return body
    .replace(/\r\n?/g, "\n")
    .split(
      /^\s*(?:best regards\b|regards,\s*$|[- ]*(?:original|forwarded) message\b|from:\s*[^\n]*@|sent:\s*(?:mon|tue|wed|thu|fri|sat|sun|\d)|on\s+[^\n]{1,180}\bwrote:\s*$|>)/im,
    )[0]
    .replace(
      /^.*(?:external sender|external email warning|warning: this email originated outside).*$/gim,
      "",
    )
    .trim();
}

const stop = new Set(
  "a an the and or for to of in on at by from with is are was were be been this that it we you your our please kindly dear hi hello team thanks thank regards best attached attachment".split(
    " ",
  ),
);

/** Canonicalize syntax, not categories. No IDs, filenames, addresses or answer labels. */
export function routingTokens(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/https?:\/\/\S+|\b[^\s@]+@[^\s@]+\b/g, " ")
      .replace(/\bb\s*\/\s*l\b/g, " bl ")
      .replace(/\bs\s*\/\s*i\b/g, " si ")
      .replace(/\b[a-z]*\d[\w-]*\b/g, " ")
      .match(/[a-z]{2,}/g) ?? []
  ).filter((token) => !stop.has(token));
}

export function routingFeatureCounts(email: Pick<Email, "subject" | "body">) {
  const subject = routingTokens(email.subject.slice(0, 600));
  const current = currentRoutingMessage(email.body).slice(0, 5000);
  const body = routingTokens(current);
  const lead = routingTokens(
    current
      .split("\n")
      .filter(
        (line) =>
          line.trim() && !/^\s*(?:dear|hi|hello)\s+[\w ,.-]{0,60}$/i.test(line),
      )
      .slice(0, 3)
      .join(" ")
      .slice(0, 420),
  );
  const features = new Map<string, number>();
  const add = (key: string, amount = 1) =>
    features.set(key, (features.get(key) ?? 0) + amount);
  const channel = (prefix: string, tokens: string[], scale: number) => {
    for (let index = 0; index < tokens.length; index++) {
      add(`${prefix}:${tokens[index]}`, scale);
      if (index) add(`${prefix}:${tokens[index - 1]} ${tokens[index]}`, scale);
    }
  };
  channel("s", subject, 1.0);
  channel("lead", lead, 1.7);
  channel("b", body, 0.8);
  // Shared lexical features let training phrases transfer between channels.
  const shared = [...subject, ...body];
  channel("w", shared, 0.7);
  for (const word of new Set(shared)) {
    if (word.length < 5 || word.length > 22) continue;
    const padded = `^${word}$`;
    for (const size of [3, 4])
      for (let index = 0; index + size <= padded.length; index++)
        add(`c:${padded.slice(index, index + size)}`, 0.12);
  }
  return { features, tokens: shared };
}

export function vectorizeRouting(
  counts: Map<string, number>,
  vocabulary: Map<string, number>,
  idf: number[],
) {
  const sparse: [number, number][] = [];
  let length = 0;
  for (const [feature, count] of counts) {
    const index = vocabulary.get(feature);
    if (index === undefined) continue;
    const value = Math.log1p(count) * idf[index];
    sparse.push([index, value]);
    length += value * value;
  }
  length = Math.sqrt(length) || 1;
  return sparse.map(
    ([index, value]) => [index, value / length] as [number, number],
  );
}

export function routingReviewGate(email: Pick<Email, "subject" | "body">) {
  const body = currentRoutingMessage(email.body);
  const comparison =
    /\b(?:compare|check|verify|review|inspect)\b[^.!?\n]{0,130}\b(?:draft\s*(?:bl|b\/l)|bill of lading|si\s+(?:and|against)|shipping instructions?)\b/i.test(
      body,
    );
  const billing =
    /\b(?:cancel|dispute|revise|explain|clarify|issue|reverse)\b[^.!?\n]{0,100}\b(?:invoice|credit note|billing|charges)\b/i.test(
      body,
    );
  const prepare =
    /\b(?:prepare|create|lodge|submit|issue)\b[^.!?\n]{0,70}\b(?:shipping instructions?|si)\b/i.test(
      body,
    );
  if (
    /\b(?:do not|don't|must not|no need to|stop)\s+(?:\w+\s+){0,3}(?:compare|check|verify|review|inspect)\b[^.!?\n]{0,100}\b(?:draft|bl|b\/l|bill of lading|shipping instruction)/i.test(
      body,
    )
  )
    return "The current message negates a document-checking action. A person must confirm the intended workflow.";
  if (comparison && (billing || prepare))
    return "The current message requests multiple operational workflows. A person must confirm the route and retain every requested action.";
  return undefined;
}
