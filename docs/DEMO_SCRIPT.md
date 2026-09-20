# A five-minute evidence-first demo

Do a full rehearsal. Use synthetic examples only. Keep a local preview as a fallback; do not present a recording as a live run.

## 0:00–0:30 — The business problem

“Averis staff must check draft shipping documents against shipping instructions. One wrong port, consignee or weight can create rework and shipment delays. CargoGuard finds the exact difference, shows the evidence and keeps uncertain documents with a human.”

## 0:30–1:15 — Real inbox processing

Open a fresh workspace. Click Run inbox. Show 520 supplied emails being processed and results saving. Explain the five email categories and seven fields. Once complete: 46 discrepancy pairs, 63 verified pairs, 20 review cases, 91 awaiting documents. Do not call the 91 missing-document requests verified.

## 1:15–2:10 — Explain a real discrepancy

Search email_313. Open it. Container count and gross weight should be highlighted. Show SI expected values beside BL current values. Click source evidence, inspect page positions, then open the original PDF. Download Draft amendment: it prepares an actionable message but sends nothing.

For mixed Word/Excel parsing, search email_097: container count and gross weight differ, but company/address line breaks should not produce false alarms.

## 2:10–3:00 — The unseen-input moment

Click New verification. Use subject “Please compare the attached SI and draft BL”. Select examples/demo-si.txt and examples/demo-bl.txt. These independently authored files are not in the 520-email key. The system should identify the changed discharge port and 500 kg weight difference.

Invite a judge to change one number or port in a COPY of the BL, save it, then upload it. Never edit the organiser source files.

## 3:00–3:40 — Recovery and control

In that new case, click Replace documents. Provide reviewer name and the true reason “Carrier supplied revised draft for this demo”. Upload demo-si.txt and demo-bl-revised.txt. The case becomes verified. Open Audit trail: the earlier mismatch and replacement remain visible.

Show a needs-review organiser example from Review desk. Missing/unreadable documents are not silently accepted. Show the readable replacement path; do not claim automatic OCR exists.

## 3:40–4:25 — Evidence and architecture

Open Performance. “We match all 520 supplied development outputs, catch 46/46 labelled discrepancy cases, and identify 20/20 review cases. We used the released key only for offline evaluation. This is not a held-out or real-world accuracy claim.”

Explain: learned email intent model + explicit rules; evidence-linked document extraction; deterministic comparison; Cloudflare Workers for processing, D1 for cases/audits, R2 for original uploads. No answer-key lookup at runtime.

## 4:25–5:00 — Impact and next step

“Our value is fewer full-document comparisons and faster, evidence-backed exception handling. A pilot will measure median review time, false clearance rate, corrections per case and operator acceptance.”

Do not invent cost savings. If discussing time saved, clearly label assumptions: (baseline minutes − observed assisted minutes) × actual case volume. End with a practical pilot: approved historical documents, corporate access controls, a frozen hold-out benchmark, then OCR and live inbox integration.

## Before submission

Confirm a publicly accessible working URL, public source repository, <=5-minute video, slides and required documentation. Check links in an incognito/signed-out browser. A private owner-only website is not the final judge-accessible deliverable. Confirm the submission portal and timezone with the organiser. Upload before the official deadline, with a buffer.
