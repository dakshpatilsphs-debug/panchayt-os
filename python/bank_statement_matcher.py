#!/usr/bin/env python3
"""
Society Khata x bank statement matcher
===============================================================================
Two cross-checks in one tool, both ending in "Match / Flag error":

  MODE A - statement, receipts recorded in the web app
    python bank_statement_matcher.py statement.pdf payments.json
    Reads the lean "Matcher JSON" (or a full backup) plus a bank statement
    (PDF / CSV / XLSX). Pending receipts whose amount appears on the statement
    within the window -- or whose UTR names them outright -- are exported to
    verified_ids.json for Admin -> Payments -> "Import bank verify".

  MODE B - payment document, resident bank slips          (the OCR leg)
    python bank_statement_matcher.py payment.pdf slip1.png slip2.pdf
    or: python bank_statement_matcher.py payment.pdf --slips s1.png s2.pdf
    Parses a payment document (statement/receipt listing, PDF / CSV / XLSX)
    and a set of resident bank slips (images or PDFs), extracts
    [Date, Amount, ID] from both sides, compares them and writes a report
    with matched pairs and flagged errors. This mode needs no app export.
    Optional: pass payments.json as well to additionally verify app receipts
    against slip evidence.

  Slip OCR: PaddleOCR when installed, then pytesseract, no other engines
  bundled; slip PDFs are read straight from their text layer. Install either
  engine, or keep feeding slips as PDFs. (OlmOCR needs a local vision model -
  deliberately left out.)

Outputs:
  * --json  verified_ids.json  {"format":"society-khata/bank-verify",
                                "verified":[{id, matchedOn, bankRef, amount, via}]}
    (Mode A only - the file the web app imports.)
  * --out   report.xlsx        Mode A: Summary | Matched | Unmatched payments
                                       | Credits not in app
                               Mode B: Summary | Matched pairs | Flagged errors

Dependencies:  pip install -r python/requirements.txt
Scanned photo-PDFs have no text layer; use the bank's CSV/XLSX for those.
===============================================================================
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, Sequence

# ── tunables ────────────────────────────────────────────────────────────────

WINDOW_DAYS = 3          # counterpart must fall within +-N days of the record
AMOUNT_TOLERANCE = 1.0   # +-Rs1 absorbs convenience fees / rounding on one side
MAX_REASONABLE = 1e7     # anything larger is a UTR/account number, not money

IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")

# ── text heuristics ─────────────────────────────────────────────────────────

UTR_RE = re.compile(r"\b(\d{12})\b")
MONEY_RUN_RE = re.compile(r"\d[\d,]*(?:\.\d{1,2})?")

DATE_PATTERNS: Sequence[tuple[re.Pattern[str], str]] = (
    (re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b"), "dmy"),
    (re.compile(r"\b(\d{1,2})[/.-]([A-Za-z]{3,9})[/.-](\d{2,4})\b"), "dmy_alpha"),
    (re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})[,.]?\s+(\d{2,4})\b"), "dmy_alpha"),
    (re.compile(r"\b([A-Za-z]{3,9})\s+(\d{1,2})[,.]?\s+(\d{4})\b"), "mdy_alpha"),
)

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

CREDIT_HINTS = ("credit", "cr", "deposit", "recon", "neft in")
DEBIT_HINTS = ("debit", "withdrawal", "dr", "dishonour", "ret chq", "chq ret")
SLIP_AMOUNT_HINTS = ("amount", "amt", "total", "paid", "rs ")
HEADER_DATE = ("date", "txn", "transaction", "value date", "posting")
HEADER_NARR = ("narration", "description", "particular", "detail", "remark")
HEADER_REF = ("ref", "cheque", "chq", "utr", "txn id", "reference")
HEADER_CREDIT = ("credit", "deposit")
HEADER_DEBIT = ("debit", "withdrawal")
HEADER_AMOUNT = ("amount", "value")


# ── small text helpers ──────────────────────────────────────────────────────

def squash(s: str) -> str:
    """Collapse whitespace; normalise a few decorative characters."""
    s = (s or "").replace("₹", "Rs ").replace("\u2019", "'")
    s = s.replace("\u2013", "-").replace("\u2014", "-").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def lower(s: str) -> str:
    return squash(s).lower()


def has_hint(text: str, hints: Sequence[str]) -> bool:
    """Word-boundary hint test: 'upi/cr/405...' contains the word 'cr'."""
    words = re.sub(r"[^a-z]+", " ", lower(text))
    padded = f" {words} "
    return any(f" {h} " in padded for h in hints)


def _money_text(text: str) -> str:
    """Squash + strip date fragments so they don't masquerade as amounts."""
    s = squash(text)
    for pat, _ in DATE_PATTERNS:
        s = pat.sub(" ", s)
    return s


def money_candidates(text: str) -> list[tuple[int, float]]:
    """(offset, value) of plausible rupee amounts. Date fragments are removed
    first; anything above MAX_REASONABLE is treated as a UTR, not money."""
    s = _money_text(text)
    out: list[tuple[int, float]] = []
    for m in MONEY_RUN_RE.finditer(s):
        try:
            v = float(m.group(0).replace(",", ""))
        except ValueError:
            continue
        if 0 < v <= MAX_REASONABLE:
            out.append((m.start(), v))
    return out


def amount_candidates(text: str) -> list[tuple[float, bool]]:
    """Values plus whether the written form had decimals (bank slips and
    payment docs print '2800.00'; reference IDs like 'A-101' bleed flat ints
    such as 101 into the text - the decimal flag tells the real ones apart)."""
    s = _money_text(text)
    out: list[tuple[float, bool]] = []
    for m in MONEY_RUN_RE.finditer(s):
        try:
            v = float(m.group(0).replace(",", ""))
        except ValueError:
            continue
        if 0 < v <= MAX_REASONABLE:
            out.append((v, "." in m.group(0)))
    return out


