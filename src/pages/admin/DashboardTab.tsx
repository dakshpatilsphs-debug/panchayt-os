import { useCallback, useEffect, useMemo, useState } from "react";
import { IconAlert, IconCheck, IconCoins, IconDownload, IconRefresh } from "../../components/Icons";
import UsageMeter from "../../components/UsageMeter";
import { useToast } from "../../components/Toast";
import { exportRegister } from "../../lib/excel";
import { listMembers, listPayments, loadUsage } from "../../lib/store";
import type { Member, Payment, Usage } from "../../lib/types";
import { availableMonths, currentMonth, fmtDate, inr, monthLabel } from "../../lib/util";
import { useAdmin } from "./AdminCtx";

interface Data {
  members: Member[];
  payments: Payment[];
  usage: Usage | null;
}

export default function DashboardTab() {
  const { settings } = useAdmin();
  const { toast } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [scope, setScope] = useState<"all" | string>("all");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(
    (remeasure: boolean) => {
      const usageTask = remeasure ? loadUsage().catch(() => null) : Promise.resolve(null);
      return Promise.all([listMembers(), listPayments(), usageTask])
        .then(([members, payments, freshUsage]) => {
          setData((prev) => ({
            members,
            payments,
            usage: freshUsage ?? prev?.usage ?? null,
          }));
        })
        .catch((e) => toast((e as Error).message, "err"));
    },
    [toast]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const payments = useMemo(() => data?.payments ?? [], [data]);
  const members = useMemo(() => data?.members ?? [], [data]);

  const cm = currentMonth();
  const stats = useMemo(() => {
    const verified = payments.filter((p) => p.status === "verified");
    const pending = payments.filter((p) => p.status === "pending");
    return {
      totalVerified: verified.reduce((a, p) => a + p.amount, 0),
      verifiedCount: verified.length,
      thisMonth: verified.filter((p) => p.createdAt.slice(0, 7) === cm).reduce((a, p) => a + p.amount, 0),
      pendingCount: pending.length,
      pendingAmount: pending.reduce((a, p) => a + p.amount, 0),
      dues: members.filter((m) => m.active).reduce((a, m) => a + (m.dueBalance || 0), 0),
      households: members.filter((m) => m.active).length,
    };
  }, [payments, members, cm]);

  const months = useMemo(() => availableMonths(payments), [payments]);
  const latest = useMemo(() => payments.slice(0, 7), [payments]);

  const doExport = async () => {
    setExporting(true);
    try {
      const filtered = scope === "all" ? payments : payments.filter((p) => p.month === scope);
      const usage = data?.usage ?? null;
      await exportRegister(filtered, members, settings, usage, {
        scope,
        filterNote: scope === "all" ? "all months" : `${monthLabel(scope)} only`,
      });
      toast("Excel register saved to your downloads.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(false);
    }
  };

  if (!data) {
    return (
      <div className="loading-pad">
        <p className="muted">Tallying the collection…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="kpis">
        <div className="kpi">
          <span className="eyebrow">Collected · all time</span>
          <b className="kpi-num">{inr(stats.totalVerified)}</b>
          <span className="kpi-sub">{stats.verifiedCount} verified receipts</span>
        </div>
        <div className="kpi">
          <span className="eyebrow">This month</span>
          <b className="kpi-num">{inr(stats.thisMonth)}</b>
          <span className="kpi-sub">verified {monthLabel(cm).toLowerCase()}</span>
        </div>
        <div className="kpi kpi-warn">
          <span className="eyebrow">Awaiting verification</span>
          <b className="kpi-num">{stats.pendingCount}</b>
          <span className="kpi-sub">{inr(stats.pendingAmount)} held</span>
        </div>
        <div className="kpi kpi-due">
          <span className="eyebrow">Outstanding dues</span>
          <b className="kpi-num">{inr(stats.dues)}</b>
          <span className="kpi-sub">across {stats.households} active flats</span>
        </div>
      </div>

      <div className="twocol">
        <div className="card pad">
          <div className="card-head-line">
            <h2 className="card-title">Latest receipts</h2>
          </div>
          <div className="monthrow">
            <span className="eyebrow">Register scope</span>
            <div className="chipsrow">
              <button className={`chip ${scope === "all" ? "chip-on" : ""}`} onClick={() => setScope("all")}>
                All months
              </button>
              {months.map((m) => (
                <button key={m} className={`chip ${scope === m ? "chip-on" : ""}`} onClick={() => setScope(m)}>
                  {m}
                </button>
              ))}
            </div>
            <button className="btn btn-outline btn-sm" onClick={doExport} disabled={exporting || payments.length === 0}>
              <IconDownload size={15} /> {exporting ? "Building…" : "Excel register"}
            </button>
          </div>
          {payments.length === 0 ? (
            <div className="emptysmall">
              <IconCoins size={22} />
              <p className="muted">No payments recorded yet — they'll appear here the moment a resident pays.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Member</th>
                  <th className="num">Amount</th>
                  <th>Paid on</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.id}</b></td>
                    <td>
                      {p.ownerName}
                      <small className="muted block">
                        {p.wing}-{p.flat}
                      </small>
                    </td>
                    <td className="num"><b>{inr(p.amount)}</b></td>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td>
                      <span className={`badge b-${p.status}`}>
                        {p.status === "pending" ? <IconAlert size={11} /> : p.status === "verified" ? <IconCheck size={11} /> : null}
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card pad sidecol">
          <div className="card-head-line">
            <h2 className="card-title">Storage lifecycle</h2>
            <button
              className="iconbtn"
              title="Re-measure Firestore now"
              onClick={() => {
                load(true).then(() => toast("Firestore collection re-measured.", "info"));
              }}
            >
              <IconRefresh size={16} />
            </button>
          </div>
          <UsageMeter usedBytes={data.usage?.estBytes ?? 0} limitMB={settings.usageLimitMB} count={data.usage?.paymentsCount} />
          <p className="hint">
            When the soft limit nears, the committee gets a no-reply alert e-mail → archive to this PC → purge Firestore.
          </p>
          <button
            className="btn btn-outline btn-block"
            onClick={() => window.dispatchEvent(new CustomEvent("sk-admintab", { detail: "archive" }))}
          >
            Go to Archive &amp; purge
          </button>
        </div>
      </div>
    </div>
  );
}
