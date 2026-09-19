# Phyllis Beta Acceptance Session Protocol & Live Scorecard

**Target:** Phyllis (Tax Professional & Solo Practitioner)  
**Objective:** Validate real-world workflow time savings (Target: 10+ hours/week saved, 90%+ work inside Folio) and record direct feedback.

---

## 1. Pre-Session Setup Checklist (5 Minutes Before Call)

- [ ] **Application Origin**:
  - Web App: `http://localhost:5173` (or production URL)
  - Desktop: Windows Desktop App (Tauri `.exe`)
- [ ] **Phyllis Beta Invitation Link**:
  - Generate via `/beta-admin` by entering her email or use pre-configured test firm.
  - Invitation format: `https://[origin]/beta-redeem#token=[token]`
- [ ] **Sample Client Setup**:
  - Client Name: **Bob's Construction LLC**
  - Entity: Sole Proprietorship / Single-Member LLC
  - Tax Year: Current Tax Year
  - Known Accounts: Chase Business Checking (*4821), Home Depot Commercial Card (*9012)
- [ ] **Scorecard Printed or Open on Screen 2** (Use Section 3 below).

---

## 2. The 6 Hands-On Acceptance Scenarios

### Scenario 1: Magic Mobile Phone Capture (The "Messy Contractor" Test)
* **The Story for Phyllis:** *"You know how contractors always lose receipts in their trucks or never log into portals? Let's see what happens when you send them a Magic Link."*
* **The Action:**
  1. Go to Bob's Construction in Folio.
  2. Click the **"Magic Phone Upload"** button (smartphone icon) on the client profile card.
  3. Have Phyllis open the camera on her iPhone or Android and scan the on-screen QR code (or click "Copy Link" to text it).
  4. She snaps 2 receipts directly in her mobile browser (no app store install, no password).
* **What to Observe:**
  - Receipts upload immediately with zero login friction.
  - Automatic HEIC-to-JPEG conversion on iPhone.
  - Receipts land in the review queue in under 3 seconds.