def month_number(word: str) -> int:
    w = lower(word)
    if w[:4] in MONTHS:
        return MONTHS[w[:4]]
    for short, n in MONTHS.items():
        if w.startswith(short):
            return n
    raise KeyError(word)


def parse_date(text: str) -> date | None:
    """Best-effort date from a cell: yyyy-mm-dd, 01/10/2026, 12 Oct 2026..."""
    s = squash(text)
    for pattern, kind in DATE_PATTERNS:
        m = pattern.search(s)
        if not m:
            continue
        try:
            if kind == "ymd":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif kind == "dmy":
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif kind == "dmy_alpha":
                d, mo, y = int(m.group(1)), month_number(m.group(2)), int(m.group(3))
            else:
                y = int(m.group(3))
                d, mo = int(m.group(2)), month_number(m.group(1))
        except (KeyError, ValueError):
            continue
        if y < 100:
            y += 2000
        if 2000 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31:
            try:
                return date(y, mo, d)
            except ValueError:
                continue
    return None


def find_utr(text: str) -> str:
    m = UTR_RE.search(squash(text))
    return m.group(1) if m else ""


def iso_date(s: str) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def num(v: object) -> float:
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return f if f == f and 0 < f < 1e12 else 0.0


# ── record models ───────────────────────────────────────────────────────────

@dataclass
class Credit:
    """One credit row read off the bank statement."""
    date: date
    amount: float
    narrative: str = ""
    bank_ref: str = ""
    utr: str = ""
    source: str = ""
    matched_to: str | None = None


@dataclass
class DocRecord:
    """One payment entry extracted from the payment document (Mode B)."""
    date: date
    amount: float | None = None
    utr: str = ""
    narrative: str = ""
    source: str = ""


@dataclass
class SlipRecord:
    """[Date, Amount, ID] read out of one resident bank slip."""
    date: date | None = None
    amount: float | None = None
    utr: str = ""
    narrative: str = ""
    source: str = ""


@dataclass
class Match:
    """A Mode A match: app receipt <-> statement credit (or slip evidence)."""
    payment_id: str
    bank_date: date
    bank_ref: str = ""
    via: str = "amount+date"     # utr | amount+date | slip-utr


@dataclass
class DocMatch:
    """A Mode B match: payment-document entry <-> extracted slip triple."""
    pay: DocRecord
    slip: SlipRecord
    via: str = "utrid"           # utrid | amount+date


# ── statement parsing (Mode A statement side) ───────────────────────────────

def header_map(cells: Sequence[str]) -> dict[str, int] | None:
    """Identify column roles from a header row, e.g. {'date': 0, 'credit': 3}."""
    m: dict[str, int] = {}
    for i, raw in enumerate(cells):
        h = lower(raw)
        if not h or len(h) > 22:
            continue
        for role, keys in (
            ("date", HEADER_DATE), ("narr", HEADER_NARR), ("ref", HEADER_REF),
            ("credit", HEADER_CREDIT), ("debit", HEADER_DEBIT), ("amount", HEADER_AMOUNT),
        ):
            if role in m:
                continue
            if any(k in h for k in keys):
                m[role] = i
    if "date" not in m:
        return None
    if "credit" not in m and "amount" not in m:
        return None
    return m


def row_credit(cells: Sequence[str], cols: dict[str, int], where: str) -> Credit | None:
    """Structured statement row: date + credit amount via identified columns."""
    d: date | None = None
    di = cols.get("date")
    if di is not None and di < len(cells):
        d = parse_date(cells[di])
    if d is None:
        for c in cells:
            d = parse_date(c)
            if d:
                break
    if d is None:
        return None

    amount: float | None = None
    ci = cols.get("credit")
    if ci is not None and ci < len(cells):
        candidates = money_candidates(cells[ci])
        amount = candidates[0][1] if len(candidates) == 1 else None
    else:
        ai = cols.get("amount")
        if ai is not None and ai < len(cells):
            candidates = money_candidates(cells[ai])
            amount = candidates[0][1] if len(candidates) == 1 else None
            if amount is not None and not has_hint(" ".join(cells), CREDIT_HINTS):
                return None
    if not amount:
        return None

    narr_parts = []
    seat = cols.get("narr")
    if seat is not None and seat < len(cells) and cells[seat]:
        narr_parts.append(cells[seat])
    narrative = squash(" ".join(narr_parts)) or squash(" ".join(cells))
    bank_ref = ""
    ri = cols.get("ref")
    if ri is not None and ri < len(cells) and cells[ri]:
        bank_ref = cells[ri]
    return Credit(d, round(amount, 2), narrative, bank_ref, find_utr(narrative), where)


def word_credit(cells: Sequence[str], where: str) -> Credit | None:
    """Header-free fallback: row names a credit and carries exactly one
    plausible figure (UTRs and account numbers are too big to count)."""
    joined = " ".join(cells)
    if not has_hint(joined, CREDIT_HINTS):
        return None
    if has_hint(joined, DEBIT_HINTS):
        return None
    d = next((parse_date(c) for c in cells if parse_date(c)), None)
    if d is None:
        return None
    found = [v for c in cells for _, v in money_candidates(c)]
    if len(found) != 1:
        return None
    return Credit(d, round(found[0], 2), squash(joined), "", find_utr(joined), where)


def credits_from_rows(rows: Iterable[Sequence[object]], label: str) -> list[Credit]:
    out: list[Credit] = []
    cols: dict[str, int] | None = None
    for n, row in enumerate(rows, start=1):
        cells = [squash(v) for v in row]
        if not any(cells):
            continue
        where = f"{label} row {n}"
        if cols is None:
            cols = header_map(cells)
            if cols is None:
                cr = word_credit(cells, where)
                if cr:
                    out.append(cr)
            continue
        cr = row_credit(cells, cols, where)
        if cr:
            out.append(cr)
    return out


