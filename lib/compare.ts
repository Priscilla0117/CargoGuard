import { classify } from "./classifier";
import { selectedDocuments } from "./document-selection";
import { recoveryExtracted } from "./recovery-schema";
import { withPolicy, DEFAULT_POLICY, type PolicySnapshot } from "./policy";
import {
  FIELDS,
  FIELD_LABELS,
  PIPELINE_VERSION,
  type Category,
  type Field,
  type ParsedDocument,
  type Email,
  type CaseResult,
  type Extracted,
  type ComparisonRow,
  type DocumentSelection,
} from "./types";
import {
  normalize,
  compareFields,
  resolveFields,
  equivalent,
} from "./normalization";
export { normalize, compareFields, recomputeRows } from "./normalization";
const labels: [RegExp, Field | "stop"][] = [
  [/^shipper(?:\s*\/\s*exporter)?(?:\s*\([^)]*\))*\s*$/i, "shipper"],
  [/^(?:consignee|to the order of)(?:\s*\([^)]*\))*\s*$/i, "consignee"],
  [
    /^notify(?: party)?(?:\s*\/\s*intermediate consignee)?(?:\s*\([^)]*\))*\s*$/i,
    "notify_party",
  ],
  [
    /^(?:port of loading|load port|pol)(?:\s*\([^)]*\))*\s*$/i,
    "port_of_loading",
  ],
  [
    /^(?:port of discharge|discharge port|pod)(?:\s*\([^)]*\))*\s*$/i,
    "port_of_discharge",
  ],
  [
    /^(?:no\.? of containers(?: or packages)?|total containers|container count)(?:\s*\([^)]*\))*\s*$/i,
    "container_count",
  ],
  [
    /^(?:total\s+)?gross\s*(?:weight|wt)(?:毛重)?(?:\s*\([^)]*\))*\s*$/i,
    "gross_weight_kg",
  ],
  [
    /^(?:vessel.*|ocean vessel|export carrier.*|voy\..*|voyage.*|commodity.*|description.*|kinds of packages.*|hs code.*|booking.*|b\/l.*|bl no.*|bill of lading no.*|oc no.*|order no.*|freight.*|container no\.?|total packages.*|remarks?|notes?)$/i,
    "stop",
  ],
];
export function fieldLabel(text: string): Field | "stop" | null {
  return (
    labels.find(([rx]) =>
      rx.test(
        text
          .trim()
          .replace(/[:：]$/, "")
          .trim(),
      ),
    )?.[1] ?? null
  );
}

/** A header's unit is part of the source value, not disposable label decoration. */
function weightWithLabel(
  raw: string,
  label: string,
): { raw: string; issue?: string } {
  const annotations = [...label.normalize("NFKC").matchAll(/\(([^)]*)\)/g)]
    .map((match) => match[1].replace(/^\s*毛重\s*/, "").trim())
    .filter(Boolean);
  const unit = (value: string) =>
    /^(?:kgs?|kilograms?)$/i.test(value)
      ? "KG"
      : /^(?:mt|metric tonnes?|tonnes?)$/i.test(value)
        ? "MT"
        : null;
  const headerUnits = annotations.map(unit);
  if (!headerUnits.length) return { raw };
  if (headerUnits.some((value) => !value || value !== headerUnits[0]))
    return {
      raw,
      issue:
        "The weight label contains unsupported or conflicting units. Confirm the weight in kilograms.",
    };
  const suffix = raw
    .normalize("NFKC")
    .trim()
    .match(/([a-z]+(?:\s+[a-z]+)*)$/i)?.[1];
  if (suffix) {
    if (unit(suffix) && unit(suffix) !== headerUnits[0])
      return {
        raw,
        issue:
          "The weight label and value specify conflicting units. Confirm the source weight in kilograms.",
      };
    return { raw };
  }
  // Only augment a complete number. Missing values and unsupported expressions
  // remain uncertain, and the evidence still points to the original label/value.
  return normalize("gross_weight_kg", raw) !== null
    ? { raw: `${raw} ${headerUnits[0]}` }
    : { raw };
}

