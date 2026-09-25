# Response to mentor feedback (final round)

Each point from the review, what changed, and where to see it in the app.

## 1. Reply to email with an AI draft (like Gmail)

- New **Reply** tab in every case. It works like a Gmail composer: To, Cc and
  Subject fields ("RE: …"), a large message box, and your signature.
- *What do you want to say?* offers six choices; the one that fits the case is
  pre-selected: ask for a corrected BL, confirm the documents match, ask for
  missing documents, ask the sender to clarify or resend, acknowledge, or a
  blank reply. Three tones: Formal, Friendly or Short.
- The draft is written **from the checked values**, for example
  `Per our SI: 68,450 KG / Draft BL shows: 68,540 KG`, with the order, PO,
  booking and invoice numbers, and greets the sender by name (taken from the
  signature). It lists what to double-check before sending.
- Buttons, all in one row: **Send** (with Gmail connected, after a
  confirmation), **Save to Gmail drafts** (lands in the same Gmail
  conversation), **Open in Gmail**, **Copy**, **Download .eml**.
- Optional **Improve wording** with OpenAI. It is rejected
  automatically if it changes any value, reference or date.
- Every status card has one button such as *Write correction email*, which
  opens the reply ready to go.

Code: `lib/reply.ts`, `components/reply-composer.tsx`, `lib/reply-ai.ts`,
`app/api/mail/reply`, `app/api/reply`.

## 2. Date and time filter

- Inbox → **Received**: Any date, Today, Yesterday, Last 7 days, Last 30 days,
  or *Choose dates…* (from / to).
- Every email shows when it was received ("Today 09:12", "Sep 18 14:30").
  Imported `.eml` and Gmail emails keep their real date; typed-in emails ask for
  one. The organiser samples have no date: they show "No date", and the filter
  says how many were hidden.
- Sort: *Most urgent first*, *Newest first*, *Oldest first*.

## 3. UI/UX for people who are not comfortable with technology

| Problem raised | What changed |
| --- | --- |
| Navigation is a big issue | **One sidebar on every page**, same order and plain words: *Daily work* (Inbox, Shipments, Reports) and *Setup* (Email accounts, Settings); occasional tools sit inside Settings. The second navigation bar is gone. On phones it becomes a ☰ menu. |
| "Correct value" hidden inside Details | Every value in the comparison has an **Edit** button beside it. Editing happens in place. |
| Buttons everywhere, up and down | A case has **one action area**: the top bar (Back, Previous/Next, More ▾) and **one recommended button** in the status card. Rarely used actions (upload corrected BL, read documents again, change email type, print, assistant) are under *More*. |
| Need action / Differences / Review boxes overlap | Replaced with three colour tiles (**Mismatch · Needs review · Reply needed**) and simple tabs: **To do · Waiting for reply · Done · FYI & spam · All**. |
| Where do I focus? | A slim **Next up** bar at the top of the inbox with the reason ("Documents do not match · Cut-off tomorrow · Waiting 6 days") and one *Open* button. Previous/Next keeps the same order inside a case. |
| Opening a case catches the wrong attention | The case opens with the subject, the sender and date, then **one coloured status card** in plain words ("3 details do not match the SI — Different: consignee, gross weight. Ask the sender to correct the draft BL.") and its button. Details sit in tabs below. |
| Typography: words suddenly big or small | One type scale (13 / 14 / 15 / 16 / 18 / 22 / 26 / 30 px) across every page, with nothing below 13 px. More than 30 sizes (8–58 px) and over 550 rules were normalised. |
| Better comparison design | Side by side: *Detail · Shipping Instruction (the correct value) · Draft BL*. Problems are listed first; the **differing words are highlighted**. **Edit** opens in place and shows the effect before saving ("This fixes 1 difference"). After saving the row flashes green and keeps a *Corrected by a reviewer* badge. The rows do not jump around while you work. |

Code: `components/app-shell.tsx`, `components/inbox-view.tsx`,
`components/case-view.tsx`, `components/compare-table.tsx`, `app/ui.css`.

## 4. PDF extraction and import

- **Add files one by one or all at once** (and drag and drop). Each file shows
  its size and an ✕ to remove it; problems are shown per file (for example
  Outlook `.msg` → "save as .eml").
- **Import real emails**: drop `.eml` files (Gmail: ⋮ → *Download message*;
  Outlook: *Save as*). The sender, date, reply headers and attachments are read
  automatically; each `.eml` becomes its own case. Several at once is fine.
  Unsupported attachments are listed, never silently dropped. Importing the same
  message again opens the saved case.
- PDF reading improved: rows where the label and value are one text run
  (`Gross Weight (KG)   42,500 KG`) are now read. `TWO (2) X 40' HC` style
  counts are understood. All 520 organiser outputs are unchanged.