def parse_pdf(path: Path) -> list[Credit]:
    try:
        import pdfplumber
    except ImportError:
        sys.exit("pdfplumber is required for PDF statements.\n"
                 "Run:  pip install -r python/requirements.txt")
    out: list[Credit] = []
    with pdfplumber.open(str(path)) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            for tno, table in enumerate(page.extract_tables() or [], start=1):
                rows = [
                    ["" if c is None else (c if isinstance(c, str) else str(c)) for c in row]
                    for row in table
                ]
                out.extend(credits_from_rows(rows, f"PDF p{pno} t{tno}"))
            for lno, line in enumerate((page.extract_text() or "").splitlines(), start=1):
                if not line.strip():
                    continue
                cells = [c for c in re.split(r"\s{2,}", line) if c.strip()] or [line]
                cr = word_credit(cells, f"PDF p{pno} l{lno}")
                if cr:
                    out.append(cr)
    return out


def parse_csv(path: Path) -> list[Credit]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = [list(r) for r in csv.reader(fh)]
    return credits_from_rows(rows, "CSV")


def parse_xlsx(path: Path) -> list[Credit]:
    try:
        from openpyxl import load_workbook
    except ImportError:
        sys.exit("openpyxl is required for XLSX statements.\n"
                 "Run:  pip install -r python/requirements.txt")
    out: list[Credit] = []
    wb = load_workbook(str(path), data_only=True, read_only=True)
    for ws in wb.worksheets:
        rows = [
            [
                v.strftime("%Y-%m-%d") if isinstance(v, datetime) else
                v.strftime("%Y-%m-%d") if isinstance(v, date) else
                ("" if v is None else str(v))
                for v in r
            ]
            for r in ws.iter_rows(values_only=True)
        ]
        out.extend(credits_from_rows(rows, f"XLSX '{ws.title}'"))
    wb.close()
    return out


def dedup_credits(credits: list[Credit]) -> list[Credit]:
    """Merge the table-cell and text-line reads of the same statement row."""
    seen, out = set(), []
    for c in credits:
        key = (c.date, round(c.amount, 2), c.utr or lower(c.narrative)[:24])
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def load_statement(path: Path) -> list[Credit]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        credits = parse_csv(path)
    elif suffix in (".xlsx", ".xlsm"):
        credits = parse_xlsx(path)
    elif suffix == ".pdf":
        credits = parse_pdf(path)
    elif suffix in IMG_EXTS:
        # a photo/scan of the statement — same OCR engines the slips use
        text = ocr_slip(path, "auto")
        credits = credits_from_ocr_text(text)
    else:
        sys.exit(f"Unsupported statement type '{path.suffix}' - use PDF, CSV, XLSX, "
                 f"or an image/photo of the statement.")
    credits = [c for c in credits if not has_hint(c.narrative, DEBIT_HINTS)]
    return dedup_credits(credits)


def credits_from_ocr_text(text: str) -> list[Credit]:
    """OCR text of a statement image → credit rows. Tesseract re-joins columns
    unevenly, so each line is split on 2+ spaces first; a line whose only
    plausible figure is a balance stays out via the single-amount rule."""
    rows: list[list[str]] = []
    for line in text.splitlines():
        cells = [squash(c) for c in re.split(r"\s{2,}", line) if c.strip()]
        if cells:
            rows.append(cells)
    return credits_from_rows(rows, "OCR")


# ── payment document (Mode B payment side) ──────────────────────────────────

def doc_record_from_line(cells: Sequence[str], where: str) -> DocRecord | None:
    """One [Date, Amount, ID] triple from a payment-document row.

    The 12-digit UPI reference anchors the record; the amount is trusted only
    when the row yields exactly one plausible figure (balances and fees are
    ignored). A line with just date + amount still matches a slip weakly
    (amount+date); date alone is not a record."""
    joined = " ".join(cells)
    if not joined.strip():
        return None
    d = next((parse_date(c) for c in cells if parse_date(c)), None)
    if d is None:
        return None
    utr = find_utr(joined)
    cands = amount_candidates(joined)
    decimal_hits = [v for v, dec in cands if dec]
    if len(decimal_hits) == 1:
        amount: float | None = decimal_hits[0]
    else:
        plain = [v for v, _ in cands]
        amount = round(plain[0], 2) if len(plain) == 1 else None
    if not utr and amount is None:
        return None
    return DocRecord(d, amount, utr, squash(joined)[:96], where)


def doc_records_from_rows(rows: Iterable[Sequence[object]], label: str) -> list[DocRecord]:
    out: list[DocRecord] = []
    for n, row in enumerate(rows, start=1):
        cells = [squash(v) for v in row]
        if not any(cells):
            continue
        rec = doc_record_from_line(cells, f"{label} row {n}")
        if rec:
            out.append(rec)
    return out


def dedup_records(records: list[DocRecord]) -> list[DocRecord]:
    seen, out = set(), []
    for r in records:
        key = (r.date, r.amount, r.utr, lower(r.narrative)[:24])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def _xlsx_rows(path: Path) -> list[list[str]]:
    from openpyxl import load_workbook
    wb = load_workbook(str(path), data_only=True, read_only=True)
    rows: list[list[str]] = []
    for ws in wb.worksheets:
        rows += [
            [
                v.strftime("%Y-%m-%d") if isinstance(v, datetime) else
                v.strftime("%Y-%m-%d") if isinstance(v, date) else
                ("" if v is None else str(v))
                for v in r
            ]
            for r in ws.iter_rows(values_only=True)
        ]
    wb.close()
    return rows


def _pdf_lines(path: Path) -> list[list[str]]:
    import pdfplumber
    out: list[list[str]] = []
    with pdfplumber.open(str(path)) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables() or []:
                out.extend(
                    ["" if c is None else str(c) for c in row]
                    for row in table
                )
            for line in (page.extract_text() or "").splitlines():
                if line.strip():
                    out.append([c for c in re.split(r"\s{2,}", line) if c.strip()] or [line])
    return out


