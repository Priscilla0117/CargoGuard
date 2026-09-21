# A five-minute evidence-first demo

Do a full rehearsal. Use synthetic examples only. Keep a local preview as a fallback; do not present a recording as a live run.

## 0:00–0:30 — The business problem

“Averis staff must check draft shipping documents against shipping instructions. One wrong port, consignee or weight can create rework and shipment delays. CargoGuard finds the exact difference, shows the evidence and keeps uncertain documents with a human.”

## 0:30–1:15 — Real inbox processing

Open Work queue in a fresh workspace. Click Run inbox. Show 520 emails being processed and saved. Explain five categories and seven fields. Saved outcomes: 46 discrepancy pairs, 63 verified pairs, 20 review cases, 91 awaiting documents, 300 routed. Task filters group five missing-attachment review cases with Missing documents: 15 Review, 96 Missing documents. Neither group is verified.

## 1:15–2:10 — Explain a real discrepancy

Search email_313. Open it. Container count and gross weight should be highlighted. Show SI expected values beside BL current values. Follow source evidence and open the original PDF. Use Request correction to inspect and explicitly confirm an amendment before downloading; nothing is sent.

For mixed Word/Excel parsing, search email_097: container count and gross weight differ, but company/address line breaks should not produce false alarms.

## 2:10–3:00 — The unseen-input moment

Click Upload documents. Use subject “Please compare the attached SI and draft BL”. Select examples/demo-si.txt and examples/demo-bl.txt. These independently authored files are not in the 520-email key. The system should identify the changed discharge port and 500 kg weight difference.

Invite a judge to change one number or port in a COPY of the BL, save it, then upload it. Never edit the organiser source files.

## 3:00–3:40 — Recovery and control

In that case, click Replace documents. Provide a reviewer name and the true reason “Synthetic corrected draft supplied for this demo”. Upload demo-si.txt and demo-bl-revised.txt. Open History → What changed?: compare earlier and current values, remaining blockers and exact versioned source links. Field matches are document-check results, not cargo-release approval.

Show an organiser example from Work queue → Review. Missing/unreadable evidence is not silently accepted. Sources offers local OCR suggestions for supported scans, followed by seven explicit human confirmations; do not claim unattended OCR approval.

## 3:40–4:25 — Evidence and architecture

Open Reports → Performance. “We match all 520 supplied development outputs, catch 46/46 labelled discrepancy cases, and identify 20/20 review cases. The released key is used only for offline evaluation. This is not held-out or real-world accuracy.” If showing chat, open floating Ask CargoGuard directly; preview and consent before a bounded provider request.

Explain: learned email intent model + explicit rules; optional owner-funded OpenAI source recovery and case chat; deterministic comparison; independent Render/Node cloud processing and persistent Turso storage for cases, audit history and source bytes. No answer-key lookup at runtime.

## 4:25–5:00 — Impact and next step

“Our value is fewer full-document comparisons and faster, evidence-backed exception handling. A pilot will measure median review time, false clearance rate, corrections per case and operator acceptance.”

Do not invent savings. Label any assumptions: (baseline minutes − observed assisted minutes) × actual volume. End with a practical pilot: approved historical documents, corporate access controls, a frozen hold-out benchmark, expanded OCR validation and approved live-inbox integration.

## Before submission

Confirm a publicly accessible working URL, public source repository, <=5-minute video, slides and required documentation. Check links in an incognito/signed-out browser. A private owner-only website is not the final judge-accessible deliverable. Confirm the submission portal and timezone with the organiser. Upload before the official deadline, with a buffer.