Code: `components/import-dialog.tsx`, `lib/eml.ts`, `app/api/upload`,
`lib/compare.ts` (`inlineLabelSplit`), `lib/normalization.ts`.

## 5. Emails about the same order are one conversation (`5RFR-36541`)

- Emails are grouped automatically by (1) reply headers or Gmail thread,
  (2) the same order number in the subject such as `5RFR-36541`, (3) the order
  number in the body when it is the only one, and (4) identical subjects without
  references. Spam is never grouped.
- Inbox: *Group conversations* shows the most urgent email of each
  conversation with "Show 3 more emails in this conversation".
- **Deep dive**: in a case, the *Email & conversation* tab shows every email
  about the order in time order with its status, all order/PO/booking/invoice/
  container numbers across the conversation, and deadlines mentioned (and by
  whom). It also shows the **earlier messages quoted inside the email** (the
  From / Sent / Subject blocks) as a timeline.

Code: `lib/mail-intel.ts` (`extractReferences`, `groupThreads`,
`quotedHistory`).

## 6. Automatic import from Gmail (including login)

**Setup → Email accounts** offers *Sign in with Google* (OAuth, recommended)
or *Sign in with email & app password* (Gmail, Outlook.com, Yahoo; no developer
setup). New mail is then imported every few minutes while CargoGuard is open,
with a *Check for new email* button and the last check time on the inbox. Setup:
[GMAIL_SETUP.md](GMAIL_SETUP.md).

## 7. Planning: what is most urgent?

Every email gets a priority (Urgent / High / Normal / Low) from visible reasons:

- the problem type (differences > missing documents > unclear > not checked);
- **deadlines written in the email**: cut-off, ETD, payment, "by 25/09",
  "today", "tomorrow", resolved against the email's own date;
- urgency words in the newest message only (urgent, ASAP, final reminder,
  on hold, demurrage, rollover), ignoring quoted history;
- overdue or reopened follow-ups, and how long the email has waited.

The inbox is sorted by this by default; each row shows the reasons and a
deadline chip ("Cut-off tomorrow", "Due 2 days ago"). **Download today's plan**
(Inbox and Reports) gives a printable list in that order. Code:
`lib/priority.ts`.

## 8. Test with our own dataset (not 100%)

We wrote a 28-email Averis-style mailbox with real headers, dates,
conversations, PDF/Word files, unit variations, scans and phishing. It is not
from the organiser generator. Results and remaining mistakes are in
[FIELD_TEST.md](FIELD_TEST.md) and on *Reports → Accuracy tests*. Anyone can load
it in one click (*Import email → Load 28 practice emails*).

## 9. Stronger than a team that trained its own LLM

A custom LLM gives an answer; CargoGuard gives an answer **you can check**:

- **Deterministic where it matters**: the seven fields are compared as typed
  values (weights as numbers, MT vs KG, container counts, port codes), never
  "guessed". Missing or contradictory values are never treated as a match.
- **Learned where language varies**: the email router is a trained model, now
  corroborated by the attachments (one SI + one BL identified) and by the
  conversation.
- **LLM only for wording and hard layouts**, behind a fact guard: an AI reply
  that changes any number or name is rejected. No hallucinated weights.
- **Honest measurement**: we publish our own test set and its mistakes.
- **Conversation-aware and time-aware**: most LLM demos classify one email at
  a time; we group the whole order history and plan by real deadlines.
- Runs with **no paid AI**, so it is cheap, fast (inbox insights for 520
  emails in about 45 ms) and keeps customer data in the company.
- **Ask CargoGuard is a planning assistant, not a chatbot.** It answers
  "what should I do first?", "what is due this week?", "show open POs",
  "everything about 5RFR-36541 / PO 25_1234 / invoice 5250074586",
  "who am I waiting on?" and "which documents do not match?" instantly from
  the saved inbox, and every answer lists the emails behind it with an
  *Open* button. When an administrator adds an AI key and a question is not
  understood, OpenAI reads **only the typed question** (never an email,
  subject, sender or status) and returns a checked search plan that runs on
  the saved inbox in the browser. Any reference or word in the plan must
  appear in the question, otherwise the plan is **rejected**.

## 10. What each person needs

| Who | What they get |
| --- | --- |
| Documentation officer | One inbox sorted by urgency, a *Next up* bar, side-by-side check with edit in place, one-click reply draft, Gmail drafts |
| Reviewer / supervisor | Every correction with name and reason, full history per case, activity log, bulk completion of matching cases |
| Team lead / manager | Reports, where drafts differ, downloadable plan / shift brief / follow-up handover |
| Customer, carrier and finance counterparts | Faster, precise replies that quote the exact SI value and reference numbers |
| IT / security | Encrypted mailbox tokens, single-use sign-in state, no automatic sending, team roles, audit trail |