def load_payment_doc(path: Path) -> list[DocRecord]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rows = [list(r) for r in csv.reader(fh)]
        return dedup_records(doc_records_from_rows(rows, "CSV"))
    if suffix in (".xlsx", ".xlsm"):
        return dedup_records(doc_records_from_rows(_xlsx_rows(path), "XLSX"))
    if suffix == ".pdf":
        return dedup_records(doc_records_from_rows(_pdf_lines(path), "PDF"))
    sys.exit(f"Unsupported payment document '{path.suffix}' - use PDF, CSV or XLSX.")


# ── bank slips (OCR leg) ────────────────────────────────────────────────────

_paddle_engine = None


def _paddle_text(path: Path) -> str:
    """PaddleOCR - strongest option, first choice when installed."""
    from paddleocr import PaddleOCR
    global _paddle_engine
    if _paddle_engine is None:
        _paddle_engine = PaddleOCR(lang="en")
    try:
        result = _paddle_engine.ocr(str(path))
    except (AttributeError, TypeError):
        result = _paddle_engine.predict(str(path))
    lines: list[str] = []
    for block in result or []:
        if isinstance(block, dict):
            lines.extend(t for t in (block.get("rec_texts") or []) if t)
        elif isinstance(block, (list, tuple)):
            for item in block:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    txt = item[1]
                    if isinstance(txt, (list, tuple)) and txt:
                        txt = txt[0]
                    if isinstance(txt, str) and txt:
                        lines.append(txt)
    return "\n".join(lines)


def _tess_text(path: Path) -> str:
    """pytesseract fallback - lighter, needs the Tesseract binary on the box."""
    import pytesseract
    from PIL import Image
    return pytesseract.image_to_string(Image.open(str(path)))


