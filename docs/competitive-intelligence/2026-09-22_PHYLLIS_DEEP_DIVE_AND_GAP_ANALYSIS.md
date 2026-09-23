# Phyllis Deep Dive, Market Position and Gap Analysis

Written 2026-09-22. Builds on `2026-09-20_market_entry_strategy.md` (still accurate) with current pricing, market data, and an inventory of the code as it stands tonight. Nothing here is a measured result: time and dollar figures are the survey's own estimates or vendor list prices until a pilot measures them.

## 1. What Phyllis actually told us

Source: `Business Systems & Workflow Discovery_Submissions_2026-09-20.csv` (submitted 2026-09-04).

| Question | Her answer |
|---|---|
| Services | Accounting, bookkeeping, tax prep |
| Tools | Excel, Wave, My Tax Prep Office |
| Biggest pain | "Scanning in receipts one by one. Also bank statements having to go through them and mark what are business vs personal expenses" |
| Most frustrating tools | Excel (manual P&Ls) and Wave ("sometimes a lot of things have to be manually entered") |
| What clients need most | "Mostly their profit and loss information", monthly and yearly, by folder: hotel, travel, food, supplies |
| Automation she wants | "Upload receipts, produce profit and loss statements from receipts and bank statements" |
| Time at stake | More than 10 hours per week |
| Number-one wish | "Scan receipts via bulk and put them into the correct folders" |

**Reading between the lines:** her real job is turning a client's shoebox plus bank statement into a categorized P&L, then carrying those numbers into My Tax Prep Office. She did not ask for e-signature, portals, or advisory. Those are only valuable if they remove steps from that one flow.

## 2. Tools she can drop, and what she cannot

