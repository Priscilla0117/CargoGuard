# CargoGuard recording voiceover

Natural narration revision: 21 September 2026. This supersedes the previous narration. Use the matching RECORDING_RUNBOOK.md and REQUIREMENT_PROOF_CHECKLIST.md.

Approximately 566 spoken words. Planned runtime 4:50; this is not a measured recording. Read only the paragraphs below the numbered headings. At 130–140 words per minute, narration alone takes about 4:03–4:22, leaving roughly 28–47 seconds within the plan for pauses and visible results. Rehearse with the footage and check the exported video is under five minutes.

Confirm MozartAI is the registered team name. Use only corrected deck pages 1, 6 and 7. Keep the app visible for most of the video. Show short stage labels: CLASSIFY, EXTRACT, COMPARE, HUMAN REVIEW.

This version connects each sentence to what the viewer sees. Use the matching runbook for exact clicks. Say “here” while pointing to the relevant result, and pause briefly when switching cases. Speak as if explaining the screen to a colleague; do not read the headings or button instructions aloud.

Pronunciation: AI = “ay eye”; POL / P-O-L = “pee oh ell”; API = “ay pee eye”; OpenAI = “open ay eye”; Next.js = “next jay ess”; bill of lading = “bill of LAY-ding”; consignee = “kon-sy-NEE”. The spoken narration uses “bill of lading” in full rather than BL. Read BETA IMPORTS LIMITED naturally as “Beta Imports Limited”, but keep the exact form value BETA IMPORTS LTD.

Keep brief pauses after the opening question and after the linked-field preview changes. Let the viewer read the evidence. The planned timing assumes real footage edited to remove dead time, with narration over the relevant actions. If your measured delivery runs long, shorten navigation footage or nonessential commentary rather than speeding up the recording or hiding a required result.

Important accuracy instructions retained from the requirements audit:

- Classification now shows Reprocess sources and the resulting model/category details, not just a category filter.
- Extraction explicitly links source headings and values to seven structured fields.
- The synthetic preview ends by restoring the exact source value and saving a truthful human confirmation. Do not follow the old instruction to cancel this scene.
- The spoken company name “BETA IMPORTS LIMITED” corresponds to the exact source/form value BETA IMPORTS LTD.
- “Ask for help” in the problem statement means escalation to a human; the chatbot is an additional feature, not a substitute.
- Full OCR recovery and failure/retry evidence have separate proof instructions. Do not imply the short review scene demonstrates those entire workflows.

The AI narration requires a genuine correct answer with relevant sources. Use the recording-guide fallback if unavailable. Label shortened waits and cached responses honestly. All synthetic material stays explicitly labelled. A saved document recheck/field confirmation does not approve a shipment or modify original source files.

## 01 | 0:00–0:30 | The employee’s problem

Would you send this draft back for correction?

The shipping instruction says five containers, but the draft says four.

Before replying, Averis staff need to check the documents and explain what needs changing. Missing a difference like this can lead to more corrections or a delay.

We’re Team MozartAI. Let me show you how CargoGuard helps.

## 02 | 0:30–0:52 | Find the checking request

Let’s start with the email.

It asks us to check a draft bill of lading. I’ll run it through our trained AI classifier.

It separates checking requests from shipping instructions, invoice questions, general messages and spam. Only checking requests go on to document comparison.

## 03 | 0:52–1:18 | Check what the documents actually say

Now let’s look inside the attachments.

This one says ‘Load Port’. The other says ‘P-O-L’. Both mean ‘port of loading’.

CargoGuard extracts the values into the same field, along with six other shipment details.

I can open the source here to check where each value came from.

## 04 | 1:18–1:36 | Make the discrepancy specific

Here’s the comparison, using the shipping instruction as our reference.

We have five containers versus four, and a weight difference of five hundred kilograms. The other five fields match.

So the employee can see exactly what needs checking.

## 05 | 1:36–1:58 | Show what still needs human attention

But sometimes, we don’t have enough information.

Here, an employee needs to check the scan.

And in this case, the draft bill of lading is missing.

CargoGuard keeps both cases incomplete and shows what needs to happen next, so the employee knows what to check or request.

## 06 | 1:58–2:38 | Help the next employee act

Now imagine a colleague takes over the first case.

They can ask CargoGuard, ‘What needs fixing, and what should I do next?’

Before sending, I review what goes to OpenAI and give permission.

The answer explains the differences, with evidence I can open and check.

I can also open a correction draft to help prepare the reply. I review it before sharing. Nothing gets sent automatically.

## 07 | 2:38–3:07 | Make clear which draft was checked

But an email can have several drafts. Which one are we checking?

In this synthetic example, I choose the supplied latest draft, record my reason, and compare again.

All seven fields now match. These other attachments are still marked as not checked.

So the result clearly shows which documents it covers.

## 08 | 3:07–3:44 | See an edit’s effect before saving

While we’re here, watch what happens if I change one detail.

The notify party says ‘same as consignee’. So when I change the consignee, both checks change in this preview.

I can see that effect before saving.

This is just a what-if. I put back BETA IMPORTS LIMITED, as the source says, and save my confirmation with a reason.

Here in History, we can still see the earlier result and follow what happened.

## 09 | 3:44–4:09 | Explain the engineering choices

Our Next.js app runs on Render, with Turso storing files and review history.

Rules compare the document values. Our assistant uses the OpenAI API, but its advice cannot change the saved result. Comparison works without OpenAI.

Before confidential use, we need corporate access controls. For larger workloads, we’d add queued processing and managed file storage.

## 10 | 4:09–4:32 | Show evidence for the claims

So, how did we check it?

In our recorded tests, the results matched expectations for all five hundred and twenty supplied emails. We also passed one hundred and seventy-seven hosted checks.

That includes discrepancy and human-review cases.

These are development results. We still need to test documents the system hasn’t seen.

## 11 | 4:32–4:50 | Close on the employee’s next step

We’d start with an approved pilot using non-confidential documents, and measure review time and missed differences.

Remember those five containers versus four?

Now the employee can explain that difference and prepare the follow-up, with the evidence right here.