def ocr_slip(path: Path, engine: str) -> str:
    """Slip text: images through PaddleOCR/pytesseract, PDFs from the text layer."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        try:
            import pdfplumber
        except ImportError:
            sys.exit("pdfplumber is required to read slip PDFs.\n"
                     "Run:  pip install -r python/requirements.txt")
        with pdfplumber.open(str(path)) as pdf:
            return "\n".join((p.extract_text() or "") for p in pdf.pages)
    if suffix not in IMG_EXTS:
        sys.exit(f"'{path.name}' is not a slip we can read - pass an image "
                 f"(png/jpg/webp/tty) or a PDF slip.")
    engines = ["paddle", "tesseract"] if engine == "auto" else [engine]
    last_err: Exception | None = None
    for eng in engines:
        try:
            return _paddle_text(path) if eng == "paddle" else _tess_text(path)
        except ImportError:
            continue
        except Exception as e:  # engine present but failed on this image
            last_err = e
    missing = "; ".join(f"'pip install {'paddleocr' if e == 'paddle' else 'pytesseract pillow'}'"
                        for e in engines)
    if last_err is not None:
        sys.exit(f"OCR failed on {path.name}: {last_err}\n"
                 f"If your image is a clean screenshot either engine usually works.")
    sys.exit(f"No OCR engine installed for slip images ({path.name}).\n"
             f"Install one: {missing}\n"
             f"Or convert the slips to PDF and pass those instead.")


def slip_record(text: str, source: str) -> SlipRecord:
    """Pull [Date, Amount, ID] out of one slip's text.

    Amount: prefer a line that names it (amount / total / paid / Rs / Rs-Sign),
    picking the largest label there (fees sit below the principal); else a lone
    figure on the slip. ID: the first 12-digit run - the UPI reference."""
    lines = [l for l in text.splitlines() if l.strip()]
    d = next((parse_date(l) for l in lines if parse_date(l)), None)
    utr = find_utr(text)
    labeled: list[float] = []
    plain: list[float] = []
    for l in lines:
        cands = [v for v, _ in amount_candidates(l)]
        if not cands:
            continue
        ll = lower(l)
        if ("₹" in l) or any(h in ll for h in SLIP_AMOUNT_HINTS):
            labeled.extend(cands)
        else:
            plain.extend(cands)
    amount: float | None = None
    if labeled:
        amount = max(labeled)
    elif len(plain) == 1:
        amount = plain[0]
    return SlipRecord(d, amount, utr, squash(text)[:90], source)


def load_slips(paths: Sequence[Path], engine: str) -> list[SlipRecord]:
    out: list[SlipRecord] = []
    for p in paths:
        out.append(slip_record(ocr_slip(p, engine), p.name))
    return out


# ── payments (web-app side) ─────────────────────────────────────────────────

def load_payments(path: Path) -> tuple[str, list[dict]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"Couldn't read the payments export: {e}")
    society = "Society"
    if isinstance(raw, dict):
        if raw.get("format") == "society-khata/full-backup" and isinstance(raw.get("payments"), list):
            society = str((raw.get("society") or {}).get("societyName") or society)
            rows = raw["payments"]
        else:
            sys.exit("Unrecognised JSON - expected the 'Matcher JSON' export "
                     "(a bare array) or a full backup (format 'society-khata/full-backup').")
    elif isinstance(raw, list):
        rows = raw
    else:
        sys.exit("Unrecognised payments JSON - expected a JSON array of receipts.")
    seen: set[str] = set()
    payments: list[dict] = []
    for r in rows:
        if isinstance(r, dict) and r.get("id") and str(r["id"]) not in seen:
            seen.add(str(r["id"]))
            payments.append(r)
    if not payments:
        sys.exit("The payments export contains no receipts.")
    return society, payments


# ── Mode A matching: statement credits + slip evidence vs app receipts ─────

def match(credits: list[Credit], payments: list[dict],
          window_days: int, tolerance: float) -> list[Match]:
    """UTR hits claim their credit first; the rest match greedily, earliest
    receipts first, nearest date wins. One credit = one receipt."""

    matches: list[Match] = []
    claimed: set[int] = set()

    def claim(p: dict, c: Credit, via: str) -> None:
        c.matched_to = str(p["id"])
        matches.append(Match(str(p["id"]), c.date,
                             c.bank_ref or c.utr or c.narrative[:40], via))

    ordered = sorted(payments, key=lambda p: iso_date(str(p.get("createdAt", ""))) or date.max)

    # 1) the receipt's own 12-digit UTR printed on the statement is decisive
    for p in ordered:
        utr = str(p.get("utr") or "")
        amount = num(p.get("amount"))
        if len(utr) != 12 or not amount:
            continue
        for i, c in enumerate(credits):
            if i in claimed or c.utr != utr:
                continue
            if abs(c.amount - amount) <= max(tolerance, 1.0):
                claimed.add(i)
                claim(p, c, "utr")
                break

    # 2) amount within tolerance and date within the window, nearest first
    for p in ordered:
        pid = str(p["id"])
        if any(m.payment_id == pid for m in matches):
            continue
        pdt = iso_date(str(p.get("createdAt", "")))
        amount = num(p.get("amount"))
        if pdt is None or not amount:
            continue
        best: tuple[tuple[int, float], int] | None = None
        for i, c in enumerate(credits):
            if i in claimed or abs(c.amount - amount) > tolerance:
                continue
            gap = abs((c.date - pdt).days)
            if gap > window_days:
                continue
            key = (gap, abs(c.amount - amount))
            if best is None or key < best[0]:
                best = (key, i)
        if best is not None:
            i = best[1]
            claimed.add(i)
            claim(p, credits[i], "amount+date")
    return matches


def slip_matches(existing: list[Match], payments: list[dict],
                 slips: list[SlipRecord], window_days: int,
                 tolerance: float) -> list[Match]:
    """Slip leg for Mode A: a receipt whose UTR appears on a resident slip is
    verified with weaker evidence - the report labels it, never the statement."""
    matched = {m.payment_id for m in existing}
    out: list[Match] = []
    for p in sorted(payments, key=lambda q: iso_date(str(q.get("createdAt", ""))) or date.max):
        pid = str(p["id"])
        if pid in matched:
            continue
        receipt_utr = str(p.get("utr") or "")
        amount = num(p.get("amount"))
        pdt = iso_date(str(p.get("createdAt", "")))
        for s in slips:
            if s.utr and receipt_utr and s.utr == receipt_utr:
                d = s.date or pdt
                if d is not None:
                    out.append(Match(pid, d, f"resident slip {s.source}", "slip-utr"))
                    break
                continue
            # no UTRs to compare: amount+date between receipt and slip only
            if s.amount is not None and amount and abs(s.amount - amount) <= tolerance:
                if s.date is not None and pdt is not None and abs((s.date - pdt).days) <= window_days:
                    out.append(Match(pid, s.date, f"resident slip {s.source}", "slip-utr"))
                    break
    return out


# ── Mode B: payment document vs resident slips ──────────────────────────────

def compare_documents(pays: list[DocRecord], slips: list[SlipRecord],
                      window_days: int, tolerance: float
                      ) -> tuple[list[DocMatch], list[tuple[str, str, str]]]:
    """Extract[Date, Amount, ID] on both sides, match, then flag the rest.
    Returns (matched pairs, flagged errors) with a human reason each."""
    matches: list[DocMatch] = []
    errors: list[tuple[str, str, str]] = []
    claimed_slips: set[int] = set()

    # records where extraction failed get flagged right away
    for r in pays:
        if r.amount is None:
            errors.append(("payment doc", r.source,
                           f"amount not readable (UTR {r.utr or 'not seen'}) - read the row by hand"))
    for s in slips:
        if s.amount is None:
            errors.append(("bank slip", s.source, "amount not clear from OCR - check the image"))

    # 1) ID comparison: the same 12-digit reference on both sides is decisive
    for pr in pays:
        if not pr.utr or pr.amount is None:
            continue
        for j, s in enumerate(slips):
            if j in claimed_slips or not s.utr:
                continue
            if s.utr != pr.utr:
                continue
            if s.amount is not None and pr.amount is not None and abs(s.amount - pr.amount) > tolerance:
                errors.append(("flagged", f"{pr.source} vs {s.source}",
                               f"same UTR {pr.utr} but amounts differ: "
                               f"doc Rs {pr.amount:.2f} vs slip Rs {s.amount:.2f}"))
                claimed_slips.add(j)
                break
            matches.append(DocMatch(pr, s, "utrid"))
            claimed_slips.add(j)
            break

    # 2) amount+date where IDs didn't tie the pair down
    for i, pr in enumerate(pays):
        if pr.amount is None or any(m.pay.source == pr.source for m in matches):
            continue
        best: tuple[tuple[float, int], int] | None = None
        for j, s in enumerate(slips):
            if j in claimed_slips or s.amount is None:
                continue
            if abs(s.amount - pr.amount) > tolerance:
                continue
            if s.date is None or pr.date is None:
                continue
            gap = abs((s.date - pr.date).days)
            if gap > window_days:
                continue
            key = (float(gap), abs(s.amount - pr.amount))
            if best is None or key < best[0]:
                best = (key, j)
        if best is not None:
            j = best[1]
            matches.append(DocMatch(pr, slips[j], "amount+date"))
            claimed_slips.add(j)

    # 3) whatever is left over is flagged with a near-miss explanation
    free_slips = [s for j, s in enumerate(slips) if j not in claimed_slips]
    for pr in pays:
        if pr.amount is None or any(m.pay.source == pr.source for m in matches):
            continue
        reason = "no slip within the window at this amount (or this date)"
        if pr.amount is not None:
            near_amount = [s for s in free_slips if s.amount is not None and abs(s.amount - pr.amount) <= tolerance]
            if near_amount:
                gaps = [abs((s.date - pr.date).days) for s in near_amount if s.date and pr.date]
                if gaps:
                    reason = f"amount found on a slip, but {min(gaps)} day(s) off (window +-{window_days}d)"
                else:
                    reason = "amount found on a slip, but the slip's date couldn't be read"
        errors.append(("payment doc", pr.source, reason))
    for s in free_slips:
        errors.append(("bank slip", s.source, "no payment entry mentions this slip's ID / amount"))

    return matches, errors


# ── outputs ─────────────────────────────────────────────────────────────────

def write_verdict(path: Path, matches: list[Match], payments: list[dict]) -> dict:
    """The one file the web app understands: format society-khata/bank-verify."""
    by_id = {str(p["id"]): p for p in payments}
    payload = {
        "format": "society-khata/bank-verify",
        "version": 1,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "verified": [
            {
                "id": m.payment_id,
                "matchedOn": datetime(m.bank_date.year, m.bank_date.month,
                                      m.bank_date.day).isoformat(timespec="seconds"),
                "bankRef": (m.bank_ref or m.via)[:40],
                "amount": round(num(by_id.get(m.payment_id, {}).get("amount")), 2),
                "via": m.via,
            }
            for m in sorted(matches, key=lambda m: m.bank_date)
            if str(by_id.get(m.payment_id, {}).get("status", "pending")) == "pending"
        ],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def _styles() -> dict[str, object]:
    from openpyxl.styles import Alignment, Font, PatternFill
    return {
        "fill": PatternFill("solid", fgColor="1D4D3B"),
        "font": Font(bold=True, color="FFFFFF"),
        "align": Alignment(horizontal="center"),
        "warn": PatternFill("solid", fgColor="F6E3E0"),
        "stray": PatternFill("solid", fgColor="F8F0DC"),
    }


def _add_sheet(wb, st: dict[str, object], name: str, headers: Sequence[str],
               rows: list[list[object]], widths: Sequence[int],
               row_fill: object | None = None) -> None:
    from openpyxl.utils import get_column_letter
    ws = wb.create_sheet(title=name)
    ws.append(list(headers))
    for c in ws[1]:
        c.fill, c.font = st["fill"], st["font"]
        c.alignment = st["align"]
    for ri, row in enumerate(rows):
        ws.append(list(row))
        if row_fill is not None:
            for ci in range(1, len(headers) + 1):
                ws.cell(row=ri + 2, column=ci).fill = row_fill
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def write_report(path: Path, society: str, payments: list[dict],
                 credits: list[Credit], matches: list[Match],
                 window_days: int, tolerance: float) -> None:
    """Mode A report: the treasurer's answer to 'did everyone really pay?'."""
    from openpyxl import Workbook

    st = _styles()
    by_id = {str(p["id"]): p for p in payments}
    matched_ids = {m.payment_id for m in matches}
    via_label = {"utr": "UTR on statement", "amount+date": "amount + date",
                 "slip-utr": "resident slip UTR"}

    matched_rows = [
        [
            m.payment_id,
            _who(by_id.get(m.payment_id, {})),
            _month_label(by_id.get(m.payment_id, {}).get("month")),
            round(num(by_id.get(m.payment_id, {}).get("amount")), 2),
            m.bank_date.strftime("%d %b %Y"),
            via_label.get(m.via, m.via),
            str(by_id.get(m.payment_id, {}).get("utr") or "-"),
            m.bank_ref or "-",
        ]
        for m in matches
    ]

    strays_unclaimed = [c for c in credits if not c.matched_to]
    unmatched_rows = []
    for p in payments:
        pid = str(p["id"])
        if pid in matched_ids or str(p.get("status", "pending")) != "pending":
            continue
        pdt = iso_date(str(p.get("createdAt", "")))
        amount = num(p.get("amount"))
        reason = "no bank credit within the window at this amount"
        near_amount = [c for c in strays_unclaimed if abs(c.amount - amount) <= tolerance]
        near_date = [c for c in strays_unclaimed
                     if pdt is not None and abs((c.date - pdt).days) <= window_days]
        if near_amount and pdt is not None:
            gap = min(abs((c.date - pdt).days) for c in near_amount)
            reason = f"amount matches, nearest credit {gap} day(s) away (window +-{window_days}d)"
        elif near_date:
            off = min(abs(c.amount - amount) for c in near_date)
            reason = f"date in window, closest credit is Rs {off:+.2f} off"
        unmatched_rows.append([
            pid, _who(p), _month_label(p.get("month")), round(amount, 2),
            str(p.get("createdAt", ""))[:10], str(p.get("utr") or "-"), reason,
        ])

    stray_rows = [
        [c.date.strftime("%d %b %Y"), round(c.amount, 2), c.source,
         c.utr or "-", (c.narrative[:80] or "-")]
        for c in credits if not c.matched_to
    ]

    wb = Workbook()
    _summary_sheet(wb, {
        "Statement span": _span(credits),
        "Receipts checked": len(payments),
        "Matched - now verified by bank / slip evidence": len(matched_rows),
        "Receipts with no bank credit - chase or reverse": len(unmatched_rows),
        "All payments on the site are paid": (
            "ALL PAID - every pending receipt matched" if (payments and not unmatched_rows)
            else f"NO - {len(unmatched_rows)} receipt(s) unmatched (see 'Unmatched payments')"
        ),
        "Statement credits with no receipt - unexpected income?": len(stray_rows),
        "Match window": f"+-{window_days} days, +-Rs {tolerance:g}",
        "Generated": datetime.now().strftime("%d %b %Y, %H:%M"),
        "Next step": "Import verified_ids.json in the app: Admin > Payments > Import bank verify",
    }, society)
    _add_sheet(wb, st, "Matched",
               ["Receipt", "Flat", "For month", "Amount Rs", "Bank credit date",
                "How matched", "App UTR", "Bank narrative / ref"],
               matched_rows, [16, 10, 12, 11, 16, 20, 15, 46])
    _add_sheet(wb, st, "Unmatched payments",
               ["Receipt", "Flat", "For month", "Amount Rs", "Recorded on",
                "App UTR", "Why unmatched"],
               unmatched_rows, [16, 10, 12, 11, 13, 15, 46], row_fill=st["warn"])
    _add_sheet(wb, st, "Credits not in app",
               ["Bank credit date", "Amount Rs", "Where on statement", "UTR", "Narrative"],
               stray_rows, [16, 11, 22, 15, 70], row_fill=st["stray"])
    wb.save(path)


