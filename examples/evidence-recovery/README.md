# Synthetic unfamiliar-layout demo

These two entirely synthetic documents deliberately describe different shipment details. They are not real shipping instructions. They are development examples, not an untouched accuracy benchmark.

1. Open the public CargoGuard demo and choose **New verification**.
2. Subject: `Compare the attached SI and draft BL`. Body: `Please verify the draft bill of lading against the shipping instruction. Synthetic demonstration only.`
3. Upload both TXT files in this folder. The unfamiliar labels/table should initially require review.
4. Open **Documents**, choose the Shipping Instruction and inspect the exact source. In **Evidence Recovery Copilot**, read the data-sharing notice, confirm synthetic-data consent, and request the proposal.
5. Check the role and every value against the original, including complete party addresses and weight units. Only if all seven are correct, tick their individual confirmations and enter a reviewer name and reason. Never confirm a wrong or incomplete field just to make the demo pass.
6. Repeat for the draft BL. This uses two of the shared owner's capped AI requests. Judges never enter an API key.
7. The expected reviewed outcome is **six discrepancies**, with **Port of discharge (Tema)** matching. See **Resolution** for source-linked next actions and the evidence handoff. The outcome is not permission to release cargo.

If the model abstains or proposes an incorrect value, leave it unconfirmed and use manual review/replacement. If the owner budget or provider is unavailable, the rest of CargoGuard still works; do not substitute a recorded result as a live AI answer.
