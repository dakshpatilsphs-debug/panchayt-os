import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Logo from "../components/Logo";
import { IconArrow, IconPrint } from "../components/Icons";
import { getPayment, loadSettings } from "../lib/store";
import type { Payment, SocietySettings } from "../lib/types";
import { fmtDateTime, inr, monthLabel } from "../lib/util";

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null | undefined>(undefined);
  const [settings, setSettings] = useState<SocietySettings | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([id ? getPayment(id) : Promise.resolve(null), loadSettings()])
      .then(([p, s]) => {
        if (!alive) return;
        setPayment(p);
        setSettings(s);
      })
      .catch(() => setPayment(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (payment === undefined || !settings) {
    return (
      <div className="loading-pad">
        <p className="muted">Pulling up your receipt…</p>
      </div>
    );
  }

  if (payment === null) {
    return (
      <div className="emptycard" style={{ marginTop: "4rem" }}>
        <h3>Receipt not found</h3>
        <p className="muted">It may have been archived after a Firestore purge — the Excel register holds a copy.</p>
        <Link to="/" className="btn btn-primary">
          Back to payments
        </Link>
      </div>
    );
  }

  const s = settings;
  const verified = payment.status === "verified";

  return (
    <div className="receipt-outer">
      <div className="no-print btnrow" style={{ marginBottom: "1rem" }}>
        <Link to="/history" className="btn btn-ghost">
          <IconArrow size={15} /> History
        </Link>
        <button className="btn btn-primary" onClick={() => window.print()}>
          <IconPrint size={16} /> Print / save as PDF
        </button>
      </div>

      <article className={`receipt-sheet status-${payment.status}`}>
        <div className={`rw rw-${payment.status}`}>
          {payment.status === "verified" ? "PAID · VERIFIED" : payment.status === "pending" ? "AWAITING VERIFICATION" : "REJECTED"}
        </div>

        <header className="r-head">
          <Logo size={64} />
          <div className="r-society">
            <h2>{s.societyName}</h2>
            <p>
              {s.address1}
              <br />
              {s.address2}
            </p>
            <p className="r-reg">Reg. No. {s.regNo}</p>
          </div>
          <div className="r-meta">
            <span className="eyebrow">Payment receipt</span>
            <b className="r-id">{payment.id}</b>
            <span className="r-status">
              <i className={`dot dot-${payment.status}`} />
              {verified ? "Verified" : payment.status === "pending" ? "Pending" : "Rejected"}
            </span>
          </div>
        </header>

        <div className="r-rule" />

        <section className="r-parties">
          <div>
            <span className="eyebrow">Received from</span>
            <b>{payment.ownerName}</b>
            <span className="muted">Flat {payment.wing}-{payment.flat}</span>
          </div>
          <div className="r-dates">
            <div>
              <span className="eyebrow">Paid on</span>
              <b>{fmtDateTime(payment.createdAt)}</b>
            </div>
            <div>
              <span className="eyebrow">Mode</span>
              <b>UPI · {settings.upiId}</b>
            </div>
            <div>
              <span className="eyebrow">Reference (UTR)</span>
              <b className="mono">{payment.utr || "— provided after audit —"}</b>
            </div>
          </div>
        </section>

        <table className="r-table">
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Maintenance dues settled
                <small>
                  towards {monthLabel(payment.month)}
                  {payment.maintenancePart === 0 ? " · dues were already clear" : ""}
                </small>
              </td>
              <td className="num">{inr(payment.maintenancePart)}</td>
            </tr>
            <tr>
              <td>
                Voluntary contribution
                <small>above monthly maintenance, gladly accepted</small>
              </td>
              <td className="num">{inr(payment.donationPart)}</td>
            </tr>
            <tr className="r-total">
              <td>Total received</td>
              <td className="num">{inr(payment.amount)}</td>
            </tr>
          </tbody>
        </table>

        {payment.note && (
          <p className="r-note">
            <b>Note:</b> {payment.note}
          </p>
        )}

        {payment.screenshot && (
          <section className="r-shot">
            <div className="r-shot-head">
              <b>Attached payment screenshot</b>
              {payment.screenshotMeta?.verdict === "matched" && (
                <span className="r-shotchip ok">screenshot reader: matched{payment.screenshotMeta.ocrUtr ? ` · UTR ${payment.screenshotMeta.ocrUtr}` : ""}</span>
              )}
              {payment.screenshotMeta?.verdict === "partial" && <span className="r-shotchip warn">screenshot reader: partially matched — please re-confirm</span>}
              {(!payment.screenshotMeta || payment.screenshotMeta.verdict === "unreadable") && <span className="r-shotchip meh">screenshot reader: not machine-readable</span>}
            </div>
            <img src={payment.screenshot} alt="Payment proof" />
          </section>
        )}

        <footer className="r-foot">
          <div>
            <p>
              {verified
                ? `Verified by the treasurer on ${fmtDateTime(payment.verifiedAt ?? payment.createdAt)}. Your dues ledger has been updated.`
                : payment.status === "pending"
                  ? "This receipt is provisional until the treasurer verifies the UPI reference. Dues reduce upon verification."
                  : "This draft was rejected by the treasurer — please re-submit with the correct reference."}
            </p>
            <p className="r-fine">Computer-generated receipt from Society Khata · valid without signature</p>
          </div>
          <div className="r-seal">
            <span>Treasurer</span>
          </div>
        </footer>
      </article>
    </div>
  );
}