def write_doc_report(path: Path, society: str, pays: list[DocRecord],
                     slips: list[SlipRecord], matches: list[DocMatch],
                     errors: list[tuple[str, str, str]],
                     window_days: int, tolerance: float) -> None:
    """Mode B report: payment document vs resident slips."""
    from openpyxl import Workbook

    st = _styles()
    doc_rows = [
        [
            m.pay.source, m.pay.date.strftime("%d %b %Y"),
            "-" if m.pay.amount is None else round(m.pay.amount, 2),
            m.pay.utr or "-", s.source,
            "-" if s.date is None else s.date.strftime("%d %b %Y"),
            "-" if s.amount is None else round(s.amount, 2),
            "same UTR" if m.via == "utrid" else "amount + date",
        ]
        for m, s in [(m, m.slip) for m in matches]
    ]
    error_rows = [[side, where, reason] for (side, where, reason) in errors]

    wb = Workbook()
    _summary_sheet(wb, {
        "Payment entries extracted": len(pays),
        "Slips read": len(slips),
        "Matched pairs": len(doc_rows),
        "Flagged errors": len(error_rows),
        "Match window": f"+-{window_days} days, +-Rs {tolerance:g}",
        "Generated": datetime.now().strftime("%d %b %Y, %H:%M"),
        "Note": "Flagged rows need a human eye - OCR misreads are the usual cause.",
    }, society)
    _add_sheet(wb, st, "Matched pairs",
               ["Doc row", "Doc date", "Doc amount Rs", "Doc UTR", "Slip file",
                "Slip date", "Slip amount Rs", "How matched"],
               doc_rows, [18, 13, 13, 15, 22, 13, 14, 13])
    _add_sheet(wb, st, "Flagged errors",
               ["Side", "Where", "Reason"],
               error_rows, [14, 34, 76], row_fill=st["warn"])
    wb.save(path)


