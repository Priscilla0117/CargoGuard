import { strToU8, zipSync } from "fflate";
import type { Field } from "./types";

/**
 * CargoGuard field-test mailbox: a team-authored, Averis-style inbox that is
 * NOT produced by the organiser generator. It exercises what the organiser
 * set does not: real mail headers and dates, conversations about one order
 * number, deadlines, PDFs and Word files, unit variations, missing and scanned
 * attachments, and phishing. Dates are relative so the demo is always "today".
 */
export type DocFormat = "txt" | "pdf" | "pdf-merged" | "docx" | "pdf-scan";
export interface DocSpec {
  role: "SI" | "BL" | "INVOICE";
  format: DocFormat;
  name: string;
  fields: Partial<Record<Field, string>>;
  extra?: string[];
}
export interface Scenario {
  id: string;
  thread?: string;
  reply_to?: string;
  day: number;
  time: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  docs: DocSpec[];
  expect: {
    category:
      | "BL_COMPARISON"
      | "SI_REQUEST"
      | "INVOICE_QUERY"
      | "GENERAL"
      | "SPAM";
    outcome?: "OK" | "MISMATCH" | "NEEDS_REVIEW";
    defects?: Field[];
    urgent?: boolean;
    deadline?: number;
  };
}

type Party = Record<Field, string>;
const APRIL_SG =
  "APRIL FINE PAPER TRADING PTE LTD\n77 ROBINSON ROAD #21-01, SINGAPORE 068896";
const APRIL_MY =
  "APRIL FAR EAST (M) SDN BHD\nTOWER 2, AVENUE 5, BANGSAR SOUTH CITY, 59200 KUALA LUMPUR, MALAYSIA";
const S1: Party = {
  shipper: APRIL_SG,
  consignee: "AFEMY ENTERPRISES LIMITED\nP.O. BOX 90420-80100, MOMBASA, KENYA",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "PORT KLANG, MALAYSIA",
  port_of_discharge: "MOMBASA, KENYA",
  container_count: "3 x 40'HC",
  gross_weight_kg: "68,450 KG",
};
const S3: Party = {
  shipper: APRIL_MY,
  consignee:
    "ROXCEL TRADING GMBH\nTHURNHERSEESTRASSE 1, 6912 HOERBRANZ, AUSTRIA",
  notify_party:
    "PACIFIC OFFICE (M) SDN BHD\nLOT 6, JALAN P/7, 43650 BANDAR BARU BANGI, MALAYSIA",
  port_of_loading: "PORT KLANG (WESTPORT), MALAYSIA",
  port_of_discharge: "MERSIN, TURKEY",
  container_count: "TWO (2) X 40' HC",
  gross_weight_kg: "18.5 MT",
};
const S4: Party = {
  shipper: APRIL_SG,
  consignee:
    "HANSOL PAPER TRADING CO., LTD.\n24 EULJI-RO 5-GIL, JUNG-GU, SEOUL, KOREA",
  notify_party: "HANSOL LOGISTICS CO., LTD.\n24 EULJI-RO 5-GIL, SEOUL, KOREA",
  port_of_loading: "SINGAPORE",
  port_of_discharge: "BUSAN, SOUTH KOREA",
  container_count: "4 x 20'GP",
  gross_weight_kg: "84,200 KG",
};
const S5: Party = {
  shipper: APRIL_MY,
  consignee: "CERIEX PTY LTD\n12 COCKBURN ROAD, HENDERSON WA 6166, AUSTRALIA",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "PORT KLANG (WESTPORT), MALAYSIA",
  port_of_discharge: "FREMANTLE, AUSTRALIA",
  container_count: "6 x 20'GP",
  gross_weight_kg: "135,126 KG",
};
const S8: Party = {
  shipper: APRIL_SG,
  consignee:
    "INDO SUKSES STATIONERY PVT LTD\nPLOT 44, MIDC ANDHERI EAST, MUMBAI 400093, INDIA",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "SINGAPORE",
  port_of_discharge: "NHAVA SHEVA, INDIA",
  container_count: "2 x 40'HC",
  gross_weight_kg: "45,880 KG",
};
const S9: Party = {
  shipper: APRIL_SG,
  consignee: "OFFICE SUPPLY SOLUTIONS LLC\nAL QUOZ INDUSTRIAL 3, DUBAI, UAE",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "PORT KLANG, MALAYSIA",
  port_of_discharge: "JEBEL ALI, UAE",
  container_count: "5 x 40'HC",
  gross_weight_kg: "112,300 KG",
};
const with_ = (base: Party, change: Partial<Party>): Party => ({
  ...base,
  ...change,
});