export function extract(doc: ParsedDocument): Extracted {
  if (doc.recovery) return recoveryExtracted(doc);
  if (doc.transcription) {
    return resolveFields(
      Object.fromEntries(
        FIELDS.map((field) => [
          field,
          {
            raw: doc.transcription!.fields[field].value,
            normalized: null,
            evidence: `Page ${doc.transcription!.fields[field].page}; ${FIELD_LABELS[field]}; human-confirmed`,
            source: doc.name,
            method: "Human-confirmed scan transcription",
          },
        ]),
      ) as Extracted,
    );
  }
  const result = Object.fromEntries(
    FIELDS.map((f) => [
      f,
      {
        raw: "",
        normalized: null,
        evidence: "No value located",
        source: doc.name,
        method: doc.method,
      },
    ]),
  ) as Extracted;
  type Segment = {
    field: Field;
    raw: string;
    location: string;
    total: boolean;
    label: string;
    issue?: string;
  };
  const segments: Segment[] = [];
  const approvedAliases = doc.label_rules && doc.sha256 && doc.label_rules.source_sha256 === doc.sha256
    ? doc.label_rules.aliases : [];
  let current: Segment | null = null;
  let inNotes = false;
  const weightNotes: string[] = [];
  for (const line of doc.lines) {
    const text = line.text.trim();
    if (!text) continue;
    const split = text.match(/^(.+?)[:：]\s*([\s\S]*)$/);
    const sourceLabel = (split ? split[1] : text).normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
    const aliases = split ? approvedAliases.filter((alias) => alias.label === sourceLabel) : [];
    const key = fieldLabel(split ? split[1] : text) ?? aliases[0]?.field ?? null;
    const wasInNotes = inNotes;
    if (key) inNotes = /^(?:remarks?|notes?)$/i.test(split ? split[1].trim() : text);
    // A footer is a field boundary, but a weight instruction in that footer is
    // still evidence. Never hide a second weight by treating it as decoration.
    if (
      (inNotes || wasInNotes) &&
      /(?:\b(?:gross\s*(?:weight|wt)|weight)\b|\d[\d., ]*\s*(?:kgs?|kilograms?|mt|metric\s+tonnes?|tonnes?)\b)/i.test(text)
    ) weightNotes.push(line.location);
    if (key) {
      current =
        key === "stop"
          ? null
          : {
              field: key,
              raw: split ? split[2].trim() : "",
              location: line.location,
              total: /^total\s+gross/i.test(text),
              label: split ? split[1] : text,
              ...(new Set(aliases.map((alias) => alias.field)).size > 1 ? { issue: "Conflicting approved label mappings. Review this field and disable the conflicting rule." } : {}),
            };
      if (current) segments.push(current);
    } else if (current) {
      if (/^[=\-]{3,}$/.test(text)) continue;
      if (!current.raw && current.location !== line.location)
        current.location += `; value ${line.location}`;
      current.raw += (current.raw ? "\n" : "") + text;
      if (!["shipper", "consignee", "notify_party"].includes(current.field))
        current = null;
    }
  }
  for (const segment of segments)
    if (segment.field === "gross_weight_kg")
      Object.assign(segment, weightWithLabel(segment.raw, segment.label));
  for (const field of FIELDS) {
    let candidates = segments.filter((s) => s.field === field && s.raw.trim());
    if (field === "gross_weight_kg" && candidates.some((s) => s.total))
      candidates = candidates.filter((s) => s.total);
    if (!candidates.length) continue;
    const first = candidates[0],
      values = candidates.map((c) => normalize(field, c.raw));
    const conflicting =
      candidates.length > 1 &&
      values.some((v) => !equivalent(field, v, values[0]));
    const issue = candidates.find((candidate) => candidate.issue)?.issue;
    result[field] = {
      raw: conflicting
        ? candidates.map((c) => c.raw).join("\n--- alternative value ---\n")
        : first.raw,
      normalized: null,
      evidence: candidates.map((c) => c.location).join("; "),
      source: doc.name,
      method: `${doc.method}${approvedAliases.some((alias) => alias.field === field) ? "; approved label rule" : ""}`,
      ...(conflicting || issue
        ? {
            extraction_issue:
              issue ??
              "Conflicting repeated field labels. Confirm the authoritative value from the source.",
          }
        : {}),
    };
  }
  if (weightNotes.length) {
    result.gross_weight_kg.extraction_issue =
      "A remarks or notes section mentions weight. Confirm the authoritative weight and any amendment from the source.";
    result.gross_weight_kg.evidence += `; weight note ${weightNotes.join("; ")}`;
  }
  // PDF fonts can split a bilingual total label into several fragments. Recover
  // only the numeric total on that exact page/baseline; never use a nearby item weight.
  if (
    doc.format === "pdf" &&
    !result.gross_weight_kg.extraction_issue &&
    normalize("gross_weight_kg", result.gross_weight_kg.raw) === null
  ) {
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      if (!/^total\s+gross\s*(?:weight|wt)\b/i.test(line.text)) continue;
      for (const next of doc.lines.slice(i + 1, i + 4)) {
        if (next.location !== line.location) break;
        const m = next.text.match(
          /[:：]\s*(\d[\d ,.]*\s*(?:kgs?|mt|tonnes?)?)\s*$/i,
        );
        if (m && normalize("gross_weight_kg", m[1]) !== null) {
          const recovered = weightWithLabel(
            m[1].trim(),
            `${line.text} ${next.text.split(/[:：]/)[0]}`,
          );
          result.gross_weight_kg = {
            raw: recovered.raw,
            normalized: null,
            evidence: line.location,
            source: doc.name,
            method: `${doc.method}; same-baseline total`,
            ...(recovered.issue ? { extraction_issue: recovered.issue } : {}),
          };
        }
      }
    }
  }
  return resolveFields(result);
}
export function deriveResult(
  base: CaseResult,
  rows: ComparisonRow[],
): CaseResult {
  return withPolicy(deriveStrictResult(base, rows));
}
function deriveStrictResult(
  base: CaseResult,
  rows: ComparisonRow[],
): CaseResult {
  const uncertain = rows.filter((r) => r.result === "uncertain"),
    defects = rows.filter((r) => r.result === "mismatch").map((r) => r.field);
  if (uncertain.length)
    return {
      ...base,
      comparison: rows,
      status: "NEEDS_REVIEW",
      workflow: "review",
      review_reason: "missing_value",
      has_defect: false,
      defect_fields: [],
      summary: `${uncertain.map((r) => FIELD_LABELS[r.field]).join(", ")} needs confirmation. A full comparison cannot be completed.${defects.length ? ` ${defects.length} other field difference(s) remain visible below.` : ""}`,
    };
  return {
    ...base,
    comparison: rows,
    status: defects.length ? "MISMATCH" : "OK",
    workflow: defects.length ? "discrepancy" : "verified",
    review_reason: null,
    has_defect: !!defects.length,
    defect_fields: defects,
    summary: defects.length
      ? `${defects.length} ${defects.length === 1 ? "field differs" : "fields differ"} from the Shipping Instruction. Review ${defects.map((f) => FIELD_LABELS[f].toLowerCase()).join(", ")}.`
      : "No mismatch detected. All seven shipment fields match the Shipping Instruction.",
  };
}
export function analyze(
  email: Email,
  documents: ParsedDocument[],
  duration = 0,
  categoryOverride?: Category,
  policy: PolicySnapshot = DEFAULT_POLICY,
  selection?: DocumentSelection,
): CaseResult {
  return withPolicy(
    analyzeCore(email, documents, duration, categoryOverride, selection),
    policy,
  );
}
function analyzeCore(
  email: Email,
  documents: ParsedDocument[],
  duration = 0,
  categoryOverride?: Category,
  selection?: DocumentSelection,
): CaseResult {
  const classification = classify(email),
    base: CaseResult = {
      email,
      classification,
      category: categoryOverride ?? classification.category,
      category_override: categoryOverride,
      pipeline_version: PIPELINE_VERSION,
      status: "OK",
      workflow: "routed",
      review_reason: null,
      has_defect: false,
      defect_fields: [],
      summary: "",
      documents,
      document_selection: selection,
      reviewed: selection ? true : undefined,
      comparison: [],
      duration_ms: duration,
      processed_at: new Date().toISOString(),
      version: 1,
    };
  if (!categoryOverride && classification.needs_review)
    return {
      ...base,
      status: "NEEDS_REVIEW",
      workflow: "review",
      review_reason:
        base.category === "BL_COMPARISON" &&
        documents.some((d) => d.type === "OTHER" && !d.error)
          ? "wrong_doc_type"
          : "uncertain_category",
      summary:
        (base.category === "BL_COMPARISON" &&
        documents.some((d) => d.type === "OTHER" && !d.error)
          ? "An attachment is a recognized non-shipping-comparison document, such as an invoice or packing list. Provide the actual SI and draft BL. "
          : "") +
        (classification.review_note ??
          "Email intent is uncertain. Confirm the category before processing the documents."),
    };
  if (
    !categoryOverride &&
    base.category !== "BL_COMPARISON" &&
    base.category !== "SPAM" &&
    documents.some((d) => d.type === "SI") &&
    documents.some((d) => d.type === "BL")
  )
    return {
      ...base,
      status: "NEEDS_REVIEW",
      workflow: "review",
      review_reason: "uncertain_category",
      summary:
        "The attachments look like an SI and draft BL, but the email was routed elsewhere. Confirm the category before dismissing the document check.",
    };
  if (base.category !== "BL_COMPARISON")
    return {
      ...base,
      summary: (
        {
          SI_REQUEST: "Routed to the shipping instructions desk.",
          INVOICE_QUERY: "Routed to the billing desk.",
          GENERAL:
            "General operations message. No document comparison required.",
          SPAM: "Potential spam. Isolated from document verification.",
        } as Record<string, string>
      )[base.category],
    };
  const review = (
    reason: NonNullable<CaseResult["review_reason"]>,
    summary: string,
  ): CaseResult => ({
    ...base,
    status: "NEEDS_REVIEW",
    workflow: "review",
    review_reason: reason,
    summary,
  });
  if (selection) {
    try {
      const [si, bl] = selectedDocuments(documents, selection);
      const result = deriveResult(
        base,
        compareFields(extract(si), extract(bl)),
      );
      const excluded = documents.length - 2;
      return {
        ...result,
        summary: `${result.summary} Human-selected pair only; ${excluded} other attachment${excluded === 1 ? " is" : "s are"} retained but not verified.`,
      };
    } catch {
      return review(
        "wrong_doc_type",
        "The selected SI/BL pair is no longer valid. Confirm the current source documents before comparing.",
      );
    }
  }
  if (documents.length < 2) {
    if (
      documents.length === 0 &&
      /(?:send|arrange|provide|share|forward|receive).{0,65}(?:draft|bl)|(?:draft|bl).{0,65}(?:send|arrange|provide|share)/i.test(
        email.body,
      ) &&
      !/missing|forgot|forgotten|not attached|no attachment/i.test(email.body)
    )
      return {
        ...base,
        workflow: "awaiting_documents",
        summary:
          "Awaiting the requested SI and draft BL. No verification has taken place.",
      };
    return review(
      "missing_attachment",
      "The SI and draft BL are both required. Request the missing document before comparing.",
    );
  }
  if (documents.some((d) => d.error))
    return review(
      "unreadable",
      documents
        .filter((d) => d.error)
        .map((d) => `${d.name}: ${d.error}`)
        .join(" "),
    );
  if (documents.some((d) => d.type === "OTHER" || d.type === "UNKNOWN"))
    return review(
      "wrong_doc_type",
      documents.length > 2
        ? "This email contains additional attachments. In Sources, choose the readable SI and draft BL to compare. Every other attachment will be retained but not verified."
        : "An attachment is an invoice, packing list or an unrecognized document type. Confirm every attachment and provide exactly one SI and one draft BL before comparing.",
    );
  const sis = documents.filter((d) => d.type === "SI"),
    bls = documents.filter((d) => d.type === "BL");
  if (sis.length !== 1 || bls.length !== 1)
    return review(
      "wrong_doc_type",
      "Could not identify exactly one Shipping Instruction and one draft Bill of Lading. Confirm document roles; for multiple drafts, choose the comparison pair in Sources.",
    );
  return deriveResult(base, compareFields(extract(sis[0]), extract(bls[0])));
}
export function submissionEntry(r: CaseResult) {
  return {
    category: r.category,
    status: r.status,
    review_reason: r.review_reason,
    has_defect: r.has_defect,
    defect_fields: r.defect_fields,
  };
}