def _summary_sheet(wb, rows: dict, society: str) -> None:
    from openpyxl.styles import Font
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = society or "Society"
    ws["A1"].font = Font(bold=True, size=14)
    for r, (k, v) in enumerate(list(rows.items()), start=3):
        ws[f"A{r}"], ws[f"B{r}"] = k, v
        ws[f"A{r}"].font = Font(bold=True)
    ws.column_dimensions["A"].width = 48
    ws.column_dimensions["B"].width = 62


def _who(p: dict) -> str:
    return f"{p.get('wing', '?')}-{p.get('flat', '?')}"


def _month_label(m: object) -> str:
    try:
        return datetime.strptime(str(m), "%Y-%m").strftime("%b %Y")
    except ValueError:
        return str(m or "-")


def _span(credits: list[Credit]) -> str:
    if not credits:
        return "n/a"
    first = min((c.date for c in credits), default=date.min)
    last = max((c.date for c in credits), default=date.max)
    return f"{first.strftime('%d %b %Y')} to {last.strftime('%d %b %Y')}"


# ── entry point ─────────────────────────────────────────────────────────────

def main(argv: Sequence[str] | None = None) -> None:
    ap = argparse.ArgumentParser(
        prog="python bank_statement_matcher.py",
        description="Cross-check Society Khata payments against bank evidence "
                    "and emit verified_ids.json / an Excel report.",
    )
    ap.add_argument("files", nargs="*", metavar="FILE", help="{statement|payment doc} .pdf/.csv/.xlsx, "
                    "payments.json, and/or slip image/PDFs — see --help for the two modes")
    ap.add_argument("--slips", nargs="*", default=[], metavar="SLIP",
                    help="resident slip images/PDFs (OCR leg; repeatable)")
    ap.add_argument("--ocr", choices=("auto", "paddle", "tesseract"), default="auto",
                    help="slip OCR engine (default: auto - paddle then tesseract)")
    ap.add_argument("--out", default=None, help="report XLSX (default: bank-match-report.xlsx "
                    "in Mode A, doc-compare-report.xlsx in Mode B)")
    ap.add_argument("--json", default="verified_ids.json",
                    help="verdict file for the app in Mode A (default: %(default)s)")
    ap.add_argument("--window-days", type=int, default=WINDOW_DAYS,
                    help=f"date window in days (default: {WINDOW_DAYS})")
    ap.add_argument("--amount-tolerance", type=float, default=AMOUNT_TOLERANCE,
                    help=f"Rs tolerance (default: {AMOUNT_TOLERANCE:g})")
    ap.add_argument("--all", action="store_true",
                    help="include receipts the app already marked verified")
    args = ap.parse_args(argv)

    tol, window = args.amount_tolerance, args.window_days

    files: list[Path] = [Path(f) for f in args.files] + [Path(s) for s in args.slips]
    if not files:
        ap.error("Give files, e.g.:\n"
                 "  MODE A   statement.pdf payments.json [--slips slip.png]\n"
                 "  MODE B   payment.pdf slip1.png slip2.pdf")

    jsons = [p for p in files if p.suffix.lower() == ".json"]
    img_slips = [p for p in files if p.suffix.lower() in IMG_EXTS]
    doclike = [p for p in files if p not in jsons and p not in img_slips]

    if len(jsons) > 1:
        ap.error("Only one payments JSON may be passed.")

    if jsons:
        # MODE A: operand order is "STATEMENT payments.json [slip...]" —
        # documents BEFORE the JSON are the statement; everything AFTER it
        # (images or text-PDF slips) is slip evidence.
        j = files.index(jsons[0])
        before = [p for p in files[:j] if p not in jsons]
        if len(before) > 1:
            ap.error("More than one statement-like file before payments.json - "
                     "pass just one statement.")
        slips = [p for p in files[j + 1:] if p not in jsons] \
            + [s for s in (Path(x) for x in args.slips) if s not in files[j + 1:]]
        _mode_json(before[0] if before else None, jsons[0], slips, args)
        return

    # MODE B: operand order is "PAYMENTDOC slip1 slip2 slip3" — the first
    # document file is the payment doc; later PDFs count as text-layer slips.
    doc = doclike[0] if doclike else None
    if [p for p in doclike[1:] if p.suffix.lower() not in (".pdf",)]:
        ap.error("Two document files were passed - use one: the payment document "
                 "(Mode B); the rest must be slips.")
    pdf_slips = [p for p in doclike[1:] if p.suffix.lower() == ".pdf"]
    slips = img_slips + pdf_slips \
        + [s for s in (Path(x) for x in args.slips) if s not in img_slips and s not in pdf_slips]

    if doc is None:
        ap.error("Mode B needs the payment document (PDF/CSV/XLSX) plus slips.")
    if not slips:
        ap.error("Mode B needs slips: PAYMENTDOC slip1.png slip2.pdf (or --slips ...)")
    _mode_doc(doc, slips, args)