## 11. Better than the current Averis workflow

Today staff read each email, open both documents and compare fields by eye,
then type the reply. CargoGuard reads the email and attachments (PDF, Word,
Excel, text, scans with OCR), compares all seven fields in seconds, highlights
the exact words that differ, writes the reply with the correct values, groups
the whole order conversation, and puts the most urgent email first, with every
decision recorded.

## Round 2–4 changes (UI/UX review)

Designed around what an operations officer needs from the use case — *which
email, is there a mismatch, what needs attention* — and nothing more on screen.

- **Five menu items**: Inbox, Shipments, Reports, Email accounts, Settings.
  Occasional tools (Label rules, SI templates, Search saved results) sit under
  Settings with a breadcrumb back.
- **Inbox**: a slim **Next up** bar, then three colour tiles for the kinds of
  work — **Mismatch**, **Needs review** (unclear or missing documents) and
  **Reply needed** (SI requests, invoice questions, follow-ups). One list panel
  with *To do · Waiting for reply · Done · FYI & spam · All emails* tabs, a
  search box, date/type/sort filters and table-like rows.
- **Case page**: one header card that ends in a single status line
  (*1 detail does not match the SI — Different: notify party*, or **No
  mismatch detected**) with the recommended button; standard tabs *SI vs BL
  check · Reply · Follow-up · Email & conversation · Documents · History*; the
  SI and BL values with the differing characters highlighted directly below.
- **Reports**: one summary strip (Emails checked · Mismatch found · Needs
  review · No mismatch detected), a **Document checks** table (email, result,
  what to check — click to open), common differences and other emails.
  *Today's plan* and one *Download* menu in the header. Engineering and
  accuracy detail moved to a separate *Accuracy* tab.
- **Shorter wording everywhere**: no demo banner, no explanatory paragraphs on
  Shipments, Settings, Label rules or SI templates, no server variable names
  shown to staff, empty panels hidden.
- **Averis logo**, readable text (minimum 14 px, body 17 px), one set of
  colours and buttons on every page, and plain words (no router jargon, no PDF
  coordinates, dates like "Fri 25 Sep").

## Round 5 — closing the loop (after the second review)

What an Averis documentation officer still had to do by hand, and what
CargoGuard now does for them.

| Gap found | What changed | Where |
| --- | --- | --- |
| Replying did not change anything: a "missing documents" email stayed in *To do* after you asked for the documents | Sending from CargoGuard moves the email to **Waiting for reply** (a copied / Gmail / .eml reply asks *"Did you send it?"* once). Answered SI requests, invoice questions and confirmed matches go to **Done**. It comes back to *To do* by itself when **anyone writes again in the same conversation**, or at 09:00 on the next working day if nobody answers. | `components/reply-composer.tsx`, `recordReply` in `components/workbench.tsx`, `lib/conversation.ts` |
| Priority relied on words like "ASAP", which almost every shipping email contains | Priority is now **impact + time + chasing + age**: a wrong port of discharge (cargo to the wrong port) ranks above a wrong notify party; real dates in the email (cut-off, ETD, payment); strong words only (*final reminder, on hold, demurrage, rollover*) — plain "ASAP" adds almost nothing; how many emails the sender has written about the order; how long it has waited. Unchecked emails get no urgency from their wording, so phishing can never be "Next up". Every case shows **Why is this urgent?** | `lib/priority.ts`, `lib/field-risk.ts` |
| A difference did not say why it matters | Each mismatch shows **If not corrected: …** (e.g. *a container can be left off the BL — it then cannot be released at destination*) | `components/compare-table.tsx` |
| The eye still had to scan 7 rows | Details that already match are folded into one green line (*6 other details match — Show them*); only problems are open | `components/compare-table.tsx` |
| Revised drafts had to be re-read from zero | When a newer draft arrives in the same conversation, CargoGuard compares it with the previous one: **Fixed: consignee, weight · Still wrong: … · New problem: containers**. When a newer draft matches, the older draft moves to Done (*Corrected draft received*); an SI request moves to Done once the draft BL for that order has arrived | `lib/conversation.ts` (`draftProgress`, `planContexts`) |
| Shipments page was empty until someone created shipments by hand | **Orders** are built automatically from order numbers: one card per order with a 4-step progress line (*Shipping Instruction → Draft BL check → Corrections → BL confirmed*), the next deadline and *Open next email*. A **This week** calendar shows every cut-off, ETD, payment date and reply reminder found in the emails. The manual tracker is one tab away | `lib/orders.ts`, `components/order-board.tsx` |
| No view of where mistakes come from | Reports → **Who sends drafts with mistakes** (per company: 6 of 10 drafts wrong, most often containers). The case page warns: *Heads-up: 6 of 10 earlier drafts from fujitogrp.com had differences — most often containers* | `lib/sender-insights.ts` |
| Inbox had tiles *and* tabs *and* filters | The three kinds of work are now a row inside *To do* (Everything · Mismatch · Needs review · Reply needed), so the tabs and their filters are in one place | `components/inbox-view.tsx` |
| Pressing a button to check new emails | New emails are checked automatically when the inbox opens | `components/workbench.tsx` |
| Follow-up was a 6-field form | One click: *Waiting for the sender — remind me next working day / in 2 working days / in a week* or *Mark as done*; the full form is under *More details* | `components/follow-up-desk.tsx` |
| Date filter had no time | *Last 24 hours* added; *Choose dates…* takes a date **and time** | `lib/priority.ts` |
| SI requests and invoice questions opened on an empty "SI vs BL" tab | They open on the email itself | `components/workbench.tsx` |

