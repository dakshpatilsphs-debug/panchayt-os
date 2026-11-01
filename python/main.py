"""
FastAPI HTTP Web Service for Bank Statement Matching
Society Khata — Panchayat OS
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import core matching logic from bank_statement_matcher
from bank_statement_matcher import (
    Credit,
    Match,
    load_statement,
    match,
    num,
)

app = FastAPI(
    title="Society Khata Statement Matcher API",
    description="HTTP API for matching bank statements (PDF/CSV/XLSX) against payments ledger",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
@app.get("/api")
def root_info() -> dict[str, str]:
    return {
        "service": "Society Khata Bank Statement Matcher",
        "status": "online",
        "endpoints": "/api/match, /api/health",
    }


@app.get("/health")
@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "python-statement-matcher"}


def _parse_payments_payload(raw_text: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in payments data: {exc}")

    if isinstance(data, dict):
        if data.get("format") == "society-khata/full-backup" and isinstance(data.get("payments"), list):
            rows = data["payments"]
        elif isinstance(data.get("payments"), list):
            rows = data["payments"]
        else:
            raise HTTPException(
                status_code=400,
                detail="Expected a payments array or 'society-khata/full-backup' JSON object.",
            )
    elif isinstance(data, list):
        rows = data
    else:
        raise HTTPException(status_code=400, detail="Expected a JSON array of payments.")

    seen: set[str] = set()
    payments: list[dict[str, Any]] = []
    for r in rows:
        if isinstance(r, dict) and r.get("id"):
            pid = str(r["id"])
            if pid not in seen:
                seen.add(pid)
                payments.append(r)

    if not payments:
        raise HTTPException(status_code=400, detail="Payments data contained 0 valid receipt entries.")

    return payments


@app.post("/match")
@app.post("/api/match")
async def match_statement_endpoint(
    statement: UploadFile = File(..., description="Bank statement PDF, CSV, or XLSX file"),
    payments: Optional[UploadFile] = File(None, description="Payments JSON file"),
    payments_json: Optional[str] = Form(None, description="Payments JSON string alternative"),
    window_days: int = Form(3, description="Date match tolerance window in days (default: 3)"),
    tolerance: float = Form(1.0, description="Amount tolerance in Rs (default: 1.0)"),
) -> JSONResponse:
    """
    Match an uploaded bank statement against a list of receipts/payments.
    Returns the verdict in `society-khata/bank-verify` JSON format.
    """
    if not statement.filename:
        raise HTTPException(status_code=400, detail="Missing statement filename.")

    # 1. Extract payments JSON
    payments_text: str = ""
    if payments is not None:
        content_bytes = await payments.read()
        payments_text = content_bytes.decode("utf-8-sig", errors="replace")
    elif payments_json is not None:
        payments_text = payments_json
    else:
        raise HTTPException(
            status_code=400,
            detail="Either 'payments' file or 'payments_json' form field must be provided.",
        )

    payment_rows = _parse_payments_payload(payments_text)

    # 2. Save statement to temporary file with correct extension so parser detects format
    ext = Path(statement.filename).suffix.lower()
    if ext not in [".pdf", ".csv", ".xlsx", ".xlsm"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported statement extension '{ext}'. Must be .pdf, .csv, or .xlsx.",
        )

    temp_dir = tempfile.mkdtemp(prefix="stmt_")
    temp_path = Path(temp_dir) / f"statement{ext}"

    try:
        with open(temp_path, "wb") as f_out:
            shutil.copyfileobj(statement.file, f_out)

        # 3. Parse credits from statement
        try:
            credits: list[Credit] = load_statement(temp_path)
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Error reading bank statement: {exc}",
            )

        if not credits:
            return JSONResponse(
                content={
                    "format": "society-khata/bank-verify",
                    "version": 1,
                    "generatedAt": datetime.now().isoformat(timespec="seconds"),
                    "verified": [],
                    "summary": {
                        "totalCreditsFound": 0,
                        "totalPaymentsGiven": len(payment_rows),
                        "matchedCount": 0,
                        "unmatchedCount": len(payment_rows),
                        "message": "No credit transactions could be extracted from this statement.",
                    },
                }
            )

        # 4. Perform matching
        matches: list[Match] = match(credits, payment_rows, window_days, tolerance)

        # 5. Build verdict in society-khata/bank-verify format
        by_id = {str(p["id"]): p for p in payment_rows}
        verified_entries = [
            {
                "id": m.payment_id,
                "matchedOn": datetime(m.bank_date.year, m.bank_date.month, m.bank_date.day).isoformat(
                    timespec="seconds"
                ),
                "bankRef": (m.bank_ref or m.via)[:40],
                "amount": round(num(by_id.get(m.payment_id, {}).get("amount")), 2),
                "via": m.via,
            }
            for m in sorted(matches, key=lambda m: m.bank_date)
            # Include if pending or status not specified
            if str(by_id.get(m.payment_id, {}).get("status", "pending")) == "pending"
        ]

        matched_ids = {m.payment_id for m in matches}
        unmatched_ids = [str(p["id"]) for p in payment_rows if str(p.get("id")) not in matched_ids]

        return JSONResponse(
            content={
                "format": "society-khata/bank-verify",
                "version": 1,
                "generatedAt": datetime.now().isoformat(timespec="seconds"),
                "verified": verified_entries,
                "summary": {
                    "totalCreditsFound": len(credits),
                    "totalPaymentsGiven": len(payment_rows),
                    "matchedCount": len(verified_entries),
                    "unmatchedCount": len(unmatched_ids),
                    "unmatchedIds": unmatched_ids,
                },
            }
        )

    finally:
        # Clean up temporary directory
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    print(f"Starting Statement Matcher API on http://localhost:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