def _mode_json(stmt_path: Path | None, json_path: Path, slip_paths: list[Path], args) -> None:
    """MODE A: statement (+ optional slips) vs receipts recorded in the app."""
    if stmt_path is not None and not stmt_path.is_file():
        sys.exit(f"No such file: {stmt_path}")
    if not json_path.is_file():
        sys.exit(f"No such file: {json_path}")

    society, payments = load_payments(json_path)
    if not args.all:
        pending = [p for p in payments if str(p.get("status", "pending")) == "pending"]
        print(f"Loaded {len(payments)} receipt(s); checking the {len(pending)} pending "
              f"one(s) (--all includes already-verified receipts too).")
        payments = pending
    else:
        print(f"Loaded {len(payments)} receipt(s), including already-verified ones.")

    if stmt_path is None:
        credits = []
        print("No statement given - verifying only against the slips provided.")
    else:
        credits = load_statement(stmt_path)
        if not credits:
            sys.exit("No usable bank credits in the statement. A scanned photo-PDF has no "
                     "text layer - ask the bank for the CSV/XLSX version.")
        print(f"Statement '{stmt_path.name}': {len(credits)} credit row(s), {_span(credits)}.")

    matches = match(credits, payments, args.window_days, args.amount_tolerance)
    note = ""
    slips: list[SlipRecord] = []
    if slip_paths:
        slips = load_slips(slip_paths, args.ocr)
        extra = slip_matches(matches, payments, slips, args.window_days, args.amount_tolerance)
        matches += extra
        if extra:
            note = f" (+{len(extra)} from slip OCR)"
    print(f"Matched {len(matches)} of {len(payments)} receipt(s){note}.")

    verdict = write_verdict(Path(args.json), matches, payments)
    print(f"Wrote {args.json}: {len(verdict['verified'])} pending receipt(s) verified.")

    write_report(Path(args.out or "bank-match-report.xlsx"), society, payments,
                 credits, matches, args.window_days, args.amount_tolerance)
    print(f"Wrote {args.out or 'bank-match-report.xlsx'}.")

    got = {m.payment_id for m in matches}
    unmatched = [str(p["id"]) for p in payments if str(p["id"]) not in got]
    if unmatched:
        print(f"Receipts with no matching bank credit: {', '.join(unmatched)}")
        print("(They stay pending in the app - the committee chases them up by hand.)")
    elif payments:
        print()
        print("ALL PAYMENTS ADDED ON THE SITE ARE PAID — "
              "every record below matched the bank / slip evidence.")
        print(f"(Import {args.json} in Admin > Payments to mark them verified.)")
    else:
        print("No pending receipts on the site to check - nothing is awaiting the bank.")
    used_slips = {m.bank_ref for m in matches if m.via == "slip-utr"}
    for s in slips:
        if f"resident slip {s.source}" not in used_slips:
            print(f"Slip '{s.source}' did not name any pending receipt.")


def _mode_doc(doc_path: Path, slip_paths: list[Path], args) -> None:
    """MODE B: payment document vs resident bank slips (the OCR leg)."""
    if not slip_paths:
        sys.exit("Mode B needs at least one slip (image or PDF) — "
                 "positional or --slips.")
    for f in [doc_path, *slip_paths]:
        if not f.is_file():
            sys.exit(f"No such file: {f}")

    pays = load_payment_doc(doc_path)
    print(f"Payment document '{doc_path.name}': {len(pays)} entries with Date/Amount/ID.")
    slips = load_slips(slip_paths, args.ocr)
    print(f"Bank slips read: {len(slips)} via OCR.")

    matches, errors = compare_documents(pays, slips, args.window_days, args.amount_tolerance)
    print(f"Matched {len(matches)} pair(s); flagged {len(errors)} error(s).")

    out = Path(args.out or "doc-compare-report.xlsx")
    write_doc_report(out, "", pays, slips, matches, errors,
                     args.window_days, args.amount_tolerance)
    print(f"Wrote {out}.")

    for side, where, reason in errors:
        print(f"FLAG [{side}] {where}: {reason}")


if __name__ == "__main__":
    main()