| Tool | Cost today | Truepost replaces it? | Honest note |
|---|---|---|---|
| **Wave** | Free Starter lost bank feeds, receipt scanning and extra users on June 1, 2026; those need **Pro at $19/month** ($190/year billed annually) ([source](https://beancount.io/blog/2026/08/05/wave-accounting-bank-feeds-collaborator-paywall-guide)) | **Yes** for receipts, bank CSV review, business/personal decisions, categorized P&L, Wave CSV import | Live bank feeds need Plaid keys (owner item); until then bank data arrives by CSV |
| **Excel (for P&Ls)** | Part of Microsoft 365 | **Yes** for the P&L work | She may keep Excel for other uses; do not promise a license cancellation |
| **Email/paper for client documents and signatures** | Her time | **Yes:** client requests, portal uploads, engagement-letter signing, and pen-signed or in-office Form 8879 at $0 | |
| **My Tax Prep Office** | $695–$1,295/year ([source](https://www.capterra.com/p/179883/my-TAXprep-office/pricing/)) | **No** | It prepares and e-files returns. Truepost hands it copy-ready Schedule C numbers. Filing returns ourselves needs IRS e-file software approval (MeF acceptance testing); do not claim it |

**Per-client savings to quote safely:** Wave Pro is billed per business, so each client kept on Wave Pro costs $190–$228/year. Moving those books into Truepost removes that line. Quote it per client, from the vendor's list price, not as a total until we know her client count.

## 3. Her 10+ hours: where each one goes

| Hour sink (her words) | What removes it | Status |
|---|---|---|
| Scanning receipts one by one | Bulk upload tray (multi-select, phone camera, portal uploads from the client); automatic reading once the client signs the consent | Built. Verify a 200-file batch in the pilot before quoting "no limit" |
| Putting receipts in the right folders | Category suggestions, correction memory (fix once, remembered), per-client and firm-wide rules | Built |
| Marking bank lines business vs personal | Bank CSV review with disposition choices, rules that pre-mark known merchants, receipt-to-transaction matching | Built; automatic bank feeds need Plaid keys |
| Manually entered items in Wave | Exceptions queue: only unclear items reach her | Built |
| Building P&Ls in Excel | Monthly and yearly P&L by category, drill-down to source, spending chart | Built (cash basis) |
| Chasing clients for missing receipts | Missing-receipt requests generated from unmatched bank lines; client answers by link | Built |
| Re-typing numbers into My Tax Prep Office | Tax Bridge: copy-ready Schedule C values | Built (manual paste; no integration exists) |

**Things she did not mention but pair with her pain points:**

1. **Client consent before automatic reading.** Federal law requires it (see `docs/LEGAL_COMPLIANCE_REVIEW.md`). Built tonight as one link the client signs in under a minute.
2. **Two-step sign-in.** The FTC Safeguards Rule requires it of every tax preparer. Built tonight.
3. **Form 8879 signatures without DocuSign.** Pen-signed photo upload or in-office signing, $0 per signature. Built.
4. **1099-NEC contractor tracking and W-9 requests.** Built.
5. **Year-end organizer and prior-year comparison.** Built.
6. **Quarterly estimated-tax worksheet** (safe-harbor amounts from prior-year tax). Not built; the existing "estimates" feature is price quotes for clients.
7. **Mileage log** with standard-rate calculation and substantiation fields: vehicle expense is a leading Schedule C examination issue (IRC § 274(d)). Not built.
8. **Home-office substantiation checklist.** Not built.
9. **A written information security program**, which the FTC requires of her regardless of software. Not built.

## 4. The market

**Size.** 870,679 people held a current PTIN as of December 1, 2025; about 568,000 of them are not CPAs, enrolled agents or attorneys ([IRS Return Preparer Office](https://www.stayexempt.irs.gov/node/3635)). That uncredentialed majority, mostly solo and small practices like Phyllis's, is the natural first market: they combine bookkeeping and tax prep, run on consumer-grade tools, and cannot justify enterprise suites.

**Tax software they already use.** Among solo practitioners, Drake Tax and ProSeries predominate; UltraTax CS and CCH Axcess lead in large firms ([Journal of Accountancy 2025 tax software survey](https://www.journalofaccountancy.com/issues/2025/sep/2025-tax-software-survey/)). Truepost should sit beside these, not compete with them.

**Price points.**

| Product | What it is | 2026 price |
|---|---|---|
| Wave | Small-business books | Free, or Pro $19/month per business |
| TaxDome | Practice management, portal, e-sign | $1,000–$1,200 per user per year ([source](https://taxdome.com/pricing)) |
| Canopy | Modular practice management | Per-module and per-client credits (see 09/20 strategy doc) |
| Karbon, Financial Cents | Workflow and practice management | Per-user subscriptions; both rely on QuickBooks for accounting |
| My Tax Prep Office | Tax preparation and e-file | $695–$1,295/year |
| DocuSign | E-signature | $10–95/user/month; no dedicated Form 8879 product |

## 5. Where Truepost stands

### What we can state today (built and tested)

- One workspace from receipt to categorized P&L to tax-ready numbers, with every number traceable to its source.
- No per-envelope, per-receipt or per-client charges for core work.
- Form 8879 signing by pen or in office, built to IRS Publication 1345, at $0 per signature, with a transmission gate.
- Client consent built to Rev. Proc. 2013-14, enforced before any automatic reading.
- Two-step sign-in.
- California and New York worksheets verified against statute and form instructions.

### Where we are better than the field

| Versus | Our edge |
|---|---|
| Wave | Bulk evidence intake, exceptions-first review, firm-side rules, practice tools (requests, signatures, billing, deadlines) that Wave does not have |
| TaxDome / Canopy / Karbon / Financial Cents | Native bookkeeping and evidence; they depend on QuickBooks for the books. Flat pricing instead of per-seat or per-client credits |
| DocuSign | Tax-specific 8879 flows, no envelope fees, lives inside the client file |
| Homemade tax apps on a licensed engine | They sell filing. We sell everything before filing, which is where Phyllis says her hours go |

### The moat

The moat is not a feature list. Competitors can copy features. It is the **decision history**: every receipt, bank line, rule, correction and approval linked to the number it produced. After a year of use, a firm's rules and corrections are its bookkeeping memory, and a tool with no place to put them cannot absorb them. Guard it by keeping every automated suggestion reviewable and reversible.

## 6. Gaps: what to build, in order

All zero-cost unless noted. Nothing here needs a certification we lack.

| # | Build | Why | Effort |
|---|---|---|---|
| 1 | **Section the "More tools" menu** (Tax, Client, Billing, Books). The workspace already shows 6 daily tabs; the other 15 tools were one flat list | Find a tool by purpose; nothing is removed | Small (done 2026-09-22) |
| 2 | **Automatic reminders** for unsigned consents, 8879s and open client requests, on the existing daily Cron | Top time-saver after receipts; DocuSign and TaxDome both have it | Small |
| 3 | **US-only document reading** option (a US-region-pinned provider) | Removes the foreign-disclosure element of the consent and the SSN risk | Medium; may cost cents per page |
| 4 | **Security-program generator** from IRS Publication 5708, pre-filled with Truepost's actual controls | Every preparer needs one; most do not have one | Small |
| 5 | **Quarterly estimated-tax worksheet** (prior-year safe harbor, preparer-entered figures) | Recurring client need; pairs with the P&L | Small |
| 6 | **Mileage log** with IRS standard-rate calculation and substantiation fields | Vehicle expense is a top Schedule C issue | Medium |
| 7 | **Clean exit archive:** one download with originals, transactions, decisions, signatures and an index | Removes lock-in fear, the main objection to switching | Medium |
| 8 | **Signature placement on the form itself** and **joint-return 8879 pairing** | Closes the last visible gaps with DocuSign | Medium |

**Needs money or an outside party (do not build ahead of it):** live bank feeds (Plaid keys), card payments (Stripe keys), SMS (Twilio keys), remote 8879 identity checks (KBA vendor), direct e-file (IRS software approval), payroll.

## 7. Keeping the dashboard uncluttered

- The client view opens on **Overview**: what needs her today (review count, open requests, unsigned items), and nothing else.
- Six daily tabs (Overview, Upload, Review, Bank, P&L, Close Packet); everything else sits one tap away in a sectioned menu (build item 1).
- Work happens underneath: reading, matching, rule application and reminders run on their own and surface only exceptions.
- Copy speaks plainly ("Read automatically", "Needs review") and does not advertise the technology.
