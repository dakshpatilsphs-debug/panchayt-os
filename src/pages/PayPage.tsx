import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import UpiQr from "../components/UpiQr";
import { IconAlert, IconArrow, IconCamera, IconCheck, IconClose, IconImage, IconQr, IconSend } from "../components/Icons";
import { useToast } from "../components/Toast";
import { checkStorageAlert } from "../lib/email";
import { isDemo } from "../lib/firebase";
import { readPaymentScreenshot } from "../lib/shot";
import { createPayment, deletePayment, findPendingDraft, listMembers, loadSettings, updatePayment } from "../lib/store";
import type { Member, Payment, ScreenshotMeta, SocietySettings } from "../lib/types";
import {
  buildUpiUri,
  currentMonth,
  inr,
  memberId,
  monthLabel,
  newPaymentId,
  utrLooksValid,
  wingsInSettingsAndData,
} from "../lib/util";

type Stage = "form" | "modal" | "done";

export default function PayPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── state (everything lives above the early return — Rules of Hooks) ──
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [wing, setWing] = useState<string | null>(null);
  const [flat, setFlat] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [stage, setStage] = useState<Stage>("form");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [utr, setUtr] = useState("");
  const [payNote, setPayNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [utrError, setUtrError] = useState("");

  // screenshot reader state
  const [shotUrl, setShotUrl] = useState("");
  const [shotMeta, setShotMeta] = useState<ScreenshotMeta | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [ocrHint, setOcrHint] = useState("");

  /** Latest payment snapshot for closures. */
  const paymentRef = useRef<Payment | null>(null);
  /**
   * Synchronous in-flight lock. React state (busy) updates on the *next*
   * render, so two quick taps both slip past it — a ref doesn't wait for
   * React, which is exactly what a double-click needs.
   */
  const startLock = useRef(false);

  useEffect(() => {
    paymentRef.current = payment;
  }, [payment]);

  const toastsFired = useRef(new Set<string>());
  const toastOnce = (key: string, msg: string, tone?: "ok" | "err" | "info") => {
    if (toastsFired.current.has(key)) return;
    toastsFired.current.add(key);
    toast(msg, tone);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([listMembers(), loadSettings()])
      .then(([ms, s]) => {
        if (!alive) return;
        setMembers(ms);
        setSettings(s);
      })
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wings = useMemo(() => (members ? wingsInSettingsAndData(settings?.wings ?? [], members) : []), [members, settings]);
  const inWing = useMemo(
    () => (members ?? []).filter((m) => m.active && m.wing === wing).sort((a, b) => a.flat.localeCompare(b.flat, "en", { numeric: true })),
    [members, wing]
  );
  const member = useMemo(() => inWing.find((m) => m.id === flat) ?? null, [inWing, flat]);
  const amountN = Math.round(Number(amount) * 100) / 100;
  const amountValid = Number.isFinite(amountN) && amountN > 0 && amountN <= 500000;
  const monthValid = month <= currentMonth();

  if (!members || !settings) {
    return (
      <div className="loading-pad">
        <p className="muted">Opening the society register…</p>
      </div>
    );
  }

  const reset = () => {
    setStage("form");
    setPayment(null);
    setFlat(null);
    setAmount("");
    setUtr("");
    setPayNote("");
    setShotUrl("");
    setShotMeta(null);
    setOcrBusy(false);
    setOcrPct(0);
    setOcrHint("");
  };

  /* ── draft creation: double-click + duplicate guarded ── */

  const buildDraft = async (): Promise<Payment> => {
    if (!member || !settings) throw new Error("Member context missing");
    const due = Math.max(0, member.dueBalance || 0);
    const maintenancePart = Math.min(amountN, due);
    const donationPart = Math.max(0, Math.round((amountN - maintenancePart) * 100) / 100);
    const p: Payment = {
      id: newPaymentId(),
      memberId: memberId(member.wing, member.flat),
      wing: member.wing,
      flat: member.flat,
      ownerName: member.ownerName,
      month,
      amount: amountN,
      maintenancePart,
      donationPart,
      method: "upi",
      utr: "",
      status: "pending",
      createdAt: new Date().toISOString(),
      note: "",
    };
    const saved = await createPayment(p);
    // storage watchdog — only acts when the 90% soft limit has been crossed
    checkStorageAlert()
      .then((r) => {
        if (r.fired && r.mailto && isDemo) toast("Storage alert generated (demo mode) — see Admin → Archive.", "info");
      })
      .catch(() => undefined);
    return saved as Payment;
  };

  const startPayment = async () => {
    if (!member || !amountValid || !monthValid) return;
    // Second tap on a slow network: hard-stop before any network call.
    if (startLock.current || busy) return;
    startLock.current = true;
    try {
      // One pending draft per flat per month — a double click, a refresh or a
      // second device all resume the SAME receipt instead of minting another.
      const existing = await findPendingDraft(memberId(member.wing, member.flat), month);
      if (existing) {
        setPayment(existing);
        setStage("modal");
        toastOnce("resumed-" + existing.id, `Continuing your recent pending receipt ${existing.id} for ${monthLabel(existing.month)} — cancel it first if the amount changed.`, "info");
        return;
      }
      const saved = await buildDraft();
      setPayment(saved);
      setStage("modal");
    } catch (e) {
      setPayment(null);
      setStage("form");
      // Slow network / Firestore hiccup — nothing was charged either way.
      toast((e as Error).message.includes("permission") ? (e as Error).message : "Network hiccup while opening the payment — try again, you cannot be double-charged.", "err");
    } finally {
      startLock.current = false;
    }
  };

  /* ── screenshot reader: proof of a really-done payment ── */

  const handleShot = async (file: File | undefined) => {
    const draft = paymentRef.current;
    if (!draft || ocrBusy || !file) return;
    if (!file.type.startsWith("image/")) {
      setOcrHint("That's not an image — screenshots from your UPI app work best.");
      return;
    }
    setOcrBusy(true);
    setOcrPct(0);
    setOcrHint("");
    try {
      const read = await readPaymentScreenshot(file, draft.amount, (pct) => setOcrPct(pct));
      const meta: ScreenshotMeta = {
        attachedAt: new Date().toISOString(),
        ocrUtr: read.utr || undefined,
        ocrAmount: read.amount ?? undefined,
        verdict: read.verdict,
      };
      // the resident may have cancelled the draft while OCR was running —
      // never resurrect a discarded receipt
      if (paymentRef.current?.id !== draft.id) return;
      // evidence is attached to the receipt immediately — it survives even a
      // flaky connection the moment this write lands
      await updatePayment(draft.id, { screenshot: read.dataUrl, screenshotMeta: meta });
      setShotUrl(read.dataUrl);
      setShotMeta(meta);
      if (read.verdict === "matched") {
        if (!utr) setUtr(read.utr);
        setOcrImg("");
        toast("Screenshot matched — the UTR was filled in for you.", "ok");
      } else if (read.verdict === "partial") {
        if (read.utr && !utr) setUtr(read.utr);
        setOcrImg("warn");
      } else {
        setOcrImg("meh");
      }
    } catch (e) {
      setOcrHint((e as Error).message || "Couldn't read the screenshot — you can still enter the UTR by hand.");
    } finally {
      setOcrBusy(false);
      setOcrPct(0);
    }
  };

  /** Small helper to keep the verdict-chip markup honest about the current draft. */
  const setOcrImg = (tone: "warn" | "meh" | "") => {
    if (tone === "warn") toast("Screenshot attached — but a few details didn't match the receipt, so the treasurer will check it.", "info");
    if (tone === "meh") toast("Screenshot attached — couldn't read it automatically, enter the UTR by hand.", "info");
  };

  const removeShot = async () => {
    const draft = paymentRef.current;
    if (!draft || ocrBusy) return;
    setShotUrl("");
    setShotMeta(null);
    setOcrHint("");
    try {
      await updatePayment(draft.id, { screenshot: "", screenshotMeta: undefined });
    } catch {
      /* manual state stays cleared regardless */
    }
  };

  const submitUtr = async () => {
    if (!payment || busy || startLock.current) return;
    if (!utrLooksValid(utr)) {
      setUtrError("A UPI UTR is exactly 12 digits — check the reference in your UPI app, or attach the screenshot below.");
      return;
    }
    startLock.current = true;
    setBusy(true);
    try {
      await updatePayment(payment.id, { utr: utr.trim(), note: payNote.trim() });
      setPayment({ ...payment, utr: utr.trim() });
      setStage("done");
      toast(payment.screenshot ? "Submitted with your screenshot attached — the committee verifies within a day." : "Payment submitted — the committee verifies within a day.", "ok");
    } catch (e) {
      // Network broke mid-save: the reference stays in the box — press again.
      toast("Couldn't reach the server — your reference is kept, try once more.", "err");
    } finally {
      startLock.current = false;
      setBusy(false);
    }
  };

  const cancelPayment = async () => {
    if (!payment) return;
    try {
      await deletePayment(payment.id);
    } catch {
      /* nothing to clean up in demo */
    }
    toast("Draft payment discarded — nothing was charged.", "info");
    reset();
  };

  const upiNote = `${settings.societyName} maintenance ${member ? member.flat : ""} ${month}`;
  const uri = payment
    ? buildUpiUri({ vpa: settings.upiId, payee: settings.payeeName || settings.societyName, amount: payment.amount, note: upiNote })
    : "";

  const step = !wing ? 1 : !flat ? 2 : 3;

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">{settings.societyName} · Reg. {settings.regNo}</p>
        <h1>Pay your maintenance, in two quiet minutes.</h1>
        <p className="lede">
          Pick your wing and flat, confirm the amount, and settle it straight from any UPI app.
          The society ledger and your receipt update together.
        </p>
      </section>

      <ol className="steps" aria-label="Steps">
        {[
          ["Wing", 1],
          ["Flat", 2],
          ["Pay", 3],
        ].map(([label, n]) => (
          <li key={label as string} className={step >= (n as number) ? "done" : ""}>
            <i>{n as number}</i>
            {label}
          </li>
        ))}
      </ol>

      {stage === "form" && (
        <div className="paygrid">
          <div className="card pad">
            {!wing && (
              <>
                <h2 className="card-title">Choose your wing</h2>
                <div className="winglist">
                  {wings.length === 0 && <p className="muted">The committee hasn't added flats yet (Admin → Members).</p>}
                  {wings.map((w) => {
                    const list = members.filter((m) => m.active && m.wing === w);
                    const dues = list.filter((m) => m.dueBalance > 0).length;
                    return (
                      <button key={w} className="wingbtn" onClick={() => { setWing(w); setFlat(null); }}>
                        <span className="wing-letter">{w}</span>
                        <span className="wing-meta">
                          <b>Wing {w}</b>
                          <em>{list.length} flats</em>
                        </span>
                        {dues > 0 && <span className="wing-flag">{dues} with dues</span>}
                        <IconArrow className="wing-go" size={16} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {wing && !flat && (
              <>
                <div className="card-head-line">
                  <h2 className="card-title">Wing {wing} — which flat is yours?</h2>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setWing(null); setFlat(null); }}>
                    Change wing
                  </button>
                </div>
                <div className="flatgrid">
                  {inWing.map((m) => (
                    <button
                      key={m.id}
                      className={`flatcard ${m.dueBalance > 0 ? "hasdue" : ""}`}
                      onClick={() => {
                        setFlat(m.id);
                        setAmount(String(Math.max(m.dueBalance > 0 ? m.dueBalance : m.monthlyMaintenance, 0)));
                      }}
                    >
                      <span className="flat-no">{m.flat}</span>
                      <span className="flat-owner">{m.ownerName}</span>
                      <span className={`flat-due ${m.dueBalance > 0 ? "due" : "clear"}`}>
                        {m.dueBalance > 0 ? `${inr(m.dueBalance)} due` : "dues clear"}
                      </span>
                    </button>
                  ))}
                  {inWing.length === 0 && <p className="muted">No flats registered in this wing yet.</p>}
                </div>
              </>
            )}

            {wing && flat && member && (
              <>
                <div className="card-head-line">
                  <h2 className="card-title">
                    Flat {member.wing}-{member.flat}
                  </h2>
                  <button className="btn btn-ghost btn-sm" onClick={() => setFlat(null)}>
                    Change flat
                  </button>
                </div>
                <div className="ownerstrip">
                  <div>
                    <span className="eyebrow">Member</span>
                    <b>{member.ownerName}</b>
                  </div>
                  <div>
                    <span className="eyebrow">Monthly maintenance</span>
                    <b>{inr(member.monthlyMaintenance)}</b>
                  </div>
                  <div>
                    <span className="eyebrow">Dues outstanding</span>
                    <b className={member.dueBalance > 0 ? "dues-hot" : ""}>{inr(Math.max(0, member.dueBalance))}</b>
                  </div>
                </div>

                <form
                  className="payform"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startPayment();
                  }}
                >
                  <label>
                    <span className="eyebrow">Amount to pay (₹)</span>
                    <input
                      className="input big"
                      type="number"
                      min="1"
                      max="500000"
                      step="0.01"
                      inputMode="decimal"
                      autoFocus
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 2800"
                      required
                    />
                  </label>
                  <div className="chipsrow">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => setAmount(String(Math.max(0, member.dueBalance)))}
                    >
                      Clear dues ({inr(Math.max(0, member.dueBalance))})
                    </button>
                    <button type="button" className="chip" onClick={() => setAmount(String(member.monthlyMaintenance))}>
                      Just this month ({inr(member.monthlyMaintenance)})
                    </button>
                  </div>
                  <label>
                    <span className="eyebrow">For which month?</span>
                    <input
                      className="input"
                      type="month"
                      value={month}
                      max={currentMonth()}
                      onChange={(e) => setMonth(e.target.value)}
                      required
                    />
                  </label>
                  <p className="hint">
                    Anything you pay beyond the outstanding dues is recorded as a voluntary contribution and appears
                    separately on the register. Amount settles toward dues first.
                  </p>
                  {!monthValid && (
                    <p className="warnline">
                      <IconAlert size={14} /> Payments can only be recorded up to the current month.
                    </p>
                  )}
                  <button className="btn btn-primary btn-block" disabled={!amountValid || !monthValid || busy}>
                    {busy ? "Opening…" : (<><IconQr size={17} /> Continue to UPI payment</>)}
                  </button>
                  <p className="fineprint">
                    No gateway, no commission — payments go direct to the society's UPI ID, <b>{settings.upiId}</b>.
                  </p>
                </form>
              </>
            )}
          </div>

          <aside className="sidecard">
            <div className="miniorn" />
            <h3>How your money is matched</h3>
            <ol className="stepslist">
              <li>
                <b>Dues first.</b> The committee sets a monthly maintenance amount for each flat. Whatever is unpaid
                shows as "dues".
              </li>
              <li>
                <b>Extra is contribution.</b> Donate above your dues — it's recorded as a separate line on the Excel
                register.
              </li>
              <li>
                <b>Verification.</b> After you pay, the treasurer verifies the UPI reference — or reads it straight
                off your screenshot; your dues reduce the moment it's confirmed.
              </li>
            </ol>
            <div className="sidequote">
              <p>"Not everything nice is proper. Banking-grade simplicity is."</p>
              <span>— Maintenance handbook, page&nbsp;1</span>
            </div>
          </aside>
        </div>
      )}

      {stage === "modal" && payment && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && undefined}>
          <div className="modal">
            <div className="modal-head">
              <div>
                <p className="eyebrow">Scan &amp; pay</p>
                <h3>{inr(payment.amount)}</h3>
                <p className="muted small">
                  {payment.wing}-{payment.flat} · {monthLabel(payment.month)}
                </p>
              </div>
              <button className="iconbtn" onClick={cancelPayment} aria-label="Cancel payment">
                <IconClose size={17} />
              </button>
            </div>
            <div className="qrwrap">
              <UpiQr uri={uri} />
              <p className="qr-note">Scan with GPay, PhonePe, Paytm or any bank UPI app</p>
            </div>
            <div className="upirow">
              <code>{settings.upiId}</code>
              <button
                className="btn btn-outline btn-sm"
                onClick={(e) => {
                  e.preventDefault();
                  navigator.clipboard?.writeText(settings.upiId);
                  toast("UPI ID copied.", "info");
                }}
              >
                Copy
              </button>
            </div>
            <a
              className="btn btn-outline btn-block"
              href={uri}
              onClick={() => toast("Opening your UPI app…", "info")}
            >
              <IconSend size={16} /> Open UPI app instead
            </a>
            <div className="modal-divider">after paying</div>

            {/* proof of a really-done payment — read right here in the browser */}
            <div className="shotproof">
              <div className="shothead">
                <IconCamera size={16} />
                <b>Attach your payment screenshot</b>
                <span className="muted small">optional, but it speeds up verification</span>
              </div>
              {!shotUrl && !ocrBusy && (
                <button
                  className="btn btn-outline btn-block"
                  disabled={ocrBusy}
                  onClick={() => document.getElementById("shot-input")?.click()}
                >
                  Take / choose screenshot
                </button>
              )}
              <input
                id="shot-input"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  handleShot(f);
                }}
              />
              {ocrBusy && (
                <div className="ocrprogress">
                  <div className="ocrbar"><span style={{ width: `${Math.max(6, ocrPct)}%` }} /></div>
                  <p className="muted small">Reading the screenshot… {ocrPct > 0 ? `${ocrPct}%` : "starting"}</p>
                </div>
              )}
              {shotUrl && !ocrBusy && (
                <div className="shotresult">
                  <img className="shotthumb" src={shotUrl} alt="Payment screenshot" />
                  <div className="shotfacts">
                    {shotMeta?.verdict === "matched" && (
                      <span className="ocrchip ok"><IconCheck size={13} /> Matches: UTR {shotMeta.ocrUtr} · {inr(shotMeta.ocrAmount ?? 0)}</span>
                    )}
                    {shotMeta?.verdict === "partial" && (
                      <span className="ocrchip warn"><IconAlert size={13} /> Attached — some details differ; the treasurer will check</span>
                    )}
                    {shotMeta?.verdict === "unreadable" && (
                      <span className="ocrchip meh"><IconImage size={13} /> Attached — couldn't read it; enter the UTR by hand</span>
                    )}
                    <div className="shotactions">
                      <button className="btn btn-ghost btn-sm" onClick={() => document.getElementById("shot-input")?.click()}>
                        Replace
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={removeShot}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {ocrHint && <p className="warnline"><IconAlert size={14} /> {ocrHint}</p>}
            </div>

            <label>
              <span className="eyebrow">Enter the 12-digit UPI reference</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="e.g. 4071 2635 8890"
                value={utr}
                onChange={(e) => {
                  setUtr(e.target.value.replace(/\D/g, "").slice(0, 12));
                  setUtrError("");
                }}
              />
            </label>
            {utrError && <p className="warnline"><IconAlert size={14} /> {utrError}</p>}
            <label>
              <span className="eyebrow">Note for the treasurer (optional)</span>
              <input className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. covered April & May together" />
            </label>
            <button className="btn btn-primary btn-block" onClick={submitUtr} disabled={busy || utr.length !== 12}>
              {busy ? "Saving…" : "I've paid — submit reference"}
            </button>
            {isDemo && (
              <p className="fineprint">Demo: any 12 digits will do, no actual money moves.</p>
            )}
          </div>
        </div>
      )}

      {stage === "done" && payment && (
        <div className="donecard card pad">
          <span className="donering"><IconCheck size={26} /></span>
          <h2>Thank you, {payment.ownerName.split(" ")[0]}.</h2>
          <p className="lede">
            {payment.status === "verified" ? (
              <>
                <b>{inr(payment.amount)}</b> confirmed for {monthLabel(payment.month)} as receipt <b>{payment.id}</b> —
                your dues have been reduced and the receipt is ready.
              </>
            ) : (
              <>
                <b>{inr(payment.amount)}</b> recorded for {monthLabel(payment.month)} as receipt{" "}
                <b>{payment.id}</b>. {payment.utr && <>Reference <b>{payment.utr}</b> · </>}status: awaiting
                committee verification.{payment.screenshot && <> Your screenshot proof is attached.</>}
              </>
            )}
          </p>
          <div className="btnrow">
            <button className="btn btn-primary" onClick={() => navigate(`/receipt/${payment.id}`)}>
              View receipt
            </button>
            <Link className="btn btn-outline" to="/history">
              My payment history
            </Link>
            <button className="btn btn-ghost" onClick={reset}>
              Pay for another flat
            </button>
          </div>
          <span className="done-ruling" />
        </div>
      )}
    </div>
  );
}
