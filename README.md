# Society Khata · सोसायटी खाते

**A maintenance-payment ledger for housing societies.** Residents pick their wing & flat, pay over
**UPI** (zero commission, zero gateway billing), and the committee gets a living register with a
professional **Excel** workbook, Fusion-style **Firestore** records, and an automatic
**storage-limit → e-mail → archive → purge** lifecycle that keeps the free Firestore tier
comfortable forever.

Demo mode works with **no configuration at all** — open it and pay, archive, purge.

---

## What's inside

| Screen | What it does |
| --- | --- |
| **Pay** (`/`) | The front door — pick wing + flat chips (numbers only, **owner names never shown**), the browser remembers your flat quietly, amount pre-filled from dues, month picker, UPI QR + deep-link, **screenshot reader** (OCR → UTR auto-fill + proof) with double-tap/slow-network duplicate guards, printable receipt |
| **My payments** (`/history`) | The remembered flat's own receipts — totals, outstanding dues, search |
| **Notices** (`/notices`) | The society's notice board — committee bulletins, pinned ones on top |
| **Receipt** (`/receipt/:id`) | A5-style receipt with society letterhead, status watermark, print/PDF |
| **Admin → Dashboard** | Collected/pending/outstanding KPIs, month-scoped Excel export, live storage gauge |
| **Admin → Payments** | Filter bar, screenshot-proof peek, **verify** (auto-reduces dues) / reject / reopen / delete, **Match statement** (in-browser cross-check — PDF/CSV/XLSX and photos/scans via neural-network OCR, learns each bank's layout — with the "all paid" verdict), **Matcher JSON** export and **Import bank verify** |
| **Admin → Notice board** | Post / edit / pin / remove bulletins (info · warning · event) |
| **Admin → Flats & members** | Register editing: owner, phone, monthly maintenance, dues, active flag; add flats per wing |
| **Admin → Archive & purge** | The storage lifecycle — preview alert e-mail, Excel + JSON downloads, guarded `PURGE` |
| **Admin → Settings** | Society letterhead, UPI ID, wings, committee PIN + alert e-mail, storage soft-limit |

Residents don't sign in at all — paying is open. The committee's **Admin** desk sits behind a
discreet **Committee · admin** footer link (bottom-right of every page), PIN-gated in
Admin → Settings.

Everything runs against **Firestore** when Firebase keys are present, and against an identical
**localStorage backend** when they're not — same screens, same flows, so you can trial it
completely offline.

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:5173 .

- **Demo mode** (no key configured): data lives in the browser. Seeded with wings A–C, 18 flats and
  3 months of payments so every screen has something to show. Admin PIN: **2408**.
- Generate/refresh the emblem: `npm run logo` (writes `public/logo.png` used on receipts + Excel).
- Production build: `npm run build` → `dist/`.

## Connecting Firestore

1. Create a project at [Firebase console](https://console.firebase.google.com) →
   **Build → Firestore Database** → create database (production rules fine for now).
2. Project settings → **Your apps → Web app** → copy the config values.
3. `cp .env.example .env`, fill in the `VITE_FIREBASE_*` values, restart `npm run dev`.
   The first load writes defaults (`config/settings`) for you.
4. Deploy the shipped rules:
   ```bash
   firebase init firestore    # keep firestore.rules, pick this project
   firebase deploy --only firestore:rules
   ```
5. Deploy the app itself anywhere static: `npm run build`, upload `dist/` to Firebase Hosting /
   Netlify / GitHub Pages… (SPA: keep rewrites to `index.html`).

### Which collections does it use?

```
config/settings   society letterhead, UPI id, wings, admin PIN/e-mail, soft limit
config/usage      live counters: paymentsCount, estBytes, limitAlertSent
members/{id}      one doc per flat: owner, monthly maintenance, running dues
payments/{id}     SK-YYYYMM-XXXX receipts: amounts, split, UTR, status, timestamps
mail/{auto}       queue for no-reply e-mail via Trigger-Email extension or SMTP function
```

## The storage-limit lifecycle (the interesting part)

Firestore's free tier holds **1 GiB**. The app keeps a running byte estimate of the *payments*
collection (`config/usage`) — updated on every write, re-measurable from Admin at any time.

When the estimate crosses **90 % of the soft limit** (default 512 MB, configurable):

1. **No-reply e-mail** — an alert is queued into the `mail` collection, and a `mailto` draft is
   offered as fallback. Two ways to turn the queue into real e-mail:
   - **Trigger Email extension** (`auth/firestore-send-email`) — installs on Spark, sends from
     your configured SMTP; or
   - the optional bundled functions (`functions/`, needs Blaze): deploy with
     `npm install && firebase deploy --only functions` after filling `functions/.env` — provides
     both SMTP delivery *and* an hourly server-side watchdog that alerts even if nobody opens the
     app.
2. **Archive to the admin's PC** — Admin → Archive: one click downloads the professional Excel
   register, another the full JSON backup (members, receipts, usage counters).
3. **Purge Firestore** — after both downloads are confirmed and *PURGE* is typed, every payment
   document is deleted in 400-doc batches, usage counters reset, and the ledger starts fresh.
   Members and settings survive; history lives in the archive.

A slim banner appears across the app at ≥ 75 % so the committee is never surprised.

## The Excel register

`Admin → Excel` builds a workbook on the fly (ExcelJS, no server):

- **Letterhead sheet "Collection Register"** — society emblem PNG, serif name, address, reg. no.,
  period stamp, frozen filterable table (16 columns), Indian `₹#,##,##0.00` formats, zebra rows,
  status colour-coding, double-ruled **GRAND TOTAL** row with live `SUM` formulas, A4 landscape
  fit-to-width print setup.
- **"Wing Summary"** — wing-wise flats/payments/collected/maintenance/contribution/outstanding with
  totals, plus archive provenance block (who exported, when, usage at export time).

Smoke-tested: `npm run smoke:excel` rebuilds and re-verifies the register in Node.

## Residents, privacy and the notice board

Paying is **open to residents** — no accounts, no PINs, no sign-up anywhere:

- **Pick your flat once.** On the Pay page, tap your **wing chip**, then your **flat chip**.
  The browser remembers the flat quietly (`sk.session` in localStorage,
  `src/lib/session.ts`) — *My payments* opens on the same flat next time. "Not yours?
  Change" clears the chips; anyone can re-pick.
- **A dot marks dues.** Flat chips with outstanding dues carry a small brass dot so residents
  spot them at a glance; the amount fills itself from the dues when a flat is picked.
- **Privacy by construction.** The Pay, My payments and Notices screens show only
  **wing + flat numbers** — owner names live solely in the treasurer's register (app records,
  Excel, receipts). Payment pages address you as "Flat A-101", never by name.
- **One door for the committee.** The *Committee · admin* footer link (bottom of every page)
  is the only way in — it opens `/admin`, which asks the committee PIN (demo: `2408`).
  Residents side has no admin surface at all.
- **Notice board.** The committee posts bulletins (info / warning / event) in
  Admin → Notice board; residents read them at `/notices`, pinned posts ride on top.
  A restarted board ships seeded demos in demo mode.

## Payments — UPI QR with a built-in screenshot reader

There is **no third-party gateway**: residents pay straight to the society's UPI ID over the QR —
zero commission, every rupee reaches the society — and the app makes the manual half *fast and
tamper-evident*:

1. **Double-tap & slow-network guards (the real-world problems).**
   - A synchronous in-flight lock kills second-tap duplicates before any network call.
   - **One pending draft per flat per month** — `findPendingDraft` matches double clicks, page
     refreshes and second phones onto the *same* receipt instead of minting duplicates.
   - Submit buttons are locked while a write is in flight, and a failed save keeps your typed
     reference so a slow network costs a retry — never a second entry.
2. **Screenshot reader (proof of a really-done payment).** After paying, the resident attaches
   the UPI app's success screenshot (file picker *or* camera). In the browser, with no server:
   the image is downscaled for reading, **Tesseract.js OCR** reads it, and the
   **12-digit UTR / transaction id**, **amount** and **result word** are extracted and
   cross-checked against the receipt. What gets **saved is the extracted text — the UTR and
   transaction id — not the photo**: no half-megabyte image rides in the Firestore document,
   and the saved UTR feeds the bank-statement cross-check directly. The verdict shows as a chip:
   `matched` (UTR + amount agree — the reference is even auto-filled) ·
   `check` (attached, some details differ) · `unread` (attached, enter UTR by hand).
   The committee sees the reference right on each receipt row in Admin → Payments.
3. **Committee verify.** The treasurer eyeballs the reference against the bank passbook (and the
   resident's screenshot, which they kept on their phone), clicks verify once — dues reduce
   immediately (`dueSettled` makes that idempotent).
4. **Bank-statement cross-check — now *in the website***. Admin → Payments → **Match statement**:
   drop in the bank's PDF / CSV / XLSX — or a **photo/scan of the statement** — and the browser
   parses it locally: pdf.js text layer first; when there is no text layer (a scanned or
   photographed statement), **Tesseract.js — an LSTM neural-network OCR engine — reads the
   pages right in the browser**. It then matches the credits against every pending receipt on
   the site — same rules as the Python tool (UTR decisive, amount ±₹1 within ±3 days, nearest
   date, one credit = one receipt, debit rows ignored). And it **trains on your statements**: the
   layout that successfully read a bank's statement is remembered for that bank, so the next
   statement from the same bank reads itself automatically (the button tells you when a layout
   was learned). The panel judges **only the payments recorded on the website** — nothing else
   is recorded or matched: when **every** pending receipt matched, it says plainly
   **"ALL PAYMENTS ADDED ON THE SITE ARE PAID"** with a *Verify matched* button that settles
   dues in one click; when a receipt's own entry says **FAILED** in the statement (the bank never
   received it), it lists them under *The statement marks FAILED* with a one-click
   **Mark failed**; the rest are *Unmatched payments* (with why) — and the committee decides
   each of those right there: **Verify as paid** (money landed, the window missed it) or
   **Mark failed** (never received, resident re-submits). Statement extras that belong to
   no site receipt — interest, transfers, payouts — are simply ignored.
5. **The Python leg** (off-line cross-check + resident-slip OCR): Admin → Payments exports a lean
   **Matcher JSON** (receipts only, screenshots stripped) and imports the matcher's
   **verified_ids.json** — section below. The website leg and the Python leg work independently
   or together; either way, verification settles dues exactly once.

Nothing marks a receipt "verified" except the committee's own click or bank evidence (the
in-app match panel or an imported verdict). The screenshot verdict is a hint for the treasurer,
never an auto-approval. The statement file is parsed **entirely in the browser** — nothing is
uploaded anywhere.


