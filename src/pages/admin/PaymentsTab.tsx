import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconArrow, IconCheck, IconClose, IconDownload, IconEye, IconImage, IconTrash } from "../../components/Icons";
import { useToast } from "../../components/Toast";
import { exportRegister } from "../../lib/excel";
import type { Member, Payment, PaymentStatus } from "../../lib/types";
import { deletePayment, listMembers, listPayments, loadUsage, reduceMemberDue, updatePayment } from "../../lib/store";
import { availableMonths, fmtDate, fmtDateTime, inr, monthLabel } from "../../lib/util";
import { useAdmin } from "./AdminCtx";

type StatusFilter = "all" | PaymentStatus;
type Row = { p: Payment; busy?: boolean };

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
          <button className="btn btn-outline self-end" onClick={doExport} disabled={exporting || visible.length === 0}>
            <IconDownload size={15} /> {exporting ? "Building…" : "Excel"}
          </button>
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
        </p>
      </div>

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
                    </td>
                    <td>
                      {p.wing}-{p.flat}
                    </td>
                    <td>{p.ownerName}</td>
                    <td>
                      {monthLabel(p.month)}
                      {p.donationPart > 0 && <small className="muted block">incl. {inr(p.donationPart)} contribution</small>}
                    </td>
                    <td className="num">
                      <b>{inr(p.amount)}</b>
                    </td>
                    <td className="mono">
                      {p.utr || "—"}
                      <small className="muted block">{p.screenshot ? "screenshot attached" : "UPI / bank app"}</small>
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
