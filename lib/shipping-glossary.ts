/**
 * Plain-English answers to the shipping-document questions new or occasional
 * staff ask. Fixed text written for this desk — no AI, so it is the same
 * every time. General trade meaning; carrier contracts can differ in detail.
 */
export interface GlossaryEntry {
  id: string;
  title: string;
  match: RegExp;
  text: string;
  tip?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: "check-bl",
    title: "How to check a draft BL",
    match:
      /\bhow (?:do|should|can) (?:i|we|you) (?:check|verify|review)\b|\bwhat (?:should|do) i check\b|\bcheck(?:ing)? a draft\b|\bchecklist\b/,
    text: "Compare the draft BL with the Shipping Instruction, detail by detail: shipper, consignee, notify party, port of loading, port of discharge, number and type of containers, and gross weight. CargoGuard does these seven for you and highlights the words that differ. Then look at what it does not compare: container and seal numbers, number of packages, cargo description, HS code and freight terms (prepaid or collect).",
    tip: "If the draft BL is wrong, ask the sender to correct it (Write correction email). Only use Edit when CargoGuard misread a document.",
  },
  {
    id: "si-vs-bl",
    title: "Shipping Instruction vs Bill of Lading",
    match:
      /\bdifference between (?:the )?(?:si|shipping instruction) and (?:the )?(?:bl|b\/l|bill of lading)\b|\b(?:si|shipping instruction) (?:vs|versus|or) (?:bl|bill of lading)\b/,
    text: "The Shipping Instruction (SI) is what the shipper tells the carrier to print on the bill of lading. The draft Bill of Lading (BL) is the carrier's version, sent for checking before it is issued. The SI is the reference: when they differ, the BL is usually what must be corrected.",
  },
  {
    id: "si",
    title: "Shipping Instruction (SI)",
    match: /\b(?:si|shipping instructions?)\b/,
    text: "The shipper's instructions to the carrier or forwarder: parties, ports, containers, cargo description and weights to print on the bill of lading. At this desk it is the reference that the draft BL is checked against.",
  },
  {
    id: "draft-bl",
    title: "Draft BL",
    match: /\bdraft (?:bl|b\/l|bill of lading)\b/,
    text: "The carrier's proposed bill of lading, sent to the shipper side to check before the final BL is issued. Mistakes are cheapest to fix at this stage — changing a BL after it is issued usually costs an amendment fee and time.",
  },
  {
    id: "bl",
    title: "Bill of Lading (BL)",
    match: /\b(?:bl|b\/l|bill of lading|obl|original bl)\b/,
    text: "The document the carrier issues for the cargo. It is a receipt for the goods, evidence of the contract of carriage and — for an original (negotiable) BL — the document that gives the right to collect the cargo at destination.",
  },
  {
    id: "consignee",
    title: "Consignee",
    match: /\bconsignee\b/,
    text: "The party the goods are shipped to — usually the buyer or importer, or “to order” of a bank when a Letter of Credit is used. A wrong consignee can stop customs clearance or delivery at destination.",
  },
  {
    id: "shipper",
    title: "Shipper",
    match: /\bshipper\b/,
    text: "The party sending the goods — usually the seller or exporter. Under a Letter of Credit the shipper name must match the credit terms exactly.",
  },
  {
    id: "notify",
    title: "Notify party",
    match: /\bnotify(?: party)?\b/,
    text: "The company the carrier informs when the cargo arrives — often the buyer or its customs broker. “SAME AS CONSIGNEE” is common. If it is wrong, nobody may be told the cargo has arrived and storage charges can build up.",
  },
  {
    id: "ports",
    title: "Port of loading / port of discharge",
    match: /\b(?:port of (?:loading|discharge)|pol|pod|unlocode|port code)\b/,
    text: "Port of loading (POL) is where the cargo is loaded onto the vessel; port of discharge (POD) is where it is unloaded. Codes in brackets are UN/LOCODEs, for example MYPKG = Port Klang, Malaysia.",
  },
  {
    id: "vgm",
    title: "VGM (Verified Gross Mass)",
    match: /\b(?:vgm|verified gross mass)\b/,
    text: "Under the SOLAS convention the shipper must declare the verified weight of each packed container before loading. A container without a VGM is not loaded.",
  },
  {
    id: "weight",
    title: "Gross weight",
    match: /\bgross weight\b|\bnet weight\b/,
    text: "The weight of the cargo including its packing (net weight is without packing). It must agree between the SI, the BL, the packing list and the customs declaration. CargoGuard compares weights as numbers, so 42,000 KG and 42 MT count as the same.",
  },
  {
    id: "containers",
    title: "Container types (20'GP, 40'HC)",
    match:
      /\b(?:20 ?'? ?gp|40 ?'? ?hc|high cube|general purpose|container types?|teu)\b/,
    text: "20'GP is a 20-foot general-purpose container; 40'HC is a 40-foot high-cube container (taller, 9'6\"). A TEU is one twenty-foot equivalent unit, so a 40-foot container is 2 TEU.",
  },
  {
    id: "cutoff",
    title: "Cut-off",
    match: /\bcut[\s-]?off\b/,
    text: "The last time to submit something for a vessel: SI cut-off (shipping instruction), CY cut-off (container delivered to the terminal) and VGM cut-off. Missing it can mean the cargo is rolled to the next vessel.",
  },
  {
    id: "etd",
    title: "ETD / ETA",
    match: /\b(?:etd|eta)\b/,
    text: "ETD is the estimated time of departure of the vessel; ETA is the estimated time of arrival. Both can change — carriers publish updates.",
  },
  {
    id: "telex",
    title: "Telex release / surrendered BL",
    match:
      /\b(?:telex release|surrender(?:ed)? (?:bl|b\/l)|express release|seaway bill)\b/,
    text: "The original BLs are surrendered at origin, so the carrier releases the cargo at destination without paper originals being presented. It is usually requested once payment is settled; carriers may charge a telex release fee.",
  },
  {
    id: "demurrage",
    title: "Demurrage and detention",
    match: /\b(?:demurrage|detention|d ?& ?d)\b/,
    text: "Demurrage is charged when a container stays in the terminal longer than the free time; detention is charged when the carrier's container is kept outside the terminal longer than the free time. Exact rules depend on the carrier's tariff.",
  },
  {
    id: "rollover",
    title: "Rolled / rollover",
    match: /\broll(?:ed|over|ing)?\b/,
    text: "The cargo is moved to a later vessel — for example because a cut-off was missed or the vessel is full. It delays delivery and can affect Letter of Credit shipment dates.",
  },
  {
    id: "lc",
    title: "Letter of Credit (LC)",
    match: /\b(?:letter of credit|l\/c|lc)\b/,
    text: "A bank's promise to pay the seller when documents that exactly match the credit terms are presented. Small differences on the BL (a name, a port, a weight) can make the bank refuse the documents.",
  },
  {
    id: "hs",
    title: "HS code",
    match: /\bhs[\s-]?code\b|\bharmoni[sz]ed system\b/,
    text: "The international customs classification number of the goods (for example 4802.57 for some uncoated paper). Customs uses it for duties and statistics.",
  },
  {
    id: "freight",
    title: "Freight prepaid / collect",
    match: /\bfreight (?:prepaid|collect)\b|\bprepaid\b|\bcollect\b/,
    text: "Freight prepaid means the freight is paid at origin (usually by the shipper); freight collect means it is paid at destination (usually by the consignee). It must follow the agreed Incoterm.",
  },
  {
    id: "incoterms",
    title: "Incoterms (FOB, CFR, CIF…)",
    match: /\b(?:incoterms?|fob|cfr|cif|exw|dap|ddp)\b/,
    text: "Standard trade terms that say who pays for and arranges each part of the transport, and where the risk passes from seller to buyer. For example FOB: the buyer pays the main freight; CFR/CIF: the seller pays freight to the destination port.",
  },
];

/** A definition question ("what is a notify party?", "explain VGM"). */
export function glossaryAnswer(question: string): GlossaryEntry | null {
  const q = question.toLowerCase();
  const asks =
    /\b(what(?:'s| is| are| does| do)|explain|meaning|mean|define|definition|how (?:do|should|can) (?:i|we|you)|what should i check|difference between|vs|versus|tell me about)\b/.test(
      q,
    );
  if (!asks) return null;
  // "What is the SI cut-off this week?" is about work, not a definition.
  if (
    /\b(due|today|tomorrow|this week|next week|first|urgent|waiting|my|open|inbox|pending|late|overdue)\b/.test(
      q,
    )
  )
    return null;
  // Most specific entries are listed first.
  return GLOSSARY.find((entry) => entry.match.test(q)) ?? null;
}