## The Python bank-statement cross-checker

```
[Payment PDF] ──▶ ( pdfplumber )                 ──▶ Extract: [Date, Amount, ID] ─┐
                                                                        │        │ compare ─▶ Match / Flag error
[Bank Slip]   ──▶ ( OCR: PaddleOCR → pytesseract ) ──▶ Extract: [Date, Amount, ID] ─┘
```

One CLI, two checks — both end in *Match or flag*:

**Mode A — statement vs what the web app recorded** *(the bookkeeping cross-check)*

```bash
pip install -r python/requirements.txt
python python/bank_statement_matcher.py statement.pdf payments.json
```

- Reads the **bank statement** (text-PDF / CSV / XLSX — and photo/scan images through the same
  OCR engine chain the slips use) and the **payments JSON** — the lean
  *Matcher JSON* from Admin → Payments, or a full JSON backup from Admin → Archive.
- A pending receipt verifies when (1) its **12-digit UPI UTR** appears in the bank narrative, or
  (2) the same **amount ±₹1** appears within **±3 days** of the receipt date; the nearest date
  wins and one credit can claim only one receipt. `--window-days` / `--amount-tolerance` tune
  this; unmatched receipts stay pending on purpose.
- Writes **`verified_ids.json`** (`format: "society-khata/bank-verify"`) — import it in
  **Admin → Payments → Import bank verify**; verified receipts carry the bank's date + ref in
  their note and their dues settle exactly once. Also writes **`bank-match-report.xlsx`**:
  *Summary*, *Matched*, *Unmatched payments*, *Credits not in app*.

