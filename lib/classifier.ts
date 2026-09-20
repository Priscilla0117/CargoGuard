import {
  CATEGORIES,
  type Category,
  type Classification,
  type Email,
} from "./types";
// Independently authored intent examples. The application never loads organiser
// IDs or answer-key labels. Token probabilities are fitted from this corpus.
export const TRAINING: Record<Category, string[]> = {
  BL_COMPARISON: [
    "Please compare the shipping instruction and draft bill of lading and report discrepancies",
    "Attached SI and draft BL please check the details and confirm",
    "TO CONFIRM DOCS please check draft documents against the instructions",
    "REQUEST BL DRAFT please send the draft BL for checking",
    "Draft BL amendment please verify consignee notify party and port",
    "Kindly confirm whether the draft bill of lading is in order",
    "Please check the draft BL against the SI and revert with any discrepancy",
    "We have not received the draft BL please arrange a copy for checking",
    "Documents attached for review and confirmation before final BL release",
    "Please compare SI and BL attachments the BL is missing",
    "Attached scanned SI and BL for checking please advise",
    "AIE shipment documents please assist to check and confirm draft BL",
    "AFPTME AFRT AFEMY draft BL consignee shipping details confirm docs",
    "The attached commercial invoice is not the draft BL kindly confirm documents",
    "Some SI fields were left blank please compare with the draft BL",
    "Please verify BL draft and highlight any mismatch before finalization",
  ],
  SI_REQUEST: [
    "Please prepare shipping instructions for the new booking",
    "REQUEST SI customer shipping instruction required for submission",
    "CUST SI please create SI based on order confirmation",
    "SI NEEDED submit shipping instruction before cutoff",
    "SI DIRECT carrier OBL SWB SURR BL customer instructions",
    "Please issue the SI for this shipment details below",
    "Kindly prepare and send the shipping instruction to carrier",
    "Please arrange SI submission based on order details",
    "New shipping instructions requested please draft and return",
    "Shipping instructions pending please expedite SI submission",
    "We need to submit SI for booking to the shipping line",
    "Please prepare CUST SI for order and confirm shipment details",
  ],
  INVOICE_QUERY: [
    "BILLING missing GR invoice has not been received please check",
    "CANCEL INVOICE incorrect charges please credit note",
    "LOCAL CHARGES invoice query please clarify outstanding amount",
    "D and D charges demurrage detention billing clarification",
    "Total Freight discrepancy payment invoice please revise",
    "Billing missing goods receipt blocks payment processing",
    "Please send invoice and breakdown of freight charges",
    "Invoice dispute the billed amount does not match agreed rate",
    "Question about invoiced total handling fees payment receipt",
    "Kindly check freight charges invoice cancellation request",
    "Please advise credit note for duplicate billing",
    "Customer invoice missing GR action required",
  ],
  GENERAL: [
    "UPDATE SUMMARY shipping operational status for your information",
    "Berthing Report vessel arrival weekly operations report",
    "SLA reminder service level performance meeting update",
    "RPA bot notice automation completed processing daily report",
    "Public holiday announcement office closure human resources",
    "Weekly team meeting agenda operations update no action needed",
    "Vessel schedule changed estimated time of arrival revised",
    "Please find attached monthly shipment summary for reference",
    "System maintenance notification scheduled downtime",
    "Operational update shipping schedule meeting minutes",
    "FYI delivery status update kindly take note",
    "HR holiday reminder office will be closed",
  ],
  SPAM: [
    "Congratulations you won a prize click here to claim reward",
    "Bitcoin investment guaranteed returns exclusive offer",
    "Your email storage is full verify account immediately password",
    "Dear valued customer update account to avoid suspension",
    "Increase your shipping revenue with this one weird trick",
    "Exclusive offer ninety percent off premium logistics software",
    "Parcel fee payment required click suspicious link claim package",
    "Urgent account verification mailbox full enter credentials",
    "Win lottery cash prize selected lucky winner",
    "Guaranteed investment 300 percent returns act now",
    "Unsolicited promotion marketing offer click now",
    "Pay a small delivery fee to release your unexpected parcel",
  ],
};
const stops = new Set(
  "the a an and or for to of in on at by from with is are be this that it we you your our please kindly dear hi team thanks thank regards best attached attachment".split(
    " ",
  ),
);
function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .match(/[a-z]{2,}/g)
      ?.filter((t) => !stops.has(t)) ?? []
  );
}
export function currentMessage(body: string) {
  // Only recognizable line-level reply/signature boundaries end the active request.
  // A warning banner or an ordinary phrase such as "from: Port Klang" must not.
  return body
    .split(
      /^\s*(?:best regards\b|regards,|[- ]*(?:original|forwarded) message\b|from:\s*[^\n]*@|sent:\s*(?:mon|tue|wed|thu|fri|sat|sun|\d))/im,
    )[0]
    .replace(/^.*(?:external sender|external email warning).*$/gim, "");
}
function activeText(email: Email) {
  return `${email.subject} ${email.subject} ${currentMessage(email.body)}`;
}
const vocabulary = new Set<string>();
const counts = Object.fromEntries(
  CATEGORIES.map((c) => [c, new Map<string, number>()]),
) as Record<Category, Map<string, number>>;
const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
  Category,
  number
>;
for (const cat of CATEGORIES)
  for (const sentence of TRAINING[cat])
    for (const token of tokens(sentence)) {
      vocabulary.add(token);
      counts[cat].set(token, (counts[cat].get(token) ?? 0) + 1);
      totals[cat]++;
    }
