import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconAlert, IconArrow, IconCheck, IconClose, IconDownload, IconEye, IconImage, IconLedger, IconTrash } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import { exportRegister } from "../../lib/excel";
import { matchStatement, readStatement, type StatementCompare } from "../../lib/statement";
import type { Member, Payment, PaymentStatus } from "../../lib/types";
import { deletePayment, listMembers, listPayments, loadUsage, reduceMemberDue, updatePayment } from "../../lib/store";
import { availableMonths, downloadBlob, fmtDate, fmtDateTime, inr, monthLabel, slug } from "../../lib/util";
import { useAdmin } from "./AdminCtx";

type StatusFilter = "all" | PaymentStatus;
type Row = { p: Payment; busy?: boolean };

/** Verdict headline: matched X of Y / all paid / none pending lives in the panel. */
function matchStatementLabel(c: StatementCompare): string {
  if (c.checked === 0) return "Nothing pending";
  const failedWord = c.failed.length ? `, ${c.failed.length} the statement marks FAILED` : "";
  return `${c.matched.length} of ${c.checked} pending receipt(s) matched — ${c.unmatched.length} need chasing${failedWord}`;
}

export default function PaymentsTab() {
  const { settings } = useAdmin();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [wing, setWing] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [month, setMonth] = useState("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchingMsg, setMatchingMsg] = useState("");
  const [compare, setCompare] = useState<StatementCompare | null>(null);

  useEffect(() => {
    Promise.all([listPayments(), listMembers()])
      .then(([ps, ms]) => {
        setRows(ps.map((p) => ({ p })));
        setMembers(ms);
      })
      .catch((e) => toast(e.message, "err"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wings = useMemo(() => Array.from(new Set(members.map((m) => m.wing))).sort(), [members]);
  const months = useMemo(() => availableMonths((rows ?? []).map((r) => r.p)), [rows]);

  const visible = useMemo(() => {
    let list = (rows ?? []).map((r) => r.p);
    if (wing !== "all") list = list.filter((p) => p.wing === wing);
    if (status !== "all") list = list.filter((p) => p.status === status);
    if (month !== "all") list = list.filter((p) => p.month === month);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.id.toLowerCase().includes(needle) ||
          (p.utr || "").includes(needle) ||
          p.ownerName.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [rows, wing, status, month, q]);

  const counts = useMemo(() => {
    const base = rows ?? [];
    return {
      all: base.length,
      pending: base.filter((r) => r.p.status === "pending").length,
      verified: base.filter((r) => r.p.status === "verified").length,
      rejected: base.filter((r) => r.p.status === "rejected").length,
    };
  }, [rows]);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.p.id === id ? { ...r, ...patch } : r)));

  const verify = async (p: Payment) => {
    patchRow(p.id, { busy: true });
    try {
      await updatePayment(p.id, { status: "verified", verifiedAt: new Date().toISOString(), dueSettled: true });
      // dueSettled guards double-settling if the row is verified twice
      const shouldReduce = !p.dueSettled && p.maintenancePart > 0;
      if (shouldReduce) await reduceMemberDue(p.memberId, p.maintenancePart);
      patchRow(p.id, {
        p: { ...p, status: "verified", verifiedAt: new Date().toISOString(), dueSettled: true },
        busy: false,
      });
      toast(
        !shouldReduce
          ? `${p.id} verified · no dues to settle.`
          : `${p.id} verified · ${p.wing}-${p.flat} dues reduced by ${inr(p.maintenancePart)}.`,
        "ok"
      );
    } catch (e) {
      patchRow(p.id, { busy: false });
      toast((e as Error).message, "err");
    }
  };

  const reject = async (p: Payment) => {
    patchRow(p.id, { busy: true });
    try {
      await updatePayment(p.id, { status: "rejected" });
      patchRow(p.id, { p: { ...p, status: "rejected" }, busy: false });
      toast(`${p.id} rejected — resident will be asked to re-submit.`, "info");
    } catch (e) {
      patchRow(p.id, { busy: false });
      toast((e as Error).message, "err");
    }
  };

  const remove = async (p: Payment) => {
    if (!window.confirm(`Delete receipt ${p.id}? This cannot be undone — physical registrations keep no copy of deleted rows.`)) return;
    patchRow(p.id, { busy: true });
    try {
      await deletePayment(p.id);
      setRows((rs) => (rs ?? []).filter((r) => r.p.id !== p.id));
      toast(`${p.id} deleted from the ledger.`, "info");
    } catch (e) {
      patchRow(p.id, { busy: false });
      toast((e as Error).message, "err");
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const usage = await loadUsage();
      await exportRegister(visible, members, settings, usage, {
        scope: month,
        filterNote: `filtered view: ${visible.length} of ${counts.all}`,
      });
      toast("Excel register of the filtered view saved.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(false);
    }
  };

  /** The website leg of the cross-check: read the bank statement locally,
   *  compare it against every pending receipt recorded on the site. */
  const matchStatementFile = async (file: File | undefined) => {
    if (!file || !rows) return;
    setMatching(true);
    setMatchingMsg("Opening the file…");
    try {
      const reading = await readStatement(file, (pct, note) => setMatchingMsg(`${note} (${pct}%)`));
      if (reading.credits.length === 0) {
        throw new Error(
          "Still can't read that statement — no credits found even though the OCR ran. Try the bank's CSV/XLSX, or a clearer scan/photo."
        );
      }
      const cmp = matchStatement(reading.credits, rows.map((r) => r.p), { failures: reading.failed });
      setCompare({ ...cmp, fileName: file.name });
      if (reading.learned) {
        toast(`Learned ${reading.bank}'s statement layout — next time it reads automatically.`, "ok");
      }
      if (cmp.checked === 0) {
        toast(`${file.name}: ${cmp.credits} credit(s) read. Nothing pending — every receipt is already verified.`, "info");
      } else if (cmp.allPaid) {
        toast(`ALL PAYMENTS ON THE SITE ARE PAID — all ${cmp.checked} pending receipt(s) matched ${file.name}.`, "ok");
      } else {
        const failedWord = cmp.failed.length ? `, ${cmp.failed.length} the statement marks FAILED` : "";
        toast(`${cmp.matched.length} of ${cmp.checked} pending receipt(s) matched — ${cmp.unmatched.length} need chasing${failedWord}.`, "info");
      }
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setMatching(false);
      setMatchingMsg("");
    }
  };

  /** Verify everything the in-browser match found, straight from the panel. */
  const verifyMatchedPanel = async () => {
    if (!compare) return;
    setImporting(true);
    try {
      const { applied, skipped } = await applyVerdicts(
        compare.matched.map((m) => ({
          id: m.id,
          matchedOn: new Date(m.dateMs).toISOString(),
          bankRef: m.bankRef,
          amount: m.amount,
          via: m.via,
        })),
        "in-app bank-statement match"
      );
      setCompare(null);
      toast(
        `Match panel verified ${applied} receipt${applied === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (already settled)` : ""}.`,
        applied ? "ok" : "info"
      );
    } finally {
      setImporting(false);
    }
  };

  /** Lean JSON of receipts for the Python bank-statement matcher. */
  const downloadMatcherJson = () => {
    if (!rows) return;
    const lean = rows.map((r) => {
      const { screenshot: _shot, screenshotMeta: _meta, ...rest } = r.p;
      return rest;
    });
    const blob = new Blob([JSON.stringify(lean, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${slug(settings.societyName)}-payments-for-bank-matcher-${new Date().toISOString().slice(0, 10)}.json`);
    toast("Receipt JSON saved — feed it to the bank-statement matcher.", "ok");
  };

  /** Unmatched receipts get the committee's own verdict buttons from the
   *  panel: verify as paid (money landed, window missed it) or mark failed
   *  (never received — resident re-submits). */
  const verifyUnmatchedPanel = async () => {
    if (!compare || !rows || compare.unmatched.length === 0) return;
    setImporting(true);
    try {
      const { applied } = await applyVerdicts(
        compare.unmatched.map((u) => {
          const p = rows.find((r) => r.p.id === u.id)?.p;
          return { id: u.id, amount: p?.amount, via: "manual-panel" };
        }),
        "unmatched receipts — committee decision"
      );
      setCompare(null);
      toast(`Verified ${applied} unmatched receipt${applied === 1 ? "" : "s"} as paid — dues settled.`, applied ? "ok" : "info");
    } finally {
      setImporting(false);
    }
  };

  const markUnmatchedFailedPanel = async () => {
    if (!compare || !rows || compare.unmatched.length === 0) return;
    setImporting(true);
    try {
      let marked = 0;
      for (const u of compare.unmatched) {
        const row = rows.find((r) => r.p.id === u.id);
        if (!row || row.p.status !== "pending") continue;
        await updatePayment(row.p.id, {
          status: "rejected",
          note: [row.p.note, `marked failed from match panel: no bank credit found (${u.reason})`].filter(Boolean).join(" · "),
        });
        patchRow(row.p.id, { p: { ...row.p, status: "rejected" }, busy: false });
        marked += 1;
      }
      setCompare(null);
      toast(
        `Marked ${marked} unmatched receipt${marked === 1 ? "" : "s"} failed — the resident(s) must pay again.`,
        marked ? "ok" : "info"
      );
    } finally {
      setImporting(false);
    }
  };

  /** The statement itself says these payments FAILED — mark those receipts
   *  rejected so residents re-submit, symmetric with "Verify matched". */
  const markFailedPanel = async () => {    if (!compare || !rows || compare.failed.length === 0) return;
    setImporting(true);
    try {
      let marked = 0;
      for (const f of compare.failed) {
        const row = rows.find((r) => r.p.id === f.id);
        if (!row || row.p.status !== "pending") continue;
        await updatePayment(row.p.id, {
          status: "rejected",
          note: [row.p.note, `marked failed: statement says the bank never received this payment (${f.via === "utr" ? "UTR" : "amount+date"} ${f.bankRef?.slice(0, 24) || ""})`.replace(/\s+/g, " ")].filter(Boolean).join(" · "),
        });
        patchRow(row.p.id, { p: { ...row.p, status: "rejected" }, busy: false });
        marked += 1;
      }
      setCompare(null);
      toast(
        `Marked ${marked} receipt${marked === 1 ? "" : "s"} FAILED — the resident(s) must pay again and attach fresh proof.`,
        marked ? "ok" : "info"
      );
    } finally {
      setImporting(false);
    }
  };

  /** Applies verify entries to pending receipts — the shared core behind the
   *  Python verdict import AND the in-browser statement match. */  const applyVerdicts = async (
    entries: Array<{ id: string; matchedOn?: string; bankRef?: string; amount?: number; via?: string }>,
    label: string
  ): Promise<{ applied: number; skipped: number }> => {
    if (!rows) return { applied: 0, skipped: 0 };
    let applied = 0;
    let skipped = 0;
    for (const v of entries) {
      const row = rows.find((r) => r.p.id === v.id);
      if (!row) continue;
      const p = row.p;
      if (p.status !== "pending") {
        skipped += 1;
        continue;
      }
      if (v.amount != null && Math.abs(v.amount - p.amount) > 1) {
        skipped += 1;
        continue;
      }
      const verifiedAt = v.matchedOn ?? new Date().toISOString();
      const evidence = v.via === "slip-utr" ? " (resident slip OCR evidence)" : "";
      const note = [p.note, `auto-verified by ${label}${evidence}${v.bankRef ? ` (ref ${v.bankRef.slice(0, 24)})` : ""}`].filter(Boolean).join(" · ");
      await updatePayment(p.id, {
        status: "verified",
        verifiedAt,
        dueSettled: true,
        note,
      });
      const shouldReduce = !p.dueSettled && p.maintenancePart > 0;
      if (shouldReduce) await reduceMemberDue(p.memberId, p.maintenancePart);
      patchRow(p.id, {
        p: { ...p, status: "verified", verifiedAt, dueSettled: true, note },
        busy: false,
      });
      applied += 1;
    }
    setRows((rs) => rs && rs.map((r) => ({ ...r })));
    return { applied, skipped };
  };

  /** The Python matcher's verdict file. */
  const importMatcherVerdict = async (file: File | undefined) => {
    if (!file || !rows) return;
    if (file.type !== "application/json" && !file.name.endsWith(".json")) {
      toast("Pick the verified_ids.json the matcher wrote.", "err");
      return;
    }
    setImporting(true);
    try {
      const parsed = JSON.parse(await file.text()) as {
        format?: string;
        verified?: Array<{ id: string; matchedOn?: string; bankRef?: string; amount?: number; via?: string }>;
      };
      if (parsed.format !== "society-khata/bank-verify" || !Array.isArray(parsed.verified)) {
        toast("That isn't a bank-matcher verdict file.", "err");
        return;
      }
      const { applied, skipped } = await applyVerdicts(parsed.verified, "bank-statement matcher");
      toast(
        `Bank-statement import done: ${applied} receipt${applied === 1 ? "" : "s"} verified${skipped ? `, ${skipped} skipped (already settled or amount off)` : ""}.`,
        applied ? "ok" : "info"
      );
    } catch {
      toast("Couldn't read that verdict file — is it the verified_ids.json from the matcher?", "err");
    } finally {
      setImporting(false);
    }
  };

  /** Sends the statement directly to the Python FastAPI microservice (/api/match) */
  const matchStatementWithPythonApi = async (file: File | undefined) => {
    if (!file || !rows) return;
    setMatching(true);
    setMatchingMsg("Python API processing…");
    try {
      const formData = new FormData();
      formData.append("statement", file);
      const lean = rows.map((r) => {
        const { screenshot: _shot, screenshotMeta: _meta, ...rest } = r.p;
        return rest;
      });
      formData.append("payments_json", JSON.stringify(lean));

      const res = await fetch("/api/match", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        let errDetail = "Python matcher service returned an error";
        try {
          const errJson = await res.json();
          if (errJson.detail) errDetail = errJson.detail;
        } catch {
          errDetail = `${res.status} ${res.statusText}`;
        }
        throw new Error(errDetail);
      }

      const data = await res.json();
      if (data.format !== "society-khata/bank-verify" || !Array.isArray(data.verified)) {
        throw new Error("Invalid response format from Python matcher service.");
      }

      const { applied, skipped } = await applyVerdicts(data.verified, "Python matcher API");
      toast(
        `Python Matcher: ${applied} receipt${applied === 1 ? "" : "s"} verified${skipped ? `, ${skipped} skipped (already settled or amount off)` : ""}.`,
        applied ? "ok" : "info"
      );
    } catch (e) {
      toast(`Python Matcher: ${(e as Error).message}`, "err");
    } finally {
      setMatching(false);
      setMatchingMsg("");
    }
  };

  return (
    <div>
      <div className="filterbar card pad">
        <div className="filterrow">
          <label>
            <span className="eyebrow">Wing</span>
            <select className="input" value={wing} onChange={(e) => setWing(e.target.value)}>
              <option value="all">All wings</option>
              {wings.map((w) => (
                <option key={w} value={w}>
                  Wing {w}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="eyebrow">Month</span>
            <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="all">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span className="eyebrow">Find</span>
            <input className="input" placeholder="Receipt, UTR or owner name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button className="btn btn-outline self-end" onClick={() => document.getElementById("statement-input")?.click()} disabled={matching || !rows}>
            <IconLedger size={15} /> {matching ? matchingMsg || "Reading…" : "Match statement"}
          </button>
          <button className="btn btn-outline self-end" onClick={() => document.getElementById("python-match-input")?.click()} disabled={matching || !rows || rows.length === 0} title="Match statement directly via the Python microservice">
            <IconCheck size={15} /> {matching ? matchingMsg || "Matching…" : "Python Match"}
          </button>
          <button className="btn btn-outline self-end" onClick={downloadMatcherJson} disabled={!rows || rows.length === 0}>
            <IconDownload size={15} /> Matcher JSON
          </button>
          <button className="btn btn-outline self-end" onClick={() => document.getElementById("bankverify-input")?.click()} disabled={importing || visible.length === 0}>
            {importing ? "Applying…" : "Import bank verify"}
          </button>
          <button className="btn btn-outline self-end" onClick={doExport} disabled={exporting || visible.length === 0}>
            <IconDownload size={15} /> {exporting ? "Building…" : "Excel"}
          </button>
          <input
            id="statement-input"
            type="file"
            accept=".pdf,.csv,.xlsx,.xlsm,.png,.jpg,.jpeg,.webp,text/csv,application/pdf,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void matchStatementFile(f);
            }}
          />
          <input
            id="python-match-input"
            type="file"
            accept=".pdf,.csv,.xlsx,.xlsm"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void matchStatementWithPythonApi(f);
            }}
          />
          <input
            id="bankverify-input"
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              importMatcherVerdict(f);
            }}
          />
        </div>
        <div className="chipsrow">
          {(
            [
              ["all", `All (${counts.all})`],
              ["pending", `Pending (${counts.pending})`],
              ["verified", `Verified (${counts.verified})`],
              ["rejected", `Rejected (${counts.rejected})`],
            ] as Array<[StatusFilter, string]>
          ).map(([key, label]) => (
            <button key={key} className={`chip ${status === key ? "chip-on" : ""}`} onClick={() => setStatus(key)}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          Verifying a receipt reduces that flat's dues by the maintenance portion automatically — no separate edit.
          <b> Match statement</b> reads the bank's PDF / CSV / XLSX — or a photo/scan of it (neural-network OCR) — right here in the browser,
          and <b>learns each bank's layout</b> so the next statement reads itself. <b>Matcher JSON</b> feeds the Python tool;{" "}
          <b>Import bank verify</b> applies its verified_ids.json back onto pending receipts.
        </p>
      </div>

      {compare && (
        <div className="card pad stmt-panel">
          <div className="card-head-line">
            <h2 className="card-title">Statement check · {compare.fileName}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setCompare(null)}>
              <IconClose size={14} /> Clear
            </button>
          </div>

          {compare.checked === 0 ? (
            <div className="verdict ok">
              <span className="vt-mark"><IconCheck size={20} /></span>
              <div>
                <b>Everything recorded on the site is paid.</b>
                <p className="muted">No pending receipts — nothing awaited the bank. {compare.credits} statement credit(s) read.{compare.span !== "n/a" ? ` Span: ${compare.span}.` : ""}</p>
              </div>
            </div>
          ) : compare.allPaid ? (
            <div className="verdict ok">
              <span className="vt-mark"><IconCheck size={20} /></span>
              <div>
                <b>ALL PAYMENTS ADDED ON THE SITE ARE PAID.</b>
                <p className="muted">
                  Every one of the {compare.checked} pending receipt(s) matched this statement
                  ({compare.span}). Verify them below to settle dues.
                </p>
              </div>
              <button className="btn btn-primary btn-sm self-end" onClick={verifyMatchedPanel} disabled={importing || compare.matched.length === 0}>
                {importing ? "Verifying…" : `Verify ${compare.matched.length} matched`}
              </button>
            </div>
          ) : (
            <div className="verdict bad">
              <span className="vt-mark"><IconAlert size={20} /></span>
              <div>
                <b>{matchStatementLabel(compare)}</b>
                <p className="muted">Unmatched receipts stay pending — chase them up by hand or with the Python tool.</p>
              </div>
            </div>
          )}

          {compare.matched.length > 0 && (
            <div className="stmt-block">
              <h4>Matched ({compare.matched.length})</h4>
              <table className="table">
                <thead>
                  <tr><th>Receipt</th><th>Flat</th><th className="num">Amount</th><th>Bank credit date</th><th>How matched</th><th>Bank ref</th></tr>
                </thead>
                <tbody>
                  {compare.matched.map((m) => {
                    const p = (rows ?? []).find((r) => r.p.id === m.id)?.p;
                    return (
                      <tr key={m.id}>
                        <td><b>{m.id}</b></td>
                        <td>{p ? `${p.wing}-${p.flat}` : "—"}</td>
                        <td className="num"><b>{inr(m.amount)}</b></td>
                        <td>{fmtDate(new Date(m.dateMs).toISOString())}</td>
                        <td><span className="badge b-verified">{m.via === "utr" ? "UTR on statement" : "amount + date"}</span></td>
                        <td className="mono">{m.bankRef || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {compare.unmatched.length > 0 && (
            <div className="stmt-block">
              <h4>Unmatched payments ({compare.unmatched.length})</h4>
              <p className="muted small">
                No bank credit inside the matched the rules for these — decide each one yourself:
                verify as paid if the money really landed, or mark failed so the resident pays again.
              </p>
              <table className="table">
                <thead>
                  <tr><th>Receipt</th><th>Flat</th><th className="num">Amount</th><th>Why unmatched</th></tr>
                </thead>
                <tbody>
                  {compare.unmatched.map((u) => {
                    const p = (rows ?? []).find((r) => r.p.id === u.id)?.p;
                    return (
                      <tr key={u.id} className="row-warn">
                        <td><b>{u.id}</b></td>
                        <td>{p ? `${p.wing}-${p.flat}` : "—"}</td>
                        <td className="num"><b>{p ? inr(p.amount) : "—"}</b></td>
                        <td>{u.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="btnrow" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                <button className="btn btn-outline btn-sm" onClick={markUnmatchedFailedPanel} disabled={importing}>
                  {importing ? "Marking…" : `Mark ${compare.unmatched.length} failed`}
                </button>
                <button className="btn btn-primary btn-sm" onClick={verifyUnmatchedPanel} disabled={importing}>
                  {importing ? "Verifying…" : `Verify ${compare.unmatched.length} as paid`}
                </button>
              </div>
            </div>
          )}

          {compare.failed.length > 0 && (
            <div className="stmt-block">
              <h4>The statement marks FAILED ({compare.failed.length})</h4>
              <p className="muted small">
                These payments never reached the bank — the statement's own status column says FAILED. Mark them failed so
                the resident re-submits.
              </p>
              <table className="table">
                <thead>
                  <tr><th>Receipt</th><th>Flat</th><th className="num">Amount</th><th>Statement date</th><th>How matched</th><th>Bank ref</th></tr>
                </thead>
                <tbody>
                  {compare.failed.map((f) => {
                    const p = (rows ?? []).find((r) => r.p.id === f.id)?.p;
                    return (
                      <tr key={f.id} className="row-warn">
                        <td><b>{f.id}</b></td>
                        <td>{p ? `${p.wing}-${p.flat}` : "—"}</td>
                        <td className="num"><b>{inr(f.amount)}</b></td>
                        <td>{fmtDate(new Date(f.dateMs).toISOString())}</td>
                        <td><span className="badge b-rejected">{f.via === "utr" ? "UTR on statement" : "amount + date"}</span></td>
                        <td className="mono">{f.bankRef || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="btn btn-danger btn-sm self-end" onClick={markFailedPanel} disabled={importing}>
                {importing ? "Marking…" : `Mark ${compare.failed.length} failed`}
              </button>
            </div>
          )}

          {compare.strays.length > 0 && (
            <p className="muted small" style={{ marginTop: 8 }}>
              {compare.strays.length} other statement entr{compare.strays.length === 1 ? "y" : "ies"} — bank payouts,
              interest, transfers or payments nobody recorded on the site — are ignored, exactly as they should be. The
              matcher only decides the status of payments recorded on the website.
            </p>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="emptycard">
          <h3>Nothing matches</h3>
          <p className="muted">Loosen the filters above, or clear the search box.</p>
        </div>
      ) : (
        <div className="tablecard card">
          <table className="table">
            <thead>
              <tr>
                <th>Paid on</th>
                <th>Receipt</th>
                <th>Flat</th>
                <th>Member</th>
                <th>For</th>
                <th className="num">Amount</th>
                <th>UPI ref (UTR)</th>
                <th>Status</th>
                <th className="rowact-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const busy = (rows ?? []).find((r) => r.p.id === p.id)?.busy;
                return (
                  <tr key={p.id} className={p.status === "pending" ? "row-pending" : ""}>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>
                      <b>{p.id}</b>
                      {p.note && <small className="muted block">note: {p.note.slice(0, 34)}{p.note.length > 34 ? "…" : ""}</small>}
                      {p.screenshot && (
                        <details className="shotpeek">
                          <summary>
                            <IconImage size={13} />
                            screenshot
                            {p.screenshotMeta?.verdict === "matched" && <em className="ocrchip ok">matched</em>}
                            {p.screenshotMeta?.verdict === "partial" && <em className="ocrchip warn">check</em>}
                            {(!p.screenshotMeta || p.screenshotMeta.verdict === "unreadable") && <em className="ocrchip meh">unread</em>}
                          </summary>
                          <img src={p.screenshot} alt={`Payment screenshot for ${p.id}`} />
                          {p.screenshotMeta?.ocrUtr && (
                            <small className="muted block">UTR on image: {p.screenshotMeta.ocrUtr}{p.screenshotMeta.ocrAmount != null ? ` · ${inr(p.screenshotMeta.ocrAmount)}` : ""}</small>
                          )}
                        </details>
                      )}
                      {!p.screenshot && p.screenshotMeta && (
                        <details className="shotpeek">
                          <summary>
                            <IconImage size={13} />
                            screenshot ref
                            {p.screenshotMeta.verdict === "matched" && <em className="ocrchip ok">matched</em>}
                            {p.screenshotMeta.verdict === "partial" && <em className="ocrchip warn">check</em>}
                            {p.screenshotMeta.verdict === "unreadable" && <em className="ocrchip meh">unread</em>}
                          </summary>
                          <small className="muted block">
                            Screenshot read in-browser; only its text proof is stored (the image itself is not saved).
                            {p.screenshotMeta.ocrUtr && <> UTR: {p.screenshotMeta.ocrUtr}.</>}
                            {p.screenshotMeta.ocrAmount != null && <> Amount read: {inr(p.screenshotMeta.ocrAmount)}.</>}
                          </small>
                        </details>
                      )}
                    </td>
                    <td>
                      {p.wing}-{p.flat}
                    </td>
                    <td>{p.ownerName || "—"}</td>
                    <td>
                      {monthLabel(p.month)}
                      {p.donationPart > 0 && <small className="muted block">incl. {inr(p.donationPart)} contribution</small>}
                    </td>
                    <td className="num">
                      <b>{inr(p.amount)}</b>
                    </td>
                    <td className="mono">
                      {p.utr || "—"}
                      <small className="muted block">{p.screenshot ? "screenshot attached" : p.screenshotMeta ? "screenshot ref saved" : "UPI / bank app"}</small>
                    </td>
                    <td>
                      <span className={`badge b-${p.status}`}>{p.status}</span>
                      {p.verifiedAt && p.status !== "pending" && (
                        <small className="muted block">{fmtDateTime(p.verifiedAt)}</small>
                      )}
                    </td>
                    <td className="rowact">
                      {p.status === "pending" ? (
                        <>
                          <button className="iconbtn ok" title="Verify & reduce dues" onClick={() => verify(p)} disabled={busy}>
                            <IconCheck size={16} />
                          </button>
                          <button className="iconbtn bad" title="Reject" onClick={() => reject(p)} disabled={busy}>
                            <IconClose size={15} />
                          </button>
                        </>
                      ) : (
                        <button className="iconbtn ok" title="Set back to pending" onClick={() => updatePayment(p.id, { status: "pending" }).then(() => { patchRow(p.id, { p: { ...p, status: "pending" } }); toast(`${p.id} reopened.`, "info"); })} disabled={busy}>
                          <IconEye size={16} />
                        </button>
                      )}
                      <Link className="iconbtn" title="Open receipt" to={`/receipt/${p.id}`}>
                        <IconArrow size={15} />
                      </Link>
                      <button className="iconbtn bad" title="Delete" onClick={() => remove(p)} disabled={busy}>
                        <IconTrash size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
