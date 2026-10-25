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
| **Pay** (`/`) | Wing → flat selector with due badges, amount pre-filled from dues, month picker, UPI QR + deep-link, **screenshot reader** (OCR → UTR auto-fill + proof) with double-tap/slow-network duplicate guards, printable receipt |
| **My payments** (`/history`) | Per-flat history with totals, outstanding dues, searchable receipts |
| **Receipt** (`/receipt/:id`) | A5-style receipt with society letterhead, status watermark, print/PDF |
| **Admin → Dashboard** | Collected/pending/outstanding KPIs, month-scoped Excel export, live storage gauge |
| **Admin → Payments** | Filter bar, **verify** (auto-reduces the flat's dues by the maintenance portion) / reject / reopen / delete |
| **Admin → Flats & members** | Register editing: owner, phone, monthly maintenance, dues, active flag; add flats per wing |
| **Admin → Archive & purge** | The storage lifecycle — preview alert e-mail, Excel + JSON downloads, guarded `PURGE` |
| **Admin → Settings** | Society letterhead, UPI ID, wings, committee PIN + alert e-mail, storage soft-limit |

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
   the image is downscaled + re-compressed to ≈½ MB, **Tesseract.js OCR** reads it, and the
   **12-digit UTR**, **amount** and **result word** are extracted and cross-checked against the
   receipt. The verdict shows as a chip:
   `matched` (UTR + amount agree — the reference is even auto-filled) ·
   `check` (attached, some details differ) · `unread` (attached, enter UTR by hand).
   The committee sees the chip and the image right on each receipt row in Admin → Payments.
3. **Committee verify.** The treasurer eyeballs the reference against the bank passbook (and now
   the screenshot), clicks verify once — dues reduce immediately (`dueSettled` makes that
   idempotent), and the screenshot rides along on the printable receipt and the Excel register
   (new *Screenshot proof* column).

Nothing marks a receipt "verified" except the committee's own click. The screenshot verdict is a
hint for the treasurer, never an auto-approval.


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

## Project shape

```
src/
  lib/          firebase.ts · store.ts (dual Firestore/localStorage backend)
                excel.ts (the workbook) · email.ts (no-reply alert flow)
                shot.ts (screenshot reader: compress → OCR → UTR/amount verdict)
                types.ts · util.ts (₹ formats, UPI URIs, ids, bytes)
  components/   Shell (chrome + storage banner) · Icons · Logo · UpiQr · UsageMeter · Toast
  pages/        PayPage · HistoryPage · ReceiptPage · AdminPage
  pages/admin/  Dashboard · Payments · Members · Archive · Settings (+ AdminCtx)
functions/      optional Blaze helpers (usageWatch watchdog + SMTP sender)
firestore.rules shipped rules
public/         logo.svg / logo.png (society emblem)
```

---

Built to feel like a ledger, not an admin panel — warm paper, banyan green, brass rules. 🏦