Tests: `tests/mentor-round2.test.ts`.

## Round 6 — independent review fixes

A second reviewer tested edge cases. Each finding was reproduced before it
was fixed; tests are in `tests/review-round3.test.ts`.

| Finding | Fix |
| --- | --- |
| Two unrelated emails with the same subject ("Draft BL for review") could close each other's open problem | A same subject only groups emails in the list. Closing or comparing drafts needs proof: the same order number or BL/booking number, reply headers, or the same Gmail thread (`sameShipment` in `lib/conversation.ts`). |
| Replying with "we are checking" could move an invoice question to Done | After any reply the employee chooses **Waiting for their answer**, **Still working on it** (stays in To do with a reminder) or **Finished**. The suggestion follows the reply type; *Finished* is disabled, with the reason, while differences, missing documents or a safety finding are open. |
| Batch completion accepted general emails; individual completion ignored the extra safety checks | Batch completion requires a complete, matching SI/BL check. Completing a check with an open safety finding (container number check digit, weights) requires the person to tick that they looked; the server enforces it and records it. Such emails stay in To do (*Extra check needed*) instead of silently going to Done. |
| HS codes and BL numbers were read as container numbers | "HS CODE 48025700" and labelled BL numbers such as "B/L No.: SINF93802620" are no longer reported (6 of 68 matching organiser checks still show a real container-number finding, down from 17). |
| Gmail/IMAP import could miss older mail once the first page was already imported | Import walks page by page until it has the new emails it needs, and says *more emails waiting* when there is a backlog. |
| Revision history said "pair unchanged" after a BL replacement | The compared files are identified by content fingerprint, and changes in the extra safety checks are shown separately. |
| Order timeline claimed "SI sent" / "Carrier corrected the BL" | Wording now states the evidence: *Draft BL received, so the SI was used*, *A newer draft matches the SI*. |
| Automatic orders and tracked shipments were two separate worlds | **Track this order** turns an automatic order into a tracked shipment with all its emails linked, for owner, confirmed deadlines and amendments. |

Also added: **Write reply with AI** (with an OpenAI key). The AI writes the
reply from the incoming email and the checked values; CargoGuard rejects its
text if any checked value is lost **or** if it adds a number, date, time,
address or link that is not in the email or the documents. **Ask
CargoGuard** now explains an order's progress and what the newest draft
fixed, and answers *Who sends drafts with mistakes?*

## How to demo in five minutes

1. Inbox → *Import email* → **Load 28 practice emails**.
2. The *Next up* bar shows the most urgent email (`5RFR-36541` draft BL,
   due tomorrow). Click **Open**.
3. The red status line says what is wrong. Below it, the SI vs BL check shows
   both values side by side with the differing characters highlighted. Click **Edit** on a value to see in-place
   correction.
4. Click **Write correction email**: the reply is ready with the exact values.
5. Open *Email & conversation*: every email about `5RFR-36541`, with numbers
   and deadlines.
6. Back to the inbox: click **Mismatch**, try *Received → Today*
   and *Group conversations*.
6a. Open *RE: … 5RFR-36541 – REVISED DRAFT BL*: the red card says the
   carrier fixed three details but introduced a new container mistake.
6b. On any mismatch click **Write correction email → Download .eml → Yes, I
   sent it**: the email moves to *Waiting for reply* with a reminder date.
6c. *Shipments*: order 5RFR-36541 shows its four steps and the *This week*
   calendar.
7. *Reports*: the Document checks table lists every checked email with its
   result and what to check.
8. *Email accounts*: connect Gmail with an app password; new mail arrives by
   itself.
9. **Ask CargoGuard** (bottom right): *What should I do first today?*, then
   type `5RFR-36541` or *Show open POs*. Click *Open* on any answer.
