# Folio Founder Walkthrough

This is the click-by-click script for Richard to see the unified practice OS milestone in the real production UI, once deployed. Written now, to be run against production after the migration and deploy step (held for explicit approval per this milestone's checkpoint) and the production smoke test in docs/PHYLIS_BETA_ACCEPTANCE_SCRIPT.md's underlying smoke coverage. No CLI knowledge required for any step below.

## Before you start

Log in at the production URL with your owner account. You already have a client set up from prior milestones (or create one from Clients > Add client).

## 1. Client workspace

Click Clients in the top nav, then click into any client. This opens the client workspace with the full tab strip: Overview, Folders, Upload, Review, Bank, P&L, Tax readiness, Documents, Engagements, Requests, Export.

## 2. Bulk receipt tray

Click the Upload tab. Drag or select multiple receipt files at once; there is no per-batch limit here, unlike Wave's 10-file cap.

## 3. Receipt review

Click the Review tab. Each extracted receipt shows vendor, amount, date, and category, ready for a quick confirm or correction rather than manual entry.

## 4. Evidence folders

Click the Folders tab. Receipts are organized by category automatically; click any folder to see its contents.

## 5. Bank workflow

Click the Bank tab. Import a bank CSV (or view existing imported activity) and see each transaction's disposition.

## 6. Exception handling

Still on the Bank tab, find a transaction needing a receipt or explanation. Use the new prepare-request action (surfaced from the transaction's row) to draft a client request automatically from that exception.

## 7. P&L

Click the P&L tab to see the live profit and loss for the client's configured period, built from bookkeeping activity, no Excel required.

## 8. Drilldown

From any P&L line, click through to see the underlying transactions and receipts that produced that number.

## 9. Documents

Click the Documents tab to see tax documents, statements, and other files beyond receipts, each tagged by type.

## 10. Tax readiness

Click the Tax readiness tab to see this client's readiness status for the configured tax year.

## 11. New engagement

Click the new Engagements tab. Pick a service type (bookkeeping, 1040, 1065, 1120, 1120S, and others) and give it a title, then click New engagement. Folio creates the engagement plus its service-template work items automatically - no blank pipeline to design by hand.

## 12. New client request

Click the new Requests tab. Pick a request type (missing receipt, tax document, organizer question, and others), give it a title, and click Send request. This creates a request already visible to the client's portal.

## 13. Waiting-on-client workflow

Back on the Bank tab, use prepare-missing-receipt or prepare-explanation on an exception. The resulting request appears in the Requests tab in draft status - review its wording, then click Approve and send to make it visible to the client.

## 14. Request resolution

On the Requests tab, click Issue portal link to get a one-time client-portal token. Open that link (in an incognito window, to see the client's own view) to see the request as the client would. Reply as the client, then back in the professional view, click Mark resolved once you have reviewed the response.

## 15. Work queue

Click Work Queue in the top nav. See every open item across every client in one list, filterable by overdue, due today, due soon, waiting on client, professional review, and blocked. Click any item to jump straight to its client and tab.

## 16. Operations Command Center

Click Operations (the home page). The summary now includes open engagements, waiting-on-client count, overdue work, due-soon work, and oldest pending request age, alongside the existing client readiness view.

## 17. Export

Click the Export tab on any client workspace to generate the existing export package for that client's period.