const SIGN = (name: string, company = "APRIL Fine Paper Trading Pte Ltd") =>
  `\n\nBest Regards,\n${name}\nShipping Documentation\n${company}`;

export const FIELD_TEST: Scenario[] = [
  // ---- Conversation 5RFR-36541 (the order number seen in the mentor's inbox) ----
  {
    id: "ft_01",
    thread: "5RFR-36541",
    day: -9,
    time: "09:12",
    from: "Peter Mwangi <peter.mwangi@afemy-demo.co.ke>",
    to: "docs@april-demo.com",
    subject: "REQUEST SI _ 5RFR-36541 _ MOMBASA_KENYA _ AFEMY ENTERPRISES",
    body: "Dear Team,\n\nKindly send us the shipping instruction for order 5RFR-36541 (3 x 40HC coated paper) so we can arrange the booking.\n\nThank you,\nPeter Mwangi\nAFEMY Enterprises Ltd, Mombasa",
    docs: [],
    expect: { category: "SI_REQUEST" },
  },
  {
    id: "ft_02",
    thread: "5RFR-36541",
    reply_to: "ft_01",
    day: -6,
    time: "14:30",
    from: "CMA Documentation <docs.sg@cma-demo-lines.com>",
    to: "docs@april-demo.com",
    subject:
      "AFEMY - MOMBASA_KENYA - CMA(SIJ4216073) - 5RFR-36541 - DRAFT BL FOR CHECKING",
    body: `Dear Shipper,\n\nPlease find attached the draft BL SIJ4216073 together with your SI for order 5RFR-36541. Kindly check and confirm, or advise amendments before {{d:+1|dMonY}}.${SIGN("Jasmine Tan", "CMA CGM Singapore Documentation")}`,
    docs: [
      { role: "SI", format: "pdf", name: "SI_5RFR-36541.pdf", fields: S1 },
      {
        role: "BL",
        format: "pdf",
        name: "DRAFT_BL_SIJ4216073.pdf",
        fields: with_(S1, {
          consignee:
            "AFEMY ENTERPRISES LIMITED\nP.O. BOX 90240-80100, MOMBASA, KENYA",
          gross_weight_kg: "68,540 KG",
        }),
      },
    ],
    expect: {
      category: "BL_COMPARISON",
      outcome: "MISMATCH",
      defects: ["consignee", "gross_weight_kg"],
      deadline: 1,
    },
  },
  {
    id: "ft_03",
    thread: "5RFR-36541",
    reply_to: "ft_02",
    day: -3,
    time: "10:05",
    from: "CMA Documentation <docs.sg@cma-demo-lines.com>",
    to: "docs@april-demo.com",
    subject:
      "RE: AFEMY - MOMBASA_KENYA - CMA(SIJ4216073) - 5RFR-36541 - REVISED DRAFT BL",
    body: `Dear Shipper,\n\nRevised draft BL attached as per your amendment request. Please check again.${SIGN("Jasmine Tan", "CMA CGM Singapore Documentation")}\n\n________________________________\nFrom: Najiha Nur <najiha@april-demo.com>\nSent: {{d:-4|long}} 4:10 PM\nSubject: RE: 5RFR-36541 - DRAFT BL FOR CHECKING\n\nPlease amend consignee P.O. BOX to 90420-80100 and gross weight to 68,450 KG.`,
    docs: [
      { role: "SI", format: "pdf", name: "SI_5RFR-36541.pdf", fields: S1 },
      {
        role: "BL",
        format: "pdf",
        name: "DRAFT_BL_SIJ4216073_REV1.pdf",
        fields: with_(S1, { container_count: "2 x 40'HC" }),
      },
    ],
    expect: {
      category: "BL_COMPARISON",
      outcome: "MISMATCH",
      defects: ["container_count"],
    },
  },
  {
    id: "ft_04",
    thread: "5RFR-36541",
    reply_to: "ft_03",
    day: -1,
    time: "16:40",
    from: "CMA Documentation <docs.sg@cma-demo-lines.com>",
    to: "docs@april-demo.com",
    subject:
      "RE: RE: AFEMY - MOMBASA_KENYA - CMA(SIJ4216073) - 5RFR-36541 - FINAL DRAFT",
    body: `Dear Shipper,\n\nPlease see the final draft with 3 x 40HC corrected. Kindly confirm so we can release the original BL.${SIGN("Jasmine Tan", "CMA CGM Singapore Documentation")}`,
    docs: [
      { role: "SI", format: "docx", name: "SI_5RFR-36541.docx", fields: S1 },
      {
        role: "BL",
        format: "docx",
        name: "FINAL_DRAFT_BL_SIJ4216073.docx",
        fields: S1,
      },
    ],
    expect: { category: "BL_COMPARISON", outcome: "OK" },
  },
  {
    id: "ft_05",
    thread: "5RFR-36541",
    reply_to: "ft_04",
    day: 0,
    time: "08:20",
    from: "Finance AFEMY <accounts@afemy-demo.co.ke>",
    to: "docs@april-demo.com",
    subject: "Query on invoice 5250074586 - 5RFR-36541 - THC charges",
    body: "Hello,\n\nFor invoice 5250074586 (order 5RFR-36541), is the THC / local charge included or billed separately? Payment is due {{d:+1|dmy}}, please advise urgently so we can release payment.\n\nRegards,\nMary Otieno\nAccounts, AFEMY Enterprises",
    docs: [],
    expect: { category: "INVOICE_QUERY", urgent: true, deadline: 1 },
  },
  // ---- Urgent SI requests: cut-off tomorrow ----
  {
    id: "ft_06",
    thread: "5RCY-60883",
    day: 0,
    time: "07:45",
    from: "Ahmed Camara <ahmed@orientlinks-demo.gn>",
    to: "docs@april-demo.com",
    subject: "URGENT - SI NEEDED _ 5RCY-60883 _ CONAKRY_GUINEA _ ORIENT LINKS",
    body: "Dear Najiha,\n\nWe still have not received the SI for 5RCY-60883. The SI cut-off is {{d:+1|dMonY}} 12:00 and the vessel will not wait. Please send the SI ASAP.\n\nThanks,\nAhmed Camara\nOrient Links Co (LLC)",
    docs: [],
    expect: { category: "SI_REQUEST", urgent: true, deadline: 1 },
  },
  {
    id: "ft_07",
    thread: "5RCY-60883",
    reply_to: "ft_06",
    day: 0,
    time: "11:10",
    from: "Ahmed Camara <ahmed@orientlinks-demo.gn>",
    to: "docs@april-demo.com",
    subject:
      "RE: URGENT - SI NEEDED _ 5RCY-60883 _ CONAKRY_GUINEA _ ORIENT LINKS",
    body: "2nd reminder: please send the shipping instruction today, otherwise the booking will be rolled to the next vessel.\n\nAhmed\n\n________________________________\nFrom: Ahmed Camara <ahmed@orientlinks-demo.gn>\nSent: {{d:0|long}} 7:45 AM\nSubject: URGENT - SI NEEDED _ 5RCY-60883\n\nWe still have not received the SI for 5RCY-60883.",
    docs: [],
    expect: { category: "SI_REQUEST", urgent: true, deadline: 0 },
  },
  // ---- Units and wording differ, values are the same ----
  {
    id: "ft_08",
    day: -2,
    time: "13:25",
    from: "Lee Guan Cheng <guancheng_lee@april-demo.com.my>",
    to: "docs@april-demo.com",
    subject:
      "TO CONFIRM DOCS _ 5ALT-19136 _ MERSIN_TURKEY _ ROXCEL TRADING GMBH",
    body: `Hi Najiha,\n\nAttached are the SI and draft BL for OC 5ALT-19136. Please check the details and confirm.${SIGN("Lee Guan Cheng", "APRIL Far East (M) Sdn Bhd")}`,
    docs: [
      { role: "SI", format: "docx", name: "SI 5ALT-19136.docx", fields: S3 },
      {
        role: "BL",
        format: "txt",
        name: "Draft BL 5ALT-19136.txt",
        fields: with_(S3, {
          container_count: "2 x 40HC",
          gross_weight_kg: "18,500 KGS",
        }),
      },
    ],
    expect: { category: "BL_COMPARISON", outcome: "OK" },
  },
  // ---- Missing BL, then resent with a real difference ----
  {
    id: "ft_09",
    thread: "5AAT-45299",
    day: -4,
    time: "15:02",
    from: "Sathiya Munusamy <sathiya@april-demo.com.my>",
    to: "docs@april-demo.com",
    subject: "TO CONFIRM DOCS _ 5AAT-45299 _ BUSAN_SOUTH KOREA _ HANSOL",
    body: `Hi team,\n\nPlease check the SI and draft BL for 5AAT-45299 and revert.${SIGN("Sathiya Munusamy", "APRIL Far East (M) Sdn Bhd")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_5AAT-45299.txt", fields: S4 },
    ],
    expect: { category: "BL_COMPARISON", outcome: "NEEDS_REVIEW" },
  },
  {
    id: "ft_10",
    thread: "5AAT-45299",
    reply_to: "ft_09",
    day: -1,
    time: "09:30",
    from: "Sathiya Munusamy <sathiya@april-demo.com.my>",
    to: "docs@april-demo.com",
    subject: "RE: TO CONFIRM DOCS _ 5AAT-45299 _ BUSAN_SOUTH KOREA _ HANSOL",
    body: `Sorry, the draft BL was missing. Resending both documents.${SIGN("Sathiya Munusamy", "APRIL Far East (M) Sdn Bhd")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_5AAT-45299.txt", fields: S4 },
      {
        role: "BL",
        format: "pdf",
        name: "BL_OOLU5310033092.pdf",
        fields: with_(S4, { notify_party: "SAME AS CONSIGNEE" }),
      },
    ],
    expect: {
      category: "BL_COMPARISON",
      outcome: "MISMATCH",
      defects: ["notify_party"],
    },
  },
  // ---- PDF where label and value are one text run ----
  {
    id: "ft_11",
    day: -5,
    time: "11:48",
    from: "Teo Ei Leen <teo.eileen@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "TO CONFIRM DOCS _ 5SUS-86999 _ FREMANTLE_AUSTRALIA _ CERIEX",
    body: `Dear Arlene,\n\nPls assist to check the draft BL against the SI and revert with any discrepancy asap.${SIGN("Teo Ei Leen")}`,
    docs: [
      {
        role: "SI",
        format: "pdf-merged",
        name: "SI_5SUS-86999.pdf",
        fields: S5,
      },
      {
        role: "BL",
        format: "pdf-merged",
        name: "DraftBL_5SUS-86999.pdf",
        fields: with_(S5, { port_of_discharge: "BUSAN, SOUTH KOREA" }),
      },
    ],
    expect: {
      category: "BL_COMPARISON",
      outcome: "MISMATCH",
      defects: ["port_of_discharge"],
    },
  },
  // ---- Invoice questions ----
  {
    id: "ft_12",
    day: -2,
    time: "10:15",
    from: "Nirmala Devi <nirmala@fujito-demo.com>",
    to: "billing@april-demo.com",
    subject:
      "REQUEST TO CANCEL INVOICE 5250070084 - PACIFIC OFFICE (M) SDN BHD - 5RSG-40824",
    body: "Hi,\n\nPlease cancel invoice 5250070084 as it was issued to the wrong party, and reissue to Pacific Office (M) Sdn Bhd.\n\nThank you,\nNirmala",
    docs: [],
    expect: { category: "INVOICE_QUERY" },
  },
  {
    id: "ft_13",
    thread: "5AKR-61849",
    day: -3,
    time: "16:20",
    from: "Kargosmar Accounts <accounts@kargosmar-demo.com>",
    to: "billing@april-demo.com",
    subject:
      "LOCAL CHARGES FOB - KARGOSMAR - 5AKR-61849 - TELEX RELEASE CHARGES",
    body: "Dear Sir/Madam,\n\nQuery on invoice 5250075931: why are telex release charges billed when the terms are FOB? Please advise the breakdown.\n\nRegards,\nKargosmar Accounts",
    docs: [],
    expect: { category: "INVOICE_QUERY" },
  },
  {
    id: "ft_14",
    thread: "5AKR-61849",
    reply_to: "ft_13",
    day: 0,
    time: "09:05",
    from: "Kargosmar Accounts <accounts@kargosmar-demo.com>",
    to: "billing@april-demo.com",
    subject:
      "RE: LOCAL CHARGES FOB - KARGOSMAR - 5AKR-61849 - TELEX RELEASE CHARGES",
    body: "Dear Sir/Madam,\n\nStill waiting for your reply on invoice 5250075931. Please advise today — the cargo is on hold until this is settled.\n\nRegards,\nKargosmar Accounts",
    docs: [],
    expect: { category: "INVOICE_QUERY", urgent: true, deadline: 0 },
  },
  // ---- Scanned PDF without text ----
  {
    id: "ft_15",
    day: -1,
    time: "12:12",
    from: "Elisa Tukiman <elisa_tukiman@april-demo.com.my>",
    to: "docs@april-demo.com",
    subject: "TO CONFIRM DOCS _ 5APH-26773 _ MERSIN_TURKEY _ UAB NOVAKOPA",
    body: `Hi,\n\nScanned SI and draft BL attached for 5APH-26773. Please check.${SIGN("Elisa Tukiman", "APRIL Far East (M) Sdn Bhd")}`,
    docs: [
      {
        role: "SI",
        format: "pdf-scan",
        name: "SCAN_SI_5APH-26773.pdf",
        fields: {},
      },
      {
        role: "BL",
        format: "pdf-scan",
        name: "SCAN_BL_5APH-26773.pdf",
        fields: {},
      },
    ],
    expect: { category: "BL_COMPARISON", outcome: "NEEDS_REVIEW" },
  },
  // ---- Conversation linked only by reply headers (no order number) ----
  {
    id: "ft_16",
    thread: "NHAVA-058",
    day: -3,
    time: "08:55",
    from: "Hanna Azhari <hanna_azhari@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "Draft BL MMSS 2507 V.257087E NHAVA SHEVA - amend BL 058",
    body: `Hi,\n\nPlease check the attached draft BL 058 against our SI before we send amendments to the carrier.${SIGN("Hanna Azhari")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_BL058.txt", fields: S8 },
      {
        role: "BL",
        format: "txt",
        name: "DRAFT_BL_058.txt",
        fields: with_(S8, {
          shipper:
            "APRIL FINE PAPPER TRADING PTE LTD\n77 ROBINSON ROAD #21-01, SINGAPORE 068896",
        }),
      },
    ],
    expect: {
      category: "BL_COMPARISON",
      outcome: "MISMATCH",
      defects: ["shipper"],
    },
  },
  {
    id: "ft_17",
    thread: "NHAVA-058",
    reply_to: "ft_16",
    day: -2,
    time: "17:30",
    from: "Hanna Azhari <hanna_azhari@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "RE: Draft BL MMSS 2507 V.257087E NHAVA SHEVA - amend BL 058",
    body: `Carrier has corrected the shipper name. Revised draft attached.${SIGN("Hanna Azhari")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_BL058.txt", fields: S8 },
      { role: "BL", format: "txt", name: "DRAFT_BL_058_REV.txt", fields: S8 },
    ],
    expect: { category: "BL_COMPARISON", outcome: "OK" },
  },
  // ---- Weight also mentioned in remarks (must not be silently trusted) ----
  {
    id: "ft_18",
    day: -1,
    time: "14:44",
    from: "Willy Situmorang <willy_s@april-demo.com>",
    to: "docs@april-demo.com",
    subject:
      "TO CONFIRM DOCS _ 5RSG-00133 _ JEBEL ALI_UAE _ OFFICE SUPPLY SOLUTIONS",
    body: `Hi Najiha,\n\nAttached are the SI and draft BL for OC 5RSG-00133. Please check the details and confirm.${SIGN("Willy Situmorang")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_5RSG-00133.txt", fields: S9 },
      {
        role: "BL",
        format: "txt",
        name: "BL_5RSG-00133.txt",
        fields: S9,
        extra: ["Remarks: gross weight amended to 112,030 KG per shipper"],
      },
    ],
    expect: { category: "BL_COMPARISON", outcome: "NEEDS_REVIEW" },
  },
  // ---- SI + BL + commercial invoice attached ----
  {
    id: "ft_19",
    day: -6,
    time: "10:40",
    from: "Deswita Elvyani <deswita@april-demo.com>",
    to: "docs@april-demo.com",
    subject:
      "TO CONFIRM DOCS _ 5RAE-20163 _ JEBEL ALI_UAE _ OFFICE SUPPLY SOLUTIONS",
    body: `Dear team,\n\nSI, draft BL and commercial invoice attached for 5RAE-20163. Kindly verify the SI against the BL.${SIGN("Deswita Elvyani")}`,
    docs: [
      { role: "SI", format: "txt", name: "SI_5RAE-20163.txt", fields: S9 },
      { role: "BL", format: "txt", name: "BL_5RAE-20163.txt", fields: S9 },
      { role: "INVOICE", format: "txt", name: "CI_5RAE-20163.txt", fields: {} },
    ],
    expect: { category: "BL_COMPARISON", outcome: "OK" },
  },
  // ---- General operations ----
  {
    id: "ft_20",
    day: 0,
    time: "06:30",
    from: "Port Klang Planning <noreply@westport-demo.my>",
    to: "ops@april-demo.com",
    subject: "Daily berthing report - {{d:0|dMonY}}",
    body: "Kindly find the daily berthing report below.\n\nVessel MMSS 2507 V.257087E — berthing {{d:+2|dMonY}}, CY closing {{d:+1|dMonY}}.\nVessel SOLID 16 V.044NW2 — berthing {{d:+4|dMonY}}.\n\nThis is an automated message.",
    docs: [],
    expect: { category: "GENERAL" },
  },
  {
    id: "ft_21",
    day: -1,
    time: "17:05",
    from: "HR April <hr@april-demo.com>",
    to: "all@april-demo.com",
    subject: "Office closure notice",
    body: "Dear colleagues,\n\nPlease note the office will be closed on {{d:+6|dMonY}} for the public holiday. Operations resume the next working day.\n\nHR Department",
    docs: [],
    expect: { category: "GENERAL" },
  },
  {
    id: "ft_22",
    day: -4,
    time: "11:00",
    from: "Logistics Planning <planning@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "Delivery planning - containers loading next week",
    body: "Hi all,\n\nSharing the loading plan for next week. No action needed unless your shipment is missing from the list.\n\nThanks,\nPlanning",
    docs: [],
    expect: { category: "GENERAL" },
  },
  // ---- Spam and phishing ----
  {
    id: "ft_23",
    day: 0,
    time: "03:14",
    from: "Mail Admin <admin@secure-mailbox-verify.xyz>",
    to: "docs@april-demo.com",
    subject: "Your mailbox storage is full - verify your account now",
    body: "Dear user,\n\nYour mailbox has exceeded its storage limit. Click here within 24 hours to verify your password or your account will be suspended.\n\nMail Administrator",
    docs: [],
    expect: { category: "SPAM" },
  },
  {
    id: "ft_24",
    day: -2,
    time: "22:40",
    from: "Growth Team <info@crypto-invest-demo.net>",
    to: "docs@april-demo.com",
    subject: "Increase your shipping revenue with this ONE weird trick",
    body: "Hello!\n\nThousands of freight forwarders doubled their profit. Buy now before this deal expires! Guaranteed 300% returns.\n\nUnsubscribe",
    docs: [],
    expect: { category: "SPAM" },
  },
  {
    id: "ft_25",
    day: -1,
    time: "01:20",
    from: "Billing Dept <billing@invoice-payments-demo.top>",
    to: "billing@april-demo.com",
    subject: "INVOICE OVERDUE!!! Pay now to avoid legal action",
    body: "Your invoice is overdue. Click the secure link below and enter your bank details to pay immediately, otherwise legal action will start today.\n\nhttp://pay-now.example.invalid",
    docs: [],
    expect: { category: "SPAM" },
  },
  // ---- Customer asks for SI with PO numbers ----
  {
    id: "ft_26",
    day: -2,
    time: "09:50",
    from: "Guan Cheng Lee <guancheng_lee@april-demo.com.my>",
    to: "docs@april-demo.com",
    subject: "SI NEEDED_ 5APH-26780 _ UAB NOVAKOPA _ PO_25_2186 _ MERSIN",
    body: "Hi,\n\nPlease prepare the SI for PO 25_2186 (order 5APH-26780). Customer requests the SI by {{d:+3|dmy}}.\n\nThanks,\nGuan Cheng",
    docs: [],
    expect: { category: "SI_REQUEST", deadline: 3 },
  },
  // ---- Short, informal request with documents ----
  {
    id: "ft_27",
    day: 0,
    time: "10:32",
    from: "Mitchelle Ting <mitchelle_ting@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "pls check bl 5RCY-72046",
    body: "hi, pls check attached vs SI. thx\n\nMitchelle",
    docs: [
      {
        role: "SI",
        format: "txt",
        name: "5RCY-72046 SI.txt",
        fields: with_(S8, { port_of_discharge: "MUNDRA, INDIA" }),
      },
      {
        role: "BL",
        format: "pdf",
        name: "5RCY-72046 BL.pdf",
        fields: with_(S8, {
          port_of_discharge: "MUNDRA, INDIA",
          gross_weight_kg: "45.88 MT",
        }),
      },
    ],
    expect: { category: "BL_COMPARISON", outcome: "OK" },
  },
  {
    id: "ft_28",
    day: -7,
    time: "15:15",
    from: "Arlene Yamomo <arlene_yamomo@april-demo.com>",
    to: "docs@april-demo.com",
    subject: "Total Freight - INDIA - 5ALT-38425",
    body: "Hi Najiha,\n\nQuery on invoice 5250071354: is the THC / local charge included in the total freight or billed separately?\n\nThanks,\nArlene",
    docs: [],
    expect: { category: "INVOICE_QUERY" },
  },
];

// ---------------------------------------------------------------- rendering

const LABELS: Record<Field, [string, string]> = {
  shipper: ["Shipper", "Shipper/Exporter"],
  consignee: ["Consignee", "Consignee"],
  notify_party: ["Notify Party", "NOTIFY PARTY"],
  port_of_loading: ["Port of Loading", "POL"],
  port_of_discharge: ["Port of Discharge", "Port of Discharge (POD)"],
  container_count: ["No. of Containers", "Container Count"],
  gross_weight_kg: ["Gross Weight", "Gross Weight (KG)"],
};
const ORDER: Field[] = [
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "port_of_discharge",
  "container_count",
  "gross_weight_kg",
];
function title(role: DocSpec["role"]) {
  return role === "SI"
    ? "SHIPPING INSTRUCTION"
    : role === "BL"
      ? "DRAFT BILL OF LADING"
      : "COMMERCIAL INVOICE";
}
/** Text lines of a document, "Label: value" with multi-line party blocks. */
export function documentLines(doc: DocSpec, variant = 0): string[] {
  if (doc.role === "INVOICE")
    return [
      title(doc.role),
      "Invoice No.: CI-2026-0917",
      "Description of Goods: COATED PAPER A4 80GSM",
      "Amount: USD 48,210.00",
    ];
  const lines = [title(doc.role), "=".repeat(38)];
  for (const field of ORDER) {
    const value = doc.fields[field];
    if (value === undefined) continue;
    const [first, ...rest] = value.split("\n");
    // A tonnes value is never printed under a "(KG)" heading.
    const label =
      field === "gross_weight_kg" && /\bMT\b/i.test(first)
        ? "Gross Weight"
        : LABELS[field][variant % 2];
    lines.push(`${label}: ${first}`);
    lines.push(...rest);
  }
  lines.push(
    "Vessel: MMSS 2507 V.257087E",
    "Freight: PREPAID",
    ...(doc.extra ?? []),
  );
  return lines;
}

function pdfEscape(value: string) {
  return value
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, "?");
}
/** Tiny PDF writer: one page, Helvetica, positioned text (no dependencies). */
export function renderPdf(
  rows: { x: number; y: number; text: string; size?: number }[],
) {
  const content = rows
    .map(
      (row) =>
        `BT /F1 ${row.size ?? 10} Tf ${row.x} ${row.y} Td (${pdfEscape(row.text)}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
}
/** Minimal Word document with one paragraph per line. */
export function renderDocx(lines: string[]) {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = lines
    .map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`,
    )
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    ),
  });
}

export function renderDocument(doc: DocSpec): {
  name: string;
  bytes: Uint8Array;
  type: string;
} {
  if (doc.format === "txt")
    return {
      name: doc.name,
      bytes: strToU8(documentLines(doc).join("\n")),
      type: "text/plain",
    };
  if (doc.format === "docx")
    return {
      name: doc.name,
      bytes: renderDocx(documentLines(doc, 1)),
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  if (doc.format === "pdf-scan")
    return {
      name: doc.name,
      // A scan has no text layer: only a drawn rectangle.
      bytes: renderPdf([]),
      type: "application/pdf",
    };
  // Table layout: label and value are separate cells on the same baseline,
  // or (pdf-merged) one text run as many PDF writers produce.
  const rows: { x: number; y: number; text: string; size?: number }[] = [];
  let y = 790;
  rows.push({ x: 50, y, text: title(doc.role), size: 14 });
  y -= 30;
  if (doc.role === "INVOICE")
    for (const line of documentLines(doc).slice(1)) {
      rows.push({ x: 50, y, text: line });
      y -= 16;
    }
  else
    for (const field of ORDER) {
      const value = doc.fields[field];
      if (value === undefined) continue;
      const [first, ...rest] = value.split("\n");
      const label =
        field === "gross_weight_kg" && /\bMT\b/i.test(first)
          ? "Gross Weight"
          : LABELS[field][1];
      if (doc.format === "pdf-merged")
        rows.push({ x: 50, y, text: `${label}   ${first}` });
      else {
        rows.push({ x: 50, y, text: label });
        rows.push({ x: 210, y, text: first });
      }
      for (const line of rest) {
        y -= 14;
        rows.push({ x: 210, y, text: line });
      }
      y -= 20;
    }
  rows.push(
    { x: 50, y, text: "Ocean Vessel" },
    { x: 210, y, text: "MMSS 2507 V.257087E" },
  );
  for (const line of doc.extra ?? []) {
    y -= 20;
    rows.push({ x: 50, y, text: line });
  }
  return { name: doc.name, bytes: renderPdf(rows), type: "application/pdf" };
}

// Dates in bodies: {{d:+1|dMonY}} etc., relative to the mailbox "today".
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function fillDates(text: string, today: Date) {
  return text.replace(
    /\{\{d:([+-]?\d+)\|(dmy|dMonY|long)\}\}/g,
    (_, offset, format) => {
      const date = new Date(today.getTime() + Number(offset) * 86400000);
      const d = date.getUTCDate(),
        m = date.getUTCMonth(),
        y = date.getUTCFullYear();
      if (format === "dmy")
        return `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`;
      if (format === "dMonY") return `${d} ${MONTHS[m]} ${y}`;
      return `${DAYS[date.getUTCDay()]}, ${LONG_MONTHS[m]} ${d}, ${y}`;
    },
  );
}

function wrap64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary)
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd();
}
export function messageId(scenario: Pick<Scenario, "id">) {
  return `${scenario.id}.fieldtest@cargoguard-demo.invalid`;
}
export function scenarioDate(scenario: Scenario, today: Date) {
  const [hours, minutes] = scenario.time.split(":").map(Number);
  const date = new Date(today.getTime() + scenario.day * 86400000);
  date.setUTCHours(hours - 8, minutes, 0, 0); // times are Malaysia/Singapore (UTC+8)
  return date;
}
/** Render one scenario as an RFC 5322 .eml message. */
export function renderEml(scenario: Scenario, today: Date) {
  const boundary = `cg-${scenario.id}-boundary`;
  const date = scenarioDate(scenario, today);
  const parent = scenario.reply_to
    ? FIELD_TEST.find((item) => item.id === scenario.reply_to)
    : undefined;
  const chain: string[] = [];
  for (
    let cursor = parent;
    cursor;
    cursor = cursor.reply_to
      ? FIELD_TEST.find((item) => item.id === cursor!.reply_to)
      : undefined
  )
    chain.unshift(`<${messageId(cursor)}>`);
  const head = [
    `From: ${scenario.from}`,
    `To: ${scenario.to}`,
    `Subject: ${fillDates(scenario.subject, today)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId(scenario)}>`,
    ...(parent
      ? [
          `In-Reply-To: <${messageId(parent)}>`,
          `References: ${chain.join(" ")}`,
        ]
      : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap64(strToU8(fillDates(scenario.body, today).replace(/\n/g, "\r\n"))),
  ];
  for (const doc of scenario.docs) {
    const file = renderDocument(doc);
    head.push(
      `--${boundary}`,
      `Content-Type: ${file.type}; name="${file.name}"`,
      `Content-Disposition: attachment; filename="${file.name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap64(file.bytes),
    );
  }
  head.push(`--${boundary}--`, "");
  return head.join("\r\n");
}