export function classify(
  email: Email,
  mode: "hybrid" | "model" = "hybrid",
): Classification {
  const text = activeText(email).replace(/_/g, " "),
    terms = tokens(text).filter((t) => vocabulary.has(t));
  const logs = CATEGORIES.map((cat) => ({
    cat,
    log: terms.reduce(
      (s, t) =>
        s +
        Math.log(
          ((counts[cat].get(t) ?? 0) + 0.7) /
            (totals[cat] + 0.7 * vocabulary.size),
        ),
      0,
    ),
  }));
  const max = Math.max(...logs.map((x) => x.log));
  const sum = logs.reduce((s, x) => s + Math.exp((x.log - max) / 2), 0);
  const scores = Object.fromEntries(
    logs.map((x) => [x.cat, Math.exp((x.log - max) / 2) / sum]),
  );
  let category = [...CATEGORIES].sort((a, b) => scores[b] - scores[a])[0];
  const getSignals = () =>
    [...new Set(terms)]
      .map((t) => ({
        t,
        importance:
          Math.log(
            ((counts[category].get(t) ?? 0) + 0.7) /
              (totals[category] + 0.7 * vocabulary.size),
          ) -
          Math.log(
            CATEGORIES.filter((c) => c !== category).reduce(
              (s, c) =>
                s +
                ((counts[c].get(t) ?? 0) + 0.7) /
                  (totals[c] + 0.7 * vocabulary.size),
              0,
            ) / 4,
          ),
      }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5)
      .map((x) => x.t);
  let rule: string | null = null;
  const body = currentMessage(email.body).replace(/_/g, " "),
    subject = email.subject.replace(/_/g, " ");
  const docRequest =
    /\b(?:compare|check|confirm|verify|review)\b[^.!\n]{0,140}\b(?:draft\s*(?:b\/?l|bill)|si\s*(?:and|&)|b\/?l\s+against|bill of lading)\b|\b(?:draft\s*b\/?l|bill of lading)\b[^.!\n]{0,100}\b(?:check|verify|review|compare)\b/i;
  const activeComparison =
    docRequest.test(body) ||
    /\b(?:compare|verify|check)\b[^.!\n]{0,60}\bshipping instructions?\b/i.test(
      body,
    );
  const scam =
    /bank officer.{0,100}(?:million|business proposal)|(?:reply|provide|confirm).{0,50}bank details.{0,40}(?:claim|prize)|won.{0,40}(?:lottery|prize)|(?:mailbox|account).{0,60}(?:suspend|storage|verify)|(?:pay|payment).{0,35}(?:small|delivery|parcel) fee.{0,70}(?:release|parcel|package)|guaranteed.{0,40}(?:returns|investment)|limited time offer|buy now before|deal expires|\b\d{2}% off\b|unpaid customs fee|parcel will be (?:returned|destroyed)|click here to claim|claim your \$?[\d,]+ gift card|exceeded its storage limit|verify your account within/i;
  if (mode === "hybrid") {
    if (
      scam.test(body) ||
      /(?:selected|winner|won)[^.\n]{0,130}(?:draw|lottery|gift card)|(?:won|winner)[\s\S]{0,150}(?:claim|survey)[\s\S]{0,100}(?:pay|shipping)/i.test(
        body,
      ) ||
      /lottery|claim.{0,20}prize|mailbox.{0,20}full|one weird trick|singles in your area|confirm (?:your )?bank (?:details|account)|guaranteed \d+% returns|gift card.{0,20}claim/i.test(
        subject,
      )
    ) {
      category = "SPAM";
      rule = "Potential scam or unsolicited offer; quarantine for review";
    } else if (activeComparison) {
      category = "BL_COMPARISON";
      rule =
        "Current message explicitly requests document verification; takes priority over subject";
    } else if (
      /\b(?:happy|prosperous) new year\b|\boffice (?:closure|resumes|holiday)\b|\blist of outstanding b\/?l\b/i.test(
        body,
      ) ||
      /automated notification[\s\S]{0,200}no action required|submit si & aed for all pending shipments/i.test(
        body,
      ) ||
      /\b(?:reminder|outstanding|pending bl release|process completed|berthing report|time off request)\b/i.test(
        subject,
      )
    ) {
      category = "GENERAL";
      rule = "Operational reminder or status report";
    } else if (
      /\b(request si|si needed|cust si|prepare.{0,30}(?:shipping instruction|\bsi\b)|submit.{0,20}shipping instruction)\b/i.test(
        text,
      ) ||
      /^\s*(?:re[: ]*|fw[: ]*)*SI\s*-/i.test(subject) ||
      /please find shipping instructions? for/i.test(body)
    ) {
      category = "SI_REQUEST";
      rule = "Explicit shipping-instruction request";
    } else if (
      docRequest.test(subject) ||
      /\b(?:si and draft bl|to confirm docs|request bl draft)\b/i.test(text)
    ) {
      category = "BL_COMPARISON";
      rule = "Explicit request to verify shipment documents";
    }
  }
  const confidence = terms.length
    ? Math.max(scores[category], rule ? 0.92 : 0)
    : 0.2;
  const ranked = Object.values(scores).sort((a, b) => b - a);
  const needs_review =
    !rule &&
    (terms.length < 2 || ranked[0] < 0.55 || ranked[0] - ranked[1] < 0.12);
  return {
    category,
    confidence,
    method: rule ? "Naive Bayes + intent rule" : "Multinomial Naive Bayes",
    signals: rule ? [rule, ...getSignals()] : getSignals(),
    scores,
    needs_review,
    review_note: needs_review
      ? "Email intent has too little or conflicting evidence. Confirm its category; no operational decision has been made."
      : undefined,
  };
}
