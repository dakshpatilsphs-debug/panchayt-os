import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconHistory, IconSearch } from "../components/Icons";
import { useToast } from "../components/Toast";
import { listMembers, listPayments, loadSettings } from "../lib/store";
import { useSession } from "../lib/session";
import type { Member, Payment, SocietySettings } from "../lib/types";
import { fmtDate, inr, monthLabel } from "../lib/util";

/** My payments — the flat remembered in this browser. Owner names aren't shown. */
export default function HistoryPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const sessionId = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([listMembers(), listPayments(), loadSettings()])
      .then(([ms, ps, s]) => {
        if (!alive) return;
        setMembers(ms);
        setPayments(ps);
        setSettings(s);
      })
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = useMemo(() => (members ?? []).find((m) => m.id === sessionId) ?? null, [members, sessionId]);

  const mine = useMemo(() => {
    if (!payments || !me) return [];
    return payments.filter((p) => p.memberId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [payments, me]);

  const visible = useMemo(() => {
    if (!search.trim()) return mine;
    const q = search.trim().toLowerCase();
    return mine.filter((p) => p.id.toLowerCase().includes(q) || (p.utr || "").includes(q) || monthLabel(p.month).toLowerCase().includes(q));
  }, [mine, search]);

  const totalPaid = mine.filter((p) => p.status !== "rejected").reduce((a, p) => a + p.amount, 0);

  if (!members || !payments || !settings) {
    return (
      <div className="loading-pad">
        <p className="muted">Fetching the society ledger…</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="emptycard" style={{ marginTop: 40 }}>
        <IconHistory size={28} />
        <h3>Which flat is yours?</h3>
        <p className="muted">
          This browser has no flat picked yet — choose your wing + flat on the Pay page and
          your receipts will show up here.
        </p>
        <button className="btn btn-primary" onClick={() => navigate("/", { replace: true })}>
          Pick your flat
        </button>
      </div>
    );
  }

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Payment history · Flat {me.wing}-{me.flat}</p>
        <h1>Your little register of receipts.</h1>
        <p className="lede">Everything paid from flat {me.wing}-{me.flat} — verified, pending and returned.</p>
      </section>

      <div className="flatpanel">
        <div className="flatpanel-main">
          <p className="eyebrow">Flat {me.wing}-{me.flat}</p>
          <h2>
            {totalPaid > 0 ? `${inr(totalPaid)} paid so far` : "No payments recorded yet"}
          </h2>
          <p className={`muted ${me.dueBalance > 0 ? "dues-hot" : ""}`}>
            {me.dueBalance > 0
              ? `${inr(me.dueBalance)} still outstanding against your account.`
              : "All dues are clear — the committee thanks you."}
          </p>
        </div>
        <div className="flatpanel-side">
          <label>
            <span className="eyebrow">Search receipts</span>
            <div className="searchwrap">
              <IconSearch size={15} />
              <input className="input" placeholder="Receipt, UTR, month…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </label>
        </div>
      </div>

      {visible.length > 0 && (
        <div className="tablecard card">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Paid on</th>
                <th>For</th>
                <th className="num">Amount</th>
                <th>UPI ref</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.id}</b></td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{monthLabel(p.month)}</td>
                  <td className="num"><b>{inr(p.amount)}</b></td>
                  <td className="mono">{p.utr || "—"}</td>
                  <td><span className={`badge b-${p.status}`}>{p.status}</span></td>
                  <td className="rowact">
                    <Link className="linkbtn" to={`/receipt/${p.id}`}>
                      Receipt
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {visible.length === 0 && (
        <div className="emptycard">
          <IconHistory size={30} />
          <h3>Nothing here yet</h3>
          <p className="muted">
            {search ? "No receipts match your search." : "Once you pay, receipts appear within seconds."}
          </p>
          <Link to="/" className="btn btn-primary">
            Pay maintenance
          </Link>
        </div>
      )}
    </div>
  );
}
