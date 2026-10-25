import { useCallback, useEffect, useState } from "react";
import { IconAlert, IconArchive, IconCheck, IconDownload, IconLock, IconMail, IconRefresh } from "../../components/Icons";
import UsageMeter from "../../components/UsageMeter";
import { useToast } from "../../components/Toast";
import { dispatchLimitEmail } from "../../lib/email";
import { isDemo } from "../../lib/firebase";
import { backupJson, exportRegister } from "../../lib/excel";
import { listMembers, listPayments, loadSettings, lastMails, purgePayments, recountUsage, setAlertSent } from "../../lib/store";
import type { Member, Payment, SocietySettings, Usage } from "../../lib/types";
import { fmtDateTime } from "../../lib/util";
import { useAdmin } from "./AdminCtx";

interface Mailed {
  to: string;
  subject: string;
  at: string;
}

export default function ArchiveTab() {
  const { settings } = useAdmin();
  const { toast } = useToast();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [measuring, setMeasuring] = useState(true);
  const [excelSaved, setExcelSaved] = useState(false);
  const [jsonSaved, setJsonSaved] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [mails, setMails] = useState<Mailed[] | null>(null);
  const [mailto, setMailto] = useState("");
  const [exporting, setExporting] = useState<"excel" | "json" | null>(null);

  const measure = useCallback(
    (silent = false) => {
      setMeasuring(true);
      return recountUsage()
        .then((u) => {
          setUsage(u);
          if (!silent) toast("Payments collection re-measured.", "info");
        })
        .catch((e) => toast(e.message, "err"))
        .finally(() => setMeasuring(false));
    },
    [toast]
  );

  useEffect(() => {
    measure(true);
  }, [measure]);

  useEffect(() => {
    loadSettings().then(() => undefined, () => undefined);
  }, []);

  const downloadExcel = async () => {
    setExporting("excel");
    try {
      const ps = await listPayments();
      const ms = await listMembers();
      await exportRegister(ps, ms, settings, usage, { scope: "all" });
      setExcelSaved(true);
      toast("Excel register downloaded — check your Downloads folder.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(null);
    }
  };

  const downloadJson = async () => {
    setExporting("json");
    try {
      const ps = await listPayments();
      const ms = await listMembers();
      backupJson(settings, ms, ps, usage);
      setJsonSaved(true);
      toast("JSON backup downloaded — keep it with the Excel file.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setExporting(null);
    }
  };

  const canPurge = excelSaved && jsonSaved && confirmWord.trim().toUpperCase() === "PURGE" && !measuring;

  const runPurge = async () => {
    setPurging(true);
    try {
      await purgePayments();
      setPurgeResult(`Firestore emptied on ${fmtDateTime(new Date().toISOString())} — usage counters reset.`);
      setUsage({ paymentsCount: 0, estBytes: 0, limitAlertSent: false, lastChecked: new Date().toISOString() });
      setConfirmWord("");
      setExcelSaved(false);
      setJsonSaved(false);
      toast("Firestore purged. The new cycle begins.", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPurging(false);
    }
  };

  const sendTest = async () => {
    if (!usage) return;
    try {
      const r = await dispatchLimitEmail(settings, usage);
      setMailto(r.mailto);
      setMails(await lastMails());
      toast(
        r.queued
          ? "Queued in the `mail` collection — the Firebase e-mail extension will deliver it."
          : isDemo
            ? "Stored locally (demo mode) — in Firestore this would be queued for the extension."
            : "Written to the `mail` collection (admin e-mail not set, or extension not yet configured).",
        r.queued ? "ok" : "info"
      );
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const rearm = async () => {
    await setAlertSent(false);
    setUsage((u) => (u ? { ...u, limitAlertSent: false } : u));
    toast("Alert re-armed — it will fire again at the next 90% crossing.", "info");
  };

  const loadMails = () => {
    lastMails()
      .then((ms) => {
        setMails(ms);
        toast("Latest queued e-mails: " + (ms.length === 0 ? "none yet." : `${ms.length} item(s).`), "info");
      })
      .catch((e) => toast(e.message, "err"));
  };

  const step = (
    n: number,
    title: string,
    body: React.ReactNode,
    action: React.ReactNode,
    done: boolean,
    extra?: React.ReactNode
  ) => (
    <div className={`arcstep ${done ? "done" : ""} card pad`}>
      <div className="arcstep-head">
        <span className={`arcno ${done ? "ok" : ""}`}>{done ? <IconCheck size={14} /> : n}</span>
        <div>
          <h3>{title}</h3>
          <p className="muted">{body}</p>
        </div>
      </div>
      <div className="arcstep-actions">{action}</div>
      {extra}
    </div>
  );

  return (
    <div className="arclife">
      <div className="arctop card pad">
        <div className="card-head-line">
          <h2 className="card-title">
            <IconArchive size={17} /> Storage lifecycle
          </h2>
          <button className="btn btn-outline btn-sm" onClick={() => measure()} disabled={measuring}>
            <IconRefresh size={14} /> {measuring ? "Measuring…" : "Re-measure"}
          </button>
        </div>
        <UsageMeter
          usedBytes={usage?.estBytes ?? 0}
          limitMB={settings.usageLimitMB}
          count={usage?.paymentsCount}
        />
        <div className="arctop-meta">
          <span>
            Last measured {usage?.lastChecked ? fmtDateTime(usage.lastChecked) : "—"}
          </span>
          <span className={`badge ${usage?.limitAlertSent ? "b-pending" : "b-verified"}`}>
            <IconMail size={11} /> {usage?.limitAlertSent ? "90% alert already sent" : "Alert armed for 90%"}
          </span>
          {usage?.limitAlertSent && (
            <button className="linkbtn" onClick={rearm}>
              Re-arm e-mail alert
            </button>
          )}
        </div>
        {!settings.adminEmail && (
          <p className="warnline">
            <IconAlert size={14} /> No committee e-mail set yet — the no-reply alert has nowhere to go. Add it under
            Settings.
          </p>
        )}
        <p className="hint">
          Firestore's Spark (free) plan stores 1 GiB in total. The <b>{settings.usageLimitMB} MB</b> soft limit keeps things
          comfortable; every write here counts bytes so the gauge is live, not guessed.
        </p>
      </div>

      <div className="archflow">
        {step(
          1,
          "E-mail the secretariat",
          "A no-reply alert is queued into the `mail` collection when 90% is crossed; the Firebase Trigger Email extension turns it into a real e-mail.",
          <button className="btn btn-outline" onClick={sendTest} disabled={!usage}>
            <IconMail size={15} /> Send a preview alert
          </button>,
          usage?.limitAlertSent ?? false,
          <p className="fineprint">
            {settings.adminEmail ? `Recipient: ${settings.adminEmail}. ` : "Recipient not set (Settings). "}
            {mailto && (
              <>
                Without the extension, use this instead:{" "}
                <a className="linkbtn" href={mailto}>
                  open draft in mail app
                </a>
              </>
            )}
          </p>
        )}

        {step(
          2,
          "Save the Excel register to this PC",
          "The professional workbook — letterhead with the society logo, every receipt, wing summary, totals — lands in Downloads.",
          <button className="btn btn-primary" onClick={downloadExcel} disabled={exporting !== null}>
            <IconDownload size={15} /> {exporting === "excel" ? "Building workbook…" : "Download Excel register"}
          </button>,
          excelSaved
        )}

        {step(
          3,
          "Save the JSON backup to this PC",
          "Raw records (members, receipts, usage counters) as a future-proof JSON file — for any other system to read.",
          <button className="btn btn-primary" onClick={downloadJson} disabled={exporting !== null}>
            <IconDownload size={15} /> {exporting === "json" ? "Exporting…" : "Download JSON backup"}
          </button>,
          jsonSaved
        )}

        {step(
          4,
          "Purge Firestore and start a fresh ledger cycle",
          "Deletes every payment document (batched at 400), resets usage, keeps settings & members. Only safe once both archives above are saved.",
          <div className="purgerow">
            <input
              className="input purge-input"
              placeholder='type "PURGE" to confirm'
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
            />
            <button className="btn btn-danger" onClick={runPurge} disabled={!canPurge || purging}>
              <IconLock size={15} /> {purging ? "Purging…" : "Purge Firestore"}
            </button>
          </div>,
          Boolean(purgeResult),
          purgeResult && <p className="doneline"><IconCheck size={14} /> {purgeResult}</p>
        )}
      </div>

      <div className="card pad mailtrap">
        <div className="card-head-line">
          <h3 className="card-title">Outbox preview</h3>
          <button className="btn btn-outline btn-sm" onClick={loadMails}>
            Refresh
          </button>
        </div>
        {mails === null ? (
          <p className="muted">Loading…</p>
        ) : mails.length === 0 ? (
          <p className="muted">
            No e-mails queued yet. Alerts appear here after the 90% threshold (or the preview button above) writes to the
            mail collection.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Queued</th>
                <th>To</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {mails.map((m, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(m.at)}</td>
                  <td>{m.to}</td>
                  <td>{m.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
