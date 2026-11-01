import type { Payment } from "./types";

/**
 * Bank-statement cross-check, in the browser — the same rules the Python
 * tool applies:
 *
 *   statement file (text-PDF / CSV / XLSX)  →  credit rows [date, amount, ref]
 *   credit ↔ pending site receipt           →  MATCH  (UTR decisive, else
 *                                               amount ±₹1 within ±3 days,
 *                                               nearest date, one credit
 *                                               = one receipt)
 *
 * All parsing is local; the file never leaves the browser.
 */

export interface BankCredit {
  date: Date;
  amount: number;
  narrative: string;
  bankRef: string;
  utr: string;
  where: string;
  matchedTo: string | null;
}

export interface StmtMatchRow {
  id: string;
  amount: number;
  /** Bank credit date as epoch ms. */
  dateMs: number;
  via: "utr" | "amount+date";
  bankRef: string;
}

export interface StmtUnmatchedRow {
  id: string;
  reason: string;
}

export interface StmtFailedRow {
  id: string;
  amount: number;
  /** Statement entry date as epoch ms. */
  dateMs: number;
  via: "utr" | "amount+date";
  bankRef: string;
}

export interface StatementCompare {
  fileName: string;
  credits: number;
  span: string;
  /** Pending receipts checked = total pending on the site at match time. */
  checked: number;
  matched: StmtMatchRow[];
  unmatched: StmtUnmatchedRow[];
  /** Pending receipts the statement marks as FAILED / declined. */
  failed: StmtFailedRow[];
  /** Statement credits that belong to no site receipt. */
  strays: BankCredit[];
  /** true when every pending site receipt found its bank credit. */
  allPaid: boolean;
}

/* ── tunables (same defaults as the Python tool) ────────────────────────── */

const WINDOW_DAYS = 3;
const AMOUNT_TOLERANCE = 1.0;
const MAX_REASONABLE = 1e7;

/* ── text heuristics ────────────────────────────────────────────────────── */

const UTR_RE = /\b(\d{12})\b/;
const MONEY_RUN_RE = /\d[\d,]*(?:\.\d{1,2})?/g;

/** (regex, y|dmy|dmy_alpha|mdy_alpha) — matches the Python DATE_PATTERNS. */
const DATE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, "ymd"],
  [/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/, "dmy"],
  [/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/, "dmy"],
  [/\b(\d{1,2})[/.-]([A-Za-z]{3,9})[/.-](\d{2,4})\b/, "dmy_alpha"],
  [/\b(\d{1,2})\s+([A-Za-z]{3,9})[,.]?\s+(\d{2,4})\b/, "dmy_alpha"],
  [/\b([A-Za-z]{3,9})\s+(\d{1,2})[,.]?\s+(\d{4})\b/, "mdy_alpha"],
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const CREDIT_HINTS = ["credit", "cr", "deposit", "recon", "neft in"];
const DEBIT_HINTS = ["debit", "withdrawal", "dr", "dishonour", "ret chq", "chq ret", "failed", "declined"];
/** A payment-gateway record whose status column says the money never came. */
const STATUS_FAILED_HINTS = ["failed", "declined", "rejected"];

const HEADER_DATE = ["date", "txn", "transaction", "value date", "posting"];
const HEADER_NARR = ["narration", "description", "particular", "detail", "remark"];
const HEADER_REF = ["ref", "cheque", "chq", "utr", "txn id", "reference"];
const HEADER_CREDIT = ["credit", "deposit"];
const HEADER_DEBIT = ["debit", "withdrawal"];
const HEADER_AMOUNT = ["amount", "value"];