Variants:

```bash
# slips only — verify receipts against resident slip evidence while the statement
# is still awaited (labelled as slip evidence, weaker by design)
python python/bank_statement_matcher.py payments.json --slips slip1.png slip2.pdf

# combined — statement and slips in one command; slips verify the leftovers
python python/bank_statement_matcher.py statement.csv payments.json slip1.pdf slip2.png
```

**Mode B — payment document vs resident bank slips** *(the OCR cross-check from the diagram)*

```bash
python python/bank_statement_matcher.py payment.pdf slip1.png slip2.pdf
# or, if slips are images and you keep them tidy: payment.pdf --slips s1.png s2.jpg
```

Extracts the same **[Date, Amount, ID]** triple from each side — the payment document
(statement/receipt listing, PDF / CSV / XLSX) and every resident slip — then compares:
the same **12-digit ID** on both sides is decisive, and amount disagreements within an ID are
*flagged*, not buried; otherwise amount ±₹1 inside the ±3-day window matches. Output:
**`doc-compare-report.xlsx`** with *Matched pairs* and *Flagged errors* — nothing is
auto-verified here; the treasurer reads it.

**Slip OCR fits the machine.** Slips as **images** go through **PaddleOCR** when installed,
falling back to **pytesseract** — pass `--ocr paddle|tesseract` to force one; slips as **PDFs**
are read straight from their text layer with pdfplumber (no OCR engine needed). Neither engine
is in `requirements.txt` (they're heavy); when none is installed, a slip image exits with the
exact `pip install` line to run. Every file is opened locally — nothing is uploaded anywhere.


## Locking it down (before going public)

The shipped rules are open-for-trialling. For a real society:

1. Enable **anonymous auth** for residents + identify committee users however suits you.
2. Restrict writes:
   ```
   match /payments/{id} { allow create: if true; allow update, delete: if false; }  // committee edits only
   match /members/{id}, /config/* { allow write: if false; }                        // lock everything else
   ```
3. Turn on **App Check** (reCAPTCHA v3) and enforce it on Firestore — kills scripted spam writes.
4. Rotate the admin PIN from Settings; never reuse it as a password.

## Scripts

| Command | What |
| --- | --- |
| `npm run dev` | Vite dev server (demo mode without keys) |
| `npm run build` | Type-check + production bundle → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run logo` | Regenerate `public/logo.png` (PowerShell + System.Drawing) |
| `npm run smoke:excel` | Node smoke test of the Excel register |
| `npm run smoke:statement` | Node smoke test of the bank-statement matcher core |

## Project shape

```
src/
  lib/          firebase.ts · store.ts (dual Firestore/localStorage backend · notices CRUD ·
                quiet flat memory) · session.ts (reactive flat memory) · excel.ts (the workbook) ·
                statement.ts (in-browser bank-statement parse + match) ·
                email.ts (no-reply alert flow) · shot.ts (screenshot reader —
                compress → OCR → UTR/amount verdict) · types.ts · util.ts (₹ formats, UPI URIs, ids, bytes)
  components/   Shell (chrome + storage banner + footer admin door) · Icons · Logo · UpiQr · UsageMeter · Toast
  pages/        PayPage (chips + quiet memory) · HistoryPage · ReceiptPage · AdminPage (PIN-gated)
                NoticesPage (/notices)
  pages/admin/  Dashboard · Payments (matcher export/import) · Members · Notices · Archive · Settings
python/         bank_statement_matcher.py (statement + slip OCR cross-checker) · requirements.txt
functions/      optional Blaze helpers (usageWatch watchdog + SMTP sender)
firestore.rules shipped rules (now includes the `notices` collection)
public/         logo.svg / logo.png (society emblem)
```

---

Built to feel like a ledger, not an admin panel — warm paper, banyan green, brass rules. 🏦
