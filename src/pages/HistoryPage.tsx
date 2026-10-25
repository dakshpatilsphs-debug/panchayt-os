import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { IconHistory, IconSearch } from "../components/Icons";
import { useToast } from "../components/Toast";
import { listMembers, listPayments } from "../lib/store";
import type { Member, Payment } from "../lib/types";
import { fmtDate, inr, monthLabel, wingsInSettingsAndData } from "../lib/util";
import { loadSettings } from "../lib/store";
import type { SocietySettings } from "../lib/types";

export default function HistoryPage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [search, setSearch] = useState("");

  const wing = params.get("wing") ?? "";
  const flat = params.get("flat") ?? "";

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

  const wings = useMemo(
    () => (members && settings ? wingsInSettingsAndData(settings.wings, members) : []),
    [members, settings]
  );
  const flats = (members ?? []).filter((m) => m.active && m.wing === wing);
  const member = flats.find((m) => m.flat === flat) ?? null;

  const mine = useMemo(() => {
    if (!payments || !member) return [];
    return payments.filter((p) => p.memberId === member.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [payments, member]);

  const visible = useMemo(() => {
    if (!search.trim()) return mine;
    const q = search.trim().toLowerCase();
    return mine.filter((p) => p.id.toLowerCase().includes(q) || (p.utr || "").includes(q) || monthLabel(p.month).toLowerCase().includes(q));
  }, [mine, search]);

  const pick = (w: string, f: string) => {
    const next = new URLSearchParams();
    if (w) next.set("wing", w);
    if (f) next.set("flat", f);
    setParams(next, { replace: true });
  };

  const totalPaid = mine.filter((p) => p.status !== "rejected").reduce((a, p) => a + p.amount, 0);

  if (!members || !payments || !settings) {
    return (
      <div className="loading-pad">
        <p className="muted">Fetching the society ledger…</p>
      </div>
    );
  }

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Payment history</p>
        <h1>Your little register of receipts.</h1>
        <p className="lede">Find your flat and see everything you've paid, verified or pending.</p>
      </section>

      <div className="selcard card pad">
        <div className="selrow">
          <span className="eyebrow">Wing</span>
          <div className="chipsrow">
            {wings.map((w) => (
              <button key={w} className={`chip ${wing === w ? "chip-on" : ""}`} onClick={() => pick(w, "")}>
                Wing {w}
              </button>
            ))}
          </div>
        </div>
        {wing && (
          <div className="selrow">
            <span className="eyebrow">Flat</span>
            <div className="chipsrow">
              {flats.map((m) => (
                <button key={m.id} className={`chip ${flat === m.flat ? "chip-on" : ""}`} onClick={() => pick(wing, m.flat)}>
                  {m.flat} · {m.ownerName.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {member && (
        <div className="flatpanel">
          <div className="flatpanel-main">
            <p className="eyebrow">
              Flat {wing}-{flat} · {member.ownerName}
            </p>
            <h2>
              {totalPaid > 0 ? `${inr(totalPaid)} paid so far` : "No payments recorded yet"}
            </h2>
            <p className={`muted ${member.dueBalance > 0 ? "dues-hot" : ""}`}>
              {member.dueBalance > 0
                ? `${inr(member.dueBalance)} still outstanding against your account.`
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
      )}

      {member && visible.length > 0 && (
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

      {member && visible.length === 0 && (
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

      {!wing && (
        <div className="emptycard">
          <IconHistory size={30} />
          <h3>Pick your wing &amp; flat above</h3>
          <p className="muted">History is private to each flat — choose yours to view its receipts.</p>
        </div>
      )}
    </div>
  );
}
