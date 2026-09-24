# Known synthetic final-round rehearsal

These are authored rehearsal fixtures, not unseen accuracy evidence or actual Averis shipments.

1. Import `si-reference.txt` + `bl-initial.txt` with subject **Please verify draft BL against SI**. Expected: weight discrepancy only (SI 42,500 kg; BL 43,000 kg).
2. Open **Follow-up**. Enter your demo reviewer/owner name, reference `DEMO-BOOKING-01`, an explicitly selected due time, and a note. Save **Awaiting reply**. Completion is disabled while the discrepancy remains.
3. Use **Replace documents -> Revised BL only** with `bl-reply-new-issue.txt`. The SI stays unchanged. Expected: weight fixed, new discharge-port discrepancy. **History -> What changed?** shows both; follow-up becomes **Reopened**.
4. Replace only the BL with `bl-final.txt`. Expected: all seven match. Inspect the actual sources, then explicitly save **Check completed** in Follow-up.
5. Download the follow-up handover. Show the owner, reference, due date, exact case revision and current state. History retains each earlier decision and its sources.
6. Optional challenge: replace the BL again with the new-issue file. The earlier completion reopens. The system must not carry yesterday's completion onto today's different evidence.

Nothing is sent to an issuer, and completion never authorizes cargo release. Replace the sample due time explicitly during rehearsal; processing time is not a shipping deadline. A judge may modify a copy for a live input variation; do not describe these supplied fixtures as an untouched holdout.
