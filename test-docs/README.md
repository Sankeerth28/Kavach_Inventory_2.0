# KAVACH synthetic test documents

12 generated documents with answer keys (`*.expected.json`) for the AI extraction and matching eval.
All suppliers are fictional and every page is marked "SYNTHETIC TEST DOCUMENT".
Brand names (UltraTech, Asian Paints, etc.) appear only as product descriptions, the way they do on real invoices.

| File | What it tests | Expected behaviour |
|---|---|---|
| inv-001.pdf | Clean printed cement invoice | All fields extracted, MATCHED / NEW |
| inv-002.pdf | Steel 8/12/16/20 mm + binding wire | Sizes never merged (PRD §6.5) |
| inv-003.pdf | CPVC pipes/fittings, SDR spec | Spec and size captured |
| inv-004.pdf | Electrical coils, sq mm sizes | Rolls with 90 m pack size |
| inv-005.jpg | Phone photo of inv-001 (tilt, shadow) | Extracts correctly, then **DUPLICATE INVOICE** blocked |
| inv-006.jpg | Phone photo, hardware | "GI FITTING HEAVY" goes to **REVIEW REQUIRED** |
| inv-007.pdf | 2-page invoice, 15 lines | Pages consolidated, no lines lost |
| ch-008.jpg | Handwritten sand/aggregate challan | Unit "Brass" goes to REVIEW; no invented conversion |
| ch-009.jpg | Handwritten, overwritten qty (6000 struck, 8000) | Qty flagged uncertain; correct = 8000 |
| ch-010.jpg | Printed challan form filled by hand | Grade missing, so it must stay null and not be guessed |
| ch-011.jpg | Handwritten with abbreviations ("Ultra OPC53 300 bg") | Pack size NOT invented as 50 KG |
| bad-012.jpg | Very blurry, dark photo | Quality check fails and asks for recapture |

## Limits
- The "handwriting" is computer-generated with script fonts, so it's easier to read than a real site challan. Add real challans from your sites before trusting the accuracy numbers.
- Prices and GST are illustrative (flat 18%).
- `expected_match_hint` assumes an empty Material Master. Adjust it once you seed materials.

## Use
Copy everything into `test-docs/` in the repo, then tell Fable:
"Use test-docs/*.expected.json as ground truth. Adapt the eval script to this format and run it."