export function squash(s: string): string {
  return (s || "")
    .replace(/₹/g, "Rs ")
    .replace(/[\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\xa0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-boundary hint test: "upi/cr/405..." does contain the word "cr". */
function hasHint(text: string, hints: string[]): boolean {
  const padded = ` ${squash(text).toLowerCase().replace(/[^a-z]+/g, " ")} `;
  return hints.some((h) => padded.includes(` ${h} `));
}

function monthNumber(word: string): number {
  const w = word.toLowerCase();
  if (w.slice(0, 4) in MONTHS) return MONTHS[w.slice(0, 4)];
  for (const short of Object.keys(MONTHS)) {
    if (w.startsWith(short)) return MONTHS[short];
  }
  throw new Error(`unknown month ${word}`);
}

/** Values (+ decimals flag) of plausible rupee amounts, date fragments removed. */
function amountCandidates(text: string): Array<{ v: number; dec: boolean }> {
  let s = squash(text);
  for (const [pat] of DATE_PATTERNS) s = s.replace(new RegExp(pat.source, "g"), " ");
  const out: Array<{ v: number; dec: boolean }> = [];
  for (const m of s.matchAll(MONEY_RUN_RE)) {
    const v = parseFloat(m[0].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0 && v <= MAX_REASONABLE) {
      out.push({ v, dec: m[0].includes(".") });
    }
  }
  return out;
}

export function parseFinanceDate(text: string): Date | null {
  const s = squash(text);
  for (const [pat, kind] of DATE_PATTERNS) {
    const m = pat.exec(s);
    if (!m) continue;
    try {
      let y: number, mo: number, d: number;
      if (kind === "ymd") {
        y = +m[1]; mo = +m[2]; d = +m[3];
      } else if (kind === "dmy") {
        d = +m[1]; mo = +m[2]; y = +m[3];
      } else if (kind === "dmy_alpha") {
        d = +m[1]; mo = monthNumber(m[2]); y = +m[3];
      } else {
        y = +m[3]; mo = monthNumber(m[1]); d = +m[2];
      }
      if (y < 100) y += 2000;
      if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      const dt = new Date(y, mo - 1, d);
      if (!Number.isNaN(dt.getTime())) return dt;
    } catch {
      /* try the next pattern */
    }
  }
  return null;
}

function findUtr(text: string): string {
  const m = UTR_RE.exec(squash(text));
  return m ? m[1] : "";
}

/* ── statement rows → credits ───────────────────────────────────────────── */

type HeaderCols = Record<string, number>;

function headerMap(cells: string[]): HeaderCols | null {
  const m: HeaderCols = {};
  cells.forEach((raw, i) => {
    const h = squash(raw).toLowerCase();
    if (!h || h.length > 22) return;
    for (const [role, keys] of [
      ["date", HEADER_DATE], ["narr", HEADER_NARR], ["ref", HEADER_REF],
      ["credit", HEADER_CREDIT], ["debit", HEADER_DEBIT], ["amount", HEADER_AMOUNT],
    ] as Array<[string, string[]]>) {
      if (role in m) continue;
      if (keys.some((k) => h.includes(k))) m[role] = i;
    }
  });
  if (!("date" in m)) return null;
  if (!("credit" in m) && !("amount" in m)) return null;
  return m;
}

/** Free-form money scan of a cell — date fragments, 12-digit UTRs and
 *  receipt ids ("SK-202611-VJ9Z00") are neutered first, because they
 *  smuggle digit runs that look like rupee amounts. */
function moneyText(raw: string): string {
  let s = squash(raw);
  for (const [pat] of DATE_PATTERNS) s = s.replace(new RegExp(pat.source, "g"), " ");
  s = s.replace(UTR_RE, " ");
  s = s.replace(/\b[A-Za-z]{1,6}-[A-Za-z0-9-]{2,}/g, " ");
  s = s.replace(/\b[A-Za-z]{1,4}\d[\dA-Za-z-]*[A-Za-z-]/g, " ");
  // a bare 19xx/20xx is a year (…/October 2026/…), not a rupee amount
  s = s.replace(/\b(?:19|20)\d{2}\b(?!\.\d)/g, " ");
  return s;
}

interface MoneyCell {
  at: number;
  v: number;
  /** decimals or comma-grouping — how real statement amounts are written. */
  tidy: boolean;
}

/** Scan the row's cells (right of the date anchor, then just before it) and
 *  pick the one honest rupee amount: flat numbers, serials, flat-block ids
 *  and reference fragments can't beat a real "2,500.00"-style value. */
function pickRowAmount(cells: string[], dateAt: number): number | null {
  const cands: MoneyCell[] = [];
  for (let i = dateAt + 1; i < cells.length; i++) {
    for (const c of amountCandidates(moneyText(cells[i]))) {
      if (c.v < 10) continue; // serial numbers, "NEFT77" fragments
      cands.push({ at: i, v: c.v, tidy: c.dec || c.v >= 1000 });
    }
  }
  const tidy = cands.find((c) => c.tidy);
  if (tidy) return tidy.v;
  const plain = cands.find((c) => c.v >= 100);
  if (plain) return plain.v;
  return null;
}

function rowCredit(cells: string[], cols: HeaderCols, where: string, failed?: BankCredit[]): BankCredit | null {
  let d: Date | null = null;
  const di = cols.date;
  let dateAt = -1;
  for (let i = 0; i < cells.length; i++) {
    d = parseFinanceDate(cells[i]);
    if (d) { dateAt = i; break; }
  }
  if (!d) return null;

  const rowText = cells.join(" ");
  // a gateway/statement row whose status column says the money never came:
  // parsed fully, then routed to the failed list instead of the credits
  const isFailed = hasHint(rowText, STATUS_FAILED_HINTS);

  let amount: number | null = null;
  const ci = cols.credit;
  const ai = cols.amount;
  if (ci != null && ci < cells.length) {
    // the dedicated credit column of a table-style statement — but only an
    // honest single amount (serials "1" in stray cells don't qualify)
    const cands = amountCandidates(moneyText(cells[ci]));
    if (cands.length === 1 && (cands[0].dec || cands[0].v >= 100)) amount = cands[0].v;
  }
  if (amount == null && ai != null && ai < cells.length) {
    const cands = amountCandidates(moneyText(cells[ai]));
    if (cands.length === 1 && (cands[0].dec || cands[0].v >= 100)) {
      if (isFailed || hasHint(rowText, CREDIT_HINTS)) amount = cands[0].v;
    }
  }
  if (amount == null) amount = pickRowAmount(cells, dateAt);
  if (!amount) return null;

  // the full row is the narrative: hint filters (debit/failed/credit words)
  // must always see every word, and the UTR can sit in any column
  const narrative = squash(cells.join(" "));
  const ri = cols.ref;
  const bankRef = ri != null && ri < cells.length && cells[ri] ? cells[ri] : "";
  const credit: BankCredit = { date: d, amount: Math.round(amount * 100) / 100, narrative, bankRef, utr: findUtr(narrative), where, matchedTo: null };
  if (isFailed) {
    failed?.push(credit);
    return null;
  }
  return credit;
}

function wordCredit(cells: string[], where: string, failed?: BankCredit[]): BankCredit | null {
  const joined = cells.join(" ");
  const isFailed = hasHint(joined, STATUS_FAILED_HINTS);
  if (!isFailed && !hasHint(joined, CREDIT_HINTS)) return null;
  if (hasHint(joined, DEBIT_HINTS)) return null;
  let d: Date | null = null;
  let dateAt = -1;
  for (let i = 0; i < cells.length && !d; i++) {
    d = parseFinanceDate(cells[i]);
    if (d) dateAt = i;
  }
  if (!d) return null;
  const amount = pickRowAmount(cells, dateAt);
  if (amount == null) return null;
  const credit: BankCredit = { date: d, amount: Math.round(amount * 100) / 100, narrative: squash(joined), bankRef: "", utr: findUtr(joined), where, matchedTo: null };
  if (isFailed) {
    failed?.push(credit);
    return null;
  }
  return credit;
}

function creditsFromRows(rows: string[][], label: string, failed?: BankCredit[]): BankCredit[] {
  const out: BankCredit[] = [];
  let cols: HeaderCols | null = null;
  rows.forEach((cells, idx) => {
    if (!cells.some(Boolean)) return;
    const where = `${label} row ${idx + 1}`;
    if (cols === null) {
      cols = headerMap(cells);
      if (cols === null) {
        const cr = wordCredit(cells, where, failed);
        if (cr) out.push(cr);
      }
      return;
    }
    const cr = rowCredit(cells, cols, where, failed);
    if (cr) out.push(cr);
  });
  return out;
}

function dedupCredits(credits: BankCredit[]): BankCredit[] {
  const seen = new Set<string>();
  const out: BankCredit[] = [];
  for (const c of credits) {
    const key = `${c.date.toDateString()}|${c.amount.toFixed(2)}|${c.utr || squash(c.narrative).slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Row-wrap join: a row with no date of its own is the tail of the previous
 *  row's description — statement PDFs and OCR produce these continuations. */
function joinWrappedRows(rows: string[][]): string[][] {
  const out: string[][] = [];
  for (const cells of rows) {
    if (!cells.some(Boolean)) continue;
    const isContinuation =
      out.length > 0 &&
      // only a dated data row may absorb fragments — titles and the table
      // header must stay intact or every column shifts by one
      out[out.length - 1].some((c) => parseFinanceDate(c) !== null) &&
      !cells.some((c) => parseFinanceDate(c) !== null) &&
      cells.length <= 6;
    if (isContinuation) {
      const prev = out[out.length - 1];
      out[out.length - 1] = [...prev, ...cells];
    } else {
      out.push(cells);
    }
  }
  return out;
}

/* ── bank recognition + layout learning ─────────────────────────────────── */

const BANK_PATTERNS: Array<[RegExp, string]> = [
  [/hdfc/i, "HDFC"],
  [/icici/i, "ICICI"],
  [/state bank( of india)?|\b(sbi|svbishwa)/i, "SBI"],
  [/axis/i, "Axis"],
  [/kotak/i, "Kotak"],
  [/punjab national|\bPNB\b/i, "PNB"],
  [/bank of baroda|baroda/i, "Bank of Baroda"],
  [/canara/i, "Canara"],
  [/union bank/i, "Union Bank"],
  [/idfc/i, "IDFC"],
  [/indusind/i, "IndusInd"],
  [/yes bank/i, "Yes Bank"],
  [/bank of india|\bBOI\b/i, "Bank of India"],
  [/federal bank/i, "Federal"],
  [/\bRBL\b/i, "RBL"],
  [/bandhan/i, "Bandhan"],
  [/allahabad/i, "Allahabad"],
  [/central bank/i, "Central Bank"],
  [/paytm/i, "Paytm"],
  [/aurionpro|indus/i, "IndusInd"],
  // self-generated register dumps (incl. this project's own) — they recur
  // monthly, so their layout is worth remembering too
  [/\bchs\b|society reg|collection statement|maintenance/i, "Society register"],
];

function bankOf(text: string): string {
  for (const [re, name] of BANK_PATTERNS) if (re.test(text)) return name;
  return "";
}

/** localStorage shape: bank name → the row-building strategy that read it. */
interface StmtStrategy {
  wrap: boolean;
  split: "columns" | "tokens";
}
const GRAMMAR_KEY = "sk.statgrammar";

function loadGrammarMap(): Record<string, StmtStrategy> {
  try {
    return JSON.parse(localStorage.getItem(GRAMMAR_KEY) ?? "{}") as Record<string, StmtStrategy>;
  } catch {
    return {};
  }
}

function saveGrammar(bank: string, s: StmtStrategy): void {
  try {
    const map = loadGrammarMap();
    map[bank] = s;
    localStorage.setItem(GRAMMAR_KEY, JSON.stringify(map));
  } catch {
    /* private mode: no learning memory, still works */
  }
}

function sameStrategy(a: StmtStrategy | undefined, b: StmtStrategy): boolean {
  return !!a && a.wrap === b.wrap && a.split === b.split;
}

/** Tesseract's per-page rows → the row set one strategy asks for:
 *  "columns" keeps each line's cells, "tokens" flattens every cell into
 *  single tokens (some OCR spacing is unreliable; token-split rows let the
 *  header-map klep columns by name instead of position). */
function ocrRowsForSplit(sets: string[][][], split: "columns" | "tokens"): string[][] {
  const out: string[][] = [];
  // each element of `sets` is one OCR page's rows — iterate rows, not pages
  for (const pageCells of sets) {
    for (const row of pageCells) {
      out.push(split === "tokens" ? row.flatMap((c) => squash(c).split(/\s+/)).filter(Boolean) : row);
    }
  }
  return out;
}

function linesToRows(lines: string[], split: "columns" | "tokens"): string[][] {
  return lines
    .filter((l) => l.trim())
    .map((l) =>
      (split === "tokens" ? squash(l).split(/\s+/) : l.split(/\s{2,}/).map(squash)).filter(Boolean)
    );
}

/* ── OCR: Tesseract.js — an LSTM neural-network engine ──────────────────── */

type OcrProgress = (pct: number, note: string) => void;

let ocrWorker: Promise<{
  recognize: (img: string) => Promise<{ data: { text?: string; blocks?: unknown } }>;
}> | null = null;

async function getOcrWorker(): Promise<NonNullable<typeof ocrWorker>> {
  const { createWorker } = await import("tesseract.js");
  if (!ocrWorker) {
    ocrWorker = createWorker("eng") as unknown as Promise<NonNullable<typeof ocrWorker>>;
  }
  return ocrWorker;
}

/** Long edge ≈ 1700 px: sharp enough for 8pt statement text, quick to OCR. */
const OCR_EDGE = 1700;

function bitmapToDataUrl(src: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(2.2, OCR_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

interface OcrWord {
  x: number;
  W: number;
  y: number;
  h: number;
  text: string;
}

/** Pull word boxes out of tesseract's blocks tree (v5+ shape), if provided. */
function wordsFromBlocks(data: { text?: string; blocks?: unknown }): OcrWord[] {
  try {
    const blocks = (Array.isArray((data as { blocks?: unknown }).blocks)
      ? (data as { blocks: unknown[] }).blocks
      : []) as Array<Record<string, unknown>>;
    const words: OcrWord[] = [];
    for (const b of blocks ?? []) {
      const paragraphs = (b?.paragraphs ?? []) as Array<Record<string, unknown>>;
      for (const p of paragraphs) {
        const lines = (p?.lines ?? []) as Array<Record<string, unknown>>;
        for (const l of lines) {
          const ws = (l?.words ?? []) as Array<Record<string, unknown>>;
          for (const w of ws) {
            const bbox = (w?.bbox ?? {}) as { x0?: number; x1?: number; y0?: number; y1?: number };
            const text = String(w?.text ?? "").trim();
            if (!text || bbox.x0 == null) continue;
            const y0 = bbox.y0 ?? 0;
            const y1 = bbox.y1 ?? y0;
            words.push({
              x: bbox.x0,
              W: Math.max(1, (bbox.x1 ?? bbox.x0) - bbox.x0),
              y: y0,
              h: Math.max(1, y1 - y0),
              text,
            });
          }
        }
      }
    }
    return words;
  } catch {
    return [];
  }
}

/** bbox words → cell rows (y bands, x-gap cell split scaled to line height). */
function wordsToRows(words: OcrWord[]): string[][] {
  if (words.length === 0) return [];
  const heights = words.map((w) => w.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)];
  const bandPx = Math.max(4, medH * 0.65);
  const bands = new Map<number, OcrWord[]>();
  for (const w of words) {
    const key = Math.round(w.y / bandPx);
    const list = bands.get(key) ?? [];
    list.push(w);
    bands.set(key, list);
  }
  const rows: string[][] = [];
  for (const key of Array.from(bands.keys()).sort((a, b) => a - b)) {
    const ws = (bands.get(key) ?? []).sort((m, n) => m.x - n.x);
    const cells: string[] = [];
    let cur = "";
    let prevEnd = -Infinity;
    for (const w of ws) {
      const gap = w.x - prevEnd;
      if (cur && gap > medH * 1.05) { cells.push(cur); cur = ""; }
      cur = cur ? `${cur} ${w.text}` : w.text;
      prevEnd = Math.max(prevEnd, w.x + w.W);
    }
    if (cur.trim()) cells.push(cur);
    rows.push(cells.map(squash).filter(Boolean));
  }
  return rows;
}

/** OCR one page: bitmap → Tesseract.js (LSTM) → rows. */
async function ocrPage(source: CanvasImageSource, w: number, h: number, onProgress?: OcrProgress): Promise<string[][]> {
  const worker = await getOcrWorker();
  const url = bitmapToDataUrl(source, w, h);
  const out = await worker.recognize(url);
  const words = wordsFromBlocks(out.data ?? {});
  if (words.length) return wordsToRows(words);
  const text = (out.data?.text ?? "") as string;
  return wordsFromPlainTextRows(text.split(/\r?\n/));
}

function wordsFromPlainTextRows(lines: string[], split: "columns" | "tokens" = "columns"): string[][] {
  return linesToRows(lines, split);
}

/* ── readers ────────────────────────────────────────────────────────────── */

/** Quote-aware CSV line parser (handles "a, b", "" and """). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === `"`) {
        if (line[i + 1] === `"`) { cur += `"`; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === `"`) inQ = true;
    else if (ch === "," || ch === "\t") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fromCsvText(text: string): Promise<BankCredit[]> {
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];
  let cur = "";
  for (const raw of lines) {
    cur += (cur ? "\n" : "") + raw;
    const quotes = (cur.match(/"/g) ?? []).length;
    if (quotes % 2 === 1) continue; // quoted newline
    rows.push(csvCells(cur).map(squash));
    cur = "";
  }
  return creditsFromRows(rows, "CSV");
}

async function fromXlsxBuffers(buf: ArrayBuffer): Promise<BankCredit[]> {
  const { Workbook } = await import("exceljs/dist/exceljs.min.js");
  const wb = new Workbook();
  await wb.xlsx.load(buf);
  const out: BankCredit[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(
        // exceljs values start at index 1 (col A)
        (row.values as unknown[]).slice(1).map((v) => {
          if (v == null) return "";
          if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
          if (typeof v === "object") {
            const o = v as { text?: unknown; result?: unknown; richText?: unknown };
            if (o.richText) return squash((o.richText as Array<{ text: string }>).map((t) => t.text).join(""));
            const tv = o.text ?? o.result;
            return tv == null ? "" : String(tv);
          }
          return String(v);
        })
      );
    });
    out.push(...creditsFromRows(rows, `XLSX "${ws.name}"`));
  });
  return out;
}

/** pdf.js text items → cell rows (line grouping by baseline, split on x-gap).
 *  Also reports how much text the layer actually had — a scanned photo-PDF
 *  has ~none, and then the caller falls back to OCR. */
async function pdfTextLayerRead(bytes: Uint8Array): Promise<{ rows: string[][]; textSample: string }> {
  const pdfjs = await import("pdfjs-dist");
  try {
    const workerMod = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")) as unknown as { default: string };
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
  } catch {
    /* non-Vite context (Node tests): pdf.js falls back to its built-in worker */
  }

  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const rows: string[][] = [];
  let textSample = "";
  for (let pno = 1; pno <= doc.numPages; pno++) {
    const page = await doc.getPage(pno);
    const content = await page.getTextContent();
    // group items by rounded baseline y
    const lines = new Map<number, Array<{ x: number; end: number; s: string; scale: number }>>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const [a, _b, _c, _d, x, y] = item.transform;
      if (a === 0) continue; // rotated text — skip
      const key = Math.round(y / 2) * 2; // snap to 2pt bands
      const list = lines.get(key) ?? [];
      list.push({ x, end: x + item.width, s: item.str, scale: Math.abs(a) || 10 });
      lines.set(key, list);
    }
    for (const key of Array.from(lines.keys()).sort((m, n) => n - m)) {
      const items = (lines.get(key) ?? []).sort((m, n) => m.x - n.x);
      const cells: string[] = [];
      let cur = "";
      let prevEnd = -Infinity;
      let wsRun = 0; // consecutive whitespace width (pdf.js bridges gaps with it)
      for (const it of items) {
        if (!/\S/.test(it.s)) {
          wsRun += Math.max(0, it.end - it.x);
          prevEnd = Math.max(prevEnd, it.end);
          continue;
        }
        const sep = Math.max(wsRun, Math.max(0, it.x - prevEnd));
        // a separator wider than the font heals into a column break; a normal
        // intra-word space stays inside the cell (pdfplumber's own 2-space rule)
        if (cur && sep > 1.15 * it.scale) { cells.push(cur); cur = ""; }
        cur = cur ? `${cur} ${it.s}` : it.s;
        wsRun = 0;
        prevEnd = Math.max(prevEnd, it.end);
      }
      if (cur.trim()) cells.push(cur);
      const cleaned = cells.map(squash).filter(Boolean);
      if (cleaned.length) rows.push(cleaned);
    }
    textSample += content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .slice(0, 4000);
  }
  return { rows, textSample };
}

function applyDebitFilter(credits: BankCredit[]): BankCredit[] {
  return credits.filter((c) => !hasHint(c.narrative, DEBIT_HINTS));
}

/* ── reading one statement file, with learning ──────────────────────────── */

/** What readStatement came back with — credits plus what it learned. */
export interface StatementReading {
  credits: BankCredit[];
  /** Detected bank ("HDFC"…) or "" when unknown. */
  bank: string;
  /** true when a layout strategy was learned for this bank during this read. */
  learned: boolean;
  /** true when the LSTM OCR engine had to read a scanned/statement image. */
  ocrUsed: boolean;
  /** Statement entries whose own status column says FAILED / declined —
   *  money the bank never received. */ 
  failed: BankCredit[];
}

function pdfRenderViewport(page: { getViewport(o: { scale: number }): { width: number; height: number } }): { scale: number; width: number; height: number } {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.2, OCR_EDGE / Math.max(base.width, base.height));
  return { scale, width: base.width * scale, height: base.height * scale };
}

/**
 * THE reader — with escalation + per-bank learning:
 *   1. read the file's rows with the bank's saved grammar (learned earlier),
 *   2. …escalating through alternative layouts until credits are found,
 *   3. …saving the first strategy that succeeds for that bank, so the next
 *      statement from the same bank reads automatically.
 * Statement PDFs / images with no text layer go through the LSTM OCR engine.
 */
export async function readStatement(
  file: File,
  onProgress?: OcrProgress
): Promise<StatementReading> {
  const name = file.name.toLowerCase();
  onProgress?.(3, "Opening the file…");

  // ── CSV/XLSX: rows are authoritative — no learning needed ──
  if (name.endsWith(".csv")) {
    const credits = applyDebitFilter(dedupCredits(await fromCsvText(await file.text())));
    return { credits, failed: [], bank: "", learned: false, ocrUsed: false };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const credits = applyDebitFilter(dedupCredits(await fromXlsxBuffers(await file.arrayBuffer())));
    return { credits, failed: [], bank: "", learned: false, ocrUsed: false };
  }

  if (!name.endsWith(".pdf") && !/\.(png|jpe?g|webp)$/.test(name)) {
    throw new Error("Unsupported statement type — use a PDF, CSV, XLSX, or an image/photo of the statement.");
  }

  // ── PDF: text layer first; scanned files fall through to OCR ──
  let textRows: string[][] = [];
  let textSample = "";
  let pageCanvases: Array<() => Promise<string[][]>> = [];

  if (name.endsWith(".pdf")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let read: { rows: string[][]; textSample: string } | null = null;
    try {
      read = await pdfTextLayerRead(bytes);
    } catch {
      read = null;
    }
    textRows = read?.rows ?? [];
    textSample = read?.textSample ?? "";
    const hasTextLayer = textSample.replace(/\s/g, "").length >= 40 && textRows.some((r) => r.length >= 2);
    if (!hasTextLayer) {
      textRows = [];
      onProgress?.(15, "No text layer — the neural-network OCR is reading the pages…");
      const pdfjs = await import("pdfjs-dist");
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      for (let pno = 1; pno <= doc.numPages; pno++) {
        const page = await doc.getPage(pno);
        const vp = pdfRenderViewport(page);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: vp.scale }) }).promise;
        const pageNo = pno;
        const total = doc.numPages;
        pageCanvases.push(async () => {
          onProgress?.(15 + Math.round((pageNo / total) * 70), `OCR page ${pageNo}/${total}…`);
          return ocrPage(canvas, canvas.width, canvas.height);
        });
      }
    }
  } else {
    // ── image statement (photo/screenshot of the statement) ──
    const bmp = await createImageBitmap(file);
    pageCanvases.push(async () => {
      onProgress?.(20, "The neural-network OCR is reading the image…");
      return ocrPage(bmp, bmp.width, bmp.height);
    });
  }

  // ── escalate through layout strategies until credits are found ──
  const bank = bankOf(textSample);
  const map = loadGrammarMap();
  const saved = bank ? map[bank] : undefined;

  const builders: Array<{ strategy: StmtStrategy; label: string; build: (s: StmtStrategy) => string[][] }> = [];
  if (textRows.length) {
    for (const split of ["columns", "tokens"] as const) {
      for (const wrap of [false, true] as const) {
        const s: StmtStrategy = { wrap, split };
        builders.push({
          strategy: s,
          label: `text layer${split === "tokens" ? ", tokens" : ""}${wrap ? ", joined rows" : ""}`,
          build: (g) => {
            // glued single-cell rows only open up when split into tokens
            const rows: string[][] =
              g.split === "tokens"
                ? textRows.map((r) => r.flatMap((c) => squash(c).split(/\s+/)).filter(Boolean))
                : textRows;
            return g.wrap ? joinWrappedRows(rows) : rows;
          },
        });
      }
    }
  }
  if (pageCanvases.length) {
    const ocrRowSets: string[][][] = await Promise.all(pageCanvases.map((fn) => fn()));
    onProgress?.(88, "Matching what the OCR read…");
    for (const split of ["columns", "tokens"] as const) {
      for (const wrap of [false, true] as const) {
        const s: StmtStrategy = { wrap, split };
        builders.push({
          strategy: s,
          label: `OCR (${split}${wrap ? ", joined rows" : ""})`,
          build: (g) => {
            const builtRows = ocrRowsForSplit(ocrRowSets, split);
            return g.wrap ? joinWrappedRows(builtRows) : builtRows;
          },
        });
      }
    }
  }

  const queue = [
    ...(saved ? [saved] : []),
    ...builders.map((b) => b.strategy).filter((s) => !sameStrategy(saved, s)),
  ];
  let learned = false;
  let winner: { strategy: StmtStrategy; label: string } | null = null;
  let credits: BankCredit[] = [];
  let failed: BankCredit[] = [];
  /** More credits is better; a decisive 12-digit UTR in the narrative is worth
   *  an extra point, so strategies that rescue refs from wrapped rows win. */
  const score = (cs: BankCredit[]) => cs.length + cs.filter((c) => c.utr).length;
  const seen = new Set<string>();
  let bestScore = 0;
  for (const s of queue) {
    const key = `${s.split}:${String(s.wrap)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const builder = builders.find((b) => sameStrategy(b.strategy, s));
    if (!builder) continue;
    const rows = builder.build(builder.strategy);
    const strategyFailed: BankCredit[] = [];
    const found = applyDebitFilter(dedupCredits(creditsFromRows(rows, "statement", strategyFailed)));
    const sc = score(found);
    if (sc > bestScore) {
      bestScore = sc;
      credits = found;
      failed = dedupCredits(strategyFailed);
      winner = { strategy: builder.strategy, label: builder.label };
    }
  }
  // learning: the winning layout is remembered for this bank — and a later
  // read that beats the remembered layout re-trains the memory (evidence over
  // habit). Unknown sources learn too, under the "" key.
  if (winner) {
    if (!sameStrategy(map[bank], winner.strategy)) {
      saveGrammar(bank, winner.strategy);
      learned = true;
    }
  }

  return { credits, failed, bank, learned, ocrUsed: pageCanvases.length > 0 };
}

/* ── matching (pending receipts, nearest credit wins) ───────────────────── */

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function matchStatement(
  credits: BankCredit[],
  payments: Array<Pick<Payment, "id" | "amount" | "utr" | "createdAt" | "status">>,
  opts?: { windowDays?: number; tolerance?: number; failures?: BankCredit[] }
): StatementCompare {
  const windowDays = opts?.windowDays ?? WINDOW_DAYS;
  const tolerance = Math.max(opts?.tolerance ?? AMOUNT_TOLERANCE, 1.0);

  const pending = payments.filter((p) => p.status === "pending");
  const ordered = [...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const claimed = new Set<number>();
  const matched: StmtMatchRow[] = [];
  const claim = (p: Pick<Payment, "id" | "amount" | "utr">, c: BankCredit, via: StmtMatchRow["via"]) => {
    c.matchedTo = p.id;
    matched.push({
      id: p.id,
      amount: Math.round(p.amount * 100) / 100,
      dateMs: c.date.getTime(),
      via,
      bankRef: c.bankRef || c.utr || c.narrative.slice(0, 40),
    });
  };

  // 1) the receipt's own 12-digit UTR printed in the narrative is decisive
  for (const p of ordered) {
    const utr = (p.utr || "").trim();
    if (utr.length !== 12 || !p.amount) continue;
    for (let i = 0; i < credits.length; i++) {
      const c = credits[i];
      if (claimed.has(i) || c.utr !== utr) continue;
      if (Math.abs(c.amount - p.amount) <= tolerance) {
        claimed.add(i);
        claim(p, c, "utr");
        break;
      }
    }
  }

  // 2) amount within tolerance, date within the window, nearest wins
  for (const p of ordered) {
    if (matched.some((m) => m.id === p.id)) continue;
    const pdt = new Date(p.createdAt);
    if (Number.isNaN(pdt.getTime()) || !p.amount) continue;
    let best: { key: [number, number]; idx: number } | null = null;
    for (let i = 0; i < credits.length; i++) {
      const c = credits[i];
      if (claimed.has(i) || Math.abs(c.amount - p.amount) > tolerance) continue;
      const gap = Math.abs(Math.round((c.date.getTime() - new Date(pdt.getFullYear(), pdt.getMonth(), pdt.getDate()).getTime()) / 86400000));
      if (gap > windowDays) continue;
      const key: [number, number] = [gap, Math.abs(c.amount - p.amount)];
      if (best === null || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
        best = { key, idx: i };
      }
    }
    if (best !== null) {
      claimed.add(best.idx);
      claim(p, credits[best.idx], "amount+date");
    }
  }

  const strays = credits.filter((c) => c.matchedTo === null);

  // 2b) statement entries the bank itself marked FAILED: a pending receipt
  // matching one of these did NOT get paid. Same rules, separate list —
  // these receipts get MARKED FAILED, never "verified" and never "unmatched".
  const failedRows: StmtFailedRow[] = [];
  const failures = opts?.failures ?? [];
  if (failures.length) {
    const fclaimed = new Set<number>();
    const claimFail = (p: Pick<Payment, "id" | "amount">, c: BankCredit, via: StmtFailedRow["via"]) => {
      failedRows.push({
        id: p.id,
        amount: Math.round(p.amount * 100) / 100,
        dateMs: c.date.getTime(),
        via,
        bankRef: c.bankRef || c.utr || c.narrative.slice(0, 40),
      });
    };
    // the receipt's own 12-digit UTR in the failed entry's narrative is decisive
    for (const p of ordered) {
      if (matched.some((m) => m.id === p.id)) continue;
      const utr = (p.utr || "").trim();
      if (utr.length !== 12 || !p.amount) continue;
      for (let i = 0; i < failures.length; i++) {
        const c = failures[i];
        if (fclaimed.has(i) || c.utr !== utr) continue;
        if (Math.abs(c.amount - p.amount) <= tolerance) {
          fclaimed.add(i);
          claimFail(p, c, "utr");
          break;
        }
      }
    }
    // then amount within tolerance, date within the window, nearest wins
    for (const p of ordered) {
      if (matched.some((m) => m.id === p.id) || failedRows.some((f) => f.id === p.id)) continue;
      const pdt = new Date(p.createdAt);
      if (Number.isNaN(pdt.getTime()) || !p.amount) continue;
      let best: { key: [number, number]; idx: number } | null = null;
      for (let i = 0; i < failures.length; i++) {
        const c = failures[i];
        if (fclaimed.has(i) || Math.abs(c.amount - p.amount) > tolerance) continue;
        const gap = Math.abs(Math.round((c.date.getTime() - new Date(pdt.getFullYear(), pdt.getMonth(), pdt.getDate()).getTime()) / 86400000));
        if (gap > windowDays) continue;
        const key: [number, number] = [gap, Math.abs(c.amount - p.amount)];
        if (best === null || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
          best = { key, idx: i };
        }
      }
      if (best !== null) {
        fclaimed.add(best.idx);
        claimFail(p, failures[best.idx], "amount+date");
      }
    }
  }

  // 3) unmatched receipts get a near-miss reason, Python-tool style — but
  // receipts whose verdict is FAILED are spoken for, not unresolved
  const failedIds = new Set(failedRows.map((f) => f.id));
  const unmatched: StmtUnmatchedRow[] = pending
    .filter((p) => !matched.some((m) => m.id === p.id) && !failedIds.has(p.id))
    .map((p) => {
      const pdt = new Date(p.createdAt);
      const pd = Number.isNaN(pdt.getTime()) ? null : new Date(pdt.getFullYear(), pdt.getMonth(), pdt.getDate());
      let reason = "no bank credit within the window at this amount";
      const nearAmount = strays.filter((c) => Math.abs(c.amount - p.amount) <= tolerance);
      if (nearAmount.length && pd) {
        const gap = Math.min(...nearAmount.map((c) => Math.abs(Math.round((c.date.getTime() - pd.getTime()) / 86400000))));
        reason = `amount matches, nearest credit ${gap} day(s) away (window ±${windowDays}d)`;
      } else if (pd) {
        const nearDate = strays.filter((c) => pd && Math.abs(Math.round((c.date.getTime() - pd.getTime()) / 86400000)) <= windowDays);
        if (nearDate.length) {
          const off = Math.min(...nearDate.map((c) => Math.abs(c.amount - p.amount)));
          reason = `date in window, closest credit is Rs ${off.toFixed(2)} off`;
        }
      }
      return { id: p.id, reason };
    });

  const dates = credits.map((c) => c.date.getTime());
  const first = dates.length ? new Date(Math.min(...dates)) : null;
  const last = dates.length ? new Date(Math.max(...dates)) : null;
  const span = first && last ? `${fmtDay(first)} to ${fmtDay(last)}` : "n/a";

  return {
    fileName: "",
    credits: credits.length,
    span,
    checked: pending.length,
    matched,
    unmatched,
    failed: failedRows,
    strays,
    allPaid: pending.length > 0 && unmatched.length === 0 && failedRows.length === 0,
  };
}
