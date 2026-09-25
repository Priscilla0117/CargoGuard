# Synthetic amendment-resolution rehearsal

These invented, known rehearsal documents are not a benchmark or a blind holdout. They run through the application's real upload, extraction, persistence, review and completion paths. Nothing needs to be sent outside CargoGuard.

1. Import si-original.txt and bl-original.txt in the Work queue with subject **Verify draft BL against SI — CREATIVE-20260924** and body **Please compare the attached SI and draft BL. Booking: CREATIVE-20260924**.
2. Create a shipment with reference CREATIVE-20260924. Link the imported case and select it as the current comparison.
3. Import a separate email without attachments. Subject: **Shipping update — CREATIVE-20260924**. Body:

   > Booking: CREATIVE-20260924
   >
   > Please change consignee to Synthetic Buyer Two

   Link it to the same shipment. On **Amendment resolution**, select this instruction source email, record the suggested consignee change and approve it with a reason. In team mode a reviewer/admin must perform the approval.
4. Click **Draft revised-SI request**. Inspect the quotation and version in the saved task; this creates a draft, not an email transmission. Keep it open while waiting.
5. Import si-revised.txt and bl-revised-wrong-port.txt with the comparison subject/body from step 1. Link that case and select it as the current comparison.
6. On **Amendment resolution**, inspect the current SI and record incorporation of the approved consignee change with a review note. The desk must still show **Port of discharge** as an unresolved difference outside the requested change. Attempting completion in Documents must be blocked.
7. Import si-revised.txt and bl-corrected.txt, link the new case and select it as the current comparison. Inspect it and record incorporation for this new evidence revision. Resolve the revised-SI task with a note stating that the synthetic documents arrived. Complete the document check from Documents with a reason.
8. Download **Evidence brief** and inspect History. The original sources and earlier unresolved decision remain available. Document-check completion is not cargo-release authority.

The consignee change also exercises SAME AS CONSIGNEE: the notify party is evaluated using the consignee on its own document. The returned wrong-port BL agrees with the requested consignee but is still incorrect overall.

For an automated, isolated local HTTP version of this story, run:

    node --import tsx scripts/test-amendment-api.ts http://127.0.0.1:3066

Run that command only against a local demo-mode server. It creates synthetic cases in a separate browser workspace and writes its report under ignored work/validation/.
