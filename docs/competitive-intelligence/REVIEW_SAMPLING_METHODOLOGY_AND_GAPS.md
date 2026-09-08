# Review Sampling Methodology and Gaps (2026-09-07)

This addendum responds directly to the release-gate audit finding that the original competitive research did not actually read and tally 25 individual reviews per product. It reports what was done in this correction pass, the real numbers achieved, and what remains short of the requested standard, rather than converting an estimate into a claim.

## What changed in this pass

Additional targeted web searches retrieved real, current (2026-09-07) aggregate population counts and rating data directly from Capterra/G2 listing pages for all eight required products, plus feature and review data for the three tax-preparation suites the original pass omitted: Intuit ProConnect Tax, Drake Tax, and UltraTax CS (added to `COMPETITOR_FEATURE_MATRIX_2026.md`). A structured dataset was created at `review-sample-2026.csv` with the fields the audit specified (competitor, source, review_date, rating, pain_point_theme, positive_theme, workflow_affected, severity, source_url).

## Aggregate review population sizes retrieved (2026-09-07)

- QuickBooks Online: 4.0/5 on G2; 4.3/5 on Capterra; Trustpilot around 1.1/5 (different, complaint-skewed population).
- Wave: 4.4/5 on Capterra (308 reviews in the specific listing retrieved).
- TaxDome: 4.7/5 on G2, reported as 3,500+ reviews overall with 712 individually-readable reviews on the G2 reviews page itself.
- MyTAXPrepOffice: 4.5/5 on Capterra with 227 reviews; 1.0/5 on ComplaintsBoard (a small, complaint-only population, not representative of the full user base).
- Financial Cents: 4.8/5 on Capterra with 266 reviews (as of July 2026).
- Canopy: 4.5/5 on Capterra with approximately 224-286 reviews depending on the listing snapshot.
- Karbon: 4.7/5 on Capterra with 206 reviews.
- Xero: 4.4/5 on Capterra with approximately 3,269-3,320 reviews.
- Intuit ProConnect Tax: 23 reviews sampled in one retrieved breakdown, 87% positive / 9% neutral / 4% negative.
- Drake Tax and UltraTax CS: no Capterra review-count figure was returned by search for either in this pass; feature and complaint-theme data came from independent review-roundup sites instead (cited in the feature matrix and the CSV).

## Honest accounting against the 25-individual-review-per-product target

None of the eight core products reached a genuine hand-read sample of 25 individual reviews in this pass. What was achieved instead, per product, is a small number of specific, source-cited complaint and praise themes (2-4 rows each in `review-sample-2026.csv`) pulled from review-aggregator summary pages and vendor-independent roundups, plus the real aggregate rating and population size for each product. This is a materially better standard than the original pass (which cited only thematic summaries with no structured dataset and no population counts), but it is not the 25-review manual sample the milestone specified.

**Sample count achieved per product (rows in review-sample-2026.csv, updated 2026-09-08 after a second, larger research pass across Reddit-indexed discussion, Trustpilot, BBB complaint records, and additional Capterra/G2 pages):** QuickBooks Online 9, Wave 10, TaxDome 8, MyTAXPrepOffice 7, Financial Cents 5, Canopy 5, Karbon 5, Xero 6, ProConnect Tax 2, Drake Tax 2, UltraTax CS 2. Core-eight total: 55 sourced observations (up from 22 in the first pass). This remains short of the 25-per-product / 200-total target - see below for why that ceiling was not reachable with the tools available in this session, not for lack of additional search effort.

**Why the gap remains:** the research tool available in this session is a web-search interface that returns an AI-generated summary of top-ranking pages for a query, not raw access to open and read an arbitrary specific review permalink one at a time. A second, substantially larger research pass in this correction (roughly 20 additional targeted queries spanning Reddit-indexed discussion, Trustpilot, BBB complaint records, and further Capterra/G2 pages) more than doubled the sourced observation count for the core eight products, from 22 to 55, and pulled in real Reddit-surfaced and BBB-complaint-record content that the first pass missed entirely. It did not reach 200, because each additional search still returns a small number of new distinct facts rather than 25 individually addressable review records - the tool genuinely cannot enumerate a numbered list of reviews the way a logged-in browser session paging through Capterra could. This is reported as an honest ceiling of the available tooling, not a stopping point chosen for convenience.

## Source distribution

Every row in `review-sample-2026.csv` cites Capterra, G2, Trustpilot, ComplaintsBoard, the vendor's own help/developer documentation, or an independent (non-competitor-authored) review roundup. No row is sourced solely from a competing vendor's own comparison page, per the audit's explicit instruction not to use a rival's comparison article as sole evidence.

## Classification discipline maintained

Every complaint in the feature matrix, the pain-point analysis, and the CSV remains labeled FACT, USER-REPORTED COMPLAINT, INFERENCE, or PRODUCT OPPORTUNITY. MyTAXPrepOffice's accuracy complaints are treated as documented, sourced user reports and a genuine category-level risk to design against - never asserted as a proven systemic defect of that specific product for all its users.

## Recommendation

If a literal 25-per-product hand-read sample is required before this research is considered closed, that should be scoped as its own dedicated research task (likely several hours of directly reading individual review pages per product), not bundled into a code release-gate correction pass.
