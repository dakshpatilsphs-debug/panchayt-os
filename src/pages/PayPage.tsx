import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import UpiQr from "../components/UpiQr";
import { IconAlert, IconCamera, IconCheck, IconClose, IconImage, IconQr, IconSend } from "../components/Icons";
import { useToast } from "../components/Toast";
import { useSession } from "../lib/session";
import { checkStorageAlert } from "../lib/email";
import { isDemo } from "../lib/firebase";
import { readPaymentScreenshot } from "../lib/shot";
import { clearSession, createPayment, deletePayment, findPendingDraft, listContacts, listMembers, listNotices, loadSettings, setSessionId, updatePayment } from "../lib/store";
import type { Contact, Member, Notice, Payment, ScreenshotMeta, SocietySettings } from "../lib/types";
import {
  buildUpiUri,
  currentMonth,
  floorLabel,
  getFlatFloor,
  inr,
  monthLabel,
  newPaymentId,
  utrLooksValid,
} from "../lib/util";

type Stage = "form" | "modal" | "done";

/**
 * The payment flow — open, with no accounts and no PINs. The resident picks
 * the wing + flat chips; the pick is remembered quietly for "My payments",
 * and owner names are never displayed here (records still store them for the
 * treasurer's register).
 */
export default function PayPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const sessionId = useSession();

  // ── state (everything lives above the early return — Rules of Hooks) ──
  const [settings, setSettings] = useState<SocietySettings | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [sideTab, setSideTab] = useState<"notices" | "directory" | "contacts">("notices");
  const [wing, setWing] = useState("");
  const [flat, setFlat] = useState("");
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
  /** Flat the amount was last pre-filled from — refill on every fresh pick. */
  const prefilled = useRef("");

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
    Promise.all([listMembers(), loadSettings(), listNotices(), listContacts()])
      .then(([ms, s, ns, cs]) => {
        if (!alive) return;
        setMembers(ms);
        setSettings(s);
        setNotices(ns);
        setContacts(cs);
      })
      .catch((e) => toast(e.message, "err"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // identity: a remembered flat first, then whatever the chips pick
  const me = useMemo(() => {
    const ms = members ?? [];
    if (wing) return ms.find((m) => m.wing === wing && m.flat === flat) ?? null;
    return ms.find((m) => m.id === sessionId) ?? null;
  }, [members, wing, flat, sessionId]);
  const wings = useMemo(
    () => Array.from(new Set((members ?? []).filter((m) => m.active).map((m) => m.wing))).sort(),
    [members]
  );
  const flats = useMemo(
    () => (members ?? []).filter((m) => m.wing === wing && m.active).sort((a, b) => a.flat.localeCompare(b.flat, "en", { numeric: true })),
    [members, wing]
  );
  const floorFlats = useMemo(() => {
    const groups = new Map<number, Member[]>();
    for (const m of flats) {
      const f = getFlatFloor(m.flat, m.floor);
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f)!.push(m);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [flats]);

  // a remembered flat fills the chips on first paint
  useEffect(() => {
    if (wing || !me) return;
    setWing(me.wing);
    setFlat(me.flat);
  }, [me, wing]);

  const amountN = Math.round(Number(amount) * 100) / 100;
  const amountValid = Number.isFinite(amountN) && amountN > 0 && amountN <= 500000;
  const monthValid = month <= currentMonth();

  // Pick remembers identity without forcing a definite payment amount
  useEffect(() => {
    if (!me || prefilled.current === me.id) return;
    prefilled.current = me.id;
  }, [me]);

  /** Chip pick — sets identity AND quietly remembers it for this browser. */
  const pickFlat = (m: Member) => {
    setWing(m.wing);
    setFlat(m.flat);
    setSessionId(m.id);
  };

  const clearPick = () => {
    clearSession();
    setWing("");
    setFlat("");
    setAmount("");
    prefilled.current = "";
  };

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
    setUtr("");
    setPayNote("");
    setShotUrl("");
    setShotMeta(null);
    setOcrBusy(false);
    setOcrPct(0);
    setOcrHint("");
    setAmount("");
  };

  /* ── draft creation: double-click + duplicate guarded ── */

  const buildDraft = async (): Promise<Payment> => {
    if (!me) throw new Error("Pick your flat first");
    const maintenancePart = amountN;
    const donationPart = 0;
    const p: Payment = {
      id: newPaymentId(),
      memberId: me.id,
      wing: me.wing,
      flat: me.flat,
      ownerName: me.ownerName,
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
    if (!me || !amountValid || !monthValid) return;
    // Second tap on a slow network: hard-stop before any network call.
    if (startLock.current || busy) return;
    startLock.current = true;
    try {
      // One pending draft per flat per month — a double click, a refresh or a
      // second device all resume the SAME receipt instead of minting another.
      const existing = await findPendingDraft(me.id, month);
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
        verdict: read.verdict,
        ...(read.utr ? { ocrUtr: read.utr } : {}),
        ...(read.amount != null && !Number.isNaN(read.amount) ? { ocrAmount: read.amount } : {}),
      };
      // the resident may have cancelled the draft while OCR was running —
      // never resurrect a discarded receipt
      if (paymentRef.current?.id !== draft.id) return;
      // save what the network read — UTR + details — NOT the photo itself.
      // The evidence on the receipt is the extracted text, which is lighter
      // (no ~600 KB base64 blob in Firestore) and feeds the bank-statement
      // cross-check directly (a matching UTR is the decisive signal).
      const patch: { screenshotMeta: ScreenshotMeta; utr?: string } = { screenshotMeta: meta };
      if (read.utr && utrLooksValid(read.utr) && !draft.utr) patch.utr = read.utr;
      await updatePayment(draft.id, patch);
      setShotUrl(read.dataUrl);
      setShotMeta(meta);
      if (!read.utr) {
        setOcrHint(read.verdict === "matched" ? "" : "No 12-digit UTR visible on this screenshot — enter it by hand below.");
      }
      if (read.verdict === "matched") {
        if (!utr) setUtr(read.utr);
        toast("Screenshot read — the UTR and transaction id were saved on the receipt (image not stored).", "ok");
      } else if (read.verdict === "partial" || read.utr) {
        if (read.utr && !utr) setUtr(read.utr);
        toast("Screenshot read — UTR saved as text instead of the photo; the treasurer will cross-check it against the bank statement.", "info");
      } else {
        toast("Screenshot read, but no UTR could be detected — enter the UTR by hand (the image itself is not stored).", "info");
      }
    } catch (e) {
      setOcrHint((e as Error).message || "Couldn't read the screenshot — you can still enter the UTR by hand.");
    } finally {
      setOcrBusy(false);
      setOcrPct(0);
    }
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
      toast(payment.screenshotMeta ? "Submitted with your screenshot reference saved — the committee verifies within a day." : "Payment submitted — the committee verifies within a day.", "ok");
    } catch {
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

  const upiNote = `${
    settings.societyName
  } maintenance ${payment?.wing ?? ""}-${payment?.flat ?? ""} ${month}`;
  const uri = payment
    ? buildUpiUri({ vpa: settings.upiId, payee: settings.payeeName || settings.societyName, amount: payment.amount, note: upiNote })
    : "";

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">{settings.societyName} · Reg. {settings.regNo}</p>
        <h1>Pay your maintenance, in two quiet minutes.</h1>
        <p className="lede">
          Confirm the amount, scan the QR with any UPI app, and attach your payment screenshot.
          The society ledger and your receipt update together.
        </p>
      </section>

      <ol className="steps" aria-label="Steps">
        {[
          [me ? `Flat ${me.wing}-${me.flat}` : "Your flat", 1],
          ["Confirm", 2],
          ["Pay", 3],
        ].map(([label, n]) => (
          <li key={label as string} className={stepGate(n as number) ? "done" : ""}>
            <i>{n as number}</i>
            {label as string}
          </li>
        ))}
      </ol>

      {stage === "form" && (
        <div className="paygrid">
          <div className="card pad">
            <div className="card-head-line">
              <h2 className="card-title">{me ? `Flat ${me.wing}-${me.flat}` : "Pick your flat"}</h2>
              {me && (
                <button className="btn btn-ghost btn-sm" onClick={clearPick}>
                  Not yours? Change
                </button>
              )}
            </div>

            {!me ? (
              <div className="flatpick">
                <div className="selrow">
                  <span className="eyebrow">Wing</span>
                  <div className="chipsrow">
                    {wings.map((w) => (
                      <button key={w} className={`chip ${wing === w ? "chip-on" : ""}`} onClick={() => { setWing(w); setFlat(""); }}>
                        Wing {w}
                      </button>
                    ))}
                  </div>
                </div>
                {wing && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                    <span className="eyebrow">Select flat (floor-wise)</span>
                    {floorFlats.map(([fNum, fList]) => (
                      <div key={fNum} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <span className="muted" style={{ fontSize: "12px", minWidth: "90px", fontWeight: 600 }}>
                          {floorLabel(fNum)}:
                        </span>
                        <div className="chipsrow" style={{ margin: 0 }}>
                          {fList.map((m) => (
                            <button
                              key={m.id}
                              className={`chip ${flat === m.flat ? "chip-on" : ""}`}
                              onClick={() => pickFlat(m)}
                              title={m.ownerName ? `Owner: ${m.ownerName}` : undefined}
                            >
                              {m.flat} {m.ownerName ? `(${m.ownerName.split(" ")[0]})` : ""}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="hint">
                  Choose your wing, then your flat. Owner name from society directory is verified upon selection.
                </p>
              </div>
            ) : (
              <>
            <div className="ownerstrip">
              <div>
                <span className="eyebrow">Flat</span>
                <b>{me.wing}-{me.flat}</b>
              </div>
              <div>
                <span className="eyebrow">Flat Owner</span>
                <b>{me.ownerName || "— Not specified in directory"}</b>
              </div>
              {me.phone && (
                <div>
                  <span className="eyebrow">Contact</span>
                  <b>{me.phone}</b>
                </div>
              )}
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
                  step="any"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount to pay (₹)"
                  required
                />
                <span className="muted" style={{ fontSize: "12px", marginTop: "4px", display: "block" }}>
                  No definite amount required — enter any maintenance, advance, or custom amount you wish to pay.
                </span>
              </label>
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
                Scan the society UPI QR code on the next step with any UPI app (GPay, PhonePe, Paytm, BHIM) and confirm.
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

          <aside className="sidecard" style={{ padding: "18px 20px" }}>
            {/* Quick switcher to load society pages right here */}
            <div className="chipsrow" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "10px", marginBottom: "14px" }}>
              <button
                type="button"
                className={`chip ${sideTab === "notices" ? "chip-on" : ""}`}
                onClick={() => setSideTab("notices")}
                style={{ fontSize: "12px", padding: "4px 9px", fontWeight: 600 }}
              >
                📢 Notices
              </button>
              <button
                type="button"
                className={`chip ${sideTab === "directory" ? "chip-on" : ""}`}
                onClick={() => setSideTab("directory")}
                style={{ fontSize: "12px", padding: "4px 9px", fontWeight: 600 }}
              >
                🏛️ Management
              </button>
              <button
                type="button"
                className={`chip ${sideTab === "contacts" ? "chip-on" : ""}`}
                onClick={() => setSideTab("contacts")}
                style={{ fontSize: "12px", padding: "4px 9px", fontWeight: 600 }}
              >
                🚨 Helplines
              </button>
            </div>

            {/* Page Tab 1: Notice Board */}
            {sideTab === "notices" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ margin: 0, fontSize: "14.5px", color: "var(--brand-deep)" }}>
                    Notice Board
                  </h4>
                  <Link to="/notices" style={{ fontSize: "12px", color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}>
                    Full Board →
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {(notices ?? []).slice(0, 3).map((n) => (
                    <div
                      key={n.id}
                      style={{
                        background: "#fff",
                        border: "1px solid var(--line)",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        borderLeft: n.tone === "warn" ? "3px solid var(--amber)" : n.tone === "event" ? "3px solid var(--brass)" : "3px solid var(--brand)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
                          {n.title}
                        </span>
                        {n.pinned && (
                          <span className="badge" style={{ fontSize: "10px", padding: "1px 5px", background: "#fef3c7", color: "#92400e" }}>
                            Pinned
                          </span>
                        )}
                      </div>
                      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--ink-soft)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {n.body}
                      </p>
                    </div>
                  ))}

                  {(!notices || notices.length === 0) && (
                    <p className="muted" style={{ fontSize: "12.5px" }}>No notices posted on the board yet.</p>
                  )}
                </div>

                <Link
                  to="/notices"
                  className="btn btn-outline btn-sm"
                  style={{ width: "100%", justifyContent: "center", marginTop: "14px", fontSize: "12.5px" }}
                >
                  View All Bulletins →
                </Link>
              </div>
            )}

            {/* Page Tab 2: Society Management & Committee */}
            {sideTab === "directory" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ margin: 0, fontSize: "14.5px", color: "var(--brand-deep)" }}>
                    Committee Members
                  </h4>
                  <Link to="/directory" style={{ fontSize: "12px", color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}>
                    Directory →
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(contacts ?? [])
                    .filter((c) => c.category === "committee")
                    .slice(0, 3)
                    .map((c) => (
                      <div
                        key={c.id}
                        style={{
                          background: "#fff",
                          border: "1px solid var(--line)",
                          borderRadius: "8px",
                          padding: "10px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: "13px", fontWeight: 700, display: "block" }}>{c.name}</span>
                          <span className="muted" style={{ fontSize: "11.5px" }}>{c.role}</span>
                        </div>
                        <a
                          href={`tel:${c.phone}`}
                          className="btn btn-ghost btn-xs"
                          style={{ fontSize: "11.5px", color: "var(--brand)", fontWeight: 600 }}
                        >
                          📞 Call
                        </a>
                      </div>
                    ))}

                  {(contacts ?? []).filter((c) => c.category === "committee").length === 0 && (
                    <p className="muted" style={{ fontSize: "12.5px" }}>No committee members listed yet.</p>
                  )}
                </div>

                <Link
                  to="/directory"
                  className="btn btn-outline btn-sm"
                  style={{ width: "100%", justifyContent: "center", marginTop: "14px", fontSize: "12.5px" }}
                >
                  Open Floor-wise Directory →
                </Link>
              </div>
            )}

            {/* Page Tab 3: Emergency & Utility Helplines */}
            {sideTab === "contacts" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h4 style={{ margin: 0, fontSize: "14.5px", color: "#dc2626" }}>
                    Emergency Contacts
                  </h4>
                  <Link to="/directory" style={{ fontSize: "12px", color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}>
                    All Helplines →
                  </Link>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(contacts ?? [])
                    .filter((c) => c.category !== "committee")
                    .slice(0, 4)
                    .map((c) => (
                      <div
                        key={c.id}
                        style={{
                          background: "#fff",
                          border: "1px solid var(--line)",
                          borderRadius: "8px",
                          padding: "9px 12px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: "12.5px", fontWeight: 700, display: "block" }}>{c.name}</span>
                          <span className="muted" style={{ fontSize: "11px" }}>{c.role}</span>
                        </div>
                        <a
                          href={`tel:${c.phone}`}
                          className="btn btn-primary btn-xs"
                          style={{
                            fontSize: "11px",
                            padding: "3px 8px",
                            backgroundColor: c.category === "emergency" ? "#dc2626" : undefined,
                          }}
                        >
                          📞 Call
                        </a>
                      </div>
                    ))}
                </div>

                <Link
                  to="/directory"
                  className="btn btn-outline btn-sm"
                  style={{ width: "100%", justifyContent: "center", marginTop: "14px", fontSize: "12.5px" }}
                >
                  View All Society Helplines →
                </Link>
              </div>
            )}
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
                  Flat {payment.wing}-{payment.flat} · {monthLabel(payment.month)}
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
          <h2>Thank you.</h2>
          <p className="lede">
            {payment.status === "verified" ? (
              <>
                <b>{inr(payment.amount)}</b> confirmed for {monthLabel(payment.month)} as receipt <b>{payment.id}</b> —
                your dues have been reduced and the receipt is ready.
              </>
            ) : (
              <>
                <b>{inr(payment.amount)}</b> recorded for flat {payment.wing}-{payment.flat} for {monthLabel(payment.month)}{" "}
                as receipt <b>{payment.id}</b>. {payment.utr && <>Reference <b>{payment.utr}</b> · </>}status: awaiting
                committee verification.{(payment.screenshot || payment.screenshotMeta) && <> Your screenshot's UTR and transaction id are saved as text proof.</>}
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
          </div>
          <span className="done-ruling" />
        </div>
      )}
    </div>
  );

  /** Steps strip is decorative: the flat is known as soon as chips pick it. */
  function stepGate(n: number): boolean {
    return n <= 2;
  }
}