* **Scorecard Metrics:**
  - App switches: **0** (contractor doesn't even need an account).
  - Folio time: **< 15 seconds**.

---

### Scenario 2: The "Shoebox Batch" Ingestion (No 10-File Wave Cap)
* **The Story for Phyllis:** *"In Wave, you get capped at 10 files per upload. Here, drop as many as you have in the shoebox."*
* **The Action:**
  1. Open the **Upload** tray.
  2. Drop a batch of 12+ receipt images/PDFs.
  3. Click **"Upload Pending"**.
* **What to Observe:**
  - Parallel extraction via Cloudflare Workers AI with **zero per-token API cost**.
  - Extracts Vendor, Date, Subtotal, Tax, Tip, Total, Payment Method, and **Card Last 4**.
  - One blurry or bad file never blocks the rest of the batch.
* **Scorecard Metrics:**
  - Wave time baseline: **~10-15 minutes** (multiple batches, manual entry).
  - Folio time: **~30-45 seconds**.

---

### Scenario 3: Teaching the AI by Voice ("Teach AI Rule")
* **The Story for Phyllis:** *"Instead of adjusting settings menus, you can just speak to the brain and tell it how you want this client's books handled."*
* **The Action:**
  1. Click the purple **"Teach AI Rule"** button (microphone icon).
  2. Click the pulsing microphone and speak naturally:
     > *"For Bob's Construction, all purchases from Home Depot over $150 should be classified under Supplies & Materials, not repairs."*
  3. Notice the live waveform responding to her voice.
  4. Select **"Retroactive from date"** $\rightarrow$ pick **January 1st** from the calendar dropdown.
  5. Click **"Compile & Review"** $\rightarrow$ review the Schedule C Line 22 badge.
  6. Click **"Activate & Apply Retroactively"**.
* **What to Observe:**
  - Instant translation from natural English into formal rule logic.
  - Real-time audit guardrail ensuring positive dollar amounts and double-entry balance.
  - Every historical Home Depot receipt for Bob is reclassified retroactively in 1 second.
* **Scorecard Metrics:**
  - Excel/Wave manual reclassification time: **~20-30 minutes**.
  - Folio voice time: **< 20 seconds**.

---

### Scenario 4: The 60-Second Schedule C Tax Software Bridge
* **The Story for Phyllis:** *"Now it's time to prepare Bob's 1040 Schedule C in MyTAXPrepOffice. Watch how fast we get the numbers over."*
* **The Action:**
  1. Click the **"Tax Bridge & 1099"** tab in Bob's workspace.
  2. Point out that every line is already organized into exact IRS Form 1040 Schedule C order:
     - Part I: Gross Receipts / Income
     - Part II: Lines 8, 9, 11, 17, 18, 22 (Supplies), 23, 24b (**50% meals limitation automatically applied**), 25, 27a, 28, 31 (Net Profit).
  3. Click **"Copy for MyTAXPrepOffice"**.
  4. Open a test spreadsheet or MyTAXPrepOffice window and press `Ctrl+V` (or click individual lines to copy single numbers).
* **What to Observe:**
  - Zero calculator math.
  - Zero Excel formula errors.
  - 100% auditable back to underlying receipts.
* **Scorecard Metrics:**
  - Excel/Notepad manual transfer baseline: **~15-25 minutes**.
  - Folio bridge time: **< 60 seconds**.

---

### Scenario 5: Proactive 1099 Radar & S-Corp Advisory
* **The Story for Phyllis:** *"Let's check if Bob has any contractor compliance issues or tax-saving advisory opportunities."*
* **The Action:**
  1. In **"Tax Bridge & 1099"**, click the **"1099 Radar"** sub-tab:
     - Notice contractors crossing the $600 threshold highlighted with amber badges (`"Missing W-9"`).
     - Click **"Mark W-9 Received"** to clear the alert.
  2. Click the **"S-Corp Advisory Calculator"** sub-tab:
     - Point out Bob's net profit ($94,000).
     - Show the comparison: Sole Prop SE Tax ($13,281) vs. S-Corp FICA ($8,629).
     - Point out the **$6,732 Net Annual Client Tax Savings** badge.
     - Click **"Copy Advisory Proposal Text"** to show how she can pitch Bob an S-Corp election for a $1,500 advisory fee.
* **What to Observe:**
  - Phyllis goes from a "receipt entry clerk" to a high-value strategic advisor in 1 click.
  - Eliminates December/January 1099 panic.

---

### Scenario 6: 15-Second Billing & Direct Feature Feedback
* **The Story for Phyllis:** *"Now let's invoice Bob for tax prep, and if you ever want anything changed in Folio, you have a direct hotline to our engineering team."*
* **The Action:**
  1. Click the **"Billing & Invoices"** tab.
  2. Click **"+ Create Invoice"**:
     - Line: "2025 Form 1040 Schedule C Preparation & 1099 Filing" — $450.
     - Click **"Save & Create Invoice"**.
     - Click **"Record Payment"** (Card/ACH/Check).
  3. In the top navigation header, click the **"Request a Feature"** button (lightbulb icon):
     - Speak or type a request (e.g. *"Can we add a mileage log tracker for Bob's truck?"*).
     - Submit directly to the engineering backlog.
* **What to Observe:**
  - Replaces external invoicing tools.
  - Direct practitioner feedback loop with zero friction.

---

## 3. Live Session Scorecard & Results Tracker

| Workflow Scenario | Baseline Time (Wave / Excel) | Folio Time (Measured) | App Switches Eliminated | Errors / Corrections | Phyllis Reaction / Direct Quote |
|---|---|---|---|---|---|
| **1. Mobile Phone Intake** | ~5-10 min (emailing photos) | ~15 sec (QR/Magic SMS) | 2 (Email, Photo album) | | |
| **2. Bulk Receipt Ingestion** | ~15 min (Wave 10-cap) | ~45 sec (Bulk tray) | 1 (Wave batch upload) | | |
| **3. Voice Rule Training** | ~20 min (Manual Excel fix) | ~20 sec (Voice mic) | 2 (Excel, Formula edits) | | |
| **4. Schedule C Tax Bridge** | ~20 min (Manual typing) | ~60 sec (1-click copy) | 2 (Excel, Tax software) | | |
| **5. 1099 Radar & S-Corp** | ~45 min (Combing bank txns)| ~30 sec (Radar view) | 1 (Spreadsheet audit) | | |
| **6. Billing & Invoicing** | ~5 min (Separate invoice tool)| ~15 sec (Billing tab) | 1 (QuickBooks/Wave bill) | | |
| **TOTALS** | **~1 hr 50 min per client** | **~3 min 30 sec per client** | **9 App Switches Cut** | | |

*Weekly Extrapolation (for 10 active clients):*
$$\text{Baseline: } 10 \times 110\text{ min} = 18.3\text{ hours/week}$$
$$\text{Folio: } 10 \times 3.5\text{ min} = 0.6\text{ hours/week}$$
$$\mathbf{Total\ Time\ Saved:\ 17.7\ hours/week\ (Exceeds\ 10-hour\ target!)}$$

---

## 4. Phyllis Debrief Questions

Ask Phyllis these 5 questions at the end of the session:

1. *"Which part of this saved you the most immediate headache compared to what you did this morning?"*
   - [Record verbatim response]
2. *"When you saw the Schedule C numbers laid out line-for-line, could you see yourself copying those straight into MyTAXPrepOffice?"*
   - [Record response]
3. *"How did it feel speaking the rule into the microphone versus having to click through menus?"*
   - [Record response]
4. *"If you could have your messy contractors use the Magic Phone link instead of handing you crumpled paper, how much time would that save you per month?"*
   - [Record response]
5. *"Is there anything you still had to open another tab or app to do today that you wish Folio did for you?"*
   - [Record feedback for next iteration]
